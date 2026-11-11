"""Schema 15: the history event of a changed label set.

The sources are stores built from the catalogs the last schema-13 and schema-14
builds created, populated as those builds wrote them. What this suite holds the
migration to: the event table is rebuilt once to admit the new action, keeping every
event and every other value -- a store at 13 under the one recovery point
`preschema14` that covers both steps, a store at 14 under `preschema15` -- a second
open neither rebuilds nor snapshots, the recovery point brings the store back and the
migration runs again, a failed attempt leaves the store at 14, a fresh store has the
same catalog directly, and a build that knows only 14 refuses the result. The new
action is stated here rather than read from the code under test.
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
from server.planning import store as planning_store
from tests import schema9, schema13, schema14
from tests.test_schema12_migration import _columns, _event_actions, _rows, _shape

ADDED_ACTION = "labels_changed"
#: The item `schema9.populate` holds, with its history.
HELD = "11111111-1111-4111-8111-111111111111"
#: The indexes of the event table, which the rebuild creates again.
EVENT_INDEXES = {"work_item_events_item", "work_item_events_mentioned"}
LABELS = ("preschema14", "preschema15", "pretables", "preupgrade", "preidentity")
SOURCES: dict[int, Callable[[str], None]] = {13: schema13.build, 14: schema14.build}


def _events(conn: sqlite3.Connection) -> list[tuple]:
    return [tuple(row) for row in conn.execute("SELECT * FROM work_item_events ORDER BY id")]


def _event_indexes(conn: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='work_item_events'"
            " AND sql IS NOT NULL"
        )
    }


class SchemaFifteenTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def source(self, version: int) -> tuple[dict[str, list[str]], dict[str, list[tuple]]]:
        """A populated store at `version`, with its tables' columns and rows."""

        SOURCES[version](self.path)
        conn = sqlite3.connect(self.path)
        try:
            schema9.populate(conn)
            conn.commit()
            self.assertEqual(version, conn.execute("PRAGMA user_version").fetchone()[0])
            self.assertNotIn(ADDED_ACTION, _event_actions(conn))
            self.assertTrue(_events(conn), "the source holds history to keep")
            shape = _columns(conn)
            return shape, _rows(conn, shape)
        finally:
            conn.close()

    def snapshots(self, label: str) -> list[Path]:
        return list((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def taken(self) -> dict[str, int]:
        return {label: len(self.snapshots(label)) for label in LABELS if self.snapshots(label)}

    def assert_reached_15(self, conn: sqlite3.Connection) -> None:
        # The chain runs on to this build's own schema in the same open.
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertIn(ADDED_ACTION, _event_actions(conn))
        self.assertEqual(EVENT_INDEXES, _event_indexes(conn))
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

    def upgrade(self, version: int, label: str) -> None:
        shape, before = self.source(version)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_15(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        self.assertEqual(before["work_item_events"], _events(conn), "every event, by its id")
        # One point, named for the oldest step, holding the source as it was.
        self.assertEqual({label: 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots(label)[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(version, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual("ok", backup.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertNotIn(ADDED_ACTION, _event_actions(backup))
        self.assertEqual(before, _rows(backup, shape))

    def test_a_store_at_14_reaches_15_under_preschema15(self) -> None:
        self.upgrade(14, "preschema15")

    def test_a_store_at_13_reaches_15_under_one_preschema14_point(self) -> None:
        self.upgrade(13, "preschema14")

    def test_the_rebuilt_table_admits_the_new_action_and_no_other(self) -> None:
        self.source(14)
        conn = store.connect()
        self.addCleanup(conn.close)
        insert = "INSERT INTO work_item_events(work_item_id,action,detail,author) VALUES(?,?,?,'a')"
        conn.execute(insert, (HELD, ADDED_ACTION, '{"from":["a"],"to":["a","b"]}'))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(insert, (HELD, "invented", ""))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(insert, ("no-such-item", ADDED_ACTION, ""))
        conn.rollback()

    def test_preschema15_restores_14_and_the_migration_runs_again(self) -> None:
        shape, before = self.source(14)
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(self.snapshots("preschema15")[0], self.path)
        restored = sqlite3.connect(self.path)
        self.assertEqual(14, restored.execute("PRAGMA user_version").fetchone()[0])
        self.assertNotIn(ADDED_ACTION, _event_actions(restored))
        restored.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_15(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        # The restored store is the point's own source, so the replay reuses it.
        self.assertEqual({"preschema15": 1}, self.taken())

    def test_reopening_a_store_at_15_neither_rebuilds_nor_snapshots(self) -> None:
        self.source(14)
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        with mock.patch.object(
            planning_store, "widen_event_actions", wraps=planning_store.widen_event_actions
        ) as widen:
            store.connect().close()
        # Asked, and found nothing to widen: the table is the one the upgrade built.
        self.assertTrue(widen.called)
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual({"preschema15": 1}, self.taken())

    def test_a_failed_attempt_leaves_the_store_at_14(self) -> None:
        shape, before = self.source(14)
        original = planning_store.migrate_threads

        def fail_after_the_step(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected after the schema-15 rebuild")

        with mock.patch.object(planning_store, "migrate_threads", side_effect=fail_after_the_step):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(14, raw.execute("PRAGMA user_version").fetchone()[0])
            self.assertNotIn(ADDED_ACTION, _event_actions(raw))
            self.assertEqual(before, _rows(raw, shape))
        finally:
            raw.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_15(conn)
        self.assertEqual({"preschema15": 1}, self.taken())

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assert_reached_15(fresh)
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

    def test_a_build_that_knows_only_14_refuses_a_store_at_15(self) -> None:
        self.source(14)
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 14):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual(
            (store.STORE_SCHEMA_VERSION, 14),
            (refusal.exception.stored, refusal.exception.supported),
        )
        self.assertEqual(before, Path(self.path).read_bytes())


if __name__ == "__main__":
    unittest.main()
