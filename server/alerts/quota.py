"""Warning the owner before a subscription quota window runs out.

The levels. A week -- the all-models week, and each model's own week where a source
reports one -- alerts at 75 % and at 90 % spent. The five-hour window alerts when its
forecast says it runs out before its reset: only `forecast.outlook` decides that, and only
an answer that is `alert_eligible`. A week's outlook is a range and never eligible, so a
week alerts on what was spent alone, and its forecast is never asked. One call of the
forecast takes one series: the five-hour readings of one account, never a week beside
them.

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
latest sample says when it last moved. One older than `FRESH_FOR` raises nothing. That
span is the five-hour forecast's own recent pace (the quarter hour `forecast` blends with
the hour): a reading past it says nothing of how fast the window is being spent now. It
is also fifteen of the reader's passes (`housekeeping.USAGE_PAUSE_SECONDS`), so a reading
that waited for its organization is still fresh at the pass that finds it. A window
spent in a quiet stretch is not lost: its next reading is fresh and finds the level not
yet given.

The key. An alert given is a row of `quota_alerts`: the account, the window, the reset it
named and the level, written in the transaction that decides it, so a restart does not
give it again. Two resets within `forecast.RESET_SLACK` are one window, as the forecast
reads them; a new reset starts the levels again. A reading that reaches 90 % before 75 %
was given gives the 90 % alert alone and keeps both levels. Where the owner turned quota
alerts off nothing is kept, so turning them on warns of a level still fresh.

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
from . import emit, messages
from . import settings as alert_settings

#: How old a series' latest sample may be and still alert; see the module's note.
FRESH_FOR = dt.timedelta(minutes=15)
#: The share of a week spent that alerts, lowest first.
WEEK_LEVELS = ("75", "90")
EXHAUSTED = "exhausted"
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
_WEEKS = ("week", "week_model")
#: Every sample of a window an alert reads, oldest first, since the five-hour window could
#: have begun: a week needs only the fresh ones, the forecast the window's own.
_SAMPLES = (
    "SELECT at, organization, session_id, account_uuid, seat, kind, model, percent, resets_at"
    " FROM quota_samples WHERE at >= ? AND seat IS NOT NULL AND percent IS NOT NULL"
    " AND resets_at IS NOT NULL AND kind IN ('five_hour', 'week', 'week_model')"
    " ORDER BY at, id"
)


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

    @property
    def series(self) -> tuple[str, str, str, str]:
        return (self.organization, self.seat, self.kind, self.model)


@dataclass(frozen=True)
class _Due:
    """A window at a level, before the key says whether it was given already.

    `levels` are every level the window has reached, lowest first; the toast is about the
    last. `runs_out_at` is when the five-hour window runs out, `None` when it is spent.
    """

    sample: _Sample
    levels: tuple[str, ...]
    runs_out_at: float | None = None


def _known(conn: sqlite3.Connection, since: str) -> list[_Sample]:
    """The samples since `since` whose organization is known, each with its account's UUID."""

    organizations: dict[tuple[str, str], str | None] = {}
    accounts: dict[tuple[str, str], str | None] = {}
    known: list[_Sample] = []
    for at, organization, session, uuid, seat, kind, model, percent, resets_at in conn.execute(
        _SAMPLES, (since,)
    ):
        if organization is None:
            if (session, at) not in organizations:
                organizations[session, at] = seats.organization_at(conn, session, at)
            organization = organizations[session, at]
            if organization is None:
                continue
        if uuid is None:
            if (organization, seat) not in accounts:
                accounts[organization, seat] = seats.account_of_seat(conn, organization, seat)
            uuid = accounts[organization, seat]
        known.append(
            _Sample(at, organization, seat, uuid, kind, model or "", float(percent), resets_at)
        )
    return known


def _week_dues(series: list[_Sample], fresh_from: str, now: str) -> list[_Due]:
    fresh = [one for one in series if one.at >= fresh_from and one.resets_at > now]
    if not fresh:
        return []
    top = max(fresh, key=lambda one: (one.percent, one.at))
    reached = tuple(level for level in WEEK_LEVELS if top.percent >= int(level))
    return [_Due(top, reached)] if reached else []


def _five_hour_dues(series: list[_Sample], fresh_from: str, now: dt.datetime) -> list[_Due]:
    latest = max(series, key=lambda one: (one.at, one.percent))
    if latest.at < fresh_from:
        return []
    window = forecast.Window(forecast.FIVE_HOURS, latest.percent, _millis(latest.resets_at))
    readings = [
        forecast.Reading(_millis(one.at), one.percent, _millis(one.resets_at), forecast.FIVE_HOURS)
        for one in series
    ]
    found = forecast.outlook(window, readings, (now - _EPOCH) // dt.timedelta(milliseconds=1))
    if not (
        isinstance(found, forecast.FiveHourOutlook)
        and found.alert_eligible
        and found.exhausted_before_reset
    ):
        return []
    at = found.forecast.at if isinstance(found.forecast, forecast.Short) else None
    return [_Due(latest, (EXHAUSTED,), at)]


def _dues(conn: sqlite3.Connection, now: dt.datetime) -> list[_Due]:
    """Every window at a level now, from the samples whose account is known."""

    since = samples.instant(
        (now - dt.timedelta(milliseconds=forecast.FIVE_HOURS + forecast.RESET_SLACK)).isoformat()
    )
    fresh_from = samples.instant((now - FRESH_FOR).isoformat())
    stamp = samples.instant(now.isoformat())
    by_series: dict[tuple[str, str, str, str], list[_Sample]] = {}
    for sample in _known(conn, since):
        by_series.setdefault(sample.series, []).append(sample)
    dues: list[_Due] = []
    for (_, _, kind, _), series in by_series.items():
        if kind in _WEEKS:
            dues += _week_dues(series, fresh_from, stamp)
        else:
            dues += _five_hour_dues(series, fresh_from, now)
    return dues


def _given(conn: sqlite3.Connection, due: _Due) -> list[str]:
    """The levels of this window the owner was given already."""

    sample = due.sample
    reset = _millis(sample.resets_at)
    return [
        str(level)
        for level, resets_at in conn.execute(
            "SELECT level, resets_at FROM quota_alerts"
            " WHERE organization = ? AND seat = ? AND kind = ? AND model = ?",
            sample.series,
        )
        if forecast.same_window(_millis(str(resets_at)), reset)
    ]


def _keep(conn: sqlite3.Connection, dues: Iterable[_Due], now: dt.datetime) -> list[_Due]:
    """Write the key of every level not given yet, in one transaction; the dues to show.

    A due is shown when its top level is new: the levels below it are kept with it.
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
                    " account_uuid, sample_at, raised_at) VALUES (?,?,?,?,?,?,?,?,?)",
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
