"""How a quota window's previous window ended, and the read of one past window.

The contract held here, stated from the request rather than read from the code: each window
that is a share of a limit says how the window before it ended -- the latest window of the
same account, kind and model whose reset is at or before this one's start, with its reset,
its latest reading and whether it ran out. Five-hour windows are not contiguous, so after a
gap the previous one is the latest kept, not the one a fixed length before. Where the store
keeps no reading of an earlier window, `previous` is `None` and the answer names where the
retention starts; a window whose readings are all older than the retention is not given.
The past read gives one such window, shaped as a current window is, and the window before
it, so a reader steps back one window at a time until none is kept.

Every id, time and share is invented. A time is a moment after `analytics_fixtures.START`
less a few weeks.
"""

from __future__ import annotations

import datetime as dt
from functools import partial
from unittest import mock

from server.analytics import api, quota, usage
from server.quota import samples
from tests.test_analytics_quota import (
    FIVE_RESET,
    NOW,
    ORG_A,
    ORG_B,
    ORG_C,
    SEAT,
    WEEK_RESET,
    _Quota,
    at,
    five,
    week,
)

#: The two weeks before the current one (2030-03-01 09:00 to 2030-03-08 09:00).
LAST_WEEK = "2030-03-01T09:00:00Z"
WEEK_BEFORE = "2030-02-22T09:00:00Z"
#: Two five-hour windows of the current week, two days and half a day before `NOW`, and
#: one more than three weeks before it, past the week further back the read reaches.
FIRST_FIVE = "2030-03-04T12:00:00Z"
LAST_FIVE = "2030-03-05T18:30:00Z"
OLD_FIVE = "2030-02-10T12:00:00Z"
#: The week `OLD_FIVE` was read in.
OLD_WEEK = "2030-02-15T09:00:00Z"


def seat(reset: str) -> str:
    return samples.seat_for_week(reset)


def utc(text: str) -> str:
    """A moment as the answer at offset 0 writes it."""

    return at(text).astimezone(dt.UTC).isoformat(timespec="milliseconds")


class _Past(_Quota):
    def past(self, account: str, kind: str, before: str, model: str | None = None) -> dict:
        return quota.past(
            self.conn, 0, account=account, kind=kind, model=model, before=at(before), now=NOW
        )

    def insert(self, moment: dt.datetime, kind: str, percent: float, reset: str) -> None:
        """A sample of «A»'s poll written as the store holds it, past what `record` accepts."""

        week_reset = (moment + dt.timedelta(days=1)).isoformat()
        with self.conn:
            self.conn.execute(
                "INSERT INTO quota_samples(at, source, organization, account_uuid, seat, kind,"
                " percent, resets_at) VALUES (?, 'poll', ?, 'acct-a', ?, ?, ?, ?)",
                (
                    samples.instant(moment.isoformat()),
                    ORG_A,
                    seat(week_reset),
                    kind,
                    percent,
                    samples.instant(reset),
                ),
            )


class PreviousWeekTests(_Past):
    def setUp(self) -> None:
        super().setUp()
        self.poll(at("2030-02-17T12:00:00Z"), week(10, WEEK_BEFORE), seat=seat(WEEK_BEFORE))
        self.poll(at("2030-02-21T20:00:00Z"), week(35, WEEK_BEFORE), seat=seat(WEEK_BEFORE))
        self.poll(at("2030-02-25T10:00:00Z"), week(5, LAST_WEEK), seat=seat(LAST_WEEK))
        self.poll(at("2030-02-28T22:00:00Z"), week(62, LAST_WEEK), seat=seat(LAST_WEEK))
        self.poll(at("2030-03-05T08:00:00Z"), week(40))

    def test_a_week_says_how_the_week_before_it_ended(self) -> None:
        current = self.window(self.account(self.quota(), ORG_A), "week")
        self.assertEqual(utc(WEEK_RESET), current["resets_at"])
        self.assertEqual(
            {
                "started_at": utc(WEEK_BEFORE),
                "resets_at": utc(LAST_WEEK),
                "latest": {
                    "at": utc("2030-02-28T22:00:00Z"),
                    "source": "poll",
                    "used_percent": 62.0,
                },
                "ran_out": False,
            },
            current["previous"],
        )

    def test_the_past_read_gives_that_week_whole_and_steps_back_to_the_one_before(self) -> None:
        current = self.window(self.account(self.quota(), ORG_A), "week")
        answer = self.past("org-a/acct-a", "week", current["started_at"])
        self.assertEqual(
            ("org-a/acct-a", "week", None, utc(LAST_WEEK)),
            (answer["account"], answer["kind"], answer["model"], answer["before"]),
        )
        shown = answer["window"]
        # A window as a current one is given, past its reset: no pace and no forecast.
        self.assertEqual(
            (utc(WEEK_BEFORE), utc(LAST_WEEK), None, None, "silent"),
            (
                shown["started_at"],
                shown["resets_at"],
                shown["even_percent"],
                shown["forecast"],
                shown["state"],
            ),
        )
        self.assertEqual(
            [(utc("2030-02-25T10:00:00Z"), 5.0), (utc("2030-02-28T22:00:00Z"), 62.0)],
            [(one["at"], one["used_percent"]) for one in shown["readings"]],
        )
        self.assertEqual(utc(WEEK_BEFORE), shown["previous"]["resets_at"])
        self.assertEqual(35.0, shown["previous"]["latest"]["used_percent"])

        before = self.past("org-a/acct-a", "week", shown["started_at"])["window"]
        self.assertEqual(utc(WEEK_BEFORE), before["resets_at"])
        self.assertEqual([10.0, 35.0], [one["used_percent"] for one in before["readings"]])
        # Nothing is kept before it.
        self.assertIsNone(before["previous"])
        self.assertIsNone(self.past("org-a/acct-a", "week", before["started_at"])["window"])

    def test_a_moment_inside_a_window_gives_the_last_one_that_had_reset_by_then(self) -> None:
        shown = self.past("org-a/acct-a", "week", "2030-02-27T00:00:00Z")["window"]
        self.assertEqual(utc(WEEK_BEFORE), shown["resets_at"])
        # A moment past the answer's own is the answer's: the current week has not reset.
        later = self.past("org-a/acct-a", "week", "2030-04-01T00:00:00Z")
        self.assertEqual(utc(NOW.isoformat()), later["before"])
        self.assertEqual(utc(LAST_WEEK), later["window"]["resets_at"])


class PreviousFiveHoursTests(_Past):
    def setUp(self) -> None:
        super().setUp()
        self.poll(
            at("2030-02-10T08:00:00Z"), five(15, OLD_FIVE), week(3, OLD_WEEK), seat=seat(OLD_WEEK)
        )
        self.poll(at("2030-03-04T08:00:00Z"), five(20, FIRST_FIVE))
        self.poll(at("2030-03-04T10:00:00Z"), five(55, FIRST_FIVE))
        self.poll(at("2030-03-05T14:00:00Z"), five(30, LAST_FIVE))
        self.poll(at("2030-03-05T15:00:00Z"), five(100, LAST_FIVE))
        # Another account's five hours in the gap are not «A»'s.
        self.poll(
            at("2030-03-06T02:00:00Z"),
            five(70, "2030-03-06T06:00:00Z"),
            organization=ORG_B,
            account="acct-b",
        )
        # After a gap of more than five hours, the current window began at 08:00.
        self.poll(at("2030-03-06T09:30:00Z"), five(12, FIVE_RESET))

    def test_after_a_gap_the_previous_five_hours_are_the_latest_kept_and_their_run_out(
        self,
    ) -> None:
        current = self.window(self.account(self.quota(), ORG_A), "five_hour")
        self.assertEqual(utc(FIVE_RESET), current["resets_at"])
        self.assertEqual(
            {
                "started_at": utc("2030-03-05T13:30:00Z"),
                "resets_at": utc(LAST_FIVE),
                "latest": {
                    "at": utc("2030-03-05T15:00:00Z"),
                    "source": "poll",
                    "used_percent": 100.0,
                },
                "ran_out": True,
            },
            current["previous"],
        )

    def test_stepping_back_reaches_a_window_weeks_before_the_read(self) -> None:
        current = self.window(self.account(self.quota(), ORG_A), "five_hour")
        last = self.past("org-a/acct-a", "five_hour", current["started_at"])["window"]
        self.assertEqual(utc(LAST_FIVE), last["resets_at"])
        self.assertEqual(utc(FIRST_FIVE), last["previous"]["resets_at"])
        self.assertFalse(last["previous"]["ran_out"])
        first = self.past("org-a/acct-a", "five_hour", last["started_at"])["window"]
        self.assertEqual([20.0, 55.0], [one["used_percent"] for one in first["readings"]])
        # Three weeks before it and found by its week's seat.
        self.assertEqual(utc(OLD_FIVE), first["previous"]["resets_at"])
        old = self.past("org-a/acct-a", "five_hour", first["started_at"])["window"]
        self.assertEqual([15.0], [one["used_percent"] for one in old["readings"]])
        self.assertIsNone(old["previous"])

    def test_another_accounts_window_is_never_the_previous_one(self) -> None:
        other = self.window(self.account(self.quota(), ORG_B), "five_hour")
        self.assertIsNone(other["previous"])
        found = self.past("org-b/acct-b", "five_hour", "2030-03-06T10:00:00Z")["window"]
        self.assertEqual([70.0], [one["used_percent"] for one in found["readings"]])
        self.assertIsNone(found["previous"])


class NoPreviousTests(_Past):
    def test_an_account_with_no_earlier_reading_says_so_and_where_the_retention_starts(
        self,
    ) -> None:
        self.poll(at("2030-03-06T09:50:00Z"), five(10), week(20))
        answer = self.quota()
        self.assertEqual(utc("2029-03-06T10:00:00Z"), answer["retained_from"])
        account = self.account(answer, ORG_A)
        for kind in ("five_hour", "week"):
            with self.subTest(kind):
                window = self.window(account, kind)
                self.assertIn("previous", window)
                self.assertIsNone(window["previous"])
        past = self.past("org-a/acct-a", "week", "2030-03-01T09:00:00Z")
        self.assertEqual(
            (None, utc("2029-03-06T10:00:00Z")), (past["window"], past["retained_from"])
        )
        # Nor does a window of money past a limit carry one.
        self.poll(
            at("2030-03-06T09:55:00Z"),
            samples.Window("extra_usage", None, None, amount=2.0, currency="USD"),
        )
        extra = self.window(self.account(self.quota(), ORG_A), "extra_usage")
        self.assertNotIn("previous", extra)

    def test_a_window_read_before_the_retention_is_not_given_and_one_after_it_is(self) -> None:
        self.poll(at("2030-03-06T09:50:00Z"), five(10))
        lapsed = NOW - dt.timedelta(days=366)
        self.insert(lapsed, "five_hour", 40, (lapsed + dt.timedelta(hours=1)).isoformat())
        current = self.window(self.account(self.quota(), ORG_A), "five_hour")
        self.assertIsNone(current["previous"])
        kept = NOW - dt.timedelta(days=364)
        self.insert(kept, "five_hour", 45, (kept + dt.timedelta(hours=1)).isoformat())
        current = self.window(self.account(self.quota(), ORG_A), "five_hour")
        self.assertEqual(
            utc((kept + dt.timedelta(hours=1)).isoformat()), current["previous"]["resets_at"]
        )
        self.assertEqual(45.0, current["previous"]["latest"]["used_percent"])

    def test_an_account_known_by_its_weekly_reset_finds_its_week_by_its_seats(self) -> None:
        self.working("s-c", ORG_C, at("2030-02-10T00:00:00Z"))
        self.statusline(at("2030-02-12T10:00:00Z"), "s-c", week(30, OLD_WEEK), seat=seat(OLD_WEEK))
        self.statusline(at("2030-03-05T10:00:00Z"), "s-c", week(8))
        account = self.account(self.quota(), ORG_C)
        self.assertEqual(f"{ORG_C}/weekly:5T09:00Z", account["account"])
        window = self.window(account, "week")
        self.assertEqual(utc(OLD_WEEK), window["previous"]["resets_at"])
        found = self.past(account["account"], "week", window["started_at"])["window"]
        self.assertEqual([30.0], [one["used_percent"] for one in found["readings"]])


class PastRouteTests(_Past):
    def answer_of(self, parameters: dict[str, list[str]]) -> tuple[int, dict]:
        try:
            with mock.patch.object(quota, "past", partial(quota.past, now=NOW)):
                found = api.handle_get(self.conn, api.QUOTA_WINDOW_PATH, parameters)
        except (api.AnalyticsHttpError, usage.UsageQueryError) as error:
            return api.error_response(error)
        assert found is not None
        return found

    def test_the_route_answers_one_past_window_at_the_callers_offset(self) -> None:
        self.poll(at("2030-03-04T10:00:00Z"), five(55, FIRST_FIVE))
        self.poll(at("2030-03-06T09:30:00Z"), five(12, FIVE_RESET), week(9, WEEK_RESET), seat=SEAT)
        status, body = self.answer_of(
            {
                "account": ["org-a/acct-a"],
                "kind": ["five_hour"],
                "before": ["2030-03-06T11:00:00+03:00"],
                "utc_offset": ["180"],
            }
        )
        self.assertEqual(200, status, body)
        self.assertEqual(api.ANALYTICS_API_INTERFACE, body["interface_version"])
        shown = body["quota_window"]["window"]
        self.assertEqual("2030-03-04T15:00:00.000+03:00", shown["resets_at"])
        self.assertEqual(180, body["quota_window"]["utc_offset"])

    def test_a_request_that_names_no_past_window_is_refused(self) -> None:
        asked = {"account": ["org-a/acct-a"], "kind": ["week"], "before": ["2030-03-06T00:00:00Z"]}
        for change, message in (
            ({"colour": ["red"]}, "colour is not a parameter"),
            ({"account": ["org-a"]}, "account must be an account's key"),
            ({"kind": ["extra_usage"]}, "kind must be one of five_hour, week, week_model"),
            ({"model": ["model-a"]}, "model is given for a model's week and for no other kind"),
            ({"kind": ["week_model"]}, "model is given for a model's week and for no other kind"),
            ({"kind": ["week_model"], "model": ["m" * 65]}, "model must be at most 64 characters"),
            ({"before": ["2030-03-06T00:00:00"]}, "before must be a time with its offset"),
            ({"before": ["yesterday"]}, "before must be a time with its offset"),
            ({"before": []}, "before is required"),
            ({"utc_offset": ["900"]}, "utc_offset must be from -840 to 840 minutes"),
        ):
            with self.subTest(change):
                status, body = self.answer_of({**asked, **change})
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
                self.assertEqual(message, body["error"]["message"])
        status, body = self.answer_of(asked)
        self.assertEqual(200, status, body)
        self.assertIsNone(body["quota_window"]["window"])
