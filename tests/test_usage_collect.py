"""Reading transcripts a bounded amount at a time, from a saved place, whatever they do."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from server.telemetry import usage_collect
from tests.usage_fixtures import HOUR, Case


class ReadingTests(Case):
    def test_a_second_read_of_the_same_bytes_adds_nothing(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(30)
        self.read()
        before = [dict(row) for row in self.segments()]
        offset = self.run_row()["read_offset"]
        self.read()
        self.assertEqual(before, [dict(row) for row in self.segments()])
        self.assertEqual(offset, self.run_row()["read_offset"])
        self.assertEqual(os.path.getsize(run.path), offset)

    def test_reading_on_from_the_saved_place_gives_what_one_read_would(self) -> None:
        reference, _ = self.item()
        whole = self.session("whole")
        split = self.session("split")
        self.ticks((0, HOUR))
        for run in (whole, split):
            run.prompt(0)
            run.reply(10, tools=(("w1", "x"),))
        self.write("split", reference, 15)
        self.write("whole", reference, 15)
        self.read()
        for run in (split,):
            run.result(20, "w1")
        self.read()
        whole.result(20, "w1")
        for run in (whole, split):
            run.reply(40, stop="end_turn")
            run.prompt(100)
            run.end_turn(130)
        self.read()
        shape = lambda name: [  # noqa: E731
            (r["started_at"], r["ended_at"], r["work_item_id"], r["signal"], r["output_tokens"])
            for r in self.segments(name)
        ]
        self.assertEqual(shape("whole"), shape("split"))

    def test_a_new_collector_goes_on_where_the_last_one_stopped(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("b1", "Bash"),), background=True)
        run.background_result(12, "b1", "task-1")
        run.end_turn(20)
        self.read()
        self.collector = usage_collect.Collector(self.reader, self.store_path)
        run.enqueue(1000, tool="b1", task="task-1")
        run.notice(1001, tool="b1", task="task-1")
        run.end_turn(1010)
        self.read()
        self.assertEqual(1010 - 1, round(self.seconds()))

    def test_two_readers_of_one_store_count_once(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(30)
        other = usage_collect.Collector(self.reader, self.store_path)
        self.read()
        other.run_pass(self.said.append, 30.0)
        self.read()
        self.assertEqual(30.0, self.seconds())
        self.assertEqual(5, self.tokens("output_tokens"))

    def test_an_unfinished_line_is_left_for_later(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        written = os.path.getsize(run.path)
        run.raw('{"type":"assistant","timestamp":"')
        self.read()
        self.assertEqual(written, self.run_row()["read_offset"])
        with run.path.open("r+b") as handle:
            handle.truncate(written)
        run.end_turn(30)
        self.read()
        self.assertEqual(30.0, self.seconds())

    def test_a_bad_line_costs_only_itself(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.raw("{not json at all\n")
        run.raw("[1, 2, 3]\n")
        run.end_turn(30)
        self.read()
        self.assertEqual(30.0, self.seconds())

    def test_a_file_that_got_shorter_marks_its_run_and_keeps_its_numbers(self) -> None:
        run = self.session()
        healthy = self.session("sess-2")
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(30)
        healthy.prompt(0)
        self.read()
        with run.path.open("r+b") as handle:
            handle.truncate(10)
        healthy.end_turn(40)
        self.read()
        self.assertEqual("truncated", self.run_row()["status"])
        self.assertEqual(30.0, self.seconds())
        self.assertEqual(40.0, self.seconds("sess-2"))
        self.assertEqual([], self.said)

    def test_a_file_that_is_gone_marks_its_run_and_the_pass_goes_on(self) -> None:
        self.session()
        healthy = self.session("sess-2")
        healthy.prompt(0)
        healthy.end_turn(40)
        self.ticks((0, HOUR))
        self.read()
        self.assertEqual("missing", self.run_row()["status"])
        self.assertEqual(40.0, self.seconds("sess-2"))

    def test_a_deleted_transcript_is_read_on_from_its_archive(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        self.read()
        run.end_turn(30)
        archive_name = "sess-1/main-abc.jsonl"
        archived = self.root / "transcripts" / "sess-1" / "main-abc.jsonl"
        archived.parent.mkdir(parents=True)
        archived.write_bytes(run.path.read_bytes())
        run.path.unlink()
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, archive_path) VALUES ('x', 'transcript_archived', 'confirmed', 'valkama', ?, ?)",
            ("sess-1", archive_name),
        )
        self.conn.commit()
        self.read()
        self.assertEqual(30.0, self.seconds())
        self.assertEqual(str(archived), self.run_row()["path"])

    def test_a_budget_spent_leaves_the_rest_and_says_so(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(30)
        self.assertTrue(self.read(seconds=0.0))
        self.assertEqual([], self.segments())
        self.assertFalse(self.read())
        self.assertEqual(30.0, self.seconds())

    def test_a_budget_spent_between_a_session_and_its_subagents_loses_neither(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(10)
        worker = self.subagent("sess-1", "worker")
        worker.prompt(0, "go", origin=None)
        worker.end_turn(30)
        self.conn.execute(
            "UPDATE sessions SET status = 'ended', last_seen = '2020-01-01T00:00:00Z' WHERE id = 'sess-1'"
        )
        self.conn.commit()
        real = usage_collect.Collector._read

        def spend_it_all(collector: object, target: object, work: usage_collect._Pass) -> None:
            real(collector, target, work)
            work.deadline = 0.0

        with mock.patch.object(usage_collect.Collector, "_read", spend_it_all):
            self.read()
        self.assertEqual([], self.segments("sess-1", "worker"))
        self.read()
        self.assertEqual(30.0, self.seconds("sess-1", "worker"))

    def test_a_session_that_ended_is_read_again_when_it_is_heard_from(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(10)
        self.conn.execute(
            "UPDATE sessions SET status = 'ended', last_seen = '2020-01-01T00:00:00Z' WHERE id = 'sess-1'"
        )
        self.conn.commit()
        self.read()
        self.read()
        run.prompt(100)
        run.end_turn(110)
        self.conn.execute("UPDATE sessions SET last_seen = ? WHERE id = 'sess-1'", ("2031",))
        self.conn.commit()
        self.read()
        self.assertEqual(20.0, self.seconds())

    def test_a_reader_that_lost_the_race_writes_nothing(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(30)
        other = usage_collect.Collector(self.reader, self.store_path)
        real = usage_collect._read_lines
        raced: list[bool] = []

        def read_and_lose(path: str, offset: int, limit: int) -> tuple[list[bytes], int, bool]:
            found = real(path, offset, limit)
            if not raced:
                raced.append(True)
                other.run_pass(self.said.append, 30.0)
            return found

        with mock.patch.object(usage_collect, "_read_lines", read_and_lose):
            self.read()
        self.assertEqual(30.0, self.seconds())
        self.assertEqual(5, self.tokens("output_tokens"))

    def test_only_a_chunk_is_read_at_a_time(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        for second in range(50):
            run.prompt(second * 2)
            run.end_turn(second * 2 + 1)
        original = usage_collect.CHUNK_BYTES
        self.addCleanup(setattr, usage_collect, "CHUNK_BYTES", original)
        usage_collect.CHUNK_BYTES = 1024
        self.read()
        self.assertEqual(50.0, self.seconds())
        self.assertEqual(os.path.getsize(run.path), self.run_row()["read_offset"])


if __name__ == "__main__":
    unittest.main()
