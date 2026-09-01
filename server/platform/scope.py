"""Exact Project ↔ Board scope binding and authorization helpers.

Project identity is never inferred from a board label, path, cwd, or a scope
alias.  The reader consumes owner-authored binding records and a local store
inventory, returning typed recovery states when the record cannot be proven.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from .contracts import (
    ContractError,
    planning_space_entity,
    planning_space_ref,
    planning_work_item_entity,
    planning_work_item_ref,
    validate_data_scope_id,
    validate_entity_ref,
    validate_project_ref,
    validate_project_registry_projection,
    validate_work_item_ref,
)


class ScopeError(ContractError):
    pass


class ScopeConflictError(ScopeError):
    pass


class AliasCollisionError(ScopeConflictError):
    pass


class BindingConflictError(ScopeConflictError):
    pass


class UnknownStoreError(ScopeError):
    pass


# The owning-store identity this product writes, and the names it wrote before
# it was renamed. `owner_id` is immutable so that a second product cannot claim
# someone else's store; a rename is the one case where the same product turns up
# under a new name, so it is spent from this list and nowhere else.
PLATFORM_OWNER_ID = "valkama"
FORMER_OWNER_IDS = ("hub", "kanban")


STORE_METADATA_SCHEMA = """
CREATE TABLE IF NOT EXISTS platform_store_metadata(
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    data_scope_id TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
    is_writable INTEGER NOT NULL CHECK(is_writable IN (0, 1)),
    created_at TEXT NOT NULL
);
"""


def _require_connection(conn):
    if not isinstance(conn, sqlite3.Connection):
        raise TypeError("an explicit sqlite3.Connection is required")
    return conn


def ensure_store_metadata(
    conn, *, owner_id, is_primary=True, is_writable=True, caller_owns_transaction=False
):
    """Create the immutable owning-store identity once on a supplied DB handle."""
    conn = _require_connection(conn)
    if not isinstance(owner_id, str) or not owner_id or owner_id != owner_id.strip():
        raise ScopeError("store metadata owner_id must be explicit bounded text")
    if not isinstance(is_primary, bool) or not isinstance(is_writable, bool):
        raise ScopeError("store metadata primary/writable flags must be boolean")
    conn.execute(STORE_METADATA_SCHEMA)
    row = conn.execute(
        "SELECT data_scope_id, owner_id, is_primary, is_writable, created_at FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()
    if row is None:
        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        scope_id = str(uuid4())
        conn.execute(
            "INSERT INTO platform_store_metadata(singleton,data_scope_id,owner_id,is_primary,is_writable,created_at) VALUES (1,?,?,?,?,?)",
            (scope_id, owner_id, int(is_primary), int(is_writable), created_at),
        )
    else:
        current = _metadata_dict(row)
        if current["owner_id"] != owner_id:
            raise ScopeConflictError("store metadata owner_id is immutable")
        if current["is_primary"] != is_primary or current["is_writable"] != is_writable:
            raise ScopeConflictError("store metadata primary/writable state is immutable")
    result = read_store_metadata(conn)
    if not caller_owns_transaction:
        conn.commit()
    return result


def read_store_metadata(conn):
    conn = _require_connection(conn)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_store_metadata'"
        ).fetchone()
        is None
    ):
        raise UnknownStoreError("store metadata is not initialized")
    row = conn.execute(
        "SELECT data_scope_id, owner_id, is_primary, is_writable, created_at FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()
    if row is None:
        raise UnknownStoreError("store metadata is not initialized")
    result = _metadata_dict(row)
    validate_data_scope_id(result["data_scope_id"])
    return result


def _metadata_dict(row):
    values = tuple(row)
    return {
        "data_scope_id": values[0],
        "owner_id": values[1],
        "is_primary": bool(values[2]),
        "is_writable": bool(values[3]),
        "created_at": values[4],
    }


def get_or_create_data_scope_id(conn, *, owner_id, is_primary=True, is_writable=True):
    return ensure_store_metadata(
        conn, owner_id=owner_id, is_primary=is_primary, is_writable=is_writable
    )["data_scope_id"]


def store_owner_migration_needed(conn):
    """True when this store is ours but still carries a former product name."""
    conn = _require_connection(conn)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_store_metadata'"
        ).fetchone()
        is None
    ):
        return False
    row = conn.execute(
        "SELECT owner_id FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()
    return row is not None and row[0] in FORMER_OWNER_IDS


def migrate_store_owner(conn):
    """Carry a store written under a former product name over to this one.

    `data_scope_id` is deliberately untouched. It is the identity every board
    ref, binding and relation already points at, so rewriting it would orphan
    them; only the human-readable owner changes, which is all the rename is.
    """
    conn = _require_connection(conn)
    if not store_owner_migration_needed(conn):
        return None
    current = conn.execute(
        "SELECT owner_id FROM platform_store_metadata WHERE singleton = 1"
    ).fetchone()[0]
    # Bounded by the exact name that was read rather than by the whole list, so
    # the statement stays static and still cannot rewrite anything but the one
    # former identity this call decided about.
    conn.execute(
        "UPDATE platform_store_metadata SET owner_id = ? WHERE singleton = 1 AND owner_id = ?",
        (PLATFORM_OWNER_ID, current),
    )
    return read_store_metadata(conn)


@dataclass(frozen=True)
class BindingResolution:
    state: str
    project_id: str
    resource_ref: dict | None = None
    binding: dict | None = None
    reason: str | None = None

    @property
    def mapped(self):
        return self.state == "mapped"

    def __getitem__(self, key):
        return self.to_wire()[key]

    def to_wire(self):
        result: dict[str, object] = {"state": self.state, "project_id": self.project_id}
        if self.resource_ref is not None:
            result["resource_ref"] = self.resource_ref
        if self.binding is not None:
            result["binding"] = self.binding
        if self.reason is not None:
            result["reason"] = self.reason
        return result


class ProjectResourceBindingReader:
    """In-memory owner-authored binding projection.

    The object intentionally does not open a database. Callers register exact
    store UUIDs, neutral resource refs, and revisions.
    """

    def __init__(self):
        self._stores: dict[str, dict] = {}
        self._aliases: dict[str, set[str]] = {}
        self._bindings: dict[tuple[str, str], list[dict]] = {}
        self._project_bindings: dict[str, list[dict]] = {}
        self._projections: dict[str, dict] = {}

    def register_store(
        self,
        data_scope_id,
        alias,
        *,
        resources=(),
        registry_revision=0,
        attached=True,
        available=True,
    ):
        # The canonical UUID check, without making aliases part of identity.
        scope_id = validate_data_scope_id(data_scope_id)
        if not isinstance(alias, str) or not alias or len(alias) > 200 or alias != alias.strip():
            raise ScopeError("store alias must be bounded trimmed text")
        if (
            not isinstance(registry_revision, int)
            or isinstance(registry_revision, bool)
            or registry_revision < 0
        ):
            raise ScopeError("registry_revision must be a non-negative integer")
        if not isinstance(attached, bool) or not isinstance(available, bool):
            raise ScopeError("attached and available must be boolean")
        resource_refs = []
        for resource in resources:
            entity = validate_entity_ref(resource)
            if set(entity) != {"kind", "resource_id"}:
                raise ScopeError("store resources require neutral kind/resource_id refs")
            resource_refs.append(entity)
        if scope_id in self._stores:
            current = self._stores[scope_id]
            if current["alias"] != alias:
                # Owner may rename a scope, but identity and history stay put.
                old_alias = current["alias"]
                self._aliases.setdefault(old_alias, set()).discard(scope_id)
            current.update(
                alias=alias,
                resources=tuple(resource_refs),
                registry_revision=registry_revision,
                attached=attached,
                available=available,
            )
        else:
            self._stores[scope_id] = {
                "data_scope_id": scope_id,
                "alias": alias,
                "resources": tuple(resource_refs),
                "registry_revision": registry_revision,
                "attached": attached,
                "available": available,
            }
        self._aliases.setdefault(alias, set()).add(scope_id)
        return dict(self._stores[scope_id])

    def detach_store(self, data_scope_id, *, unavailable=False):
        store = self._store(data_scope_id)
        store["attached"] = False
        if unavailable:
            store["available"] = False
        return dict(store)

    def reattach_store(
        self, data_scope_id, *, alias=None, resources=None, registry_revision=None, available=True
    ):
        store = self._store(data_scope_id)
        if alias is not None and alias != store["alias"]:
            old = store["alias"]
            self._aliases.setdefault(old, set()).discard(data_scope_id)
            if not isinstance(alias, str) or not alias or alias != alias.strip():
                raise ScopeError("store alias must be bounded trimmed text")
            store["alias"] = alias
            self._aliases.setdefault(alias, set()).add(data_scope_id)
        if resources is not None:
            store["resources"] = tuple(validate_entity_ref(item) for item in resources)
        if registry_revision is not None:
            if (
                not isinstance(registry_revision, int)
                or isinstance(registry_revision, bool)
                or registry_revision < 0
            ):
                raise ScopeError("registry_revision must be a non-negative integer")
            store["registry_revision"] = registry_revision
        store["attached"] = True
        store["available"] = bool(available)
        return dict(store)

    def store_for_alias(self, alias):
        ids = sorted(self._aliases.get(alias, ()))
        if not ids:
            return BindingResolution("unbound", "", reason="alias_not_registered")
        if len(ids) > 1:
            return BindingResolution("ambiguous", "", reason="scope_alias_reused")
        return dict(self._stores[ids[0]])

    def ingest_projection(self, value):
        """Atomically accept one exact, current owner-authored registry envelope."""
        projection = validate_project_registry_projection(value)
        project = projection["project_id"]
        current = self._projections.get(project)
        if current is not None:
            if current == projection:
                return _copy_projection(current)
            if projection["source_hash"] == current["source_hash"]:
                raise BindingConflictError(
                    "a source hash cannot identify conflicting project registry projections"
                )

            current_by_resource = {
                (binding["resource_ref"]["kind"], binding["resource_ref"]["resource_id"]): binding
                for binding in current["bindings"]
            }
            for binding in projection["bindings"]:
                key = (binding["resource_ref"]["kind"], binding["resource_ref"]["resource_id"])
                previous = current_by_resource.get(key)
                if (
                    previous is not None
                    and binding != previous
                    and binding["registry_revision"] <= previous["registry_revision"]
                ):
                    raise BindingConflictError(
                        "a changed ProjectResourceBinding revision must increase"
                    )

        candidate_bindings = {
            key: [dict(item) for item in records if item["project_id"] != project]
            for key, records in self._bindings.items()
        }
        candidate_bindings = {
            key: records for key, records in candidate_bindings.items() if records
        }
        for binding in projection["bindings"]:
            key = (binding["resource_ref"]["kind"], binding["resource_ref"]["resource_id"])
            records = candidate_bindings.get(key, [])
            if records:
                raise BindingConflictError(
                    "resource_ref already has a competing ProjectResourceBinding"
                )
            candidate_bindings[key] = [dict(binding)]

        # Mutation happens only after the entire envelope and conflict set are
        # proven.  A failed projection therefore leaves the old current view.
        self._bindings = candidate_bindings
        self._project_bindings[project] = [dict(item) for item in projection["bindings"]]
        self._projections[project] = _copy_projection(projection)
        return _copy_projection(projection)

    def ingest_project_binding(self, project_id, resource_ref):
        """Replace one project's optional Host Runtime Planning binding.

        Schema v3 has no hook-era projection revision or source hash. The
        resource identity is opaque here and conflict detection is exact: one
        Planning identity may belong to one project only.
        """

        project = validate_project_ref({"project_id": project_id})["project_id"]
        resource = None if resource_ref is None else validate_entity_ref(resource_ref)
        if resource is not None and resource["kind"] != "planning-space":
            raise ScopeError("Host Runtime project binding must name a planning-space")

        candidate = {
            key: [dict(item) for item in records if item["project_id"] != project]
            for key, records in self._bindings.items()
        }
        candidate = {key: records for key, records in candidate.items() if records}
        bindings = []
        if resource is not None:
            key = (resource["kind"], resource["resource_id"])
            if candidate.get(key):
                raise BindingConflictError(
                    "planning-space already belongs to another Host Runtime project"
                )
            binding = {"project_id": project, "resource_ref": resource}
            candidate[key] = [binding]
            bindings = [binding]
        self._bindings = candidate
        self._project_bindings[project] = [dict(item) for item in bindings]
        return [dict(item) for item in bindings]

    def bindings_for_project(self, project_id):
        project = validate_project_ref({"project_id": project_id})["project_id"]
        return [dict(item) for item in self._project_bindings.get(project, ())]

    def projection_for_project(self, project_id):
        project = validate_project_ref({"project_id": project_id})["project_id"]
        projection = self._projections.get(project)
        return _copy_projection(projection) if projection is not None else None

    def resolve(self, project_id, resource_ref):
        project = validate_project_ref({"project_id": project_id})["project_id"]
        resource = validate_entity_ref(resource_ref)
        if set(resource) != {"kind", "resource_id"}:
            raise ScopeError("binding resolution requires a neutral kind/resource_id ref")
        key = (resource["kind"], resource["resource_id"])
        records = self._bindings.get(key, [])
        if not records:
            return BindingResolution(
                "unbound", project, resource_ref=resource, reason="no_owner_binding"
            )
        project_records = [item for item in records if item["project_id"] == project]
        if len(records) > 1:
            return BindingResolution(
                "ambiguous", project, resource_ref=resource, reason="competing_binding_records"
            )
        if not project_records:
            return BindingResolution(
                "unbound",
                project,
                resource_ref=resource,
                reason="resource_belongs_to_other_project",
            )
        binding = dict(project_records[0])
        data_scope_id = None
        if resource["kind"] in {"planning-space", "work-item"}:
            planning_ref = (
                planning_space_ref(resource)
                if resource["kind"] == "planning-space"
                else planning_work_item_ref(resource)["space_ref"]
            )
            data_scope_id = planning_ref["data_scope_id"]
        store = self._stores.get(data_scope_id) if data_scope_id else None
        if store is None:
            return BindingResolution(
                "unavailable",
                project,
                resource_ref=resource,
                binding=binding,
                reason="store_not_registered",
            )
        if not store["attached"]:
            return BindingResolution(
                "detached", project, resource_ref=resource, binding=binding, reason="store_detached"
            )
        if not store["available"]:
            return BindingResolution(
                "unavailable",
                project,
                resource_ref=resource,
                binding=binding,
                reason="store_unavailable",
            )
        if (
            "registry_revision" in binding
            and binding["registry_revision"] != store["registry_revision"]
        ):
            return BindingResolution(
                "stale",
                project,
                resource_ref=resource,
                binding=binding,
                reason="registry_revision_changed",
            )
        if resource not in store["resources"]:
            return BindingResolution(
                "unbound",
                project,
                resource_ref=resource,
                binding=binding,
                reason="resource_not_present",
            )
        if store["resources"].count(resource) != 1:
            return BindingResolution(
                "ambiguous",
                project,
                resource_ref=resource,
                binding=binding,
                reason="duplicate_resource_ref",
            )
        return BindingResolution("mapped", project, resource_ref=resource, binding=binding)

    def resolve_planning_space_key(self, project_id, space_key):
        """Key-only lookup is explicitly ambiguous across stores.

        A key is stable inside its own store and says nothing between stores:
        two projects can each keep an `AW`. Answering anyway would route a read
        to whichever store happened to be registered first.
        """

        project = validate_project_ref({"project_id": project_id})["project_id"]
        if not isinstance(space_key, str) or not space_key or space_key != space_key.strip():
            raise ScopeError("space_key must be exact trimmed text")
        candidates = [
            binding
            for binding in self._project_bindings.get(project, ())
            if binding["resource_ref"]["kind"] == "planning-space"
            and planning_space_ref(binding["resource_ref"])["space_key"] == space_key
        ]
        if len(candidates) != 1:
            state = "unbound" if not candidates else "ambiguous"
            return BindingResolution(state, project, reason="space_key_is_not_a_unique_identity")
        return self.resolve(project, candidates[0]["resource_ref"])

    def authorize(self, entity_ref, project_id):
        """Prove an entity belongs to an exact, current project binding."""
        entity = validate_entity_ref(entity_ref)
        project = validate_project_ref({"project_id": project_id})["project_id"]
        if entity["kind"] == "project":
            if entity["project_id"] != project:
                raise ScopeError("target project does not match invocation project")
            return BindingResolution("mapped", project)
        if entity["kind"] == "planning-space":
            resolution = self.resolve(project, entity)
        elif entity["kind"] == "work-item":
            resolution = self.resolve(
                project, planning_space_entity(planning_work_item_ref(entity)["space_ref"])
            )
        else:
            # Sessions, skills, services, connections and registry records need
            # an explicit relation/registry owner; this reader cannot infer it.
            return BindingResolution("unbound", project, reason="entity_has_no_space_binding")
        if resolution.state != "mapped":
            raise ScopeError(
                f"project authorization requires mapped binding, got {resolution.state}"
            )
        return resolution

    def binding_for_work_item(self, work_item_ref, project_id):
        item = validate_work_item_ref(work_item_ref)
        return self.authorize(planning_work_item_entity(item), project_id)

    def _store(self, data_scope_id):
        try:
            scope_id = validate_data_scope_id(data_scope_id)
        except ContractError as error:
            raise UnknownStoreError(str(error)) from error
        if scope_id not in self._stores:
            raise UnknownStoreError(f"data scope {scope_id} is not registered")
        return self._stores[scope_id]


def _copy_projection(value):
    if value is None:
        return None
    return {
        **value,
        "bindings": [
            {**item, "resource_ref": dict(item["resource_ref"])} for item in value["bindings"]
        ],
    }


# Short aliases used by callers that prefer the noun over the implementation
# class; both expose the same exact-binding behavior.


__all__ = [
    "FORMER_OWNER_IDS",
    "PLATFORM_OWNER_ID",
    "AliasCollisionError",
    "BindingConflictError",
    "BindingResolution",
    "ProjectResourceBindingReader",
    "ScopeConflictError",
    "ScopeError",
    "UnknownStoreError",
    "ensure_store_metadata",
    "get_or_create_data_scope_id",
    "migrate_store_owner",
    "read_store_metadata",
    "store_owner_migration_needed",
]
