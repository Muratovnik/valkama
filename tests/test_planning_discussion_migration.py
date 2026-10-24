from __future__ import annotations

import json
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


class PlanningDiscussionMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(lambda: self.conn.close())

    def legacy_source(self) -> dict:
        self.conn.execute("DROP TRIGGER work_items_summary_matches_report")
        service.create_planning_space(self.conn, project_id="test", name="Existing work", key="OLD")
        first = service.create_work_item(self.conn, space="OLD", title="Recorded result")
        unknown = service.create_work_item(self.conn, space="OLD", title="Unattributed result")
        service.create_work_item(self.conn, space="OLD", title="No result")
        self.conn.execute(
            "INSERT INTO work_item_comments(id,work_item_id,author,body,created_at)"
            " VALUES(77,?,'historical writer','Keep exact bytes','2025-01-02T03:04:05Z')",
            (first["work_item_id"],),
        )
        raw_summary = json.dumps(
            {"done": "Existing result", "next": "Existing next", "why": "Existing reason"}, indent=2
        )
        self.conn.execute(
            "UPDATE work_items SET summary=? WHERE work_item_id IN (?,?)",
            (raw_summary, first["work_item_id"], unknown["work_item_id"]),
        )
        for author, at in (
            ("older writer", "2025-01-01T00:00:00Z"),
            ("recorded writer", "2025-01-03T00:00:00Z"),
        ):
            self.conn.execute(
                "INSERT INTO work_item_events(work_item_id,action,author,created_at) VALUES(?,'summarized',?,?)",
                (first["work_item_id"], author, at),
            )
        self.conn.execute("ALTER TABLE work_items DROP COLUMN summary_comment_id")
        self.conn.execute("ALTER TABLE work_item_comments DROP COLUMN report")
        self.conn.execute("ALTER TABLE work_item_comments DROP COLUMN checklist_item_id")
        self.conn.execute("ALTER TABLE work_item_comments DROP COLUMN checklist_item_text")
        self.conn.execute("PRAGMA user_version=7")
        self.conn.commit()
        return {
            "summary": raw_summary,
            "identity": store_backups.logical_identity(self.conn),
            "items": [
                dict(row) for row in self.conn.execute("SELECT * FROM work_items ORDER BY number")
            ],
            "comments": [
                tuple(row)
                for row in self.conn.execute("SELECT * FROM work_item_comments ORDER BY id")
            ],
            "events": [
                tuple(row)
                for row in self.conn.execute("SELECT * FROM work_item_events ORDER BY id")
            ],
        }

    def snapshots(self) -> list[Path]:
        return list((Path(self.path).parent / "backups").glob("*-preproductmodel-*.sqlite3"))

    def test_backfill_preserves_history_and_summary_bytes_and_is_idempotent(self) -> None:
        source = self.legacy_source()
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual(8, self.conn.execute("PRAGMA user_version").fetchone()[0])
        for row, original in zip(
            self.conn.execute("SELECT * FROM work_items ORDER BY number"),
            source["items"],
            strict=True,
        ):
            self.assertEqual(original, {name: row[name] for name in original})
        self.assertEqual(
            source["comments"],
            [
                tuple(row)[:5]
                for row in self.conn.execute("SELECT * FROM work_item_comments WHERE id=77")
            ],
        )
        self.assertEqual(
            source["events"],
            [tuple(row) for row in self.conn.execute("SELECT * FROM work_item_events ORDER BY id")],
        )
        first = service.get_work_item(self.conn, "OLD-1")
        report = first["comments"][-1]
        self.assertEqual(
            ("report", "recorded writer", "2025-01-03T00:00:00Z"),
            (report["kind"], report["author"], report["at"]),
        )
        self.assertEqual(first["summary_comment_id"], report["id"])
        self.assertEqual(first["summary"], report["report"])
        unattributed = service.get_work_item(self.conn, "OLD-2")["comments"][0]
        self.assertEqual(("", None), (unattributed["author"], unattributed["at"]))
        empty = service.get_work_item(self.conn, "OLD-3")
        self.assertEqual([], empty["comments"])
        self.assertIsNone(empty["summary_comment_id"])
        self.assertEqual([], self.conn.execute("PRAGMA foreign_key_check").fetchall())
        migrated = store_backups.logical_identity(self.conn)
        planning_store.migrate_discussion(self.conn)
        self.conn.commit()
        self.assertEqual(migrated, store_backups.logical_identity(self.conn))
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual(first, service.get_work_item(self.conn, "OLD-1"))
        self.assertEqual(
            3, self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        )
        self.assertEqual(1, len(self.snapshots()))
        backup = sqlite3.connect(self.snapshots()[0])
        self.addCleanup(backup.close)
        self.assertEqual(7, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(source["identity"], store_backups.logical_identity(backup))
        store_backups.integrity_check(backup, source="discussion migration backup")

    def test_snapshot_restore_replays_migration_once_without_losing_history(self) -> None:
        source = self.legacy_source()
        self.conn.close()
        self.conn = store.connect()
        expected = service.get_work_item(self.conn, "OLD-1")
        restored = str(Path(self.directory.name) / "restored.sqlite3")
        shutil.copyfile(self.snapshots()[0], restored)
        raw = sqlite3.connect(restored)
        self.assertEqual(source["identity"], store_backups.logical_identity(raw))
        self.assertEqual(7, raw.execute("PRAGMA user_version").fetchone()[0])
        raw.close()
        with mock.patch.dict(os.environ, {"VALKAMA_DB": restored}):
            replayed = store.connect()
            try:
                self.assertEqual(expected, service.get_work_item(replayed, "OLD-1"))
                self.assertEqual(
                    3, replayed.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
                )
                store_backups.integrity_check(replayed, source="restored and migrated store")
            finally:
                replayed.close()

    def test_migration_failure_rolls_back_schema_and_history_and_reuses_backup(self) -> None:
        source = self.legacy_source()
        self.conn.close()
        migrate = planning_store.migrate_discussion

        def fail_after_backfill(conn: sqlite3.Connection) -> None:
            migrate(conn)
            raise RuntimeError("injected after backfill")

        with mock.patch.object(planning_store, "migrate_discussion", fail_after_backfill):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        self.assertEqual(source["identity"], store_backups.logical_identity(raw))
        self.assertEqual(7, raw.execute("PRAGMA user_version").fetchone()[0])
        self.assertNotIn(
            "report", {row[1] for row in raw.execute("PRAGMA table_info(work_item_comments)")}
        )
        raw.close()
        self.conn = store.connect()
        self.assertEqual(1, len(self.snapshots()))
        self.assertEqual(
            3, self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        )

    def test_schema_seven_build_refuses_migrated_store_before_write(self) -> None:
        self.conn.close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 7):
            with self.assertRaises(store.StoreTooNewError):
                store.connect()
        self.assertEqual(before, Path(self.path).read_bytes())

    def test_verified_snapshot_accepts_native_index_trigger_reordering(self) -> None:
        service.create_planning_space(self.conn, project_id="t", name="Snapshot", key="SNAP")
        service.create_work_item(self.conn, space="SNAP", title="Retain the exact row")
        self.conn.execute("CREATE INDEX late_work_item_title ON work_items(title)")
        self.conn.commit()
        destination, identity = store_backups.verified_snapshot(
            self.conn,
            "discussion-test",
            locate=lambda: store_backups.BackupLocation(self.directory.name, "test"),
        )
        self.assertEqual(identity, store_backups.snapshot_identity(destination))
        reused, unchanged = store_backups.verified_snapshot(
            self.conn,
            "discussion-test",
            locate=lambda: store_backups.BackupLocation(self.directory.name, "test"),
        )
        self.assertEqual((destination, identity), (reused, unchanged))
        self.conn.execute("DROP INDEX late_work_item_title")
        self.conn.execute("CREATE INDEX late_work_item_title ON work_items(title DESC)")
        self.conn.commit()
        changed_definition = store_backups.logical_identity(self.conn)
        self.assertNotEqual(identity, changed_definition)
        self.conn.execute("UPDATE work_items SET title='A real data change'")
        self.conn.commit()
        self.assertNotEqual(changed_definition, store_backups.logical_identity(self.conn))

    def test_already_open_old_connection_cannot_overwrite_selected_report(self) -> None:
        self.legacy_source()
        old = sqlite3.connect(self.path)
        self.addCleanup(old.close)
        self.conn.close()
        self.conn = store.connect()
        before = service.get_work_item(self.conn, "OLD-1")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "summary must match"):
            old.execute(
                "UPDATE work_items SET summary=?,revision=revision+1 WHERE work_item_id=?",
                (
                    '{"done":"Old process overwrote it","next":"History lost"}',
                    before["work_item_id"],
                ),
            )
        old.commit()
        self.assertEqual(before, service.get_work_item(self.conn, "OLD-1"))
        current = service.report_work_item(
            self.conn,
            "OLD-1",
            {"done": "Current process", "next": "Preserve history"},
            make_current=True,
            expected_revision=before["revision"],
        )
        selected = service.select_summary(
            self.conn,
            "OLD-1",
            before["summary_comment_id"],
            expected_revision=current["revision"],
        )
        self.assertEqual(before["summary"], selected["summary"])

    def test_native_guard_compares_json_values_and_owns_empty_and_foreign_pointers(self) -> None:
        item = service.create_work_item(
            self.conn,
            space=service.create_planning_space(self.conn, project_id="t", name="Guard", key="GU")[
                "key"
            ],
            title="Native invariant",
        )
        current = service.report_work_item(
            self.conn,
            item["reference"],
            {"done": "Current", "next": "Next"},
            make_current=True,
            expected_revision=item["revision"],
        )
        differently_encoded = '{ "next": "Next", "why": "", "done": "Current" }'
        self.conn.execute(
            "UPDATE work_items SET summary=? WHERE work_item_id=?",
            (differently_encoded, item["work_item_id"]),
        )
        other = service.create_work_item(self.conn, space="GU", title="Other")
        self.assertIsNotNone(current["summary_comment_id"])
        invalid_pairs = (
            ("", current["summary_comment_id"], item["work_item_id"]),
            (differently_encoded, None, item["work_item_id"]),
            (differently_encoded, current["summary_comment_id"], other["work_item_id"]),
            ("not JSON", current["summary_comment_id"], item["work_item_id"]),
        )
        for summary, pointer, identity in invalid_pairs:
            with self.subTest(summary=summary, pointer=pointer, identity=identity):
                with self.assertRaisesRegex(sqlite3.IntegrityError, "summary must match"):
                    self.conn.execute(
                        "UPDATE work_items SET summary=?,summary_comment_id=? WHERE work_item_id=?",
                        (summary, pointer, identity),
                    )
        self.conn.execute(
            "UPDATE work_items SET summary='',summary_comment_id=NULL WHERE work_item_id=?",
            (item["work_item_id"],),
        )
