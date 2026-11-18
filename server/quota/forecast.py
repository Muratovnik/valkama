"""How fast a quota window is being spent, and whether it lasts to its reset.

Pure and standard-library only: every function takes readings and a moment and returns a
value, so nothing here reads the store, the clock or a source. Times are integer
milliseconds since the epoch, spans are milliseconds, and a window's use is a percent of
it; a caller holding another unit converts at its own boundary.

The input is this module's own: a `Reading` is one sample of one window series (when it
was read, the percent spent, the reset it named and the length of the window), and a
`Window` is where a window stands now. A series is told apart by its window length, so a
caller passes one account's readings and never two series of one length together: the
all-models week and a model's own week are both a week long, and mixed they would read as
one series.

What each window's pace looks back over:

- The five-hour window blends the last quarter hour with the last hour, so a burst shows
  at once, but a few heavy answers after a pause do not alone call the window short.
- A week is judged by its last day, since a quarter hour of work stretched over days would
  leave out every pause. Until its readings reach a day back it is judged from its reset,
  the quiet hours before the first reading included: a morning's work stretched over the
  nights would run the week out days early.

No forecast is given while a window holds less history than its pace needs:
`MIN_HISTORY_FIVE_HOURS` since the window began, or of readings, for the five-hour window,
and `MIN_HISTORY_WEEK` since the reset for a week.

Where a window's count restarted inside it (see below), the window begins again for its pace
at the restart, from the share the restarting reading names: its average and its history run
from there, since what was spent before it no longer counts toward the reset.

`forecast` is the point estimate for either window. `outlook` is what a threshold or a
page asks for, and it decides what may raise an alert:

- The five-hour window keeps the point answer, whether it is exhausted before its reset,
  and is eligible for alerts.
- A week is a range and is never eligible for alerts, because its point estimate is not
  accurate enough to warn on and no better method has been chosen. The range is made of
  the paces `forecast` already has for a week, with no new method: the last day's pace,
  when the readings reach a day back, and the average since the reset, each held to the
  five-hour ceiling when one is given. Its ends are the share of the week each pace would
  have spent by the reset, so above 100 means the week runs out first. Before a day of
  readings only the average exists, and the range is that one value.

Where a reading reports the window spent although the window itself does not, the window
is spent: the arithmetic would otherwise divide by what is left, which is nothing.

Which readings a window's count trusts (`count`). A window's readings come from several
feeds -- a feed is what `seats` calls one: the samples one identity (a session, or an
organization's poll and imports) made of one window -- and a feed that has not read for a
while still holds its last value. So a reading lower than one before it is, as a rule, a
stale one and is left out. The exception is a feed that falls by `RESTART_FALL` points or
more below its own previous reading of the same window, and as far below the count: the
source then reports a counter that was zeroed inside the window, its reset unchanged, and
the count restarts from that reading. A forecast that kept the window's earlier top would
read the rest of the window from what no longer counts. What zeroed the counter cannot be
told from the readings, so nothing here names a cause.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Hashable, Iterable, Sequence
from dataclasses import dataclass
from typing import ClassVar, Literal, Protocol, TypeAlias, TypeVar

MIN = 60_000
HOUR = 60 * MIN
FIVE_HOURS = 5 * HOUR
WEEK = 7 * 24 * HOUR

#: The least history a forecast needs: the time since the window began, or the span of its
#: readings, for the five-hour window; the time since the reset for a week.
MIN_HISTORY_FIVE_HOURS = 5 * MIN
MIN_HISTORY_WEEK = HOUR

#: Two resets this close are one window: the server's reset times jitter by fractions of a
#: second, and the plan's own rounding is ten minutes.
RESET_SLACK = 10 * MIN

#: How far a feed's reading must fall below its own previous one, and below the count, for the
#: window's count to restart there (`count`). A provider's percent wobbles by a point between
#: two readings, and a source rounds to whole points, so a small fall is noise; a counter
#: zeroed inside its window falls by most of what was spent. Ten points is ten times the
#: wobble, and a zeroing it misses leaves the count at most ten points high until the
#: readings pass it again.
RESTART_FALL = 10

#: Below this many points of five-hour growth the window's cost to the week is too coarse
#: to trust, and there is no ceiling.
COST_MIN_SPAN = 20

#: The credits' pace looks back an hour, and needs a quarter hour of readings without one.
SPEND_LOOKBACK = HOUR
SPEND_MIN_SPAN = 15 * MIN


@dataclass(frozen=True, slots=True)
class Reading:
    """One sample of one window series."""

    at: int
    percent: float
    #: The reset the sample named; `None` when the window had not started.
    resets_at: int | None
    window_length: int
    #: The feed the sample belongs to (see the module); `None` where it is not known, and a
    #: reading of no known feed never restarts the count.
    feed: Hashable | None = None


@dataclass(frozen=True, slots=True)
class Window:
    """Where one window stands now."""

    length: int
    percent: float
    #: `None`: the window has not started, so the server gives no reset.
    resets_at: int | None
    #: The model a window of one model's own is for; `None` for a plan limit.
    model: str | None = None


@dataclass(frozen=True, slots=True)
class SpendReading:
    """One sample of the usage credits spent this month."""

    at: int
    used: float
    month_end: int


@dataclass(frozen=True, slots=True)
class Basis:
    """What a pace was measured over.

    `recent`: the readings of a recent span; `blend`: the mean of that pace (over
    `recent`) and a longer one (over `span`); `window`: the average since the window
    began, before enough readings.
    """

    kind: Literal["recent", "window", "blend"]
    span: int
    recent: int | None = None


@dataclass(frozen=True, slots=True)
class Ceiling:
    """What the five-hour window lets a week spend.

    A week is spent only through five-hour windows: until the current window resets the
    week can grow by no more than what is left of that window, and after it by no more
    than a whole window every five hours. `cost`: points of the week that one point of the
    window takes (see `window_cost`).
    """

    left: float
    resets_at: int
    cost: float


@dataclass(frozen=True, slots=True)
class Enough:
    """The window lasts to its reset at this pace.

    `ratio`: what the pace spends by the reset over what is left. `reached`: the share of the
    window spent by the reset, a percent no higher than 100. `held`: the five-hour ceiling held
    the pace back, so the result is the ceiling's.
    """

    ratio: float
    resets_at: int
    basis: Basis
    reached: float
    held: Ceiling | None = None


@dataclass(frozen=True, slots=True)
class Short:
    """The window runs out at `at`, before its reset; `ratio` is above 1, and `reached`, the
    share of the window the pace would have spent by the reset, above 100."""

    ratio: float
    resets_at: int
    at: float
    basis: Basis
    reached: float
    held: Ceiling | None = None


@dataclass(frozen=True, slots=True)
class Spent:
    """The window is spent until its reset."""

    resets_at: int


Forecast: TypeAlias = Enough | Short | Spent


@dataclass(frozen=True, slots=True)
class FiveHourOutlook:
    """The five-hour window's point answer, the one its alert reads."""

    forecast: Forecast
    alert_eligible: ClassVar[bool] = True

    @property
    def exhausted_before_reset(self) -> bool:
        """Whether the window runs out before it resets, or is spent already."""

        return isinstance(self.forecast, Short | Spent)


@dataclass(frozen=True, slots=True)
class WeekRange:
    """A week's forecast as a range: the share of the week spent by its reset.

    `low` and `high` are percents of the week and may pass 100, which means the week runs
    out before its reset at that pace. `estimates` are the point estimates they come from.
    """

    resets_at: int
    low: float
    high: float
    estimates: tuple[Forecast, ...]
    alert_eligible: ClassVar[bool] = False


Outlook: TypeAlias = FiveHourOutlook | WeekRange


@dataclass(frozen=True, slots=True)
class Coupling:
    """A week that stops the five-hour window before it would stop on its own."""

    by: Window
    at: float
    spent: bool


@dataclass(frozen=True, slots=True)
class Stop:
    """The plan limit an account meets first, and when."""

    window: Window
    at: float


@dataclass(frozen=True, slots=True)
class SpendIdle:
    """No plan limit is spent: nothing is paying from the credits now."""


@dataclass(frozen=True, slots=True)
class SpendUnknown:
    """Spending until `until`, with too few readings yet for a pace."""

    until: int


@dataclass(frozen=True, slots=True)
class SpendEnough:
    """At this pace the credits spent by `until` come to `projected`, within the cap."""

    until: int
    projected: float
    per_hour: float
    span: int


@dataclass(frozen=True, slots=True)
class SpendShort:
    """At this pace the month's cap is spent at `at`, before `until`."""

    until: int
    at: float
    per_hour: float
    span: int


SpendForecast: TypeAlias = SpendIdle | SpendUnknown | SpendEnough | SpendShort


@dataclass(frozen=True, slots=True)
class _Group:
    lookback: int
    min_history: int
    #: The longer half of a blended pace.
    steady: int | None = None
    #: Judged from the reset, not from the first reading, until a reading is `lookback` old.
    from_reset: bool = False


_GROUPS: dict[int, _Group] = {
    FIVE_HOURS: _Group(lookback=15 * MIN, min_history=MIN_HISTORY_FIVE_HOURS, steady=HOUR),
    WEEK: _Group(lookback=24 * HOUR, min_history=MIN_HISTORY_WEEK, from_reset=True),
}

#: How old a series' latest reading may be and still say how fast its window is being
#: spent now: the five-hour pace's own recent span. Samples are kept only when a value
#: changed, so the latest one says when the window last moved; one older than this is
#: silent. Alerts raise nothing on a silent series, and a page says it is silent.
FRESH_FOR = _GROUPS[FIVE_HOURS].lookback


def fresh(at: int, now: int) -> bool:
    """Whether a reading made at `at` is fresh at `now` (`FRESH_FOR`)."""

    return now - at <= FRESH_FOR


class _Timed(Protocol):
    @property
    def at(self) -> int: ...


_T = TypeVar("_T", bound=_Timed)


def same_window(a: int | None, b: int | None) -> bool:
    """Whether two resets name one window, an unknown reset matching any."""

    return a is None or b is None or abs(a - b) <= RESET_SLACK


def _rising(points: Iterable[_T], value: Callable[[_T], float]) -> list[_T]:
    """Oldest first, without a point that reads lower than an earlier one or repeats it.

    The credits spent in a month are read here as one series that never falls, a lower
    reading a stale one: their readings name no feed, so one feed's fall could not be told
    from another feed's stale value, as `count` tells them apart for a window.
    """

    kept: list[_T] = []
    for one in sorted(points, key=lambda point: point.at):
        if kept:
            last = kept[-1]
            if value(one) < value(last) or (one.at == last.at and value(one) == value(last)):
                continue
        kept.append(one)
    return kept


@dataclass(frozen=True, slots=True)
class Count:
    """One window's readings as the forecast trusts them, and where its count restarted.

    `readings`: oldest first, from the latest restart on, none lower than an earlier one.
    `restarts`: the moment of each restart, oldest first; empty where the count never did.
    """

    readings: list[Reading]
    restarts: list[int]


def _restarts_at(one: Reading, before: Reading | None, top: Reading) -> bool:
    """Whether `one` restarts the count: it falls `RESTART_FALL` or more below its own feed's
    previous reading `before`, both naming a reset, and as far below the count's `top`."""

    return (
        before is not None
        and one.resets_at is not None
        and before.resets_at is not None
        and one.percent <= before.percent - RESTART_FALL
        and one.percent <= top.percent - RESTART_FALL
    )


def count(readings: Iterable[Reading], window_length: int, resets_at: int | None) -> Count:
    """One window's readings, only this window's, as the forecast trusts them (see the
    module): a reading lower than the count is a stale one and left out, unless it is its own
    feed's fall of `RESTART_FALL` or more, from which the count starts again."""

    kept: list[Reading] = []
    restarts: list[int] = []
    previous: dict[Hashable, Reading] = {}
    for one in sorted(
        (
            one
            for one in readings
            if one.window_length == window_length and same_window(one.resets_at, resets_at)
        ),
        key=lambda one: one.at,
    ):
        before = None if one.feed is None else previous.get(one.feed)
        if one.feed is not None:
            previous[one.feed] = one
        if kept and _restarts_at(one, before, kept[-1]):
            kept = [one]
            restarts.append(one.at)
            continue
        if kept:
            last = kept[-1]
            if one.percent < last.percent or (one.at == last.at and one.percent == last.percent):
                continue
        kept.append(one)
    return Count(kept, restarts)


def settle(readings: Iterable[Reading], window_length: int, resets_at: int | None) -> list[Reading]:
    """One window's readings as the forecast trusts them (`count`): oldest first, from the
    latest restart of its count on, and none that reads lower than an earlier one."""

    return count(readings, window_length, resets_at).readings


def _last_by(points: Sequence[_T], moment: float) -> _T | None:
    """The latest of time-ordered points read at or before `moment`."""

    for one in reversed(points):
        if one.at <= moment:
            return one
    return None


@dataclass(frozen=True, slots=True)
class _State:
    group: _Group
    readings: list[Reading]
    spent: float
    #: Since the window began for its pace: its start, or its count's latest restart.
    elapsed: int
    resets_at: int
    #: The share spent where it began: nothing at its start, the restarting reading's share.
    base: float = 0.0


def _state(window: Window, readings: Iterable[Reading], now: int) -> _State | Spent | None:
    group = _GROUPS.get(window.length)
    if group is None or window.resets_at is None:
        return None
    resets_at = window.resets_at
    if resets_at - now <= 0:
        return None
    if window.percent >= 100:
        return Spent(resets_at)
    counted = count(readings, window.length, resets_at)
    series = counted.readings
    spent = max(window.percent, series[-1].percent if series else 0)
    if spent >= 100:
        return Spent(resets_at)
    if counted.restarts:
        # The count's first reading is the one that restarted it.
        began, base = series[0].at, series[0].percent
        return _State(group, series, spent, now - began, resets_at, base)
    return _State(group, series, spent, now - (resets_at - window.length), resets_at)


def _steady_base(state: _State, steady: int, now: int) -> tuple[float, int] | None:
    """Where the window stood the longer span ago, for the steady half of a blended pace:
    the reading in force then; else, for a window younger than that span, where it began
    (`_State.base`); else the oldest reading, when it reaches past the recent span."""

    far = _last_by(state.readings, now - steady)
    if far is not None:
        return far.percent, steady
    recent = state.group.lookback
    if recent < state.elapsed < steady:
        return state.base, state.elapsed
    if state.readings and now - state.readings[0].at > recent:
        first = state.readings[0]
        return first.percent, now - first.at
    return None


def _recent_pace(state: _State, now: int) -> tuple[float, Basis] | None:
    """The pace since the reading in force a lookback ago, blended where the window blends."""

    group = state.group
    before = _last_by(state.readings, now - group.lookback)
    if before is None:
        return None
    per_ms = max(0, state.spent - before.percent) / group.lookback
    basis = Basis("recent", group.lookback)
    if group.steady is not None:
        steady = _steady_base(state, group.steady, now)
        if steady is not None:
            percent, span = steady
            per_ms = (per_ms + max(0, state.spent - percent) / span) / 2
            basis = Basis("blend", span, recent=group.lookback)
    return per_ms, basis


def _window_pace(state: _State) -> tuple[float, Basis] | None:
    """The average since the window began, or its count restarted, once it is old enough."""

    if state.elapsed < state.group.min_history:
        return None
    return max(0, state.spent - state.base) / state.elapsed, Basis("window", state.elapsed)


def _pace(state: _State, now: int) -> tuple[float, Basis] | None:
    recent = _recent_pace(state, now)
    if recent is not None:
        return recent
    group = state.group
    if not group.from_reset and state.readings:
        first = state.readings[0]
        if now - first.at >= group.min_history:
            span = now - first.at
            return max(0, state.spent - first.percent) / span, Basis("recent", span)
    return _window_pace(state)


def _ceiling_growth(ceiling: Ceiling, moment: float) -> float:
    """The most a week can grow by `moment` under the ceiling."""

    return (
        ceiling.left * ceiling.cost
        + (max(0, moment - ceiling.resets_at) / FIVE_HOURS) * 100 * ceiling.cost
    )


def _ceiling_reaches(ceiling: Ceiling, points: float, now: int) -> float:
    """The earliest the ceiling lets the week spend `points`."""

    if points <= ceiling.left * ceiling.cost:
        return now
    return (
        max(now, ceiling.resets_at)
        + ((points - ceiling.left * ceiling.cost) / (100 * ceiling.cost)) * FIVE_HOURS
    )


def _judge(
    state: _State, pace: tuple[float, Basis], now: int, ceiling: Ceiling | None
) -> Enough | Short:
    """Whether a pace lasts to the reset, and the share of the window it spends by then. It
    runs to now, not to the last reading, so a quiet stretch lowers it."""

    per_ms, basis = pace
    resets_at = state.resets_at
    remaining = 100 - state.spent
    paced = per_ms * (resets_at - now)
    if ceiling is not None and ceiling.cost > 0 and _ceiling_growth(ceiling, resets_at) < paced:
        ratio = _ceiling_growth(ceiling, resets_at) / remaining
        reached = state.spent + ratio * remaining
        if ratio < 1:
            return Enough(ratio, resets_at, basis, reached, held=ceiling)
        at = max(now + remaining / per_ms, _ceiling_reaches(ceiling, remaining, now))
        return Short(ratio, resets_at, at, basis, reached, held=ceiling)
    ratio = paced / remaining
    reached = state.spent + ratio * remaining
    if ratio <= 1:
        return Enough(ratio, resets_at, basis, reached)
    return Short(ratio, resets_at, now + remaining / per_ms, basis, reached)


def forecast(
    window: Window, readings: Iterable[Reading], now: int, ceiling: Ceiling | None = None
) -> Forecast | None:
    """The point estimate for one window, or `None` for an unknown window, an unknown or
    passed reset, or too little history.

    `ceiling` holds a week to what the five-hour window lets through (see `ceiling_for`).
    """

    state = _state(window, readings, now)
    if not isinstance(state, _State):
        return state
    pace = _pace(state, now)
    if pace is None:
        return None
    return _judge(state, pace, now, ceiling)


def outlook(
    window: Window, readings: Iterable[Reading], now: int, ceiling: Ceiling | None = None
) -> Outlook | None:
    """What a threshold or a page reads: the five-hour window's point answer, eligible for
    alerts, or a week's range, which is not. `None` where `forecast` gives none."""

    if window.length != WEEK:
        found = forecast(window, readings, now, ceiling)
        return None if found is None else FiveHourOutlook(found)
    state = _state(window, readings, now)
    if state is None:
        return None
    if isinstance(state, Spent):
        return WeekRange(state.resets_at, 100.0, 100.0, (state,))
    # A week's `_pace` is one of these two, so the range is empty exactly where
    # `forecast` gives no answer.
    paces = [one for one in (_recent_pace(state, now), _window_pace(state)) if one is not None]
    if not paces:
        return None
    estimates = tuple(_judge(state, pace, now, ceiling) for pace in paces)
    reached = [one.reached for one in estimates]
    return WeekRange(state.resets_at, min(reached), max(reached), estimates)


def window_cost(readings: Sequence[Reading], week: Window, now: int) -> float | None:
    """How many points of a week one point of the five-hour window takes, from this week's
    readings: the growth of each five-hour window set against the week's growth over the
    same span.

    The server rounds both to whole points, so each window's share of the week is taken
    one point up: the ceiling errs high and never warns early. Below `COST_MIN_SPAN` points
    of window growth there is no cost.
    """

    if week.length not in _GROUPS or week.resets_at is None:
        return None
    week_readings = settle(readings, week.length, week.resets_at)
    start = week.resets_at - week.length
    sessions = sorted(
        (
            one
            for one in readings
            if one.window_length == FIVE_HOURS
            and one.resets_at is not None
            and start <= one.at <= now
        ),
        key=lambda one: one.at,
    )
    window_growth = 0.0
    week_growth = 0.0
    seen: list[int] = []
    for one in sessions:
        reset = one.resets_at
        if reset is None or any(same_window(other, reset) for other in seen):
            continue
        seen.append(reset)
        series = settle(sessions, FIVE_HOURS, reset)
        if not series:
            continue
        first, last = series[0], series[-1]
        from_week = _last_by(week_readings, first.at)
        to_week = _last_by(week_readings, last.at)
        if from_week is None or to_week is None or last.percent <= first.percent:
            continue
        window_growth += last.percent - first.percent
        week_growth += to_week.percent - from_week.percent + 1
    return week_growth / window_growth if window_growth >= COST_MIN_SPAN else None


def ceiling_for(
    session: Window | None, week: Window, readings: Sequence[Reading], now: int
) -> Ceiling | None:
    """The ceiling the five-hour window puts on a week, when its cost is known. A window not
    started yet is whole, and starts with the next request."""

    if session is None or week.length != WEEK:
        return None
    cost = window_cost(readings, week, now)
    if cost is None:
        return None
    if session.resets_at is None:
        return Ceiling(100, now + FIVE_HOURS, cost)
    return Ceiling(max(0, 100 - session.percent), session.resets_at, cost)


def even_left(window: Window, now: int) -> float | None:
    """Where the even spend stands now, as the share left: a window spent evenly to its
    reset has as much left as it has time left. Left below it is spending ahead of the
    line."""

    if window.length not in _GROUPS or window.resets_at is None:
        return None
    return max(0, min(100, ((window.resets_at - now) / window.length) * 100))


def wait_for_even(window: Window, now: int) -> float | None:
    """How long to wait, spending nothing, until the even line comes down to what is left."""

    if window.length not in _GROUPS or window.resets_at is None:
        return None
    left = 100 - window.percent
    even_at = window.resets_at - (left / 100) * window.length
    return even_at - now if even_at > now else None


def _stops_at(found: Forecast | None, now: int) -> float | None:
    """The moment a forecast stops the account: when a short window runs out, or now for a
    spent one."""

    if isinstance(found, Short):
        return found.at
    if isinstance(found, Spent):
        return now
    return None


def week_caps(
    session: Window,
    session_forecast: Forecast | None,
    week: Window | None,
    week_forecast: Forecast | None,
    now: int,
) -> Coupling | None:
    """The week's stop, when it comes before the five-hour window would stop on its own and
    before that window resets: the five-hour window cannot outlast the week."""

    if week is None:
        return None
    week_stop = _stops_at(week_forecast, now)
    if week_stop is None:
        return None
    session_end = _stops_at(session_forecast, now)
    if session_end is None:
        session_end = session.resets_at if session.resets_at is not None else math.inf
    if week_stop < session_end:
        return Coupling(week, week_stop, isinstance(week_forecast, Spent))
    return None


def first_stop(forecasts: Iterable[tuple[Window, Forecast | None]], now: int) -> Stop | None:
    """The plan limit the account meets first, for the account's headline; a model's own
    window never stops the account."""

    found: Stop | None = None
    for window, one in forecasts:
        if window.model is not None:
            continue
        at = _stops_at(one, now)
        if at is not None and (found is None or at < found.at):
            found = Stop(window, at)
    return found


def spend_forecast(
    windows: Iterable[Window],
    used: float,
    limit: float | None,
    readings: Iterable[SpendReading],
    month_end: int,
    now: int,
) -> SpendForecast:
    """The usage credits ahead.

    Credits are spent only while a plan limit is, the five-hour window or the all-models
    week at 100%. So the forecast runs to the latest reset among those spent limits, or to
    the month's end if that comes first, at the pace of the last hour.
    """

    stops = [
        window.resets_at
        for window in windows
        if window.model is None
        and window.length in _GROUPS
        and window.percent >= 100
        and window.resets_at is not None
        and window.resets_at > now
    ]
    if not stops:
        return SpendIdle()
    until = min(max(stops), month_end)
    series = _rising(
        (one for one in readings if same_window(one.month_end, month_end)), lambda one: one.used
    )
    spent = max(used, series[-1].used if series else 0)
    before = _last_by(series, now - SPEND_LOOKBACK)
    start = before
    if start is None and series and now - series[0].at >= SPEND_MIN_SPAN:
        start = series[0]
    if start is None:
        return SpendUnknown(until)
    span = SPEND_LOOKBACK if before is not None else now - start.at
    per_ms = max(0, spent - start.used) / span
    per_hour = per_ms * HOUR
    if limit is not None and per_ms > 0 and spent + per_ms * (until - now) >= limit:
        return SpendShort(until, now + max(0, limit - spent) / per_ms, per_hour, span)
    return SpendEnough(until, spent + per_ms * (until - now), per_hour, span)
