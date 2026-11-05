"""Schema 12: a question on a root comment, the mention action and a person's pins.

The sources are stores built from the catalogs the last schema-10 and schema-11
builds created, populated as those builds wrote them. What this suite holds the
migration to: every existing value stays, the column, the table, the action and
the two indexes arrive once -- a store at 10 under the one recovery point
`preschema11` that covers both steps, a store at 11 under `preschema12` -- a second
open writes nothing, the recovery point brings the store back and the migration
runs again, a fresh store has the same catalog directly, and a build that knows
only 11 refuses the result. The new names are stated here rather than read from
the code under test.
"""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from server import store
from server.planning import store as planning_store
from tests import schema9, schema10, schema11

ADDED_TABLE = "pinned_work_items"
PIN_COLUMNS = ["work_item_id", "pinned_at", "call_id"]
ADDED_INDEXES = {"work_item_requests_comment", "work_item_events_mentioned"}
ADDED_ACTION = "mentioned"
#: The item `schema9.populate` holds, with its history and its question, and the
#: one linked to it, which nothing else names.
HELD = "11111111-1111-4111-8111-111111111111"
LINKED = "22222222-2222-4222-8222-222222222222"
#: Every label an upgrade could take; each source must take exactly one of them.
LABELS = (
    "preschema9",
    "preschema10",
    "preschema11",
    "preschema12",
    "preproductmodel",
    "preinteractions",
    "preidentity",
    "pretables",
    "preupgrade",
)


def _catalog(conn: sqlite3.Connection, kind: str) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND sql IS NOT NULL"
            " AND name NOT LIKE 'sqlite_%'",
            (kind,),
        )
    }


def _event_actions(conn: sqlite3.Connection) -> set[str]:
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='work_item_events'").fetchone()[0]
    found = re.search(r"CHECK\s*\(\s*action\s+IN\s*\(([^)]*)\)", sql, flags=re.IGNORECASE)
    assert found is not None
    return set(re.findall(r"'([^']+)'", found.group(1)))


def _sql(text: str) -> str:
    """A definition with the spelling SQLite's history leaves in it removed."""

    text = re.sub(r"\s+", " ", text.replace('"', "")).strip()
    return text.replace(" IF NOT EXISTS ", " ")


def _shape(conn: sqlite3.Connection) -> dict[str, object]:
    """What a reader of the store depends on: every table's columns in order with
    their types, defaults and keys, its foreign keys, every index and trigger as
    text, and the actions the event table admits."""

    tables = {
        table: (
            [tuple(row)[1:] for row in conn.execute(f"PRAGMA table_xinfo({table})")],
            [tuple(row)[2:] for row in conn.execute(f"PRAGMA foreign_key_list({table})")],
        )
        for table in sorted(_catalog(conn, "table"))
    }
    definitions = {
        kind: {
            str(row[0]): (str(row[1]), _sql(str(row[2])))
            for row in conn.execute(
                "SELECT name, tbl_name, sql FROM sqlite_master"
                " WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
                (kind,),
            )
        }
        for kind in ("index", "trigger")
    }
    return {"tables": tables, "events": _event_actions(conn), **definitions}


def _columns(conn: sqlite3.Connection) -> dict[str, list[str]]:
    return {
        table: [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]
        for table in sorted(_catalog(conn, "table"))
    }


def _rows(conn: sqlite3.Connection, shape: dict[str, list[str]]) -> dict[str, list[tuple]]:
    """Every row of each source table, read through the columns the source had.

    Ordered by every column, since one of the tables has no rowid to order by.
    """

    return {
        table: [
            tuple(row)
            for row in conn.execute(
                f"SELECT {', '.join(names)} FROM {table} ORDER BY {', '.join(names)}"
            )
        ]
        for table, names in shape.items()
    }


def _source(build: Callable[[str], None], path: str) -> None:
    build(path)
    conn = sqlite3.connect(path)
    try:
        schema9.populate(conn)
        conn.commit()
    finally:
        conn.close()


SOURCES = {10: schema10.build, 11: schema11.build}


class SchemaTwelveTests(unittest.TestCase):
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

        _source(SOURCES[version], self.path)
        conn = sqlite3.connect(self.path)
        try:
            self.assertEqual(version, conn.execute("PRAGMA user_version").fetchone()[0])
            self.assertNotIn(ADDED_TABLE, _catalog(conn, "table"))
            self.assertNotIn(ADDED_ACTION, _event_actions(conn))
            self.assertTrue(conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0])
            shape = _columns(conn)
            return shape, _rows(conn, shape)
        finally:
            conn.close()

    def snapshots(self, label: str) -> list[Path]:
        return list((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def taken(self) -> dict[str, int]:
        return {label: len(self.snapshots(label)) for label in LABELS if self.snapshots(label)}

    def assert_reached_12(self, conn: sqlite3.Connection) -> None:
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertIn(ADDED_TABLE, _catalog(conn, "table"))
        self.assertEqual(
            PIN_COLUMNS, [row[1] for row in conn.execute(f"PRAGMA table_info({ADDED_TABLE})")]
        )
        self.assertLessEqual(ADDED_INDEXES, _catalog(conn, "index"))
        requests = [row[1] for row in conn.execute("PRAGMA table_info(work_item_requests)")]
        self.assertEqual("comment_id", requests[-1])
        self.assertIn(ADDED_ACTION, _event_actions(conn))
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

    def test_a_store_at_10_reaches_12_under_one_preschema11_point(self) -> None:
        shape, before = self.source(10)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_12(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        # One point for both steps, named for the oldest, holding the source as it was.
        self.assertEqual({"preschema11": 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots('preschema11')[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(10, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual("ok", backup.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual(before, _rows(backup, shape))

    def test_a_store_at_11_reaches_12_under_preschema12(self) -> None:
        shape, before = self.source(11)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_12(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        self.assertEqual({"preschema12": 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots('preschema12')[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(11, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(before, _rows(backup, shape))

    def test_the_migrated_store_holds_what_schema_12_means(self) -> None:
        """The rebuilt event table admits the new action and still refuses an unknown
        one; a pin and a list go with what they stand on."""

        self.source(11)
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author) VALUES(?,?,'7','a')",
            (HELD, ADDED_ACTION),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO work_item_events(work_item_id,action,author) VALUES(?,'invented','a')",
                (HELD,),
            )
        root = conn.execute(
            "INSERT INTO work_item_comments(work_item_id,author,body) VALUES(?,'a','Pick some')",
            (HELD,),
        ).lastrowid
        conn.execute(
            "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,"
            "author,created_at,comment_id) VALUES('list',?,'question','Pick','[]','a','now',?)",
            (HELD, root),
        )
        conn.execute(f"INSERT INTO {ADDED_TABLE}(work_item_id) VALUES(?)", (LINKED,))
        pinned_at = conn.execute(f"SELECT pinned_at FROM {ADDED_TABLE}").fetchone()[0]
        self.assertRegex(pinned_at, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(f"INSERT INTO {ADDED_TABLE}(work_item_id) VALUES(?)", (LINKED,))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(f"INSERT INTO {ADDED_TABLE}(work_item_id) VALUES('no-such-item')")
        conn.execute("DELETE FROM work_item_comments WHERE id=?", (root,))
        self.assertIsNone(
            conn.execute("SELECT 1 FROM work_item_requests WHERE request_id='list'").fetchone()
        )
        conn.execute("DELETE FROM work_items WHERE work_item_id=?", (LINKED,))
        self.assertEqual(0, conn.execute(f"SELECT COUNT(*) FROM {ADDED_TABLE}").fetchone()[0])
        conn.rollback()

    def restore_and_replay(self, version: int, label: str) -> None:
        shape, before = self.source(version)
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(self.snapshots(label)[0], self.path)
        restored = sqlite3.connect(self.path)
        self.assertEqual(version, restored.execute("PRAGMA user_version").fetchone()[0])
        self.assertNotIn(ADDED_TABLE, _catalog(restored, "table"))
        self.assertNotIn(ADDED_ACTION, _event_actions(restored))
        restored.close()

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_12(conn)
        conn.row_factory = None
        self.assertEqual(before, _rows(conn, shape))
        # The restored store is the point's own source, so the replay reuses it.
        self.assertEqual({label: 1}, self.taken())

    def test_preschema11_restores_10_and_the_migration_runs_again(self) -> None:
        self.restore_and_replay(10, "preschema11")

    def test_preschema12_restores_11_and_the_migration_runs_again(self) -> None:
        self.restore_and_replay(11, "preschema12")

    def test_reopening_a_store_at_12_writes_nothing(self) -> None:
        self.source(11)
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual({"preschema12": 1}, self.taken())

    def test_a_failed_attempt_leaves_the_store_at_11(self) -> None:
        shape, before = self.source(11)
        original = planning_store.migrate_threads

        def fail_after_the_step(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected after the schema-12 step")

        with mock.patch.object(planning_store, "migrate_threads", side_effect=fail_after_the_step):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(11, raw.execute("PRAGMA user_version").fetchone()[0])
            self.assertNotIn(ADDED_TABLE, _catalog(raw, "table"))
            self.assertNotIn(ADDED_ACTION, _event_actions(raw))
            self.assertEqual(before, _rows(raw, shape))
        finally:
            raw.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_12(conn)
        self.assertEqual({"preschema12": 1}, self.taken())

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assert_reached_12(fresh)
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

    def test_a_build_that_knows_only_11_refuses_a_store_at_12(self) -> None:
        self.source(11)
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 11):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual(
            (store.STORE_SCHEMA_VERSION, 11),
            (refusal.exception.stored, refusal.exception.supported),
        )
        self.assertEqual(before, Path(self.path).read_bytes())


if __name__ == "__main__":
    unittest.main()
