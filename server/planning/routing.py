"""Which store answers a Planning read for one exactly named planning space.

A request names a planning space by its exact identity -- `data_scope_id` and
`space_key` -- and is answered when the store holding the space is present: the
primary store, or an attached store opened read-only. Nothing here falls back to
the primary store or to a key-only lookup: two stores can each keep a `MAIN`, and
a key alone says nothing between them.

A space is read whether or not the project registry binds a project to it: a
space with no projects still holds its items. A project may narrow the read when
it is one the registry binds to the space or one an item of the space names,
which may be a project of another space. The registry has to be readable for
any of it, so an unreadable registry answers a read as unavailable, not as half
of one.

A `PlanningRouting` is built per request from the project registry and the
stores as they are at that moment, and it only reads. Answering a GET through
it changes nothing on disk; a live stream builds a new one on every push, which
is how a space that went away while the stream is open closes it.

`unavailable_reason` says why a space cannot be read as a stable code, so a read
across spaces can name what it could not check and why.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
from collections.abc import Callable, Iterator, Mapping

from ..projects import project_registry, scopes
from ..store_identity.metadata import ScopeError, read_store_metadata
from ..store_identity.primitives import ContractError
from ..store_identity.refs import (
    planning_space_ref,
    validate_entity_ref,
    validate_operating_scope,
    validate_planning_space_ref,
)
from ..ui_state import PlatformHttpError

#: The fields that name one space exactly, and the one that may narrow it to a project.
_SPACE_FIELDS = frozenset({"data_scope_id", "space_key"})
_PROJECT_FIELD = "project"
#: The projects the items of each space name, by space key.
_NAMED_PROJECTS = (
    "SELECT DISTINCT p.key, j.project_id FROM work_item_projects j"
    " JOIN work_items w ON w.work_item_id = j.work_item_id"
    " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
)


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


def scope_parameters(parameters: Mapping[str, list[str]], *, extras: tuple[str, ...] = ()) -> dict:
    """The operating scope a query names, with exactly the fields that scope takes.

    `scope_kind=space` names the space by `data_scope_id` and `space_key` and may
    narrow it with `project_id`; `extras` are the fields the read itself takes.
    """

    scope_kind = one(parameters, "scope_kind")
    if scope_kind == "global":
        if set(parameters) != {"scope_kind"}:
            raise PlatformHttpError(400, "error", "Global scope has unknown query fields")
        return {"kind": "global"}
    if scope_kind != "space":
        raise PlatformHttpError(400, "error", "scope_kind must be global or space")
    required = {"scope_kind", *_SPACE_FIELDS, *extras}
    if not required <= set(parameters) or set(parameters) - required - {"project_id"}:
        raise PlatformHttpError(400, "error", "Space scope query fields are incomplete or unknown")
    scope: dict = {"kind": "space", "space_ref": space_ref_parameters(parameters)}
    if "project_id" in parameters:
        scope["project_ref"] = {"project_id": one(parameters, "project_id")}
    return validate_operating_scope(scope)


def space_ref_parameters(parameters: Mapping[str, list[str]]) -> dict:
    return validate_planning_space_ref(
        {
            "data_scope_id": one(parameters, "data_scope_id"),
            "space_key": one(parameters, "space_key"),
        }
    )


def _space_names(conn: sqlite3.Connection) -> dict[str, str]:
    return {
        str(row[0]): str(row[1])
        for row in conn.execute("SELECT key, name FROM planning_spaces ORDER BY key")
    }


def named_projects(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """The projects the items of each space of this store name, by space key.

    An attached store written before items named their projects has no such
    table, and names none.
    """

    found: dict[str, set[str]] = {}
    try:
        rows = conn.execute(_NAMED_PROJECTS).fetchall()
    except sqlite3.Error:
        return found
    for key, project_id in rows:
        found.setdefault(str(key), set()).add(str(project_id))
    return found


class PlanningRouting:
    """One request's view of which spaces each store holds and which projects each has."""

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
        # Why an attached store is missing from `_stores`: the list of attached
        # stores could not be read, or a store on it could not be opened. Without
        # these a store that is simply not attached and one that is attached but
        # unreadable would read as the same absence.
        self.attached_list_unreadable = False
        self.unopened_attached = 0
        self.projects_result = project_registry.read_registry(reader=registry_reader)
        self.projects = self.projects_result["projects"]
        # The space a binding names reaches the browser in the context payload, so
        # it has to pass the same boundary check every other entity ref does.
        for project in self.projects:
            if project["planning_binding"] is not None:
                validate_entity_ref(project_registry.binding_entity(project["planning_binding"]))
        self._stores = self._present_stores()

    def _present_stores(self) -> dict[str, dict[str, str]]:
        """Each readable store's planning spaces, name by key, keyed by its `data_scope_id`."""

        present = {self.metadata["data_scope_id"]: _space_names(self.conn)}
        try:
            attached = scopes.load(self.primary_db)
        except scopes.ScopeError:
            self.attached_list_unreadable = True
            attached = []
        for item in attached:
            if item.get("primary"):
                continue
            try:
                store = scopes.open_readonly(item)
                try:
                    data_scope_id = read_store_metadata(store)["data_scope_id"]
                    present[data_scope_id] = _space_names(store)
                finally:
                    store.close()
            except (sqlite3.Error, scopes.ScopeError, ScopeError):
                self.unopened_attached += 1
                continue
        return present

    @property
    def registry_available(self) -> bool:
        return self.projects_result["status"] == "available"

    def present_spaces(self) -> list[dict]:
        """Every space of every readable store: the primary store's first, each by key."""

        primary = self.metadata["data_scope_id"]
        return [
            {"data_scope_id": data_scope_id, "space_key": key}
            for data_scope_id in sorted(self._stores, key=lambda scope: (scope != primary, scope))
            for key in self._stores[data_scope_id]
        ]

    def space_name(self, space_ref: dict) -> str | None:
        return self._stores.get(space_ref["data_scope_id"], {}).get(space_ref["space_key"])

    def project(self, project_id: str) -> dict:
        matches = [item for item in self.projects if item["project_id"] == project_id]
        if len(matches) != 1:
            raise PlatformHttpError(404, "unavailable", "Project is not registered")
        return matches[0]

    def space_projects(self, space_ref: dict) -> list[Mapping[str, object]]:
        """The projects the registry binds to this space: the default one first, then by id."""

        return project_registry.space_projects(self.projects, space_ref)

    def other_space_projects(self, space_ref: dict, named: set[str]) -> list[dict]:
        """The registered projects of other spaces that items of this space name, by id.

        `named` is what the items of the space name. Each project says the key of the
        space it lives in, or none when the registry binds it to no space.
        """

        own = {project["project_id"] for project in self.space_projects(space_ref)}
        found = []
        for project in self.projects:
            if project["project_id"] not in named or project["project_id"] in own:
                continue
            home = None
            if project["planning_binding"] is not None:
                with contextlib.suppress(ContractError):
                    home = planning_space_ref(
                        project_registry.binding_entity(project["planning_binding"])
                    )
            found.append(
                {
                    "project_id": project["project_id"],
                    "display_name": project["display_name"],
                    "space_key": None if home is None else home["space_key"],
                }
            )
        return sorted(found, key=lambda project: project["project_id"])

    def unavailable_reason(self, space_ref: dict) -> str | None:
        """Why this space cannot be read, as a stable code, or None when it can.

        `store_not_attached`: the space's store is neither the primary nor attached.
        `store_unreadable`: an attached store could not be opened, and it may be the
        space's -- an unopened store names no `data_scope_id` to tell.
        `attached_list_unreadable`: the list of attached stores could not be read.
        `space_missing`: the store holds no such space.
        """

        names = self._stores.get(space_ref["data_scope_id"])
        if names is None:
            if self.attached_list_unreadable:
                return "attached_list_unreadable"
            return "store_unreadable" if self.unopened_attached else "store_not_attached"
        if space_ref["space_key"] not in names:
            return "space_missing"
        return None

    def require_space(self, space_ref: dict) -> None:
        """Refuse a read of a space this request cannot answer, saying why."""

        if not self.registry_available:
            raise PlatformHttpError(409, "unavailable", "Project registry is unavailable")
        reason = self.unavailable_reason(space_ref)
        if reason == "space_missing":
            raise PlatformHttpError(409, "unavailable", "Planning space is unavailable")
        if reason is not None:
            raise PlatformHttpError(409, "unavailable", "Planning space store is unavailable")

    def require_project(self, space_ref: dict, project_id: str) -> None:
        """Refuse a project that does not narrow this space: neither its own nor named in it."""

        self.project(project_id)
        if any(item["project_id"] == project_id for item in self.space_projects(space_ref)):
            return
        with self.store_connection(space_ref) as store:
            named = named_projects(store).get(space_ref["space_key"], set())
        if project_id not in named:
            raise PlatformHttpError(
                409, "unavailable", "Project is not one of the space's and no item of it names it"
            )

    def require_scope(self, scope: dict) -> None:
        """Refuse a space scope this request cannot answer; a global scope always stands."""

        if scope["kind"] != "space":
            return
        self.require_space(scope["space_ref"])
        if "project_ref" in scope:
            self.require_project(scope["space_ref"], scope["project_ref"]["project_id"])

    def spaces(self) -> list[dict]:
        """Every readable space as the shell lists it, with its projects and the others named."""

        named_by_store: dict[str, dict[str, set[str]]] = {}
        listed = []
        for space_ref in self.present_spaces():
            scope = space_ref["data_scope_id"]
            if scope not in named_by_store:
                with self.store_connection(space_ref) as store:
                    named_by_store[scope] = named_projects(store)
            listed.append(
                {
                    "data_scope_id": scope,
                    "space_key": space_ref["space_key"],
                    "name": self.space_name(space_ref),
                    **project_registry.projects_shown(self.space_projects(space_ref)),
                    "other_space_projects": self.other_space_projects(
                        space_ref, named_by_store[scope].get(space_ref["space_key"], set())
                    ),
                }
            )
        return listed

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
        """Hold the store of the exactly named space for a read or a live subscription.

        The query names the space by `data_scope_id` and `space_key` and may narrow
        it with `project`, which has to be a project the space reads for.
        """

        fields = set(parameters)
        if not fields >= _SPACE_FIELDS or fields - _SPACE_FIELDS - {_PROJECT_FIELD}:
            raise PlatformHttpError(400, "error", "Exact Planning query fields are required")
        space_ref = space_ref_parameters(parameters)
        self.require_space(space_ref)
        if _PROJECT_FIELD in parameters:
            self.require_project(space_ref, one(parameters, _PROJECT_FIELD))
        with self.store_connection(space_ref) as store:
            yield store, space_ref["space_key"]

    def planning_read_model(
        self,
        parameters: Mapping[str, list[str]],
        loader: Callable[[sqlite3.Connection, str, str | None], dict],
    ) -> dict:
        """Read Planning's model of the exactly named space from the store holding it.

        Planning owns the model; routing owns which connection may answer. The
        loader gets the store, the space's key and the project narrowing the read,
        or None, and narrows it the same way in the primary store and in an
        attached one. Attached connections are opened read-only by the shared
        store resolver.
        """

        project = one(parameters, _PROJECT_FIELD) if _PROJECT_FIELD in parameters else None
        with self.planning_store(parameters) as (store, key):
            return loader(store, key, project)
