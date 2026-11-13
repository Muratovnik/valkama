"""The Analytics read stays quick on a store the size months of daily work leave.

Ninety days of 25,000 stretches of work: two hundred sessions with their subagents, three
hundred items, four models. The budget is set from a measurement on the machine this was
written on, with a margin of more than three times, so it fails on a read that went from
one pass to a query per row, not on a slow afternoon. A machine busy with other work can still
stretch one read past it, so the budget holds the quickest of a few reads: a read that is slow
by design is slow every time.
"""

from __future__ import annotations

import math
import random
import time

from tests.analytics_fixtures import DAY, HOUR, UsageStore, day, stamp

STRETCHES = 25_000
DAYS = 90
#: Seconds. Measured at the day step at 0.23 s by project and model and 0.48 s by item
#: and executor, the slowest of five reads each, and at 0.68 s and 1.17 s under coverage,
#: which is how the gate runs the suite: more than three times the slower of those.
BUDGET = 4.0
#: Reads of each grouping at most: the first one under the budget ends the measurement.
READS = 3
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
                spent: list[float] = []
                while len(spent) < READS and (not spent or min(spent) >= BUDGET):
                    statements.clear()
                    began = time.perf_counter()
                    read = self.read(**self.period(grouping))
                    spent.append(time.perf_counter() - began)
                took = ", ".join(f"{one:.3f}" for one in spent)
                self.assertLess(min(spent), BUDGET, f"{grouping} took {took} s")
                self.assertEqual(DAYS, len(read["series"]))
                self.assertGreater(len(read["rows"]), 3)
                # SQLite answers a lookup by key in microseconds, so a query per row would
                # still fit the budget: the count of statements is what shows one pass.
                self.assertLessEqual(len(statements), MAX_STATEMENTS, statements[:12])


#: A year of samples under as many stretches as the ninety days above, on three accounts
#: of one organization: what seats add is a year of samples to read once. Measured by seat
#: at 0.57 to 0.87 s, and at 1.7 to 2.3 s under coverage, the slowest the same store by
#: account takes being 0.28 s and 1.26 s; the budget is the one above. At four times the
#: stretches, the read takes 2.8 to 3.2 s by seat and 1.3 to 1.8 s by account, and under
#: coverage 4.7 to 6.3 s and 3.1 to 3.9 s: the stretches alone fill the budget there.
YEAR = 365
YEAR_STRETCHES = 25_000
ACCOUNTS = ("acct-1", "acct-2", "acct-3")
#: The stretches and the freshness, and the seats' two reads: the samples, each with the
#: organization its session worked for then, and the accounts their seats name.
MAX_SEAT_STATEMENTS = 4


class SeatCostCase(UsageStore):
    def build(self) -> None:
        """Two hundred sessions, each on one of three accounts, whose weeks reset at their own
        hours; the organization's poll names each account's seat hourly, and each session
        says its seat a hundred times. A tenth of the work names no organization."""

        chance = random.Random(16)  # noqa: S311 - made-up rows, not a secret
        sessions = [f"s-{number}" for number in range(200)]
        for session in sessions:
            self.session(session, self.alpha_root / "src")
            self.add_run(session)

        def seat(account: int, at: float) -> tuple[str, str]:
            """The seat and the reset of an account's week holding at `at`."""

            first = 4 * DAY + 9 * HOUR + account * 7 * HOUR
            reset = first + 7 * DAY * max(0, math.ceil((at - first) / (7 * DAY)))
            moment = stamp(reset)
            return f"week:{moment[:16]}Z", moment

        samples = []
        for hour in range(YEAR * 24):
            for account, uuid in enumerate(ACCOUNTS):
                key, reset = seat(account, hour * HOUR)
                samples.append((stamp(hour * HOUR), "poll", "org-a", None, uuid, key, reset))
        for number, session in enumerate(sessions):
            for _ in range(100):
                at = chance.uniform(0, YEAR * DAY)
                key, reset = seat(number % 3, at)
                samples.append((stamp(at), "mod", None, session, None, key, reset))
        samples.sort()
        self.conn.executemany(
            "INSERT INTO quota_samples(at, source, organization, session_id, account_uuid, seat,"
            " kind, percent, resets_at) VALUES (?, ?, ?, ?, ?, ?, 'week', 40, ?)",
            samples,
        )
        rows = []
        for _ in range(YEAR_STRETCHES):
            session = chance.choice(sessions)
            start = chance.uniform(0, YEAR * DAY)
            length = chance.choice([0.0, chance.uniform(1, 1200)])
            rows.append(
                (
                    self.runs[session, ""],
                    session,
                    stamp(start),
                    stamp(start + length),
                    length,
                    chance.randint(0, 5000),
                    None if chance.random() < 0.1 else "org-a",
                )
            )
        self.conn.executemany(
            "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at,"
            " ended_at, seconds, input_tokens, estimated_api_cost_usd, price_book, quality,"
            " organization) VALUES (?, ?, '', 'claude-opus-5-5', ?, ?, ?, ?, 0.01,"
            " '2030-01-01', 'observed', ?)",
            rows,
        )
        self.conn.commit()


class SeatCostTests(SeatCostCase):
    def test_a_year_of_samples_under_25000_stretches_by_seat_reads_within_budget(self) -> None:
        self.build()
        statements: list[str] = []
        self.conn.set_trace_callback(statements.append)
        self.addCleanup(self.conn.set_trace_callback, None)
        spent: list[float] = []
        while len(spent) < READS and (not spent or min(spent) >= BUDGET):
            statements.clear()
            began = time.perf_counter()
            read = self.read(**{"from": day(0), "to": day(YEAR), "group_by": "seat"})
            spent.append(time.perf_counter() - began)
        took = ", ".join(f"{one:.3f}" for one in spent)
        self.assertLess(min(spent), BUDGET, f"by seat took {took} s")
        self.assertEqual(
            {"org-a/acct-1", "org-a/acct-2", "org-a/acct-3", None},
            {row["group"]["seat"]["id"] for row in read["rows"]},
        )
        self.assertEqual(
            read["total"]["agent_seconds"],
            round(sum(row["agent_seconds"] for row in read["rows"]), 3),
        )
        self.assertLessEqual(len(statements), MAX_SEAT_STATEMENTS, statements[:12])
