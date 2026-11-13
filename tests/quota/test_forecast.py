"""The quota forecast gives the numbers of the forecast it was ported from.

Every case of the original suite is here, in the order it had, with the tolerance it used:
one billionth for a ratio, a pace or a share, one millisecond for a moment. A window's
series is told apart by its length, so where the original named a reading's limit by key,
a five-hour reading here has the five-hour length and an all-models week reading the
week's. The cases after those hold the two rules the port adds: no forecast before the
history its pace needs, and a week given as a range no alert may read.
"""

from __future__ import annotations

import datetime as dt
import unittest
from typing import TypeVar

from server.quota.forecast import (
    FIVE_HOURS,
    HOUR,
    MIN,
    WEEK,
    Basis,
    Ceiling,
    Coupling,
    Enough,
    FiveHourOutlook,
    Forecast,
    Reading,
    Short,
    SpendEnough,
    SpendIdle,
    SpendReading,
    SpendShort,
    SpendUnknown,
    Spent,
    Stop,
    WeekRange,
    Window,
    ceiling_for,
    even_left,
    first_stop,
    forecast,
    outlook,
    same_window,
    settle,
    spend_forecast,
    wait_for_even,
    week_caps,
    window_cost,
)

_K = TypeVar("_K")


def utc(*parts: int) -> int:
    return int(dt.datetime(*parts, tzinfo=dt.UTC).timestamp()) * 1000


T0 = utc(2026, 10, 11, 12)
RESET = T0 + 4 * HOUR
DAY = 24 * HOUR


def five(percent: float, resets_at: int | None = RESET) -> Window:
    return Window(FIVE_HOURS, percent, resets_at)


def week(percent: float, resets_at: int) -> Window:
    return Window(WEEK, percent, resets_at)


def at(
    moment: int, percent: float, resets_at: int | None = RESET, length: int = FIVE_HOURS
) -> Reading:
    return Reading(moment, percent, resets_at, length)


def weekly_at(moment: int, percent: float, resets_at: int) -> Reading:
    return Reading(moment, percent, resets_at, WEEK)


class Case(unittest.TestCase):
    def near(self, actual: float | None, expected: float, epsilon: float = 1e-9) -> None:
        if actual is None:
            self.fail(f"None is not near {expected}")
        self.assertLess(abs(actual - expected), epsilon, f"{actual} is not near {expected}")

    def of(self, kind: type[_K], found: object) -> _K:
        if not isinstance(found, kind):
            self.fail(f"{found!r} is not {kind.__name__}")
        return found


class TrustedReadingsTests(Case):
    def test_one_window_is_one_reset_give_or_take_ten_minutes(self) -> None:
        self.assertTrue(same_window(RESET, RESET + 10 * MIN))
        self.assertFalse(same_window(RESET, RESET + 11 * MIN))
        self.assertTrue(same_window(None, RESET))

    def test_keeps_this_windows_readings_in_order_and_drops_a_stale_lower_one(self) -> None:
        readings = [
            at(T0 + 5 * MIN, 41),
            at(T0, 40),
            at(T0 + 6 * MIN, 39),
            at(T0 - HOUR, 90, T0),
            at(T0 + 5 * MIN, 41),
            at(T0, 70, RESET, WEEK),
        ]
        self.assertEqual(settle(readings, FIVE_HOURS, RESET), [at(T0, 40), at(T0 + 5 * MIN, 41)])


class ForecastTests(Case):
    # With 80% left and 240 minutes to the reset, 5% a quarter hour spends the window
    # exactly at it.
    def test_a_pace_a_little_slower_than_the_lasting_one_lasts(self) -> None:
        found = forecast(five(20), [at(T0 - 15 * MIN, 15.5), at(T0, 20)], T0)
        self.near(self.of(Enough, found).ratio, 0.9)

    def test_a_pace_a_little_faster_runs_out_before_the_reset_and_says_when(self) -> None:
        found = self.of(Short, forecast(five(20), [at(T0 - 15 * MIN, 14.5), at(T0, 20)], T0))
        self.near(found.ratio, 1.1)
        self.near(found.at, T0 + (80 / 5.5) * 15 * MIN, 1)

    def test_a_spent_window_says_so_and_an_unknown_reset_or_window_says_nothing(self) -> None:
        self.assertEqual(forecast(five(100), [], T0), Spent(RESET))
        self.assertIsNone(forecast(five(40, None), [at(T0 - 15 * MIN, 30)], T0))
        self.assertIsNone(forecast(five(40, T0), [at(T0 - 15 * MIN, 30, T0)], T0))
        self.assertIsNone(forecast(Window(30 * DAY, 40, RESET), [], T0))

    # Readings five minutes apart: the quarter-hour pace must hold between polls, not fall
    # back to the window's average.
    def test_readings_five_minutes_apart_still_give_the_recent_pace_between_polls(self) -> None:
        readings = [at(T0 - 30 * MIN + minutes * MIN, 20 + minutes) for minutes in range(0, 31, 5)]
        for since_poll in (0, 2, 4):
            with self.subTest(since_poll=since_poll):
                now = T0 + since_poll * MIN
                found = self.of(Short, forecast(five(50), readings, now))
                # Half an hour of readings: the quarter hour blends with all of them, both
                # at one percent a minute.
                self.assertEqual(found.basis.kind, "blend")
                # The blend's longer half counts the unseen minutes since the last poll
                # over a longer span, so it lags within 15%.
                truth = (RESET - now) / MIN / (100 - 50 - since_poll)
                self.assertLess(abs(found.ratio / truth - 1), 0.15, f"{found.ratio} vs {truth}")

    def test_no_spending_since_the_lookback_began_lasts_at_rest(self) -> None:
        self.assertEqual(
            forecast(five(40), [at(T0 - 20 * MIN, 40)], T0),
            Enough(0, RESET, Basis("blend", 20 * MIN, 15 * MIN)),
        )

    def test_the_first_minutes_of_a_fresh_window_with_no_readings_say_nothing(self) -> None:
        fresh = T0 + 5 * HOUR - 3 * MIN
        self.assertIsNone(forecast(five(2, fresh), [at(T0, 2, fresh)], T0))

    def test_a_stale_lower_reading_does_not_set_where_the_lookback_began(self) -> None:
        found = forecast(five(46), [at(T0 - 30 * MIN, 45), at(T0 - 16 * MIN, 41), at(T0, 46)], T0)
        # From 45 a quarter hour ago and from 45 half an hour ago: 1/15 and 1/30 a minute,
        # 1/20 together.
        self.near(self.of(Enough, found).ratio, ((1 / 20) * 240) / 54)

    # The reason for the blend: alone the quarter hour (0.4 a minute) would call the window
    # short at 1.3 times the lasting pace; with the hour (0.1) it is 0.25.
    def test_a_burst_after_a_quiet_hour_is_weighed_against_that_hour(self) -> None:
        found = self.of(
            Enough, forecast(five(26), [at(T0 - HOUR, 20), at(T0 - 15 * MIN, 20), at(T0, 26)], T0)
        )
        self.near(found.ratio, (0.25 * 240) / 74)
        self.assertEqual(found.basis, Basis("blend", HOUR, 15 * MIN))

    def test_a_window_younger_than_an_hour_blends_with_its_average_since_it_began(self) -> None:
        # Started 40 minutes ago at nothing spent; 10 of the 30 came in the last quarter hour.
        young = T0 + 5 * HOUR - 40 * MIN
        found = self.of(
            Short, forecast(five(30, young), [at(T0 - 15 * MIN, 20, young), at(T0, 30, young)], T0)
        )
        self.near(found.ratio, (((10 / 15 + 30 / 40) / 2) * 260) / 70)
        self.assertEqual(found.basis, Basis("blend", 40 * MIN, 15 * MIN))


class EvenLineTests(Case):
    def test_stands_at_the_share_of_the_window_still_to_run(self) -> None:
        # An hour into five: 80% of the time is left, so even spending leaves 80%.
        self.near(even_left(five(10), T0), 80)

    def test_says_how_long_to_rest_until_spending_is_back_on_it(self) -> None:
        # 40% spent with 4 h of 5 left: 60% left lines up with the even line 3 h before
        # the reset.
        self.assertEqual(wait_for_even(five(40), T0), HOUR)
        self.assertIsNone(wait_for_even(five(10), T0))


# 2% of the week left, running out at 13:24; the five-hour window at 36% left would last
# to 13:21 on its own, with its reset at 14:00.
NOW_14 = utc(2026, 10, 14, 9)
WEEKLY_14 = week(98, NOW_14 + 18 * HOUR)


class WeekHoldsFiveHourTests(Case):
    def test_a_week_running_out_first_caps_the_window(self) -> None:
        now = NOW_14
        session_forecast = Enough(0.8, now + 5 * HOUR, Basis("recent", 15 * MIN))
        week_forecast = Short(9, now + 18 * HOUR, now + 24 * MIN, Basis("recent", DAY))
        self.assertEqual(
            week_caps(five(64, now + 5 * HOUR), session_forecast, WEEKLY_14, week_forecast, now),
            Coupling(WEEKLY_14, now + 24 * MIN, spent=False),
        )

    def test_a_spent_week_caps_it_at_once_even_with_no_forecast_of_its_own(self) -> None:
        now = NOW_14
        spent_week = week(100, now + 18 * HOUR)
        self.assertEqual(
            week_caps(five(0, None), None, spent_week, forecast(spent_week, [], now), now),
            Coupling(spent_week, now, spent=True),
        )

    def test_a_week_lasting_longer_than_the_window_leaves_it_alone(self) -> None:
        now = NOW_14
        session = five(64, now + 5 * HOUR)
        session_forecast = Short(2, now + 5 * HOUR, now + HOUR, Basis("recent", 15 * MIN))
        week_forecast = Short(1.2, now + 18 * HOUR, now + 2 * HOUR, Basis("recent", DAY))
        self.assertIsNone(week_caps(session, session_forecast, WEEKLY_14, week_forecast, now))
        self.assertIsNone(week_caps(session, None, WEEKLY_14, None, now))
        self.assertIsNone(week_caps(session, None, None, week_forecast, now))

    def test_the_account_stops_at_the_first_plan_limit_never_a_models_own(self) -> None:
        now = NOW_14
        scoped = Window(WEEK, 100, now + 18 * HOUR, model="Fable")
        stops: list[tuple[Window, Forecast | None]] = [
            (five(64), Short(2, now + 5 * HOUR, now + HOUR, Basis("recent", 15 * MIN))),
            (WEEKLY_14, Short(9, now + 18 * HOUR, now + 24 * MIN, Basis("recent", DAY))),
            (scoped, Spent(now + 18 * HOUR)),
        ]
        self.assertEqual(first_stop(stops, now), Stop(WEEKLY_14, now + 24 * MIN))


# The week reset at 05:00, it was first read at 11:16 at 4%, and at 15:00 it stood at 11%.
# From the first reading the pace is 7 points in 3¾ hours, and stretched over the nights it
# ran the week out on Saturday at 14:16.
NOW_15 = utc(2026, 10, 15, 12)
YOUNG_RESET = NOW_15 - 10 * HOUR + 7 * DAY
YOUNG_READINGS = [weekly_at(NOW_15 - 225 * MIN, 4, YOUNG_RESET), weekly_at(NOW_15, 11, YOUNG_RESET)]


class YoungWeekTests(Case):
    def test_is_judged_from_its_reset_the_quiet_hours_before_the_first_reading_included(
        self,
    ) -> None:
        found = self.of(Short, forecast(week(11, YOUNG_RESET), YOUNG_READINGS, NOW_15))
        self.assertEqual(found.basis, Basis("window", 10 * HOUR))
        # 11 points in 10 hours: the 89 left last 80.9 hours, not 47.
        self.near(found.at, NOW_15 + (89 / 1.1) * HOUR, 1)

    def test_a_week_with_a_day_of_readings_keeps_the_last_days_pace(self) -> None:
        older = utc(2026, 10, 17, 12)
        readings = [
            weekly_at(older - 25 * HOUR, 20, YOUNG_RESET),
            weekly_at(older, 40, YOUNG_RESET),
        ]
        found = forecast(week(40, YOUNG_RESET), readings, older)
        self.assertIsInstance(found, Enough | Short)
        self.assertEqual(getattr(found, "basis", None), Basis("recent", DAY))


WEEK_RESET = NOW_15 + 48 * HOUR
SESSION_RESET = NOW_15 + HOUR
# Two seats of one organization, their five-hour windows resetting within ten minutes of
# each other, as one series held them until they were split. Seat X over the last hour:
FIVE_X = NOW_15 + HOUR
FIVE_Y = FIVE_X + 5 * MIN
WEEK_Y = NOW_15 + 38 * HOUR
SEAT_X = [
    at(NOW_15 - 60 * MIN, 10, FIVE_X),
    weekly_at(NOW_15 - 60 * MIN, 8, WEEK_RESET),
    at(NOW_15 - 30 * MIN, 35, FIVE_X),
    weekly_at(NOW_15 - 30 * MIN, 12, WEEK_RESET),
    at(NOW_15, 60, FIVE_X),
    weekly_at(NOW_15, 16, WEEK_RESET),
]
SEAT_Y = [
    at(NOW_15 - 55 * MIN, 40, FIVE_Y),
    weekly_at(NOW_15 - 55 * MIN, 4, WEEK_Y),
    at(NOW_15 - 25 * MIN, 65, FIVE_Y),
    weekly_at(NOW_15 - 25 * MIN, 7, WEEK_Y),
    at(NOW_15 - 5 * MIN, 90, FIVE_Y),
    weekly_at(NOW_15 - 5 * MIN, 10, WEEK_Y),
]
# 40 points of the week left, spent 2 an hour by the last day's pace: 20 hours on its own.
PACE = [weekly_at(NOW_15 - DAY, 12, WEEK_RESET), weekly_at(NOW_15, 60, WEEK_RESET)]


def weekly(percent: float) -> Window:
    return week(percent, WEEK_RESET)


class FiveHourHoldsWeekTests(Case):
    def test_one_point_of_the_window_costs_the_week_what_the_readings_show_rounded_up(
        self,
    ) -> None:
        # The window grew from 29 to 80 while the week went from 4 to 11: 8 points of the
        # week, one added for the server's rounding, for 51 of the window.
        samples = [
            at(NOW_15 - 4 * HOUR, 29, SESSION_RESET),
            weekly_at(NOW_15 - 4 * HOUR, 4, WEEK_RESET),
            at(NOW_15, 80, SESSION_RESET),
            weekly_at(NOW_15, 11, WEEK_RESET),
        ]
        self.near(window_cost(samples, weekly(11), NOW_15), 8 / 51)

    def test_too_little_window_growth_gives_no_cost_and_no_ceiling(self) -> None:
        samples = [
            at(NOW_15 - HOUR, 70, SESSION_RESET),
            weekly_at(NOW_15 - HOUR, 10, WEEK_RESET),
            at(NOW_15, 80, SESSION_RESET),
            weekly_at(NOW_15, 11, WEEK_RESET),
        ]
        self.assertIsNone(window_cost(samples, weekly(11), NOW_15))
        self.assertIsNone(ceiling_for(five(80, SESSION_RESET), weekly(11), samples, NOW_15))

    def test_one_seats_series_gives_that_seats_cost_and_the_two_together_another(self) -> None:
        # X alone: the window grew 50, the week 8, and one more for the rounding.
        self.near(window_cost(SEAT_X, weekly(16), NOW_15), 9 / 50)
        # Together the windows read as one: 10, 40, 65, 90 (X's 35 and 60 look stale), 80
        # of growth against a week of 8 to 12 by the last of them, and one more.
        self.near(window_cost(SEAT_X + SEAT_Y, weekly(16), NOW_15), 5 / 80)

    def test_one_seats_series_gives_that_seats_pace_and_the_two_together_end_it_early(
        self,
    ) -> None:
        window = five(60, FIVE_X)
        # X alone: from 35 at the reading in force a quarter hour ago to 60 is 100 an hour;
        # from 10 an hour ago, 50 an hour; the blend 75. With 40 left that is 32 minutes.
        found = self.of(Short, forecast(window, SEAT_X, NOW_15))
        self.near(found.ratio, 75 / 40)
        self.near(found.at, NOW_15 + 32 * MIN, 1)
        # Together Y's 90 reads as X's: 10 left. From 65 that is 100 an hour, from 10 it is
        # 80, the blend 90: under seven minutes, for a window with half an hour in it.
        mixed = self.of(Short, forecast(window, SEAT_X + SEAT_Y, NOW_15))
        self.near(mixed.at, NOW_15 + (10 / 90) * HOUR, 1)

    def test_a_pace_faster_than_the_window_lets_through_runs_out_when_it_allows(self) -> None:
        # The window has 20 left to its reset in an hour: 1 point of the week; then 5 a window.
        found = self.of(Short, forecast(weekly(60), PACE, NOW_15, Ceiling(20, SESSION_RESET, 0.05)))
        self.near(found.at, SESSION_RESET + (39 / 5) * 5 * HOUR, 1)
        self.assertEqual(self.of(Ceiling, found.held).cost, 0.05)

    def test_a_ceiling_low_enough_makes_the_week_last(self) -> None:
        found = forecast(weekly(60), PACE, NOW_15, Ceiling(20, SESSION_RESET, 0.03))
        # 0.6 points before the window resets, then 3 a window for 47 hours.
        self.near(self.of(Enough, found).ratio, (0.6 + (47 / 5) * 3) / 40)

    def test_a_spent_window_holds_the_week_until_it_resets(self) -> None:
        found = forecast(weekly(60), PACE, NOW_15, Ceiling(0, NOW_15 + 47 * HOUR, 0.2))
        self.near(self.of(Enough, found).ratio, (HOUR / (5 * HOUR)) * 20 / 40)

    def test_a_ceiling_above_the_pace_changes_nothing(self) -> None:
        self.assertEqual(
            forecast(weekly(60), PACE, NOW_15, Ceiling(100, NOW_15 + 5 * HOUR, 0.5)),
            forecast(weekly(60), PACE, NOW_15),
        )


# The month of credits ends at 00:00 UTC on 1 November.
MONTH_END = utc(2026, 11, 1)
CREDITS_WEEK_RESET = T0 + 10 * HOUR


def spent(moment: int, used: float, end: int = MONTH_END) -> SpendReading:
    return SpendReading(moment, used, end)


class UsageCreditsTests(Case):
    def test_nothing_is_paid_from_the_credits_while_no_plan_limit_is_spent(self) -> None:
        windows = [five(40), week(90, CREDITS_WEEK_RESET)]
        self.assertEqual(spend_forecast(windows, 44, 300, [], MONTH_END, T0), SpendIdle())
        # A model's own week does not stop the account.
        fable = Window(WEEK, 100, CREDITS_WEEK_RESET, model="Fable")
        self.assertEqual(spend_forecast([five(40), fable], 44, 300, [], MONTH_END, T0), SpendIdle())

    def test_a_spent_week_runs_the_credits_to_its_reset_at_the_last_hours_pace(self) -> None:
        # 40 $ an hour ago, 44 $ now: 4 $ an hour for the 10 hours to the week's reset.
        found = spend_forecast(
            [five(0), week(100, CREDITS_WEEK_RESET)],
            44,
            300,
            [spent(T0 - 2 * HOUR, 30), spent(T0 - HOUR, 40), spent(T0, 44)],
            MONTH_END,
            T0,
        )
        found = self.of(SpendEnough, found)
        self.assertEqual(found.until, CREDITS_WEEK_RESET)
        self.near(found.per_hour, 4)
        self.near(found.projected, 84)

    def test_a_pace_that_spends_the_cap_first_gives_the_time_it_runs_out(self) -> None:
        found = spend_forecast(
            [five(0), week(100, CREDITS_WEEK_RESET)],
            44,
            60,
            [spent(T0 - HOUR, 40), spent(T0, 44)],
            MONTH_END,
            T0,
        )
        found = self.of(SpendShort, found)
        self.near(found.at, T0 + 4 * HOUR)

    def test_the_forecast_stops_at_the_months_end_where_the_credits_start_over(self) -> None:
        late = MONTH_END - 3 * HOUR
        found = spend_forecast(
            [five(100, MONTH_END + HOUR)],
            44,
            300,
            [spent(late - HOUR, 40), spent(late, 44)],
            MONTH_END,
            late,
        )
        found = self.of(SpendEnough, found)
        self.assertEqual(found.until, MONTH_END)

    def test_readings_of_the_last_month_and_too_short_a_span_give_no_pace(self) -> None:
        october = utc(2026, 10, 1)
        found = spend_forecast(
            [five(100)],
            5,
            300,
            [spent(T0 - 2 * HOUR, 280, october), spent(T0 - 5 * MIN, 4)],
            MONTH_END,
            T0,
        )
        self.assertEqual(found, SpendUnknown(RESET))


class EnoughHistoryTests(Case):
    """No forecast while the window holds less history than its pace needs: five minutes
    for the five-hour window, an hour since the reset for a week."""

    def test_a_five_hour_window_needs_five_minutes_since_it_began(self) -> None:
        short_of_it = T0 + 5 * HOUR - (5 * MIN - 1)
        self.assertIsNone(forecast(five(2, short_of_it), [], T0))
        self.assertIsNone(outlook(five(2, short_of_it), [], T0))
        just = T0 + 5 * HOUR - 5 * MIN
        found = self.of(Short, forecast(five(2, just), [], T0))
        self.assertEqual(found.basis, Basis("window", 5 * MIN))

    def test_a_week_needs_an_hour_since_its_reset_however_many_readings(self) -> None:
        short_of_it = T0 + WEEK - (HOUR - 1)
        readings = [weekly_at(T0 - 50 * MIN, 1, short_of_it), weekly_at(T0, 3, short_of_it)]
        self.assertIsNone(forecast(week(3, short_of_it), readings, T0))
        self.assertIsNone(outlook(week(3, short_of_it), readings, T0))
        just = T0 + WEEK - HOUR
        found = forecast(week(3, just), [weekly_at(T0, 3, just)], T0)
        found = self.of(Short, found)
        self.assertEqual(found.basis, Basis("window", HOUR))

    def test_a_reading_that_says_spent_spends_the_window(self) -> None:
        # The window still says 99, a later reading 100: nothing is left to divide by.
        self.assertEqual(forecast(five(99), [at(T0 - 15 * MIN, 90), at(T0, 100)], T0), Spent(RESET))


class OutlookTests(Case):
    """The five-hour window keeps its point answer and may alert; a week is a range of the
    paces the forecast has for it and may not."""

    def test_the_five_hour_window_says_whether_it_runs_out_before_its_reset(self) -> None:
        faster = [at(T0 - 15 * MIN, 14.5), at(T0, 20)]
        found = self.of(FiveHourOutlook, outlook(five(20), faster, T0))
        self.assertEqual(found, FiveHourOutlook(self.of(Short, forecast(five(20), faster, T0))))
        self.assertTrue(found.alert_eligible)
        self.assertTrue(found.exhausted_before_reset)
        slower = self.of(
            FiveHourOutlook, outlook(five(20), [at(T0 - 15 * MIN, 15.5), at(T0, 20)], T0)
        )
        self.assertFalse(slower.exhausted_before_reset)
        spent_window = self.of(FiveHourOutlook, outlook(five(100), [], T0))
        self.assertTrue(spent_window.exhausted_before_reset)

    def week_range(self, found: object) -> WeekRange:
        week_range = self.of(WeekRange, found)
        self.assertFalse(week_range.alert_eligible)
        return week_range

    def test_a_week_with_a_day_of_readings_ranges_from_its_average_to_its_last_day(
        self,
    ) -> None:
        # 60 spent in the 120 hours since the reset, 48 of it in the last day; 48 hours left.
        # The average, half a point an hour, comes to 84 by the reset; the last day's two an
        # hour to 156.
        found = self.week_range(outlook(weekly(60), PACE, NOW_15))
        self.near(found.low, 60 + 0.5 * 48)
        self.near(found.high, 60 + 2 * 48)
        self.assertEqual(found.resets_at, WEEK_RESET)
        self.assertEqual(
            [one.basis for one in found.estimates if isinstance(one, Enough | Short)],
            [Basis("recent", DAY), Basis("window", 120 * HOUR)],
        )
        self.assertIn(forecast(weekly(60), PACE, NOW_15), found.estimates)

    def test_a_week_younger_than_a_day_has_only_its_average(self) -> None:
        # 11 points in 10 hours, 158 hours to the reset.
        found = self.week_range(outlook(week(11, YOUNG_RESET), YOUNG_READINGS, NOW_15))
        self.near(found.low, 11 + 1.1 * 158)
        self.near(found.high, 11 + 1.1 * 158)
        self.assertEqual(
            found.estimates, (forecast(week(11, YOUNG_RESET), YOUNG_READINGS, NOW_15),)
        )

    def test_the_five_hour_ceiling_holds_each_end_it_reaches(self) -> None:
        # The window lets through 1 point before its reset in an hour and 5 a window for the
        # 47 hours after it: 48. The last day's 96 is held to that; the average's 24 is not.
        ceiling = Ceiling(20, SESSION_RESET, 0.05)
        found = self.week_range(outlook(weekly(60), PACE, NOW_15, ceiling))
        self.near(found.low, 60 + 24)
        self.near(found.high, 60 + 1 + (47 / 5) * 5)
        self.assertIn(forecast(weekly(60), PACE, NOW_15, ceiling), found.estimates)

    def test_a_spent_week_is_a_range_at_its_end(self) -> None:
        found = self.week_range(outlook(weekly(100), [], NOW_15))
        self.assertEqual((found.low, found.high), (100, 100))
        self.assertEqual(found.estimates, (Spent(WEEK_RESET),))


if __name__ == "__main__":
    unittest.main()
