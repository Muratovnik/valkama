"""The Board-era adapter-link cutover, the one write left on the link table.

`store.migrate_planning_cutover` calls it inside its transaction when a Board
store comes over to Planning. Nothing else exercises it: the stores the other
migration tests build never held a link.
"""

import sqlite3
import unittest

from server.platform.relations import (
    RelationMigrationError,
    links_need_work_items,
    migrate_links_to_work_items,
)

# The table as the Board era wrote it: a link names a board and a card.
BOARD_LINKS = """
    CREATE TABLE platform_adapter_links(
        id INTEGER PRIMARY KEY,
        data_scope_id TEXT NOT NULL,
        board_name TEXT NOT NULL,
        card_id INTEGER NOT NULL,
        service_owner_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        adapter_lineage_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        fallback_label TEXT NOT NULL DEFAULT '',
        provenance_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'resolved',
        created_at TEXT NOT NULL
    );
"""


class AdapterLinkMigrationTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        # The one item a carried link points at.
        self.conn.executescript("""
            CREATE TABLE work_items(work_item_id TEXT PRIMARY KEY);
            INSERT INTO work_items VALUES ('item-1');
        """)

    def tearDown(self):
        self.conn.close()

    def link_on_card(self, card_id, external_id):
        self.conn.executescript(BOARD_LINKS)
        self.conn.execute(
            "INSERT INTO platform_adapter_links VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                7,
                "scope-1",
                "Main",
                card_id,
                "provider-owner",
                "provider",
                "provider-lineage",
                "connection-1",
                "record",
                external_id,
                external_id.title(),
                '{"source_kind":"test","observed_at":"2026-08-13T00:00:00Z"}',
                "resolved",
                "2026-08-13T00:00:00Z",
            ),
        )
        self.conn.commit()

    def test_a_store_without_the_table_needs_nothing(self):
        self.assertFalse(links_need_work_items(self.conn))
        self.assertEqual(0, migrate_links_to_work_items(self.conn, {}, {}))

    def test_a_link_naming_a_card_the_migration_did_not_carry_is_refused(self):
        """The conversion never guesses which item an unmapped card became."""

        self.link_on_card(999, "orphan")
        self.assertTrue(links_need_work_items(self.conn))
        with self.assertRaises(RelationMigrationError):
            migrate_links_to_work_items(self.conn, {}, {})
        # Refused before mutation: the row is exactly as it was written.
        self.assertEqual(
            (7, 999, "orphan"),
            tuple(
                self.conn.execute(
                    "SELECT id,card_id,external_id FROM platform_adapter_links"
                ).fetchone()
            ),
        )

    def test_a_mapped_link_moves_with_its_item(self):
        self.link_on_card(42, "carried")
        moved = migrate_links_to_work_items(self.conn, {42: "item-1"}, {42: "MAIN"})
        self.assertEqual(1, moved)
        row = self.conn.execute(
            "SELECT space_key, work_item_id, external_id, fallback_label"
            " FROM platform_adapter_links"
        ).fetchone()
        self.assertEqual(("MAIN", "item-1", "carried", "Carried"), tuple(row))
        self.assertFalse(links_need_work_items(self.conn))
        legacy = self.conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name='platform_adapter_links_legacy'"
        ).fetchone()
        self.assertIsNone(legacy)


if __name__ == "__main__":
    unittest.main()
