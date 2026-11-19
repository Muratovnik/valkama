"""The Analytics read of usage: what agent work spent in a period, cut by its dimensions."""

from __future__ import annotations

import json
import sqlite3
import threading
import unittest
from unittest import mock

from server import store
from server.analytics import usage
from server.planning import live_sessions
from server.planning import usage as item_usage
from server.projects import project_registry
from tests.analytics_fixtures import DAY, HOUR, UsageStore, day, stamp, tokens_sum

#: What the read may miss a per-session read by, for each stretch: it counts a stretch's
#: seconds in whole milliseconds and its cost in whole millionths of a dollar.
_HALF_MILLISECOND = 0.0005
_HALF_MICRO_USD = 5e-7


class TotalsTests(UsageStore):
    def test_the_whole_store_is_what_the_per_item_and_per_session_reads_say(self) -> None:
        reference, item = self.item()
        self.session("s-1")
        # Seconds and costs a millisecond and a millionth of a dollar cannot hold exactly.
        self.segment(
            "s-1", 0, HOUR, seconds=3599.9996, item=item, tokens=(1, 2, 3, 4, 5, 6), cost=0.1234566
        )
        # Two agents side by side: their time is spent twice.
        self.segment(
            "s-1",
            600,
            1800,
            agent="worker",
            seconds=1199.0004,
            item=item,
            quality="estimated",
            cost=0.0000016,
        )
        self.segment("s-1", 2 * HOUR, 3 * HOUR, model="claude-unknown-9", cost=None)
        self.segment(
            "s-2",
            DAY - 60,
            DAY + 60,
            seconds=120.0006,
            tokens=(7, None, None, None, 9, None),
            cost=1 / 3,
        )
        self.segment("s-2", 2 * DAY, 2 * DAY, seconds=0, model="claude-side-1", cost=0.002)
        stretches = 5
        read = self.read(**{"from": day(-1), "to": day(5), "step": "hour", "group_by": "model"})
        sessions = [item_usage.for_session(self.conn, name) for name in ("s-1", "s-2")]
        total = read["total"]
        # Each per-session figure is rounded once more, after its own sum.
        seconds = _HALF_MILLISECOND * (stretches + len(sessions))
        dollars = _HALF_MICRO_USD * (stretches + len(sessions))
        for name in ("agent_seconds", "estimated_seconds"):
            self.assertAlmostEqual(
                sum(s[name] for s in sessions), total[name], delta=seconds, msg=name
            )
        self.assertAlmostEqual(
            sum(s["estimated_api_cost_usd"] for s in sessions),
            total["estimated_api_cost_usd"],
            delta=dollars,
        )
        self.assertEqual(tokens_sum(sessions), total["tokens"])
        self.assertEqual(sum(s["unpriced_tokens"] for s in sessions), total["unpriced_tokens"])
        # The item's own read, and the same item as one row of this read.
        on_item = item_usage.for_item(self.conn, reference)
        row = self.read(**{"from": day(-1), "to": day(5), "group_by": "work_item"})["rows"][0]
        self.assertEqual(item, row["group"]["work_item"]["id"])
        self.assertAlmostEqual(
            on_item["agent_seconds"], row["agent_seconds"], delta=3 * _HALF_MILLISECOND
        )
        self.assertAlmostEqual(
            on_item["estimated_api_cost_usd"],
            row["estimated_api_cost_usd"],
            delta=3 * _HALF_MICRO_USD,
        )
        self.assertEqual(on_item["tokens"], row["tokens"])
        # Each stretch counted in whole units, so the read is these exact sums.
        # 3600.000 + 1199.000 + 3600.000 + 120.001 seconds; 0.123457 + 0.000002 + 0.333333 +
        # 0.002 dollars.
        self.assertEqual(8519.001, total["agent_seconds"])
        self.assertEqual(1199.0, total["estimated_seconds"])
        self.assertEqual(0.458792, total["estimated_api_cost_usd"])
        self.assertEqual(["claude-unknown-9"], total["unpriced_models"])
        self.assertEqual("mixed", total["quality"])
        self.assertEqual(item_usage.COST_BASIS, read["cost_basis"])
        self.assertEqual(stamp(2 * DAY), read["last_event_at"])
        self.assertNotIn("elapsed_seconds", total)

    def test_a_stretch_across_the_callers_midnight_lands_in_two_days_in_proportion(self) -> None:
        self.session("s-1")
        # 20:00 to 23:00 UTC is 23:00 to 02:00 at UTC+3: one hour before midnight, two after.
        self.segment("s-1", 20 * HOUR, 23 * HOUR, tokens=(100, None, 0, None, 7, None), cost=0.3)
        read = self.read(**{"from": day(0), "to": day(2), "utc_offset": "180"})
        first, second = read["series"]
        self.assertEqual("2030-03-04T00:00:00+03:00", first["start"])
        self.assertEqual("2030-03-05T00:00:00+03:00", first["end"])
        self.assertEqual("2030-03-05T00:00:00+03:00", second["start"])
        self.assertEqual(3600.0, first["agent_seconds"])
        self.assertEqual(7200.0, second["agent_seconds"])
        self.assertAlmostEqual(0.1, first["estimated_api_cost_usd"])
        self.assertAlmostEqual(0.2, second["estimated_api_cost_usd"])
        # Whole tokens: 100 splits 33 and 67, 7 splits 2 and 5, 0 stays 0 on both sides.
        self.assertEqual(
            (33, 0, 2), tuple(first["tokens"][k] for k in ("input", "cache_write_5m", "output"))
        )
        self.assertEqual(
            (67, 0, 5), tuple(second["tokens"][k] for k in ("input", "cache_write_5m", "output"))
        )
        self.assertIsNone(first["tokens"]["cached_read"])
        # At UTC the same stretch lies inside one day.
        utc = self.read(**{"from": day(0), "to": day(2)})
        self.assertEqual([10800.0, 0.0], [point["agent_seconds"] for point in utc["series"]])

    def test_a_stretch_over_an_edge_of_the_period_counts_only_its_share_inside(self) -> None:
        self.session("s-1")
        self.segment("s-1", -HOUR, HOUR, tokens=(9, None, None, None, None, None), cost=1.0)
        read = self.read(**{"from": day(0), "to": day(1), "step": "hour"})
        self.assertEqual(3600.0, read["total"]["agent_seconds"])
        self.assertEqual(0.5, read["total"]["estimated_api_cost_usd"])
        # By the period's start the stretch has spent half its 9 tokens, 4.5, rounded up to 5:
        # the 4 left are what it spends inside.
        self.assertEqual(4, read["total"]["tokens"]["input"])
        self.assertEqual(24, len(read["series"]))
        self.assertEqual(3600.0, read["series"][0]["agent_seconds"])

    def test_an_hour_by_the_minute_holds_each_minutes_share_of_a_stretch(self) -> None:
        self.session("s-1")
        # Ninety seconds from half a minute past the hour: 30 s, 60 s and nothing after.
        self.segment("s-1", 30, 120, tokens=(9, None, None, None, None, None), cost=0.9)
        read = self.read(**{"from": stamp(0), "to": stamp(HOUR), "step": "minute"})
        series = read["series"]
        self.assertEqual(60, len(series))
        self.assertEqual([30.0, 60.0, 0.0], [point["agent_seconds"] for point in series[:3]])
        # A third of the 9 tokens by the first full minute, the rest in the second.
        self.assertEqual([3, 6], [point["tokens"]["input"] for point in series[:2]])
        self.assertEqual(9, read["total"]["tokens"]["input"])
        # At an offset of half an hour a minute still starts on the caller's full minute.
        shifted = self.read(
            **{"from": stamp(0), "to": stamp(HOUR), "step": "minute", "utc_offset": "-330"}
        )
        self.assertEqual(
            [point["agent_seconds"] for point in series],
            [point["agent_seconds"] for point in shifted["series"]],
        )
        self.assertEqual("2030-03-03T18:30:00-05:30", shifted["series"][0]["start"])

    def test_an_empty_period_reads_nothing_rather_than_zero_tokens(self) -> None:
        self.session("s-1")
        self.segment("s-1", 10 * DAY, 10 * DAY + 60)
        read = self.read(**{"from": day(0), "to": day(2), "group_by": "model", "compare": "true"})
        self.assertEqual(0.0, read["total"]["agent_seconds"])
        self.assertEqual({None}, set(read["total"]["tokens"].values()))
        self.assertIsNone(read["total"]["estimated_api_cost_usd"])
        self.assertIsNone(read["total"]["quality"])
        self.assertEqual([], read["rows"])
        self.assertEqual(2, len(read["series"]))
        self.assertEqual([[], []], [point["groups"] for point in read["series"]])
        self.assertEqual([], read["comparison"]["rows"])
        self.assertEqual(
            {
                "from": "2030-03-04T00:00:00+00:00",
                "to": "2030-03-06T00:00:00+00:00",
                "step": "day",
                "utc_offset": 0,
            },
            read["period"],
        )


class ConcurrencyTests(UsageStore):
    def test_reads_sent_together_are_worked_out_one_after_another(self) -> None:
        """Side by side, the reads of one page traded the interpreter lock on every row
        and each cost several times its own work; one at a time, the first is answered
        in its own time. A second read starts only once the first is done."""

        self.session("s-1")
        self.segment("s-1", 0, HOUR)
        request = usage.query(start=day(0), end=day(1), step="day", utc_offset=0)
        first_inside, first_may_finish = threading.Event(), threading.Event()
        second_inside = threading.Event()
        work_out = usage._read
        answers: list[dict] = []

        def held_open(conn: sqlite3.Connection, query: usage.UsageQuery) -> dict:
            if not first_inside.is_set():
                first_inside.set()
                first_may_finish.wait(10)
            else:
                second_inside.set()
            return work_out(conn, query)

        def one() -> None:
            conn = store.connect_for_read()
            try:
                answers.append(usage.read(conn, request))
            finally:
                conn.close()

        with mock.patch.object(usage, "_read", held_open):
            first = threading.Thread(target=one)
            first.start()
            self.assertTrue(first_inside.wait(5))
            second = threading.Thread(target=one)
            second.start()
            try:
                self.assertFalse(second_inside.wait(0.3), "two reads were worked out at once")
            finally:
                first_may_finish.set()
                first.join(10)
                second.join(10)
        self.assertTrue(second_inside.is_set())
        self.assertEqual(2, len(answers))
        self.assertEqual(answers[0], answers[1])
        self.assertEqual(HOUR, answers[0]["total"]["agent_seconds"])


class GroupTests(UsageStore):
    def test_a_value_the_store_does_not_hold_is_its_own_group_named_unknown(self) -> None:
        self.session("s-1")
        self.segment("s-1", 0, 60, organization="org-a")
        self.segment("s-1", 60, 180)
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "account"})
        self.assertEqual(
            [{"id": None, "unknown": True}, {"id": "org-a", "unknown": False}],
            [row["group"]["account"] for row in read["rows"]],
        )

    def test_work_on_no_item_is_its_own_group_and_not_unknown(self) -> None:
        reference, item = self.item("Build the read")
        self.session("s-1")
        self.segment("s-1", 0, 60, item=item)
        self.segment("s-1", 60, 90)
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "work_item"})
        self.assertEqual(
            [
                {
                    "id": item,
                    "unknown": False,
                    "reference": reference,
                    "title": "Build the read",
                    "kind": "task",
                },
                {"id": None, "unknown": False, "reference": None, "title": None, "kind": None},
            ],
            [row["group"]["work_item"] for row in read["rows"]],
        )

    def test_an_item_value_says_its_kind_so_an_epic_is_read_as_its_card_reads_it(self) -> None:
        _, epic = self.item("Plan the release", kind="epic")
        self.session("s-1")
        self.segment("s-1", 0, 60, item=epic)
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "work_item"})
        self.assertEqual(["epic"], [row["group"]["work_item"]["kind"] for row in read["rows"]])

    def test_with_no_readable_registry_a_folder_reads_as_no_known_project(self) -> None:
        _, item = self.item()
        self.session("s-in-beta", self.beta_root / "src")
        self.segment("s-in-beta", 0, 300)
        self.segment("s-in-beta", 300, 400, item=item)

        def unreadable() -> bytes:
            raise FileNotFoundError

        with mock.patch.object(project_registry, "_read_registry_bytes", unreadable):
            read = self.read(**{"from": day(0), "to": day(1), "group_by": "project"})
        self.assertEqual(
            [
                ({"id": None, "unknown": True, "name": None}, 300.0),
                # The item's space still names its project.
                ({"id": "alpha", "unknown": False, "name": None}, 100.0),
            ],
            [(row["group"]["project"], row["agent_seconds"]) for row in read["rows"]],
        )

    def test_a_project_is_the_items_space_or_the_root_holding_the_working_directory(self) -> None:
        _, item = self.item()
        self.session("s-in-beta", self.beta_root / "src" / "deep")
        self.session("s-nowhere", self.root / "elsewhere")
        self.segment("s-nowhere", 0, 400, item=item)
        self.segment("s-in-beta", 0, 300)
        self.segment("s-nowhere", 400, 600)
        self.segment("s-no-row", 600, 700)
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "project"})
        self.assertEqual(
            [
                ({"id": "alpha", "unknown": False, "name": "Alpha project"}, 400.0),
                ({"id": None, "unknown": True, "name": None}, 300.0),
                ({"id": "beta", "unknown": False, "name": "Beta project"}, 300.0),
            ],
            [(row["group"]["project"], row["agent_seconds"]) for row in read["rows"]],
        )

    def test_an_executor_is_the_session_a_subagent_works_in(self) -> None:
        self.session("s-1")
        self.segment("s-1", 0, 60)
        self.segment("s-1", 0, 120, agent="worker")
        self.segment("s-unrecorded", 0, 30)
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "executor"})
        executors = [row["group"]["executor"] for row in read["rows"]]
        self.assertEqual(["s-1", "s-unrecorded"], [e["id"] for e in executors])
        self.assertEqual(180.0, read["rows"][0]["agent_seconds"])
        # What it was opened as and where, and the name its client gave it: none written yet.
        self.assertEqual(
            {
                "id": "s-1",
                "unknown": False,
                "family": "claude",
                "opened_in": "",
                "opened_host": "",
                "title": None,
            },
            executors[0],
        )
        self.assertEqual(
            {
                "id": "s-unrecorded",
                "unknown": False,
                "family": "",
                "opened_in": "",
                "opened_host": "",
                "title": None,
            },
            executors[1],
        )

    def titled(self, session: str, *records: dict, client: str = "claude") -> None:
        """A session whose transcript holds these records, as its client writes them."""

        self.session(session, client=client)
        path = self.root / "transcripts" / f"{session}.jsonl"
        path.parent.mkdir(exist_ok=True)
        path.write_text("".join(json.dumps(record) + "\n" for record in records), "utf-8")

    def test_an_executor_is_named_by_the_title_its_client_gave_the_session(self) -> None:
        live_sessions._titles.clear()
        self.addCleanup(live_sessions._titles.clear)
        self.titled(
            "s-named",
            {"type": "ai-title", "aiTitle": "Its own"},
            {"type": "custom-title", "customTitle": "Fix the rail"},
        )
        self.titled("s-codex", {"type": "ai-title", "aiTitle": "Not read"}, client="codex")
        self.session("s-silent")
        for session in ("s-named", "s-codex", "s-silent"):
            self.segment(session, 0, 60)
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "executor"})
        named = {row["group"]["executor"]["id"]: row["group"]["executor"] for row in read["rows"]}
        # A person's name for it wins, as the live work beside the board says it.
        self.assertEqual("Fix the rail", named["s-named"]["title"])
        self.assertEqual("claude", named["s-named"]["family"])
        # Another client's transcript is not read, and a session with no title names nothing.
        self.assertIsNone(named["s-codex"]["title"])
        self.assertIsNone(named["s-silent"]["title"])

    def test_a_transcript_is_read_once_per_read_and_not_again_while_it_is_unchanged(self) -> None:
        live_sessions._titles.clear()
        self.addCleanup(live_sessions._titles.clear)
        self.titled("s-1", {"type": "ai-title", "aiTitle": "Once"})
        # Two days, a period before and two dimensions: the session is named in every part.
        self.segment("s-1", 0, 60, organization="org-1")
        self.segment("s-1", DAY, DAY + 60, organization="org-2")
        query = {"from": day(1), "to": day(2), "group_by": "executor,account", "compare": "true"}
        with mock.patch.object(live_sessions, "_title_in", wraps=live_sessions._title_in) as tail:
            first = self.read(**query)
            self.assertEqual(1, tail.call_count)
            self.assertEqual(first, self.read(**query))
            self.assertEqual(1, tail.call_count)
        self.assertEqual("Once", first["rows"][0]["group"]["executor"]["title"])

    def test_a_sessions_own_run_has_no_launch_class_and_a_subagents_may_be_unknown(
        self,
    ) -> None:
        self.session("s-1")
        self.segment("s-1", 0, 60)
        self.segment("s-1", 0, 120, agent="worker", launch_class="interactive")
        self.segment("s-1", 0, 240, agent="helper")
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "launch_class"})
        self.assertEqual(
            [
                ({"id": None, "unknown": True}, 240.0),
                ({"id": "interactive", "unknown": False}, 120.0),
                # The session's own run: launched by no one, so nothing is unknown.
                ({"id": None, "unknown": False}, 60.0),
            ],
            [(row["group"]["launch_class"], row["agent_seconds"]) for row in read["rows"]],
        )

        def seconds(**filters: str) -> float:
            return self.read(**{"from": day(0), "to": day(1), **filters})["total"]["agent_seconds"]

        self.assertEqual(60.0, seconds(none="launch_class"))
        self.assertEqual(180.0, seconds(launch_class="interactive", none="launch_class"))
        self.assertEqual(120.0, seconds(launch_class="interactive"))

    def test_a_role_says_who_spent_it_and_an_adviser_keeps_its_runs_launch_class(
        self,
    ) -> None:
        self.session("s-1")
        self.segment("s-1", 0, 60)
        self.segment("s-1", 60, 90, advisor=True)
        self.segment("s-1", 0, 120, agent="worker", launch_class="interactive")
        self.segment("s-1", 120, 135, agent="worker", launch_class="interactive", advisor=True)
        period = {"from": day(0), "to": day(1)}
        read = self.read(**period, group_by="role")
        self.assertEqual(
            [("subagent", 120.0), ("main", 60.0), ("advisor", 45.0)],
            [(row["group"]["role"]["id"], row["agent_seconds"]) for row in read["rows"]],
        )
        self.assertEqual({False}, {row["group"]["role"]["unknown"] for row in read["rows"]})
        self.assertEqual(225.0, read["total"]["agent_seconds"])
        paired = self.read(**period, group_by="role,launch_class")
        self.assertEqual(
            [
                ("subagent", "interactive", False, 120.0),
                ("main", None, False, 60.0),
                ("advisor", None, False, 30.0),
                ("advisor", "interactive", False, 15.0),
            ],
            [
                (
                    row["group"]["role"]["id"],
                    row["group"]["launch_class"]["id"],
                    row["group"]["launch_class"]["unknown"],
                    row["agent_seconds"],
                )
                for row in paired["rows"]
            ],
        )

        def seconds(**filters: str) -> float:
            return self.read(**period, **filters)["total"]["agent_seconds"]

        self.assertEqual(45.0, seconds(role="advisor"))
        self.assertEqual(180.0, seconds(role="main,subagent"))
        self.assertEqual(15.0, seconds(role="advisor", launch_class="interactive"))
        # A role is never missing.
        self.assertEqual(0.0, seconds(none="role"))

    def test_the_series_is_broken_down_by_the_pair_of_two_groupings(self) -> None:
        self.session("s-1")
        # One model at two efforts in the first step, so a step by the model alone would
        # fold them into one group.
        self.segment("s-1", 0, 60, model="m-1", effort="high", tokens=(7, 70, 0, None, 1, None))
        self.segment("s-1", 100, 130, model="m-1", effort="low", cost=0.02)
        self.segment("s-1", 200, 215, model="m-2", effort="high", cost=None)
        self.segment("s-1", DAY, DAY + 30, model="m-2")
        read = self.read(**{"from": day(0), "to": day(2), "group_by": "model,effort"})
        self.assertEqual(
            [[("m-1", "high"), ("m-1", "low"), ("m-2", "high")], [("m-2", None)]],
            [
                [(g["group"]["model"]["id"], g["group"]["effort"]["id"]) for g in point["groups"]]
                for point in read["series"]
            ],
        )
        for point in read["series"]:
            for group in point["groups"]:
                self.assertEqual({"model", "effort"}, set(group["group"]))
        # A pair names its values as the rows do.
        rows = {
            (row["group"]["model"]["id"], row["group"]["effort"]["id"]): row["group"]
            for row in read["rows"]
        }
        for point in read["series"]:
            for group in point["groups"]:
                pair = (group["group"]["model"]["id"], group["group"]["effort"]["id"])
                self.assertEqual(rows[pair], group["group"])
        # The pairs of a step add up to the step, figure by figure.
        first = read["series"][0]
        self.assertEqual(first["agent_seconds"], sum(g["agent_seconds"] for g in first["groups"]))
        self.assertEqual(105.0, first["agent_seconds"])
        self.assertEqual(
            first["estimated_api_cost_usd"],
            round(sum(g["estimated_api_cost_usd"] or 0 for g in first["groups"]), 6),
        )
        for kind, value in first["tokens"].items():
            parts = [g["tokens"][kind] for g in first["groups"] if g["tokens"][kind] is not None]
            self.assertEqual(value, sum(parts) if parts else None, kind)

    def test_the_series_by_one_grouping_names_that_dimension_alone(self) -> None:
        self.session("s-1")
        self.segment("s-1", 0, 60, model="m-1", effort="high")
        self.segment("s-1", 100, 130, model="m-1", effort="low")
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "model"})
        self.assertEqual(
            [[({"model"}, "m-1", 90.0)]],
            [
                [(set(g["group"]), g["group"]["model"]["id"], g["agent_seconds"])]
                for point in read["series"]
                for g in point["groups"]
            ],
        )


class FilterTests(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        self.session("s-1")
        self.segment("s-1", 0, 60, model="m-1", organization="org-a")
        self.segment("s-1", 60, 180, model="m-2")
        self.segment("s-1", 180, 420, model=None, organization="org-b")

    def seconds(self, **filters: str) -> float:
        return self.read(**{"from": day(0), "to": day(1), **filters})["total"]["agent_seconds"]

    def test_a_filter_keeps_only_its_values(self) -> None:
        self.assertEqual(60.0, self.seconds(model="m-1"))
        self.assertEqual(180.0, self.seconds(model="m-1,m-2"))
        self.assertEqual(240.0, self.seconds(none="model"))
        self.assertEqual(300.0, self.seconds(model="m-1", none="model"))
        # Unknown in both at once: no stretch is.
        self.assertEqual(0.0, self.seconds(none="account,model"))

    def test_an_empty_value_is_no_filter(self) -> None:
        self.assertEqual(420.0, self.seconds(model="", none=""))
        self.assertEqual(self.seconds(), self.seconds(model="", account="", group_by=""))

    def test_filters_on_two_dimensions_both_hold(self) -> None:
        self.assertEqual(60.0, self.seconds(model="m-1,m-2", account="org-a"))
        self.assertEqual(0.0, self.seconds(model="m-2", account="org-b"))
        self.assertEqual(120.0, self.seconds(model="m-2", none="account"))

    def test_a_filter_on_a_project_reads_the_derived_project(self) -> None:
        self.assertEqual(420.0, self.seconds(none="project"))
        self.assertEqual(0.0, self.seconds(project="alpha"))


class ComparisonTests(UsageStore):
    def test_the_comparison_is_the_preceding_period_of_equal_length(self) -> None:
        self.session("s-1")
        self.segment("s-1", -DAY + 60, -DAY + 120, model="m-1")
        self.segment("s-1", -2 * DAY + 60, -2 * DAY + 600, model="m-1")
        self.segment("s-1", 60, 300, model="m-2")
        read = self.read(**{"from": day(-1), "to": day(1), "group_by": "model", "compare": "true"})
        self.assertEqual(
            {"from": "2030-03-01T00:00:00+00:00", "to": "2030-03-03T00:00:00+00:00"},
            read["comparison"]["period"],
        )
        self.assertEqual(600.0 - 60.0, read["comparison"]["total"]["agent_seconds"])
        self.assertEqual(
            ["m-1"], [row["group"]["model"]["id"] for row in read["comparison"]["rows"]]
        )
        self.assertEqual(300.0, read["total"]["agent_seconds"])
        self.assertIsNone(self.read(**{"from": day(-1), "to": day(1)})["comparison"])


#: Three accounts of one organization, each on its own seat this week, and a seat no
#: sample with an account names.
SEAT_1, SEAT_2, SEAT_3 = (
    "week:2030-03-08T09:00Z",
    "week:2030-03-08T19:00Z",
    "week:2030-03-09T05:00Z",
)
SEAT_P = "week:2030-03-10T01:00Z"
#: The account that seat's readings are known by, its organization's own: no account of
#: it names the seat or resets at that time of week (Sunday, 01:00 UTC).
WEEKLY_P = "org-a/weekly:7T01:00Z"


class SeatTests(UsageStore):
    """Which quota account a stretch was spent on, by the seat its samples say it was on."""

    def setUp(self) -> None:
        super().setUp()
        sessions = {"s-1": "org-a", "s-2": "org-a", "s-3": "org-a", "s-4": "org-b", "s-6": "org-c"}
        for session, organization in sessions.items():
            # What each session worked for, outside every period read here.
            self.segment(session, -2 * DAY, -2 * DAY, seconds=0.0, organization=organization)
        for at, account, seat in (
            (0, "acct-1", SEAT_1),
            (1, "acct-2", SEAT_2),
            (2, "acct-3", SEAT_3),
        ):
            self.quota_sample(at, seat, organization="org-a", account=account)
        # The same account's UUID in another organization is another account.
        self.quota_sample(0, SEAT_1, organization="org-c", account="acct-1")
        self.quota_sample(-DAY + 10, SEAT_2, session="s-1")
        for session, seat in (("s-1", SEAT_1), ("s-2", SEAT_2), ("s-3", SEAT_P)):
            self.quota_sample(10, seat, session=session)
        self.segment("s-1", 60, 660, organization="org-a")
        self.segment("s-2", 60, 360, organization="org-a")
        self.segment("s-3", 60, 160, organization="org-a")
        # No sample of org-b says where its work was, and work with no organization has none.
        self.segment("s-4", 60, 110, organization="org-b")
        self.segment("s-5", 60, 80)
        self.segment("s-6", 60, 90, organization="org-c")
        # The day before, s-1's own feed named another seat.
        self.segment("s-1", -DAY + 60, -DAY + 260, organization="org-a")

    def seat_rows(self, read: dict, key: str = "rows") -> list[tuple[dict, float]]:
        lines = read[key] if key == "rows" else read["comparison"]["rows"]
        return [(row["group"]["seat"], row["agent_seconds"]) for row in lines]

    def test_a_seat_is_its_account_else_its_organization_else_unknown(self) -> None:
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "seat"})

        def account(organization: str, uuid: str | None, slot: str | None) -> dict:
            tail = uuid or ("" if slot is None else f"weekly:{slot}")
            return {
                "id": f"{organization}/{tail}",
                "unknown": False,
                "organization": organization,
                "account_uuid": uuid,
                "weekly_reset": slot,
                "shared": False,
            }

        unknown = {
            "id": None,
            "unknown": True,
            "organization": None,
            "account_uuid": None,
            "weekly_reset": None,
            "shared": False,
        }
        self.assertEqual(
            [
                (account("org-a", "acct-1", "5T09:00Z"), 600.0),
                (account("org-a", "acct-2", "5T19:00Z"), 300.0),
                # Known by its weekly reset alone.
                (account("org-a", None, "7T01:00Z"), 100.0),
                # Work of an organization no sample speaks for is that organization's.
                (account("org-b", None, None), 50.0),
                (account("org-c", "acct-1", "5T09:00Z"), 30.0),
                # Work of no organization is unknown.
                (unknown, 20.0),
            ],
            self.seat_rows(read),
        )
        self.assertEqual(1100.0, read["total"]["agent_seconds"])
        self.assertEqual(
            read["total"]["agent_seconds"], sum(row["agent_seconds"] for row in read["rows"])
        )
        self.assertEqual(
            [["org-a/acct-1", "org-a/acct-2", WEEKLY_P, "org-b/", "org-c/acct-1", None]],
            [
                [group["group"]["seat"]["id"] for group in point["groups"]]
                for point in read["series"]
            ],
        )

    def test_a_filter_admits_a_seats_values_and_none_its_unknown(self) -> None:
        def seconds(**filters: str) -> float:
            return self.read(**{"from": day(0), "to": day(1), **filters})["total"]["agent_seconds"]

        self.assertEqual(630.0, seconds(seat="org-a/acct-1,org-c/acct-1"))
        self.assertEqual(100.0, seconds(seat=WEEKLY_P))
        self.assertEqual(20.0, seconds(none="seat"))
        self.assertEqual(620.0, seconds(seat="org-a/acct-1", none="seat"))
        self.assertEqual(0.0, seconds(seat="acct-1"))
        # An organization's work no sample places is matched by its own value, exactly.
        self.assertEqual(50.0, seconds(seat="org-b/"))
        self.assertEqual(0.0, seconds(seat="org-b"))
        self.assertEqual(0.0, seconds(account="org-b", none="seat"))
        # A seat's key, as an unreleased build named a weekly account, matches nothing.
        self.assertEqual(0.0, seconds(seat=f"org-a/{SEAT_P}"))

    def test_a_seat_beside_another_dimension_and_the_period_before(self) -> None:
        read = self.read(
            **{"from": day(0), "to": day(1), "group_by": "seat,account", "compare": "true"}
        )
        self.assertEqual(
            [
                ("org-a/acct-1", "org-a", 600.0),
                ("org-a/acct-2", "org-a", 300.0),
                (WEEKLY_P, "org-a", 100.0),
                ("org-b/", "org-b", 50.0),
                ("org-c/acct-1", "org-c", 30.0),
                (None, None, 20.0),
            ],
            [
                (row["group"]["seat"]["id"], row["group"]["account"]["id"], row["agent_seconds"])
                for row in read["rows"]
            ],
        )
        # The same session's feed said another seat the day before, and that one held then.
        self.assertEqual(
            [("org-a/acct-2", 200.0)],
            [(group["id"], seconds) for group, seconds in self.seat_rows(read, "comparison")],
        )


class UnplacedTests(UsageStore):
    """What a seat filter leaves out of its accounts' organizations: work on no account."""

    def setUp(self) -> None:
        super().setUp()
        for session, organization in (("s-1", "org-a"), ("s-2", "org-a"), ("s-4", "org-b")):
            # What each session worked for, outside every period read here.
            self.segment(session, -3 * DAY, -3 * DAY, seconds=0.0, organization=organization)
        self.quota_sample(0, SEAT_1, organization="org-a", account="acct-1")
        # The account's own work: a hundred seconds late the day before, six hundred now.
        self.quota_sample(-DAY + 3000, SEAT_1, session="s-1")
        self.quota_sample(10, SEAT_1, session="s-1")
        self.segment("s-1", -DAY + 3060, -DAY + 3160, organization="org-a", model="m-1")
        self.segment("s-1", 60, 660, organization="org-a", model="m-1")
        # Earlier that day, ahead of every sample of its organization, s-2's work is on no
        # account of org-a, and org-b's work is on none of org-b.
        self.segment("s-2", -DAY + 60, -DAY + 1060, organization="org-a", model="m-1")
        self.segment("s-2", -DAY + 2000, -DAY + 2300, organization="org-a", model="m-2")
        self.segment("s-4", -DAY + 60, -DAY + 560, organization="org-b", model="m-1")

    def compared(self, **parameters: str) -> dict:
        return self.read(**{"from": day(0), "to": day(1), "compare": "true", **parameters})

    @staticmethod
    def lines(part: dict, dimension: str) -> list[tuple[str | None, float]]:
        return [(row["group"][dimension]["id"], row["agent_seconds"]) for row in part["rows"]]

    def test_an_accounts_organizations_unplaced_work_stands_beside_its_figures(self) -> None:
        read = self.compared(seat="org-a/acct-1", group_by="model")
        self.assertEqual(600.0, read["total"]["agent_seconds"])
        self.assertEqual(100.0, read["comparison"]["total"]["agent_seconds"])
        self.assertEqual([("m-1", 100.0)], self.lines(read["comparison"], "model"))
        before = read["comparison"]["unplaced"]
        # org-a's work on no account; org-b is no organization of the account.
        self.assertEqual(1300.0, before["total"]["agent_seconds"])
        self.assertEqual([("m-1", 1000.0), ("m-2", 300.0)], self.lines(before, "model"))
        self.assertEqual({"total", "rows"}, set(before))
        self.assertEqual(0.0, read["unplaced"]["total"]["agent_seconds"])
        self.assertEqual([], read["unplaced"]["rows"])
        # Nothing of it is in the figures: the steps add up to the account's own.
        self.assertEqual(600.0, sum(point["agent_seconds"] for point in read["series"]))

    def test_it_is_grouped_as_the_rows_and_held_to_every_other_filter(self) -> None:
        by_seat = self.compared(seat="org-a/acct-1", group_by="seat")
        self.assertEqual(
            [("org-a/", 1300.0)], self.lines(by_seat["comparison"]["unplaced"], "seat")
        )
        self.assertEqual([("org-a/acct-1", 100.0)], self.lines(by_seat["comparison"], "seat"))
        one_model = self.compared(seat="org-a/acct-1", model="m-1")
        self.assertEqual(1000.0, one_model["comparison"]["unplaced"]["total"]["agent_seconds"])

    def test_an_organization_the_filter_admits_itself_is_in_the_figures_instead(self) -> None:
        both = self.compared(seat="org-a/acct-1,org-b/")
        self.assertEqual(600.0, both["comparison"]["total"]["agent_seconds"])
        self.assertEqual(1300.0, both["comparison"]["unplaced"]["total"]["agent_seconds"])
        self.assertIsNone(self.compared(seat="org-a/acct-1,org-a/")["comparison"]["unplaced"])

    def test_none_without_a_filter_that_admits_an_account(self) -> None:
        for filters in ({}, {"seat": "org-a/"}, {"none": "seat"}, {"account": "org-a"}):
            read = self.compared(**filters)
            self.assertIsNone(read["unplaced"], filters)
            self.assertIsNone(read["comparison"]["unplaced"], filters)
        # Without a comparison the period's own stands alone.
        alone = self.read(**{"from": day(-1), "to": day(0), "seat": "org-a/acct-1"})
        self.assertEqual(1300.0, alone["unplaced"]["total"]["agent_seconds"])
        self.assertIsNone(alone["comparison"])


class WindowSpanTests(UsageStore):
    """What used one account's quota window: the read the quota panel asks for each window.

    It names the window's start and the answer's moment as times at the reader's offset, and
    by `seat` the account and its organization's work no sample places (`<organization>/`),
    grouped by the breakdown and the seat. Only the account's own work in the span is
    its rows; the work of another account, of its organization or not, on the same item, the
    part of a stretch before the window and another organization's unplaced work are not in the
    answer at all.
    """

    def setUp(self) -> None:
        super().setUp()
        _, self.task = self.item("Answer a review")
        _, self.other = self.item("Fix the import")
        # Each organization's poll names an account from 80 s on: work that ended before that
        # is on no account anyone knows. The window's organization has two accounts, and each
        # session's own feed puts its work on one of them.
        self.quota_sample(80, SEAT_3, organization="org-w", account="acct-v")
        self.quota_sample(120, SEAT_1, organization="org-w", account="acct-w")
        self.quota_sample(100, SEAT_2, organization="org-x", account="acct-x")
        self.quota_sample(100, SEAT_3, session="s-5")
        self.quota_sample(100, SEAT_1, session="s-1")
        # What that session worked for, outside the window.
        self.segment("s-5", -2 * DAY, -2 * DAY, seconds=0.0, organization="org-w")
        # Half before the window's start, half in it.
        self.segment("s-1", -1800, 1800, item=self.task, cost=1.0, organization="org-w")
        self.segment("s-1", 600, 1200, item=self.other, cost=0.2, organization="org-w")
        # Another account of the same organization, and one of another, on the same item.
        self.segment("s-5", 600, 900, item=self.task, cost=2.0, organization="org-w")
        self.segment("s-2", 600, 1200, item=self.task, cost=5.0, organization="org-x")
        # The window's organization, and another, before any sample placed them.
        self.segment("s-3", 10, 60, cost=0.03, organization="org-w")
        self.segment("s-4", 10, 60, cost=0.07, organization="org-y")
        # After the moment the window is read to.
        self.segment("s-1", 2 * HOUR + 60, 2 * HOUR + 120, item=self.other, organization="org-w")

    def window_read(self, **filters: str) -> dict:
        return self.read(
            **{
                "from": "2030-03-04T03:00:00+03:00",
                "to": "2030-03-04T05:00:00+03:00",
                "utc_offset": "180",
                "group_by": "work_item,seat",
                **filters,
            }
        )

    def lines(self, read: dict) -> list[tuple[str | None, str | None, float, float | None]]:
        return [
            (
                row["group"]["work_item"]["id"],
                row["group"]["seat"]["id"],
                row["agent_seconds"],
                row["estimated_api_cost_usd"],
            )
            for row in read["rows"]
        ]

    def test_a_seat_over_a_window_span_is_that_account_and_its_organizations_unplaced_work(
        self,
    ) -> None:
        read = self.window_read(seat="org-w/acct-w,org-w/")
        self.assertEqual(
            {"from": "2030-03-04T03:00:00+03:00", "to": "2030-03-04T05:00:00+03:00"},
            {name: read["period"][name] for name in ("from", "to")},
        )
        self.assertEqual(
            [
                (self.task, "org-w/acct-w", 1800.0, 0.5),
                (self.other, "org-w/acct-w", 600.0, 0.2),
                (None, "org-w/", 50.0, 0.03),
            ],
            self.lines(read),
        )
        self.assertFalse(read["rows"][2]["group"]["seat"]["unknown"])
        self.assertEqual("org-w", read["rows"][2]["group"]["seat"]["organization"])
        self.assertEqual(2450.0, read["total"]["agent_seconds"])

    def test_the_seat_alone_is_that_accounts_work_and_no_other_accounts(self) -> None:
        own = self.window_read(seat="org-w/acct-w")
        self.assertEqual(
            [(self.task, "org-w/acct-w", 1800.0, 0.5), (self.other, "org-w/acct-w", 600.0, 0.2)],
            self.lines(own),
        )
        self.assertEqual(
            [(self.task, "org-w/acct-v", 300.0, 2.0)],
            self.lines(self.window_read(seat="org-w/acct-v")),
        )
        self.assertEqual(
            [(self.task, "org-x/acct-x", 600.0, 5.0)],
            self.lines(self.window_read(seat="org-x/acct-x")),
        )


class RefusalTests(UsageStore):
    def test_a_bad_parameter_is_refused_as_the_neighbouring_reads_refuse(self) -> None:
        good = {"from": day(0), "to": day(1)}
        for parameters in (
            {"to": day(1)},
            {"from": day(0)},
            {**good, "to": day(0)},
            {**good, "from": "yesterday"},
            {**good, "from": "2030-03-04T00:00:00"},
            {**good, "step": "week"},
            {**good, "utc_offset": "841"},
            {**good, "utc_offset": "3h"},
            {**good, "group_by": "model,effort,account"},
            {**good, "group_by": "model,model"},
            {**good, "group_by": "colour"},
            {**good, "role": "boss"},
            {**good, "group_by": "role,launch_class,model"},
            {**good, "group_by": "model,"},
            {**good, "none": "colour"},
            {**good, "model": "m-1,,m-2"},
            {**good, "model": "x" * 513},
            {**good, "model": ",".join(["m"] * 101)},
            {**good, "compare": "yes"},
            {**good, "sort": "cost"},
            {"from": day(0), "to": day(200), "step": "hour"},
            {"from": day(0), "to": day(2), "step": "minute"},
            # Moments a date cannot be written at, or before anything was stored.
            {"from": "0001-01-01", "to": "0001-01-02", "compare": "true"},
            {"from": "1969-12-31", "to": "1970-01-02"},
            {"from": "1970-01-01", "to": "1970-01-02", "compare": "true"},
            {"from": "9998-12-31", "to": "9999-01-02"},
            {"from": "9999-12-31", "to": "9999-12-31T23:00:00+00:00", "utc_offset": "-840"},
        ):
            with self.subTest(parameters):
                status, body = self.answer(**parameters)
                self.assertEqual(400, status)
                self.assertEqual({"error"}, set(body))
                self.assertEqual("invalid_request", body["error"]["code"])
                self.assertTrue(body["error"]["message"])

    def test_a_refusal_for_a_dimension_names_all_ten(self) -> None:
        _, body = self.answer(**{"from": day(0), "to": day(1), "group_by": "colour"})
        message = body["error"]["message"]
        self.assertEqual(10, len(usage.DIMENSIONS))
        for name in usage.DIMENSIONS:
            self.assertIn(name, message)

    def test_a_repeated_parameter_is_refused(self) -> None:
        from server.analytics import api

        with self.assertRaises(api.AnalyticsHttpError) as raised:
            api.handle_get(self.conn, api.USAGE_PATH, {"from": [day(0), day(1)], "to": [day(2)]})
        self.assertEqual(400, raised.exception.status)

    def test_the_longest_period_a_step_allows_is_answered(self) -> None:
        for step, length in (("hour", HOUR), ("minute", 60)):
            with self.subTest(step):
                read = self.read(
                    **{
                        "from": stamp(0),
                        "to": stamp(usage.MAX_STEPS * length),
                        "step": step,
                        "utc_offset": "0",
                    }
                )
                self.assertEqual(usage.MAX_STEPS, len(read["series"]))


class NothingLeaksTests(UsageStore):
    def test_the_answer_holds_ids_and_labels_but_no_path(self) -> None:
        _, item = self.item("Secret-free title")
        self.session("s-1", self.beta_root / "private" / "checkout")
        self.segment("s-1", 0, 60, organization="org-7f3a", item=item)
        self.segment("s-1", 60, 120, organization="org-7f3a")
        read = self.read(
            **{
                "from": day(0),
                "to": day(1),
                "group_by": "project,account",
                "compare": "true",
            }
        )
        text = json.dumps(read)
        self.assertIn("org-7f3a", text)
        for path in (self.root, self.beta_root, self.root / "transcripts"):
            for spelling in (str(path), json.dumps(str(path))[1:-1], path.as_posix()):
                self.assertNotIn(spelling, text)
        self.assertNotIn("private", text)
        self.assertNotIn(".jsonl", text)
        for name in ("executor", "work_item"):
            self.assertNotIn(
                str(self.root),
                json.dumps(self.read(**{"from": day(0), "to": day(1), "group_by": name})),
            )


class StepTests(unittest.TestCase):
    def test_a_stretch_has_spent_its_share_by_a_moment_rounded_half_up(self) -> None:
        self.assertEqual(
            [0, 0, 2, 5, 7, 10, 10],
            [usage._spent(10, t, 10, 30) for t in (0, 10, 14, 20, 24, 30, 40)],
        )
        # Half way through 9 is 4.5, rounded up.
        self.assertEqual(5, usage._spent(9, 20, 10, 30))
        # A stretch with no length has spent nothing up to its moment and all of it after.
        self.assertEqual([0, 0, 3], [usage._spent(3, t, 10, 10) for t in (5, 10, 11)])

    def test_a_stretch_with_no_length_lies_in_the_interval_holding_its_moment(self) -> None:
        bounds = [0, 10, 20, 30]
        self.assertEqual(range(1, 2), usage._intervals(10, 10, bounds))
        self.assertEqual(range(1), usage._intervals(0, 0, bounds))
        self.assertEqual(range(0), usage._intervals(30, 30, bounds))
        self.assertEqual(range(1, 3), usage._intervals(15, 25, bounds))
        self.assertEqual(range(0), usage._intervals(-5, 0, bounds))

    def test_a_step_starts_at_the_callers_boundary(self) -> None:
        request = usage.query(
            start="2030-03-04T10:30:00+00:00", end="2030-03-05T10:30:00+00:00", utc_offset=330
        )
        bounds, first = usage._bounds(request)
        self.assertEqual(0, first)
        # 05:30 ahead of UTC, the caller's midnight is 18:30 UTC.
        second = 1_000_000
        self.assertEqual(3, len(bounds))
        self.assertEqual(int(18.5 * HOUR) * second, bounds[1] % (DAY * second))
        self.assertEqual(DAY * second, bounds[2] - bounds[0])


if __name__ == "__main__":
    unittest.main()
