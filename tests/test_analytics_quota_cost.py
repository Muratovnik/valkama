"""The quota read stays quick on a store holding a year of readings for three accounts.

A reading every ten minutes for a year, the five-hour window and the week each time: two
accounts read by the poll, one of them with a model's week as well, and one read through
a session's status line, which a read gives its organization one reading at a time. Only
the last seven days are answered, and the year before them must not cost the read. The
budget is the Analytics read's own (`test_analytics_cost`), on the reading thread's processor
time for the reason given there.
"""

from __future__ import annotations

import datetime as dt
from functools import partial

from server.analytics import quota
from server.quota import accounts, samples
from tests import test_analytics_cost as cost
from tests.analytics_fixtures import START, UsageStore
from tests.processor_time import processor_seconds

#: A year of readings, ten minutes apart.
STEP = dt.timedelta(minutes=10)
YEAR = dt.timedelta(days=365)
NOW = START + YEAR
_FIVE = dt.timedelta(hours=5)
_WEEK = dt.timedelta(days=7)


def _stamp(moment: dt.datetime) -> str:
    return samples.instant(moment.isoformat())


class QuotaCostTests(UsageStore):
    def build(self) -> None:
        self.segment("s-c", 0, 60, organization="org-c")
        rows: list[tuple[object, ...]] = []
        moment = START
        count = 0
        while moment <= NOW:
            five_reset = START + _FIVE * ((moment - START) // _FIVE + 1)
            week_reset = START + _WEEK * ((moment - START) // _WEEK + 1)
            five = round(100 * ((moment - (five_reset - _FIVE)) / _FIVE) * 0.8, 1)
            week = round(100 * ((moment - (week_reset - _WEEK)) / _WEEK) * 0.7, 1)
            seat = samples.seat_for_week(week_reset.isoformat())
            at = _stamp(moment)
            windows = (
                ("five_hour", None, five, _stamp(five_reset)),
                ("week", None, week, _stamp(week_reset)),
            )
            for identity, kinds in (
                (("poll", "org-a", None, "acct-a"), windows),
                (("poll", "org-b", None, "acct-b"), windows),
                (("statusline", None, "s-c", None), windows),
                (
                    ("poll", "org-b", None, "acct-b"),
                    (("week_model", "claude-opus-5-5", week / 2, _stamp(week_reset)),),
                ),
            ):
                rows += [(at, *identity, seat, *window) for window in kinds]
            moment += STEP
            count += 1
        self.conn.executemany(
            "INSERT INTO quota_samples(at, source, organization, session_id, account_uuid, seat,"
            " kind, model, percent, resets_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()
        self.readings = count

    def test_a_year_of_readings_for_three_accounts_reads_within_the_analytics_budget(
        self,
    ) -> None:
        self.build()
        self.assertGreater(self.readings, 52_000)
        answer, spent = processor_seconds(partial(quota.read, self.conn, 180, now=NOW))
        self.assertLess(spent, cost.BUDGET, f"the quota read took {spent:.3f} s of processor time")
        # The status line's account is its organization's, known by its weekly reset, which
        # is the same every week: one account, however many weeks it was read in.
        slot = accounts.weekly_reset(samples.seat_for_week((START + 53 * _WEEK).isoformat()))
        self.assertEqual(
            [
                ("org-a/acct-a", "acct-a", slot, 2),
                ("org-b/acct-b", "acct-b", slot, 3),
                (f"org-c/weekly:{slot}", None, slot, 2),
            ],
            [
                (one["account"], one["account_uuid"], one["weekly_reset"], len(one["windows"]))
                for one in answer["accounts"]
            ],
        )
