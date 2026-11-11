"""Schema 10 onward: the usage tables, under one recovery point of their own.

The source is a store built from the catalog the last schema-10 build created. What
this suite holds the migration to: every existing value stays, the three tables and
their indexes arrive once under one recovery point labelled `preschema11`, which also
covers the rest of the chain to this build's own schema, a second
open writes nothing, a fresh store has the same catalog directly, the recovery point
brings the store back to 10, and a schema-10 build refuses the result. The new names
are stated here rather than read from the code under test.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store, store_backups
from tests import schema9, schema10

ADDED_TABLES = {"usage_runs", "usage_segments", "usage_requests"}
#: Schema 12's to 16's: the chain runs on to this build's own schema in the same open.
LATER_TABLES = {
    "usage_yields",
    "pinned_work_items",
    "work_item_subscriptions",
    "work_item_images",
    "analytics_surface_uses",
}
LATER_COLUMNS = {"work_item_requests": {"comment_id"}, "work_item_comments": {"awaits_reply"}}
ADDED_INDEXES = {
    "usage_segments_item",
    "usage_segments_session",
    "usage_segments_provisional",
}
#: What a future query may rely on finding in every row of a segment.
SEGMENT_COLUMNS = {
    "session_id",
    "agent_id",
    "model",
    "started_at",
    "ended_at",
    "seconds",
    "work_item_id",
    "signal",
    "input_tokens",
    "cached_read_tokens",
    "cache_write_5m_tokens",
    "cache_write_1h_tokens",
    "output_tokens",
    "reasoning_tokens",
    "estimated_api_cost_usd",
    "price_book",
    "quality",
}


def _catalog(conn: sqlite3.Connection, kind: str) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = ? AND sql IS NOT NULL", (kind,)
        )
    }


def _rows(conn: sqlite3.Connection) -> dict[str, list[tuple]]:
    tables = sorted(_catalog(conn, "table") - ADDED_TABLES - LATER_TABLES)
    return {
        table: [
            tuple(row)
            for row in conn.execute(f"SELECT {_kept(conn, table)} FROM {table} ORDER BY 1")
        ]
        for table in tables
    }


def _kept(conn: sqlite3.Connection, table: str) -> str:
    """The table's columns, less those the later steps append."""

    later = LATER_COLUMNS.get(table, set())
    names = [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]
    return ", ".join(name for name in names if name not in later)


class SchemaElevenTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        schema10.build(self.path)
        conn = sqlite3.connect(self.path)
        schema9.populate(conn)
        conn.commit()
        self.before = _rows(conn)
        conn.close()

    def snapshots(self, label: str = "preschema11") -> list[Path]:
        return list((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def test_a_schema_10_store_reaches_11_and_keeps_every_value(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertTrue(_catalog(conn, "table") >= ADDED_TABLES)
        self.assertTrue(_catalog(conn, "index") >= ADDED_INDEXES)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(usage_segments)")}
        self.assertTrue(columns >= SEGMENT_COLUMNS, SEGMENT_COLUMNS - columns)
        conn.row_factory = None
        self.assertEqual(self.before, _rows(conn))

    def test_one_recovery_point_holds_the_source_and_a_second_open_takes_none(self) -> None:
        store.connect().close()
        snapshots = self.snapshots()
        self.assertEqual(1, len(snapshots))
        self.assertEqual([], self.snapshots("preschema10"))
        backup = sqlite3.connect(f"file:{snapshots[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual("ok", backup.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual(10, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(self.before, _rows(backup))

        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual(1, len(self.snapshots()))

    def test_the_recovery_point_restores_10_and_the_migration_runs_again(self) -> None:
        store.connect().close()
        snapshot = self.snapshots()[0]
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(snapshot, self.path)
        restored = sqlite3.connect(self.path)
        self.assertEqual(10, restored.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(set(), ADDED_TABLES & _catalog(restored, "table"))
        restored.close()

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        conn.row_factory = None
        self.assertEqual(self.before, _rows(conn))

    def test_a_failed_attempt_leaves_the_store_at_10(self) -> None:
        with mock.patch.object(
            store_backups, "integrity_check", side_effect=RuntimeError("the check failed")
        ):
            with self.assertRaises(RuntimeError):
                store.connect()
        conn = sqlite3.connect(self.path)
        self.addCleanup(conn.close)
        self.assertEqual(10, conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(set(), ADDED_TABLES & _catalog(conn, "table"))

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        migrated = store.connect()
        self.addCleanup(migrated.close)
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        for kind in ("table", "index", "trigger"):
            with self.subTest(kind=kind):
                self.assertEqual(_catalog(fresh, kind), _catalog(migrated, kind))
        for table in ADDED_TABLES:
            with self.subTest(table=table):
                self.assertEqual(
                    [tuple(row) for row in fresh.execute(f"PRAGMA table_info({table})")],
                    [tuple(row) for row in migrated.execute(f"PRAGMA table_info({table})")],
                )

    def test_a_schema_10_build_refuses_the_migrated_store_before_writing(self) -> None:
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 10):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual(
            (store.STORE_SCHEMA_VERSION, 10),
            (refusal.exception.stored, refusal.exception.supported),
        )
        self.assertEqual(before, Path(self.path).read_bytes())


if __name__ == "__main__":
    unittest.main()
