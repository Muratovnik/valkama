"""The one write path of a quota sample: what it keeps, what it refuses, and the seat rule.

The kinds, the sources' own names for their windows and the seat's form are stated here
from the sources' documented vocabularies (the Claude Code status line's `rate_limits`,
the mod's reading, the usage endpoint's `limits[]` and `spend`), not read from the code
under test. Every time and id is invented.
"""

from __future__ import annotations

import calendar
import datetime as dt
import math
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import housekeeping, store
from server.quota import samples
from server.quota import store as quota_store

NOW = dt.datetime(2030, 3, 5, 12, 0, tzinfo=dt.UTC)
ORGANIZATION = "org-1"
SESSION = "session-1"
SEAT = "week:2030-03-08T09:00Z"
WEEK_RESET = "2030-03-08T09:00:00Z"
#: Every column of a sample after its id, in the order the table declares them.
COLUMNS = (
    "at, source, organization, session_id, seat, kind, model, percent, resets_at, amount, currency"
)


def poll(at: str, *windows: samples.Window, seat: str | None = SEAT, **extra) -> samples.Reading:
    return samples.Reading("poll", at, windows, seat, organization=ORGANIZATION, **extra)


def mod(at: str, *windows: samples.Window, session: str = SESSION) -> samples.Reading:
    return samples.Reading("mod", at, windows, SEAT, session_id=session)


def week(percent: float) -> samples.Window:
    return samples.Window("week", percent, WEEK_RESET)


class _Store(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def record(self, reading: samples.Reading) -> int:
        with self.conn:
            return samples.record(self.conn, reading, now=NOW)

    def rows(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(f"SELECT id, {COLUMNS} FROM quota_samples ORDER BY id")
        ]


class RecordTests(_Store):
    def test_a_reading_keeps_each_window_with_what_identifies_it(self) -> None:
        reading = poll(
            "2030-03-04T12:00:00+03:00",
            samples.Window("five_hour", 12, "2030-03-04T14:00:00Z"),
            week(40.5),
            samples.Window("week_model", 3, WEEK_RESET, model="Opus 4"),
            samples.Window("extra_usage", amount=7.25),
        )
        self.assertEqual(4, self.record(reading))
        at = "2030-03-04T09:00:00.000Z"
        reset = "2030-03-08T09:00:00.000Z"
        self.assertEqual(
            [
                (1, at, "poll", ORGANIZATION, None, SEAT, "five_hour", None, 12.0,
                 "2030-03-04T14:00:00.000Z", None, None),
                (2, at, "poll", ORGANIZATION, None, SEAT, "week", None, 40.5, reset, None, None),
                (3, at, "poll", ORGANIZATION, None, SEAT, "week_model", "Opus 4", 3.0, reset,
                 None, None),
                (4, at, "poll", ORGANIZATION, None, SEAT, "extra_usage", None, None, None, 7.25,
                 None),
            ],
            self.rows(),
        )  # fmt: skip

    def test_only_a_changed_window_is_kept_and_a_repeat_keeps_nothing(self) -> None:
        five = samples.Window("five_hour", 10, "2030-03-04T14:00:00Z")
        self.assertEqual(2, self.record(poll("2030-03-04T09:00:00Z", five, week(40))))
        self.assertEqual(0, self.record(poll("2030-03-04T09:00:00Z", five, week(40))))
        self.assertEqual(0, self.record(poll("2030-03-04T09:05:00Z", five, week(40))))
        self.assertEqual(1, self.record(poll("2030-03-04T09:10:00Z", five, week(41))))
        # Back to an earlier value is a change from the one before it.
        self.assertEqual(1, self.record(poll("2030-03-04T09:15:00Z", five, week(40))))
        moved = samples.Window("five_hour", 10, "2030-03-04T14:00:01Z")
        self.assertEqual(1, self.record(poll("2030-03-04T09:20:00Z", moved, week(40))))
        self.assertEqual(
            [("five_hour", 10.0), ("week", 40.0), ("week", 41.0), ("week", 40.0),
             ("five_hour", 10.0)],
            [(row[6], row[8]) for row in self.rows()],
        )  # fmt: skip

    def test_each_series_is_compared_with_itself(self) -> None:
        self.assertEqual(1, self.record(poll("2030-03-04T09:00:00Z", week(40))))
        other_seat = poll("2030-03-04T09:01:00Z", week(40), seat="week:2030-03-08T19:00Z")
        self.assertEqual(1, self.record(other_seat))
        self.assertEqual(1, self.record(poll("2030-03-04T09:02:00Z", week(40), seat=None)))
        self.assertEqual(1, self.record(mod("2030-03-04T09:03:00Z", week(40))))
        self.assertEqual(1, self.record(mod("2030-03-04T09:04:00Z", week(40), session="s-2")))
        # A session's reading and its organization's are different series.
        self.assertEqual(0, self.record(mod("2030-03-04T09:05:00Z", week(40))))
        self.assertEqual(5, len(self.rows()))

    def test_an_earlier_reading_is_compared_with_the_one_before_it_and_rewrites_nothing(
        self,
    ) -> None:
        self.record(poll("2030-03-04T09:00:00Z", week(40)))
        self.record(poll("2030-03-04T10:00:00Z", week(42)))
        before = self.rows()
        # Between the two: equal to the one before it in time, so nothing is kept.
        self.assertEqual(0, self.record(poll("2030-03-04T09:30:00Z", week(40))))
        # Different from the one before it in time: kept, and the later row stays.
        self.assertEqual(1, self.record(poll("2030-03-04T09:40:00Z", week(41))))
        self.assertEqual(before, self.rows()[:2])
        self.assertEqual(("2030-03-04T09:40:00.000Z", 41.0), (self.rows()[2][1], self.rows()[2][8]))

    def test_a_reading_past_the_retention_keeps_nothing(self) -> None:
        old = (NOW - dt.timedelta(days=366)).isoformat()
        self.assertEqual(0, self.record(poll(old, week(40))))
        self.assertEqual([], self.rows())

    def test_prune_deletes_only_the_samples_past_a_year(self) -> None:
        self.record(poll((NOW - dt.timedelta(days=364)).isoformat(), week(40)))
        with self.conn:
            self.conn.execute(
                "INSERT INTO quota_samples(at, source, organization, kind, percent)"
                " VALUES ('2029-03-04T00:00:00.000Z', 'import', 'org-1', 'week', 1)"
            )
        with self.conn:
            self.assertEqual(1, samples.prune(self.conn, now=NOW))
        self.assertEqual(["2029-03-06T12:00:00.000Z"], [row[1] for row in self.rows()])

    def test_the_start_up_housekeeping_prunes_the_samples(self) -> None:
        with self.conn:
            self.conn.execute(
                "INSERT INTO quota_samples(at, source, organization, kind, percent)"
                " VALUES ('2000-01-01T00:00:00.000Z', 'import', 'org-1', 'week', 1)"
            )
        report = housekeeping.run(self.conn)
        self.assertEqual([], report.failures)
        self.assertEqual(1, report.pruned_samples)
        self.assertEqual([], self.rows())

    def test_an_organization_seat_is_an_account_whose_plan_follows_and_label_stays(self) -> None:
        self.record(poll("2030-03-04T09:00:00Z", week(40)))
        with self.conn:
            self.conn.execute("UPDATE quota_accounts SET label = 'Mine'")
        self.record(poll("2030-03-04T09:10:00Z", week(41), plan="Team"))
        self.record(poll("2030-03-04T09:20:00Z", week(42)))
        self.record(poll("2030-03-04T09:30:00Z", week(43), seat=None))
        self.record(mod("2030-03-04T09:40:00Z", week(44)))
        self.assertEqual(
            [(ORGANIZATION, SEAT, "Team", "Mine")],
            [tuple(row) for row in self.conn.execute("SELECT * FROM quota_accounts")],
        )

    def test_a_reading_that_cannot_be_kept_writes_nothing(self) -> None:
        five = samples.Window("five_hour", 10, "2030-03-04T14:00:00Z")
        at = "2030-03-04T09:00:00Z"
        refused = {
            "no source": samples.Reading("cli", at, (five,), None, organization=ORGANIZATION),
            "poll by session": samples.Reading("poll", at, (five,), None, session_id=SESSION),
            "mod by organization": samples.Reading("mod", at, (five,), None, ORGANIZATION),
            "both": samples.Reading("statusline", at, (five,), None, ORGANIZATION, SESSION),
            "neither": samples.Reading("import", at, (five,), None),
            "not an id": samples.Reading("poll", at, (five,), None, organization="a b"),
            "no window": poll(at),
            "no offset": poll("2030-03-04T09:00:00", five),
            "not a time": poll("yesterday", five),
            "ahead": poll("2030-03-05T12:06:00Z", five),
            "bad seat": poll(at, five, seat="week:2030-03-08T09:05Z"),
            "plan without a seat": poll(at, five, seat=None, plan="Team"),
            "plan of a session": samples.Reading(
                "mod", at, (five,), SEAT, session_id=SESSION, plan="Team"
            ),
            "kind": poll(at, samples.Window("month", 1)),
            "model elsewhere": poll(at, samples.Window("week", 1, model="Opus")),
            "no model": poll(at, samples.Window("week_model", 1)),
            "money elsewhere": poll(at, samples.Window("five_hour", 1, amount=2)),
            "currency alone": poll(at, samples.Window("extra_usage", 1, currency="USD")),
            "currency form": poll(at, samples.Window("extra_usage", amount=1, currency="usd")),
            "no percent": poll(at, samples.Window("week", None, WEEK_RESET)),
            "below zero": poll(at, samples.Window("week", -1)),
            "not finite": poll(at, samples.Window("week", math.nan)),
            "a flag": poll(at, samples.Window("week", True)),
            "twice": poll(at, week(1), week(2)),
            "bad reset": poll(at, samples.Window("week", 1, "soon")),
        }
        for name, reading in refused.items():
            with self.subTest(name), self.assertRaises(samples.SampleError):
                self.record(reading)
        self.assertEqual([], self.rows())
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM quota_accounts").fetchone()[0])

    def test_the_table_refuses_what_the_write_path_refuses(self) -> None:
        insert = (
            "INSERT INTO quota_samples(at, source, organization, session_id, kind, model,"
            " percent, amount) VALUES (?,?,?,?,?,?,?,?)"
        )
        at = "2030-03-04T09:00:00.000Z"
        for values in (
            (at, "cli", ORGANIZATION, None, "week", None, 1, None),
            (at, "poll", None, SESSION, "week", None, 1, None),
            (at, "mod", ORGANIZATION, SESSION, "week", None, 1, None),
            (at, "poll", ORGANIZATION, None, "month", None, 1, None),
            (at, "poll", ORGANIZATION, None, "week_model", None, 1, None),
            (at, "poll", ORGANIZATION, None, "five_hour", None, 1, 2),
            (at, "poll", ORGANIZATION, None, "week", None, None, None),
        ):
            with self.subTest(values=values), self.assertRaises(sqlite3.IntegrityError):
                self.conn.execute(insert, values)
        self.conn.rollback()


class VocabularyTests(unittest.TestCase):
    def test_the_kinds_are_the_five_windows(self) -> None:
        self.assertEqual(
            ("five_hour", "week", "week_model", "extra_usage", "spend_limit"), quota_store.KINDS
        )
        self.assertEqual(("statusline", "mod", "poll", "import"), quota_store.SOURCES)

    def test_every_name_a_live_source_gives_a_window_has_a_kind(self) -> None:
        expected = {
            # The status line's `rate_limits` windows.
            ("statusline", "five_hour"): "five_hour",
            ("statusline", "seven_day"): "week",
            ("statusline", "spend_limit"): "spend_limit",
            # The mod's reading of the same windows.
            ("mod", "five_hour"): "five_hour",
            ("mod", "seven_day"): "week",
            # The usage endpoint: `limits[].kind`, its older buckets, and `spend`.
            ("poll", "session"): "five_hour",
            ("poll", "weekly_all"): "week",
            ("poll", "weekly_scoped"): "week_model",
            ("poll", "five_hour"): "five_hour",
            ("poll", "seven_day"): "week",
            ("poll", "spend"): "extra_usage",
        }
        given = {
            (source, name): kind
            for source, names in samples.SOURCE_WINDOWS.items()
            for name, kind in names.items()
        }
        self.assertEqual(expected, given)


class SeatRuleTests(unittest.TestCase):
    def test_the_seat_is_the_week_reset_to_the_nearest_ten_minutes(self) -> None:
        self.assertEqual(
            "week:2030-03-08T09:00Z", samples.seat_for_week("2030-03-08T09:04:59.999Z")
        )
        self.assertEqual("week:2030-03-08T09:10Z", samples.seat_for_week("2030-03-08T09:05:01Z"))
        self.assertEqual("week:2030-03-08T09:00Z", samples.seat_for_week("2030-03-08T08:55:01Z"))
        self.assertEqual(
            "week:2030-03-08T09:00Z", samples.seat_for_week("2030-03-08T12:00:00+03:00")
        )

    def test_a_half_step_goes_to_the_even_step(self) -> None:
        for half in ("2030-03-08T09:05:00Z", "2030-03-08T09:15:00Z"):
            seconds = calendar.timegm(dt.datetime.fromisoformat(half).utctimetuple())
            below = (seconds - 300) // 600
            step = below if below % 2 == 0 else below + 1
            expected = dt.datetime.fromtimestamp(step * 600, dt.UTC).strftime(
                "week:%Y-%m-%dT%H:%MZ"
            )
            with self.subTest(half):
                self.assertEqual(expected, samples.seat_for_week(half))

    def test_the_seat_of_a_reading_comes_from_its_week(self) -> None:
        five = samples.Window("five_hour", 1, "2030-03-04T14:00:00Z")
        self.assertEqual(SEAT, samples.seat_of([five, week(1)]))
        self.assertIsNone(samples.seat_of([five]))
        self.assertIsNone(samples.seat_of([samples.Window("week", 1)]))

    def test_times_are_kept_in_utc_to_the_millisecond(self) -> None:
        self.assertEqual(
            "2030-03-04T06:00:00.123Z", samples.instant("2030-03-04T09:00:00.123456+03:00")
        )


if __name__ == "__main__":
    unittest.main()
