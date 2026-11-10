"""Rebuilding a run: the same rows as the reader made, or the run left exactly as it was.

Equivalence is checked against the background reader itself, read in several passes and
in small chunks, so a rebuild that parsed differently, or counted a former request as
seen, shows as a difference in some column. Every refusal and every interruption is
checked by comparing all of the run's rows, ids and times included, before and after.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import sqlite3
import unittest
from pathlib import Path
from unittest import mock

from server import store_backups
from server.planning import ladder
from server.telemetry import liveness, usage_collect, usage_rebuild
from server.telemetry.usage_ledger import SEGMENT_COLUMNS, Ledger
from tests.usage_fixtures import HOUR, Case, CodexRun, stamp, usage


class RebuildCase(Case):
    def rebuild(self, **options: object) -> usage_rebuild.Report:
        return usage_rebuild.rebuild(self.reader, self.store_path, **options)

    def small_chunks(self) -> None:
        patch = mock.patch.object(usage_collect, "CHUNK_BYTES", 512)
        patch.start()
        self.addCleanup(patch.stop)
        self.chunks = patch

    def counted(self, session: str = "sess-1", agent: str = "") -> tuple:
        """What a run counts: its row but for when it was read, its segments but for their
        ids, and its requests."""

        run = dict(self.run_row(session, agent))
        run.pop("read_at")
        columns = ("run_id", "session_id", "agent_id", *SEGMENT_COLUMNS)
        segments = sorted(
            (tuple(row[column] for column in columns) for row in self.segments(session, agent)),
            key=repr,
        )
        return run, segments, self.requests(run["id"])

    def exact(self, session: str = "sess-1", agent: str = "") -> tuple:
        """Every row of a run as it is, ids and times included."""

        run = dict(self.run_row(session, agent))
        segments = [
            dict(row)
            for row in self.reader.execute(
                "SELECT * FROM usage_segments WHERE run_id = ? ORDER BY id", (run["id"],)
            )
        ]
        return run, segments, self.requests(run["id"])

    def requests(self, run_id: int) -> list[int]:
        return [
            row[0]
            for row in self.reader.execute(
                "SELECT request FROM usage_requests WHERE run_id = ? ORDER BY request", (run_id,)
            )
        ]

    def one_turn(self) -> None:
        """A session read once: a prompt, a script and an answer."""

        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(610, "t1")
        run.end_turn(620)
        self.read()
        self.run = run
        self.transcript = run.path

    def assert_refused(self, report: usage_rebuild.Report, reason: str) -> None:
        self.assertTrue(report.failed)
        (line,) = report.runs
        self.assertEqual((usage_rebuild.REFUSED, reason), (line.outcome, line.reason))
        self.assertIn(reason, usage_rebuild.render(report))


class EquivalenceTests(RebuildCase):
    """Code and outside inputs unchanged: the rebuild gives back exactly what was read."""

    def assert_rebuilds_to_the_same(self, session: str = "sess-1", agent: str = "") -> None:
        read = self.counted(session, agent)
        self.chunks.stop()
        report = self.rebuild(session=session, agent=agent)
        self.assertFalse(report.failed, usage_rebuild.render(report))
        (line,) = report.runs
        self.assertEqual(usage_rebuild.REBUILT, line.outcome)
        self.assertEqual(line.before, line.after)
        self.assertEqual([], [entry for entry in line.items if entry["before"] != entry["after"]])
        self.assertEqual(read, self.counted(session, agent))

    def test_a_claude_session_read_in_passes_and_chunks(self) -> None:
        first, first_id = self.item()
        second, second_id = self.item()
        run = self.session()
        # The first minutes have no tick, and the machine is off for an hour later on.
        self.ticks((120, 2 * HOUR), (3 * HOUR, 5 * HOUR))
        self.small_chunks()
        run.prompt(0)
        run.reply(10, request="msg_a", spent=usage(output=5))
        run.reply(11, request="msg_a", tools=(("w1", "Bash"),), spent=usage(output=50))
        self.write("sess-1", first, 15)
        run.result(20, "w1")
        run.reply(30, tools=(("b1", "Bash"),), background=True)
        run.background_result(32, "b1", "task-1")
        run.end_turn(40)
        run.system(41, "stop_hook_summary")
        self.read()
        run.enqueue(HOUR, tool="b1", task="task-1")
        run.notice(HOUR + 1, tool="b1", task="task-1")
        for number in range(18):
            at = HOUR + 10 + number * 4
            run.reply(at, tools=((f"t{number}", "Bash"),))
            run.result(at + 2, f"t{number}")
        self.write("sess-1", second, HOUR + 90)
        run.end_turn(HOUR + 100)
        self.read()
        # A resume writes an old record again, its request long out of the open ones.
        run.reply(11, request="msg_a", tools=(("w1", "Bash"),), spent=usage(output=50))
        run.prompt(3 * HOUR + 60)
        run.end_turn(3 * HOUR + 90)
        self.read()
        rows = self.segments()
        self.assertEqual({"observed", "estimated"}, {row["quality"] for row in rows})
        self.assertLessEqual({first_id, second_id}, {row["work_item_id"] for row in rows})
        self.assertGreater(self.run_row()["gap_seconds"], 0)
        # The last record of `msg_a`, each script call's and four more; the resume adds none.
        self.assertEqual(50 + 18 * 5 + 4 * 5, self.tokens("output_tokens"))
        self.assert_rebuilds_to_the_same()

    def test_a_claude_subagent_read_in_passes_and_chunks(self) -> None:
        named, named_id = self.item()
        written, written_id = self.item()
        run = self.session()
        self.ticks((0, 3 * HOUR))
        self.small_chunks()
        run.prompt(0)
        run.reply(10, tools=(("a1", "Agent"),))
        run.agent_launched(10, "a1", "worker")
        run.end_turn(20)
        worker = self.subagent("sess-1", "worker", f"build: {named}")
        worker.prompt(13, "go on", origin=None)
        worker.reply(14, tools=(("s1", "Bash"),))
        worker.result(600, "s1")
        worker.end_turn(605)
        self.read()
        worker.prompt(610, "and then", origin=None)
        worker.reply(620, tools=(("w1", "x"),))
        self.write("sess-1", written, 630, agent="worker")
        worker.result(631, "w1")
        worker.end_turn(HOUR)
        run.enqueue(HOUR + 1, tool="a1", task="worker")
        run.notice(HOUR + 2, tool="a1", task="worker")
        run.end_turn(HOUR + 12)
        self.read()
        signals = {
            (row["work_item_id"], row["signal"]) for row in self.segments("sess-1", "worker")
        }
        self.assertIn((named_id, ladder.LABEL_NUMBER), signals)
        self.assertIn((written_id, ladder.LAST_WRITE), signals)
        self.assert_rebuilds_to_the_same("sess-1", "worker")
        self.assert_rebuilds_to_the_same("sess-1", "")

    def test_a_codex_rollout_read_in_passes_and_chunks(self) -> None:
        path = self.root / "codex" / "2030/03/04" / "rollout-sess-1.jsonl"
        rollout = CodexRun(path, "sess-1")
        self.conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES ('sess-1', 'codex', ?, 'active', ?, ?)",
            (str(path), stamp(0), stamp(0)),
        )
        self.conn.commit()
        self.ticks((0, 3 * HOUR))
        self.small_chunks()
        rollout.settings(1)
        rollout.started(1)
        rollout.call(10, "c1")
        rollout.output(40, "c1")
        rollout.usage_record(50, input_tokens=1000, cached=800, output=30, reasoning=10)
        self.read()
        rollout.complete(60)
        rollout.started(HOUR + 60)
        rollout.usage_record(HOUR + 65, input_tokens=2000, cached=100, output=60)
        rollout.complete(HOUR + 70)
        self.read()
        self.assertEqual(90, self.tokens("output_tokens"))
        self.assertEqual(HOUR, round(self.run_row()["human_seconds"]))
        self.assert_rebuilds_to_the_same()


class SubagentTimeTests(RebuildCase):
    """Time a subagent's own run counts is never counted in its parent's as well."""

    def parent_and_worker(self) -> None:
        """A coordinator that waits an hour for a background subagent, both read live."""

        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("a1", "Agent"),))
        run.agent_launched(10, "a1", "worker")
        run.end_turn(20)
        run.system(21, "stop_hook_summary")
        self.worker = self.subagent("sess-1", "worker")
        self.worker.prompt(13, "build it", origin=None)
        self.worker.reply(14, tools=(("s1", "Bash"),))
        self.worker.result(HOUR - 1, "s1")
        self.worker.end_turn(HOUR)
        run.enqueue(HOUR + 1, tool="a1", task="worker")
        run.notice(HOUR + 2, tool="a1", task="worker")
        run.end_turn(HOUR + 12)
        self.read()
        self.assertEqual(HOUR + 2 - 21, round(self.run_row()["subagent_seconds"]))

    def both(self) -> float:
        return round(self.seconds("sess-1", "") + self.seconds("sess-1", "worker"), 3)

    def assert_parent_rebuilds_unchanged(self) -> None:
        parent, total = self.counted(), self.both()
        report = self.rebuild(session="sess-1")
        self.assertFalse(report.failed, usage_rebuild.render(report))
        self.assertEqual(parent, self.counted())
        self.assertEqual(total, self.both())

    def archive_worker(self) -> Path:
        """Valkama's copy of the worker's transcript, and the client's original deleted."""

        archived = self.root / "transcripts" / "sess-1" / "agent-worker.jsonl"
        archived.parent.mkdir(parents=True)
        archived.write_bytes(self.worker.path.read_bytes())
        self.worker.path.unlink()
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, agent_id, archive_path) VALUES"
            " ('x', 'transcript_archived', 'confirmed', 'valkama', 'sess-1', 'worker', ?)",
            ("sess-1/agent-worker.jsonl",),
        )
        self.conn.commit()
        self.read()
        return archived

    def test_a_subagent_read_from_its_archive_still_takes_its_wait(self) -> None:
        self.parent_and_worker()
        archived = self.archive_worker()
        self.assertEqual(str(archived), self.run_row("sess-1", "worker")["path"])
        self.assert_parent_rebuilds_unchanged()

    def test_a_subagent_whose_every_copy_is_gone_still_takes_its_wait(self) -> None:
        self.parent_and_worker()
        self.archive_worker().unlink()
        self.read()
        self.assertEqual("missing", self.run_row("sess-1", "worker")["status"])
        self.assert_parent_rebuilds_unchanged()

    def test_a_subagent_deleted_with_no_copy_still_takes_its_wait(self) -> None:
        self.parent_and_worker()
        self.worker.path.unlink()
        self.read()
        # Nothing names the file any more, so the reader leaves its run as it was.
        self.assertEqual("reading", self.run_row("sess-1", "worker")["status"])
        self.assert_parent_rebuilds_unchanged()

    def test_a_subagent_that_never_kept_a_transcript_leaves_the_wait_with_its_parent(self) -> None:
        run = self.session()
        self.ticks((0, 3 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("a1", "Agent"),))
        run.result(HOUR, "a1", status="completed", agentId="gone")
        run.end_turn(HOUR + 10)
        self.read()
        self.assertEqual(HOUR + 10, self.seconds())
        self.assert_parent_rebuilds_unchanged()


class RefusalTests(RebuildCase):
    """A run that may not be rebuilt stays byte for byte, and the report says why."""

    def test_a_run_whose_transcript_is_gone(self) -> None:
        self.one_turn()
        os.remove(self.transcript)
        self.read()
        self.assertEqual("missing", self.run_row()["status"])
        before = self.exact()
        self.assert_refused(self.rebuild(session="sess-1"), "missing")
        self.assertEqual(before, self.exact())

    def test_a_run_the_reader_found_truncated(self) -> None:
        self.one_turn()
        self.transcript.write_bytes(self.transcript.read_bytes()[:100])
        self.read()
        self.assertEqual("truncated", self.run_row()["status"])
        before = self.exact()
        self.assert_refused(self.rebuild(session="sess-1"), "truncated")
        self.assertEqual(before, self.exact())

    def test_a_run_the_reader_could_not_read(self) -> None:
        self.one_turn()
        self.reader.execute("UPDATE usage_runs SET status = 'unreadable'")
        before = self.exact()
        self.assert_refused(self.rebuild(session="sess-1"), "unreadable")
        self.assertEqual(before, self.exact())

    def test_a_transcript_shorter_than_what_was_read_before_the_reader_saw_it(self) -> None:
        self.one_turn()
        self.transcript.write_bytes(self.transcript.read_bytes()[:100])
        before = self.exact()
        self.assertEqual("reading", before[0]["status"])
        self.assert_refused(self.rebuild(session="sess-1"), "shorter")
        self.assertEqual(before, self.exact())

    def test_a_transcript_gone_before_the_reader_saw_it(self) -> None:
        self.one_turn()
        os.remove(self.transcript)
        before = self.exact()
        self.assert_refused(self.rebuild(session="sess-1"), "missing")
        self.assertEqual(before, self.exact())

    def test_a_transcript_whose_lines_moved(self) -> None:
        self.one_turn()
        self.transcript.write_bytes(b"\n" + self.transcript.read_bytes())
        before = self.exact()
        self.assert_refused(self.rebuild(session="sess-1"), "changed")
        self.assertEqual(before, self.exact())

    def test_without_the_liveness_file_nothing_is_rebuilt_one_run_or_all(self) -> None:
        self.one_turn()
        os.remove(liveness.path_for(self.store_path))
        before = self.exact()
        for options in ({"session": "sess-1"}, {}, {"dry_run": True}):
            with self.subTest(options=options):
                report = self.rebuild(**options)
                self.assertTrue(report.failed)
                self.assertEqual(
                    ("no-liveness", [], None), (report.refused, report.runs, report.snapshot)
                )
                self.assertIn("estimated", usage_rebuild.render(report))
        self.assertEqual(before, self.exact())
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.store_path), "backups")))

    def test_an_unknown_run(self) -> None:
        self.one_turn()
        report = self.rebuild(session="sess-1", agent="nobody")
        self.assertEqual("no-run", report.refused)
        self.assertTrue(report.failed)

    def test_every_run_rebuilds_what_it_may_and_names_the_rest(self) -> None:
        self.one_turn()
        other = self.session("sess-2")
        other.prompt(0)
        other.end_turn(30)
        self.read()
        Path(other.path).write_bytes(b"")
        self.read()
        refused = self.exact("sess-2")
        report = self.rebuild()
        self.assertTrue(report.failed)
        outcomes = {(line.session_id, line.outcome, line.reason) for line in report.runs}
        self.assertEqual(
            {
                ("sess-1", usage_rebuild.REBUILT, None),
                ("sess-2", usage_rebuild.REFUSED, "truncated"),
            },
            outcomes,
        )
        self.assertEqual(refused, self.exact("sess-2"))


class AtomicityTests(RebuildCase):
    """An interrupted rebuild leaves every row of the run as it was."""

    def setUp(self) -> None:
        super().setUp()
        self.one_turn()
        # What the rebuild would change: a permission request the reader never saw.
        self.reader.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, received_at) VALUES ('a1', 'attention', 'confirmed', 'hook', ?, ?)",
            ("sess-1", stamp(20)),
        )

    def test_the_rebuild_changes_the_run_when_nothing_stops_it(self) -> None:
        self.assertEqual(620.0, self.seconds())
        report = self.rebuild(session="sess-1")
        self.assertFalse(report.failed)
        # Work to the request at 20 s and after the call went on at 610 s.
        self.assertEqual(30.0, self.seconds())
        (line,) = report.runs
        assert line.before is not None and line.after is not None
        self.assertEqual((620.0, 30.0), (line.before["seconds"], line.after["seconds"]))
        self.assertEqual(590.0, line.after["human_seconds"])

    def test_a_failure_after_the_former_rows_were_deleted(self) -> None:
        before = self.exact()
        with mock.patch.object(usage_rebuild, "write_rows", side_effect=OSError("disk full")):
            report = self.rebuild(session="sess-1")
        self.assert_refused(report, "failed")
        self.assertIn("(OSError)", usage_rebuild.render(report))
        self.assertEqual(before, self.exact())

    def test_a_failure_after_the_new_rows_were_written(self) -> None:
        before = self.exact()
        real = usage_rebuild.write_rows

        def then_fail(*arguments: object) -> None:
            real(*arguments)
            raise sqlite3.OperationalError("disk I/O error")

        with mock.patch.object(usage_rebuild, "write_rows", then_fail):
            report = self.rebuild(session="sess-1")
        self.assert_refused(report, "failed")
        self.assertEqual(before, self.exact())

    def overtaken(self, meanwhile: object) -> tuple[usage_rebuild.Report, tuple]:
        """A rebuild during whose parsing `meanwhile` runs; what it saw when that was done."""

        real = usage_collect.Collector.read_again
        seen: list[tuple] = []

        def read_then_lose(collector: usage_collect.Collector, *arguments: object) -> object:
            reading = real(collector, *arguments)
            meanwhile()
            seen.append(self.exact())
            return reading

        with mock.patch.object(usage_collect.Collector, "read_again", read_then_lose):
            report = self.rebuild(session="sess-1")
        return report, seen[0]

    def test_a_reader_pass_that_moved_the_run_meanwhile_wins(self) -> None:
        offset = self.run_row()["read_offset"]

        def more_and_a_pass() -> None:
            self.run.prompt(700)
            self.run.end_turn(710)
            self.read()

        report, after_the_pass = self.overtaken(more_and_a_pass)
        self.assert_refused(report, "moved")
        self.assertGreater(self.run_row()["read_offset"], offset)
        self.assertEqual(after_the_pass, self.exact())

    def test_a_run_the_reader_marked_meanwhile_stays_marked(self) -> None:
        def marked() -> None:
            self.reader.execute("UPDATE usage_runs SET status = 'truncated'")

        report, after_marking = self.overtaken(marked)
        self.assert_refused(report, "moved")
        self.assertEqual(after_marking, self.exact())


class DryRunTests(RebuildCase):
    def test_a_dry_run_reports_the_difference_and_writes_nothing(self) -> None:
        reference, identity = self.item()
        self.one_turn()
        # A write the reader never saw: the rebuild would move the run to its item.
        self.write("sess-1", reference, 15)
        before = self.exact()
        report = self.rebuild(dry_run=True)
        self.assertFalse(report.failed)
        self.assertIsNone(report.snapshot)
        (line,) = report.runs
        self.assertEqual(usage_rebuild.WOULD_REBUILD, line.outcome)
        self.assertEqual(
            {None: (620.0, 0.0), identity: (0.0, 620.0)},
            {
                entry["work_item_id"]: (entry["before"]["seconds"], entry["after"]["seconds"])
                for entry in line.items
            },
        )
        self.assertIn(f"item {identity}: seconds 0.0 -> 620.0", usage_rebuild.render(report))
        self.assertEqual(before, self.exact())
        self.rebuild()
        self.assertEqual({identity}, {row["work_item_id"] for row in self.segments()})


class WorkBetweenItemsTests(RebuildCase):
    """The report says how much work moved between items, not only whether totals did."""

    def moved(self, line: usage_rebuild.RunReport) -> dict:
        return {
            entry["work_item_id"]: (entry["before"]["seconds"], entry["after"]["seconds"])
            for entry in line.items
            if entry["before"] != entry["after"]
        }

    def test_a_boundary_that_shifts_moves_seconds_with_the_totals_equal(self) -> None:
        first, first_id = self.item()
        second, second_id = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        self.write("sess-1", first, 15)
        self.write("sess-1", second, 400)
        run.result(610, "t1")
        run.end_turn(620)
        self.read()
        # The first write turns out to have come later than the reader was told.
        self.conn.execute(
            "UPDATE execution_events SET received_at = ? WHERE work_item_id = ?",
            (stamp(300), first_id),
        )
        self.conn.commit()
        report = self.rebuild(session="sess-1", dry_run=True)
        (line,) = report.runs
        self.assertEqual(line.before, line.after)
        self.assertEqual(line.segments[0], line.segments[1])
        self.assertEqual({first_id: (15.0, 300.0), second_id: (605.0, 320.0)}, self.moved(line))
        text = usage_rebuild.render(report)
        self.assertNotIn("totals unchanged\n", text + "\n")
        self.assertIn("totals unchanged, work moved between items", text)
        self.assertIn(f"item {first_id}: seconds 15.0 -> 300.0", text)
        self.assertIn(f"item {second_id}: seconds 605.0 -> 320.0", text)


class OpenTurnPlacementTests(RebuildCase):
    """A turn with no write that started with no item is placed by the transcript and the
    store's records alone, never by where a reader pass happened to end.

    The parent holds one item from 120 s and two, which names none, from 180 s, so a
    subagent turn from 100 s to 200 s with no write of its own names an item only at
    some moments of it.
    """

    def setUp(self) -> None:
        super().setUp()
        held, _ = self.item()
        other, _ = self.item()
        self.session()
        self.ticks((0, HOUR))
        self.claim("sess-1", held, 120)
        self.claim("sess-1", other, 180)
        self.worker = self.subagent("sess-1", "worker")

    def assert_rebuilds_to_the_same(self) -> None:
        read = self.counted("sess-1", "worker")
        report = self.rebuild(session="sess-1", agent="worker")
        (line,) = report.runs
        self.assertEqual(line.before, line.after)
        self.assertEqual([], [entry for entry in line.items if entry["before"] != entry["after"]])
        self.assertIn("totals unchanged", usage_rebuild.render(report))
        self.assertEqual(read, self.counted("sess-1", "worker"))

    def first_pass_inside_the_turn(self) -> None:
        self.worker.prompt(100, "go on", origin=None)
        self.worker.reply(110, tools=(("s1", "Bash"),))
        self.worker.result(150, "s1")
        # This pass ends at 150 s, when the parent holds exactly one item.
        self.read()
        self.worker.reply(160, tools=(("s2", "Bash"),))
        self.worker.result(190, "s2")
        self.worker.end_turn(200)

    def test_a_closed_turn_read_in_two_passes_rebuilds_to_the_same(self) -> None:
        self.first_pass_inside_the_turn()
        self.worker.prompt(300, "and then", origin=None)
        self.worker.end_turn(310)
        self.read()
        self.assert_rebuilds_to_the_same()

    def test_a_turn_still_open_read_in_two_passes_rebuilds_to_the_same(self) -> None:
        self.first_pass_inside_the_turn()
        self.read()
        self.assert_rebuilds_to_the_same()

    def test_a_turn_read_before_this_rule_goes_on_as_it_was_read(self) -> None:
        # A memo written without `open_placement`: its turn in flight is looked for while
        # it has no item and kept once found, and is not settled again when it closes.
        answers = iter([("one", ladder.SINGLE_HOLD), ("two", ladder.SINGLE_HOLD)])
        coverage = liveness.Coverage([])
        ledger = Ledger([], {}, coverage, frozenset().__contains__, lambda _at: next(answers))
        ledger.place_open_turn(10.0)
        self.assertEqual("one", ledger.item)
        ledger.place_open_turn(20.0)
        ledger.new_turn(30.0, 25.0)
        self.assertEqual("two", ledger.item)
        self.assertTrue(ledger.open_placement is False)
        found_once = Ledger(
            [], {"item": "one"}, coverage, frozenset().__contains__, lambda _at: ("x", None)
        )
        found_once.place_open_turn(10.0)
        self.assertEqual("one", found_once.item)

    def placement(self) -> tuple:
        """The worker's rows as `counted` gives them, but for the ids a fresh reading changes."""

        run, segments, requests = self.counted("sess-1", "worker")
        run = {key: value for key, value in run.items() if key != "id"}
        return run, sorted((segment[1:] for segment in segments), key=repr), requests

    def forget_the_worker(self) -> None:
        run_id = self.run_row("sess-1", "worker")["id"]
        for table, column in (
            ("usage_segments", "run_id"),
            ("usage_requests", "run_id"),
            ("usage_runs", "id"),
        ):
            self.reader.execute(f"DELETE FROM {table} WHERE {column} = ?", (run_id,))

    def test_one_pass_small_chunks_and_passes_split_anywhere_give_the_same_rows(self) -> None:
        # Turns from 50 s (no hold), from 100 s to 170 s (one hold at its end), from 175 s
        # (one hold at its start) and from 300 s (two holds), the last still open.
        self.worker.prompt(50, "look first", origin=None)
        self.worker.end_turn(60)
        self.worker.prompt(100, "go on", origin=None)
        self.worker.reply(110, tools=(("s1", "Bash"),))
        self.worker.result(150, "s1")
        self.worker.end_turn(170)
        self.worker.prompt(175, "more", origin=None)
        self.worker.reply(180, tools=(("s2", "Bash"),))
        self.worker.result(190, "s2")
        self.worker.end_turn(200)
        self.worker.prompt(300, "and then", origin=None)
        self.worker.reply(305, tools=(("s3", "Bash"),))
        self.worker.result(400, "s3")
        lines = self.worker.path.read_bytes().splitlines(keepends=True)
        self.read()
        whole = self.placement()
        self.assertGreater(len({row[6] for row in whole[1]}), 1, "the case places nothing")

        def again(*parts: list[bytes]) -> tuple:
            self.forget_the_worker()
            self.worker.path.write_bytes(b"")
            for part in parts:
                with self.worker.path.open("ab") as handle:
                    handle.write(b"".join(part))
                self.read()
            return self.placement()

        with mock.patch.object(usage_collect, "CHUNK_BYTES", 256):
            self.assertEqual(whole, again(lines), "small chunks")
        for split in range(1, len(lines)):
            with self.subTest(split=split):
                self.assertEqual(whole, again(lines[:split], lines[split:]))
        self.assertEqual(whole, again(*([line] for line in lines)), "a pass per line")
        self.assert_rebuilds_to_the_same()


class RecoveryTests(RebuildCase):
    def sums(self, conn: sqlite3.Connection) -> tuple:
        return tuple(
            conn.execute(
                "SELECT (SELECT ROUND(SUM(seconds), 3) FROM usage_segments),"
                " (SELECT SUM(output_tokens) FROM usage_segments),"
                " (SELECT COUNT(*) FROM usage_requests),"
                " (SELECT ROUND(SUM(human_seconds + subagent_seconds + external_seconds"
                "  + gap_seconds), 3) FROM usage_runs)"
            ).fetchone()
        )

    def test_rebuilding_every_run_can_be_undone_from_its_snapshot(self) -> None:
        self.one_turn()
        worker = self.subagent("sess-1", "worker")
        worker.prompt(13, "go", origin=None)
        worker.end_turn(300)
        self.read()
        former = self.sums(self.reader)
        self.reader.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, received_at) VALUES ('a1', 'attention', 'confirmed', 'hook', ?, ?)",
            ("sess-1", stamp(20)),
        )
        report = self.rebuild()
        self.assertFalse(report.failed, usage_rebuild.render(report))
        self.assertEqual(2, len(report.runs))
        self.assertNotEqual(former, self.sums(self.reader))
        snapshot = report.snapshot
        assert snapshot is not None
        self.assertIn(usage_rebuild.SNAPSHOT_LABEL, os.path.basename(snapshot))
        # Restoring is copying the snapshot and the liveness file beside it.
        restored = str(self.root / "restored.sqlite3")
        shutil.copyfile(snapshot, restored)
        shutil.copyfile(liveness.path_for(snapshot), liveness.path_for(restored))
        with contextlib.closing(sqlite3.connect(restored)) as conn:
            self.assertEqual(former, self.sums(conn))
        self.assertEqual(liveness.intervals(self.store_path), liveness.intervals(restored))

    def test_a_liveness_copy_goes_with_the_snapshot_retention_removes(self) -> None:
        self.one_turn()
        for number in range(7):
            # The store differs each time, so no snapshot is reused.
            self.reader.execute("UPDATE usage_runs SET read_at = ?", (stamp(number),))
            self.assertFalse(self.rebuild().failed)
        backups = os.path.join(os.path.dirname(self.store_path), "backups")
        names = os.listdir(backups)
        snapshots = [name for name in names if name.endswith(".sqlite3")]
        copies = [name for name in names if name.endswith(".liveness")]
        self.assertEqual(5, len(snapshots))
        self.assertEqual(sorted(f"{name}.liveness" for name in snapshots), sorted(copies))

    def test_a_liveness_copy_that_fails_its_check_is_not_left_beside_the_snapshot(self) -> None:
        self.one_turn()
        real = store_backups.snapshot_identity

        def torn_liveness(path: str) -> str:
            # The store's snapshot verifies; the liveness copy does not.
            return "torn" if not path.endswith(".sqlite3") else real(path)

        with (
            mock.patch.object(store_backups, "snapshot_identity", torn_liveness),
            self.assertRaises(RuntimeError),
        ):
            self.rebuild()
        backups = os.path.join(os.path.dirname(self.store_path), "backups")
        names = os.listdir(backups)
        (snapshot,) = [name for name in names if name.endswith(".sqlite3")]
        self.assertEqual([snapshot], names)


if __name__ == "__main__":
    unittest.main()
