"""The extension registry's rows as a build that still had the registry left them.

Until the registry was removed, every start seeded these rows into the store:
services, adapters, connections, packages, actions and their input descriptors,
installation assignments, the core-ref binding and the registry's own meta
values, plus a known-store row for the primary store. Until the module list
moved into code, every start also wrote one `platform_modules` row per module
and a `module.registered` audit event for each. Nothing in the server writes
any of them now, but a store on disk still holds them and the migrations still
check and rewrite rows of these shapes -- a store from before schema 4 is
refused without its Settings row.

`fixtures/platform-registry-rows.fixture.json` is those rows, captured once
from the last build that wrote them (with the retired `codex-skills` built-in
the work-focus retirement removes). A test that needs a store as that build left
it opens a fresh store and calls `seed`, or `seed_modules` for the module rows
alone, instead of asking current code to produce data it no longer produces.

Schema 9 dropped the tables these rows live in, so both first give the store
the schema-8 catalog it lacks, and the store stays a fresh one only until its
stamp is set below 9: a store stamped 9 that holds these tables is refused.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from server.store_identity.metadata import read_store_metadata
from tests import schema8

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
#: The module rows and their audit, written apart from the registry's.
MODULE_TABLES = ("platform_modules", "platform_registry_audit")


def rows() -> dict[str, list[dict]]:
    """Every captured row, by table, as it was stored."""

    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _insert(conn: sqlite3.Connection, tables: tuple[str, ...]) -> None:
    captured = rows()
    for table in tables:
        for record in captured[table]:
            columns = sorted(record)
            conn.execute(
                f"INSERT INTO {table}({','.join(columns)})"
                f" VALUES ({','.join('?' for _ in columns)})",
                [record[column] for column in columns],
            )


def seed_modules(conn: sqlite3.Connection) -> None:
    """Write the captured module rows and their registration audit.

    The caller owns the transaction, and the store must have no audit rows yet:
    the captured events keep the sequence numbers they were written with.
    """

    schema8.restore_catalog(conn)
    _insert(conn, MODULE_TABLES)


def seed(conn: sqlite3.Connection) -> None:
    """Write the captured registry and module rows and the primary known-store row.

    The caller owns the transaction. The known-store row names this store's own
    identity, which no capture could know in advance; its resources are empty,
    as they were for a store with no planning space when it was seeded.
    """

    schema8.restore_catalog(conn)
    _insert(conn, TABLE_ORDER + MODULE_TABLES)
    conn.execute(
        "INSERT INTO platform_known_stores"
        "(data_scope_id,alias,resources_json,registry_revision,is_primary,is_attached,"
        "is_writable,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (read_store_metadata(conn)["data_scope_id"], "personal", "[]", 1, 1, 1, 1, CAPTURED_AT),
    )
