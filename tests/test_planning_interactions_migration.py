from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.planning import service
from server.planning import store as planning_store


class PlanningInteractionsMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "store.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(lambda: self.conn.close())
        service.create_planning_space(
            self.conn, project_id="test", name="Retained work", key="KEEP"
        )
        self.item = service.create_work_item(self.conn, space="KEEP", title="Retain all history")
        service.comment_work_item(self.conn, self.item["reference"], "Exact historical bytes")
        service.set_summary(
            self.conn, self.item["reference"], {"done": "Existing report", "next": "Continue"}
        )
        self.conn.execute("DROP TABLE work_item_requests")
        self.conn.execute("ALTER TABLE work_item_comments DROP COLUMN checklist_item_id")
        self.conn.execute("ALTER TABLE work_item_comments DROP COLUMN checklist_item_text")
        self.conn.execute("ALTER TABLE work_item_events RENAME TO future_events")
        self.conn.execute(
            "CREATE TABLE work_item_events(id INTEGER PRIMARY KEY AUTOINCREMENT,work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,action TEXT NOT NULL CHECK(action IN ('created','summarized')),detail TEXT NOT NULL DEFAULT '',author TEXT NOT NULL DEFAULT 'agent',created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))"
        )
        self.conn.execute(
            "INSERT INTO work_item_events(id,work_item_id,action,detail,author,created_at)"
            " SELECT id,work_item_id,action,detail,author,created_at FROM future_events"
        )
        self.conn.execute("DROP TABLE future_events")
        self.conn.execute("CREATE INDEX work_item_events_item ON work_item_events(work_item_id,id)")
        self.conn.execute("CREATE INDEX retained_event_author ON work_item_events(author)")
        self.conn.execute(
            "CREATE TRIGGER retained_event_trigger AFTER INSERT ON work_item_events WHEN NEW.author='trigger-control' BEGIN UPDATE work_items SET title='trigger reached' WHERE work_item_id=NEW.work_item_id; END"
        )
        self.conn.execute(
            "INSERT INTO work_item_events(id,work_item_id,action) VALUES(999,?,'created')",
            (self.item["work_item_id"],),
        )
        self.conn.execute("DELETE FROM work_item_events WHERE id=999")
        self.conn.commit()
        self.identity = store_backups.logical_identity(self.conn)
        # Read back through the columns this source has: later steps append
        # columns, and what is held is that every value here is still there.
        self.columns = {
            table: [str(row[1]) for row in self.conn.execute(f"PRAGMA table_info({table})")]
            for table in ("work_item_comments", "work_item_events")
        }
        self.comments = self.rows(self.conn, "work_item_comments")
        self.events = self.rows(self.conn, "work_item_events")

    def rows(self, conn: sqlite3.Connection, table: str) -> list[tuple]:
        names = ", ".join(self.columns[table])
        return [tuple(row) for row in conn.execute(f"SELECT {names} FROM {table} ORDER BY id")]

    def snapshots(self) -> list[Path]:
        return list((Path(self.path).parent / "backups").glob("*-preinteractions-*.sqlite3"))

    def test_current_schema_upgrade_snapshots_before_mutation_and_preserves_history(self) -> None:
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, self.conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(1, len(self.snapshots()))
        self.assertEqual(self.identity, store_backups.snapshot_identity(str(self.snapshots()[0])))
        self.assertEqual(self.comments, self.rows(self.conn, "work_item_comments"))
        self.assertEqual(self.events, self.rows(self.conn, "work_item_events"))
        self.assertIsNotNone(
            self.conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='retained_event_author'"
            ).fetchone()
        )
        cursor = self.conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,author) VALUES(?,'request_created','trigger-control')",
            (self.item["work_item_id"],),
        )
        self.assertGreater(cursor.lastrowid, 999)
        self.assertEqual(
            "trigger reached", self.conn.execute("SELECT title FROM work_items").fetchone()[0]
        )
        self.conn.commit()
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual(1, len(self.snapshots()))

    def test_failure_rolls_back_then_snapshot_restore_replays_once(self) -> None:
        self.conn.close()
        original = planning_store.migrate_interactions

        def fail_after_schema(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected migration failure")

        with mock.patch.object(
            planning_store, "migrate_interactions", side_effect=fail_after_schema
        ):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        self.assertEqual(self.identity, store_backups.logical_identity(raw))
        raw.close()
        self.assertEqual(1, len(self.snapshots()))
        restored = str(Path(self.path).parent / "restored.sqlite3")
        shutil.copyfile(self.snapshots()[0], restored)
        with mock.patch.dict(os.environ, {"VALKAMA_DB": restored}):
            replayed = store.connect()
            try:
                self.assertFalse(planning_store.interactions_migration_needed(replayed))
                self.assertEqual(self.events, self.rows(replayed, "work_item_events"))
                store_backups.integrity_check(replayed, source="restored migration")
            finally:
                replayed.close()
        self.conn = store.connect()
        self.assertEqual(1, len(self.snapshots()))
