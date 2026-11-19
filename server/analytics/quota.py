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
"""

from __future__ import annotations

import datetime as dt
import sqlite3
from collections.abc import Iterable
from typing import TypeAlias

from ..planning import usage
from ..quota import accounts, forecast, names, samples, seats
from ..quota import store as quota_store

#: How far back an account's samples, or an organization's work, make it an entry.
LOOKBACK = dt.timedelta(days=7)
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
#: The length of each window that is a percent of a limit; the other kinds carry none.
_LENGTHS = {
    "five_hour": forecast.FIVE_HOURS,
    "week": forecast.WEEK,
    "week_model": forecast.WEEK,
}
_ORGANIZATIONS_AT_WORK = (
    "SELECT DISTINCT organization FROM usage_segments"
    " WHERE ended_at >= ? AND started_at <= ? AND organization IS NOT NULL"
)

_Series: TypeAlias = tuple[str, str | None]


def _millis(text: str) -> int:
    return (dt.datetime.fromisoformat(text) - _EPOCH) // dt.timedelta(milliseconds=1)


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


def _order(series: _Series) -> tuple[int, str]:
    kind, model = series
    return quota_store.KINDS.index(kind), model or ""


def _entry(
    conn: sqlite3.Connection,
    account: accounts.Account,
    windows: dict[_Series, list[seats.AccountSample]],
    clock: _Clock,
    named: dict[str, str],
) -> dict:
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
        "windows": [
            _window(kind, model, windows[kind, model], clock)
            for kind, model in sorted(windows, key=_order)
        ],
    }


def _by_account(
    found: Iterable[seats.AccountSample],
) -> dict[accounts.Account, dict[_Series, list[seats.AccountSample]]]:
    read: dict[accounts.Account, dict[_Series, list[seats.AccountSample]]] = {}
    for one in found:
        read.setdefault(one.account, {}).setdefault((one.kind, one.model), []).append(one)
    return read


def read(conn: sqlite3.Connection, utc_offset: int, *, now: dt.datetime | None = None) -> dict:
    """Every account's quota windows at `now`, the times at `utc_offset` minutes from UTC.

    Only what the store holds up to `now` is read: a source whose clock runs ahead can date
    a sample later, and the answer is as of `now`.
    """

    clock = _Clock(now or dt.datetime.now(dt.UTC), usage.caller_zone(utc_offset))
    moment = _EPOCH + dt.timedelta(milliseconds=clock.now)
    since = samples.instant((moment - LOOKBACK).isoformat())
    until = samples.instant(moment.isoformat())
    found = _by_account(seats.account_samples(conn, since, quota_store.KINDS, until=until))
    read_from = {account.organization for account in found}
    for (organization,) in conn.execute(_ORGANIZATIONS_AT_WORK, (since, until)):
        if organization not in read_from:
            found[accounts.Account(str(organization), None, None)] = {}
    # Every name an entry may say, read once.
    named = names.names_of(conn, (key for account in found for key in names.keys_of(account)))
    entries = [_entry(conn, account, windows, clock, named) for account, windows in found.items()]
    return {
        "now": clock.time(clock.now),
        "utc_offset": utc_offset,
        "fresh_for_seconds": forecast.FRESH_FOR // 1000,
        "accounts": sorted(entries, key=lambda entry: entry["account"]),
    }


__all__ = ["LOOKBACK", "read"]
