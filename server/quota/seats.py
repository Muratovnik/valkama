"""Which seat and account a stretch of usage was spent on, read when read.

A usage segment keeps the organization its requests were made for and no seat: changing
seats leaves no trace in a transcript, so the seat is joined at read time from the quota
samples instead, and a sample that arrives after the segment rewrites nothing.

A seat is a state, not the sample nearest in time: a sample is kept only when a value
changed, so a quiet stretch has no sample in it and the last one still says where things
stand. What says it is a feed: the samples with a seat that one identity (a session, or
an organization's poll and imports of one account) made of one window (a kind and, for a
model's week, the model). A feed's latest sample at or before a moment is its state then,
and that state holds until the window resets: the sample's `resets_at`, or the end of the
week its seat names when that comes first, since a seat names one week. The next sample of
the feed replaces it, which taking the latest already says.

Each sample's account is `accounts.Resolver`'s, decided from every sample of its seat; the
organization a feed counts for is its account's. The rule for a segment, of the feeds
counting for the segment's organization:

1. Its own session's: of those whose latest sample at or before the segment's end still
   holds at its start, the most recent names the seat.
2. With none holding, its own session's next sample after the segment's end, where that
   sample counts for the same organization and names the week the segment ended in: a
   reading is taken as a turn ends, so the first one after a stretch with none before it
   names the account that served it.
3. Otherwise its organization's other feeds holding at its start -- its poll's and
   imports', and other sessions' -- where all of them are one account's: the most recent
   names the seat. Feeds of two accounts holding leave the account unknown, since any of
   them may have spent it.

A segment with no organization, or with no account any rule gives, is `UNKNOWN`.

`account_samples` is the one read of samples by account, for whatever reads the quota
of an account: the alerts and the Analytics read. Each sample it gives names its feed,
which the forecast reads to tell a counter zeroed inside its window from a stale reading
(`forecast.count`).
"""

from __future__ import annotations

import bisect
import datetime as dt
import operator
import sqlite3
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import NamedTuple

from . import accounts, samples
from . import store as quota_store

#: The longest a sample's state can hold: a seat names the reset of the week the reading
#: was in, at most seven days on, rounded by up to five minutes. A feed whose latest sample
#: is older than this has lapsed, so a read looks no further back, and a session's next
#: sample is looked for no further on.
_LONGEST_HOLD = dt.timedelta(days=7, minutes=5)
_WEEK = dt.timedelta(days=7)


@dataclass(frozen=True)
class Seat:
    """The seat a segment was spent on, what says so and whose it is, or the seat unknown.

    `basis` is `session` when a sample of the segment's own session named the seat and
    `organization` when only another feed of its organization did; `sample_at` is the time
    of that sample. `account` is the seat's (`accounts.Resolver`). All four are `None` for a
    seat unknown.
    """

    seat: str | None
    basis: str | None
    sample_at: str | None
    account: accounts.Account | None = None


UNKNOWN = Seat(None, None, None)


@dataclass(frozen=True)
class AccountSample:
    """One sample whose account can be named, with that account (`accounts.Resolver`)."""

    at: str
    source: str
    account: accounts.Account
    seat: str | None
    kind: str
    model: str | None
    percent: float | None
    resets_at: str | None
    #: The session that read it; `None` for an organization's poll and imports.
    session_id: str | None = None

    @property
    def organization(self) -> str:
        return self.account.organization

    @property
    def account_uuid(self) -> str | None:
        return self.account.account_uuid

    @property
    def feed(self) -> str:
        """The feed it belongs to within its account's window: its session's, or else its
        organization's poll and imports, which are one feed."""

        if self.session_id is not None:
            return f"session:{self.session_id}"
        return f"organization:{self.organization}"


#: Every sample of some kinds since a moment, in the order they were made, with the
#: organization it was read for: an organization's own, a session's as
#: `accounts.organization_at` says.
_SINCE = (
    "SELECT at, source, organization, session_id, account_uuid, seat, kind, model, percent,"
    " resets_at, CASE WHEN session_id IS NULL THEN organization ELSE ({working}) END"
    " FROM quota_samples q WHERE at >= ? AND at <= ? AND kind IN ({kinds}) ORDER BY at, id"
)
#: Later than any moment the store writes: no upper bound.
_NEVER = "9999-12-31T23:59:59.999Z"


def _since(
    conn: sqlite3.Connection, since: str, until: str | None, kinds: tuple[str, ...]
) -> tuple[list[tuple], accounts.Resolver]:
    """The rows of `_SINCE`, and the accounts of their seats."""

    query = _SINCE.format(
        working=accounts.WORKING_FOR.format(session="q.session_id", at="q.at"),
        kinds=", ".join("?" * len(kinds)),
    )
    rows = conn.execute(query, (since, until or _NEVER, *kinds)).fetchall()
    return rows, accounts.Resolver(conn, (row[5] for row in rows if row[5] is not None))


def organizations_read(conn: sqlite3.Connection, since: str, sources: tuple[str, ...]) -> set[str]:
    """The organizations the samples of `sources` since `since` count for: each sample's
    account's, or, where no account can be named, the one it was read for."""

    rows, resolver = _since(conn, since, None, quota_store.KINDS)
    found: set[str] = set()
    for _, source, _, _, uuid, seat, *_, read_for in rows:
        if source not in sources:
            continue
        account = resolver.account(seat, read_for, uuid)
        organization = read_for if account is None else account.organization
        if organization is not None:
            found.add(str(organization))
    return found


def account_samples(
    conn: sqlite3.Connection, since: str, kinds: tuple[str, ...], *, until: str | None = None
) -> list[AccountSample]:
    """The samples of `kinds` since `since`, and up to `until` when it is given, whose account
    can be named, oldest first. A sample no account can be named for is passed over."""

    rows, resolver = _since(conn, since, until, kinds)
    known: list[AccountSample] = []
    for at, source, _, session, uuid, seat, kind, model, percent, resets_at, read_for in rows:
        account = resolver.account(seat, read_for, uuid)
        if account is None:
            continue
        known.append(
            AccountSample(
                at,
                source,
                account,
                seat,
                kind,
                model,
                None if percent is None else float(percent),
                resets_at,
                session,
            )
        )
    return known


def week_end(seat: str) -> str:
    """The reset a seat names, as the store writes a time: `week:…T09:00Z` is 09:00:00.000Z."""

    return seat.removeprefix("week:").removesuffix("Z") + ":00.000Z"


class _Sample(NamedTuple):
    """One sample with a seat, as a read of the feeds takes it."""

    id: int
    at: str
    organization: str | None
    session_id: str | None
    kind: str
    model: str | None
    seat: str
    resets_at: str | None
    account_uuid: str | None

    @property
    def feed(self) -> tuple[str | None, str | None, str, str | None, str | None]:
        """A session's window, or an organization's window of one account."""

        uuid = self.account_uuid if self.session_id is None else None
        return (self.organization, self.session_id, self.kind, self.model, uuid)

    @property
    def lapses_at(self) -> str:
        """When its state stops holding: its window's reset, or its seat's week's end."""

        ends = week_end(self.seat)
        return ends if self.resets_at is None else min(self.resets_at, ends)


class Segment(NamedTuple):
    """A usage segment as the seat rule reads it: its session, its organization, and its
    times in the store's form, `2030-03-04T09:00:00.000Z`, as the usage rows keep them."""

    session_id: str
    organization: str | None
    started_at: str
    ended_at: str


#: Every sample with a seat a read of these segments can look at, in the order they were
#: made, with the organization it was read for: an organization's own, and a session's as
#: `accounts.organization_at` says.
_SAMPLES_READ_FOR = (
    "SELECT id, at, organization, session_id, kind, model, seat, resets_at, account_uuid,"
    " CASE WHEN session_id IS NULL THEN organization ELSE ({working}) END"
    " FROM quota_samples q WHERE seat IS NOT NULL AND at BETWEEN ? AND ? ORDER BY at, id"
)
_SAMPLES = _SAMPLES_READ_FOR.format(
    working=accounts.WORKING_FOR.format(session="q.session_id", at="q.at")
)


class _State(NamedTuple):
    """A feed's sample with what deciding whether it holds at a segment needs, worked out
    once: its account, and the two moments it holds between."""

    sample: _Sample
    account: accounts.Account | None
    lapses_at: str
    #: The last start its seat can still be read for: `_LONGEST_HOLD` after it.
    reaches: str

    @property
    def counts_for(self) -> str | None:
        """The organization the feed counts for: its account's."""

        return None if self.account is None else self.account.organization


def _holding(
    feeds: dict[tuple, _State], start: str, organization: str, besides: str | None = None
) -> Iterator[_State]:
    """Of these feeds' latest samples, those still holding at `start` that count for
    `organization` and are not of the session `besides`, the most recent first."""

    for state in reversed(feeds.values()):
        if state.reaches < start:
            # The feeds stand the most recent last: none before this one reaches.
            return
        if (
            state.lapses_at > start
            and state.counts_for == organization
            and (besides is None or state.sample.session_id != besides)
        ):
            yield state


def _later(moment: str, by: dt.timedelta) -> str:
    """A moment in the store's form, `by` later, in the same form."""

    later = dt.datetime.fromisoformat(moment).astimezone(dt.UTC) + by
    return later.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _seat(state: _State, basis: str) -> Seat:
    return Seat(state.sample.seat, basis, state.sample.at, state.account)


def _next_own(
    mine: Sequence[_State], times: Sequence[str], end: str, organization: str
) -> _State | None:
    """The session's next sample after `end`, where it counts for `organization` and names
    the week `end` falls in; or None."""

    index = bisect.bisect_right(times, end)
    if index == len(mine):
        return None
    state = mine[index]
    week_ends = week_end(state.sample.seat)
    if state.counts_for != organization or not _later(week_ends, -_WEEK) <= end < week_ends:
        return None
    return state


def _one_account(states: Iterator[_State]) -> _State | None:
    """The most recent of these states where all of them are one account's; or None."""

    first = next(states, None)
    if first is None or first.account is None:
        return None
    for state in states:
        if state.account is None or state.account.key != first.account.key:
            return None
    return first


def seats_of_segments(conn: sqlite3.Connection, segments: Sequence[Segment]) -> list[Seat]:
    """The seat of each segment, in their order, by the rule the module states.

    Three reads serve any number of segments: the samples their weeks hold, each with the
    organization it was read for; every seat a UUID names; and every sample of the seats
    read, for their accounts (`accounts.Resolver`). The segments are then taken in the order
    they end and the samples in the order they were made, so each feed's latest sample is
    known at each segment's end.
    """

    found = [UNKNOWN] * len(segments)
    asked = sorted(
        (
            (segment.ended_at, index, segment)
            for index, segment in enumerate(segments)
            if segment.organization is not None
        ),
        key=operator.itemgetter(0),
    )
    if not asked:
        return found
    earliest = _later(min(segment.started_at for *_, segment in asked), -_LONGEST_HOLD)
    latest = _later(asked[-1][0], _LONGEST_HOLD)
    # Plain tuples: a named row costs more than the rest of the read of a sample.
    cursor = conn.cursor()
    cursor.row_factory = None
    rows = cursor.execute(_SAMPLES, (earliest, latest)).fetchall()
    resolver = accounts.Resolver(conn, {row[6] for row in rows})
    states = []
    for row in rows:
        sample = _Sample(*row[:-1])
        account = resolver.account(sample.seat, row[-1], sample.account_uuid)
        states.append(_State(sample, account, sample.lapses_at, _later(sample.at, _LONGEST_HOLD)))
    # Each session's samples in the order they were made, for the next one after a segment.
    by_session: dict[str, list[_State]] = {}
    for state in states:
        if state.sample.session_id is not None:
            by_session.setdefault(state.sample.session_id, []).append(state)
    times = {session: [one.sample.at for one in mine] for session, mine in by_session.items()}
    latest_of: dict[tuple, _State] = {}
    # Each feed's latest sample, the most recent last: by the organization it counts for,
    # and a session's by its session too.
    holding: dict[str | None, dict[tuple, _State]] = {}
    own: dict[str, dict[tuple, _State]] = {}
    taken = 0
    for end, index, segment in asked:
        while taken < len(states) and states[taken].sample.at <= end:
            state = states[taken]
            taken += 1
            feed, session = state.sample.feed, state.sample.session_id
            before = latest_of.get(feed)
            if before is not None:
                holding[before.counts_for].pop(feed)
                if session is not None:
                    own[session].pop(feed)
            latest_of[feed] = state
            holding.setdefault(state.counts_for, {})[feed] = state
            if session is not None:
                own.setdefault(session, {})[feed] = state
        organization, start, session = (
            str(segment.organization),
            segment.started_at,
            segment.session_id,
        )
        naming = next(_holding(own.get(session, {}), start, organization), None)
        if naming is None and session in by_session:
            naming = _next_own(by_session[session], times[session], end, organization)
        if naming is not None:
            found[index] = _seat(naming, "session")
            continue
        others = _one_account(_holding(holding.get(organization, {}), start, organization, session))
        if others is not None:
            found[index] = _seat(others, "organization")
    return found


def seat_of_segment(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    organization: str | None,
    started_at: str,
    ended_at: str,
) -> Seat:
    """The seat of one usage segment, by the rule the module states; `UNKNOWN` with none."""

    segment = Segment(
        session_id, organization, samples.instant(started_at), samples.instant(ended_at)
    )
    return seats_of_segments(conn, [segment])[0]


__all__ = [
    "UNKNOWN",
    "AccountSample",
    "Seat",
    "Segment",
    "account_samples",
    "seat_of_segment",
    "seats_of_segments",
    "week_end",
]
