"""Which item a stretch of work goes to: the signals of `planning.ladder`, in order."""

from __future__ import annotations

import json
import unittest

from server.planning import ladder
from tests.usage_fixtures import HOUR, Case, stamp, usage


class CoordinatorTests(Case):
    def test_a_turn_with_writes_to_three_items_splits_at_each(self) -> None:
        first, first_id = self.item()
        second, second_id = self.item()
        third, third_id = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("w1", "mcp__valkama__comment_work_item"),))
        self.write("sess-1", first, 15)
        run.result(20, "w1")
        run.reply(100, tools=(("w2", "mcp__valkama__comment_work_item"),))
        self.write("sess-1", second, 105)
        run.result(110, "w2")
        run.reply(200, tools=(("w3", "mcp__valkama__comment_work_item"),))
        self.write("sess-1", third, 205)
        run.result(210, "w3")
        run.end_turn(300)
        self.read()
        spent: dict[str | None, float] = {}
        for row in self.segments():
            spent[row["work_item_id"]] = spent.get(row["work_item_id"], 0) + row["seconds"]
        # Up to each write goes to it, and what follows the last goes to the last.
        self.assertEqual(
            {first_id: 15, second_id: 90, third_id: 195},
            {item: round(seconds) for item, seconds in spent.items()},
        )
        self.assertEqual(
            {ladder.NEXT_WRITE, ladder.LAST_WRITE}, {row["signal"] for row in self.segments()}
        )

    def test_a_turn_with_no_write_takes_the_last_write_of_the_session(self) -> None:
        reference, identity = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("w1", "x"),))
        self.write("sess-1", reference, 15)
        run.result(20, "w1")
        run.end_turn(30)
        run.prompt(600)
        run.end_turn(630)
        self.read()
        later = [row for row in self.segments() if row["started_at"] >= stamp(600)]
        self.assertEqual(30, round(sum(row["seconds"] for row in later)))
        self.assertEqual({identity}, {row["work_item_id"] for row in later})
        self.assertEqual({ladder.EARLIER_WRITE}, {row["signal"] for row in later})

    def test_a_claim_is_a_write_so_a_turn_after_it_goes_to_the_item_claimed_last(self) -> None:
        first, _ = self.item()
        second, second_id = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        self.claim("sess-1", first, 0)
        self.claim("sess-1", second, 1)
        run.prompt(10)
        run.end_turn(40)
        self.read()
        (row,) = self.segments()
        self.assertEqual((second_id, ladder.EARLIER_WRITE), (row["work_item_id"], row["signal"]))

    def test_a_turn_before_any_write_goes_to_no_item_and_keeps_its_numbers(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(10)
        run.end_turn(40)
        self.read()
        (row,) = self.segments()
        self.assertIsNone(row["work_item_id"])
        self.assertIsNone(row["signal"])
        self.assertEqual(30.0, row["seconds"])
        self.assertEqual(5, row["output_tokens"])

    def test_every_token_lands_once_whatever_the_items(self) -> None:
        first, _ = self.item()
        second, _ = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("w1", "x"),), spent=usage(input_tokens=1, output=100))
        self.write("sess-1", first, 11)
        run.result(12, "w1")
        run.reply(20, tools=(("w2", "x"),), spent=usage(input_tokens=2, output=200))
        self.write("sess-1", second, 21)
        run.result(22, "w2")
        run.end_turn(30, spent=usage(input_tokens=4, output=400))
        self.read()
        self.assertEqual(7, self.tokens("input_tokens"))
        self.assertEqual(700, self.tokens("output_tokens"))
        self.assertEqual(
            3,
            len({row["work_item_id"] for row in self.segments()} | {None}),
        )


class SubagentLadderTests(Case):
    def worker_on(self, label: str = "", packet: str = "go") -> None:
        worker = self.subagent("sess-1", "worker", label)
        worker.prompt(100, packet, origin=None)
        worker.end_turn(200)

    def test_its_write_wins_whatever_else_points_elsewhere(self) -> None:
        written, written_id = self.item()
        named, _ = self.item()
        self.session()
        self.ticks((0, HOUR))
        worker = self.subagent("sess-1", "worker", f"look at {named}")
        worker.prompt(100, f"Build {named}", origin=None)
        worker.reply(120, tools=(("w1", "x"),))
        self.write("sess-1", written, 130, agent="worker")
        worker.result(131, "w1")
        worker.end_turn(200)
        self.read()
        self.assertEqual(
            {written_id}, {r["work_item_id"] for r in self.segments("sess-1", "worker")}
        )

    def test_a_step_it_holds_comes_before_any_number(self) -> None:
        _, stepped_id = self.item()
        named, _ = self.item()
        self.conn.execute(
            "UPDATE work_items SET checklist = ? WHERE work_item_id = ?",
            (
                json.dumps(
                    [
                        {
                            "id": "s",
                            "text": "t",
                            "done": False,
                            "claimed_by": "claude agent worker (session sess-1)",
                        }
                    ]
                ),
                stepped_id,
            ),
        )
        self.conn.commit()
        self.session()
        self.ticks((0, HOUR))
        self.worker_on(packet=f"Build {named}")
        self.read()
        rows = self.segments("sess-1", "worker")
        self.assertEqual(
            {(stepped_id, ladder.HELD_STEP)}, {(r["work_item_id"], r["signal"]) for r in rows}
        )

    def test_the_first_real_number_of_its_packet_places_it(self) -> None:
        first, first_id = self.item()
        second, _ = self.item()
        self.session()
        self.ticks((0, HOUR))
        self.worker_on(packet=f"Read UTF-8 first. Then {first} and later {second}.")
        self.read()
        rows = self.segments("sess-1", "worker")
        self.assertEqual(
            {(first_id, ladder.PACKET_NUMBER)}, {(r["work_item_id"], r["signal"]) for r in rows}
        )
        self.assertEqual(first_id, self.run_row("sess-1", "worker")["packet_item"])

    def test_a_label_comes_next(self) -> None:
        named, named_id = self.item()
        self.session()
        self.ticks((0, HOUR))
        self.worker_on(label=f"build: {named}")
        self.read()
        rows = self.segments("sess-1", "worker")
        self.assertEqual(
            {(named_id, ladder.LABEL_NUMBER)}, {(r["work_item_id"], r["signal"]) for r in rows}
        )

    def test_then_the_one_item_its_parent_holds(self) -> None:
        reference, identity = self.item()
        self.session()
        self.ticks((0, HOUR))
        self.claim("sess-1", reference, 0)
        self.worker_on()
        self.read()
        rows = self.segments("sess-1", "worker")
        self.assertEqual(
            {(identity, ladder.SINGLE_HOLD)}, {(r["work_item_id"], r["signal"]) for r in rows}
        )

    def test_a_parent_holding_several_says_nothing(self) -> None:
        first, _ = self.item()
        second, _ = self.item()
        self.session()
        self.ticks((0, HOUR))
        self.claim("sess-1", first, 0)
        self.claim("sess-1", second, 0)
        self.worker_on()
        self.read()
        self.assertEqual({None}, {r["work_item_id"] for r in self.segments("sess-1", "worker")})

    def test_no_text_reaches_the_store(self) -> None:
        reference, _ = self.item()
        self.session()
        self.ticks((0, HOUR))
        self.worker_on(packet=f"The secret plan for {reference}")
        self.read()
        dump = json.dumps(
            [dict(row) for row in self.reader.execute("SELECT * FROM usage_runs")]
            + [dict(row) for row in self.reader.execute("SELECT * FROM usage_segments")]
        )
        self.assertNotIn("secret", dump)


if __name__ == "__main__":
    unittest.main()
