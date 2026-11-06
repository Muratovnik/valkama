"""Schema 13: what a session follows beside what it holds, and a comment that waits.

The sources are stores built from the catalogs the last schema-11 and schema-12
builds created, populated as those builds wrote them. What this suite holds the
migration to: every existing value stays, the subscriptions table and a comment's
`awaits_reply`, 0 on every comment there was, and the links' index by the item they
point to arrive once --
a store at 11 under the one recovery point `preschema12` that covers both steps, a
store at 12 under `preschema13` -- a second open writes nothing, the recovery point
brings the store back and the migration runs again, a fresh store has the same
catalog directly, and a build that knows only 12 refuses the result. The new names
are stated here rather than read from the code under test.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from server import store
from tests import schema9, schema11, schema12
from tests.test_schema12_migration import _catalog, _columns, _rows, _shape

ADDED_TABLE = "work_item_subscriptions"
AWAITS = "awaits_reply"
COLUMNS = ["work_item_id", "session_id", "agent_id", "follows", "call_id", "created_at"]
HELD = "11111111-1111-4111-8111-111111111111"
LABELS = ("preschema12", "preschema13", "pretables", "preupgrade", "preidentity")
SOURCES: dict[int, Callable[[str], None]] = {11: schema11.build, 12: schema12.build}


class SchemaThirteenTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def source(self, version: int) -> tuple[dict[str, list[str]], dict[str, list[tuple]]]:
        SOURCES[version](self.path)
        conn = sqlite3.connect(self.path)
        try:
            schema9.populate(conn)
            conn.commit()
            conn.row_factory = None
            self.assertEqual(version, conn.execute("PRAGMA user_version").fetchone()[0])
            self.assertNotIn(ADDED_TABLE, _catalog(conn, "table"))
            shape = _columns(conn)
            return shape, _rows(conn, shape)
        finally:
            conn.close()

    def snapshots(self, label: str) -> list[Path]:
        return list((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def taken(self) -> dict[str, int]:
        return {label: len(self.snapshots(label)) for label in LABELS if self.snapshots(label)}

    def assert_reached_13(self, conn: sqlite3.Connection) -> None:
        self.assertEqual(13, conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(
            COLUMNS, [row[1] for row in conn.execute(f"PRAGMA table_info({ADDED_TABLE})")]
        )
        key = [row[1] for row in conn.execute(f"PRAGMA table_info({ADDED_TABLE})") if row[5]]
        self.assertEqual(["work_item_id", "session_id", "agent_id"], key)
        awaits = [
            (row[2], row[3], row[4])
            for row in conn.execute("PRAGMA table_info(work_item_comments)")
            if row[1] == AWAITS
        ]
        self.assertEqual([("INTEGER", 1, "0")], awaits)
        self.assertEqual(
            ["to_id", "kind"],
            [row[2] for row in conn.execute("PRAGMA index_info(work_item_links_to)")],
            "what blocks an item is read from the item blocked",
        )
        self.assertEqual(
            ["session_id", "agent_id"],
            [row[2] for row in conn.execute("PRAGMA index_info(work_item_subscriptions_session)")],
            "what a session follows is read from the session",
        )
        self.assertEqual(
            [],
            conn.execute(f"SELECT id FROM work_item_comments WHERE {AWAITS} <> 0").fetchall(),
        )
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

    def upgrade(self, version: int, label: str) -> None:
        shape, before = self.source(version)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_13(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        self.assertEqual({label: 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots(label)[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(version, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(before, _rows(backup, shape))

    def test_a_store_at_12_reaches_13_under_preschema13(self) -> None:
        self.upgrade(12, "preschema13")

    def test_a_store_at_11_reaches_13_under_one_preschema12_point(self) -> None:
        self.upgrade(11, "preschema12")

    def test_the_table_holds_what_schema_13_means(self) -> None:
        """One row per item, session and agent, a known call, and gone with the item."""

        self.source(12)
        conn = store.connect()
        self.addCleanup(conn.close)
        call = conn.execute(
            "INSERT INTO execution_events(event_uid,kind,identity_state,identity_source)"
            " VALUES('u','planning_write','confirmed','codex-meta')"
        ).lastrowid
        insert = (
            f"INSERT INTO {ADDED_TABLE}(work_item_id,session_id,agent_id,follows,call_id)"
            " VALUES(?,?,?,?,?)"
        )
        conn.execute(insert, (HELD, "s", "", 1, call))
        conn.execute(insert, (HELD, "s", "a", 0, call))
        since = conn.execute(f"SELECT created_at FROM {ADDED_TABLE} LIMIT 1").fetchone()[0]
        self.assertRegex(since, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        for row in ((HELD, "s", "", 0, call), (HELD, "t", "", 2, call), ("none", "t", "", 1, call)):
            with self.subTest(row=row), self.assertRaises(sqlite3.IntegrityError):
                conn.execute(insert, row)
        conn.execute("DELETE FROM work_items WHERE work_item_id = ?", (HELD,))
        self.assertEqual(0, conn.execute(f"SELECT COUNT(*) FROM {ADDED_TABLE}").fetchone()[0])
        conn.rollback()

    def test_a_comment_waits_for_a_reply_or_does_not(self) -> None:
        self.source(12)
        conn = store.connect()
        self.addCleanup(conn.close)
        insert = f"INSERT INTO work_item_comments(work_item_id,body,{AWAITS}) VALUES(?,?,?)"
        conn.execute(insert, (HELD, "Waits", 1))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(insert, (HELD, "Neither", 2))
        conn.rollback()

    def test_preschema13_restores_12_and_the_migration_runs_again(self) -> None:
        shape, before = self.source(12)
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(self.snapshots("preschema13")[0], self.path)
        restored = sqlite3.connect(self.path)
        self.assertEqual(12, restored.execute("PRAGMA user_version").fetchone()[0])
        self.assertNotIn(ADDED_TABLE, _catalog(restored, "table"))
        restored.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_13(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        self.assertEqual({"preschema13": 1}, self.taken())

    def test_reopening_a_store_at_13_writes_nothing(self) -> None:
        self.source(12)
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual({"preschema13": 1}, self.taken())

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assert_reached_13(fresh)
        expected = _shape(fresh)
        for version, build in SOURCES.items():
            with self.subTest(source=version):
                path = str(self.root / f"from-{version}" / "valkama.sqlite3")
                os.makedirs(os.path.dirname(path))
                build(path)
                with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
                    migrated = store.connect()
                self.addCleanup(migrated.close)
                self.assertEqual(expected, _shape(migrated))

    def test_a_build_that_knows_only_12_refuses_a_store_at_13(self) -> None:
        self.source(12)
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 12):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual((13, 12), (refusal.exception.stored, refusal.exception.supported))
        self.assertEqual(before, Path(self.path).read_bytes())


if __name__ == "__main__":
    unittest.main()
