"""The subscription quota of each account, as its windows stand now.

One entry per account: every account with a quota sample in the last `LOOKBACK`, and
every organization whose work has a usage segment in that span but no such sample, which
has no source and is keyed `<organization>/` (`accounts.unknown_key`). An account is its
organization and its account's UUID, or, where no sample of it names one, the time of week
its week resets (`quota.accounts`); its key is the one the `seat` dimension gives it. The
samples are read through `seats.account_samples`, the read the alerts take, so both see
one account where the other does. `shared` marks a weekly-reset account two accounts'
readings run under.

An entry carries the owner's name for the account itself (`names.own_name`) and the one
for its organization apart, so a reader says the account's own name where there is one.

A window is one kind of an account, and for a model's week one model. Its latest sample
says how much of it is spent, when and by which source; the window's start is its reset
less its length, and the readings since that start draw its step line. They stay as read,
a fall included; the moments where a feed's fall restarted the window's count
(`forecast.count`) are its `restarts`, so the line can say what the fall was. The even pace is
how much of the window steady use would have spent by now. A window is `fresh` while its
latest sample is within `forecast.FRESH_FOR`, the rule the alerts use, and `silent` once
it is older; a fresh 0 % is a value like any other.

The forecast is the quota's own (`forecast.outlook`): the five-hour window's point
answer, with the share a window that lasts spends by its reset, and a week only as the
range it gives, never a point. The usage credits and a
gateway's spend limit are their own kinds and carry no percent, no amount and no
forecast: no figure here is money, and none is a sum of percentages, within an account or
across accounts.

A window that is a share also says how its previous window ended (`previous`): the latest
window of the same account, kind and model whose reset is at or before this one's start,
with its reset, its latest reading and whether it ran out. A past window is a window like
the current one, built by the same `_window` from its own samples, so it has no pace and no
forecast once its reset has passed. Five-hour windows are not contiguous, since one starts
at the first use after the previous reset, so the previous one is the latest kept, however
far back, and never the one a fixed length before. Only the retention is searched
(`samples.retained_from`); where it holds none, `previous` is `None` and the answer names
the retention's start. `past` reads one such window by the moment it reset at or before,
which is how a reader steps back through the kept windows.

Asked with the start of a page's period, each window of a share also holds the windows
before it that reset after that start (`earlier`), each whole from its start to its reset,
so a step line can draw every window the period overlaps; the read then reaches a window's
length before that start, where the first of them begins, and finds them among its samples.

The read reaches a week further back than its span, so the previous window of a current
one is found among the samples already read. Further back the samples are looked for by
their seats (`_Past._search`): a seat names one week, and the seats that may be an
account's are those its UUID names and those whose week resets at its time of week, so the
search reads only the weeks that may hold the account's samples.
"""

from __future__ import annotations

import datetime as dt
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TypeAlias

from ..quota import accounts, forecast, names, samples, seats
from ..quota import store as quota_store
from . import usage

#: How far back an account's samples, or an organization's work, make it an entry.
LOOKBACK = dt.timedelta(days=7)
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
#: The length of each window that is a percent of a limit; the other kinds carry none.
_LENGTHS = {
    "five_hour": forecast.FIVE_HOURS,
    "week": forecast.WEEK,
    "week_model": forecast.WEEK,
}
#: The kinds a window of a share of a limit is of, the ones a past window is read for.
SHARE_KINDS = tuple(_LENGTHS)
#: How much further back than its span the read reaches: a week, and the slack a reset may
#: move by, so the window before each current one is among the samples read.
_PAST_REACH = dt.timedelta(milliseconds=forecast.WEEK + forecast.RESET_SLACK)
#: The longest stretch of seats' weeks one read of the search takes.
_SEARCH_STRETCH = 30 * 24 * forecast.HOUR
_ORGANIZATIONS_AT_WORK = (
    "SELECT DISTINCT organization FROM usage_segments"
    " WHERE ended_at >= ? AND started_at <= ? AND organization IS NOT NULL"
)
#: The seats whose samples of one window were read in a stretch, the latest first: the first
#: and last moment of each, whether a UUID names it and whether one account's UUID does.
_SEATS_BEFORE = (
    "SELECT seat, MIN(at), MAX(at), MAX(account_uuid IS NOT NULL),"
    " MAX(organization IS ? AND account_uuid IS ?) FROM quota_samples"
    " WHERE kind = ? AND model IS ? AND seat IS NOT NULL AND at >= ? AND at < ?"
    " GROUP BY seat ORDER BY MAX(at) DESC"
)

#: The latest seat an account's UUID names.
_LATEST_SEAT_OF = (
    "SELECT seat FROM quota_samples WHERE organization = ? AND account_uuid = ?"
    " AND seat IS NOT NULL ORDER BY at DESC LIMIT 1"
)

_Series: TypeAlias = tuple[str, str | None]


def _millis(text: str) -> int:
    return (dt.datetime.fromisoformat(text) - _EPOCH) // dt.timedelta(milliseconds=1)


def _stamp(millis: int) -> str:
    """A moment as the store writes one (`samples.instant`)."""

    return samples.instant((_EPOCH + dt.timedelta(milliseconds=millis)).isoformat())


class _Clock:
    """The moment of the answer, and how a time is written in it: at the caller's offset."""

    def __init__(self, now: dt.datetime, zone: dt.tzinfo) -> None:
        self.now = (now - _EPOCH) // dt.timedelta(milliseconds=1)
        self.zone = zone

    def time(self, millis: float) -> str:
        moment = _EPOCH + dt.timedelta(milliseconds=millis)
        return moment.astimezone(self.zone).isoformat(timespec="milliseconds")

    def stored(self, text: str) -> str:
        return self.time(_millis(text))


def _plan(conn: sqlite3.Connection, organization: str, account_uuid: str | None) -> str | None:
    if account_uuid is None:
        return None
    row = conn.execute(
        "SELECT plan FROM quota_accounts WHERE organization = ? AND account_uuid = ?",
        (organization, account_uuid),
    ).fetchone()
    return None if row is None or row[0] is None else str(row[0])


def _latest(series: list[seats.AccountSample]) -> seats.AccountSample:
    return max(series, key=lambda one: (one.at, one.percent or 0.0))


def _reading(sample: seats.AccountSample, length: int) -> forecast.Reading:
    return forecast.Reading(
        _millis(sample.at),
        sample.percent or 0.0,
        None if sample.resets_at is None else _millis(sample.resets_at),
        length,
        sample.feed,
    )


def _forecast(
    window: forecast.Window, series: list[seats.AccountSample], clock: _Clock
) -> dict | None:
    found = forecast.outlook(window, [_reading(one, window.length) for one in series], clock.now)
    if isinstance(found, forecast.WeekRange):
        return {"low_percent": round(found.low, 2), "high_percent": round(found.high, 2)}
    if found is None:
        return None
    point = found.forecast
    if isinstance(point, forecast.Spent):
        return {"outcome": "spent", "runs_out_at": None, "at_reset_percent": None, "basis": None}
    if isinstance(point, forecast.Short):
        return {
            "outcome": "runs_out",
            "runs_out_at": clock.time(point.at),
            "at_reset_percent": None,
            "basis": point.basis.kind,
        }
    return {
        "outcome": "lasts",
        "runs_out_at": None,
        "at_reset_percent": round(point.reached, 2),
        "basis": point.basis.kind,
    }


def _window(kind: str, model: str | None, series: list[seats.AccountSample], clock: _Clock) -> dict:
    latest = _latest(series)
    found: dict = {
        "kind": kind,
        "model": model,
        "state": "fresh" if forecast.fresh(_millis(latest.at), clock.now) else "silent",
        "resets_at": None if latest.resets_at is None else clock.stored(latest.resets_at),
        "latest": {"at": clock.stored(latest.at), "source": latest.source},
    }
    length = _LENGTHS.get(kind)
    if length is None or latest.percent is None:
        return found
    resets_at = None if latest.resets_at is None else _millis(latest.resets_at)
    window = forecast.Window(length, latest.percent, resets_at, model)
    # A window that has not started names no reset, so it has no start and no pace yet;
    # one whose reset has passed has no pace any more.
    started: int | None = None
    left: float | None = None
    since = [latest]
    restarts: list[int] = []
    if resets_at is not None:
        readings = [_reading(one, length) for one in series]
        restarts = forecast.count(readings, length, resets_at).restarts
        started = resets_at - length
        since = [
            one
            for one in series
            if one.resets_at is not None
            and forecast.same_window(_millis(one.resets_at), resets_at)
            and _millis(one.at) >= started
        ]
        if resets_at > clock.now:
            left = forecast.even_left(window, clock.now)
    found["latest"]["used_percent"] = latest.percent
    found.update(
        {
            "started_at": None if started is None else clock.time(started),
            "even_percent": None if left is None else round(100 - left, 2),
            "readings": [
                {"at": clock.stored(one.at), "used_percent": one.percent, "source": one.source}
                for one in since
            ],
            "restarts": [clock.time(at) for at in restarts],
            "forecast": _forecast(window, series, clock),
        }
    )
    return found


@dataclass(frozen=True)
class _Owner:
    """Whose past windows are read: an account's key, with what names its seats -- its
    organization and UUID, and the time of week its week resets where that is known."""

    key: str
    organization: str
    account_uuid: str | None
    weekly_reset: str | None

    @classmethod
    def of(cls, account: accounts.Account) -> _Owner:
        return cls(account.key, account.organization, account.account_uuid, account.weekly_reset)

    @classmethod
    def by_key(cls, conn: sqlite3.Connection, key: str) -> _Owner:
        """The owner an account's key (`accounts.is_account_key`) names; an account known by
        its UUID resets its week when the latest seat its UUID names does."""

        organization, _, tail = key.partition("/")
        if tail.startswith(accounts.WEEKLY):
            return cls(key, organization, None, tail.removeprefix(accounts.WEEKLY))
        row = conn.execute(_LATEST_SEAT_OF, (organization, tail)).fetchone()
        return cls(key, organization, tail, None if row is None else accounts.weekly_reset(row[0]))


def _ended(window: dict) -> dict:
    """How a past window ended: its span, its latest reading and whether it ran out, which it
    did where a reading of it reached the whole window."""

    return {
        "started_at": window["started_at"],
        "resets_at": window["resets_at"],
        "latest": dict(window["latest"]),
        "ran_out": any(one["used_percent"] >= 100 for one in window["readings"])
        or window["latest"]["used_percent"] >= 100,
    }


def _whole(window: dict) -> dict:
    """A past window as a period's line draws it: its span, its readings and its restarts."""

    return {key: window[key] for key in ("started_at", "resets_at", "readings", "restarts")}


class _Past:
    """The past windows of a read: the samples it holds already, read from `known_from` on,
    and the store's retention before them, searched by seat (see the module)."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        clock: _Clock,
        retained: int,
        known: dict[tuple[str, str, str | None], list[seats.AccountSample]],
        known_from: int,
    ) -> None:
        self.conn = conn
        self.clock = clock
        self.retained = retained
        self.known = known
        self.known_from = known_from

    def _ours(
        self,
        found: Iterable[seats.AccountSample],
        owner: _Owner,
        series: _Series,
        bound: int,
    ) -> list[seats.AccountSample]:
        """The samples of `found` that are the owner's readings of the series in a window that
        reset at or before `bound`. Every read here starts at the retention or later."""

        return [
            one
            for one in found
            if one.account.key == owner.key
            and (one.kind, one.model) == series
            and one.percent is not None
            and one.resets_at is not None
            and _millis(one.resets_at) <= bound + forecast.RESET_SLACK
        ]

    def _read(self, kind: str, since: int, until: int) -> list[seats.AccountSample]:
        return seats.account_samples(self.conn, _stamp(since), (kind,), until=_stamp(until))

    def _search(
        self, owner: _Owner, series: _Series, bound: int, until: int
    ) -> tuple[list[seats.AccountSample], int]:
        """The owner's samples of the series in the latest stretch before `until` that holds
        any, with the moment the stretch was read from: the weeks of the seats that may be
        its, the latest first, a few weeks a read. A seat may be its where its UUID names it
        among these samples, or where the seat's week resets at its time of week -- and for an
        account with a UUID, where no UUID names it. A UUID read only in another kind's
        samples leaves a seat to the second rule, which reads more, never less."""

        kind, model = series
        rows = self.conn.execute(
            _SEATS_BEFORE,
            (
                owner.organization,
                owner.account_uuid,
                kind,
                model,
                _stamp(self.retained),
                _stamp(until),
            ),
        ).fetchall()
        own = [str(seat) for seat, *_, by_owner in rows if by_owner]
        slot = owner.weekly_reset or (accounts.weekly_reset(own[0]) if own else None)
        # A seat another account's UUID names is that account's (`accounts.Resolver`), but an
        # account known by its weekly reset may be the one two UUIDs of a seat share.
        spans = [
            (_millis(first), _millis(last))
            for seat, first, last, named, by_owner in rows
            if by_owner
            or (
                (owner.account_uuid is None or not named)
                and accounts.weekly_reset(str(seat)) == slot
            )
        ]
        index = 0
        while index < len(spans):
            low, high = spans[index]
            index += 1
            while index < len(spans) and high - spans[index][0] <= _SEARCH_STRETCH:
                low = min(low, spans[index][0])
                index += 1
            found = self._ours(self._read(kind, low, high), owner, series, bound)
            if found:
                return found, low
        return [], until

    def samples(self, owner: _Owner, series: _Series, bound: int) -> list[seats.AccountSample]:
        """The samples of the owner's latest window of the series that reset at or before
        `bound`, oldest first; none where the retention keeps none."""

        kind, _ = series
        found = self._ours(self.known.get((owner.key, *series), []), owner, series, bound)
        read_from = self.known_from
        if not found:
            until = min(self.known_from, bound + forecast.RESET_SLACK)
            found, read_from = self._search(owner, series, bound, until)
        if not found:
            return []
        reset = max(_millis(one.resets_at) for one in found if one.resets_at is not None)
        start = max(reset - _LENGTHS[kind], self.retained)
        if start < read_from:
            # The window began before the samples read: its earlier readings are read too.
            found = self._ours(self._read(kind, start, read_from), owner, series, bound) + found
        window = [
            one
            for one in dict.fromkeys(found)
            if one.resets_at is not None and forecast.same_window(_millis(one.resets_at), reset)
        ]
        return sorted(window, key=lambda one: _millis(one.at))

    def window(self, owner: _Owner, series: _Series, bound: int) -> dict | None:
        """The owner's latest window of the series that reset at or before `bound`, as a
        current window is given, with how the window before it ended; `None` where none is
        kept."""

        found = self.samples(owner, series, bound)
        if not found:
            return None
        window = _window(*series, found, self.clock)
        window["previous"] = self.previous(owner, window)
        return window

    def previous(self, owner: _Owner, window: dict) -> dict | None:
        """How the window before `window` ended (`_ended`): the latest that reset at or before
        its start, or before its latest reading where it names no start."""

        start = window["started_at"] or window["latest"]["at"]
        series = (window["kind"], window["model"])
        found = self.samples(owner, series, _millis(start))
        return None if not found else _ended(_window(*series, found, self.clock))

    def earlier(self, owner: _Owner, window: dict, since: int) -> list[dict]:
        """The windows before `window` that reset after `since`, oldest first, each whole from
        its start to its reset (`_whole`), from the samples the read holds: it reaches a
        window's length before `since`, so the first of them starts among them."""

        bound = _millis(window["started_at"] or window["latest"]["at"])
        series = (window["kind"], window["model"])
        found = self._ours(self.known.get((owner.key, *series), []), owner, series, bound)
        # Every sample `_ours` keeps names its reset; one window is the resets within the slack.
        by_reset = sorted(((_millis(str(one.resets_at)), one) for one in found), key=lambda x: x[0])
        windows: list[tuple[int, list[seats.AccountSample]]] = []
        for reset, one in by_reset:
            if windows and forecast.same_window(reset, windows[-1][0]):
                windows[-1][1].append(one)
            else:
                windows.append((reset, [one]))
        return [
            _whole(_window(*series, sorted(kept, key=lambda one: _millis(one.at)), self.clock))
            for _, kept in windows
            if max(_millis(str(one.resets_at)) for one in kept) > since
        ]


def _order(series: _Series) -> tuple[int, str]:
    kind, model = series
    return quota_store.KINDS.index(kind), model or ""


def _entry(
    conn: sqlite3.Connection,
    account: accounts.Account,
    windows: dict[_Series, list[seats.AccountSample]],
    clock: _Clock,
    named: dict[str, str],
    past: _Past,
    period_from: int | None,
) -> dict:
    owner = _Owner.of(account)
    shown = [
        _window(kind, model, windows[kind, model], clock)
        for kind, model in sorted(windows, key=_order)
    ]
    for window in shown:
        if "readings" in window:
            window["previous"] = past.previous(owner, window)
            if period_from is not None:
                window["earlier"] = past.earlier(owner, window, period_from)
    return {
        "account": account.key if windows else accounts.unknown_key(account.organization),
        "organization": account.organization,
        "account_uuid": account.account_uuid,
        "weekly_reset": account.weekly_reset,
        "shared": account.shared,
        "plan": _plan(conn, account.organization, account.account_uuid),
        "name": names.own_name(named, account) if windows else None,
        "organization_name": named.get(account.organization),
        "no_source": not windows,
        "windows": shown,
    }


def _by_account(
    found: Iterable[seats.AccountSample],
) -> dict[accounts.Account, dict[_Series, list[seats.AccountSample]]]:
    read: dict[accounts.Account, dict[_Series, list[seats.AccountSample]]] = {}
    for one in found:
        read.setdefault(one.account, {}).setdefault((one.kind, one.model), []).append(one)
    return read


def _by_series(
    found: Iterable[seats.AccountSample],
) -> dict[tuple[str, str, str | None], list[seats.AccountSample]]:
    """The samples of each account's window of a share, by the account's key: one account
    is one key however many seats it was read under."""

    read: dict[tuple[str, str, str | None], list[seats.AccountSample]] = {}
    for one in found:
        if one.kind in _LENGTHS:
            read.setdefault((one.account.key, one.kind, one.model), []).append(one)
    return read


def _at(now: dt.datetime | None, utc_offset: int) -> tuple[_Clock, dt.datetime, int]:
    """The answer's clock, its moment and the oldest moment the store keeps then."""

    clock = _Clock(now or dt.datetime.now(dt.UTC), usage.caller_zone(utc_offset))
    moment = _EPOCH + dt.timedelta(milliseconds=clock.now)
    return clock, moment, _millis(samples.retained_from(moment))


def read(
    conn: sqlite3.Connection,
    utc_offset: int,
    *,
    now: dt.datetime | None = None,
    period_from: dt.datetime | None = None,
) -> dict:
    """Every account's quota windows at `now`, the times at `utc_offset` minutes from UTC.

    Only what the store holds up to `now` is read: a source whose clock runs ahead can date
    a sample later, and the answer is as of `now`. Given `period_from`, the start of the
    period a page shows, each window of a share also holds the windows before it that reset
    after that moment, or after the retention's start where it is earlier (`earlier`).
    """

    clock, moment, retained = _at(now, utc_offset)
    since = samples.instant((moment - LOOKBACK).isoformat())
    until = samples.instant(moment.isoformat())
    # A week further back as well, where the windows before the current ones are, and a
    # window's length before the period's start, where the first window it overlaps starts.
    reach = max(_millis(samples.instant((moment - LOOKBACK - _PAST_REACH).isoformat())), retained)
    start = None if period_from is None else max(_millis(period_from.isoformat()), retained)
    if start is not None:
        reach = max(min(reach, start - _PAST_REACH // dt.timedelta(milliseconds=1)), retained)
    wide = seats.account_samples(conn, _stamp(reach), quota_store.KINDS, until=until)
    found = _by_account(one for one in wide if one.at >= since)
    past = _Past(conn, clock, retained, _by_series(wide), reach)
    read_from = {account.organization for account in found}
    for (organization,) in conn.execute(_ORGANIZATIONS_AT_WORK, (since, until)):
        if organization not in read_from:
            found[accounts.Account(str(organization), None, None)] = {}
    # Every name an entry may say, read once.
    named = names.names_of(conn, (key for account in found for key in names.keys_of(account)))
    entries = [
        _entry(conn, account, windows, clock, named, past, start)
        for account, windows in found.items()
    ]
    return {
        "now": clock.time(clock.now),
        "utc_offset": utc_offset,
        "fresh_for_seconds": forecast.FRESH_FOR // 1000,
        "retained_from": clock.time(retained),
        "accounts": sorted(entries, key=lambda entry: entry["account"]),
    }


def past(
    conn: sqlite3.Connection,
    utc_offset: int,
    *,
    account: str,
    kind: str,
    model: str | None,
    before: dt.datetime,
    now: dt.datetime | None = None,
) -> dict:
    """One past window of an account (`accounts.is_account_key`): the latest of `kind` and
    `model` that reset at or before `before`, or at `now` where that is earlier, given as a
    current window is, with how the window before it ended; `None` where the retention keeps
    none. The times at `utc_offset` minutes from UTC."""

    clock, _, retained = _at(now, utc_offset)
    bound = min((before - _EPOCH) // dt.timedelta(milliseconds=1), clock.now)
    reader = _Past(conn, clock, retained, {}, clock.now)
    return {
        "now": clock.time(clock.now),
        "utc_offset": utc_offset,
        "fresh_for_seconds": forecast.FRESH_FOR // 1000,
        "retained_from": clock.time(retained),
        "account": account,
        "kind": kind,
        "model": model,
        "before": clock.time(bound),
        "window": reader.window(_Owner.by_key(conn, account), (kind, model), bound),
    }


__all__ = ["LOOKBACK", "SHARE_KINDS", "past", "read"]
