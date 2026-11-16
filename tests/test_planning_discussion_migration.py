from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.planning import service


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

    def test_schema_seven_build_refuses_migrated_store_before_write(self) -> None:
        self.conn.close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 7):
            with self.assertRaises(store.StoreTooNewError):
                store.connect()
        self.assertEqual(before, Path(self.path).read_bytes())

    def test_verified_snapshot_accepts_native_index_trigger_reordering(self) -> None:
        service.create_planning_space(self.conn, name="Snapshot", key="SNAP")
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

    def test_native_guard_compares_json_values_and_owns_empty_and_foreign_pointers(self) -> None:
        item = service.create_work_item(
            self.conn,
            space=service.create_planning_space(self.conn, name="Guard", key="GU")["key"],
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
