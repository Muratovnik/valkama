"""Which store answers a Planning read for one project's exact planning space.

A request names a project and a planning space by its exact identity --
`data_scope_id` and `space_key` -- and is answered only when the project
registry binds that project to that space and the store holding the space is
present: the primary store, or an attached store opened read-only. Nothing
here falls back to the primary store or to a key-only lookup: two stores can
each keep an `AW`, and a key alone says nothing between them.

A `PlanningRouting` is built per request from the project registry and the
stores as they are at that moment, and it only reads. Answering a GET through
it changes nothing on disk; a live stream builds a new one on every push, which
is how a binding moved while the stream is open closes it.

Three binding states come out of it: `mapped`, `unbound` (no binding, another
project's binding, or a space the bound store does not hold) and `unavailable`
(the bound store is not the primary and is not attached and readable).
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
from collections.abc import Callable, Iterator, Mapping

from ..projects import project_registry, scopes
from ..store_identity.metadata import ScopeError, read_store_metadata
from ..store_identity.refs import (
    planning_space_entity,
    planning_space_ref,
    validate_entity_ref,
    validate_operating_scope,
    validate_planning_space_ref,
)
from ..ui_state import PlatformHttpError


def one(parameters: Mapping[str, list[str]], key: str) -> str:
    """The single non-empty value a query gave for this key, or a 400."""

    values = parameters.get(key)
    if (
        not isinstance(values, list)
        or len(values) != 1
        or not isinstance(values[0], str)
        or not values[0]
    ):
        raise PlatformHttpError(400, "error", f"{key} must occur exactly once")
    return values[0]


def scope_parameters(
    parameters: Mapping[str, list[str]], *, project_extras: tuple[str, ...] = ()
) -> dict:
    """The operating scope a query names, with exactly the fields that scope takes."""

    scope_kind = one(parameters, "scope_kind")
    if scope_kind == "global":
        if set(parameters) != {"scope_kind"}:
            raise PlatformHttpError(400, "error", "Global scope has unknown query fields")
        return {"kind": "global"}
    if scope_kind != "project":
        raise PlatformHttpError(400, "error", "scope_kind must be global or project")
    expected = {"scope_kind", "project_id", *project_extras}
    if set(parameters) != expected:
        raise PlatformHttpError(
            400, "error", "Project scope query fields are incomplete or unknown"
        )
    return validate_operating_scope(
        {
            "kind": "project",
            "project_ref": {"project_id": one(parameters, "project_id")},
        }
    )


def space_ref_parameters(parameters: Mapping[str, list[str]]) -> dict:
    return validate_planning_space_ref(
        {
            "data_scope_id": one(parameters, "data_scope_id"),
            "space_key": one(parameters, "space_key"),
        }
    )


def _space_resources(conn: sqlite3.Connection, data_scope_id: str) -> list[dict]:
    return [
        planning_space_entity({"data_scope_id": data_scope_id, "space_key": str(row[0])})
        for row in conn.execute("SELECT key FROM planning_spaces ORDER BY key")
    ]


class PlanningRouting:
    """One request's view of which project binds which space in which store."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        primary_db: str,
        *,
        registry_reader: project_registry.RegistryReader | None = None,
    ):
        if not isinstance(conn, sqlite3.Connection):
            raise TypeError("Planning routing requires an explicit sqlite3.Connection")
        self.conn = conn
        self.primary_db = os.path.abspath(primary_db)
        self.metadata = read_store_metadata(conn)
        self.projects_result = project_registry.read_registry(reader=registry_reader)
        self.projects = self.projects_result["projects"]
        # A binding is echoed to the browser in the context payload, so it has
        # to pass the same boundary check every other entity ref does.
        for project in self.projects:
            if project["planning_binding"] is not None:
                validate_entity_ref(project["planning_binding"])
        self._stores = self._present_stores()

    def _present_stores(self) -> dict[str, list[dict]]:
        """Each readable store's planning spaces, keyed by its `data_scope_id`."""

        present = {
            self.metadata["data_scope_id"]: _space_resources(
                self.conn, self.metadata["data_scope_id"]
            )
        }
        try:
            attached = scopes.load(self.primary_db)
        except scopes.ScopeError:
            attached = []
        for item in attached:
            if item.get("primary"):
                continue
            try:
                store = scopes.open_readonly(item)
                try:
                    data_scope_id = read_store_metadata(store)["data_scope_id"]
                    present[data_scope_id] = _space_resources(store, data_scope_id)
                finally:
                    store.close()
            except (sqlite3.Error, scopes.ScopeError, ScopeError):
                continue
        return present

    def project(self, project_id: str) -> dict:
        matches = [item for item in self.projects if item["project_id"] == project_id]
        if len(matches) != 1:
            raise PlatformHttpError(404, "unavailable", "Project is not registered")
        return matches[0]

    def resolve(self, project_id: str, resource_ref: dict) -> tuple[str, str | None]:
        """The binding state of one planning-space resource for one project, and why.

        The registry already refuses two projects binding one space, so a
        resource has at most one owner here.
        """

        owners = [
            item["project_id"] for item in self.projects if item["planning_binding"] == resource_ref
        ]
        if not owners:
            return "unbound", "No owner Project binding"
        if owners != [project_id]:
            return "unbound", "Resource belongs to another Project"
        resources = self._stores.get(planning_space_ref(resource_ref)["data_scope_id"])
        if resources is None:
            return "unavailable", "Bound store is unavailable"
        if resource_ref not in resources:
            return "unbound", "Bound resource is unavailable"
        return "mapped", None

    def require_mapping(self, project_id: str, space_ref: dict) -> None:
        state, reason = self.resolve(project_id, planning_space_entity(space_ref))
        if state != "mapped":
            raise PlatformHttpError(409, "unavailable", str(reason))

    def directory_item(self, project: dict) -> dict:
        """One project as the shell lists it: its binding and how that binding stands."""

        resources = []
        resource_ref = project["planning_binding"]
        if resource_ref is not None:
            state, reason = self.resolve(project["project_id"], resource_ref)
            entry = {"resource_ref": resource_ref, "state": state}
            if reason is not None:
                entry["reason"] = reason
            resources.append(entry)
        return {
            "project_id": project["project_id"],
            "title": project["display_name"],
            "binding_state": resources[0]["state"] if resources else "unbound",
            "resources": resources,
        }

    @contextlib.contextmanager
    def store_connection(self, space_ref: dict) -> Iterator[sqlite3.Connection]:
        """The primary connection, or the attached store holding this exact space."""

        if space_ref["data_scope_id"] == self.metadata["data_scope_id"]:
            yield self.conn
            return
        try:
            candidates = scopes.load(self.primary_db)
        except scopes.ScopeError as error:
            raise PlatformHttpError(
                409, "unavailable", "Attached store registry is unavailable"
            ) from error
        for item in candidates:
            if item.get("primary"):
                continue
            try:
                attached = scopes.open_readonly(item)
            except scopes.ScopeError:
                continue
            try:
                metadata = read_store_metadata(attached)
                if metadata["data_scope_id"] == space_ref["data_scope_id"]:
                    yield attached
                    return
            finally:
                attached.close()
        raise PlatformHttpError(409, "unavailable", "Exact attached store is unavailable")

    @contextlib.contextmanager
    def planning_store(
        self, parameters: Mapping[str, list[str]]
    ) -> Iterator[tuple[sqlite3.Connection, str]]:
        """Hold the authorized exact store for a read or a live subscription."""

        if set(parameters) != {"project", "data_scope_id", "space_key"}:
            raise PlatformHttpError(400, "error", "Exact Planning query fields are required")
        project_id = one(parameters, "project")
        self.project(project_id)
        space_ref = space_ref_parameters(parameters)
        self.require_mapping(project_id, space_ref)
        with self.store_connection(space_ref) as store:
            yield store, space_ref["space_key"]

    def planning_read_model(
        self,
        parameters: Mapping[str, list[str]],
        loader: Callable[[sqlite3.Connection, str], dict],
    ) -> dict:
        """Read Planning's model through the exact owner binding and store.

        Planning owns the model; routing owns which connection may answer.
        Attached connections are opened read-only by the shared store resolver.
        """

        with self.planning_store(parameters) as (store, key):
            return loader(store, key)
