"""Warning the owner before a subscription quota window runs out.

The levels. A week -- the all-models week, and each model's own week where a source
reports one -- alerts at 75 % and at 90 % spent. The five-hour window alerts when its
forecast says it runs out before its reset: only `forecast.outlook` decides that, and only
an answer that is `alert_eligible`. A week's outlook is a range and never eligible, so a
week alerts on what was spent alone, and its forecast is never asked. One call of the
forecast takes one series: the five-hour readings of one account, never a week beside
them, each with its feed, so a counter zeroed inside the window restarts the count the
forecast reads rather than leaving its earlier top in force (`forecast.count`).

Whose window. A reading of a session (`statusline`, `mod`) names no organization: it is
the one the session's usage rows say it worked for at the reading's moment
(`seats.organization_at`), which the listener's transcript reader learns from the
session's `credential_org`. Until the reader has got that far the reading belongs to
nobody and is passed over, and the evaluation after the reader's next pass takes it up.
A reading with no seat, or whose organization is not known, raises nothing: there is no
account to warn about. The account is the organization and the seat: a seat names one
account of its organization for the week it names, whether its UUID is known
(`seats.account_of_seat`) or the seat is still provisional, so the key holds when the UUID
turns up later. The toast says the name the owner gave the organization's account
(`quota.names`), and where there is none it says no name at all.

Freshness. Samples are kept only when a value changed (`quota.samples`), so a series'
latest sample says when it last moved. One older than `forecast.FRESH_FOR` raises
nothing. That span is the five-hour forecast's own recent pace (the quarter hour `forecast` blends with
the hour): a reading past it says nothing of how fast the window is being spent now. It
is also fifteen of the reader's passes (`housekeeping.USAGE_PAUSE_SECONDS`), so a reading
that waited for its organization is still fresh at the pass that finds it. A window
spent in a quiet stretch is not lost: its next reading is fresh and finds the level not
yet given.

The key. An alert given is a row of `quota_alerts`: the account, the window, the reset it
named, the level and the sample it was given on, written in the transaction that decides
it, so a new process does not give it again. Two resets within `forecast.RESET_SLACK` are
one window, as the forecast reads them; a new reset starts the levels again. A reading
that reaches 90 % before 75 % was given gives the 90 % alert alone and keeps both levels.
Where the owner turned quota alerts off nothing is kept, so turning them on warns of a
level still fresh.

A counter zeroed inside the window starts the levels again too: a level given on a sample
before the latest restart of the window's count (`forecast.count`) counts as not given, so
the climb after it warns again, once, and the key takes the sample it was given on anew.
Only a feed's own fall of `forecast.RESTART_FALL` restarts the count; another feed's stale
lower reading and a wobble of a point do not. The five-hour series holds its whole window.
A week's reaches back five hours only, so where a level the fresh readings reach was given
already, the week's samples since its start are read once for the pass -- one range of
`quota_samples` by its `at` index, of the week kinds, every account's, up to seven days and
the reset slack, rows kept only where a value changed, and a session's sample one indexed
lookup of its organization (`seats.organization_at`) -- to find its restarts; the week
alerts on the fresh readings from its latest restart on.

Where it runs: in the listener, after each pass of its usage reader (`housekeeping`),
which runs under autostart with no window open. A toast goes through `alerts.emit`, and no
page silences it: being on a page is no sign of having seen the quota.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass

from ..ops import toast
from ..quota import forecast, names, samples, seats
from ..quota import store as quota_store
from . import emit, messages
from . import settings as alert_settings

#: The share of a week spent that alerts, lowest first.
WEEK_LEVELS = ("75", "90")
EXHAUSTED = "exhausted"
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
_WEEKS = ("week", "week_model")


def _millis(text: str) -> int:
    """A stored time as the forecast takes it: whole milliseconds since the epoch."""

    return (dt.datetime.fromisoformat(text) - _EPOCH) // dt.timedelta(milliseconds=1)


@dataclass(frozen=True)
class _Sample:
    """One sample whose account is known."""

    at: str
    organization: str
    seat: str
    account_uuid: str | None
    kind: str
    model: str
    percent: float
    resets_at: str
    #: The feed it belongs to (`seats.AccountSample.feed`), which the forecast reads.
    feed: str

    @property
    def series(self) -> tuple[str, str, str, str]:
        return (self.organization, self.seat, self.kind, self.model)


@dataclass(frozen=True)
class _Due:
    """A window at a level, before the key says whether it was given already.

    `levels` are every level the window has reached, lowest first; the toast is about the
    last. `runs_out_at` is when the five-hour window runs out, `None` when it is spent.
    `restarted` is the moment the window's count last restarted, `None` where it never did:
    a level given on a sample before it counts as not given.
    """

    sample: _Sample
    levels: tuple[str, ...]
    runs_out_at: float | None = None
    restarted: int | None = None


def _known(
    conn: sqlite3.Connection, since: str, kinds: tuple[str, ...] = quota_store.ALERT_KINDS
) -> list[_Sample]:
    """The samples of the windows of `kinds` since `since`, oldest first, whose account is
    known: each of them with a seat, a percent and a reset."""

    return [
        _Sample(
            one.at,
            one.organization,
            one.seat,
            one.account_uuid,
            one.kind,
            one.model or "",
            one.percent,
            one.resets_at,
            one.feed,
        )
        for one in seats.account_samples(conn, since, kinds)
        if one.seat is not None and one.percent is not None and one.resets_at is not None
    ]


def _readings(series: Iterable[_Sample], length: int) -> list[forecast.Reading]:
    """A series as the forecast reads it, each reading with its feed."""

    return [
        forecast.Reading(_millis(one.at), one.percent, _millis(one.resets_at), length, one.feed)
        for one in series
    ]


def _restarted(series: Iterable[_Sample], length: int, resets_at: str) -> int | None:
    """The moment the count of the window resetting at `resets_at` last restarted
    (`forecast.count`), `None` where it never did."""

    restarts = forecast.count(_readings(series, length), length, _millis(resets_at)).restarts
    return restarts[-1] if restarts else None


def _week_due(
    series: list[_Sample], now: int, stamp: str, restarted: int | None = None
) -> _Due | None:
    """The week at the levels its fresh readings reach, from `restarted` on where its count
    restarted."""

    fresh = [
        one
        for one in series
        if forecast.fresh(_millis(one.at), now)
        and one.resets_at > stamp
        and (restarted is None or _millis(one.at) >= restarted)
    ]
    if not fresh:
        return None
    top = max(fresh, key=lambda one: (one.percent, one.at))
    reached = tuple(level for level in WEEK_LEVELS if top.percent >= int(level))
    return _Due(top, reached, restarted=restarted) if reached else None


def _week_dues(conn: sqlite3.Connection, found: list[_Due], now: int, stamp: str) -> list[_Due]:
    """The weeks at a level, each read again from its count's latest restart on where a
    level it reaches was given already: the window's samples since its start, read once."""

    again = [due for due in found if set(due.levels) & set(_given(conn, due))]
    if not again:
        return found
    start = min(_millis(due.sample.resets_at) for due in again) - forecast.WEEK
    since = samples.instant(
        (_EPOCH + dt.timedelta(milliseconds=start - forecast.RESET_SLACK)).isoformat()
    )
    windows: dict[tuple[str, str, str, str], list[_Sample]] = {}
    for sample in _known(conn, since, _WEEKS):
        windows.setdefault(sample.series, []).append(sample)
    dues = [due for due in found if due not in again]
    for due in again:
        series = windows.get(due.sample.series, [])
        restarted = _restarted(series, forecast.WEEK, due.sample.resets_at)
        renewed = due if restarted is None else _week_due(series, now, stamp, restarted)
        dues += [] if renewed is None else [renewed]
    return dues


def _five_hour_dues(series: list[_Sample], now: int) -> list[_Due]:
    latest = max(series, key=lambda one: (one.at, one.percent))
    if not forecast.fresh(_millis(latest.at), now):
        return []
    window = forecast.Window(forecast.FIVE_HOURS, latest.percent, _millis(latest.resets_at))
    found = forecast.outlook(window, _readings(series, forecast.FIVE_HOURS), now)
    if not (
        isinstance(found, forecast.FiveHourOutlook)
        and found.alert_eligible
        and found.exhausted_before_reset
    ):
        return []
    at = found.forecast.at if isinstance(found.forecast, forecast.Short) else None
    restarted = _restarted(series, forecast.FIVE_HOURS, latest.resets_at)
    return [_Due(latest, (EXHAUSTED,), at, restarted)]


def _dues(conn: sqlite3.Connection, now: dt.datetime) -> list[_Due]:
    """Every window at a level now, from the samples whose account is known."""

    since = samples.instant(
        (now - dt.timedelta(milliseconds=forecast.FIVE_HOURS + forecast.RESET_SLACK)).isoformat()
    )
    millis = (now - _EPOCH) // dt.timedelta(milliseconds=1)
    stamp = samples.instant(now.isoformat())
    by_series: dict[tuple[str, str, str, str], list[_Sample]] = {}
    for sample in _known(conn, since):
        by_series.setdefault(sample.series, []).append(sample)
    dues: list[_Due] = []
    weeks: list[_Due] = []
    for (_, _, kind, _), series in by_series.items():
        if kind in _WEEKS:
            week = _week_due(series, millis, stamp)
            weeks += [] if week is None else [week]
        else:
            dues += _five_hour_dues(series, millis)
    return dues + _week_dues(conn, weeks, millis, stamp)


def _given(conn: sqlite3.Connection, due: _Due) -> list[str]:
    """The levels of this window the owner was given already, since its count's latest
    restart where it restarted."""

    sample = due.sample
    reset = _millis(sample.resets_at)
    return [
        str(level)
        for level, resets_at, sample_at in conn.execute(
            "SELECT level, resets_at, sample_at FROM quota_alerts"
            " WHERE organization = ? AND seat = ? AND kind = ? AND model = ?",
            sample.series,
        )
        if forecast.same_window(_millis(str(resets_at)), reset)
        and (due.restarted is None or _millis(str(sample_at)) >= due.restarted)
    ]


def _keep(conn: sqlite3.Connection, dues: Iterable[_Due], now: dt.datetime) -> list[_Due]:
    """Write the key of every level not given yet, in one transaction; the dues to show.

    A due is shown when its top level is new: the levels below it are kept with it. A level
    given again after a restart takes the sample it is given on now.
    """

    stamp = samples.instant(now.isoformat())
    shown: list[_Due] = []
    conn.execute("BEGIN IMMEDIATE")
    try:
        lapsed = now - dt.timedelta(milliseconds=forecast.RESET_SLACK)
        conn.execute(
            "DELETE FROM quota_alerts WHERE resets_at < ?",
            (samples.instant(lapsed.isoformat()),),
        )
        for due in dues:
            given = _given(conn, due)
            new = [level for level in due.levels if level not in given]
            sample = due.sample
            for level in new:
                conn.execute(
                    "INSERT INTO quota_alerts(organization, seat, kind, model, resets_at, level,"
                    " account_uuid, sample_at, raised_at) VALUES (?,?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(organization, seat, kind, model, resets_at, level) DO UPDATE"
                    " SET account_uuid = excluded.account_uuid, sample_at = excluded.sample_at,"
                    " raised_at = excluded.raised_at",
                    (
                        *sample.series,
                        sample.resets_at,
                        level,
                        sample.account_uuid,
                        sample.at,
                        stamp,
                    ),
                )
            if due.levels[-1] in new:
                shown.append(due)
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")
    return shown


def _tag(sample_series: tuple[str, str, str, str]) -> str:
    """The toast's tag: one per account's window, so a higher level replaces a lower one."""

    digest = hashlib.sha256("\n".join(sample_series).encode("utf-8")).hexdigest()
    return f"quota-{digest[:16]}"


def _show(
    due: _Due,
    account: str | None,
    now: dt.datetime,
    settings: alert_settings.Settings,
    zone: dt.tzinfo | None,
) -> emit.Show:
    sample = due.sample

    def local(moment: dt.datetime) -> dt.datetime:
        return moment.astimezone(zone)

    runs_out_at = (
        None
        if due.runs_out_at is None
        else local(_EPOCH + dt.timedelta(milliseconds=due.runs_out_at))
    )
    return emit.Show(
        tag=_tag(sample.series),
        message=messages.quota(
            due.levels[-1],
            tag=_tag(sample.series),
            window=sample.kind,
            percent=sample.percent,
            resets_at=local(dt.datetime.fromisoformat(sample.resets_at)),
            sample_at=local(dt.datetime.fromisoformat(sample.at)),
            now=local(now),
            settings=settings,
            model=sample.model or None,
            runs_out_at=runs_out_at,
            account=account,
            logo=toast.logo_uri(),
        ),
        work_item_id=None,
        settings=settings,
    )


def due(
    conn: sqlite3.Connection, *, now: dt.datetime | None = None, zone: dt.tzinfo | None = None
) -> list[emit.Show]:
    """Decide and keep the quota alerts due now; the toasts to show.

    `conn` must be outside any transaction: what is decided is written in one of its own.
    `zone` is where the toast's times are read, this machine's own by default.
    """

    moment = now or dt.datetime.now(dt.UTC)
    settings = alert_settings.read(conn)
    if not alert_settings.wants(settings, "quota"):
        return []
    dues = _dues(conn, moment)
    if not dues:
        return []
    shown = _keep(conn, dues, moment)
    # The owner's name for each account's organization, read once for every toast.
    named = names.names_of(conn, (one.sample.organization for one in shown))
    return [_show(one, named.get(one.sample.organization), moment, settings, zone) for one in shown]


def after_pass(conn: sqlite3.Connection, *, now: dt.datetime | None = None) -> None:
    """Tell the owner of every quota window due since the last pass. Never raises.

    Where toasts are switched off nothing is read or kept.
    """

    if not toast.active():
        return
    try:
        shows = due(conn, now=now)
    except Exception as error:  # noqa: BLE001 -- nothing about an alert may stop the reader
        toast.log(f"quota alert not decided: {type(error).__name__}: {error}")
        return
    emit.send(shows)
