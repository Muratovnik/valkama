"""What a request spent: each exactly once, in its model's row, with its own price."""

from __future__ import annotations

import unittest

from server.telemetry import liveness
from server.telemetry.usage_ledger import TOKEN_COLUMNS, Ledger
from server.telemetry.usage_steps import REPLY, Part, Step
from tests.usage_fixtures import HOUR, Case, advised, usage


def _nothing(_at: float) -> tuple[str | None, str | None]:
    return None, None


class TokenTests(Case):
    def test_many_records_of_one_message_count_as_its_last(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(1, request="m1", spent=usage(input_tokens=10, read=100, write_5m=20, output=1))
        run.reply(2, request="m1", spent=usage(input_tokens=10, read=100, write_5m=20, output=7))
        run.reply(
            3,
            request="m1",
            stop="end_turn",
            spent=usage(input_tokens=10, read=100, write_5m=20, output=50),
        )
        self.read()
        self.assertEqual(10, self.tokens("input_tokens"))
        self.assertEqual(100, self.tokens("cached_read_tokens"))
        self.assertEqual(20, self.tokens("cache_write_5m_tokens"))
        self.assertEqual(50, self.tokens("output_tokens"))
        expected = (10 * 4 + 100 * 0.20 + 20 * 5 + 50 * 20) / 1e6
        self.assertAlmostEqual(expected, sum(r["estimated_api_cost_usd"] for r in self.segments()))

    def test_records_of_one_message_split_over_two_reads_still_count_once(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(1, request="m1", spent=usage(output=1))
        self.read()
        run.reply(2, request="m1", stop="end_turn", spent=usage(output=50))
        self.read()
        self.assertEqual(50, self.tokens("output_tokens"))
        self.assertEqual(10, self.tokens("input_tokens"))

    def test_a_resume_writing_old_records_again_adds_nothing(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.end_turn(30, request="m1")
        lines = run.path.read_bytes()
        self.read()
        # The client resumes an hour on: every old line again, under its old time.
        run.raw(lines.decode("utf-8"))
        run.prompt(HOUR)
        run.end_turn(HOUR + 30, request="m2")
        self.read()
        self.assertEqual(60.0, self.seconds())
        self.assertEqual(10, self.tokens("output_tokens"))
        self.assertEqual(HOUR - 30, round(self.run_row()["human_seconds"]))

    def test_a_resume_writing_an_old_open_call_again_is_no_run_that_fell(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        head = run.path.read_bytes().decode("utf-8")
        run.result(290, "t1")
        run.end_turn(300)
        self.read()
        # Written again up to a call that was answered long ago, and a person goes on.
        run.raw(head)
        run.prompt(HOUR)
        run.end_turn(HOUR + 30)
        self.read()
        self.assertEqual(330.0, self.seconds())
        self.assertEqual(HOUR - 300, round(self.run_row()["human_seconds"]))
        self.assertEqual(0, round(self.run_row()["gap_seconds"]))

    def test_a_late_record_of_a_new_request_counts_but_moves_no_time(self) -> None:
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.end_turn(HOUR)
        run.reply(HOUR - 1000, request="late", spent=usage(output=7))
        self.read()
        self.assertEqual(12, self.tokens("output_tokens"))

    def test_a_forked_file_leaves_the_session_it_came_from_alone(self) -> None:
        run = self.session("forked")
        self.ticks((0, 2 * HOUR))
        # The first lines belong to the session this one was forked from.
        origin = run.session
        run.session = "origin"
        run.prompt(0)
        run.end_turn(30, request="old", spent=usage(output=999))
        run.session = origin
        run.prompt(HOUR)
        run.end_turn(HOUR + 30, request="new", spent=usage(output=5))
        self.read()
        rows = self.segments("forked")
        self.assertEqual(5, sum(r["output_tokens"] for r in rows if r["output_tokens"]))
        self.assertEqual(30.0, self.seconds("forked"))

    def test_an_unknown_model_has_tokens_and_no_cost(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(10, model="claude-new-9", spent=usage(output=11))
        self.read()
        (row,) = self.segments()
        self.assertEqual(11, row["output_tokens"])
        self.assertIsNone(row["estimated_api_cost_usd"])
        self.assertIsNone(row["price_book"])

    def test_haiku_over_the_limit_costs_more_per_request_not_per_row(self) -> None:
        run = self.session()
        run.model = "claude-haiku-5-5"
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(5, spent=usage(input_tokens=100, read=99_000, write_5m=0, output=10))
        run.end_turn(9, spent=usage(input_tokens=100, read=100_000, write_5m=0, output=10))
        self.read()
        small = (100 * 0.10 + 99_000 * 0.01 + 10 * 0.50) / 1e6
        large = (100 * 0.50 + 100_000 * 0.05 + 10 * 2.50) / 1e6
        self.assertAlmostEqual(
            small + large, sum(r["estimated_api_cost_usd"] for r in self.segments())
        )

    def test_a_write_split_by_retention_keeps_both_kinds(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(5, spent=usage(write_5m=3, write_1h=4))
        self.read()
        self.assertEqual(3, self.tokens("cache_write_5m_tokens"))
        self.assertEqual(4, self.tokens("cache_write_1h_tokens"))

    def test_a_counter_the_record_lacks_stays_null(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(5)
        self.read()
        (row,) = self.segments()
        self.assertIsNone(row["reasoning_tokens"])
        self.assertEqual(0, row["cache_write_1h_tokens"])

    def test_an_advisor_call_is_its_own_model_with_no_time(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        spent = usage(
            input_tokens=10,
            read=0,
            write_5m=0,
            output=20,
            iterations=[
                {"type": "message", "input_tokens": 4, "output_tokens": 5},
                {
                    "type": "advisor_message",
                    "model": "claude-fable-5-1",
                    "input_tokens": 100,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "output_tokens": 200,
                },
                {"type": "message", "input_tokens": 6, "output_tokens": 15},
            ],
        )
        run.reply(10, spent=spent)
        run.end_turn(20, spent=usage(input_tokens=1, read=0, write_5m=0, output=1))
        self.read()
        by_model = {}
        for row in self.segments():
            entry = by_model.setdefault(row["model"], [0.0, 0, 0.0])
            entry[0] += row["seconds"]
            entry[1] += row["output_tokens"] or 0
            entry[2] += row["estimated_api_cost_usd"] or 0.0
        self.assertEqual(21, by_model["claude-opus-5-5"][1])
        self.assertEqual(20.0, by_model["claude-opus-5-5"][0])
        self.assertEqual(200, by_model["claude-fable-5-1"][1])
        self.assertEqual(0.0, by_model["claude-fable-5-1"][0])
        self.assertAlmostEqual((100 * 10 + 200 * 50) / 1e6, by_model["claude-fable-5-1"][2])

    def iterated(self, output: int) -> dict:
        """A request of two iterations with two advisor calls, as a client writes its usage.

        The top level adds up the iterations, except that its split of the writes is only
        the first one's.
        """

        message = {"type": "message", "cache_read_input_tokens": 1, "input_tokens": 1}
        advisor = {"type": "advisor_message", "model": "claude-fable-5-1"}
        spent = usage(input_tokens=2, read=2, write_5m=100, output=output)
        spent["cache_creation_input_tokens"] = 300
        spent["iterations"] = [
            {
                **message,
                "output_tokens": 1,
                "cache_creation_input_tokens": 100,
                "cache_creation": {"ephemeral_5m_input_tokens": 100},
            },
            {**advisor, "input_tokens": 1000, "output_tokens": 10},
            {
                **message,
                "output_tokens": output - 1,
                "cache_creation_input_tokens": 200,
                "cache_creation": {"ephemeral_5m_input_tokens": 200},
            },
            {**advisor, "input_tokens": 2000, "output_tokens": 20},
        ]
        return spent

    def test_a_request_of_several_iterations_counts_the_writes_of_each(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(5, spent=self.iterated(50))
        self.read()
        self.assertEqual(300, self.tokens("cache_write_5m_tokens"))

    def test_two_advisor_calls_in_one_request_count_once_each_over_its_records(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(5, request="m1", spent=self.iterated(5))
        run.reply(6, request="m1", stop="end_turn", spent=self.iterated(50))
        self.read()
        rows = [row for row in self.segments() if row["model"] == "claude-fable-5-1"]
        self.assertEqual(3000, sum(row["input_tokens"] for row in rows))
        self.assertEqual(30, sum(row["output_tokens"] for row in rows))
        self.assertTrue(all(row["input_tokens"] >= 0 for row in self.segments()))

    def test_an_advisor_of_the_executors_model_counts_once_over_many_records(self) -> None:
        # A request written as nine records with the same usage, its advisor call run by
        # the executor's own model or by another one: each part counts once.
        for adviser in ("claude-opus-5-5", "claude-fable-5-1"):
            with self.subTest(adviser=adviser):
                run = self.session(f"advised-{adviser}")
                self.ticks((0, HOUR))
                run.prompt(0)
                spent = usage(input_tokens=4, read=447_974, write_5m=10_419, output=2504)
                spent["iterations"] = [
                    {
                        "type": "message",
                        "input_tokens": 4,
                        "cache_read_input_tokens": 447_974,
                        "cache_creation_input_tokens": 10_419,
                        "output_tokens": 2504,
                    },
                    {
                        "type": "advisor_message",
                        "model": adviser,
                        "input_tokens": 208_923,
                        "output_tokens": 16_586,
                    },
                ]
                for record in range(9):
                    run.reply(1 + record, request=f"m-{adviser}", stop="end_turn", spent=spent)
                self.read()
                rows = self.segments(run.session)
                self.assertEqual(4 + 208_923, self.tokens("input_tokens", run.session))
                self.assertEqual(2504 + 16_586, self.tokens("output_tokens", run.session))
                self.assertEqual(447_974, self.tokens("cached_read_tokens", run.session))
                self.assertEqual(10_419, self.tokens("cache_write_5m_tokens", run.session))
                cells = [
                    row[column]
                    for row in rows
                    for column in (*TOKEN_COLUMNS.values(), "estimated_api_cost_usd")
                    if row[column] is not None
                ]
                self.assertTrue(all(cell >= 0 for cell in cells), cells)
                # The later records add no row of their own: one for the executor, whose
                # time goes on past the advisor's, and one for the advisor.
                self.assertEqual([0, 1], [row["advisor"] for row in rows])

    def test_an_advised_request_growing_over_its_records_keeps_one_row_each(self) -> None:
        # The executor's output grows with every record after the advisor's call: it goes
        # on in the executor's row, past the advisor's.
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        for record in range(9):
            spent = advised("claude-fable-5-1")
            spent["output_tokens"] = spent["iterations"][0]["output_tokens"] = 6 + record
            run.reply(1 + record, request="m1", stop="end_turn", spent=spent)
        self.read()
        self.assertEqual(
            [(0, 4, 14, 9.0), (1, 100, 20, 0.0)],
            [
                (row["advisor"], row["input_tokens"], row["output_tokens"], row["seconds"])
                for row in self.segments()
            ],
        )

    def go_on_from_a_former_reader(self, adviser: str, outputs: list[int]) -> dict[str, int]:
        """What the records after the first of an advised request add, read on from the
        state a reader before advisors were kept apart left after the first.

        That reader counted the first record in full and kept its parts by model alone,
        the executor's first and the adviser's after, so one of the executor's model
        took its place. Each record is read in a pass of its own.
        """

        executor = "claude-opus-5-5"
        first = {"input": 4, "output": 100}
        advice = [{"input": 200, "output": 20}, None]
        held = {executor: [first, None], adviser: advice}
        memo: dict = {"requests": {"m1": held}}
        spent: dict[str, int] = {}
        for number, output in enumerate(outputs):
            ledger = Ledger([], memo, liveness.Coverage([]), frozenset().__contains__, _nothing)
            parts = [
                Part(executor, {"input": 4, "output": output}, None),
                Part(adviser, dict(advice[0]), None, advisor=True),
            ]
            ledger.count(Step(1.0 + number, REPLY, request="m1", parts=parts))
            for row in ledger.rows:
                for kind, count in row.tokens.items():
                    self.assertGreaterEqual(count, 0, (number, row))
                    spent[kind] = spent.get(kind, 0) + count
            memo = ledger.memo()
        return spent

    def test_a_former_readers_request_of_an_adviser_of_the_executors_model_goes_on(self) -> None:
        # What it held is the adviser's; the executor's growth up to the first record read
        # on is lost, and from there it counts.
        spent = self.go_on_from_a_former_reader("claude-opus-5-5", [150, 180, 180, 210])
        self.assertEqual({"input": 0, "output": 60}, spent)

    def test_a_former_readers_request_of_another_adviser_goes_on(self) -> None:
        spent = self.go_on_from_a_former_reader("claude-fable-5-1", [150, 180, 180, 210])
        self.assertEqual({"input": 0, "output": 110}, spent)

    def test_a_change_of_model_starts_a_new_row(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10)
        run.reply(20, model="claude-sonnet-5-5")
        run.end_turn(30, model="claude-sonnet-5-5")
        self.read()
        self.assertEqual(
            ["claude-opus-5-5", "claude-sonnet-5-5"], [row["model"] for row in self.segments()]
        )


if __name__ == "__main__":
    unittest.main()
