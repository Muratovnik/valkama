"""An item's usage read and the analytics read say the same thing about the same rows.

The card's Agents tab reads the item's usage and links to the Analytics page filtered to
the items its figures cover; the page reads the analytics read. Both are read here over
one fixture of made-up rows, and compared figure by figure: who spent the work, with the
class its run was launched with and the effort it ran at, and the whole an epic's tab
shows against the page filtered to the epic and its children. Every time is a whole
thousandth of a second and every cost a whole millionth of a dollar, so a figure the two
reads round differently is a difference and not noise.

On fractional figures the two round differently: the item read adds a line's segments and
then rounds, the analytics read rounds each segment and then adds. The last two cases read
such figures and hold the difference to the bound the connection contract states.
"""

from __future__ import annotations

import random
from collections import Counter
from collections.abc import Iterable, Mapping

from server.planning import api, service
from tests.analytics_fixtures import UsageStore, day

ITEM = "/api/planning/work-item/usage"
PERIOD = {"from": day(0), "to": day(1)}


def figures(line: Mapping) -> tuple:
    """A line's figures in whole units: milliseconds, millionths of a dollar, tokens."""

    seconds = line["agent_seconds"] if "agent_seconds" in line else line["seconds"]
    cost = line["estimated_api_cost_usd"]
    return (
        round(seconds * 1000),
        None if cost is None else round(cost * 1_000_000),
        tuple(sorted(line["tokens"].items())),
        line["unpriced_tokens"],
    )


def added(lines: Iterable[tuple[tuple, tuple]]) -> dict[tuple, tuple]:
    """Lines under one key added up, a kind or a cost nobody reported staying `None`."""

    def plus(one: int | None, other: int | None) -> int | None:
        return other if one is None else one if other is None else one + other

    found: dict[tuple, tuple] = {}
    for key, (milliseconds, micro_usd, tokens, unpriced) in lines:
        if key not in found:
            found[key] = (milliseconds, micro_usd, tokens, unpriced)
            continue
        was = found[key]
        found[key] = (
            was[0] + milliseconds,
            plus(was[1], micro_usd),
            tuple(
                (kind, plus(count, other))
                for (kind, count), (_, other) in zip(was[2], tokens, strict=True)
            ),
            was[3] + unpriced,
        )
    return found


def held(value: Mapping) -> tuple:
    return value["id"], value["unknown"]


class ItemAndAnalyticsTests(UsageStore):
    def item_usage(self, reference: str, scope: str = "item") -> dict:
        status, body = api.handle_get(self.conn, ITEM, {"id": [reference], "scope": [scope]})
        self.assertEqual(200, status, body)
        return body["usage"]

    def test_who_spent_it_is_one_rule_in_both_reads(self) -> None:
        reference, item = self.item()
        self.session("s1")
        # The session's own agent and its adviser; a subagent of a class and its adviser,
        # which keeps that class; a subagent whose class nobody recorded, at an effort
        # nobody recorded; a third at another class. Work on another item stays out.
        self.segment("s1", 0, 100, item=item, effort="high", cost=0.012345)
        self.segment("s1", 100, 100, item=item, effort="high", cost=0.02, advisor=True)
        self.segment(
            "s1", 0, 200, agent="w1", launch_class="bero", item=item, effort="medium", cost=0.03
        )
        self.segment(
            "s1",
            200,
            230,
            agent="w1",
            launch_class="bero",
            item=item,
            effort="medium",
            cost=0.004,
            advisor=True,
        )
        self.segment("s1", 300, 350, agent="w2", item=item, cost=None, model="claude-new-9")
        self.segment("s1", 400, 500, agent="w3", launch_class="rev", item=item, effort="low")
        _, other = self.item("Other work")
        self.segment("s1", 600, 700, item=other, effort="high")
        roles = self.item_usage(reference)["roles"]
        # The rule itself, so a read that agrees with the other on a wrong rule still fails.
        self.assertEqual(
            {
                ("main", (None, False), ("high", False)),
                ("advisor", (None, False), ("high", False)),
                ("subagent", ("bero", False), ("medium", False)),
                ("advisor", ("bero", False), ("medium", False)),
                ("subagent", (None, True), (None, True)),
                ("subagent", ("rev", False), ("low", False)),
            },
            {(r["role"], held(r["launch_class"]), held(r["effort"])) for r in roles},
        )
        for second in ("launch_class", "effort"):
            with self.subTest(second):
                analytics = self.read(**PERIOD, group_by=f"role,{second}", work_item=item)
                self.assertEqual(
                    added(((r["role"], held(r[second])), figures(r)) for r in roles),
                    {
                        (row["group"]["role"]["id"], held(row["group"][second])): figures(row)
                        for row in analytics["rows"]
                    },
                )

    def test_an_epics_tab_is_the_page_filtered_to_the_items_it_covers(self) -> None:
        epic_reference, epic = self.item("Epic")
        self.conn.execute("UPDATE work_items SET kind = 'epic' WHERE work_item_id = ?", (epic,))
        self.conn.commit()
        children = [
            str(
                service.create_work_item(self.conn, space="MAIN", title=title, parent=epic)[
                    "work_item_id"
                ]
            )
            for title in ("First", "Second", "Third")
        ]
        self.conn.commit()
        _, outside = self.item("Outside")
        self.session("s1")
        self.segment("s1", 0, 60, item=epic, cost=0.001)
        self.segment("s1", 60, 180, item=children[0], cost=0.002)
        self.segment("s1", 100, 400, agent="w1", launch_class="bero", item=children[1])
        self.segment("s1", 400, 450, item=children[1], cost=None, model="claude-new-9")
        self.segment("s1", 500, 900, item=outside, cost=0.5)
        tab = self.item_usage(epic_reference, "epic")
        covered = [line["work_item_id"] for line in tab["by_item"]]
        self.assertEqual({epic, *children}, set(covered))
        page = self.read(**PERIOD, work_item=",".join(covered))["total"]
        # The epic's own work and its children's, and not the work outside it.
        self.assertEqual((530_000, 13_000), figures(tab)[:2])
        self.assertEqual(figures(tab), figures(page))

    def test_the_item_read_rounds_a_sum_and_the_analytics_read_each_segment(self) -> None:
        reference, item = self.item()
        self.session("s1")
        for start in (0, 20, 40):
            self.segment(
                "s1", start, start + 10, seconds=10.0004, item=item, effort="high", cost=0.0000304
            )
        roles = self.item_usage(reference)["roles"]
        # 30.0012 s and $0.0000912, rounded once.
        self.assertEqual(
            [(30.001, 0.000091)], [(r["seconds"], r["estimated_api_cost_usd"]) for r in roles]
        )
        rows = self.read(**PERIOD, group_by="role,effort", work_item=item)["rows"]
        # 10.000 s and $0.000030 three times.
        self.assertEqual(
            [(30.0, 0.00009)], [(r["agent_seconds"], r["estimated_api_cost_usd"]) for r in rows]
        )

    def test_on_fractional_figures_the_reads_differ_within_the_stated_bound(self) -> None:
        """A group of the analytics read made of `m` lines of `roles` over `n` segments differs
        from those lines added up by no more than `m + n / 2` units, a thousandth of a second
        and a millionth of a dollar; the tokens are equal."""

        self.session("s1")
        # Each kind of segment with the group it falls in by role and launch class, and by role
        # and effort.
        kinds = [
            ("", None, False, "high", ("main", (None, False)), ("main", ("high", False))),
            ("", None, False, "low", ("main", (None, False)), ("main", ("low", False))),
            ("", None, True, "high", ("advisor", (None, False)), ("advisor", ("high", False))),
            (
                "w1",
                "bero",
                False,
                "high",
                ("subagent", ("bero", False)),
                ("subagent", ("high", False)),
            ),
            (
                "w1",
                "bero",
                False,
                "low",
                ("subagent", ("bero", False)),
                ("subagent", ("low", False)),
            ),
            ("w1", "bero", True, "low", ("advisor", ("bero", False)), ("advisor", ("low", False))),
            ("w2", None, False, None, ("subagent", (None, True)), ("subagent", (None, True))),
        ]
        differed = 0
        for seed in range(6):
            reference, item = self.item(f"Work {seed}")
            draw = random.Random(seed)  # noqa: S311 - made-up rows, not a secret
            segments: dict[str, Counter] = {"launch_class": Counter(), "effort": Counter()}
            for index in range(30):
                agent, launched, advisor, effort, by_class, by_effort = draw.choice(kinds)
                self.segment(
                    "s1",
                    index * 60,
                    index * 60 + 30,
                    agent=agent,
                    launch_class=launched,
                    advisor=advisor,
                    effort=effort,
                    seconds=draw.uniform(0, 30),
                    cost=draw.uniform(0, 0.001),
                    item=item,
                )
                segments["launch_class"][by_class] += 1
                segments["effort"][by_effort] += 1
            roles = self.item_usage(reference)["roles"]
            for second, counted in segments.items():
                with self.subTest(seed=seed, second=second):
                    lines = Counter((r["role"], held(r[second])) for r in roles)
                    tab = added(((r["role"], held(r[second])), figures(r)) for r in roles)
                    rows = self.read(**PERIOD, group_by=f"role,{second}", work_item=item)["rows"]
                    page = {
                        (row["group"]["role"]["id"], held(row["group"][second])): figures(row)
                        for row in rows
                    }
                    self.assertEqual(set(counted), set(page))
                    self.assertEqual(set(counted), set(tab))
                    for group, (milliseconds, micro_usd, tokens, unpriced) in page.items():
                        bound = lines[group] + counted[group] / 2
                        self.assertLessEqual(abs(tab[group][0] - milliseconds), bound, group)
                        self.assertLessEqual(abs(tab[group][1] - micro_usd), bound, group)
                        self.assertEqual((tokens, unpriced), tab[group][2:], group)
                        differed += tab[group][:2] != (milliseconds, micro_usd)
        # The figures do differ, so it is the bound that holds them and not equality.
        self.assertGreater(differed, 0)
