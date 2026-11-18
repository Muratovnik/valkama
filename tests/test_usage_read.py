"""The two reads of the usage rows, as the screen will call them, over real collected rows."""

from __future__ import annotations

import datetime as dt
import unittest

from server.planning import api, ladder, model, usage
from server.quota import samples, shares
from tests.usage_fixtures import HOUR, Case, stamp
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
        epic, _ = self.item("Epic", kind="goal")
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
        read = get(self.reader, ITEM, id=epic, scope="tree")
        self.assertEqual("tree", read["scope"])
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


#: Two accounts' weeks: each seat names its week's reset.
SEAT, WEEK_ENDS = "week:2030-03-08T09:00Z", "2030-03-08T09:00:00Z"
OTHER_SEAT, OTHER_WEEK_ENDS = "week:2030-03-08T19:00Z", "2030-03-08T19:00:00Z"
#: A later week of the first organization, which a session of its own names.
LATER_SEAT, LATER_WEEK_ENDS = "week:2030-03-09T09:00Z", "2030-03-09T09:00:00Z"
#: Later than every sample, so none is refused as ahead of its clock.
NOW = dt.datetime(2030, 3, 20, tzinfo=dt.UTC)


class ItemSessionsAndQuotaTests(Case):
    """The sessions of an item and the share of each account's week its rows took.

    The rows are written as the collector leaves them, by hand, so each case's costs,
    organizations and times are what it says; the seat of a row is joined from the quota
    samples at read time.
    """

    def segment(
        self,
        session: str,
        item: str | None,
        start: float,
        end: float,
        cost: float | None,
        *,
        organization: str | None = None,
        agent: str = "",
    ) -> None:
        run = self.conn.execute(
            "SELECT id FROM usage_runs WHERE session_id = ? AND agent_id = ?", (session, agent)
        ).fetchone()
        run_id = (
            run[0]
            if run is not None
            else self.conn.execute(
                "INSERT INTO usage_runs(session_id, agent_id, client, path) VALUES (?, ?, ?, ?)",
                (session, agent, "claude", f"{session}-{agent}.jsonl"),
            ).lastrowid
        )
        self.conn.execute(
            "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at, ended_at,"
            " seconds, work_item_id, input_tokens, estimated_api_cost_usd, quality, organization)"
            " VALUES (?, ?, ?, 'claude-opus-5-5', ?, ?, ?, ?, 10, ?, 'observed', ?)",
            (
                run_id,
                session,
                agent,
                stamp(start),
                stamp(end),
                end - start,
                item,
                cost,
                organization,
            ),
        )
        self.conn.commit()

    def week_sample(
        self,
        start: float,
        seat: str,
        resets_at: str,
        percent: float,
        *,
        organization: str | None = None,
        session: str | None = None,
        account: str | None = None,
    ) -> None:
        """A week's percent as a poll of `organization` or a session's status line read it."""

        reading = samples.Reading(
            "poll" if session is None else "mod",
            stamp(start),
            (samples.Window("week", percent, resets_at),),
            seat,
            organization=organization,
            session_id=session,
            account_uuid=account,
        )
        self.assertEqual(1, samples.record(self.conn, reading, now=NOW))
        self.conn.commit()

    def test_sessions_count_spending_and_writing_sessions_once(self) -> None:
        reference, identity = self.item()
        self.segment("sess-1", identity, 0, 600, 0.1)
        self.segment("sess-1", identity, 600, 900, 0.1, agent="worker")
        self.segment("sess-2", identity, 1000, 1200, 0.1)
        self.segment("sess-4", None, 1300, 1400, 0.1)
        self.write("sess-1", reference, 100)
        self.write("sess-3", reference, 2000)
        read = usage.for_item(self.reader, reference)
        # Spent: sess-1, its subagent under it, and sess-2; wrote: sess-1 again and sess-3.
        self.assertEqual(3, read["sessions"])

    def test_a_tree_counts_a_session_on_two_of_its_cards_once(self) -> None:
        goal, goal_id = self.item("Goal", kind="goal")
        task, task_id = self.item("Task", parent=goal)
        self.segment("sess-1", goal_id, 0, 600, 0.1)
        self.segment("sess-1", task_id, 600, 900, 0.1)
        self.write("sess-2", task, 1000)
        self.assertEqual(1, usage.for_item(self.reader, goal)["sessions"])
        self.assertEqual(2, usage.for_item(self.reader, goal, "tree")["sessions"])

    def accounts(self) -> None:
        """Two accounts' weeks: the first organization's at 30 % and then 40 %, the second's at
        70 %, each as its poll read it, and a session of the first on a later week of its own."""

        self.week_sample(-3600, SEAT, WEEK_ENDS, 30, organization="org-1", account="account-a")
        self.week_sample(-1800, SEAT, WEEK_ENDS, 40, organization="org-1", account="account-a")
        self.week_sample(
            -1800, OTHER_SEAT, OTHER_WEEK_ENDS, 70, organization="org-2", account="account-b"
        )
        # Its own feed names its seat, so its work there is not on the first week.
        self.segment("sess-9", None, 3600, 4800, 1.0, organization="org-1")
        self.week_sample(3900, LATER_SEAT, LATER_WEEK_ENDS, 10, session="sess-9")

    def test_quota_is_the_cards_share_of_its_seats_week(self) -> None:
        reference, identity = self.item()
        self.accounts()
        self.segment("sess-1", identity, 0, 600, 0.3, organization="org-1")
        self.segment("sess-1", identity, 1200, 1800, 0.1, organization="org-1")
        self.segment("sess-1", identity, 1800, 2100, 0.1)
        self.segment("sess-2", None, 2400, 3000, 0.6, organization="org-1")
        self.segment("sess-3", identity, 0, 600, 0.5, organization="org-2")
        quota = usage.for_item(self.reader, reference, quota=shares.of_segments)["quota"]
        # Newest first. The first week: the card's 0.4 of the 1.0 its seat cost, at the
        # latest 40 %; the second: all its seat cost, at 70 %. The row on no organization is
        # 0.1 of the card's 1.0.
        self.assertEqual(
            {
                "weeks": [
                    {
                        "account": {"organization": "org-2", "account_uuid": "account-b"},
                        "seat": OTHER_SEAT,
                        "week_ends_at": "2030-03-08T19:00:00.000Z",
                        "share": 1.0,
                        "week_used_percent": 70.0,
                        "percent": 70.0,
                    },
                    {
                        "account": {"organization": "org-1", "account_uuid": "account-a"},
                        "seat": SEAT,
                        "week_ends_at": "2030-03-08T09:00:00.000Z",
                        "share": 0.4,
                        "week_used_percent": 40.0,
                        "percent": 16.0,
                    },
                ],
                "unknown_share": 0.1,
            },
            quota,
        )

    def test_a_trees_quota_is_the_quota_of_all_its_cards(self) -> None:
        goal, goal_id = self.item("Goal", kind="goal")
        _, task_id = self.item("Task", parent=goal)
        self.accounts()
        self.segment("sess-1", goal_id, 0, 600, 0.1, organization="org-1")
        self.segment("sess-1", task_id, 600, 1200, 0.4, organization="org-1")
        self.segment("sess-2", None, 1200, 1800, 0.5, organization="org-1")
        for scope, share, percent in (("item", 0.1, 4.0), ("tree", 0.5, 20.0)):
            with self.subTest(scope):
                quota = usage.for_item(self.reader, goal, scope, quota=shares.of_segments)["quota"]
                (week,) = quota["weeks"]
                self.assertEqual((share, percent), (week["share"], week["percent"]))
                self.assertEqual(0.0, quota["unknown_share"])

    def test_without_a_reader_the_read_has_no_quota(self) -> None:
        reference, identity = self.item()
        self.accounts()
        self.segment("sess-1", identity, 0, 600, 0.3, organization="org-1")
        self.assertNotIn("quota", usage.for_item(self.reader, reference))
        self.assertNotIn("quota", get(self.reader, ITEM, id=reference))
        status, body = api.handle_get(
            self.reader, ITEM, {"id": [reference]}, item_quota=shares.of_segments
        )
        self.assertEqual((200, 40.0), (status, body["usage"]["quota"]["weeks"][0]["percent"]))

    def test_a_card_whose_rows_have_no_price_took_no_share(self) -> None:
        reference, identity = self.item()
        self.accounts()
        self.segment("sess-1", identity, 0, 600, None, organization="org-1")
        self.segment("sess-2", None, 600, 1200, 0.5, organization="org-1")
        quota = usage.for_item(self.reader, reference, quota=shares.of_segments)["quota"]
        # Nothing to divide: no part of its cost is on no seat, and none is on one.
        self.assertIsNone(quota["unknown_share"])
        (week,) = quota["weeks"]
        self.assertEqual((0.0, 0.0), (week["share"], week["percent"]))


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


class PeriodTests(unittest.TestCase):
    """The period grammar every read over a period takes, refusing in Analytics' words."""

    FIRST = dt.date(2030, 1, 1)

    def days(self, count: int) -> str:
        return (self.FIRST + dt.timedelta(days=count)).isoformat()

    def refusal(self, start: str, end: str, **options) -> str:
        with self.assertRaises(usage.UsageQueryError) as raised:
            usage.period(start, end, **options)
        return str(raised.exception)

    def test_a_period_of_the_most_days_is_held_and_one_day_more_is_refused(self) -> None:
        start = self.FIRST.isoformat()
        begins, ends = usage.period(start, self.days(2400), utc_offset=330)
        self.assertEqual(2400 * 86_400 * 1_000_000, ends - begins)
        self.assertEqual(
            "the period holds more than 2400 steps of one day",
            self.refusal(start, self.days(2401), utc_offset=330),
        )

    def test_an_offset_beyond_any_zone_is_refused_before_the_dates_are_read(self) -> None:
        for offset in (841, -841):
            with self.subTest(offset):
                self.assertEqual(
                    "utc_offset must be from -840 to 840 minutes",
                    self.refusal("yesterday", self.days(1), utc_offset=offset),
                )
        with self.assertRaises(usage.UsageQueryError) as raised:
            usage.caller_zone(841)
        self.assertEqual("utc_offset must be from -840 to 840 minutes", str(raised.exception))
        self.assertEqual(dt.timedelta(minutes=-840), usage.caller_zone(-840).utcoffset(None))


if __name__ == "__main__":
    unittest.main()
