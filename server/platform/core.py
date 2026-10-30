"""The `platform_*` tables a store carries, and what bringing a store up writes there.

The extension registry that used to live here is gone. What is left is the
store half of the Kernel: the `CREATE TABLE` text of every `platform_*` table a
store at this schema holds, the list the migrations prove a catalog against,
`initialize` -- the one write a store's bring-up makes in these tables -- and
the module state change Settings still offers.

`initialize` writes the store's own identity and the module registrations this
build declares that the store has never known. Nothing else: the registry rows
an earlier build seeded on every start (services, adapters, connections,
packages, actions, assignments, core-ref bindings, the known-store inventory)
are neither written nor read here any more. Their tables are still declared,
byte for byte as earlier builds created them, because a store at this schema
still holds them and the migrations prove a catalog against this text; the
migration that drops them is the one that removes their declarations.

Every shape the product has written before now lives in `migrations`, which
imports this module and is never imported back.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import UTC, datetime

from ..store_identity.metadata import (
    PLATFORM_OWNER_ID,
    STORE_METADATA_SCHEMA,
    ensure_store_metadata,
)
from ..store_identity.primitives import ContractError
from ..ui_state import PlatformHttpError
from . import modules as platform_modules
from . import relations as platform_relations
from .module_gate import modules_payload, unseen_module_ids
from .module_manifest import MODULES_INTERFACE

#: The one write route this module answers, until the module list moves into
#: code and Settings stops changing module rows.
MODULE_STATE_PATH = "/api/modules/state"

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


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


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


def _table_present(conn: sqlite3.Connection, name: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _audit(
    conn: sqlite3.Connection, event_kind: str, module_id: str, detail: dict | None = None
) -> None:
    """One module event in the audit the module reconcile reads.

    The audit is what tells a module that was removed from one that is new, so
    a registration and a state change are both written here and never erased.
    """

    conn.execute(
        "INSERT INTO platform_registry_audit"
        "(event_kind,entity_kind,entity_id,detail_json,at)"
        " VALUES (?,?,?,?,?)",
        (event_kind, "module", module_id, _json(detail or {}), _now()),
    )


def _register_unseen_modules(conn: sqlite3.Connection) -> None:
    """Write the modules this build declares that this store has never known.

    Only those: a row the operator removed stays removed, because its
    registration is still in the audit (`module_gate.unseen_module_ids`).
    """

    unseen = set(unseen_module_ids(conn))
    for manifest in platform_modules.module_manifests():
        module_id = str(manifest["module_id"])
        if module_id not in unseen:
            continue
        cursor = conn.execute(
            "INSERT OR IGNORE INTO platform_modules"
            "(module_id,mutable,revision,record_json,state,updated_at)"
            " VALUES (?,?,?,?,?,?)",
            (module_id, int(module_id != "settings"), 1, _json(manifest), "enabled", _now()),
        )
        if cursor.rowcount:
            _audit(conn, "module.registered", module_id)


def initialize(
    conn: sqlite3.Connection,
    primary_db: str,
    *,
    caller_owns_transaction: bool = False,
) -> None:
    """Bring this store's own `platform_*` rows up to what this build declares.

    The store's identity and the modules it has never known, nothing more, and
    nothing at all when both are already there: every connection runs this, so
    a write here on every open would make every read a write.

    `primary_db` is accepted for the caller's sake and not read: the store's
    identity lives in the store, not in its path.
    """

    del primary_db
    if not isinstance(conn, sqlite3.Connection):
        raise TypeError("initialize requires an explicit sqlite3.Connection")
    _execute_schema(conn, SCHEMA)
    ensure_store_metadata(
        conn,
        owner_id=PLATFORM_OWNER_ID,
        is_primary=True,
        is_writable=True,
        caller_owns_transaction=True,
    )
    _register_unseen_modules(conn)
    if not caller_owns_transaction:
        conn.commit()


def _exact_object(value, allowed, *, required) -> None:
    if not isinstance(value, dict) or set(value) - set(allowed) or not set(required) <= set(value):
        raise ContractError("request body has missing or unknown fields")


def module_state_command(conn: sqlite3.Connection, primary_db: str, payload: dict) -> dict:
    """Enable or disable one module, against the revision the caller read."""

    _exact_object(
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
    primary_db = os.path.abspath(primary_db)
    with platform_modules.module_state_fence(primary_db, module_id):
        try:
            conn.execute("BEGIN IMMEDIATE")
            registration = next(
                (
                    item
                    for item in modules_payload(conn)["modules"]
                    if item["manifest"]["module_id"] == module_id
                ),
                None,
            )
            if registration is None:
                raise PlatformHttpError(404, "unavailable", "Module registration is unavailable")
            if module_id == "settings" or not registration["mutable"]:
                raise PlatformHttpError(409, "unavailable", "Module state is immutable")
            cursor = conn.execute(
                "UPDATE platform_modules SET state=?,revision=revision+1,updated_at=?"
                " WHERE module_id=? AND revision=?",
                (state, _now(), module_id, expected_revision),
            )
            if cursor.rowcount != 1:
                raise PlatformHttpError(409, "unavailable", "Module revision changed")
            _audit(conn, "module.state-changed", module_id, {"state": state})
            registration = next(
                item
                for item in modules_payload(conn)["modules"]
                if item["manifest"]["module_id"] == module_id
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        platform_modules.notify_state_changed(primary_db, module_id, state)
    return {"interface_version": MODULES_INTERFACE, "module": registration}


__all__ = [
    "MODULE_STATE_PATH",
    "REGISTRY_SCHEMA",
    "SCHEMA",
    "SCHEMA_TABLES",
    "initialize",
    "module_state_command",
]
