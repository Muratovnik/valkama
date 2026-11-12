"""Schema 17: the subscription quota's accounts and samples.

The sources are stores built from the catalogs the last schema-16 and schema-15 builds
created, populated as those builds wrote them. What this suite holds the migration to:
both tables arrive empty with the columns stated here, every former row stays as it
was, all of it under one recovery point -- `preschema17` for a store at 16, and for a
store at 15 the one `preschema16` point that covers schema 16's step as well -- a second
open writes nothing, the recovery point brings the store back and the migration runs
again, a fresh store has the same catalog directly, and a build that knows only 16
refuses the result. Then the guarantee the tables are kept for: a snapshot of a store
holding samples, restored, gives the samples and the accounts back.
"""

from __future__ import annotations

import datetime as dt
import os
import shutil
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.quota import samples
from tests import schema9, schema15, schema16
from tests.test_schema12_migration import _catalog, _columns, _rows, _shape

#: The tables schema 17 adds and their columns, in order.
ADDED = {
    "quota_accounts": ["organization", "seat", "plan", "label"],
    "quota_samples": [
        "id",
        "at",
        "source",
        "organization",
        "session_id",
        "seat",
        "kind",
        "model",
        "percent",
        "resets_at",
        "amount",
        "currency",
    ],
}
SOURCES: dict[int, Callable[[str], None]] = {15: schema15.build, 16: schema16.build}
LABELS = ("preschema16", "preschema17", "pretables", "preupgrade", "preidentity")
NOW = dt.datetime(2030, 3, 5, tzinfo=dt.UTC)
ORGANIZATION = "org-1"


class _SchemaSeventeen(unittest.TestCase):
    SOURCE = 16
    LABEL = "preschema17"

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        SOURCES[self.SOURCE](self.path)
        conn = sqlite3.connect(self.path)
        try:
            schema9.populate(conn)
            conn.commit()
            self.assertEqual(self.SOURCE, conn.execute("PRAGMA user_version").fetchone()[0])
            self.shape = _columns(conn)
            self.before = _rows(conn, self.shape)
        finally:
            conn.close()
        for table in ADDED:
            self.assertNotIn(table, self.shape)

    def snapshots(self, label: str | None = None) -> list[Path]:
        return sorted((self.root / "backups").glob(f"*-{label or self.LABEL}-*.sqlite3"))

    def taken(self) -> dict[str, int]:
        return {label: len(self.snapshots(label)) for label in LABELS if self.snapshots(label)}

    def assert_reached_17(self, conn: sqlite3.Connection) -> None:
        self.assertEqual(17, conn.execute("PRAGMA user_version").fetchone()[0])
        columns = _columns(conn)
        for table, names in ADDED.items():
            with self.subTest(table=table):
                self.assertEqual(names, columns[table])
                self.assertEqual(0, conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

    def test_the_store_reaches_17_keeping_every_former_row(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.row_factory = None
        self.assert_reached_17(conn)
        self.assertEqual(self.before, _rows(conn, self.shape))

    def test_one_recovery_point_holding_the_source_as_it_was(self) -> None:
        store.connect().close()
        self.assertEqual({self.LABEL: 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots()[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(self.SOURCE, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(self.shape, _columns(backup))
        self.assertEqual(self.before, _rows(backup, self.shape))

    def test_the_recovery_point_restores_the_source_and_the_migration_runs_again(self) -> None:
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(self.snapshots()[0], self.path)
        restored = sqlite3.connect(self.path)
        try:
            self.assertEqual(self.SOURCE, restored.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(self.shape, _columns(restored))
        finally:
            restored.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.row_factory = None
        self.assert_reached_17(conn)
        self.assertEqual(self.before, _rows(conn, self.shape))
        # The restored store is the point's own source, so the replay reuses it.
        self.assertEqual({self.LABEL: 1}, self.taken())

    def test_reopening_a_store_at_17_writes_nothing(self) -> None:
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual({self.LABEL: 1}, self.taken())

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        migrated = store.connect()
        self.addCleanup(migrated.close)
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assertEqual(_shape(fresh), _shape(migrated))
        for kind in ("table", "index", "trigger"):
            with self.subTest(kind=kind):
                self.assertEqual(_catalog(fresh, kind), _catalog(migrated, kind))

    def test_a_build_that_knows_only_16_refuses_a_store_at_17(self) -> None:
        store.connect().close()
        before = Path(self.path).read_bytes()
        with (
            mock.patch.object(store, "STORE_SCHEMA_VERSION", 16),
            self.assertRaises(store.StoreTooNewError) as refusal,
        ):
            store.connect()
        self.assertEqual((17, 16), (refusal.exception.stored, refusal.exception.supported))
        self.assertEqual(before, Path(self.path).read_bytes())


class FromSixteenTests(_SchemaSeventeen):
    """A store the schema-16 build wrote takes the step alone, under `preschema17`."""

    def test_a_snapshot_restored_gives_the_samples_and_accounts_back(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        reading = samples.Reading(
            source="poll",
            at="2030-03-04T09:00:00Z",
            windows=(
                samples.Window("five_hour", 12.0, "2030-03-04T12:00:00Z"),
                samples.Window("week", 40.5, "2030-03-08T09:00:00Z"),
            ),
            seat="week:2030-03-08T09:00Z",
            organization=ORGANIZATION,
            plan="Team",
        )
        with conn:
            self.assertEqual(2, samples.record(conn, reading, now=NOW))
        kept = conn.execute("SELECT * FROM quota_samples ORDER BY id").fetchall()
        accounts = conn.execute("SELECT * FROM quota_accounts").fetchall()
        self.assertEqual(2, len(kept))
        point = store_backups.snapshot(conn, store.backup_location(), "manual")
        with conn:
            conn.execute("DELETE FROM quota_samples")
            conn.execute("DELETE FROM quota_accounts")
        conn.close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(point, self.path)
        restored = store.connect()
        self.addCleanup(restored.close)
        self.assertEqual(
            [tuple(row) for row in kept],
            [tuple(row) for row in restored.execute("SELECT * FROM quota_samples ORDER BY id")],
        )
        self.assertEqual(
            [tuple(row) for row in accounts],
            [tuple(row) for row in restored.execute("SELECT * FROM quota_accounts")],
        )
        self.assertEqual(
            [("org-1", "week:2030-03-08T09:00Z", "Team", None)],
            [tuple(row) for row in accounts],
        )


class FromFifteenTests(_SchemaSeventeen):
    """A store at 15 takes schema 16's step and this one in one open, under `preschema16`."""

    SOURCE = 15
    LABEL = "preschema16"

    def test_both_steps_share_one_point(self) -> None:
        store.connect().close()
        self.assertEqual([], self.snapshots("preschema17"))


del _SchemaSeventeen

if __name__ == "__main__":
    unittest.main()
