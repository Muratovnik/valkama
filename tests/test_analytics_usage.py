"""The Analytics read of usage: what agent work spent in a period, cut by its dimensions."""

from __future__ import annotations

import json
import unittest
from unittest import mock

from server.analytics import usage
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
                {"id": item, "unknown": False, "reference": reference, "title": "Build the read"},
                {"id": None, "unknown": False, "reference": None, "title": None},
            ],
            [row["group"]["work_item"] for row in read["rows"]],
        )

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
        # What it was opened as and where, and nothing that changes while it runs.
        self.assertEqual(
            {"id": "s-1", "unknown": False, "family": "claude", "opened_in": "", "opened_host": ""},
            executors[0],
        )
        self.assertEqual(
            {
                "id": "s-unrecorded",
                "unknown": False,
                "family": "",
                "opened_in": "",
                "opened_host": "",
            },
            executors[1],
        )

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

    def test_the_series_is_broken_down_by_the_first_grouping(self) -> None:
        self.session("s-1")
        self.segment("s-1", 0, 60, model="m-1", effort="high")
        self.segment("s-1", DAY, DAY + 30, model="m-2")
        read = self.read(**{"from": day(0), "to": day(2), "group_by": "model,effort"})
        self.assertEqual(
            [["m-1"], ["m-2"]],
            [[g["group"]["model"]["id"] for g in point["groups"]] for point in read["series"]],
        )
        self.assertEqual({"model"}, set(read["series"][0]["groups"][0]["group"]))
        self.assertEqual({"model", "effort"}, set(read["rows"][0]["group"]))


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
            {**good, "group_by": "model,"},
            {**good, "none": "colour"},
            {**good, "model": "m-1,,m-2"},
            {**good, "model": "x" * 513},
            {**good, "model": ",".join(["m"] * 101)},
            {**good, "compare": "yes"},
            {**good, "sort": "cost"},
            {"from": day(0), "to": day(200), "step": "hour"},
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

    def test_a_repeated_parameter_is_refused(self) -> None:
        from server.analytics import api

        with self.assertRaises(api.AnalyticsHttpError) as raised:
            api.handle_get(self.conn, api.USAGE_PATH, {"from": [day(0), day(1)], "to": [day(2)]})
        self.assertEqual(400, raised.exception.status)

    def test_the_longest_period_a_step_allows_is_answered(self) -> None:
        hours = usage.MAX_STEPS * HOUR
        read = self.read(
            **{"from": stamp(0), "to": stamp(hours), "step": "hour", "utc_offset": "0"}
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
