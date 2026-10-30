"""The adapter-link table, and the one migration that still rewrites it.

`platform_adapter_links` held the extension registry's generic relations: a
work item pointing at a resource an adapter owned. The registry that wrote and
read those rows is gone, and schema 9 dropped the table.

What is left here serves only a store older than 9 on its way forward: the
Board-era cutover that repoints each link from the card it named to the work
item that card became, and the table text it rebuilds the table from. That
cutover runs inside `store.migrate_planning_cutover`, the only place the
card-to-item mapping exists. `migrations` keeps its own frozen copy of the same
text for the schema-8 catalog.
"""

from __future__ import annotations

import sqlite3

from ..store_identity.primitives import ContractError


class RelationMigrationError(ContractError):
    pass


_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS platform_adapter_links(
    id INTEGER PRIMARY KEY,
    data_scope_id TEXT NOT NULL,
    space_key TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    service_owner_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    adapter_lineage_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    fallback_label TEXT NOT NULL DEFAULT '',
    provenance_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'resolved' CHECK(state IN ('resolved','unavailable','missing','ambiguous','malformed')),
    created_at TEXT NOT NULL,
    FOREIGN KEY(work_item_id) REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    UNIQUE(data_scope_id, space_key, work_item_id, service_owner_id, service_id,
           adapter_lineage_id, connection_id, resource_type, external_id)
)
"""

_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS platform_adapter_links_item
  ON platform_adapter_links(data_scope_id, space_key, work_item_id)
"""


def _require_connection(conn):
    if not isinstance(conn, sqlite3.Connection):
        raise TypeError("an explicit sqlite3.Connection is required")
    return conn


def links_need_work_items(conn) -> bool:
    """True while the link table still names a board and a card."""

    conn = _require_connection(conn)
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_adapter_links'"
        ).fetchone()
        is None
    ):
        return False
    columns = {row[1] for row in conn.execute("PRAGMA table_info(platform_adapter_links)")}
    return "card_id" in columns


def migrate_links_to_work_items(conn, mapping, space_keys) -> int:
    """Repoint every adapter link at the work item its card became.

    Called from the one-shot Planning migration, inside its transaction, because
    that is the only place the card-to-item mapping exists. A link whose card is
    absent from the mapping is never guessed: the migration fails before mutation
    rather than dropping somebody's evidence.

    `mapping` is card id to work item id; `space_keys` is card id to the key of
    the space its board became.
    """

    conn = _require_connection(conn)
    if not links_need_work_items(conn):
        return 0
    rows = conn.execute("SELECT * FROM platform_adapter_links ORDER BY id").fetchall()
    unmapped = [
        int(row["card_id"])
        for row in rows
        if int(row["card_id"]) not in mapping or int(row["card_id"]) not in space_keys
    ]
    if unmapped:
        raise RelationMigrationError(
            f"adapter links name cards the migration did not carry: {sorted(set(unmapped))[:5]}"
        )
    conn.execute("DROP INDEX IF EXISTS platform_adapter_links_card")
    conn.execute("DROP INDEX IF EXISTS platform_adapter_links_item")
    conn.execute("ALTER TABLE platform_adapter_links RENAME TO platform_adapter_links_legacy")
    conn.execute(_TABLE_SQL)
    conn.execute(_INDEX_SQL)
    for row in rows:
        card_id = int(row["card_id"])
        conn.execute(
            "INSERT INTO platform_adapter_links"
            "(data_scope_id, space_key, work_item_id, service_owner_id, service_id,"
            " adapter_lineage_id, connection_id, resource_type, external_id,"
            " fallback_label, provenance_json, state, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                row["data_scope_id"],
                space_keys[card_id],
                mapping[card_id],
                row["service_owner_id"],
                row["service_id"],
                row["adapter_lineage_id"],
                row["connection_id"],
                row["resource_type"],
                row["external_id"],
                row["fallback_label"],
                row["provenance_json"],
                row["state"],
                row["created_at"],
            ),
        )
    conn.execute("DROP TABLE platform_adapter_links_legacy")
    if conn.execute("PRAGMA foreign_key_check(platform_adapter_links)").fetchone():
        raise RelationMigrationError("adapter link foreign keys do not resolve after migration")
    return len(rows)
