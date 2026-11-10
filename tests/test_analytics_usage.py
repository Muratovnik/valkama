"""The Analytics read of usage: what agent work spent in a period, cut by its dimensions."""

from __future__ import annotations

import itertools
import json
import math
import unittest

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from server.analytics import usage
from server.planning import usage as item_usage
from tests.analytics_fixtures import DAY, HOUR, UsageStore, day, stamp, tokens_sum
from tests.property_settings import use_gate_profile

use_gate_profile()

_GROUPINGS = [
    ",".join(names)
    for size in (0, 1, 2)
    for names in itertools.permutations(usage.DIMENSIONS, size)
    if size < 2 or names[0] < names[1]
]


class _Sums:
    """What every cut of one answer must add up to."""

    def __init__(self, case: unittest.TestCase) -> None:
        self.case = case

    def agree(self, whole: dict, parts: list[dict], where: str) -> None:
        case = self.case
        # Each figure is published rounded, seconds to the millisecond and cost to a
        # millionth of a dollar, so a sum of n of them may miss by n half-units.
        seconds, dollars = 0.0005 * (len(parts) + 1), 5e-7 * (len(parts) + 1)
        for name in ("agent_seconds", "estimated_seconds"):
            case.assertAlmostEqual(
                whole[name], sum(p[name] for p in parts), delta=seconds, msg=f"{where}: {name}"
            )
        added = tokens_sum(parts) if parts else dict.fromkeys(whole["tokens"])
        case.assertEqual(whole["tokens"], added, where)
        case.assertEqual(whole["unpriced_tokens"], sum(p["unpriced_tokens"] for p in parts), where)
        costs = [
            p["estimated_api_cost_usd"] for p in parts if p["estimated_api_cost_usd"] is not None
        ]
        if whole["estimated_api_cost_usd"] is None:
            case.assertEqual([], costs, where)
        else:
            case.assertAlmostEqual(
                whole["estimated_api_cost_usd"], sum(costs), delta=dollars, msg=where
            )

    def answer(self, read: dict, where: str) -> None:
        self.agree(read["total"], read["rows"], f"{where}: rows")
        self.agree(read["total"], read["series"], f"{where}: series")
        if read["group_by"]:
            for point in read["series"]:
                self.agree(point, point["groups"], f"{where}: groups of {point['start']}")


# One stretch of work: when it starts and how long, in seconds after the store's start, and
# what it holds. Small sets of values, so groups repeat and NULLs are common.
_STRETCHES = st.lists(
    st.fixed_dictionaries(
        {
            "session": st.sampled_from(["s-1", "s-2", "s-3"]),
            "agent": st.sampled_from(["", "", "worker"]),
            "start": st.integers(min_value=-DAY, max_value=4 * DAY).map(lambda s: s + 0.25),
            "length": st.sampled_from([0, 1.5, 59, 3600, 5400, 30 * HOUR]),
            "on_item": st.booleans(),
            "model": st.sampled_from([None, "claude-opus-5-5", "claude-unknown-9"]),
            "tokens": st.tuples(
                *(st.one_of(st.none(), st.integers(min_value=0, max_value=1000)) for _ in range(6))
            ),
            "cost": st.one_of(st.none(), st.floats(min_value=0, max_value=3, allow_nan=False)),
            "quality": st.sampled_from(["observed", "estimated"]),
            "organization": st.sampled_from([None, "org-a", "org-b"]),
            "effort": st.sampled_from([None, "high"]),
            "environment": st.sampled_from([None, "local", "cloud"]),
            "launch_class": st.sampled_from([None, "interactive"]),
        }
    ),
    max_size=12,
)


class AddingUpTests(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        _, self.item_id = self.item()
        for session, folder in (("s-1", self.beta_root / "src"), ("s-2", self.root / "elsewhere")):
            self.session(session, folder)

    @settings(max_examples=40, suppress_health_check=[HealthCheck.too_slow])
    @given(stretches=_STRETCHES, offset=st.sampled_from([0, 180, -330, 840]))
    def test_every_cut_adds_up_to_the_total(self, stretches: list[dict], offset: int) -> None:
        self.conn.execute("DELETE FROM usage_segments")
        self.conn.execute("DELETE FROM usage_runs")
        self.runs.clear()
        for stretch in stretches:
            self.segment(
                stretch["session"],
                stretch["start"],
                stretch["start"] + stretch["length"],
                agent=stretch["agent"],
                item=self.item_id if stretch["on_item"] else None,
                model=stretch["model"],
                tokens=stretch["tokens"],
                cost=stretch["cost"],
                quality=stretch["quality"],
                organization=stretch["organization"],
                effort=stretch["effort"],
                environment=stretch["environment"],
                launch_class=stretch["launch_class"],
            )
        sums = _Sums(self)
        for step, grouping in itertools.product(("hour", "day"), _GROUPINGS):
            parameters = {"from": day(0), "to": day(3), "step": step, "utc_offset": str(offset)}
            if grouping:
                parameters["group_by"] = grouping
            sums.answer(self.read(**parameters), f"{step} by {grouping or 'nothing'}")


class TotalsTests(UsageStore):
    def test_the_whole_store_is_what_the_per_session_reads_add_up_to(self) -> None:
        reference, item = self.item()
        self.session("s-1")
        self.segment("s-1", 0, HOUR, item=item, tokens=(1, 2, 3, 4, 5, 6), cost=0.5)
        # Two agents side by side: their time is spent twice.
        self.segment("s-1", 600, 1800, agent="worker", item=item, quality="estimated")
        self.segment("s-1", 2 * HOUR, 3 * HOUR, model="claude-unknown-9", cost=None)
        self.segment("s-2", DAY - 60, DAY + 60, tokens=(7, None, None, None, 9, None))
        self.segment("s-2", 2 * DAY, 2 * DAY, seconds=0, model="claude-side-1", cost=0.002)
        read = self.read(**{"from": day(-1), "to": day(5), "step": "hour", "group_by": "model"})
        sessions = [item_usage.for_session(self.conn, name) for name in ("s-1", "s-2")]
        total = read["total"]
        self.assertAlmostEqual(sum(s["agent_seconds"] for s in sessions), total["agent_seconds"])
        self.assertEqual(HOUR + 1200 + HOUR + 120, total["agent_seconds"])
        self.assertAlmostEqual(
            sum(s["estimated_seconds"] for s in sessions), total["estimated_seconds"]
        )
        self.assertEqual(tokens_sum(sessions), total["tokens"])
        self.assertAlmostEqual(
            sum(s["estimated_api_cost_usd"] for s in sessions), total["estimated_api_cost_usd"]
        )
        self.assertEqual(sum(s["unpriced_tokens"] for s in sessions), total["unpriced_tokens"])
        self.assertEqual(["claude-unknown-9"], total["unpriced_models"])
        self.assertEqual("mixed", total["quality"])
        self.assertEqual(item_usage.COST_BASIS, read["cost_basis"])
        self.assertEqual(stamp(2 * DAY), read["last_event_at"])
        self.assertNotIn("elapsed_seconds", total)
        _Sums(self).answer(read, "the whole store")
        self.assertIsNotNone(reference)

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
        self.assertAlmostEqual(0.5, read["total"]["estimated_api_cost_usd"])
        self.assertIn(read["total"]["tokens"]["input"], (4, 5))
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
        read = self.read(**{"from": day(0), "to": day(1), "group_by": "executor,launch_class"})
        executors = [row["group"]["executor"] for row in read["rows"]]
        self.assertEqual(["s-1", "s-unrecorded"], [e["id"] for e in executors])
        self.assertEqual(180.0, read["rows"][0]["agent_seconds"])
        # Ended, and its transcript is not on the disk: the card would say the same.
        self.assertEqual(
            {
                "id": "s-1",
                "unknown": False,
                "family": "claude",
                "opened_in": "",
                "opened_host": "",
                "state": "gone",
            },
            executors[0],
        )
        self.assertEqual("none", executors[1]["state"])
        self.assertEqual({"id": None, "unknown": True}, read["rows"][0]["group"]["launch_class"])

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
    def test_a_stretch_is_shared_by_the_time_it_spends_in_each_interval(self) -> None:
        bounds = [0.0, 10.0, 20.0, 30.0]
        self.assertEqual([(0, 0.5), (1, 0.5)], usage._shares(5.0, 15.0, bounds))
        self.assertEqual([(1, 1.0)], usage._shares(12.0, 12.0, bounds))
        self.assertEqual([], usage._shares(30.0, 30.0, bounds))
        self.assertEqual([(2, 0.25)], usage._shares(25.0, 45.0, bounds))
        self.assertEqual([], usage._shares(-5.0, 0.0, bounds))

    def test_whole_counts_add_up_to_what_lies_inside(self) -> None:
        self.assertEqual([33, 67], usage._apportion(100, [1 / 3, 2 / 3]))
        self.assertEqual([1, 1, 1], usage._apportion(3, [1 / 3, 1 / 3, 1 / 3]))
        parts = usage._apportion(7, [0.25, 0.25])
        self.assertTrue(3 <= sum(parts) <= 4)
        for total in range(50):
            self.assertEqual(total, sum(usage._apportion(total, [0.1, 0.2, 0.3, 0.4])))

    def test_a_step_starts_at_the_callers_boundary(self) -> None:
        request = usage.query(
            start="2030-03-04T10:30:00+00:00", end="2030-03-05T10:30:00+00:00", utc_offset=330
        )
        bounds, first = usage._bounds(request)
        self.assertEqual(0, first)
        # 05:30 ahead of UTC, the caller's midnight is 18:30 UTC.
        self.assertEqual(3, len(bounds))
        self.assertEqual(18.5 * HOUR, bounds[1] % DAY)
        self.assertTrue(math.isclose(bounds[2] - bounds[0], DAY))


if __name__ == "__main__":
    unittest.main()
