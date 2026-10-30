"""The extension registry's rows as a build that still had the registry left them.

Until the registry was removed, every start seeded these rows into the store:
services, adapters, connections, packages, actions and their input descriptors,
installation assignments, the core-ref binding and the registry's own meta
values, plus a known-store row for the primary store. Nothing in the server
writes them now, but a store on disk still holds them and the migrations still
check and rewrite rows of these shapes.

`fixtures/platform-registry-rows.fixture.json` is those rows, captured once
from the last build that wrote them (with the retired `codex-skills` built-in
the work-focus retirement removes). A test that needs a store as that build left
it opens a fresh store and calls `seed`, instead of asking current code to
produce data it no longer produces.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from server.store_identity.metadata import read_store_metadata

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "platform-registry-rows.fixture.json"
CAPTURED_AT = "2026-10-30T00:00:00Z"
#: Insert order: an action input names its action.
TABLE_ORDER = (
    "platform_services",
    "platform_adapters",
    "platform_connections",
    "platform_packages",
    "platform_actions",
    "platform_action_inputs",
    "platform_assignments",
    "platform_grants",
    "platform_core_ref_bindings",
    "platform_registry_meta",
)


def rows() -> dict[str, list[dict]]:
    """Every captured row, by table, as it was stored."""

    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def seed(conn: sqlite3.Connection) -> None:
    """Write the captured registry rows and the primary known-store row.

    The caller owns the transaction. The known-store row names this store's own
    identity, which no capture could know in advance; its resources are empty,
    as they were for a store with no planning space when it was seeded.
    """

    captured = rows()
    for table in TABLE_ORDER:
        for record in captured[table]:
            columns = sorted(record)
            conn.execute(
                f"INSERT INTO {table}({','.join(columns)})"
                f" VALUES ({','.join('?' for _ in columns)})",
                [record[column] for column in columns],
            )
    conn.execute(
        "INSERT INTO platform_known_stores"
        "(data_scope_id,alias,resources_json,registry_revision,is_primary,is_attached,"
        "is_writable,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (read_store_metadata(conn)["data_scope_id"], "personal", "[]", 1, 1, 1, 1, CAPTURED_AT),
    )
