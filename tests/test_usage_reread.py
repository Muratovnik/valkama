"""The background reader reads stale runs again, after what is new and inside its budget.

Time inside a pass is a clock the test moves: one second per run read again, none for
anything else, so a pass of 2.5 seconds starts exactly three. A large run is read in
chunks the clock counts instead. A run is made stale the way the schema-15 upgrade
leaves every run, by its `reading` at 0.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.hooks import ingest
from server.ops import doctor
from server.telemetry import (
    liveness,
    usage_collect,
    usage_ledger,
    usage_prices,
    usage_rebuild,
    usage_reread,
)
from server.telemetry.usage_store import READING
from tests import schema14
from tests.usage_fixtures import HOUR, ORG_A, Case, ClaudeRun, advised, epoch, stamp, usage

#: A pass's budget: at one second per run it starts three.
BUDGET = 2.5


#: More passes than any test here needs; a reader still busy after them never ends.
MOST_PASSES = 20


def drain(reader: usage_reread.Reader, seconds: float = BUDGET) -> None:
    """Run passes until nothing is left, and fail the test when that never comes."""

    for _ in range(MOST_PASSES):
        if not reader.run_pass(lambda _line: None, seconds):
            return
    raise AssertionError(f"the reader still had work after {MOST_PASSES} passes")


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class RereadCase(Case):
    #: What the clock moves for each run read again or gone on with.
    RUN_SECONDS = 1.0

    def setUp(self) -> None:
        super().setUp()
        self.ticks((0, 3 * HOUR))
        self.history = usage_reread.Reader(self.reader, self.store_path)
        self.clock = Clock()
        patch = mock.patch("time.monotonic", self.clock)
        patch.start()
        self.addCleanup(patch.stop)
        self.attempts: list[int] = []
        real = usage_rebuild.rebuild_run

        def one_second(collector, run, *rest, **options):  # type: ignore[no-untyped-def]
            self.attempts.append(int(run["id"]))
            self.clock.now += self.RUN_SECONDS
            return real(collector, run, *rest, **options)

        patch = mock.patch.object(usage_rebuild, "rebuild_run", one_second)
        patch.start()
        self.addCleanup(patch.stop)

    def sessions(self, count: int) -> list[ClaudeRun]:
        runs = []
        for number in range(count):
            run = self.session(f"done-{number}")
            run.prompt(number * 100)
            run.end_turn(number * 100 + 30)
            runs.append(run)
        self.read()
        return runs

    def pass_(self) -> bool:
        return self.history.run_pass(self.said.append, BUDGET)

    def make_stale(self) -> None:
        self.reader.execute("UPDATE usage_runs SET reading = 0")

    def stale(self) -> set[int]:
        return {
            int(row[0])
            for row in self.reader.execute(
                "SELECT id FROM usage_runs WHERE reading < ?", (READING,)
            )
        }

    def snapshots(self) -> list[str]:
        backups = os.path.join(os.path.dirname(self.store_path), "backups")
        if not os.path.isdir(backups):
            return []
        return sorted(
            name
            for name in os.listdir(backups)
            if usage_rebuild.SNAPSHOT_LABEL in name and name.endswith(".sqlite3")
        )

    def doctor_check(self) -> dict:
        (found,) = [check for check in doctor._store_checks() if check["id"] == "usage-reading"]
        return found


class WorkOffTests(RereadCase):
    def test_every_stale_run_is_read_again_while_a_growing_file_goes_on(self) -> None:
        self.sessions(5)
        live = self.session("live")
        live.prompt(0)
        live.end_turn(20)
        self.read()
        totals = self.reader.execute("SELECT ROUND(SUM(seconds), 3) FROM usage_segments").fetchone()
        self.make_stale()
        self.assertEqual(6, len(self.stale()))
        rounds = []
        for number in range(4):
            at = HOUR + number * 600
            live.prompt(at)
            live.end_turn(at + 30)
            before = len(self.attempts)
            more = self.pass_()
            rounds.append((len(self.attempts) - before, len(self.stale()), more))
            # The new turn was read in the same pass.
            self.assertEqual(os.path.getsize(live.path), self.run_row("live")["read_offset"])
        self.assertEqual([(3, 3, True), (3, 0, False), (0, 0, False), (0, 0, False)], rounds)
        added = 4 * 30.0
        self.assertEqual(
            round(float(totals[0]) + added, 3),
            self.reader.execute("SELECT ROUND(SUM(seconds), 3) FROM usage_segments").fetchone()[0],
        )
        rows = self.reader.execute("SELECT reading, reread_at FROM usage_runs").fetchall()
        self.assertTrue(all(row[0] == READING and row[1] for row in rows))

    def test_nothing_is_read_again_while_something_new_is_left(self) -> None:
        self.sessions(2)
        self.make_stale()
        with mock.patch.object(self.history.collector, "run_pass", return_value=True):
            self.assertTrue(self.pass_())
        self.assertEqual([], self.attempts)

    def test_no_run_starts_after_the_deadline(self) -> None:
        self.sessions(2)
        self.make_stale()
        # Nothing new is left, so only the deadline holds the stale runs back.
        with mock.patch.object(self.history.collector, "run_pass", return_value=False):
            self.assertTrue(self.history.run_pass(self.said.append, 0.0))
        self.assertEqual([], self.attempts)
        # Nor is a recovery point taken for a pass with no time to use it.
        self.assertEqual([], self.snapshots())


class RefusalTests(RereadCase):
    def test_a_refused_run_is_tried_once_and_listed_by_reason(self) -> None:
        runs = self.sessions(3)
        runs[0].path.unlink()
        self.make_stale()
        gone = self.run_row("done-0")["id"]
        for _ in range(3):
            self.pass_()
        self.assertEqual(1, self.attempts.count(gone))
        row = self.run_row("done-0")
        self.assertEqual(
            ("missing", READING, 0),
            tuple(row[k] for k in ("reread_refused", "refused_reading", "reading")),
        )
        # A new reader, as after a restart, does not try it again either.
        usage_reread.Reader(self.reader, self.store_path).run_pass(self.said.append, BUDGET)
        self.assertEqual(1, self.attempts.count(gone))
        check = self.doctor_check()
        self.assertEqual("ok", check["status"])
        self.assertEqual(
            {"current": 2, "waiting": 0, "reread": 2, "refused": "missing 1"},
            check["presentation"]["parameters"],
        )

    def test_a_run_moved_meanwhile_is_tried_again_and_not_recorded(self) -> None:
        self.sessions(1)
        self.make_stale()
        real = usage_rebuild.rebuild_run
        calls: list[str] = []

        def moved_once(collector, run, *rest, **options):  # type: ignore[no-untyped-def]
            calls.append("x")
            if len(calls) == 1:
                line = usage_rebuild.RunReport(int(run["id"]), "", "", "claude")
                line.reason = "moved"
                return line
            return real(collector, run, *rest, **options)

        with mock.patch.object(usage_rebuild, "rebuild_run", moved_once):
            self.assertTrue(self.pass_())
            self.assertIsNone(self.run_row("done-0")["reread_refused"])
            self.assertFalse(self.pass_())
        self.assertEqual(2, len(calls))
        self.assertEqual(set(), self.stale())

    def test_the_command_keeps_a_refusal_too(self) -> None:
        runs = self.sessions(2)
        runs[0].path.unlink()
        self.make_stale()
        report = usage_rebuild.rebuild(self.reader, self.store_path)
        self.assertEqual(
            ["missing"],
            [line.reason for line in report.runs if line.outcome == usage_rebuild.REFUSED],
        )
        self.assertEqual(
            {"current": 1, "waiting": 0, "reread": 1, "refused": "missing 1"},
            self.doctor_check()["presentation"]["parameters"],
        )


#: A chunk of a large run, as small as a test can make one, and what reading it costs.
CHUNK = 1500
CHUNK_SECONDS = 0.25
#: A pass's budget for a large run: four chunks.
SLICE_BUDGET = 1.0


class SlicedTests(RereadCase):
    """A stale run too large for one pass is read in slices across passes and resumed."""

    RUN_SECONDS = 0.0

    def setUp(self) -> None:
        super().setUp()
        self.big = self.session("big")
        for number in range(40):
            self.big.prompt(number * 60)
            self.big.end_turn(number * 60 + 20)
        self.live = self.session("live")
        self.live.prompt(0)
        self.live.end_turn(10)
        self.read()
        self.reader.execute("UPDATE usage_runs SET reading = 0 WHERE session_id = 'big'")
        #: Where each chunk of the large run's file was read from, in order.
        self.chunks: list[int] = []
        real = usage_collect._read_lines
        big = os.path.normcase(os.path.abspath(self.big.path))

        def timed(path: str, offset: int, limit: int) -> tuple[list[bytes], int, bool]:
            if os.path.normcase(os.path.abspath(path)) == big:
                self.chunks.append(offset)
                self.clock.now += CHUNK_SECONDS
            return real(path, offset, limit)

        for patch in (
            mock.patch.object(usage_collect, "CHUNK_BYTES", CHUNK),
            mock.patch.object(usage_collect, "_read_lines", timed),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.assertGreater(os.path.getsize(self.big.path), 12 * CHUNK)

    def big_segments(self) -> list[tuple]:
        rows = self.reader.execute("SELECT * FROM usage_segments WHERE session_id = 'big'")
        return sorted(
            (tuple(value for key, value in dict(row).items() if key != "id") for row in rows),
            key=repr,
        )

    def assert_as_one_go(self) -> None:
        """The run is current, and a rebuild of the same bytes in one go makes its rows."""

        self.assertEqual(READING, self.run_row("big")["reading"])
        sliced = self.big_segments()
        self.reader.execute("UPDATE usage_runs SET reading = 0 WHERE session_id = 'big'")
        report = usage_rebuild.rebuild(self.reader, self.store_path, session="big")
        self.assertFalse(report.failed, usage_rebuild.render(report))
        self.assertEqual(sliced, self.big_segments())

    def test_each_pass_stops_at_its_deadline_and_the_next_goes_on(self) -> None:
        per_pass = []
        for number in range(MOST_PASSES):
            at = HOUR + number * 60
            self.live.prompt(at)
            self.live.end_turn(at + 20)
            before = len(self.chunks)
            more = self.history.run_pass(self.said.append, SLICE_BUDGET)
            per_pass.append(len(self.chunks) - before)
            # The growing file was read in the same pass.
            self.assertEqual(os.path.getsize(self.live.path), self.run_row("live")["read_offset"])
            if not more:
                break
        else:
            self.fail("the large run was never read to its end")
        self.assertGreaterEqual(len(per_pass), 3)
        self.assertEqual([4] * (len(per_pass) - 1), per_pass[:-1])
        self.assertTrue(0 < per_pass[-1] <= 4, per_pass)
        # Resumed, never begun again.
        self.assertEqual(1, self.chunks.count(0))
        self.assertEqual(sorted(self.chunks), self.chunks)
        self.assert_as_one_go()

    def test_settings_said_on_a_slice_border_read_as_in_one_go(self) -> None:
        # Slices of one record each, a pass of four: every record that says what the work
        # after it runs under ends a slice, and some end a pass.
        run = self.session("turns")
        for number in range(6):
            at = 2 * HOUR + number * 60
            run.prompt(at)
            run.reply(at + 5, tools=((f"t{number}", "Bash"),), effort=("high", "low")[number % 2])
            run.credential(at + 10, (ORG_A, "org-0002")[number % 2])
            run.result(at + 15, f"t{number}")
            run.end_turn(at + 20, effort=("high", "low")[number % 2], perTurnEffort="max")
        with mock.patch.object(usage_collect, "CHUNK_BYTES", 1 << 30):
            self.read()
        one_go = self.segments_of("turns")
        self.assertEqual({ORG_A, "org-0002"}, {row[3] for row in one_go} - {None})
        self.reader.execute(
            "UPDATE usage_runs SET reading = ? WHERE session_id = 'big'", (READING,)
        )
        self.reader.execute("UPDATE usage_runs SET reading = 0 WHERE session_id = 'turns'")
        timed = usage_collect._read_lines
        turns = os.path.normcase(os.path.abspath(run.path))
        lines: list[int] = []

        def one_record(path: str, offset: int, limit: int) -> tuple[list[bytes], int, bool]:
            if os.path.normcase(os.path.abspath(path)) == turns:
                lines.append(offset)
                self.clock.now += CHUNK_SECONDS
            return timed(path, offset, limit)

        with (
            mock.patch.object(usage_collect, "CHUNK_BYTES", 1),
            mock.patch.object(usage_collect, "_read_lines", one_record),
        ):
            drain(self.history, SLICE_BUDGET)
        records = run.path.read_bytes().count(b"\n")
        self.assertEqual(records, len(set(lines)))
        self.assertEqual(READING, self.run_row("turns")["reading"])
        self.assertEqual(one_go, self.segments_of("turns"))

    def segments_of(self, session: str) -> list[tuple]:
        rows = self.reader.execute(
            "SELECT started_at, ended_at, seconds, organization, environment, effort, advisor,"
            " advisor_model, model, input_tokens, output_tokens FROM usage_segments"
            " WHERE session_id = ? ORDER BY started_at, advisor",
            (session,),
        )
        return [tuple(row) for row in rows]

    def test_a_run_that_moved_drops_its_reading_and_begins_again(self) -> None:
        self.assertTrue(self.history.run_pass(self.said.append, SLICE_BUDGET))
        self.assertEqual(4, len(self.chunks))
        # The client writes to the large transcript: the live reading moves the run.
        self.big.prompt(HOUR)
        self.big.end_turn(HOUR + 20)
        self.history.run_pass(self.said.append, SLICE_BUDGET)
        row = self.run_row("big")
        self.assertEqual(os.path.getsize(self.big.path), row["read_offset"])
        self.assertEqual(
            (0, None, None),
            (row["reading"], row["reread_refused"], row["reread_at"]),
            "nothing of the reading in part was written, and nothing was refused",
        )
        drain(self.history, SLICE_BUDGET)
        self.assertEqual(2, self.chunks.count(0))
        self.assert_as_one_go()

    def test_no_other_run_starts_in_a_pass_whose_time_the_large_run_used_up(self) -> None:
        # A pass of one chunk: the large run takes all of it, the last pass included.
        self.assertTrue(self.history.run_pass(self.said.append, CHUNK_SECONDS))
        self.reader.execute("UPDATE usage_runs SET reading = 0 WHERE session_id = 'live'")
        other = self.run_row("live")["id"]
        for _ in range(10 * MOST_PASSES):
            self.assertTrue(self.history.run_pass(self.said.append, CHUNK_SECONDS))
            self.assertNotIn(other, self.attempts)
            if self.run_row("big")["reading"] == READING:
                break
        else:
            self.fail("the large run was never read to its end")
        self.assertFalse(self.history.run_pass(self.said.append, CHUNK_SECONDS))
        self.assertIn(other, self.attempts)
        self.assertEqual(READING, self.run_row("live")["reading"])

    def part_read(self) -> tuple:
        """The large run read again for one chunk, with what going on with it takes."""

        collector = usage_collect.Collector(self.reader, self.store_path)
        (target,) = [t for t in collector.finder.targets(set()) if t.session == "big"]
        coverage = liveness.Coverage(liveness.intervals(self.store_path))
        line = usage_rebuild.rebuild_run(
            collector, self.run_row("big"), target, coverage, deadline=0.0
        )
        self.assertEqual(usage_rebuild.UNFINISHED, line.outcome)
        return collector, target, coverage, line.rereading

    def go_on(self, part: tuple) -> usage_rebuild.RunReport:
        collector, target, coverage, again = part
        return usage_rebuild.rebuild_run(
            collector, self.run_row("big"), target, coverage, resume=again
        )

    def assert_dropped(self, line: usage_rebuild.RunReport) -> None:
        self.assertEqual((usage_rebuild.REFUSED, "moved"), (line.outcome, line.reason))
        row = self.run_row("big")
        self.assertEqual((0, None), (row["reading"], row["reread_at"]), "nothing was written")

    def test_a_reading_in_part_goes_on_only_while_its_run_stands_where_it_started(self) -> None:
        with self.subTest("nothing changed"):
            self.assertEqual(usage_rebuild.REBUILT, self.go_on(self.part_read()).outcome)
            self.reader.execute(
                "UPDATE usage_runs SET reading = 0, reread_at = NULL WHERE session_id = 'big'"
            )
        with self.subTest("the run is read from another file since"):
            elsewhere = self.big.path.with_name("elsewhere.jsonl")
            shutil.copyfile(self.big.path, elsewhere)
            part = self.part_read()
            with mock.patch.object(usage_collect, "source", return_value=str(elsewhere)):
                self.assert_dropped(self.go_on(part))
        with self.subTest("the file went between the check and the read"):
            part = self.part_read()
            with mock.patch.object(usage_collect, "_read_lines", side_effect=FileNotFoundError):
                self.assert_dropped(self.go_on(part))
        with self.subTest("the reader marked the run"):
            part = self.part_read()
            self.reader.execute("UPDATE usage_runs SET status = 'missing' WHERE session_id = 'big'")
            self.assert_dropped(self.go_on(part))
            self.reader.execute("UPDATE usage_runs SET status = 'reading' WHERE session_id = 'big'")
        with self.subTest("the file is shorter now"):
            part = self.part_read()
            os.truncate(self.big.path, part[3].end - 1)
            self.assert_dropped(self.go_on(part))

    def test_a_transcript_gone_between_passes_is_refused_as_missing_not_as_failed(self) -> None:
        self.assertTrue(self.history.run_pass(self.said.append, SLICE_BUDGET))
        self.big.path.unlink()
        drain(self.history, SLICE_BUDGET)
        row = self.run_row("big")
        self.assertEqual(("missing", 0), (row["reread_refused"], row["reading"]))
        self.assertEqual("ok", self.doctor_check()["status"])


class LivenessTests(RereadCase):
    def test_without_the_liveness_file_nothing_is_read_again(self) -> None:
        self.sessions(2)
        self.make_stale()
        os.remove(liveness.path_for(self.store_path))
        for _ in range(2):
            self.assertFalse(self.pass_())
        self.assertEqual([], self.attempts)
        self.assertEqual([], self.snapshots())
        self.assertEqual(2, len(self.stale()))


class RecoveryPointTests(RereadCase):
    def test_one_snapshot_with_its_liveness_copy_for_every_run(self) -> None:
        self.sessions(7)
        self.make_stale()
        drain(self.history)
        self.assertEqual(7, len(set(self.attempts)))
        [snapshot] = self.snapshots()
        backups = os.path.join(os.path.dirname(self.store_path), "backups")
        self.assertTrue(os.path.isfile(liveness.path_for(os.path.join(backups, snapshot))))
        # A later staleness in the same process takes none either.
        self.make_stale()
        drain(self.history)
        self.assertEqual([snapshot], self.snapshots())


class UpgradeRecoveryPointTests(unittest.TestCase):
    """The schema-15 upgrade's own recovery point, taken by this process, is the one."""

    def test_the_upgrade_snapshot_counts_and_no_other_is_taken(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        path = str(root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": path})
        patch.start()
        self.addCleanup(patch.stop)
        schema14.build(path)
        transcript = root / "projects" / "old.jsonl"
        old = ClaudeRun(transcript, "old")
        old.prompt(0)
        old.end_turn(30)
        conn = sqlite3.connect(path)
        conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES ('old', 'claude', ?, 'ended', ?, ?)",
            (str(transcript), stamp(0), stamp(0)),
        )
        # A run the schema-14 reader had not read into yet.
        conn.execute(
            "INSERT INTO usage_runs(session_id, client, path) VALUES ('old', 'claude', ?)",
            (str(transcript),),
        )
        conn.commit()
        conn.close()
        liveness.tick(path, epoch(0))
        store.connect().close()
        upgrade = liveness.recovery_point(path)
        self.assertIsNotNone(upgrade)
        assert upgrade is not None
        self.assertIn("preschema15", os.path.basename(upgrade))
        conn = ingest.open_light(path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(conn.close)
        reader = usage_reread.Reader(conn, path)
        drain(reader, 30.0)
        self.assertEqual(
            [(READING, 0)],
            [tuple(row) for row in conn.execute("SELECT reading, yielded FROM usage_runs")],
        )
        backups = root / "backups"
        self.assertEqual([], sorted(backups.glob(f"*{usage_rebuild.SNAPSHOT_LABEL}*")))


#: A model the price table did not list when its tokens were read.
NEW_MODEL = "claude-unlisted-9"
#: The price table that lists it.
NEW_BOOK = "2099-01-01"


class PricedTests(RereadCase):
    """A run holding tokens without a cost is read again once a table prices its model."""

    def setUp(self) -> None:
        super().setUp()
        self.sessions(2)
        self.unpriced = unpriced = self.session("unpriced")
        unpriced.model = NEW_MODEL
        unpriced.prompt(0)
        unpriced.end_turn(30, spent=usage(output=1000))
        self.read()
        # Live reading has nothing stale to read again.
        self.assertFalse(self.pass_())
        self.assertEqual([], self.attempts)
        self.assertEqual((None, None), self.costs())

    def costs(self) -> tuple[object, object]:
        row = self.reader.execute(
            "SELECT SUM(estimated_api_cost_usd), MAX(price_book) FROM usage_segments s"
            " JOIN usage_runs r ON r.id = s.run_id WHERE r.session_id = 'unpriced'"
            " AND s.output_tokens > 0"
        ).fetchone()
        return row[0], row[1]

    def new_table(self) -> None:
        """This build's table: the model listed, under a new `PRICE_BOOK`."""

        rates = usage_prices._ANTHROPIC["claude-opus-5-5"]
        patches = [mock.patch.dict(usage_prices._ANTHROPIC, {NEW_MODEL: rates})]
        for module in (usage_prices, usage_collect, usage_ledger, usage_rebuild, usage_reread):
            patches.append(mock.patch.object(module, "PRICE_BOOK", NEW_BOOK))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_runs_of_a_newly_priced_model_are_read_again_and_no_other(self) -> None:
        self.new_table()
        reader = usage_reread.Reader(self.reader, self.store_path)
        drain(reader)
        cost, book = self.costs()
        self.assertGreater(float(cost), 0.0)  # type: ignore[arg-type]
        self.assertEqual(NEW_BOOK, book)
        self.assertEqual([self.run_row("unpriced")["id"]], self.attempts)
        rows = self.reader.execute(
            "SELECT session_id, reread_at IS NOT NULL, reading FROM usage_runs ORDER BY id"
        ).fetchall()
        self.assertEqual(
            [("done-0", 0, READING), ("done-1", 0, READING), ("unpriced", 1, READING)],
            [tuple(row) for row in rows],
        )

    def test_a_run_refused_is_not_marked_again_under_the_same_table(self) -> None:
        self.new_table()
        self.unpriced.path.unlink()
        for _ in range(2):
            # Each reader is a start of its own.
            reader = usage_reread.Reader(self.reader, self.store_path)
            drain(reader)
        self.assertEqual([self.run_row("unpriced")["id"]], self.attempts)
        self.assertEqual("missing", self.run_row("unpriced")["reread_refused"])

    def test_without_a_new_price_nothing_is_marked(self) -> None:
        with mock.patch.object(usage_reread, "PRICE_BOOK", NEW_BOOK):
            self.assertEqual(0, usage_reread.mark_priced(self.reader))
        self.assertEqual(set(), self.stale())


class DoctorTests(RereadCase):
    def test_the_summary_says_what_the_runs_say(self) -> None:
        runs = self.sessions(5)
        # The newest run is read again first.
        runs[4].path.unlink()
        self.make_stale()
        self.pass_()
        # One pass: three runs started; one of them refused, the rest wait.
        counts = dict(
            self.reader.execute(
                "SELECT CASE WHEN reading >= ? THEN 'current' WHEN reread_refused IS NOT NULL"
                " THEN 'refused' ELSE 'waiting' END, COUNT(*) FROM usage_runs GROUP BY 1",
                (READING,),
            ).fetchall()
        )
        reread = self.reader.execute(
            "SELECT COUNT(*) FROM usage_runs WHERE reread_at IS NOT NULL"
        ).fetchone()[0]
        check = self.doctor_check()
        parameters = check["presentation"]["parameters"]
        self.assertEqual(
            (counts.get("current", 0), counts.get("waiting", 0), reread),
            (parameters["current"], parameters["waiting"], parameters["reread"]),
        )
        self.assertEqual(f"missing {counts['refused']}", parameters["refused"])
        self.assertEqual(5, sum(counts.values()))
        self.assertGreater(parameters["waiting"], 0)
        self.assertIn(f"{parameters['current']} usage run(s) current", check["detail"])

    def test_a_failed_reading_again_warns(self) -> None:
        self.sessions(1)
        self.make_stale()
        with mock.patch.object(
            usage_rebuild, "_replace", side_effect=sqlite3.OperationalError("disk I/O error")
        ):
            self.pass_()
        check = self.doctor_check()
        self.assertEqual(
            ("warn", "usage-reading-failed"), (check["status"], check["presentation"]["code"])
        )
        self.assertIn("failed 1", check["detail"])


class SecondReadingTests(RereadCase):
    """The runs reading 1 wrote: no setting on a segment, and an advisor of the executor's
    model counted over with each record of its request."""

    def test_the_runs_reading_one_wrote_are_read_again_and_filled(self) -> None:
        run = self.session("advised")
        run.entrypoint = "claude-vscode"
        run.credential(0, ORG_A)
        run.prompt(0)
        for record in range(3):
            run.reply(10 + record, request="m1", spent=advised(run.model), advisorModel=run.model)
        run.end_turn(20, effort="high")
        worker = self.subagent("advised", "w1", label="ovi: build it")
        worker.prompt(12, "build it", origin=None)
        worker.end_turn(18)
        self.read()
        # As reading 1 left them.
        self.reader.execute(
            "UPDATE usage_segments SET organization = NULL, environment = NULL, effort = NULL,"
            " advisor = 0, advisor_model = NULL, input_tokens = -100 WHERE input_tokens = 100"
        )
        self.reader.execute("UPDATE usage_runs SET reading = 1, launch_class = NULL")
        self.assertEqual(2, len(self.stale()))
        drain(self.history)
        self.assertEqual(set(), self.stale())
        self.assertEqual(
            [
                (ORG_A, "ide", None, 0, run.model, 4),
                (ORG_A, "ide", None, 1, run.model, 100),
                (ORG_A, "ide", "high", 0, None, 10),
            ],
            [
                (
                    row["organization"],
                    row["environment"],
                    row["effort"],
                    row["advisor"],
                    row["advisor_model"],
                    row["input_tokens"],
                )
                # The later records of the request add no row of their own.
                for row in self.segments("advised")
            ],
        )
        self.assertEqual("ovi", self.run_row("advised", "w1")["launch_class"])


class OrganizationShareTests(RereadCase):
    def check(self) -> dict:
        (found,) = [c for c in doctor._store_checks() if c["id"] == "usage-organization"]
        return found

    def test_the_doctor_says_what_share_names_its_organization(self) -> None:
        named = self.session("named")
        named.prompt(0)
        named.credential(1, ORG_A)
        named.end_turn(10)
        unnamed = self.session("unnamed")
        unnamed.prompt(100)
        unnamed.end_turn(130)
        self.read()
        check = self.check()
        # Three segments: the second before the attachment and nine after it, and thirty.
        self.assertEqual(
            ("ok", "usage-organization"), (check["status"], check["presentation"]["code"])
        )
        self.assertEqual(
            {
                "segments": 3,
                "known": 1,
                "seconds": 40.0,
                "known_seconds": 9.0,
                "share": 33.3,
                "seconds_share": 22.5,
            },
            check["presentation"]["parameters"],
        )
        self.assertIn("1 of 3 usage segment(s) (33.3%) and 9 of 40 second(s)", check["detail"])
        self.reader.execute("UPDATE usage_segments SET organization = NULL")
        check = self.check()
        self.assertEqual(
            ("warn", "usage-organization-none"), (check["status"], check["presentation"]["code"])
        )


if __name__ == "__main__":
    unittest.main()
