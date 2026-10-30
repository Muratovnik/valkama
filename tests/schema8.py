"""A store as the schema-8 build created it, for the migrations that start there.

Schema 9 dropped the extension registry's tables, the module rows with their
audit, and `integration_settings`, so no current code can produce a store that
still has them. `fixtures/store-schema-8.sql` is every statement in
`sqlite_master` of a fresh store the last schema-8 build created, captured once
from that build rather than restated from the code under test: a migration
proven against a catalog the same module wrote proves only that it agrees with
itself.

`build` writes such a store from nothing. `restore_catalog` gives a store this
build created the schema-8 objects it lacks, which is how a test that shapes an
older store from a fresh one gets the tables that shape starts from.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "store-schema-8.sql"
CREATED_AT = "2026-10-30T00:00:00Z"
_NAME = re.compile(r"^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\s+(\w+)", re.IGNORECASE)


def statements() -> list[tuple[str, str]]:
    """Every captured statement with the name of the object it creates, in order."""

    collected: list[tuple[str, str]] = []
    pending = ""
    for line in FIXTURE.read_text(encoding="utf-8").splitlines(keepends=True):
        if not pending and line.startswith("--"):
            continue
        pending += line
        if sqlite3.complete_statement(pending):
            statement = pending.strip()
            match = _NAME.match(statement)
            if match is None:
                raise ValueError(f"unrecognised schema-8 statement: {statement[:60]}")
            collected.append((match.group(1), statement))
            pending = ""
    if pending.strip():
        raise ValueError("the schema-8 fixture ends inside a statement")
    return collected


def restore_catalog(conn: sqlite3.Connection) -> None:
    """Create every schema-8 object this store does not have. The caller commits."""

    present = {str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master")}
    for name, statement in statements():
        if name not in present:
            conn.execute(statement)


def build(path: str, *, data_scope_id: str = "00000000-0000-4000-8000-000000000008") -> None:
    """Write a store at schema 8 holding its identity and nothing else.

    What the schema-8 build left behind on its first start: the whole catalog,
    the store's identity row, and the stamp. No module rows -- that build had
    stopped writing them.
    """

    conn = sqlite3.connect(path)
    try:
        for _, statement in statements():
            conn.execute(statement)
        conn.execute(
            "INSERT INTO platform_store_metadata"
            "(singleton,data_scope_id,owner_id,is_primary,is_writable,created_at)"
            " VALUES (1,?,'valkama',1,1,?)",
            (data_scope_id, CREATED_AT),
        )
        conn.execute("PRAGMA user_version=8")
        conn.commit()
    finally:
        conn.close()
