"""The two reads of the usage rows, as the screen will call them, over real collected rows."""

from __future__ import annotations

import unittest

from server.planning import api, ladder, model, usage
from tests.usage_fixtures import HOUR, Case
from tests.usage_fixtures import usage as spent


def get(conn, path: str, **parameters: str) -> dict:
    status, body = api.handle_get(conn, path, {k: [v] for k, v in parameters.items()})
    assert status == 200
    return body["usage"]


ITEM = "/api/planning/work-item/usage"
SESSION = "/api/planning/session/usage"


class ItemReadTests(Case):
    def test_two_agents_side_by_side_take_the_time_once_and_spend_it_twice(self) -> None:
        reference, identity = self.item()
        self.session()
        self.ticks((0, HOUR))
        for agent in ("one", "two"):
            worker = self.subagent("sess-1", agent, f"build {reference}")
            worker.prompt(100, "go", origin=None)
            worker.reply(110, tools=(("s1", "Bash"),))
            worker.result(190, "s1")
            worker.end_turn(200)
        self.read()
        read = get(self.reader, ITEM, id=reference)
        self.assertEqual(identity, read["work_item_id"])
        self.assertEqual(reference, read["reference"])
        self.assertEqual(100.0, read["elapsed_seconds"])
        self.assertEqual(200.0, read["agent_seconds"])
        self.assertEqual({"one", "two"}, {line["agent_id"] for line in read["agents"]})
        self.assertEqual(
            [{"signal": ladder.LABEL_NUMBER, "seconds": 200.0, "share": 1.0}], read["signals"]
        )
        self.assertEqual("observed", read["quality"])

    def test_tokens_by_kind_cost_and_models_add_up(self) -> None:
        reference, _ = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(
            10, tools=(("w1", "x"),), spent=spent(input_tokens=1, read=2, write_5m=3, output=4)
        )
        self.write("sess-1", reference, 11)
        run.result(12, "w1")
        run.end_turn(
            20,
            model="claude-sonnet-5-5",
            spent=spent(input_tokens=10, read=0, write_5m=0, write_1h=20, output=30),
        )
        self.read()
        read = get(self.reader, ITEM, id=reference)
        self.assertEqual(
            {
                "input": 11,
                "cached_read": 2,
                "cache_write_5m": 3,
                "cache_write_1h": 20,
                "output": 34,
                "reasoning": None,
            },
            read["tokens"],
        )
        opus = (1 * 4 + 2 * 0.2 + 3 * 5 + 4 * 20) / 1e6
        sonnet = (10 * 2 + 20 * 4 + 30 * 10) / 1e6
        self.assertAlmostEqual(opus + sonnet, read["estimated_api_cost_usd"], places=6)
        self.assertEqual(
            {"claude-opus-5-5", "claude-sonnet-5-5"}, {line["model"] for line in read["models"]}
        )
        self.assertEqual([], read["unpriced_models"])
        self.assertEqual(usage.COST_BASIS, read["cost_basis"])
        # Every token has a price, so the cost leaves none out, at any level.
        self.assertEqual(0, read["unpriced_tokens"])
        self.assertEqual({0}, {line["unpriced_tokens"] for line in read["models"]})
        self.assertEqual([0], [line["unpriced_tokens"] for line in read["by_item"]])

    def test_an_item_with_no_rows_reads_nothing_rather_than_zero_tokens(self) -> None:
        reference, _ = self.item()
        read = get(self.reader, ITEM, id=reference)
        self.assertEqual(0.0, read["elapsed_seconds"])
        self.assertEqual({None}, set(read["tokens"].values()))
        self.assertIsNone(read["estimated_api_cost_usd"])
        self.assertIsNone(read["quality"])

    def test_a_model_with_no_price_is_named_and_adds_no_cost(self) -> None:
        reference, _ = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(5, tools=(("w1", "x"),), model="claude-new-9", spent=spent(output=7))
        self.write("sess-1", reference, 6)
        run.result(7, "w1")
        run.end_turn(9, spent=spent(input_tokens=0, read=0, write_5m=0, output=1))
        self.read()
        read = get(self.reader, ITEM, id=reference)
        self.assertEqual(["claude-new-9"], read["unpriced_models"])
        self.assertAlmostEqual(20 / 1e6, read["estimated_api_cost_usd"], places=6)
        self.assertEqual(8, read["tokens"]["output"])
        # The unknown model's request: 10 input, 100 cache reads, 20 cache writes and 7
        # output. The priced one's single output token is not among them.
        self.assertEqual(137, read["unpriced_tokens"])
        self.assertEqual(
            {"claude-new-9": 137, "claude-opus-5-5": 0},
            {line["model"]: line["unpriced_tokens"] for line in read["models"]},
        )
        self.assertEqual([137], [line["unpriced_tokens"] for line in read["by_item"]])

    def test_a_cost_with_no_priced_token_is_null_and_says_what_it_leaves_out(self) -> None:
        reference, _ = self.item()
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(5, tools=(("w1", "x"),), model="claude-new-9", spent=spent(output=7))
        self.write("sess-1", reference, 6)
        run.result(7, "w1")
        run.end_turn(
            9, model="claude-new-9", spent=spent(input_tokens=1, read=2, write_5m=3, output=4)
        )
        self.read()
        read = get(self.reader, ITEM, id=reference)
        self.assertIsNone(read["estimated_api_cost_usd"])
        self.assertEqual((10 + 100 + 20 + 7) + (1 + 2 + 3 + 4), read["unpriced_tokens"])

    def test_an_epic_is_the_union_over_its_children_and_the_sum_of_their_spending(self) -> None:
        epic, _ = self.item("Epic", kind="epic")
        first, _ = self.item("One", parent=epic)
        second, _ = self.item("Two", parent=epic)
        self.session()
        self.ticks((0, HOUR))
        for agent, reference, start in (("one", first, 100), ("two", second, 150)):
            worker = self.subagent("sess-1", agent, f"build {reference}")
            worker.prompt(start, "go", origin=None)
            worker.reply(start + 10, tools=(("s1", "Bash"),))
            worker.result(start + 90, "s1")
            worker.end_turn(start + 100, spent=spent(input_tokens=0, read=0, write_5m=0, output=10))
        self.read()
        read = get(self.reader, ITEM, id=epic, scope="epic")
        self.assertEqual("epic", read["scope"])
        self.assertEqual(150.0, read["elapsed_seconds"])
        self.assertEqual(200.0, read["agent_seconds"])
        self.assertEqual([epic, first, second], [line["reference"] for line in read["by_item"]])
        self.assertEqual([0.0, 100.0, 100.0], [line["elapsed_seconds"] for line in read["by_item"]])
        self.assertEqual(30, read["tokens"]["output"])

    def test_an_unknown_scope_and_an_unknown_item_are_refused(self) -> None:
        reference, _ = self.item()
        for parameters in ({"id": [reference], "scope": ["nope"]}, {"id": ["MAIN-999"]}, {}):
            with (
                self.subTest(parameters),
                self.assertRaises((api.PlanningHttpError, model.PlanningError)),
            ):
                api.handle_get(self.reader, ITEM, parameters)


class SessionReadTests(Case):
    def build(self) -> tuple[str, str]:
        first, _ = self.item("One")
        second, _ = self.item("Two")
        run = self.session()
        self.ticks((0, 2 * HOUR))
        run.prompt(0)
        run.end_turn(10, spent=spent(input_tokens=1, read=0, write_5m=0, output=2))
        run.prompt(100)
        run.reply(
            110, tools=(("w1", "x"),), spent=spent(input_tokens=4, read=0, write_5m=0, output=8)
        )
        self.write("sess-1", first, 111)
        run.result(112, "w1")
        run.reply(
            120, tools=(("w2", "x"),), spent=spent(input_tokens=16, read=0, write_5m=0, output=32)
        )
        self.write("sess-1", second, 121)
        run.result(122, "w2")
        run.end_turn(130, spent=spent(input_tokens=64, read=0, write_5m=0, output=128))
        worker = self.subagent("sess-1", "worker")
        worker.prompt(50, "go", origin=None)
        worker.end_turn(60, spent=spent(input_tokens=256, read=0, write_5m=0, output=512))
        self.read()
        return first, second

    def test_items_and_no_item_add_up_to_the_session(self) -> None:
        first, second = self.build()
        read = get(self.reader, SESSION, session_id="sess-1")
        self.assertEqual(341, read["tokens"]["input"])
        self.assertEqual(682, read["tokens"]["output"])
        self.assertEqual(
            read["tokens"]["output"], sum(line["tokens"]["output"] for line in read["by_item"])
        )
        self.assertEqual(
            read["agent_seconds"], sum(line["agent_seconds"] for line in read["by_item"])
        )
        self.assertAlmostEqual(
            read["estimated_api_cost_usd"],
            sum(line["estimated_api_cost_usd"] for line in read["by_item"]),
            places=5,
        )
        self.assertEqual([second, first, None], [line["reference"] for line in read["by_item"]][:3])
        self.assertIsNone(read["by_item"][-1]["work_item_id"])

    def test_what_was_left_out_and_each_run_are_there(self) -> None:
        self.build()
        read = get(self.reader, SESSION, session_id="sess-1")
        self.assertEqual(90.0, read["excluded"]["human"])
        self.assertEqual(
            {None: "reading", "worker": "reading"},
            {run["agent_id"]: run["status"] for run in read["runs"]},
        )
        self.assertEqual(90.0, read["runs"][0]["excluded"]["human"])
        self.assertLess(read["first_at"], read["last_at"])

    def test_a_session_not_read_yet_reads_empty(self) -> None:
        read = get(self.reader, SESSION, session_id="nobody")
        self.assertEqual([], read["by_item"])
        self.assertEqual([], read["runs"])
        self.assertIsNone(read["first_at"])

    def test_a_deleted_item_keeps_its_line_and_loses_its_name(self) -> None:
        self.build()
        doomed = self.reader.execute(
            "SELECT work_item_id FROM work_items ORDER BY number LIMIT 1"
        ).fetchone()[0]
        self.conn.execute("PRAGMA foreign_keys = OFF")
        self.conn.execute("DELETE FROM work_items WHERE work_item_id = ?", (doomed,))
        self.conn.commit()
        read = get(self.reader, SESSION, session_id="sess-1")
        line = next(line for line in read["by_item"] if line["work_item_id"] == doomed)
        self.assertIsNone(line["reference"])
        self.assertGreater(line["agent_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
