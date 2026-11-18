"""Which account a sample's seat is: the one rule every read of quota and usage takes.

A seat names one week's reset to the nearest ten minutes (`samples.seat_for_week`). Only
a reading of an organization (the poll, imported history) can carry the account's UUID;
a session's reading (the status line, the mod) carries the seat alone, and its
organization is the one the session's usage rows say it worked for at the reading's
moment (`organization_at`). That organization can be wrong: a session that changes login
changes organization, and a subagent can run under the new one while the session's own
run is still on the old. So the account of a seat is decided from every sample of that
seat, not from one sample's organization:

1. A sample with a UUID is that account's, in the organization it names.
2. Where two counters run under one seat (`_mixed`), a sample without a UUID cannot be
   told apart and stays in the organization it was read for, as that organization's
   account known by its weekly reset, marked `shared`.
3. Otherwise, where exactly one account of the sample's own organization names the seat
   with its UUID, it is that account's; where two do, it is the weekly-reset account,
   marked `shared`.
4. Otherwise, where exactly one account of any organization names the seat with its UUID,
   it is that account's, in that account's organization: the sample was read for the
   wrong one.
5. Otherwise the seat's organization is the one most of its samples were read for, the
   latest of them on a tie. Within it, an account whose UUID names the seat; else the one
   account whose week resets at the same time of week in the nearest week that has one,
   and which names no other seat within a week of this one; else the account known only
   by its weekly reset. Two accounts tied for nearest leave the weekly-reset account,
   marked `shared`.

Every step reads all of the seat's samples, whatever span the caller reads, so a seat is
the same account in every read.

An account's key is its organization, a slash, and its UUID or `weekly:` with its weekly
reset (`<ISO weekday>T<HH:MM>Z`). An organization id holds no slash, so the two never
meet.

Two counters under one seat. A seat whose week resets in the same ten minutes for two
accounts holds both accounts' readings, and without a UUID they look like one series. It
shows as two feeds that disagree while both are current: one feed's reading within
`forecast.FRESH_FOR` of another feed's latest, apart from it -- a week's share by more than
`_APART_POINTS`, a five-hour window's reset by more than `forecast.RESET_SLACK` -- where
that other feed's next reading is still apart from it. The last condition tells two
counters from a window's count that restarted: after a restart every feed falls, and the
next reading of the feed that read high agrees again. Accounts of one seat never read
near the same time do not show this way.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass

from . import forecast, samples

#: What an account known by its weekly reset alone is called after its organization.
WEEKLY = "weekly:"
#: Two readings of a week's share further apart than this are two counters: a provider's
#: percent wobbles by a point between two readings, and a source rounds to whole points.
_APART_POINTS = 2.0
_WEEK = dt.timedelta(days=7)
_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
_MS = dt.timedelta(milliseconds=1)


@dataclass(frozen=True)
class Account:
    """An account of an organization: its UUID where a sample names it, else the time of
    week its week resets (`weekly_reset`, from the seat that named it).

    `shared` marks the weekly-reset account of a seat two accounts' readings run under:
    its figures may hold both.
    """

    organization: str
    account_uuid: str | None
    weekly_reset: str | None
    shared: bool = False

    @property
    def key(self) -> str:
        """The account's id: its organization, a slash, and its UUID or its weekly reset."""

        tail = self.account_uuid or f"{WEEKLY}{self.weekly_reset}"
        return f"{self.organization}/{tail}"


#: What may follow `weekly:` in a key: the ISO weekday and the time, to ten minutes, in UTC.
_WEEKLY_TAIL = (frozenset("1234567"), "T", frozenset("012"), frozenset("0123456789"), ":",
                frozenset("012345"), "0", "Z")  # fmt: skip


def is_account_key(key: str) -> bool:
    """Whether `key` is an account's key (`Account.key`): an organization, a slash, and a
    UUID or `weekly:` with a time of week. An organization id alone is not one."""

    organization, slash, tail = key.partition("/")
    if not slash or not organization or "/" in tail:
        return False
    if tail.startswith(WEEKLY):
        slot = tail.removeprefix(WEEKLY)
        return (
            len(slot) == len(_WEEKLY_TAIL)
            and all(char in shape for char, shape in zip(slot, _WEEKLY_TAIL, strict=True))
            and slot[2:4] <= "23"
        )
    return samples.is_id(tail)


def unknown_key(organization: str) -> str:
    """What stands for an account of `organization` no sample names: the organization and a
    slash, with nothing after it."""

    return f"{organization}/"


def _week_of(seat: str) -> dt.datetime:
    return dt.datetime.strptime(seat, "week:%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.UTC)


def weekly_reset(seat: str) -> str:
    """The time of week a seat's week resets: `week:2030-03-08T09:00Z` is `5T09:00Z`, the
    ISO weekday and the time in UTC."""

    moment = _week_of(seat)
    return f"{moment.isoweekday()}T{moment:%H:%M}Z"


#: The organization a session was working for at a moment: the latest of its main run's
#: segments begun by then names it.
WORKING_FOR = (
    "SELECT u.organization FROM usage_segments u WHERE u.session_id = {session}"
    " AND u.agent_id = '' AND u.started_at <= {at} ORDER BY u.started_at DESC, u.id DESC LIMIT 1"
)


def organization_at(conn: sqlite3.Connection, session_id: str, at: str) -> str | None:
    """The organization a session was working for at `at`, as its usage rows say; or None."""

    row = conn.execute(WORKING_FOR.format(session="?", at="?"), (session_id, at)).fetchone()
    return None if row is None else row[0]


#: Every account a sample with a UUID names, by its seat, in any organization.
_NAMED = (
    "SELECT DISTINCT organization, seat, account_uuid FROM quota_samples"
    " WHERE account_uuid IS NOT NULL AND seat IS NOT NULL"
)
#: Every sample of these seats, in the order they were made, with the organization it was
#: read for: an organization's own, a session's as `organization_at` says.
_OF_SEATS_READ_FOR = (
    "SELECT seat, at, organization, session_id, account_uuid, kind, percent, resets_at,"
    " CASE WHEN session_id IS NULL THEN organization ELSE ({working}) END"
    " FROM quota_samples q WHERE seat IN (SELECT value FROM json_each(?)) ORDER BY at, id"
)
_OF_SEATS = _OF_SEATS_READ_FOR.format(working=WORKING_FOR.format(session="q.session_id", at="q.at"))


def _millis(text: str) -> int:
    return (dt.datetime.fromisoformat(text) - _EPOCH) // _MS


class _Mixed:
    """Whether one seat's readings of one window kind come from two counters (see the
    module): fed its readings oldest first."""

    def __init__(self, kind: str) -> None:
        self.kind = kind
        #: Each feed's latest reading, as its moment and its value.
        self.latest: dict[tuple, tuple[int, float]] = {}
        #: The readings each feed's latest one disagreed with, waiting for its next one.
        self.waiting: dict[tuple, list[tuple[int, float]]] = {}
        self.found = False

    def _apart(self, one: float, other: float) -> bool:
        if self.kind == "week":
            return abs(one - other) > _APART_POINTS
        return abs(one - other) > forecast.RESET_SLACK

    def add(self, feed: tuple, at: int, value: float) -> None:
        if self.found:
            return
        # A reading another feed disagreed with, and this feed's next one still disagrees.
        if any(
            at - then <= forecast.FRESH_FOR and self._apart(value, other)
            for then, other in self.waiting.pop(feed, [])
        ):
            self.found = True
            return
        for other_feed, (other_at, other) in self.latest.items():
            if (
                other_feed != feed
                and at - other_at <= forecast.FRESH_FOR
                and self._apart(value, other)
            ):
                self.waiting.setdefault(other_feed, []).append((at, value))
        self.latest[feed] = (at, value)


@dataclass
class _Seat:
    """What every sample of one seat says, read once."""

    mixed: list[_Mixed]
    votes: Counter[str]
    #: The latest moment each organization was read for, for a tie of votes.
    last: dict[str, str]

    def home(self) -> str | None:
        """The organization most of the seat's samples without a UUID were read for."""

        if not self.votes:
            return None
        return max(
            self.votes, key=lambda organization: (self.votes[organization], self.last[organization])
        )


class Resolver:
    """The accounts of a set of seats, from two reads: every seat a UUID names, and every
    sample of these seats."""

    def __init__(self, conn: sqlite3.Connection, seats: Iterable[str]) -> None:
        cursor = conn.cursor()
        cursor.row_factory = None
        #: Each seat's accounts by UUID, as (organization, UUID).
        self._named: dict[str, set[tuple[str, str]]] = {}
        #: Each account's seats, as (organization, UUID) to the seats' weeks.
        self._weeks_of: dict[tuple[str, str], list[tuple[str, dt.datetime]]] = {}
        for organization, seat, uuid in cursor.execute(_NAMED):
            account = (str(organization), str(uuid))
            self._named.setdefault(str(seat), set()).add(account)
            self._weeks_of.setdefault(account, []).append((str(seat), _week_of(str(seat))))
        self._seats: dict[str, _Seat] = {}
        asked = sorted(set(seats))
        for seat in asked:
            self._seats[seat] = _Seat([_Mixed("week"), _Mixed("five_hour")], Counter(), {})
        if not asked:
            return
        for (
            seat,
            at,
            organization,
            session,
            uuid,
            kind,
            percent,
            resets_at,
            read_for,
        ) in cursor.execute(_OF_SEATS, (json.dumps(asked),)):
            facts = self._seats[seat]
            if uuid is None and read_for is not None:
                facts.votes[read_for] += 1
                facts.last[read_for] = at
            feed = (session or organization, uuid)
            if kind == "week" and percent is not None:
                facts.mixed[0].add(feed, _millis(at), float(percent))
            elif kind == "five_hour" and resets_at is not None:
                facts.mixed[1].add(feed, _millis(at), _millis(resets_at))

    def mixed(self, seat: str) -> bool:
        """Whether two counters run under this seat."""

        facts = self._seats.get(seat)
        return facts is not None and any(one.found for one in facts.mixed)

    def _continuing(self, organization: str, seat: str) -> tuple[str | None, bool]:
        """The UUID of the one account of `organization` whose week resets at this seat's
        time of week in the nearest week that has one, and which names no other seat within
        a week of it; with whether two accounts are tied for nearest."""

        slot, week = weekly_reset(seat), _week_of(seat)
        nearest: dict[dt.timedelta, set[str]] = {}
        for (owner, uuid), weeks in self._weeks_of.items():
            if owner != organization:
                continue
            if any(other != seat and abs(moment - week) < _WEEK for other, moment in weeks):
                continue
            apart = [abs(moment - week) for other, moment in weeks if weekly_reset(other) == slot]
            if apart:
                nearest.setdefault(min(apart), set()).add(uuid)
        if not nearest:
            return None, False
        found = nearest[min(nearest)]
        return (next(iter(found)), False) if len(found) == 1 else (None, True)

    def account(
        self, seat: str | None, organization: str | None, account_uuid: str | None
    ) -> Account | None:
        """The account of one sample: its seat, the organization it was read for (`None`
        where that is not known), and its own UUID. `None` where no account can be named."""

        slot = None if seat is None else weekly_reset(seat)
        if account_uuid is not None and organization is not None:
            return Account(organization, account_uuid, slot)
        if seat is None or slot is None:
            return None
        if self.mixed(seat):
            return None if organization is None else Account(organization, None, slot, True)
        named = self._named.get(seat, set())
        if organization is not None and any(owner == organization for owner, _ in named):
            return _named_in(organization, named, slot)
        if len(named) == 1:
            owner, uuid = next(iter(named))
            return Account(owner, uuid, slot)
        facts = self._seats.get(seat)
        home = (facts.home() if facts is not None else None) or organization
        if home is None:
            return None
        if any(owner == home for owner, _ in named):
            return _named_in(home, named, slot)
        carried, tied = self._continuing(home, seat)
        return Account(home, carried, slot, tied)


def _named_in(organization: str, named: set[tuple[str, str]], slot: str) -> Account:
    """The account of `organization` a seat's UUIDs name: the one, or with two the
    weekly-reset account, `shared`."""

    own = sorted(uuid for owner, uuid in named if owner == organization)
    if len(own) == 1:
        return Account(organization, own[0], slot)
    return Account(organization, None, slot, shared=True)


__all__ = [
    "WEEKLY",
    "WORKING_FOR",
    "Account",
    "Resolver",
    "is_account_key",
    "organization_at",
    "unknown_key",
    "weekly_reset",
]
