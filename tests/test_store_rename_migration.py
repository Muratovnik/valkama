"""Carrying a store off the former product name.

The code reads only the current table names, so a store written under the old
ones would otherwise open next to fifteen empty tables and report an empty
registry — which looks exactly like losing every grant, assignment and link.
Every case runs against a throwaway store; the owner's board is never a subject
here.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import store, store_rename

# The shape the store had before the rename: enough of it to prove the carry-over
# touches tables, indexes, keys, JSON records and the session rows.
LEGACY_SQL = """
CREATE TABLE boards(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE hub_store_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 data_scope_id TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL,
 is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
 is_writable INTEGER NOT NULL CHECK(is_writable IN (0, 1)), created_at TEXT NOT NULL);
CREATE TABLE hub_grants(grant_id TEXT PRIMARY KEY, record_json TEXT NOT NULL,
 state TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE hub_services(service_key TEXT PRIMARY KEY, record_json TEXT NOT NULL,
 state TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE hub_registry_audit(sequence INTEGER PRIMARY KEY, event_kind TEXT NOT NULL,
 entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
 at TEXT NOT NULL);
CREATE INDEX hub_registry_audit_entity ON hub_registry_audit(entity_kind, entity_id, sequence);
CREATE TABLE sessions(id TEXT PRIMARY KEY, client TEXT NOT NULL);
"""


def build_prerename_store(path: str) -> None:
    """A store carrying the former table names and the strings that went with them."""

    conn = sqlite3.connect(path)
    conn.executescript(LEGACY_SQL)
    conn.execute("INSERT INTO boards(name) VALUES ('Example Board')")
    conn.execute(
        "INSERT INTO hub_store_metadata VALUES"
        " (1,'123e4567-e89b-42d3-a456-426614174000','valkama',1,1,'2026-08-18T00:00:00Z')"
    )
    conn.execute(
        "INSERT INTO hub_grants VALUES ('grant-1', ?, 'active', '2026-08-18T00:00:00Z')",
        (json.dumps({"interface_version": "hub-actions-v1", "owner_id": "hub-notes"}),),
    )
    conn.execute(
        "INSERT INTO hub_services VALUES ('hub-notes:in-memory', ?, 'registered',"
        " '2026-08-18T00:00:00Z')",
        (json.dumps({"provenance": "hub-built-in", "publisher_id": "hub-notes"}),),
    )
    conn.execute(
        "INSERT INTO hub_registry_audit VALUES (1,'registered','service','hub-notes:in-memory',"
        " '{\"source\":\"hub-built-in\"}','2026-08-18T00:00:00Z')"
    )
    conn.execute("INSERT INTO sessions VALUES ('session-1','hub')")
    conn.commit()
    conn.close()


class StoreRenameMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def test_predates_rename_detects_only_a_store_that_holds_an_old_name(self) -> None:
        build_prerename_store(self.path)
        conn = sqlite3.connect(self.path)
        self.addCleanup(conn.close)
        self.assertTrue(store_rename.predates_rename(conn))
        store_rename.migrate_off_former_name(conn)
        self.assertFalse(store_rename.predates_rename(conn))

    def test_every_row_survives_under_the_current_names(self) -> None:
        build_prerename_store(self.path)
        conn = sqlite3.connect(self.path)
        self.addCleanup(conn.close)
        store_rename.migrate_off_former_name(conn)

        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertIn("platform_grants", tables)
        self.assertIn("platform_store_metadata", tables)
        self.assertNotIn("hub_grants", tables)
        self.assertEqual(
            [("123e4567-e89b-42d3-a456-426614174000",)],
            conn.execute("SELECT data_scope_id FROM platform_store_metadata").fetchall(),
        )
        self.assertEqual(
            [("grant-1",)], conn.execute("SELECT grant_id FROM platform_grants").fetchall()
        )

    def test_the_strings_the_store_wrote_down_move_with_the_tables(self) -> None:
        build_prerename_store(self.path)
        conn = sqlite3.connect(self.path)
        self.addCleanup(conn.close)
        store_rename.migrate_off_former_name(conn)

        grant = json.loads(conn.execute("SELECT record_json FROM platform_grants").fetchone()[0])
        self.assertEqual("valkama-actions", grant["interface_version"])
        self.assertEqual("valkama-notes", grant["owner_id"])
        key, record = conn.execute(
            "SELECT service_key, record_json FROM platform_services"
        ).fetchone()
        self.assertEqual("valkama-notes:in-memory", key)
        self.assertEqual("platform-built-in", json.loads(record)["provenance"])
        entity, detail = conn.execute(
            "SELECT entity_id, detail_json FROM platform_registry_audit"
        ).fetchone()
        self.assertEqual("valkama-notes:in-memory", entity)
        self.assertEqual("platform-built-in", json.loads(detail)["source"])
        self.assertEqual([("platform",)], conn.execute("SELECT client FROM sessions").fetchall())

    def test_connect_refuses_an_incomplete_prerename_catalog_before_mutation(self) -> None:
        build_prerename_store(self.path)
        with self.assertRaisesRegex(Exception, "catalog is incomplete or mixed"):
            store.connect()
        conn = sqlite3.connect(self.path)
        self.addCleanup(conn.close)
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertIn("hub_grants", tables)
        self.assertNotIn("platform_grants", tables)
        self.assertEqual(0, int(conn.execute("PRAGMA user_version").fetchone()[0]))

    def test_a_store_already_on_the_current_names_is_left_alone(self) -> None:
        conn = store.connect()
        conn.close()
        opened = sqlite3.connect(self.path)
        self.addCleanup(opened.close)
        self.assertFalse(store_rename.predates_rename(opened))


if __name__ == "__main__":
    unittest.main()
