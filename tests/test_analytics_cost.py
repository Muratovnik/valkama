"""The Analytics read stays quick on a store the size months of daily work leave.

Ninety days of 25,000 stretches of work: two hundred sessions with their subagents, three
hundred items, four models. The budget is set from a measurement on the machine this was
written on, with a margin of more than three times, so it fails on a read that went from
one pass to a query per row, not on a slow afternoon.
"""

from __future__ import annotations

import random
import time

from tests.analytics_fixtures import DAY, UsageStore, day, stamp

STRETCHES = 25_000
DAYS = 90
#: Seconds. Measured at the day step at 0.23 s by project and model and 0.48 s by item
#: and executor, the slowest of five reads each, and at 0.68 s and 1.17 s under coverage,
#: which is how the gate runs the suite: more than three times the slower of those.
BUDGET = 4.0
#: The period's stretches, the folders of the sessions on no item, one read of labels
#: per labelled dimension and the freshness: the same however many stretches there are.
MAX_STATEMENTS = 6


class CostCase(UsageStore):
    def build(self) -> None:
        chance = random.Random(15)  # noqa: S311 - made-up rows, not a secret
        items = [self.item(f"Work {number}")[1] for number in range(300)]
        sessions = [f"s-{number}" for number in range(200)]
        for number, session in enumerate(sessions):
            root = (self.alpha_root, self.beta_root, self.root / "elsewhere")[number % 3]
            self.session(session, root / "src")
            for agent in ("", "worker", "reviewer"):
                self.add_run(session, agent, chance.choice([None, "interactive", "headless"]))
        rows = []
        for _ in range(STRETCHES):
            session = chance.choice(sessions)
            start = chance.uniform(0, DAYS * DAY)
            length = chance.choice([0.0, chance.uniform(1, 1200)])
            cost = None if chance.random() < 0.1 else chance.uniform(0, 0.5)
            agent = chance.choice(["", "worker", "reviewer"])
            rows.append(
                (
                    self.runs[session, agent],
                    session,
                    agent,
                    chance.choice(["claude-opus-5-5", "claude-sonnet-5-5", "gpt-6", None]),
                    stamp(start),
                    stamp(start + length),
                    length,
                    chance.choice([None, *items]),
                    chance.randint(0, 5000),
                    chance.randint(0, 90000),
                    chance.randint(0, 2000),
                    None,
                    chance.randint(0, 3000),
                    None,
                    cost,
                    None if cost is None else "2030-01-01",
                    chance.choice(["observed", "observed", "estimated"]),
                    chance.choice([None, "org-a", "org-b"]),
                )
            )
        self.conn.executemany(
            "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at,"
            " ended_at, seconds, work_item_id, input_tokens, cached_read_tokens,"
            " cache_write_5m_tokens, cache_write_1h_tokens, output_tokens, reasoning_tokens,"
            " estimated_api_cost_usd, price_book, quality, organization)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()

    @staticmethod
    def period(grouping: str) -> dict[str, str]:
        found = {"from": day(0), "to": day(DAYS), "step": "day", "utc_offset": "180"}
        if grouping:
            found["group_by"] = grouping
        return found


class CostTests(CostCase):
    def test_ninety_days_of_25000_stretches_by_two_dimensions_read_within_budget(self) -> None:
        self.build()
        statements: list[str] = []
        self.conn.set_trace_callback(statements.append)
        self.addCleanup(self.conn.set_trace_callback, None)
        for grouping in ("project,model", "work_item,executor"):
            with self.subTest(grouping):
                statements.clear()
                began = time.perf_counter()
                read = self.read(**self.period(grouping))
                spent = time.perf_counter() - began
                self.assertLess(spent, BUDGET, f"{grouping} took {spent:.3f} s")
                self.assertEqual(DAYS, len(read["series"]))
                self.assertGreater(len(read["rows"]), 3)
                # SQLite answers a lookup by key in microseconds, so a query per row would
                # still fit the budget: the count of statements is what shows one pass.
                self.assertLessEqual(len(statements), MAX_STATEMENTS, statements[:12])
