"""The `platform_*` tables a store carries, and what bringing a store up writes there.

What is left of the Kernel's store half is two tables: the store's own identity
(`platform_store_metadata`) and the one UI preference the shell remembers
(`platform_ui_prefs`). This module declares their `CREATE TABLE` text, the list
the postconditions prove a catalog against, and `initialize` -- the one write a
store's bring-up makes here.

The extension registry's tables, the module rows and their audit are not
declared any more. Schema 9 dropped them; their text, frozen as schema 8 left
it, lives in `migrations`, which still needs it to carry an older store forward
and to recognise one. Which modules exist is decided in code, in `modules`.

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

_UI_PREFS_SCHEMA = """
CREATE TABLE IF NOT EXISTS platform_ui_prefs(
    key TEXT PRIMARY KEY CHECK(key='last-route'),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

SCHEMA = STORE_METADATA_SCHEMA + _UI_PREFS_SCHEMA

SCHEMA_TABLES = (
    "platform_store_metadata",
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
    "SCHEMA",
    "SCHEMA_TABLES",
    "initialize",
]
