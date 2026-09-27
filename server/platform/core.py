"""Persisted Valkama platform slice and strict HTTP-facing read models.

All database handles are supplied by the owning application.  This module never
discovers a database by path, never mutates an attached scope, and never reads
provider content.  Persisted JSON is contract-validated, bounded registry
metadata only.

This module owns the current shape: the schema a live store carries, the
records the Kernel reads and writes, and the read models a request is answered
from.  Every shape the product has written before now -- the source column
tuples, the catalog signatures that recognise them, the normalizers that carry
a legacy row forward, and the migrations `store.connect()` runs -- lives in
`migrations`, which imports this module and is never imported back.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sqlite3
from collections.abc import Callable, Mapping
from copy import deepcopy
from datetime import UTC, datetime

from ..projects import project_registry, scopes
from . import health
from . import modules as platform_modules
from . import relations as platform_relations
from .capabilities import CAPABILITY_DEFINITIONS, resolve_capability
from .contracts import (
    MODULES_INTERFACE,
    ContractError,
    planning_space_entity,
    planning_space_ref,
    planning_work_item_entity,
    planning_work_item_ref,
    validate_action_input_descriptor,
    validate_action_ref,
    validate_adapter_resource_ref,
    validate_assignment,
    validate_assignment_scope,
    validate_connection,
    validate_connection_ref,
    validate_entity_ref,
    validate_invocation_context,
    validate_module_manifest,
    validate_operating_scope,
    validate_permission_grant,
    validate_planning_space_ref,
    validate_relation,
    validate_work_item_ref,
)
from .providers import (
    ProviderCatalog,
    ProviderError,
    ProviderUnavailableError,
    ReferenceProvider,
)
from .registry import (
    MissingConnectionError,
    PermissionDeniedError,
    PlatformRegistry,
    RegistryError,
    RevokedPermissionError,
    ScopeMismatchError,
)
from .relations import (
    RelationConflictError,
    RelationError,
    RelationRevisionConflictError,
    add_adapter_link,
    read_relations,
    remove_adapter_link,
)
from .scope import (
    PLATFORM_OWNER_ID,
    STORE_METADATA_SCHEMA,
    BindingResolution,
    ProjectResourceBindingReader,
    ScopeError,
    ensure_store_metadata,
    read_store_metadata,
)
from .transports import TransportError

CONTEXT_INTERFACE = "valkama-context"
REGISTRY_INTERFACE = "valkama-registry"
PLANNING_INTERFACE = "valkama-planning"
PLANNING_WORK_ITEM_INTERFACE = "valkama-planning-work-item"
RELATION_COMMAND_INTERFACE = "valkama-relation-command"
RELATION_RESULT_INTERFACE = "valkama-relation-result"
ACTION_COMMAND_INTERFACE = "valkama-action-command"
ACTION_RESULT_INTERFACE = "valkama-action-result"
UI_STATE_INTERFACE = "valkama-ui-state"
UI_PREFS_INTERFACE = "valkama-ui-prefs"
ASSIGNMENT_ACTIVATION_INTERFACE = "valkama-assignment-activation"
ASSIGNMENT_SELECTION_INTERFACE = "valkama-assignment-selection"
GRANT_REVOKE_INTERFACE = "valkama-grant-revoke"
AUTHORIZATION_OWNER_MODEL = "explicit-owner-v1"


REGISTRY_SCHEMA = """
CREATE TABLE IF NOT EXISTS platform_modules(
    module_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
    mutable INTEGER NOT NULL CHECK(mutable IN (0,1)),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_services(
    service_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','invalid','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_adapters(
    adapter_lineage_id TEXT PRIMARY KEY,
    adapter_id TEXT NOT NULL UNIQUE,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_connections(
    connection_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','invalid','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_assignments(
    assignment_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_grants(
    grant_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('active','revoked')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_actions(
    action_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_action_inputs(
    action_id TEXT PRIMARY KEY REFERENCES platform_actions(action_id),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_core_ref_bindings(
    core_ref_kind TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_packages(
    package_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_known_stores(
    data_scope_id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    resources_json TEXT NOT NULL,
    registry_revision INTEGER NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
    is_attached INTEGER NOT NULL CHECK(is_attached IN (0,1)),
    is_writable INTEGER NOT NULL CHECK(is_writable IN (0,1)),
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_registry_meta(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_ui_prefs(
    key TEXT PRIMARY KEY CHECK(key='last-route'),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_registry_audit(
    sequence INTEGER PRIMARY KEY,
    event_kind TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_registry_audit_entity
  ON platform_registry_audit(entity_kind, entity_id, sequence);
"""

SCHEMA = STORE_METADATA_SCHEMA + platform_relations.SCHEMA + REGISTRY_SCHEMA

SCHEMA_TABLES = (
    "platform_store_metadata",
    "platform_adapter_links",
    "platform_modules",
    "platform_services",
    "platform_adapters",
    "platform_connections",
    "platform_assignments",
    "platform_grants",
    "platform_actions",
    "platform_action_inputs",
    "platform_core_ref_bindings",
    "platform_packages",
    "platform_known_stores",
    "platform_registry_meta",
    "platform_registry_audit",
    "platform_ui_prefs",
)


class PlatformHttpError(ValueError):
    def __init__(self, status: int, state: str, reason: str):
        self.status = status
        self.state = state
        self.reason = reason
        super().__init__(reason)


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _planning_resources(data_scope_id: str, space_keys) -> list[dict]:
    return [
        planning_space_entity({"data_scope_id": data_scope_id, "space_key": str(key)})
        for key in space_keys
    ]


def _execute_schema(conn: sqlite3.Connection, script: str) -> None:
    statement = ""
    for line in script.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            sql = statement.strip()
            statement = ""
            if sql:
                conn.execute(sql)
    if statement.strip():
        raise RuntimeError("incomplete Platform schema statement")


def _service_key(ref: dict) -> str:
    return f"{ref['owner_id']}:{ref['service_id']}"


def _connection_key(ref: dict) -> str:
    return f"{_service_key(ref['service_ref'])}:{ref['adapter_lineage_id']}:{ref['connection_id']}"


def _scope_key(scope: dict) -> tuple[str, str]:
    return (
        ("global", "")
        if scope["kind"] == "global"
        else ("project", scope["project_ref"]["project_id"])
    )


def _ui(status: str, **fields) -> dict:
    return {"interface_version": UI_STATE_INTERFACE, "status": status, **fields}


def _last_checked_at(store: str, connection_ref: dict, state: str) -> str | None:
    """When this Connection was last observed, or nothing if it never was."""

    if state != "registered":
        return None
    observation = health.OBSERVED.read(store, _connection_key(connection_ref))
    return None if observation is None else observation.observed_at


def _reason_code(resolution: BindingResolution) -> str:
    """One sentence per reason `scope.py` can actually return.

    Three entries here used to be keyed `board_*` while the reader emitted
    `resource_*`, so they could never match and their rows fell through to the
    generic sentence. The keys below are the ones `ScopeReader` constructs.
    """

    values = {
        "alias_not_registered": "Store alias is not registered",
        "scope_alias_reused": "Store alias is ambiguous",
        "no_owner_binding": "No owner Project binding",
        "competing_binding_records": "Owner binding is ambiguous",
        "resource_belongs_to_other_project": "Resource belongs to another Project",
        "store_not_registered": "Bound store is unavailable",
        "store_detached": "Bound store is detached",
        "store_unavailable": "Bound store is unavailable",
        "registry_revision_changed": "Owner binding revision is stale",
        "resource_not_present": "Bound resource is unavailable",
        "duplicate_resource_ref": "Bound resource identity is ambiguous",
        "space_key_is_not_a_unique_identity": "Planning space key is ambiguous",
        "entity_has_no_space_binding": "Entity has no planning space binding",
    }
    return values.get(resolution.reason or "", "Project binding is unavailable")


def initialize(
    conn: sqlite3.Connection,
    primary_db: str,
    *,
    registry_reader: project_registry.RegistryReader | None = None,
    providers: ProviderCatalog | None = None,
    caller_owns_transaction: bool = False,
) -> Platform:
    """Initialize additive tables and deterministic descriptors without probes."""

    return Platform(
        conn,
        primary_db,
        registry_reader=registry_reader,
        providers=providers,
        observe_health=False,
        caller_owns_transaction=caller_owns_transaction,
    )


def modules_payload(conn: sqlite3.Connection) -> dict:
    """Read and validate every registration from the canonical persisted rows."""

    registrations = []
    rows = conn.execute(
        "SELECT module_id,record_json,state,mutable,revision,updated_at"
        " FROM platform_modules ORDER BY module_id"
    ).fetchall()
    identities = [row["module_id"] for row in rows]
    if len(identities) != len(set(identities)):
        raise RegistryError("persisted module identity is duplicated")
    if "settings" not in identities:
        raise RegistryError("persisted Settings registration is missing")
    for row in rows:
        try:
            manifest = validate_module_manifest(json.loads(row["record_json"]))
        except (TypeError, json.JSONDecodeError, ContractError) as error:
            raise RegistryError("persisted module descriptor is malformed") from error
        if manifest["module_id"] != row["module_id"]:
            raise RegistryError("persisted module identity disagrees with its descriptor")
        if row["state"] not in {"enabled", "disabled"}:
            raise RegistryError("persisted module state is invalid")
        if row["mutable"] not in {0, 1}:
            raise RegistryError("persisted module mutability is invalid")
        mutable = bool(row["mutable"])
        if not isinstance(row["revision"], int) or row["revision"] <= 0:
            raise RegistryError("persisted module revision is invalid")
        if not isinstance(row["updated_at"], str) or not row["updated_at"]:
            raise RegistryError("persisted module update time is invalid")
        if manifest["module_id"] == "settings" and (mutable or row["state"] != "enabled"):
            raise RegistryError("persisted Settings module state is invalid")
        registrations.append(
            {
                "manifest": manifest,
                "state": row["state"],
                "mutable": mutable,
                "revision": int(row["revision"]),
                "updated_at": row["updated_at"],
            }
        )
    return {"interface_version": MODULES_INTERFACE, "modules": registrations}


def require_module_enabled(conn: sqlite3.Connection, module_id: str) -> None:
    """Refuse work unless one exact persisted registration is enabled."""

    registration = next(
        (
            item
            for item in modules_payload(conn)["modules"]
            if item["manifest"]["module_id"] == module_id
        ),
        None,
    )
    if registration is None or registration["state"] != "enabled":
        raise PlatformHttpError(409, "unavailable", f"Module {module_id} is disabled")


def is_module_enabled(conn: sqlite3.Connection, module_id: str) -> bool:
    try:
        require_module_enabled(conn, module_id)
    except PlatformHttpError:
        return False
    return True


def unseen_module_ids(conn: sqlite3.Connection) -> list[str]:
    """Modules this build declares that this store has never known.

    Two rules meet here and only one of them is obvious. A module added in a
    later build must appear in installations that already exist, or it stays in
    the registry source and invisible in the product. But a row that was removed
    stays removed: the persisted registry is the runtime authority, and a build
    that reseeded whatever it happened to declare would overwrite the operator
    rather than extend the product.

    Both hold because the audit answers a question the module table cannot: a
    registration writes an audit event and nothing erases it, so a module with
    history was known once and its absence is a removal, while a module with no
    history anywhere is new. Absence alone cannot tell those apart.
    """

    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_modules'"
        ).fetchone()
        is None
    ):
        return []
    present = {str(row[0]) for row in conn.execute("SELECT module_id FROM platform_modules")}
    remembered = {
        str(row[0])
        for row in conn.execute(
            "SELECT entity_id FROM platform_registry_audit WHERE entity_kind='module'"
        )
    }
    return [
        str(manifest["module_id"])
        for manifest in platform_modules.module_manifests()
        if str(manifest["module_id"]) not in present | remembered
    ]


def _table_present(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


class Platform:
    def __init__(
        self,
        conn: sqlite3.Connection,
        primary_db: str,
        *,
        registry_reader: project_registry.RegistryReader | None = None,
        providers: ProviderCatalog | None = None,
        observe_health: bool = True,
        caller_owns_transaction: bool = False,
    ):
        if not isinstance(conn, sqlite3.Connection):
            raise TypeError("Platform requires an explicit sqlite3.Connection")
        self.conn = conn
        self.primary_db = os.path.abspath(primary_db)
        self.providers = providers or ProviderCatalog()
        self.observe_health = observe_health
        self._registry_cache: PlatformRegistry | None = None
        self._registry_cache_token: int | None = None
        self._caller_owns_transaction = caller_owns_transaction
        _execute_schema(self.conn, SCHEMA)
        self.metadata = ensure_store_metadata(
            self.conn,
            owner_id=PLATFORM_OWNER_ID,
            is_primary=True,
            is_writable=True,
            caller_owns_transaction=True,
        )
        self.projects_result = project_registry.read_registry(reader=registry_reader)
        self.projects = self.projects_result["projects"]
        self.scope_reader = ProjectResourceBindingReader()
        self._sync_store_inventory()
        self._ingest_owner_projections()
        self._seed_registry()
        self.conn.execute(
            "INSERT OR IGNORE INTO platform_registry_meta(key,value)"
            " VALUES('authorization_owner_model',?)",
            (AUTHORIZATION_OWNER_MODEL,),
        )
        self._commit_initialization()

    def _commit_initialization(self) -> None:
        if not self._caller_owns_transaction:
            self.conn.commit()

    # -- persisted lifecycle -------------------------------------------

    def _meta(self, key: str, default: str) -> str:
        row = self.conn.execute(
            "SELECT value FROM platform_registry_meta WHERE key = ?", (key,)
        ).fetchone()
        if row is not None:
            return str(row[0])
        self.conn.execute(
            "INSERT INTO platform_registry_meta(key,value) VALUES (?,?)", (key, default)
        )
        self._commit_initialization()
        return default

    def _sync_store_inventory(self) -> None:
        primary_revision = int(self._meta("primary_registry_revision", "1"))
        space_keys = [
            str(row[0]) for row in self.conn.execute("SELECT key FROM planning_spaces ORDER BY key")
        ]
        self._upsert_known_store(
            self.metadata["data_scope_id"],
            "personal",
            _planning_resources(self.metadata["data_scope_id"], space_keys),
            primary_revision,
            True,
            True,
            True,
        )
        self.conn.execute(
            "UPDATE platform_known_stores SET is_attached=0, is_writable=0, updated_at=?"
            " WHERE is_primary=0 AND is_attached != 0",
            (_now(),),
        )
        try:
            attached = scopes.load(self.primary_db)
        except scopes.ScopeError:
            attached = []
        for item in attached:
            if item.get("primary"):
                continue
            try:
                attached_conn = scopes.open_readonly(item)
                try:
                    metadata = read_store_metadata(attached_conn)
                    space_keys = [
                        str(row[0])
                        for row in attached_conn.execute(
                            "SELECT key FROM planning_spaces ORDER BY key"
                        )
                    ]
                    revision_row = attached_conn.execute(
                        "SELECT value FROM platform_registry_meta WHERE key='primary_registry_revision'"
                    ).fetchone()
                    revision = int(revision_row[0]) if revision_row else 1
                finally:
                    attached_conn.close()
            except (sqlite3.Error, scopes.ScopeError, ScopeError):
                continue
            self._upsert_known_store(
                metadata["data_scope_id"],
                item["name"],
                _planning_resources(metadata["data_scope_id"], space_keys),
                revision,
                False,
                True,
                False,
            )
        self._commit_initialization()
        rows = self.conn.execute(
            "SELECT * FROM platform_known_stores ORDER BY is_primary DESC, data_scope_id"
        ).fetchall()
        for row in rows:
            self.scope_reader.register_store(
                row["data_scope_id"],
                row["alias"],
                resources=json.loads(row["resources_json"]),
                registry_revision=int(row["registry_revision"]),
                attached=bool(row["is_attached"]),
                available=bool(row["is_attached"]),
            )

    def _upsert_known_store(
        self, data_scope_id, alias, resources, revision, is_primary, is_attached, is_writable
    ) -> None:
        self.conn.execute(
            """INSERT INTO platform_known_stores
               (data_scope_id,alias,resources_json,registry_revision,is_primary,is_attached,is_writable,updated_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(data_scope_id) DO UPDATE SET
                 alias=excluded.alias, resources_json=excluded.resources_json,
                 registry_revision=excluded.registry_revision,
                 is_primary=excluded.is_primary, is_attached=excluded.is_attached,
                 is_writable=excluded.is_writable, updated_at=excluded.updated_at""",
            (
                data_scope_id,
                alias,
                _json(list(resources)),
                int(revision),
                int(is_primary),
                int(is_attached),
                int(is_writable),
                _now(),
            ),
        )

    def _ingest_owner_projections(self) -> None:
        for item in self.projects:
            self.scope_reader.ingest_project_binding(item["project_id"], item["planning_binding"])

    def _insert_record(
        self,
        table: str,
        id_column: str,
        identity: str,
        record: dict,
        *,
        state: str,
        extra: tuple[tuple[str, object], ...] = (),
        entity_kind: str,
        immutable_fields: tuple[str, ...] = (),
    ) -> bool:
        columns = [id_column, *(name for name, _ in extra), "record_json", "state", "updated_at"]
        values = [identity, *(value for _, value in extra), _json(record), state, _now()]
        cursor = self.conn.execute(
            f"INSERT OR IGNORE INTO {table}({','.join(columns)})"
            f" VALUES ({','.join('?' for _ in columns)})",
            values,
        )
        if cursor.rowcount:
            self._audit(f"{entity_kind}.registered", entity_kind, identity)
            return True
        if immutable_fields:
            row = self.conn.execute(
                f"SELECT record_json FROM {table} WHERE {id_column}=?", (identity,)
            ).fetchone()
            try:
                existing = json.loads(row[0])
            except (TypeError, json.JSONDecodeError) as error:
                raise RegistryError(f"persisted {entity_kind} descriptor is malformed") from error
            if any(existing.get(key) != record.get(key) for key in immutable_fields):
                raise RegistryError(f"persisted {entity_kind} identity belongs to another owner")
        return False

    def unregister_external_adapter(self, adapter_id: str) -> dict:
        """Take an installed adapter out of the registry, or say why not.

        §18.6 asks for unregister as part of the installation flow, and it is
        not optional in practice: `adapter remove` deletes the declaration, and
        without this the rows written by an earlier start stay forever as a
        Connection nobody can act on. That is debris, not the honest
        `unavailable` a removed-but-referenced adapter should read as.

        Only an external adapter can be taken out. A built-in is declared in
        code and would be seeded again on the next start, so deleting its rows
        would be a change that undoes itself — worse than refusing.

        A tombstone is not written. §18.6 wants one only when real external
        refs need a deleted owner preserved, and the check below refuses while
        anything still points here, so the case a tombstone exists for cannot
        be reached by this path yet.

        Every refusal carries a `code` as well as a sentence, because the CLI
        has to tell one apart from another: nothing registered here is a reason
        to remove the declaration anyway, while an assignment still selecting
        the lineage is a reason to leave both halves alone.
        """

        try:
            self.conn.execute("BEGIN IMMEDIATE")
            plan = self._plan_external_unregistration(adapter_id)
            if "reason" in plan:
                # Nothing was written, and the rollback says so rather than
                # leaving the fence held by a caller that is done with it.
                self.conn.rollback()
                return {"removed": False, **plan}
            for key in plan["connection_keys"]:
                self.conn.execute("DELETE FROM platform_connections WHERE connection_key=?", (key,))
            self.conn.execute(
                "DELETE FROM platform_adapters WHERE adapter_lineage_id=?", (plan["lineage"],)
            )
            self.conn.execute(
                "DELETE FROM platform_services WHERE service_key=?", (plan["service_key"],)
            )
            self.conn.execute(
                "DELETE FROM platform_packages WHERE package_key=?", (plan["package_key"],)
            )
            # The audit keeps the record that this was known and taken out, which
            # is the difference the module reconcile already depends on: removed
            # and never-known look identical in a table and different in a
            # history.
            self._audit(
                "unregistered", "adapter", adapter_id, {"adapter_lineage_id": plan["lineage"]}
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        # Both halves the sibling mutators do. `PRAGMA data_version` does not
        # move for this connection's own commits, so a live instance would keep
        # serving the adapter it just removed; and an observation of a Connection
        # that no longer exists is an answer about nothing.
        self._invalidate_registry()
        health.OBSERVED.forget(self.primary_db, plan["connection_keys"])
        return {"removed": True, "adapter_lineage_id": plan["lineage"]}

    def _plan_external_unregistration(self, adapter_id: str) -> dict:
        """Exactly what this adapter owns, or the reason it may not be taken out.

        The rows are found by structured identity, never by pattern. The old
        delete matched `connection_key LIKE '%:<lineage>:%'`, and a connection
        key is a colon-joined composite of identifiers that may themselves
        contain `_` and `:` — where `_` is LIKE's single-character wildcard. So
        removing one adapter could delete a built-in's Connection whose key
        merely contained the lineage as a pattern, and the next start reseeded
        it with `trust: unknown`, silently undoing an owner's trust decision.
        A lineage is also endpoint-influenced when a manifest was discovered
        from an endpoint, so the pattern was not even hard to hit by accident.
        """

        row = self.conn.execute(
            "SELECT adapter_lineage_id,record_json FROM platform_adapters WHERE adapter_id=?",
            (adapter_id,),
        ).fetchone()
        if row is None:
            return {"code": "not-registered", "reason": "no adapter with that id is registered"}
        manifest = json.loads(row["record_json"])
        package_key = f"{manifest['publisher_id']}:{manifest['package_id']}"
        provenance = self.conn.execute(
            "SELECT record_json FROM platform_packages WHERE package_key=?",
            (package_key,),
        ).fetchone()
        descriptor = json.loads(provenance[0]) if provenance is not None else {}
        if descriptor.get("provenance") != "external-endpoint":
            return {
                "code": "not-external",
                "reason": "only an externally installed adapter can be unregistered",
            }
        lineage = str(row["adapter_lineage_id"])
        connection_keys = [
            str(connection_row["connection_key"])
            for connection_row in self.conn.execute(
                "SELECT connection_key,record_json FROM platform_connections"
            )
            if json.loads(connection_row["record_json"])["connection_ref"]["adapter_lineage_id"]
            == lineage
        ]
        # An assignment selects a Connection by key, so the keys above are the
        # exact set that could hold this lineage. `register_assignment` refuses
        # a key that is not one registered Connection, so a selection naming a
        # key no row answers to cannot have been persisted.
        holders = [
            str(assignment_row["assignment_id"])
            for assignment_row in self.conn.execute(
                "SELECT assignment_id,record_json FROM platform_assignments"
            )
            if set(json.loads(assignment_row["record_json"])["connection_ids"])
            & set(connection_keys)
        ]
        if holders:
            return {
                "code": "assignments-select-it",
                "reason": f"{len(holders)} assignment(s) still select this adapter; reset them first",
            }
        return {
            "lineage": lineage,
            "connection_keys": connection_keys,
            "service_key": _service_key(
                {"owner_id": manifest["configuration_owner"], "service_id": adapter_id}
            ),
            "package_key": package_key,
        }

    def _audit(
        self,
        event_kind: str,
        entity_kind: str,
        entity_id: str,
        detail: dict | None = None,
    ) -> None:
        detail_json = _json(detail or {})
        if len(detail_json.encode("utf-8")) > 8192:
            raise RegistryError("audit detail exceeds the bounded metadata contract")
        self.conn.execute(
            "INSERT INTO platform_registry_audit"
            "(event_kind,entity_kind,entity_id,detail_json,at)"
            " VALUES (?,?,?,?,?)",
            (event_kind, entity_kind, entity_id, detail_json, _now()),
        )

    def _seed_registry(self) -> None:
        seed = PlatformRegistry(
            scope_reader=self.scope_reader,
            lineage_factory=iter(
                [provider.adapter_lineage_id for provider in self.providers.seed_providers()]
            ).__next__,
        )
        # Every declared module is registered in the seed; only the ones this
        # store has never known are written. The flag this replaced asked
        # whether the store was being created, which is a different question
        # and gave the wrong answer to this one: a module added in a later build
        # stayed invisible in every installation that already existed.
        unknown = set(unseen_module_ids(self.conn))
        for manifest in platform_modules.module_manifests():
            seed.register_module(manifest)
            if manifest["module_id"] not in unknown:
                continue
            self._insert_record(
                "platform_modules",
                "module_id",
                manifest["module_id"],
                manifest,
                state="enabled",
                extra=(("mutable", int(manifest["module_id"] != "settings")), ("revision", 1)),
                entity_kind="module",
            )
        for provider in self.providers.seed_providers():
            service = seed.register_service(provider.service_descriptor())
            self._insert_record(
                "platform_services",
                "service_key",
                _service_key(service["service_ref"]),
                service,
                state=service["state"],
                entity_kind="service",
                immutable_fields=("service_ref", "configuration_owner", "trust_owner"),
            )
            provider_manifest = deepcopy(provider.manifest())
            # Reference providers still speak their Planning adapter vocabulary
            # internally. The Kernel persists and publishes only neutral refs.
            provider_manifest["consumes"] = [
                "work-item" if item == "card" else item for item in provider_manifest["consumes"]
            ]
            for contribution in provider_manifest["contributions"]:
                contribution["entity_kinds"] = [
                    "work-item" if item == "card" else item for item in contribution["entity_kinds"]
                ]
            adapter = seed.register_adapter(provider_manifest)
            if adapter["adapter_lineage_id"] != provider.adapter_lineage_id:
                raise RegistryError("deterministic provider lineage did not match its owner")
            stored_adapter = {
                **provider_manifest,
                "adapter_lineage_id": provider.adapter_lineage_id,
                "state": "registered",
            }
            self._insert_record(
                "platform_adapters",
                "adapter_lineage_id",
                provider.adapter_lineage_id,
                stored_adapter,
                state="registered",
                extra=(("adapter_id", provider.adapter_id),),
                entity_kind="adapter",
                immutable_fields=(
                    "adapter_id",
                    "adapter_lineage_id",
                    "package_id",
                    "publisher_id",
                    "owner_id",
                    "configuration_owner",
                    "trust_owner",
                ),
            )
            connection = seed.register_connection(provider.connection(observe=False))
            self._insert_record(
                "platform_connections",
                "connection_key",
                _connection_key(connection["connection_ref"]),
                connection,
                state=connection["state"],
                entity_kind="connection",
                immutable_fields=("connection_ref", "configuration_owner", "trust_owner"),
            )
            package = provider.package_descriptor()
            self._insert_record(
                "platform_packages",
                "package_key",
                f"{package['publisher_id']}:{package['package_id']}",
                package,
                state="registered",
                entity_kind="package",
                immutable_fields=("package_id", "publisher_id"),
            )
            # Only a reference provider publishes actions. A built-in capability
            # provider has none, and asking it by type rather than by attribute
            # keeps that fact in one place.
            if not isinstance(provider, ReferenceProvider):
                continue
            for operation in ("attach", "remove", "open"):
                action = provider.action_ref(operation)
                self._insert_record(
                    "platform_actions",
                    "action_id",
                    action["action_id"],
                    action,
                    state="registered",
                    entity_kind="action",
                    immutable_fields=("action_id", "owner_kind", "owner_id"),
                )
                permission = provider.permission_for(action["action_id"])
                declaration = next(
                    item for item in adapter["permissions"] if item["permission_id"] == permission
                )
                descriptor = validate_action_input_descriptor(
                    {
                        "action_id": action["action_id"],
                        "operation": operation,
                        "resource_types": list(declaration.get("target_kinds", [])),
                        "fields": [
                            {
                                "key": "external_id",
                                "kind": "stable-id",
                                "required": True,
                                "max_length": 128,
                            }
                        ],
                        "confirmation": "required",
                        "title_key": f"platform.actions.{permission}",
                    }
                )
                cursor = self.conn.execute(
                    "INSERT OR IGNORE INTO platform_action_inputs(action_id,record_json,updated_at)"
                    " VALUES (?,?,?)",
                    (action["action_id"], _json(descriptor), _now()),
                )
                if not cursor.rowcount:
                    existing = validate_action_input_descriptor(
                        json.loads(
                            self.conn.execute(
                                "SELECT record_json FROM platform_action_inputs WHERE action_id=?",
                                (action["action_id"],),
                            ).fetchone()[0]
                        )
                    )
                    immutable = ("action_id", "operation", "resource_types")
                    if any(existing[key] != descriptor[key] for key in immutable):
                        raise RegistryError(
                            "persisted action input semantics belong to another owner"
                        )
        self._seed_installation_assignments(seed)
        claimed_core_ref_kinds: set[str] = set()
        for provider in self.providers.seed_providers():
            for core_ref_kind in provider.core_ref_kinds:
                if core_ref_kind in claimed_core_ref_kinds:
                    raise RegistryError("multiple providers claim one core ref kind")
                claimed_core_ref_kinds.add(core_ref_kind)
                binding = {
                    "core_ref_kind": core_ref_kind,
                    "service_ref": provider.service_ref,
                    "adapter_lineage_id": provider.adapter_lineage_id,
                    "connection_id": provider.connection_ref["connection_id"],
                    "binding_version": "1",
                    "direct_read": False,
                }
                self._insert_record(
                    "platform_core_ref_bindings",
                    "core_ref_kind",
                    core_ref_kind,
                    binding,
                    state="registered",
                    entity_kind="core-ref",
                    immutable_fields=(
                        "core_ref_kind",
                        "service_ref",
                        "adapter_lineage_id",
                        "connection_id",
                    ),
                )
        self._commit_initialization()

    def _seed_installation_assignments(self, seed: PlatformRegistry) -> None:
        existing_scopes: set[tuple[str, tuple[str, str]]] = set()
        for row in self.conn.execute("SELECT record_json FROM platform_assignments"):
            record = validate_assignment(json.loads(row[0]))
            scope = record["scope"]
            scope_identity = (
                ("installation", "")
                if scope["kind"] == "installation"
                else ("project", scope["project_id"])
            )
            existing_scopes.add((record["capability_id"], scope_identity))
        for capability_id, connection_ref in self.providers.installation_defaults().items():
            identity = (capability_id, ("installation", ""))
            if identity in existing_scopes:
                continue
            record = validate_assignment(
                {
                    "assignment_id": f"builtin:{capability_id}:installation",
                    "capability_id": capability_id,
                    "scope": {"kind": "installation"},
                    "connection_ids": [_connection_key(connection_ref)],
                    "state": "enabled",
                    "changed_by": "valkama",
                }
            )
            seed.register_assignment(record)
            self._insert_record(
                "platform_assignments",
                "assignment_id",
                record["assignment_id"],
                record,
                state="enabled",
                extra=(("revision", 1),),
                entity_kind="assignment",
                immutable_fields=("assignment_id", "capability_id", "scope"),
            )
            existing_scopes.add(identity)

    def set_connection_trust(
        self, connection_value: dict, trust: str, *, changed_by: str = "owner"
    ) -> dict:
        """Persist an explicit owner trust decision; discovery remains inert."""

        connection_ref = validate_connection_ref(connection_value)
        key = _connection_key(connection_ref)
        row = self.conn.execute(
            "SELECT record_json,state FROM platform_connections WHERE connection_key=?",
            (key,),
        ).fetchone()
        if row is None or row["state"] != "registered":
            raise RegistryError("connection is unavailable")
        if not isinstance(changed_by, str) or not changed_by or len(changed_by) > 128:
            raise ContractError("changed_by must be bounded owner identity")
        record = json.loads(row["record_json"])
        record["trust"] = trust
        record = validate_connection(record)
        if json.loads(row["record_json"])["trust"] == record["trust"]:
            return record
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "UPDATE platform_connections SET record_json=?,updated_at=? WHERE connection_key=?",
                (_json(record), _now(), key),
            )
            self._audit(
                "connection.trust-changed",
                "connection",
                key,
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return record

    def register_assignment(self, value: dict) -> dict:
        """Persist one explicit owner-authored assignment (never inferred)."""

        record = validate_assignment(value)
        if record["scope"]["kind"] == "project":
            self._project(record["scope"]["project_id"])
        if record["capability_id"] not in CAPABILITY_DEFINITIONS:
            raise RegistryError("assignment capability is not Kernel-owned")
        available_connection_ids = [
            _connection_key(json.loads(row[0])["connection_ref"])
            for row in self.conn.execute(
                "SELECT record_json FROM platform_connections WHERE state='registered'"
            )
        ]
        if any(
            available_connection_ids.count(connection_id) != 1
            for connection_id in record["connection_ids"]
        ):
            raise RegistryError(
                "assignment connection_id must identify exactly one registered Connection"
            )
        # Reconstructing the registry proves lineage, connection, and scope
        # ownership before persistent state is touched.
        self.registry().register_assignment(record)
        # Validation mutates the in-memory registry by design. Drop that
        # throwaway candidate before persistence so a failed write cannot leave
        # an authorization record that exists only in cache.
        self._invalidate_registry()
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "INSERT INTO platform_assignments"
                "(assignment_id,record_json,state,revision,updated_at) VALUES (?,?,?,?,?)",
                (
                    record["assignment_id"],
                    _json(record),
                    record["state"],
                    1,
                    _now(),
                ),
            )
            self._audit(
                "assignment.registered",
                "assignment",
                record["assignment_id"],
            )
            self.conn.commit()
        except sqlite3.IntegrityError as error:
            self.conn.rollback()
            raise RegistryError("assignment identity is already registered") from error
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return record

    def grant_permission(self, value: dict) -> dict:
        """Persist an explicit owner grant after exact-scope validation."""

        record = validate_permission_grant(value)
        if not record.get("active", True):
            raise ContractError("new PermissionGrant must be active")
        scope = record["applicability"]
        if scope["kind"] == "project":
            project_id = scope["project_ref"]["project_id"]
            project = self._project(project_id)
            if not record["data_scope_ids"]:
                raise ScopeMismatchError(
                    "Project PermissionGrant requires owner-declared data scopes"
                )
            binding = project["planning_binding"]
            mapped_scope_ids = (
                {planning_space_ref(binding)["data_scope_id"]}
                if binding is not None and self.scope_reader.resolve(project_id, binding).mapped
                else set()
            )
            if not set(record["data_scope_ids"]).issubset(mapped_scope_ids):
                raise ScopeMismatchError(
                    "PermissionGrant data scopes lack an exact current owner binding"
                )
        self.registry().grant_permission(record)
        self._invalidate_registry()
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "INSERT INTO platform_grants(grant_id,record_json,state,updated_at) VALUES (?,?,?,?)",
                (record["grant_id"], _json(record), "active", _now()),
            )
            self._audit(
                "grant.registered",
                "grant",
                record["grant_id"],
            )
            self.conn.commit()
        except sqlite3.IntegrityError as error:
            self.conn.rollback()
            raise RegistryError("grant identity is already registered") from error
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return record

    def revoke_grant(self, grant_id: str, *, revoked_by: str = "owner") -> dict:
        row = self.conn.execute(
            "SELECT record_json,state FROM platform_grants WHERE grant_id=?", (grant_id,)
        ).fetchone()
        if row is None:
            raise RegistryError("grant is not registered")
        record = json.loads(row["record_json"])
        if row["state"] == "revoked":
            return {**record, "active": False, "state": "revoked"}
        record["active"] = False
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "UPDATE platform_grants SET record_json=?,state='revoked',updated_at=? WHERE grant_id=?",
                (_json(record), _now(), grant_id),
            )
            self._audit("grant.revoked", "grant", grant_id, {"revoked_by": revoked_by})
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return {**record, "state": "revoked"}

    def set_assignment_activation(self, assignment_id: str, state: str) -> dict:
        if state not in {"enabled", "disabled"}:
            raise ContractError("assignment state must be enabled or disabled")
        row = self.conn.execute(
            "SELECT record_json,state,revision FROM platform_assignments WHERE assignment_id=?",
            (assignment_id,),
        ).fetchone()
        if row is None:
            raise RegistryError("assignment is unavailable")
        record = json.loads(row["record_json"])
        record["state"] = state
        record["changed_by"] = "owner"
        record = validate_assignment(record)
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "UPDATE platform_assignments SET record_json=?,state=?,revision=revision+1,updated_at=?"
                " WHERE assignment_id=?",
                (_json(record), state, _now(), assignment_id),
            )
            self._audit("assignment.changed", "assignment", assignment_id)
            updated = self.conn.execute(
                "SELECT record_json,revision FROM platform_assignments WHERE assignment_id=?",
                (assignment_id,),
            ).fetchone()
            if updated is None:
                raise RegistryError("updated assignment is unavailable")
            result = self._assignment_presentation(
                validate_assignment(json.loads(updated["record_json"])),
                int(updated["revision"]),
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return result

    def assignment_activation_command(self, payload) -> dict:
        """Owner-invoked enable/disable of one Kernel-owned assignment."""

        self._exact_object(
            payload,
            ("interface_version", "assignment_id", "state"),
            required=("interface_version", "assignment_id", "state"),
        )
        if payload["interface_version"] != ASSIGNMENT_ACTIVATION_INTERFACE:
            raise PlatformHttpError(400, "error", "Assignment command version is not supported")
        assignment_id = payload["assignment_id"]
        if not isinstance(assignment_id, str) or not assignment_id:
            raise ContractError("assignment_id is required")
        result = self.set_assignment_activation(assignment_id, payload["state"])
        return {
            "interface_version": ASSIGNMENT_ACTIVATION_INTERFACE,
            "assignment": result,
        }

    @staticmethod
    def _assignment_identity(capability_id: str, scope: dict) -> str:
        if scope["kind"] == "installation":
            suffix = "installation"
        else:
            suffix = hashlib.sha256(scope["project_id"].encode("utf-8")).hexdigest()[:16]
        return f"selection:{capability_id}:{suffix}"

    def _assignment_row(self, capability_id: str, scope: dict) -> sqlite3.Row | None:
        matches = []
        for row in self.conn.execute(
            "SELECT assignment_id,record_json,state,revision,updated_at"
            " FROM platform_assignments ORDER BY assignment_id"
        ):
            record = validate_assignment(json.loads(row["record_json"]))
            if record["capability_id"] == capability_id and record["scope"] == scope:
                matches.append(row)
        if len(matches) > 1:
            raise RegistryError("multiple persisted assignments claim one capability and scope")
        return matches[0] if matches else None

    @staticmethod
    def _assignment_presentation(record: dict, revision: int) -> dict:
        return {**record, "revision": revision}

    def _validate_assignment_selection(self, record: dict) -> None:
        definition = CAPABILITY_DEFINITIONS[record["capability_id"]]
        count = len(record["connection_ids"])
        if definition["cardinality"] == "one" and count != 1:
            raise ContractError("capability requires exactly one Connection")
        if definition["cardinality"] == "one-or-more" and count < 1:
            raise ContractError("capability requires one or more Connections")
        if len(set(record["connection_ids"])) != count:
            raise ContractError("assignment connection_ids must be unique")
        for connection_id in record["connection_ids"]:
            rows = self.conn.execute(
                "SELECT record_json,state FROM platform_connections WHERE connection_key=?",
                (connection_id,),
            ).fetchall()
            if len(rows) != 1 or rows[0]["state"] != "registered":
                raise RegistryError("assignment Connection is unavailable")
            connection = validate_connection(json.loads(rows[0]["record_json"]))
            applicability = connection["applicability"]
            if record["scope"]["kind"] == "installation" and applicability["kind"] != "global":
                raise ScopeMismatchError("installation assignment requires a global Connection")
            if (
                record["scope"]["kind"] == "project"
                and applicability["kind"] == "project"
                and applicability["project_ref"]["project_id"] != record["scope"]["project_id"]
            ):
                raise ScopeMismatchError("project assignment selected another Project's Connection")
            lineage = connection["connection_ref"]["adapter_lineage_id"]
            adapter_row = self.conn.execute(
                "SELECT record_json,state FROM platform_adapters WHERE adapter_lineage_id=?",
                (lineage,),
            ).fetchone()
            if adapter_row is None or adapter_row["state"] != "registered":
                raise RegistryError("assignment adapter is unavailable")
            adapter = json.loads(adapter_row["record_json"])
            if record["capability_id"] not in adapter.get("capabilities", []):
                raise PermissionDeniedError(
                    "assigned Connection adapter does not implement the capability"
                )

    def assignment_selection_command(self, payload: dict) -> dict:
        """Create/update a selection, or remove one exact Project override."""

        if not isinstance(payload, dict):
            raise ContractError("assignment selection command must be an object")
        operation = payload.get("operation")
        fields = (
            ("interface_version", "operation", "capability_id", "scope", "expected_revision")
            if operation == "reset"
            else (
                "interface_version",
                "operation",
                "capability_id",
                "scope",
                "connection_ids",
                "expected_revision",
            )
        )
        self._exact_object(payload, fields, required=fields)
        if payload["interface_version"] != ASSIGNMENT_SELECTION_INTERFACE:
            raise PlatformHttpError(400, "error", "Assignment command version is not supported")
        if operation not in {"set", "reset"}:
            raise ContractError("assignment selection operation must be set or reset")
        capability_id = payload["capability_id"]
        if capability_id not in CAPABILITY_DEFINITIONS:
            raise ContractError("assignment capability is not Kernel-owned")
        scope = validate_assignment_scope(payload["scope"])
        if scope["kind"] == "project":
            self._project(scope["project_id"])
        elif operation == "reset":
            raise ContractError("only a Project override can be reset")
        expected_revision = payload["expected_revision"]
        if (
            not isinstance(expected_revision, int)
            or isinstance(expected_revision, bool)
            or expected_revision < 0
        ):
            raise ContractError("expected_revision must be a non-negative integer")
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            row = self._assignment_row(capability_id, scope)
            current_revision = int(row["revision"]) if row is not None else 0
            if current_revision != expected_revision:
                raise PlatformHttpError(409, "conflict", "Assignment revision changed")
            if operation == "reset":
                if row is not None:
                    self.conn.execute(
                        "DELETE FROM platform_assignments WHERE assignment_id=?",
                        (row["assignment_id"],),
                    )
                    self._audit("assignment.reset", "assignment", row["assignment_id"])
                result = None
            else:
                record = validate_assignment(
                    {
                        "assignment_id": (
                            row["assignment_id"]
                            if row is not None
                            else self._assignment_identity(capability_id, scope)
                        ),
                        "capability_id": capability_id,
                        "scope": scope,
                        "connection_ids": payload["connection_ids"],
                        "state": "enabled",
                        "changed_by": "owner",
                    }
                )
                self._validate_assignment_selection(record)
                revision = current_revision + 1
                if row is None:
                    self.conn.execute(
                        "INSERT INTO platform_assignments"
                        "(assignment_id,record_json,state,revision,updated_at) VALUES(?,?,?,?,?)",
                        (record["assignment_id"], _json(record), "enabled", revision, _now()),
                    )
                    event = "assignment.registered"
                else:
                    self.conn.execute(
                        "UPDATE platform_assignments SET record_json=?,state='enabled',"
                        "revision=?,updated_at=? WHERE assignment_id=?",
                        (_json(record), revision, _now(), record["assignment_id"]),
                    )
                    event = "assignment.changed"
                self._audit(event, "assignment", record["assignment_id"])
                result = self._assignment_presentation(record, revision)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        project_id = scope.get("project_id") if scope["kind"] == "project" else None
        effective = self.registry().resolve_capability(capability_id, project_id)
        return {
            "interface_version": ASSIGNMENT_SELECTION_INTERFACE,
            "operation": operation,
            "assignment": result,
            "effective": effective,
        }

    def dispatch_capability(
        self, capability_id: str, payload: dict, *, project_id: str | None = None
    ) -> dict:
        resolution = self.registry().resolve_capability(capability_id, project_id)
        if resolution["state"] != "ready":
            raise ProviderUnavailableError(resolution.get("reason", "capability unavailable"))
        connections = resolution["connections"]
        if len(connections) != 1:
            raise RegistryError("capability dispatch requires one exact resolved Connection")
        return self.providers.dispatch(connections[0]["connection_ref"], capability_id, payload)

    def grant_revoke_command(self, payload) -> dict:
        """Owner-invoked revocation of one Platform-owned PermissionGrant."""

        self._exact_object(
            payload,
            ("interface_version", "grant_id"),
            required=("interface_version", "grant_id"),
        )
        if payload["interface_version"] != GRANT_REVOKE_INTERFACE:
            raise PlatformHttpError(400, "error", "Grant command version is not supported")
        grant_id = payload["grant_id"]
        if not isinstance(grant_id, str) or not grant_id:
            raise ContractError("grant_id is required")
        record = self.revoke_grant(grant_id)
        return {"interface_version": GRANT_REVOKE_INTERFACE, "grant": record}

    def remove_connection(self, connection_value: dict) -> dict:
        """Persist a Connection tombstone without touching linked resources."""

        connection_ref = validate_connection_ref(connection_value)
        key = _connection_key(connection_ref)
        row = self.conn.execute(
            "SELECT record_json,state FROM platform_connections WHERE connection_key=?",
            (key,),
        ).fetchone()
        if row is None:
            raise RegistryError("connection is not registered")
        record = json.loads(row["record_json"])
        if row["state"] == "tombstoned":
            return {**record, "state": "tombstoned"}
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "UPDATE platform_connections SET state='tombstoned',updated_at=? WHERE connection_key=?",
                (_now(), key),
            )
            for grant_row in self.conn.execute(
                "SELECT grant_id,record_json FROM platform_grants WHERE state='active'"
            ).fetchall():
                grant = json.loads(grant_row["record_json"])
                if grant.get("connection_ref") != connection_ref:
                    continue
                grant["active"] = False
                self.conn.execute(
                    "UPDATE platform_grants SET record_json=?,state='revoked',updated_at=?"
                    " WHERE grant_id=?",
                    (_json(grant), _now(), grant_row["grant_id"]),
                )
                self._audit("grant.revoked", "grant", grant_row["grant_id"])
            self._audit("connection.tombstoned", "connection", key)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return {**record, "state": "tombstoned"}

    def remove_adapter(self, adapter_lineage_id: str) -> dict:
        """Persist an immutable adapter tombstone and revoke its capabilities."""

        if not isinstance(adapter_lineage_id, str) or not adapter_lineage_id:
            raise ContractError("adapter_lineage_id is required")
        row = self.conn.execute(
            "SELECT adapter_id,record_json,state FROM platform_adapters WHERE adapter_lineage_id=?",
            (adapter_lineage_id,),
        ).fetchone()
        if row is None:
            raise RegistryError("adapter lineage is not registered")
        record = json.loads(row["record_json"])
        if row["state"] == "tombstoned":
            return {**record, "state": "tombstoned"}
        try:
            self.conn.execute("BEGIN IMMEDIATE")
            self.conn.execute(
                "UPDATE platform_adapters SET state='tombstoned',updated_at=?"
                " WHERE adapter_lineage_id=?",
                (_now(), adapter_lineage_id),
            )
            for action_row in self.conn.execute(
                "SELECT action_id,record_json FROM platform_actions WHERE state='registered'"
            ).fetchall():
                action = json.loads(action_row["record_json"])
                if action["owner_kind"] != "adapter" or action["owner_id"] != adapter_lineage_id:
                    continue
                self.conn.execute(
                    "UPDATE platform_actions SET state='tombstoned',updated_at=? WHERE action_id=?",
                    (_now(), action_row["action_id"]),
                )
                self._audit("action.tombstoned", "action", action_row["action_id"])
            for grant_row in self.conn.execute(
                "SELECT grant_id,record_json FROM platform_grants WHERE state='active'"
            ).fetchall():
                grant = json.loads(grant_row["record_json"])
                if grant["adapter_lineage_id"] != adapter_lineage_id:
                    continue
                grant["active"] = False
                self.conn.execute(
                    "UPDATE platform_grants SET record_json=?,state='revoked',updated_at=?"
                    " WHERE grant_id=?",
                    (_json(grant), _now(), grant_row["grant_id"]),
                )
                self._audit("grant.revoked", "grant", grant_row["grant_id"])
            self._audit("adapter.tombstoned", "adapter", adapter_lineage_id)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        self._invalidate_registry()
        return {**record, "state": "tombstoned"}

    def _invalidate_registry(self) -> None:
        self._registry_cache = None
        self._registry_cache_token = None

    # -- observed health ------------------------------------------------

    def observe_connection_health(self) -> dict:
        """Probe every registered Connection now, whatever it costs.

        The unbounded sweep, and the reason the read path can afford to be
        bounded. It belongs off the request path — a scheduled tick, a tray
        refresh, an owner asking — because that is the only place where waiting
        on a dead adapter's timeout costs nobody a response. `valkama doctor`
        and `valkama adapter check` already probe this way for their own
        report; this is the same observation, recorded where a read will find
        it.
        """

        rows = self.conn.execute(
            "SELECT connection_key,record_json,state FROM platform_connections"
            " ORDER BY connection_key"
        ).fetchall()
        # `within_ms=0` ignores freshness: the caller asked for an observation,
        # not for whatever is already known.
        observed = self._refresh_connection_health(rows, budget_ms=None, within_ms=0)
        # Health is not a row, so no commit moves `PRAGMA data_version` and a
        # cached registry would keep serving the states this just replaced.
        self._invalidate_registry()
        return {"observed": len(observed), "connections": observed}

    def _refresh_connection_health(
        self, rows, *, budget_ms: int | None, within_ms: int = health.FRESH_MS
    ) -> dict[str, str]:
        """Record what each registered Connection's provider says about itself."""

        # The provider's own bounded probe, held by Connection key. What the
        # sweep needs is the call, not the object that owns it.
        probes: dict[str, Callable[[], tuple[str, dict | None]]] = {}
        entries: list[tuple[str, int]] = []
        for row in rows:
            if row["state"] != "registered":
                continue
            record = json.loads(row["record_json"])
            key = str(row["connection_key"])
            try:
                provider = self.providers.resolve_connection(record["connection_ref"])
            except ProviderUnavailableError:
                # A persisted Connection whose provider this build does not
                # carry. Nothing to probe and nothing to wait for, so it is
                # recorded rather than skipped: `unavailable` is the answer.
                health.OBSERVED.record(
                    self.primary_db,
                    key,
                    "unavailable",
                    {
                        "code": "provider_unavailable",
                        "message": "no provider in this build answers for this Connection",
                    },
                )
                continue
            probes[key] = provider.health
            entries.append((key, int(provider.probe_ceiling_ms)))

        def probe(key: str) -> tuple[str, dict | None]:
            # `health` never raises by contract, and the transports are what
            # hold it to that: every way a call can fail is a typed state.
            return probes[key]()

        health.observe(self.primary_db, entries, probe, budget_ms=budget_ms, within_ms=within_ms)
        observed = {}
        for key in probes:
            observation = health.OBSERVED.read(self.primary_db, key)
            if observation is not None:
                observed[key] = observation.health
        return observed

    # -- registry reconstruction/read model -----------------------------

    def registry(self) -> PlatformRegistry:
        token = int(self.conn.execute("PRAGMA data_version").fetchone()[0])
        if self._registry_cache is not None and self._registry_cache_token == token:
            return self._registry_cache
        adapter_rows = self.conn.execute(
            "SELECT * FROM platform_adapters ORDER BY adapter_id"
        ).fetchall()
        lineages = [row["adapter_lineage_id"] for row in adapter_rows]
        lineage_iter = iter(lineages)
        registry = PlatformRegistry(
            scope_reader=self.scope_reader,
            lineage_factory=lineage_iter.__next__,
        )
        for row in self.conn.execute("SELECT record_json FROM platform_modules ORDER BY module_id"):
            registry.register_module(json.loads(row[0]))
        for row in self.conn.execute(
            "SELECT record_json FROM platform_services WHERE state='registered' ORDER BY service_key"
        ):
            registry.register_service(json.loads(row[0]))
        for row in adapter_rows:
            stored = json.loads(row["record_json"])
            manifest = {
                key: value
                for key, value in stored.items()
                if key not in {"adapter_lineage_id", "state"}
            }
            registered = registry.register_adapter(manifest)
            if registered["adapter_lineage_id"] != row["adapter_lineage_id"]:
                raise RegistryError("persisted adapter lineage ordering is invalid")
        connection_rows = self.conn.execute(
            "SELECT connection_key,record_json,state FROM platform_connections"
            " ORDER BY connection_key"
        ).fetchall()
        if self.observe_health:
            self._refresh_connection_health(connection_rows, budget_ms=health.READ_PROBE_BUDGET_MS)
        for row in connection_rows:
            record = json.loads(row["record_json"])
            if self.observe_health and row["state"] == "registered":
                # Last known rather than freshly probed. A read spends the
                # allowance in `health` and no more, so a Connection nobody
                # could afford to probe keeps the answer it last gave — and
                # `not-observed`, which is what it was seeded with, is the
                # grammar's own word for never having been asked. Trust and
                # ownership remain exactly the persisted owner decision.
                observation = health.OBSERVED.read(self.primary_db, str(row["connection_key"]))
                if observation is not None:
                    record["health"] = observation.health
                    if observation.diagnostics is not None:
                        record["diagnostics"] = observation.diagnostics
                    else:
                        record.pop("diagnostics", None)
            registry.register_connection(record)
        for row in self.conn.execute(
            "SELECT record_json FROM platform_assignments ORDER BY assignment_id"
        ):
            registry.register_assignment(json.loads(row[0]))
        for row in self.conn.execute(
            "SELECT grant_id,record_json,state FROM platform_grants ORDER BY grant_id"
        ):
            record = json.loads(row["record_json"])
            if row["state"] == "active":
                registry.grant_permission(record)
            else:
                registry.revoked_grants[row["grant_id"]] = {
                    "grant_id": row["grant_id"],
                    "state": "revoked",
                    "grant": record,
                }
        for row in self.conn.execute(
            "SELECT record_json FROM platform_core_ref_bindings WHERE state='registered' ORDER BY core_ref_kind"
        ):
            binding = json.loads(row[0])
            registry.bind_core_ref_resolver(
                binding["core_ref_kind"],
                binding["service_ref"],
                binding["adapter_lineage_id"],
                binding["connection_id"],
                binding_version=binding["binding_version"],
            )
        for row in self.conn.execute(
            "SELECT record_json FROM platform_action_inputs ORDER BY action_id"
        ):
            registry.register_action_input(json.loads(row[0]))
        for row in connection_rows:
            if row["state"] == "tombstoned":
                registry.remove_connection(json.loads(row["record_json"])["connection_ref"])
        for row in adapter_rows:
            if row["state"] == "tombstoned":
                registry.remove_adapter(row["adapter_lineage_id"])
        self._registry_cache = registry
        self._registry_cache_token = token
        return registry

    def modules_payload(self) -> dict:
        return modules_payload(self.conn)

    def require_module_enabled(self, module_id: str) -> None:
        require_module_enabled(self.conn, module_id)

    def module_state_command(self, payload: dict) -> dict:
        self._exact_object(
            payload,
            ("module_id", "state", "expected_revision"),
            required=("module_id", "state", "expected_revision"),
        )
        module_id = payload["module_id"]
        state = payload["state"]
        expected_revision = payload["expected_revision"]
        if not isinstance(module_id, str) or not module_id:
            raise ContractError("module_id is required")
        if state not in {"enabled", "disabled"}:
            raise ContractError("state must be enabled or disabled")
        if (
            not isinstance(expected_revision, int)
            or isinstance(expected_revision, bool)
            or expected_revision <= 0
        ):
            raise ContractError("expected_revision must be a positive integer")
        with platform_modules.module_state_fence(self.primary_db, module_id):
            try:
                self.conn.execute("BEGIN IMMEDIATE")
                registrations = self.modules_payload()["modules"]
                registration = next(
                    (item for item in registrations if item["manifest"]["module_id"] == module_id),
                    None,
                )
                if registration is None:
                    raise PlatformHttpError(
                        404, "unavailable", "Module registration is unavailable"
                    )
                if module_id == "settings" or not registration["mutable"]:
                    raise PlatformHttpError(409, "unavailable", "Module state is immutable")
                now = _now()
                cursor = self.conn.execute(
                    "UPDATE platform_modules SET state=?,revision=revision+1,updated_at=?"
                    " WHERE module_id=? AND revision=?",
                    (state, now, module_id, expected_revision),
                )
                if cursor.rowcount != 1:
                    raise PlatformHttpError(409, "unavailable", "Module revision changed")
                self._audit("module.state-changed", "module", module_id, {"state": state})
                registration = next(
                    item
                    for item in self.modules_payload()["modules"]
                    if item["manifest"]["module_id"] == module_id
                )
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise
            platform_modules.notify_state_changed(self.primary_db, module_id, state)
        return {"interface_version": MODULES_INTERFACE, "module": registration}

    def _project(self, project_id: str) -> dict:
        matches = [item for item in self.projects if item["project_id"] == project_id]
        if len(matches) != 1:
            raise PlatformHttpError(404, "unavailable", "Project is not registered")
        return matches[0]

    def _project_directory_item(self, project: dict) -> dict:
        resources = []
        resource_ref = project["planning_binding"]
        if resource_ref is not None:
            resolution = self.scope_reader.resolve(project["project_id"], resource_ref)
            entry = {"resource_ref": resource_ref, "state": resolution.state}
            if resolution.state != "mapped":
                entry["reason"] = _reason_code(resolution)
            resources.append(entry)
        return {
            "project_id": project["project_id"],
            "title": project["display_name"],
            "binding_state": self._binding_state(resources),
            "resources": resources,
        }

    @staticmethod
    def _binding_state(resources: list[dict]) -> str:
        states = [str(resource["state"]) for resource in resources]
        if not states:
            return "unbound"
        priority = ("ambiguous", "stale", "detached", "unavailable", "unbound", "mapped")
        return next(state for state in priority if state in states)

    def _validated_ui_prefs(self, value) -> dict:
        self._exact_object(
            value,
            ("module_id", "scope", "resource_ref"),
            required=("module_id", "scope"),
        )
        module_id = value["module_id"]
        registrations = self.modules_payload()["modules"]
        known = {record["manifest"]["module_id"] for record in registrations}
        if not isinstance(module_id, str) or module_id not in known:
            raise PlatformHttpError(400, "error", "UI preference names an unknown module")
        prefs = {
            "module_id": module_id,
            "scope": validate_operating_scope(value["scope"]),
        }
        if "resource_ref" in value:
            prefs["resource_ref"] = validate_entity_ref(value["resource_ref"])
        return prefs

    def ui_prefs_record(self) -> dict | None:
        """Last-route preference, or None when unset or unreadable."""

        row = self.conn.execute(
            "SELECT record_json FROM platform_ui_prefs WHERE key='last-route'"
        ).fetchone()
        if row is None:
            return None
        try:
            return self._validated_ui_prefs(json.loads(str(row[0])))
        except Exception:  # noqa: BLE001 -- a corrupt row must never break the shell context
            return None

    def save_ui_prefs(self, payload) -> dict:
        self._exact_object(
            payload,
            ("interface_version", "module_id", "scope", "resource_ref"),
            required=("interface_version", "module_id", "scope"),
        )
        if payload["interface_version"] != UI_PREFS_INTERFACE:
            raise PlatformHttpError(400, "error", "UI preference payload version is not supported")
        prefs = self._validated_ui_prefs(
            {key: value for key, value in payload.items() if key != "interface_version"}
        )
        self.conn.execute(
            "INSERT INTO platform_ui_prefs(key,record_json,updated_at)"
            " VALUES('last-route',?,?)"
            " ON CONFLICT(key) DO UPDATE SET"
            " record_json=excluded.record_json, updated_at=excluded.updated_at",
            (_json(prefs), _now()),
        )
        self.conn.commit()
        return {"interface_version": UI_PREFS_INTERFACE, "prefs": prefs}

    def context_payload(self, parameters: Mapping[str, list[str]]) -> dict:
        scope = self._scope_parameters(parameters)
        payload = {
            "primary": {
                "data_scope_id": self.metadata["data_scope_id"],
                "is_writable": True,
            },
            "projects": [self._project_directory_item(item) for item in self.projects],
            "ui_prefs": self.ui_prefs_record(),
        }
        if self.projects_result["status"] != "available":
            state = _ui("unavailable", reason="Project registry is unavailable")
        elif scope["kind"] == "project":
            self._project(scope["project_ref"]["project_id"])
            state = _ui("ready", payload=payload)
        else:
            state = _ui("ready", payload=payload)
        return {"interface_version": CONTEXT_INTERFACE, "scope": scope, "state": state}

    def registry_payload(self, parameters: Mapping[str, list[str]]) -> dict:
        scope = self._scope_parameters(parameters)
        if scope["kind"] == "project":
            self._project(scope["project_ref"]["project_id"])
        registry = self.registry()
        scope_identity = _scope_key(scope)
        assignments = []
        assignment_records = []
        assignment_revisions: dict[str, int] = {}
        for row in self.conn.execute(
            "SELECT record_json,state,revision FROM platform_assignments ORDER BY assignment_id"
        ):
            record = json.loads(row["record_json"])
            assignment_scope = record["scope"]
            if (scope["kind"] == "global" and assignment_scope["kind"] == "installation") or (
                scope["kind"] == "project"
                and (
                    assignment_scope["kind"] == "installation"
                    or assignment_scope.get("project_id") == scope["project_ref"]["project_id"]
                )
            ):
                assignment_records.append(record)
                assignment_revisions[record["assignment_id"]] = int(row["revision"])
                assignments.append(self._assignment_presentation(record, int(row["revision"])))
        grants = []
        for row in self.conn.execute(
            "SELECT record_json,state FROM platform_grants ORDER BY grant_id"
        ):
            record = json.loads(row["record_json"])
            if scope["kind"] == "global" or _scope_key(record["applicability"]) == scope_identity:
                grants.append(
                    {
                        **record,
                        "active": row["state"] == "active" and bool(record.get("active", True)),
                        "state": row["state"],
                    }
                )
        connections = []
        connection_records = []
        observed_at = _now()
        for row in self.conn.execute(
            "SELECT record_json,state FROM platform_connections ORDER BY connection_key"
        ):
            stored = json.loads(row["record_json"])
            record = (
                registry.get_connection(stored["connection_ref"])
                if row["state"] == "registered"
                else stored
            )
            record = {**record, "state": row["state"]}
            applicability = record["applicability"]
            if (
                scope["kind"] == "global"
                or applicability["kind"] == "global"
                or _scope_key(applicability) == scope_identity
            ):
                connection_records.append(deepcopy(record))
                ref = record["connection_ref"]
                adapter_row = self.conn.execute(
                    "SELECT record_json FROM platform_adapters WHERE adapter_lineage_id=?",
                    (ref["adapter_lineage_id"],),
                ).fetchone()
                service_row = self.conn.execute(
                    "SELECT record_json FROM platform_services WHERE service_key=?",
                    (_service_key(ref["service_ref"]),),
                ).fetchone()
                adapter = json.loads(adapter_row[0]) if adapter_row is not None else {}
                service = json.loads(service_row[0]) if service_row is not None else {}
                try:
                    transport = self.providers.resolve_connection(ref).transport
                except ProviderUnavailableError:
                    transport = {
                        "local_process": "local-process",
                        "local_service": "loopback-http",
                        "built_in": "built-in",
                    }.get(str(adapter.get("execution") or ""), "built-in")
                connections.append(
                    {
                        **deepcopy(record),
                        "name": service.get("title_key", ref["service_ref"]["service_id"]),
                        "service": {
                            "owner_id": ref["service_ref"]["owner_id"],
                            "service_id": ref["service_ref"]["service_id"],
                            "title_key": service.get("title_key", ref["service_ref"]["service_id"]),
                            "service_type": service.get("service_type", "unknown"),
                        },
                        "transport": transport,
                        "capabilities": list(adapter.get("capabilities", [])),
                        "scope": deepcopy(applicability),
                        # When the state being shown was actually observed, not
                        # when this payload was built. They were the same value
                        # while every read probed; now a read may serve a state
                        # from earlier, and saying so is the whole point of
                        # serving it.
                        "last_checked_at": _last_checked_at(self.primary_db, ref, row["state"]),
                        "observed_at": observed_at,
                    }
                )
        adapters = []
        for row in self.conn.execute(
            "SELECT record_json,state FROM platform_adapters ORDER BY adapter_id"
        ):
            record = json.loads(row["record_json"])
            record.pop("contributions", None)
            adapters.append({**record, "state": row["state"]})
        services = [
            json.loads(row[0])
            for row in self.conn.execute(
                "SELECT record_json FROM platform_services ORDER BY service_key"
            )
        ]
        packages = [
            json.loads(row[0])
            for row in self.conn.execute(
                "SELECT record_json FROM platform_packages WHERE state='registered' ORDER BY package_key"
            )
        ]
        actions = [
            json.loads(row[0])
            for row in self.conn.execute(
                "SELECT record_json FROM platform_actions WHERE state='registered' ORDER BY action_id"
            )
        ]
        action_inputs = [
            json.loads(row[0])
            for row in self.conn.execute(
                "SELECT i.record_json FROM platform_action_inputs i"
                " JOIN platform_actions a ON a.action_id=i.action_id"
                " WHERE a.state='registered' ORDER BY i.action_id"
            )
        ]
        core_bindings = [
            json.loads(row[0])
            for row in self.conn.execute(
                "SELECT record_json FROM platform_core_ref_bindings WHERE state='registered' ORDER BY core_ref_kind"
            )
        ]
        audit_ids = {
            *(record["assignment_id"] for record in assignments),
            *(record["grant_id"] for record in grants),
        }
        audit = []
        for row in self.conn.execute(
            "SELECT sequence,event_kind,entity_kind,entity_id,detail_json,at"
            " FROM platform_registry_audit ORDER BY sequence DESC LIMIT 200"
        ):
            if row["entity_kind"] in {"assignment", "grant"} and row["entity_id"] not in audit_ids:
                continue
            item = dict(row)
            item["detail"] = json.loads(item.pop("detail_json"))
            detail_scope = item["detail"].get("invocation_scope")
            if (
                scope["kind"] == "project"
                and detail_scope is not None
                and _scope_key(detail_scope) != scope_identity
            ):
                continue
            audit.append(item)
            if len(audit) >= 100:
                break
        capability_resolutions = []
        for capability_id in sorted(CAPABILITY_DEFINITIONS):
            resolution = resolve_capability(
                capability_id,
                project_id=(
                    scope["project_ref"]["project_id"] if scope["kind"] == "project" else None
                ),
                assignments=assignment_records,
                connections=connection_records,
            )
            if "assignment" in resolution:
                record = resolution["assignment"]
                resolution["assignment"] = self._assignment_presentation(
                    record, assignment_revisions[record["assignment_id"]]
                )
            capability_resolutions.append(resolution)
        ready = {
            "modules": self.modules_payload()["modules"],
            "services": services,
            "adapters": adapters,
            "connections": connections,
            "assignments": assignments,
            "capabilities": capability_resolutions,
            "grants": grants,
            "packages": packages,
            "actions": actions,
            "action_inputs": action_inputs,
            "core_ref_bindings": core_bindings,
            "audit": audit,
        }
        return {
            "interface_version": REGISTRY_INTERFACE,
            "scope": scope,
            "state": _ui("ready", payload=ready),
        }

    # -- exact planning reads ------------------------------------------

    def planning_payload(self, parameters: Mapping[str, list[str]]) -> dict:
        """The Kernel's directory: which project binds which space, and how full.

        What is *in* a space is Planning's own boundary to answer. This one
        exists so global scope can list projects and spaces without every module
        learning the Planning read model.
        """

        scope = self._scope_parameters(parameters, project_extras=("data_scope_id", "space_key"))
        if self.projects_result["status"] != "available":
            return {
                "interface_version": PLANNING_INTERFACE,
                "scope": scope,
                "state": _ui("unavailable", reason="Project registry is unavailable"),
            }
        if scope["kind"] == "global":
            projects = [self._planning_project(item) for item in self.projects]
            spaces = []
            for project in self.projects:
                binding = project["planning_binding"]
                if binding is not None:
                    space_ref = planning_space_ref(binding)
                    resolution = self.scope_reader.resolve(project["project_id"], binding)
                    if resolution.mapped:
                        spaces.append(self._space_view(space_ref))
            state = (
                _ui("ready", payload={"projects": projects, "planning_spaces": spaces})
                if projects
                else _ui("empty", reason="platform.planning.noSpaces")
            )
            return {"interface_version": PLANNING_INTERFACE, "scope": scope, "state": state}
        project_id = scope["project_ref"]["project_id"]
        project = self._project(project_id)
        space_ref = self._space_ref_parameters(parameters)
        self._require_mapping(project_id, space_ref)
        space = self._space_view(space_ref)
        state = (
            _ui(
                "ready",
                payload={
                    "projects": [self._planning_project(project)],
                    "planning_spaces": [space],
                },
            )
            if space["work_items"]
            else _ui("empty", reason="platform.planning.empty")
        )
        return {"interface_version": PLANNING_INTERFACE, "scope": scope, "state": state}

    def _planning_project(self, project: dict) -> dict:
        directory = self._project_directory_item(project)
        planning_resources = [
            item
            for item in directory["resources"]
            if item["resource_ref"]["kind"] == "planning-space"
        ]
        binding_state = self._binding_state(planning_resources)
        spaces = []
        for item in planning_resources:
            if item["state"] != "mapped":
                continue
            space_ref = planning_space_ref(item["resource_ref"])
            with self._store_connection(space_ref) as store:
                row = store.execute(
                    "SELECT p.name, COUNT(w.work_item_id) AS held FROM planning_spaces p"
                    " LEFT JOIN work_items w ON w.planning_space_id = p.planning_space_id"
                    " WHERE p.key = ? GROUP BY p.planning_space_id",
                    (space_ref["space_key"],),
                ).fetchone()
            spaces.append(
                {
                    "space_ref": space_ref,
                    # The display name is the space's own, kept apart from its
                    # identity: renaming it must not move a single binding.
                    "title": str(row["name"]) if row else space_ref["space_key"],
                    "work_item_count": int(row["held"]) if row else 0,
                }
            )
        return {
            "project_id": project["project_id"],
            "title": project["display_name"],
            "binding_state": binding_state,
            "planning_spaces": spaces,
        }

    def _space_view(self, space_ref: dict) -> dict:
        """One space, summarised. The Kernel names items; it does not group them.

        The Board era answered here with cards already sorted into six lanes,
        which is why Kanban was the model rather than one view of it.
        """

        with self._store_connection(space_ref) as store:
            space = store.execute(
                "SELECT planning_space_id, name FROM planning_spaces WHERE key = ?",
                (space_ref["space_key"],),
            ).fetchone()
            if space is None:
                raise PlatformHttpError(
                    409, "unavailable", "Exact Project planning space is unavailable"
                )
            work_items = [
                {
                    "work_item_ref": {
                        "space_ref": space_ref,
                        "reference": f"{space_ref['space_key']}-{int(row['number'])}",
                    },
                    "title": row["title"],
                    "state_key": row["state_key"],
                    "state_category": row["category"],
                    "priority": row["priority"],
                    "labels": json.loads(row["labels"]),
                    "claim_ref": row["claim_ref"],
                    "revision": int(row["revision"]),
                    "updated_at": row["updated_at"],
                }
                for row in store.execute(
                    "SELECT w.number, w.title, w.priority, w.labels, w.claim_ref, w.revision,"
                    " w.updated_at, s.key AS state_key, s.category"
                    " FROM work_items w JOIN workflow_states s ON s.state_id = w.state_id"
                    " WHERE w.planning_space_id = ? ORDER BY s.position, w.position, w.number",
                    (str(space["planning_space_id"]),),
                )
            ]
        return {
            "space_ref": space_ref,
            "title": str(space["name"]),
            "work_items": work_items,
        }

    def planning_read_model(
        self,
        parameters: Mapping[str, list[str]],
        loader: Callable[[sqlite3.Connection, str], dict],
    ) -> dict:
        """Read Planning's model through the exact owner binding and store.

        Planning owns the model; the Kernel owns which connection may answer.
        Attached connections are opened read-only by the shared store resolver.
        """

        if set(parameters) != {"project", "data_scope_id", "space_key"}:
            raise PlatformHttpError(400, "error", "Exact Planning query fields are required")
        project_id = self._one(parameters, "project")
        self._project(project_id)
        space_ref = self._space_ref_parameters(parameters)
        self._require_mapping(project_id, space_ref)
        with self._store_connection(space_ref) as store:
            return loader(store, space_ref["space_key"])

    def planning_work_item_payload(
        self,
        parameters: Mapping[str, list[str]],
        item_loader: Callable[[sqlite3.Connection, str], dict],
    ) -> dict:
        """One work item, plus the Kernel relations attached to it.

        The record itself comes from Planning's own service through the loader;
        this method owns scope, binding and the relation read model, which are
        the three things Planning must not have to know about.
        """

        scope = self._scope_parameters(
            parameters, project_extras=("data_scope_id", "space_key", "reference")
        )
        if scope["kind"] != "project":
            raise PlatformHttpError(400, "error", "Work item reads require exact Project scope")
        project_id = scope["project_ref"]["project_id"]
        self._project(project_id)
        space_ref = self._space_ref_parameters(parameters)
        self._require_mapping(project_id, space_ref)
        work_item_ref = validate_work_item_ref(
            {"space_ref": space_ref, "reference": self._one(parameters, "reference")}
        )
        with self._store_connection(space_ref) as store:
            try:
                work_item = item_loader(store, work_item_ref["reference"])
            except (ValueError, KeyError) as error:
                raise PlatformHttpError(
                    404, "unavailable", "Exact work item is unavailable"
                ) from error
            relations = read_relations(
                store, work_item_ref, registry=self.registry(), invocation_scope=scope
            )
        return {
            "interface_version": PLANNING_WORK_ITEM_INTERFACE,
            "scope": scope,
            "work_item_ref": work_item_ref,
            "state": _ui(
                "ready",
                payload={
                    "work_item": work_item,
                    "relations": {
                        "interface_version": "valkama-relations",
                        "relations": relations,
                    },
                },
            ),
        }

    # -- authorized provider actions -----------------------------------

    def relation_command(self, payload: dict) -> dict:
        allowed = {
            "interface_version",
            "operation",
            "entity_ref",
            "resource_ref",
            "invocation_context",
            "action_ref",
            "expected_revision",
            "fallback_label",
            "confirmation",
        }
        self._exact_object(payload, allowed, required=allowed - {"fallback_label"})
        if payload["interface_version"] != RELATION_COMMAND_INTERFACE:
            raise ContractError("invalid Platform relation command interface")
        if payload["confirmation"] is not True:
            raise ContractError("required action confirmation must be true")
        operation = payload["operation"]
        if operation not in {"attach", "remove"}:
            raise ContractError("relation operation must be attach or remove")
        work_item_ref, resource, context, action, provider, registry = (
            self._authorize_provider_action(
                payload["entity_ref"],
                payload["resource_ref"],
                payload["invocation_context"],
                payload["action_ref"],
                operation,
            )
        )
        permission = provider.permission_for(action["action_id"])
        grant = registry.authorize(
            context,
            permission,
            connection_ref=resource["connection_ref"],
            adapter_lineage_id=provider.adapter_lineage_id,
        )
        self._require_work_item_data_scope_grant(work_item_ref, grant)
        descriptor = registry.get_action_input(action["action_id"])
        if descriptor is None or descriptor.get("confirmation") != "required":
            raise ContractError("action confirmation descriptor is unavailable")
        provenance = {"source_kind": "platform", "observed_at": _now()}
        if operation == "attach":
            self._validate_pending_relation(
                work_item_ref,
                resource,
                registry,
                payload.get("fallback_label", resource["external_id"]),
                provenance,
            )

        def audit() -> None:
            # Reconstruct/re-authorize inside the mutation transaction. If an
            # owner revokes trust, assignment, or grant between the first check
            # and BEGIN IMMEDIATE, the link/event/revision all roll back.
            current_registry = self.registry()
            current_grant = current_registry.authorize(
                context,
                permission,
                connection_ref=resource["connection_ref"],
                adapter_lineage_id=provider.adapter_lineage_id,
            )
            self._require_work_item_data_scope_grant(work_item_ref, current_grant)
            self._audit(
                "action.invoked",
                "action",
                action["action_id"],
                self._authorization_audit_detail(
                    work_item_ref,
                    context,
                    resource,
                    provider.adapter_lineage_id,
                    permission,
                    current_grant,
                    current_registry,
                ),
            )

        if operation == "attach":
            result = add_adapter_link(
                self.conn,
                work_item_ref,
                resource,
                expected_revision=payload["expected_revision"],
                fallback_label=payload.get("fallback_label", resource["external_id"]),
                provenance=provenance,
                before_commit=audit,
            )
            relation = next(
                item
                for item in read_relations(
                    self.conn,
                    work_item_ref,
                    registry=registry,
                    invocation_scope=context["invocation_scope"],
                )
                if item["target"] == resource
            )
            response = {
                "interface_version": RELATION_RESULT_INTERFACE,
                "operation": operation,
                "entity_ref": planning_work_item_entity(work_item_ref),
                "work_item_revision": result["work_item_revision"],
                "relation": relation,
            }
        else:
            result = remove_adapter_link(
                self.conn,
                work_item_ref,
                resource,
                expected_revision=payload["expected_revision"],
                before_commit=audit,
            )
            response = {
                "interface_version": RELATION_RESULT_INTERFACE,
                "operation": operation,
                "entity_ref": planning_work_item_entity(work_item_ref),
                "work_item_revision": result["work_item_revision"],
                "removed": True,
            }
        return response

    def invoke_action(self, payload: dict) -> dict:
        required = {
            "interface_version",
            "action_ref",
            "invocation_context",
            "input",
            "confirmation",
        }
        self._exact_object(payload, required, required=required)
        if payload["interface_version"] != ACTION_COMMAND_INTERFACE:
            raise ContractError("invalid Platform action command interface")
        if payload["confirmation"] is not True:
            raise ContractError("required action confirmation must be true")
        input_value = payload["input"]
        self._exact_object(
            input_value, {"entity_ref", "resource_ref"}, required={"entity_ref", "resource_ref"}
        )
        work_item_ref, resource, context, action, provider, registry = (
            self._authorize_provider_action(
                input_value["entity_ref"],
                input_value["resource_ref"],
                payload["invocation_context"],
                payload["action_ref"],
                "open",
            )
        )
        descriptor = registry.get_action_input(action["action_id"])
        if descriptor is None or descriptor.get("confirmation") != "required":
            raise ContractError("action confirmation descriptor is unavailable")
        if not self._resource_linked(work_item_ref, resource):
            raise PlatformHttpError(
                409, "unavailable", "External resource is not linked to this Card"
            )
        grant = registry.authorize(
            context,
            provider.permission_for(action["action_id"]),
            connection_ref=resource["connection_ref"],
            adapter_lineage_id=provider.adapter_lineage_id,
        )
        self._require_work_item_data_scope_grant(work_item_ref, grant)
        target = provider.open_target(resource)
        try:
            self._audit(
                "action.invoked",
                "action",
                action["action_id"],
                self._authorization_audit_detail(
                    work_item_ref,
                    context,
                    resource,
                    provider.adapter_lineage_id,
                    provider.permission_for(action["action_id"]),
                    grant,
                    registry,
                ),
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        return {
            "interface_version": ACTION_RESULT_INTERFACE,
            "action_ref": action,
            "entity_ref": planning_work_item_entity(work_item_ref),
            "target": {"target_kind": target["target_kind"], "uri": target["uri"]},
            "presentation": {"label": resource["external_id"]},
        }

    @staticmethod
    def _require_work_item_data_scope_grant(work_item_ref: dict, grant: dict) -> None:
        if work_item_ref["space_ref"]["data_scope_id"] not in grant["data_scope_ids"]:
            raise ScopeMismatchError("exact Card data scope is outside the PermissionGrant")

    @staticmethod
    def _validate_pending_relation(
        work_item_ref: dict,
        resource: dict,
        registry: PlatformRegistry,
        label: object,
        provenance: dict,
    ) -> None:
        lineage = resource["connection_ref"]["adapter_lineage_id"]
        adapter = registry.get_adapter(lineage)
        if adapter is None or adapter.get("state") == "tombstoned":
            raise PermissionDeniedError("relation adapter is unavailable")
        actions = [
            action
            for action in registry.list_actions()
            if action["owner_kind"] == "adapter"
            and action["owner_id"] == lineage
            and registry.operation_for_action(action["action_id"]) in {"open", "remove"}
        ]
        validate_relation(
            {
                "interface_version": "valkama-relations",
                "relation_id": "pending",
                "source": planning_work_item_entity(work_item_ref),
                "kind": "external-resource",
                "target": resource,
                "provider": {
                    "service_ref": resource["connection_ref"]["service_ref"],
                    "adapter_id": adapter["adapter_id"],
                    "adapter_lineage_id": lineage,
                    "adapter_version": adapter["version"],
                    "connection_id": resource["connection_ref"]["connection_id"],
                },
                "state": "resolved",
                "provenance": provenance,
                "presentation": {"label": label},
                "actions": actions,
            }
        )

    def _authorization_audit_detail(
        self,
        work_item_ref: dict,
        context: dict,
        resource: dict,
        adapter_lineage_id: str,
        permission_id: str,
        grant: dict,
        registry: PlatformRegistry,
    ) -> dict:
        project_id = context["invocation_scope"]["project_ref"]["project_id"]
        resolution = self.scope_reader.binding_for_work_item(work_item_ref, project_id)
        if not resolution.mapped or resolution.binding is None:
            raise ScopeMismatchError("authorization lost its exact current Project binding")
        assignment = registry.resolved_assignment_for_connection(
            adapter_lineage_id,
            context["invocation_scope"],
            resource["connection_ref"],
        )
        assignment_row = self.conn.execute(
            "SELECT revision FROM platform_assignments WHERE assignment_id=?",
            (assignment["assignment_id"],),
        ).fetchone()
        if assignment_row is None:
            raise PermissionDeniedError("authorization assignment decision is unavailable")
        connection = registry.get_connection(resource["connection_ref"])
        if connection is None:
            raise MissingConnectionError("authorization connection decision is unavailable")
        binding = resolution.binding
        return {
            "view_scope": context["view_scope"],
            "invocation_scope": context["invocation_scope"],
            "target": resource,
            "binding": {
                "project_id": binding["project_id"],
                "resource_ref": binding["resource_ref"],
            },
            "decision": {
                "permission_id": permission_id,
                "adapter_lineage_id": adapter_lineage_id,
                "connection_ref": resource["connection_ref"],
                "connection_state": connection["state"],
                "connection_trust": connection["trust"],
                "connection_health": connection["health"],
                "assignment_id": assignment["assignment_id"],
                "assignment_revision": assignment_row["revision"],
                "grant_id": grant["grant_id"],
                "grant_revision": grant["revision"],
            },
        }

    def _authorize_provider_action(
        self, entity_value, resource_value, context_value, action_value, operation
    ):
        entity_ref = validate_entity_ref(entity_value)
        work_item_ref = planning_work_item_ref(entity_ref)
        resource = validate_adapter_resource_ref(resource_value)
        context = validate_invocation_context(context_value)
        action = validate_action_ref(action_value)
        if context["target"] != resource:
            raise PermissionDeniedError("InvocationContext target must equal the exact resource")
        if context["invocation_scope"]["kind"] != "project":
            raise ScopeMismatchError(
                "external resource actions require exact Project invocation scope"
            )
        project_id = context["invocation_scope"]["project_ref"]["project_id"]
        if context["view_scope"]["kind"] == "project" and (
            context["view_scope"]["project_ref"]["project_id"] != project_id
        ):
            raise ScopeMismatchError("view Project does not match invocation Project")
        self._project(project_id)
        self._require_mapping(project_id, work_item_ref["space_ref"])
        if work_item_ref["space_ref"]["data_scope_id"] != self.metadata["data_scope_id"]:
            raise PlatformHttpError(
                409, "unavailable", "Attached stores are read-only for relations"
            )
        if (
            self.conn.execute(
                "SELECT 1 FROM work_items w"
                " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
                " WHERE p.key = ? AND w.number = ?",
                (
                    work_item_ref["space_ref"]["space_key"],
                    int(work_item_ref["reference"].split("-", 1)[1]),
                ),
            ).fetchone()
            is None
        ):
            raise PlatformHttpError(404, "unavailable", "Exact Card is unavailable")
        provider = self.providers.resolve(resource)
        expected = provider.action_ref(operation)
        if action != expected:
            raise PermissionDeniedError("ActionRef does not match the provider operation")
        registry = self.registry()
        if registry.get_action(action["action_id"]) != action:
            raise PermissionDeniedError("ActionRef is not registered")
        return work_item_ref, resource, context, action, provider, registry

    def _resource_linked(self, work_item_ref: dict, resource: dict) -> bool:
        ref = resource["connection_ref"]
        row = self.conn.execute(
            """SELECT 1 FROM platform_adapter_links l
               JOIN work_items w ON w.work_item_id = l.work_item_id
               JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id
               WHERE l.data_scope_id=? AND l.space_key=? AND p.key=? AND w.number=?
                 AND service_owner_id=? AND service_id=? AND adapter_lineage_id=?
                 AND connection_id=? AND resource_type=? AND external_id=?""",
            (
                work_item_ref["space_ref"]["data_scope_id"],
                work_item_ref["space_ref"]["space_key"],
                work_item_ref["space_ref"]["space_key"],
                int(work_item_ref["reference"].split("-", 1)[1]),
                ref["service_ref"]["owner_id"],
                ref["service_ref"]["service_id"],
                ref["adapter_lineage_id"],
                ref["connection_id"],
                resource["resource_type"],
                resource["external_id"],
            ),
        ).fetchone()
        if row is not None:
            return True
        binding = self.registry().resolve_core_ref(resource["resource_type"])
        if binding is None:
            return False
        if (
            binding["service_ref"] != ref["service_ref"]
            or binding["adapter_lineage_id"] != ref["adapter_lineage_id"]
            or binding["connection_id"] != ref["connection_id"]
        ):
            return False
        return (
            self.conn.execute(
                "SELECT 1 FROM work_item_refs r"
                " JOIN work_items w ON w.work_item_id = r.work_item_id"
                " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
                " WHERE p.key=? AND w.number=? AND r.kind=? AND r.value=?",
                (
                    work_item_ref["space_ref"]["space_key"],
                    int(work_item_ref["reference"].split("-", 1)[1]),
                    resource["resource_type"],
                    resource["external_id"],
                ),
            ).fetchone()
            is not None
        )

    # -- exact scope/store helpers -------------------------------------

    def _require_mapping(self, project_id: str, space_ref: dict) -> BindingResolution:
        resolution = self.scope_reader.resolve(project_id, planning_space_entity(space_ref))
        if not resolution.mapped:
            raise PlatformHttpError(409, "unavailable", _reason_code(resolution))
        return resolution

    @contextlib.contextmanager
    def _store_connection(self, space_ref: dict):
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

    def _scope_parameters(
        self, parameters: Mapping[str, list[str]], *, project_extras: tuple[str, ...] = ()
    ) -> dict:
        scope_kind = self._one(parameters, "scope_kind")
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
                "project_ref": {"project_id": self._one(parameters, "project_id")},
            }
        )

    def _space_ref_parameters(self, parameters: Mapping[str, list[str]]) -> dict:
        return validate_planning_space_ref(
            {
                "data_scope_id": self._one(parameters, "data_scope_id"),
                "space_key": self._one(parameters, "space_key"),
            }
        )

    @staticmethod
    def _one(parameters: Mapping[str, list[str]], key: str) -> str:
        values = parameters.get(key)
        if (
            not isinstance(values, list)
            or len(values) != 1
            or not isinstance(values[0], str)
            or not values[0]
        ):
            raise PlatformHttpError(400, "error", f"{key} must occur exactly once")
        return values[0]

    @staticmethod
    def _exact_object(value, allowed, *, required) -> None:
        if (
            not isinstance(value, dict)
            or set(value) - set(allowed)
            or not set(required) <= set(value)
        ):
            raise ContractError("request body has missing or unknown fields")


def error_response(error: Exception) -> tuple[int, dict]:
    if isinstance(error, PlatformHttpError):
        return error.status, _ui(error.state, reason=error.reason)
    if isinstance(error, (PermissionDeniedError, RevokedPermissionError)):
        return 403, _ui("permission-denied", reason="Action is not authorized")
    if isinstance(
        error,
        (
            ScopeMismatchError,
            MissingConnectionError,
            ProviderUnavailableError,
            # A transport that did not produce an answer is the adapter being
            # unavailable, whatever the code on it. It reached here as a generic
            # 500 before, because `TransportError` is neither a provider error
            # nor a contract error and nothing named it.
            TransportError,
            RelationRevisionConflictError,
            RelationConflictError,
        ),
    ):
        return 409, _ui("unavailable", reason="Requested Platform resource is unavailable")
    if isinstance(
        error, (ContractError, ProviderError, RelationError, RegistryError, TypeError, ValueError)
    ):
        return 400, _ui("error", reason="Platform request is invalid")
    return 500, _ui("error", reason="Platform operation failed")


def handle_get(
    conn: sqlite3.Connection,
    primary_db: str,
    path: str,
    parameters: Mapping[str, list[str]],
    *,
    item_loader: Callable[[sqlite3.Connection, str], dict] | None = None,
    registry_reader: project_registry.RegistryReader | None = None,
    providers: ProviderCatalog | None = None,
) -> tuple[int, dict] | None:
    if (
        path != "/api/modules"
        and path != "/api/modules/planning/work-item"
        and not path.startswith("/api/platform/")
    ):
        return None
    platform = Platform(
        conn,
        primary_db,
        registry_reader=registry_reader,
        providers=providers,
    )
    if path == "/api/modules":
        if parameters:
            raise PlatformHttpError(400, "error", "Module registry accepts no query fields")
        return 200, platform.modules_payload()
    if path == "/api/platform/context":
        return 200, platform.context_payload(parameters)
    if path == "/api/platform/registry":
        return 200, platform.registry_payload(parameters)
    if path == "/api/platform/planning":
        platform.require_module_enabled("planning")
        return 200, platform.planning_payload(parameters)
    if path == "/api/modules/planning/work-item":
        platform.require_module_enabled("planning")
        if item_loader is None:
            raise TypeError("the work item endpoint requires Planning's own loader")
        return 200, platform.planning_work_item_payload(parameters, item_loader)
    return None


def handle_post(
    conn: sqlite3.Connection,
    primary_db: str,
    path: str,
    payload: dict,
    *,
    registry_reader: project_registry.RegistryReader | None = None,
    providers: ProviderCatalog | None = None,
) -> tuple[int, dict] | None:
    if path not in {
        "/api/platform/relations",
        "/api/platform/actions/invoke",
        "/api/platform/ui-prefs",
        "/api/platform/assignments/activation",
        "/api/platform/assignments/selection",
        "/api/platform/grants/revoke",
        "/api/modules/state",
    }:
        return None
    platform = Platform(
        conn,
        primary_db,
        registry_reader=registry_reader,
        providers=providers,
    )
    if path == "/api/modules/state":
        return 200, platform.module_state_command(payload)
    if path == "/api/platform/relations":
        platform.require_module_enabled("planning")
        return 200, platform.relation_command(payload)
    if path == "/api/platform/ui-prefs":
        return 200, platform.save_ui_prefs(payload)
    if path == "/api/platform/assignments/activation":
        return 200, platform.assignment_activation_command(payload)
    if path == "/api/platform/assignments/selection":
        return 200, platform.assignment_selection_command(payload)
    if path == "/api/platform/grants/revoke":
        return 200, platform.grant_revoke_command(payload)
    return 200, platform.invoke_action(payload)


__all__ = [
    "SCHEMA",
    "SCHEMA_TABLES",
    "Platform",
    "PlatformHttpError",
    "error_response",
    "handle_get",
    "handle_post",
    "initialize",
    "modules_payload",
    "require_module_enabled",
]
