"""The `platform_*` tables a store carries, and what bringing a store up writes there.

The extension registry and the module rows that used to live here are gone.
What is left is the store half of the Kernel: the `CREATE TABLE` text of every
`platform_*` table a store at this schema holds, the list the migrations prove a
catalog against, and `initialize` -- the one write a store's bring-up makes in
these tables.

`initialize` writes the store's own identity. Nothing else: the registry rows
an earlier build seeded on every start (services, adapters, connections,
packages, actions, assignments, core-ref bindings, the known-store inventory),
the module registrations and their audit are neither written nor read here any
more. Which modules exist is decided in code, in `modules`. Their tables are
still declared, byte for byte as earlier builds created them, because a store
at this schema still holds them and the migrations prove a catalog against this
text; the migration that drops them is the one that removes their declarations.

Every shape the product has written before now lives in `migrations`, which
imports this module and is never imported back.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime

from ..store_identity.metadata import (
    PLATFORM_OWNER_ID,
    STORE_METADATA_SCHEMA,
    ensure_store_metadata,
)
from . import relations as platform_relations

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


def initialize(
    conn: sqlite3.Connection,
    primary_db: str,
    *,
    caller_owns_transaction: bool = False,
) -> None:
    """Bring this store's own `platform_*` rows up to what this build declares.

    The store's identity, nothing more, and nothing at all when it is already
    there: every connection runs this, so a write here on every open would make
    every read a write.

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
    if not caller_owns_transaction:
        conn.commit()


__all__ = [
    "REGISTRY_SCHEMA",
    "SCHEMA",
    "SCHEMA_TABLES",
    "initialize",
]
