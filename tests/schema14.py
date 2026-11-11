"""A store as the last schema-14 build created it, for the migration that starts there.

`fixtures/store-schema-14.sql` is every statement in `sqlite_master` of a fresh
store that build created, captured once from it rather than restated from the code
under test: a migration proven against a catalog the same module wrote proves only
that it agrees with itself.

`build` writes such a store holding its identity row. Rows come from
`schema9.populate`, whose plain SQL lands in this catalog unchanged.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from tests import schema8

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "store-schema-14.sql"
CREATED_AT = "2026-11-11T00:00:00Z"


def build(path: str, *, data_scope_id: str = "00000000-0000-4000-8000-000000000014") -> None:
    """Write a store at schema 14, holding its identity row."""

    conn = sqlite3.connect(path)
    try:
        for _, statement in schema8.statements(FIXTURE):
            conn.execute(statement)
        conn.execute(
            "INSERT INTO platform_store_metadata"
            "(singleton,data_scope_id,owner_id,is_primary,is_writable,created_at)"
            " VALUES (1,?,'valkama',1,1,?)",
            (data_scope_id, CREATED_AT),
        )
        conn.execute("PRAGMA user_version=14")
        conn.commit()
    finally:
        conn.close()
