"""Schema 16: the usage columns, one row per request, the reading, and the analytics counts.

The sources are stores built from the catalogs the last schema-15 and schema-14 builds
created, holding planning rows and usage rows as those builds wrote them, several
requests counted in more than one run among them, and a liveness file. What this suite
holds the migration to: every former value of every former column stays byte for byte,
the new columns arrive empty and every run is stale, the analytics counts and the
requests runs left to another arrive as empty tables, each request keeps exactly the row
of the run the rule puts first, all of it under one recovery point with a verified copy
of the liveness file beside it, which holds no counts -- `preschema16` for a store at 15,
and for a store at 14 the one `preschema15` point that covers schema 15's step as well;
a second open writes nothing, the recovery point brings back the former store with its
per-run key and the migration runs again, a failed attempt leaves the store at the
version it had, a fresh store has the same catalog directly, and a build that knows only
15 refuses the result. The new names and the rule's outcome are stated here rather than
read from the code under test.
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
from server.telemetry import liveness, usage_store
from tests import schema9, schema14, schema15
from tests.test_schema12_migration import _catalog, _columns, _event_actions, _shape

ADDED = {
    "usage_runs": [
        "launch_class",
        "reading",
        "reread_refused",
        "refused_reading",
        "reread_at",
        "priced_with",
    ],
    "usage_segments": ["organization", "environment", "effort", "advisor", "advisor_model"],
}
#: The table schema 16 adds, as Analytics declares it: a day, a kind and a count.
COUNTS = "analytics_surface_uses"
#: The table schema 16 adds for the requests a run left to another: one row per run and
#: request, read by the request when a holder gives one up.
YIELDS = "usage_yields"
#: The history event schema 15 admitted, which the step to 16 must not take away.
LABEL_EVENT = "labels_changed"
#: The builds of the source stores, from the catalogs those builds created.
SOURCES = {14: schema14.build, 15: schema15.build}
#: The item `schema9.populate` holds.
HELD = "11111111-1111-4111-8111-111111111111"
#: Runs as the schema-14 and schema-15 builds wrote them: id, session, agent, first record.
RUNS = (
    (11, "main-late", "", "2030-03-04T09:05:00.000Z"),
    (12, "main-early", "worker", "2030-03-04T09:00:00.000Z"),
    (13, "main-early", "", "2030-03-04T09:00:10.000Z"),
    (14, "main-unread", "", None),
    (15, "main-same", "", "2030-03-04T09:05:00.000Z"),
)
#: Which runs counted which request, and which one keeps it. Above the last level of the
#: rule, the run that keeps a request has the higher id, so keeping the lowest is wrong.
COUNTED = {
    # A main transcript's run before a subagent's, though the subagent's began first.
    101: ((12, 13), 13),
    # Two main runs: the earlier first record.
    102: ((11, 13), 13),
    # The same first record: the lower id.
    103: ((15, 11), 11),
    # A run with no first record comes after one with.
    104: ((14, 15), 15),
    # A row whose run is gone comes after every other.
    105: ((9, 12), 12),
    # Counted once already.
    106: ((15,), 15),
}


def _former_rows(conn: sqlite3.Connection, shape: dict[str, list[str]]) -> dict[str, list]:
    """Every row of every former table but the requests, each value as SQLite quotes it."""

    return {
        table: sorted(
            conn.execute(
                f"SELECT {', '.join(f'quote({name})' for name in names)} FROM {table}"
            ).fetchall()
        )
        for table, names in shape.items()
        if table != "usage_requests"
    }


def _requests(conn: sqlite3.Connection) -> list[tuple]:
    return sorted(tuple(row) for row in conn.execute("SELECT request, run_id FROM usage_requests"))


def _key(conn: sqlite3.Connection, table: str = "usage_requests") -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(row[1]) for row in sorted(rows, key=lambda row: row[5]) if row[5]]


class _SchemaSixteen(unittest.TestCase):
    """The step to 16 from one source version; a subclass names the source."""

    SOURCE: int
    #: The one recovery point the upgrade takes, named for the oldest step it covers.
    LABEL: str

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
            conn.row_factory = None
            for run_id, session, agent, first_at in RUNS:
                conn.execute(
                    "INSERT INTO usage_runs(id, session_id, agent_id, client, path, read_offset,"
                    " state, human_seconds, first_at, last_at, read_at)"
                    " VALUES (?, ?, ?, 'claude', ?, 120, '{\"clock\":{}}', 1.5, ?, ?, ?)",
                    (run_id, session, agent, f"{session}.jsonl", first_at, first_at, first_at),
                )
                conn.execute(
                    "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at,"
                    " ended_at, seconds, work_item_id, signal, output_tokens,"
                    " estimated_api_cost_usd, price_book, quality, provisional)"
                    " VALUES (?, ?, ?, 'claude-opus-5-5', '2030-03-04T09:00:00.000Z',"
                    " '2030-03-04T09:00:30.000Z', 30.0, ?, 'last_write', 7, 0.000175,"
                    " '2026-11-10', 'observed', ?)",
                    (run_id, session, agent, HELD if run_id % 2 else None, run_id % 2),
                )
            for request, (runs, _keeper) in COUNTED.items():
                for run_id in runs:
                    conn.execute(
                        "INSERT INTO usage_requests(run_id, request) VALUES (?, ?)",
                        (run_id, request),
                    )
            conn.commit()
            self.assertEqual(self.SOURCE, conn.execute("PRAGMA user_version").fetchone()[0])
            self.shape = _columns(conn)
            self.before = _former_rows(conn, self.shape)
            self.former_requests = _requests(conn)
            self.former_key = _key(conn)
        finally:
            conn.close()
        self.assertEqual(["run_id", "request"], self.former_key, "the source's per-run key")
        liveness.tick(self.path, 1_900_000_000.0)
        liveness.tick(self.path, 1_900_000_060.0)
        self.intervals = liveness.intervals(self.path)

    def snapshots(self, label: str | None = None) -> list[Path]:
        return sorted((self.root / "backups").glob(f"*-{label or self.LABEL}-*.sqlite3"))

    def every_snapshot(self) -> list[Path]:
        return sorted((self.root / "backups").glob("*.sqlite3"))

    def assert_reached_16(self, conn: sqlite3.Connection) -> None:
        self.assertEqual(16, conn.execute("PRAGMA user_version").fetchone()[0])
        columns = _columns(conn)
        for table, added in ADDED.items():
            with self.subTest(table=table):
                self.assertEqual(self.shape[table] + added, columns[table])
        self.assertEqual(["request"], _key(conn))
        self.assertEqual(["request", "run_id", "request_id"], columns["usage_requests"])
        self.assertEqual(
            ["run_id"],
            [row[2] for row in conn.execute("PRAGMA index_info(usage_requests_run)")],
            "the claims of one run are read by the run",
        )
        self.assertEqual(["day", "kind", "count"], columns[COUNTS])
        self.assertEqual(0, conn.execute(f"SELECT COUNT(*) FROM {COUNTS}").fetchone()[0])
        self.assertEqual(["run_id", "request"], columns[YIELDS])
        self.assertEqual(["run_id", "request"], _key(conn, YIELDS))
        self.assertEqual(
            ["request"],
            [row[2] for row in conn.execute("PRAGMA index_info(usage_yields_request)")],
            "the runs that left a request are read by the request",
        )
        self.assertEqual(0, conn.execute(f"SELECT COUNT(*) FROM {YIELDS}").fetchone()[0])
        self.assertIn(LABEL_EVENT, _event_actions(conn))
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

    def assert_untouched(self) -> None:
        """The store is the source as it was: its version, its usage tables, its rows."""

        conn = sqlite3.connect(self.path)
        try:
            self.assertEqual(self.SOURCE, conn.execute("PRAGMA user_version").fetchone()[0])
            columns = _columns(conn)
            self.assertEqual(self.shape, columns)
            self.assertEqual(self.former_key, _key(conn))
            self.assertEqual(self.former_requests, _requests(conn))
            self.assertEqual(self.before, _former_rows(conn, self.shape))
        finally:
            conn.close()

    def test_the_store_reaches_16_keeping_every_former_value(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.row_factory = None
        self.assert_reached_16(conn)
        self.assertEqual(self.before, _former_rows(conn, self.shape))
        self.assertEqual(
            {(0, None, None, None, None, None)},
            set(
                conn.execute(
                    "SELECT reading, launch_class, reread_refused, refused_reading, reread_at,"
                    " priced_with FROM usage_runs"
                ).fetchall()
            ),
            "every run is stale and nothing else is known of it",
        )
        self.assertEqual(
            {(None, None, None, 0, None)},
            set(
                conn.execute(
                    "SELECT organization, environment, effort, advisor, advisor_model"
                    " FROM usage_segments"
                ).fetchall()
            ),
        )

    def test_each_request_keeps_the_row_of_the_run_the_rule_puts_first(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            sorted((request, keeper) for request, (_runs, keeper) in COUNTED.items()),
            _requests(conn),
        )
        self.assertEqual(
            [None],
            [row[0] for row in conn.execute("SELECT DISTINCT request_id FROM usage_requests")],
        )

    def test_one_recovery_point_with_the_liveness_file_beside_it(self) -> None:
        store.connect().close()
        [snapshot] = self.snapshots()
        self.assertEqual([snapshot], self.every_snapshot(), "no other point is taken")
        self.assertEqual(str(snapshot), liveness.recovery_point(self.path))
        self.assertEqual(self.intervals, liveness.intervals(str(snapshot)))
        copy = liveness.path_for(str(snapshot))
        self.assertEqual(
            store_backups.snapshot_identity(liveness.path_for(self.path)),
            store_backups.snapshot_identity(copy),
        )
        backup = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(self.SOURCE, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertNotIn(COUNTS, _columns(backup), "the store as it was, before the counts")
        self.assertNotIn(YIELDS, _columns(backup), "the store as it was, before the yields")
        self.assertEqual(self.before, _former_rows(backup, self.shape))
        self.assertEqual(self.former_requests, _requests(backup))

    def test_the_recovery_point_restores_the_source_with_its_per_run_key(self) -> None:
        store.connect().close()
        [snapshot] = self.snapshots()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        # Restoring is copying the snapshot and the liveness file beside it.
        shutil.copyfile(snapshot, self.path)
        shutil.copyfile(liveness.path_for(str(snapshot)), liveness.path_for(self.path))
        restored = sqlite3.connect(self.path)
        try:
            self.assertEqual(self.SOURCE, restored.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(["run_id", "request"], _key(restored))
            self.assertNotIn(YIELDS, _columns(restored))
            self.assertEqual(self.former_requests, _requests(restored))
            self.assertEqual(self.before, _former_rows(restored, self.shape))
        finally:
            restored.close()
        self.assertEqual(self.intervals, liveness.intervals(self.path))
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.row_factory = None
        self.assert_reached_16(conn)
        self.assertEqual(self.before, _former_rows(conn, self.shape))
        self.assertEqual(1, len(self.every_snapshot()))

    def test_reopening_a_store_at_16_writes_nothing(self) -> None:
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual(1, len(self.every_snapshot()))

    def test_a_failed_snapshot_leaves_the_store_as_it_was(self) -> None:
        with (
            mock.patch.object(
                store_backups, "integrity_check", side_effect=RuntimeError("the check failed")
            ),
            self.assertRaises(RuntimeError),
        ):
            store.connect()
        self.assert_untouched()

    def test_a_failure_after_the_usage_step_leaves_the_store_as_it_was(self) -> None:
        original = usage_store.migrate

        def fail_after_the_step(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected after the schema-16 step")

        with (
            mock.patch.object(usage_store, "migrate", side_effect=fail_after_the_step),
            self.assertRaisesRegex(RuntimeError, "injected"),
        ):
            store.connect()
        self.assert_untouched()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assert_reached_16(conn)
        self.assertEqual([self.snapshots()[0]], self.every_snapshot())

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

    def test_a_build_that_knows_only_15_refuses_a_store_at_16(self) -> None:
        store.connect().close()
        before = Path(self.path).read_bytes()
        with (
            mock.patch.object(store, "STORE_SCHEMA_VERSION", 15),
            self.assertRaises(store.StoreTooNewError) as refusal,
        ):
            store.connect()
        self.assertEqual((16, 15), (refusal.exception.stored, refusal.exception.supported))
        self.assertEqual(before, Path(self.path).read_bytes())


class FromFifteenTests(_SchemaSixteen):
    """A store the schema-15 build wrote takes the step alone, under `preschema16`."""

    SOURCE = 15
    LABEL = "preschema16"


class FromFourteenTests(_SchemaSixteen):
    """A store at 14 takes schema 15's step and this one in one open, under `preschema15`."""

    SOURCE = 14
    LABEL = "preschema15"

    def test_the_source_lacks_the_label_event_and_the_upgrade_admits_it(self) -> None:
        conn = sqlite3.connect(self.path)
        try:
            self.assertNotIn(LABEL_EVENT, _event_actions(conn))
        finally:
            conn.close()
        store.connect().close()
        self.assertEqual([], self.snapshots("preschema16"), "both steps share one point")


del _SchemaSixteen

if __name__ == "__main__":
    unittest.main()
