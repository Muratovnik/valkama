"""Who spent an item's work and under which account, in the item's own usage read.

The rows are written straight into the store (`analytics_fixtures`), so every figure below
is worked out by hand from them: the item's totals as the read gave them before it said
who spent them, and each part of the new breakdowns adding up to those totals in whole
thousandths of a second and millionths of a dollar. Every id and count is made up.
"""

from __future__ import annotations

import unittest
from collections.abc import Mapping, Sequence

from server.planning import api
from tests.analytics_fixtures import UsageStore, stamp, tokens_sum

ITEM = "/api/planning/work-item/usage"
# A thousandth of a second over, four times out of five: each part rounded alone loses one.
TICK = 0.0004


def milliseconds(seconds: float) -> int:
    return round(seconds * 1000)


def micro_usd(cost: float | None) -> int:
    return 0 if cost is None else round(cost * 1_000_000)


class ItemPartsTests(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        self.reference, item = self.item()
        self.session("s1")
        # The session's own agent under one account, a subagent beside it, then a change of
        # account with an adviser's call and a subagent of a second class, then a subagent
        # whose class and account nobody recorded, then the first account again.
        self.segment(
            "s1",
            0,
            100,
            seconds=100 + TICK,
            item=item,
            cost=0.0123456789,
            organization="org-a",
            effort="high",
        )
        self.segment(
            "s1",
            50,
            250,
            agent="w1",
            launch_class="bero",
            seconds=200 + TICK,
            item=item,
            cost=0.0234567891,
            organization="org-a",
            effort="medium",
        )
        self.segment(
            "s1",
            300,
            400,
            seconds=100 + TICK,
            item=item,
            cost=0.0111111111,
            organization="org-b",
            effort="high",
        )
        self.segment(
            "s1",
            320,
            320,
            item=item,
            tokens=(1, 2, 3, None, 4, None),
            cost=0.02,
            organization="org-b",
            effort="high",
            advisor=True,
        )
        self.segment(
            "s1",
            350,
            550,
            agent="w2",
            launch_class="rev",
            seconds=200 + TICK,
            item=item,
            cost=0.0222222222,
            organization="org-b",
        )
        self.segment(
            "s1",
            600,
            700,
            agent="w3",
            seconds=100 + TICK,
            item=item,
            model="claude-new-9",
            tokens=(7, None, None, None, 3, None),
            cost=None,
            effort="low",
        )
        self.segment(
            "s1",
            800,
            850,
            seconds=50 + TICK,
            item=item,
            cost=0.005,
            organization="org-a",
            effort="high",
        )
        status, body = api.handle_get(self.conn, ITEM, {"id": [self.reference]})
        self.assertEqual(200, status)
        self.usage = body["usage"]

    def assert_adds_up(self, parts: Sequence[Mapping]) -> None:
        """A breakdown is the item's whole: time, cost, every kind of token, what is unpriced."""

        whole = self.usage
        self.assertEqual(
            milliseconds(whole["agent_seconds"]), sum(milliseconds(p["seconds"]) for p in parts)
        )
        self.assertEqual(
            micro_usd(whole["estimated_api_cost_usd"]),
            sum(micro_usd(p["estimated_api_cost_usd"]) for p in parts),
        )
        self.assertEqual(whole["tokens"], tokens_sum(parts))
        self.assertEqual(whole["unpriced_tokens"], sum(p["unpriced_tokens"] for p in parts))

    def test_the_totals_are_the_former_reads_to_the_unit(self) -> None:
        usage = self.usage
        # The union of 0-250, 300-550, 600-700 and 800-850; the sum of the seven rows.
        self.assertEqual(650.0, usage["elapsed_seconds"])
        self.assertEqual(750.002, usage["agent_seconds"])
        self.assertEqual(
            {
                "input": 58,
                "cached_read": 502,
                "cache_write_5m": 103,
                "cache_write_1h": None,
                "output": 32,
                "reasoning": None,
            },
            usage["tokens"],
        )
        self.assertEqual(0.094136, usage["estimated_api_cost_usd"])
        self.assertEqual(10, usage["unpriced_tokens"])
        self.assertEqual(["claude-new-9"], usage["unpriced_models"])
        self.assertEqual(
            [("s1", None), ("s1", "w1"), ("s1", "w2"), ("s1", "w3")],
            [(line["session_id"], line["agent_id"]) for line in usage["agents"]],
        )
        self.assertEqual(
            [250.001, 200.0, 200.0, 100.0], [line["seconds"] for line in usage["agents"]]
        )

    def test_each_breakdown_adds_up_to_the_totals(self) -> None:
        for name in ("account_stretches", "accounts", "roles"):
            with self.subTest(name):
                self.assert_adds_up(self.usage[name])

    def test_the_stretches_stand_in_time_order_and_show_each_change_of_account(self) -> None:
        stretches = self.usage["account_stretches"]
        self.assertEqual(
            [("org-a", False), ("org-b", False), (None, True), ("org-a", False)],
            [(s["account"]["id"], s["account"]["unknown"]) for s in stretches],
        )
        self.assertEqual(
            [(stamp(0), stamp(250)), (stamp(300), stamp(550)), (stamp(600), stamp(700))],
            [(s["started_at"], s["ended_at"]) for s in stretches[:3]],
        )
        self.assertEqual([300.001, 300.001, 100.0, 50.0], [s["seconds"] for s in stretches])

    def test_the_accounts_are_ranked_with_their_share_and_the_unknown_apart(self) -> None:
        accounts = self.usage["accounts"]
        self.assertEqual(
            [("org-a", False, 0.4667), ("org-b", False, 0.4), (None, True, 0.1333)],
            [(a["account"]["id"], a["account"]["unknown"], a["share"]) for a in accounts],
        )

    def test_roles_tell_none_from_unknown_and_keep_the_adviser_apart(self) -> None:
        roles = self.usage["roles"]
        self.assertEqual(
            [
                ("main", (None, False), ("high", False)),
                ("subagent", ("bero", False), ("medium", False)),
                ("subagent", ("rev", False), (None, True)),
                ("subagent", (None, True), ("low", False)),
                ("advisor", (None, False), (None, False)),
            ],
            [
                (
                    r["role"],
                    (r["launch_class"]["id"], r["launch_class"]["unknown"]),
                    (r["effort"]["id"], r["effort"]["unknown"]),
                )
                for r in roles
            ],
        )
        self.assertEqual([250.001, 200.001, 200.0, 100.0, 0.0], [r["seconds"] for r in roles])
        # The adviser's own call took no time and cost what it cost.
        self.assertEqual(0.02, roles[-1]["estimated_api_cost_usd"])
        self.assertIsNone(roles[3]["estimated_api_cost_usd"])


if __name__ == "__main__":
    unittest.main()
