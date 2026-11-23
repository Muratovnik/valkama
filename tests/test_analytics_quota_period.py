"""A quota window over a page's period: the windows before it that the period overlaps.

The contract held here, stated from the request rather than read from the code: asked with
`from`, the start of the period a page shows, each window that is a share of a limit also
holds `earlier`, every window of the same account, kind and model before it that reset after
that moment, oldest first, each whole from its start to its reset with its readings and its
restarts. The current window is not among them. A window that started before `from` and
reset after it is in, with the readings it had before `from`; one that reset at or before it
is not. Asked without `from`, the answer is as it was: the same fields, and no `earlier`.

Every id, time and share is invented. A time is a moment after `analytics_fixtures.START`
less a few weeks.
"""

from __future__ import annotations

from functools import partial
from unittest import mock

from server.analytics import api, quota, usage
from tests.test_analytics_quota import FIVE_RESET, NOW, ORG_A, ORG_B, at, five, week
from tests.test_analytics_quota_past import (
    FIRST_FIVE,
    LAST_FIVE,
    LAST_WEEK,
    OLD_FIVE,
    OLD_WEEK,
    WEEK_BEFORE,
    _Past,
    seat,
    utc,
)

#: Two more weeks back: the week that reset on 2030-02-15 and the one before it.
WEEK_THREE = "2030-02-15T09:00:00Z"
WEEK_FOUR = "2030-02-08T09:00:00Z"


class _Period(_Past):
    def period(self, start: str) -> dict:
        return quota.read(self.conn, 0, now=NOW, period_from=at(start))

    @staticmethod
    def spans(window: dict) -> list[tuple[str, str, list[float]]]:
        return [
            (one["started_at"], one["resets_at"], [r["used_percent"] for r in one["readings"]])
            for one in window["earlier"]
        ]


class WeeksOverAPeriodTests(_Period):
    def setUp(self) -> None:
        super().setUp()
        # A week the period does not reach, then three it does, the first of them read once
        # before the period starts and the third with its count restarted inside it.
        self.poll(at("2030-02-05T12:00:00Z"), week(50, WEEK_FOUR), seat=seat(WEEK_FOUR))
        self.poll(at("2030-02-09T12:00:00Z"), week(15, WEEK_THREE), seat=seat(WEEK_THREE))
        self.poll(at("2030-02-14T12:00:00Z"), week(70, WEEK_THREE), seat=seat(WEEK_THREE))
        self.poll(at("2030-02-17T12:00:00Z"), week(10, WEEK_BEFORE), seat=seat(WEEK_BEFORE))
        self.poll(at("2030-02-21T20:00:00Z"), week(35, WEEK_BEFORE), seat=seat(WEEK_BEFORE))
        self.poll(at("2030-02-25T10:00:00Z"), week(40, LAST_WEEK), seat=seat(LAST_WEEK))
        self.poll(at("2030-02-26T10:00:00Z"), week(5, LAST_WEEK), seat=seat(LAST_WEEK))
        self.poll(at("2030-02-28T22:00:00Z"), week(62, LAST_WEEK), seat=seat(LAST_WEEK))
        self.poll(at("2030-03-05T08:00:00Z"), week(40))

    def test_every_week_the_period_overlaps_is_held_whole_and_in_order(self) -> None:
        window = self.window(self.account(self.period("2030-02-10T00:00:00Z"), ORG_A), "week")
        self.assertEqual(
            [
                (utc(WEEK_FOUR), utc(WEEK_THREE), [15.0, 70.0]),
                (utc(WEEK_THREE), utc(WEEK_BEFORE), [10.0, 35.0]),
                (utc(WEEK_BEFORE), utc(LAST_WEEK), [40.0, 5.0, 62.0]),
            ],
            self.spans(window),
        )
        # The current week is the window itself, never one of those before it.
        self.assertEqual(utc(LAST_WEEK), window["started_at"])
        self.assertEqual([40.0], [one["used_percent"] for one in window["readings"]])
        # Each carries its own restarts, as the window it is drawn beside does.
        self.assertEqual(
            [[], [], [utc("2030-02-26T10:00:00Z")]], [one["restarts"] for one in window["earlier"]]
        )
        self.assertEqual(
            {"started_at", "resets_at", "readings", "restarts"}, set(window["earlier"][0])
        )

    def test_a_week_that_reset_by_the_periods_start_is_not_held(self) -> None:
        window = self.window(self.account(self.period(WEEK_THREE), ORG_A), "week")
        self.assertEqual(
            [utc(WEEK_BEFORE), utc(LAST_WEEK)], [one["resets_at"] for one in window["earlier"]]
        )

    def test_a_period_inside_the_current_week_holds_none_before_it(self) -> None:
        window = self.window(self.account(self.period("2030-03-04T00:00:00Z"), ORG_A), "week")
        self.assertEqual([], window["earlier"])

    def test_without_a_period_the_answer_is_as_it_was(self) -> None:
        plain = self.quota()
        over = self.period("2030-02-10T00:00:00Z")
        for entry in over["accounts"]:
            for window in entry["windows"]:
                window.pop("earlier", None)
        self.assertEqual(plain, over)
        for entry in plain["accounts"]:
            for window in entry["windows"]:
                self.assertNotIn("earlier", window)


class FiveHoursOverAPeriodTests(_Period):
    def setUp(self) -> None:
        super().setUp()
        self.poll(
            at("2030-02-10T08:00:00Z"), five(15, OLD_FIVE), week(3, OLD_WEEK), seat=seat(OLD_WEEK)
        )
        self.poll(at("2030-03-04T08:00:00Z"), five(20, FIRST_FIVE))
        self.poll(at("2030-03-04T10:00:00Z"), five(55, FIRST_FIVE))
        self.poll(at("2030-03-05T14:00:00Z"), five(30, LAST_FIVE))
        self.poll(at("2030-03-05T15:00:00Z"), five(100, LAST_FIVE))
        # Another account's five hours in the period are not «A»'s.
        self.poll(
            at("2030-03-06T02:00:00Z"),
            five(70, "2030-03-06T06:00:00Z"),
            organization=ORG_B,
            account="acct-b",
        )
        self.poll(at("2030-03-06T09:30:00Z"), five(12, FIVE_RESET))

    def test_every_five_hours_of_the_period_are_held_and_no_other_accounts(self) -> None:
        window = self.window(self.account(self.period("2030-03-01T00:00:00Z"), ORG_A), "five_hour")
        self.assertEqual(
            [
                (utc("2030-03-04T07:00:00Z"), utc(FIRST_FIVE), [20.0, 55.0]),
                (utc("2030-03-05T13:30:00Z"), utc(LAST_FIVE), [30.0, 100.0]),
            ],
            self.spans(window),
        )
        other = self.window(self.account(self.period("2030-03-01T00:00:00Z"), ORG_B), "five_hour")
        self.assertEqual([], other["earlier"])

    def test_a_period_weeks_long_reaches_a_window_weeks_back(self) -> None:
        window = self.window(self.account(self.period("2030-02-01T00:00:00Z"), ORG_A), "five_hour")
        self.assertEqual(
            [utc(OLD_FIVE), utc(FIRST_FIVE), utc(LAST_FIVE)],
            [one["resets_at"] for one in window["earlier"]],
        )

    def test_a_period_before_the_retention_reads_from_the_retention(self) -> None:
        window = self.window(self.account(self.period("2020-01-01T00:00:00Z"), ORG_A), "five_hour")
        self.assertEqual(3, len(window["earlier"]))


class PeriodRouteTests(_Period):
    def answer_of(self, parameters: dict[str, list[str]]) -> tuple[int, dict]:
        try:
            with mock.patch.object(quota, "read", partial(quota.read, now=NOW)):
                found = api.handle_get(self.conn, api.QUOTA_PATH, parameters)
        except (api.AnalyticsHttpError, usage.UsageQueryError) as error:
            return api.error_response(error)
        assert found is not None
        return found

    def test_the_route_reads_the_windows_since_from_and_refuses_a_time_with_no_offset(
        self,
    ) -> None:
        self.poll(at("2030-03-04T10:00:00Z"), five(55, FIRST_FIVE))
        self.poll(at("2030-03-06T09:30:00Z"), five(12, FIVE_RESET))
        status, body = self.answer_of(
            {"from": ["2030-03-04T03:00:00+03:00"], "utc_offset": ["180"]}
        )
        self.assertEqual(200, status, body)
        window = self.window(self.account(body["quota"], ORG_A), "five_hour")
        self.assertEqual(
            ["2030-03-04T15:00:00.000+03:00"], [one["resets_at"] for one in window["earlier"]]
        )
        status, body = self.answer_of({"utc_offset": ["180"]})
        self.assertEqual(200, status, body)
        self.assertNotIn("earlier", self.window(self.account(body["quota"], ORG_A), "five_hour"))
        for value in ("2030-03-04", "2030-03-04T00:00:00", "soon"):
            with self.subTest(value):
                status, body = self.answer_of({"from": [value]})
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
                self.assertEqual("from must be a time with its offset", body["error"]["message"])
