"""Which seat and account of its organization a stretch of usage was spent on, read when read.

A usage segment keeps the organization its requests were made for and no seat: changing
seats leaves no trace in a transcript, so the seat is joined at read time from the quota
samples instead, and a sample that arrives after the segment rewrites nothing.

A seat is a state, not the sample nearest in time: a sample is kept only when a value
changed, so a quiet stretch has no sample in it and the last one still says where things
stand. What says it is a feed: the samples with a seat that one identity (a session, or
an organization's poll and imports) made of one window (a kind and, for a model's week,
the model). A feed's latest sample at or before a moment is its state then, and that
state holds until the window resets: the sample's `resets_at`, or the end of the week its
seat names when that comes first, since a seat names one week. The next sample of the
feed replaces it, which taking the latest already says.

The rule for a segment: of the feeds whose latest sample at or before the segment's end
still holds at its start, the most recent sample names the seat. The feeds of the
segment's own session come first; only when none of them holds do the feeds of its
organization count: its poll's and imports', and another session's. A session's feed
counts for an organization when the session's own usage rows say it was working for that
organization at its latest sample's moment: the latest of its main run's segments begun at
or before then names it. A segment with no organization, or with no feed holding at it,
has no seat it can be shown to be on: `UNKNOWN`.

The account is what holds across weeks: the account's UUID the naming sample carries, or
else the one account of the organization whose samples name the same seat
(`account_of_seat`). A seat key names one week's reset, so the same key is the same week.
A seat no sample with a UUID names, or that two accounts' samples name, is provisional:
the seat is known for that week and its account is not.

`account_samples` is the one read of samples by account, for whatever reads the quota
of an account: the alerts and the Analytics read.
"""

from __future__ import annotations

import datetime as dt
import json
import operator
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import NamedTuple

from . import samples

#: The longest a sample's state can hold: a seat names the reset of the week the reading
#: was in, at most seven days on, rounded by up to five minutes. A feed whose latest sample
#: is older than this has lapsed, so a read looks no further back.
_LONGEST_HOLD = dt.timedelta(days=7, minutes=5)


@dataclass(frozen=True)
class Seat:
    """The seat a segment was spent on, what says so and whose it is, or the seat unknown.

    `basis` is `session` when a feed of the segment's own session named the seat and
    `organization` when only another feed of its organization did; `sample_at` is the time
    of that feed's sample. `account_uuid` is the account's UUID, `None` for a provisional
    seat. All four are `None` for a seat unknown.
    """

    seat: str | None
    basis: str | None
    sample_at: str | None
    account_uuid: str | None = None


UNKNOWN = Seat(None, None, None)


#: The organization a session was working for at a moment: the latest of its main run's
#: segments begun by then names it.
_WORKING_FOR = (
    "SELECT u.organization FROM usage_segments u WHERE u.session_id = {session}"
    " AND u.agent_id = '' AND u.started_at <= {at} ORDER BY u.started_at DESC, u.id DESC LIMIT 1"
)


def organization_at(conn: sqlite3.Connection, session_id: str, at: str) -> str | None:
    """The organization a session was working for at `at`, as its usage rows say; or None."""

    row = conn.execute(_WORKING_FOR.format(session="?", at="?"), (session_id, at)).fetchone()
    return None if row is None else row[0]


def account_of_seat(conn: sqlite3.Connection, organization: str, seat: str) -> str | None:
    """The UUID of the one account whose samples in `organization` name `seat`; or None."""

    found = conn.execute(
        "SELECT DISTINCT account_uuid FROM quota_samples WHERE organization = ? AND seat = ?"
        " AND account_uuid IS NOT NULL LIMIT 2",
        (organization, seat),
    ).fetchall()
    return str(found[0][0]) if len(found) == 1 else None


@dataclass(frozen=True)
class AccountSample:
    """One sample whose account can be named, with its organization and its account's UUID.

    `account_uuid` is the sample's own, or else the one `account_of_seat` gives its seat;
    `None` leaves the sample on its provisional seat, which it then always has.
    """

    at: str
    source: str
    organization: str
    seat: str | None
    account_uuid: str | None
    kind: str
    model: str | None
    percent: float | None
    resets_at: str | None


#: Every sample of some kinds since a moment, in the order they were made.
_SINCE = (
    "SELECT at, source, organization, session_id, account_uuid, seat, kind, model, percent,"
    " resets_at FROM quota_samples WHERE at >= ? AND at <= ? AND kind IN ({}) ORDER BY at, id"
)
#: Later than any moment the store writes: no upper bound.
_NEVER = "9999-12-31T23:59:59.999Z"


def account_samples(
    conn: sqlite3.Connection, since: str, kinds: tuple[str, ...], *, until: str | None = None
) -> list[AccountSample]:
    """The samples of `kinds` since `since`, and up to `until` when it is given, whose account
    can be named, oldest first.

    A session's sample takes the organization the session was working for at its moment
    (`organization_at`) and is passed over while that is not known. A sample with neither
    an account's UUID nor a seat names no account and is passed over too.
    """

    organizations: dict[tuple[str, str], str | None] = {}
    accounts: dict[tuple[str, str], str | None] = {}
    known: list[AccountSample] = []
    query = _SINCE.format(", ".join("?" * len(kinds)))
    for (
        at,
        source,
        organization,
        session,
        uuid,
        seat,
        kind,
        model,
        percent,
        resets_at,
    ) in conn.execute(query, (since, until or _NEVER, *kinds)):
        if uuid is None and seat is None:
            continue
        if organization is None:
            if (session, at) not in organizations:
                organizations[session, at] = organization_at(conn, session, at)
            organization = organizations[session, at]
            if organization is None:
                continue
        if uuid is None:
            if (organization, seat) not in accounts:
                accounts[organization, seat] = account_of_seat(conn, organization, seat)
            uuid = accounts[organization, seat]
        known.append(
            AccountSample(
                at,
                source,
                organization,
                seat,
                uuid,
                kind,
                model,
                None if percent is None else float(percent),
                resets_at,
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
    def feed(self) -> tuple[str | None, str | None, str, str | None]:
        return (self.organization, self.session_id, self.kind, self.model)

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
#: made, with the organization its identity worked for at its moment: an organization's
#: own, and a session's as `organization_at` says.
_SAMPLES_WORKING_FOR = (
    "SELECT id, at, organization, session_id, kind, model, seat, resets_at, account_uuid,"
    " CASE WHEN session_id IS NULL THEN organization ELSE ({working}) END"
    " FROM quota_samples q WHERE seat IS NOT NULL AND at BETWEEN ? AND ?"
    " AND (session_id IS NOT NULL OR organization IN (SELECT value FROM json_each(?)))"
    " ORDER BY at, id"
)
_SAMPLES = _SAMPLES_WORKING_FOR.format(
    working=_WORKING_FOR.format(session="q.session_id", at="q.at")
)
#: Every account a sample with a UUID names in these organizations, by its seat.
_ACCOUNTS = (
    "SELECT DISTINCT organization, seat, account_uuid FROM quota_samples"
    " WHERE account_uuid IS NOT NULL AND seat IS NOT NULL"
    " AND organization IN (SELECT value FROM json_each(?))"
)


class _State(NamedTuple):
    """A feed's sample with what deciding whether it holds at a segment needs, worked out
    once: the organization its identity worked for, and the two moments it holds between."""

    sample: _Sample
    working_for: str | None
    lapses_at: str
    #: The last start its seat can still be read for: `_LONGEST_HOLD` after it.
    reaches: str


def _most_recent_holding(
    feeds: dict[tuple, _State], start: str, organization: str, besides: str | None = None
) -> _Sample | None:
    """Of these feeds' latest samples, the most recent one still holding at `start` whose
    identity worked for `organization`, and is not the session `besides`; or None."""

    for state in reversed(feeds.values()):
        if state.reaches < start:
            # The feeds stand the most recent last: none before this one reaches.
            return None
        if (
            state.lapses_at > start
            and state.working_for == organization
            and (besides is None or state.sample.session_id != besides)
        ):
            return state.sample
    return None


def _later(moment: str, by: dt.timedelta) -> str:
    """A moment in the store's form, `by` later, in the same form."""

    later = dt.datetime.fromisoformat(moment).astimezone(dt.UTC) + by
    return later.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _accounts(cursor: sqlite3.Cursor, organizations: Sequence[str]) -> dict[tuple, str | None]:
    """`account_of_seat` for every seat of these organizations a UUID names, in one read."""

    named: dict[tuple[str, str], set[str]] = {}
    for organization, seat, account in cursor.execute(_ACCOUNTS, (json.dumps(organizations),)):
        named.setdefault((organization, seat), set()).add(str(account))
    return {key: next(iter(uuids)) if len(uuids) == 1 else None for key, uuids in named.items()}


def seats_of_segments(conn: sqlite3.Connection, segments: Sequence[Segment]) -> list[Seat]:
    """The seat of each segment, in their order, by the rule `seat_of_segment` states.

    Two reads serve any number of segments: the samples their weeks hold, each with the
    organization its identity worked for then, and the accounts their seats name. The
    segments are then taken in the order they end and the samples in the order they were
    made, so each feed's latest sample is known at each segment's end.
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
    organizations = sorted({str(segment.organization) for *_, segment in asked})
    earliest = _later(min(segment.started_at for *_, segment in asked), -_LONGEST_HOLD)
    # Plain tuples: a named row costs more than the rest of the read of a sample.
    cursor = conn.cursor()
    cursor.row_factory = None
    states = [
        _State(sample, row[-1], sample.lapses_at, _later(sample.at, _LONGEST_HOLD))
        for row in cursor.execute(_SAMPLES, (earliest, asked[-1][0], json.dumps(organizations)))
        for sample in (_Sample(*row[:-1]),)
    ]
    accounts = _accounts(cursor, organizations)
    latest: dict[tuple, _State] = {}
    # Each feed's latest sample, the most recent last: by the organization its identity
    # worked for, and a session's by its session too.
    holding: dict[str | None, dict[tuple, _State]] = {}
    own: dict[str, dict[tuple, _State]] = {}
    taken = 0
    for end, index, segment in asked:
        while taken < len(states) and states[taken].sample.at <= end:
            state = states[taken]
            taken += 1
            feed, session = state.sample.feed, state.sample.session_id
            before = latest.get(feed)
            if before is not None:
                holding[before.working_for].pop(feed)
                if session is not None:
                    own[session].pop(feed)
            latest[feed] = state
            holding.setdefault(state.working_for, {})[feed] = state
            if session is not None:
                own.setdefault(session, {})[feed] = state
        organization, start = str(segment.organization), segment.started_at
        mine = own.get(segment.session_id, {})
        naming, basis = _most_recent_holding(mine, start, organization), "session"
        if naming is None:
            others = holding.get(organization, {})
            naming = _most_recent_holding(others, start, organization, segment.session_id)
            basis = "organization"
        if naming is not None:
            account = naming.account_uuid or accounts.get((organization, naming.seat))
            found[index] = Seat(naming.seat, basis, naming.at, account)
    return found


def seat_of_segment(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    organization: str | None,
    started_at: str,
    ended_at: str,
) -> Seat:
    """The seat of one usage segment, from the feeds holding at it; `UNKNOWN` with none."""

    segment = Segment(
        session_id, organization, samples.instant(started_at), samples.instant(ended_at)
    )
    return seats_of_segments(conn, [segment])[0]


__all__ = [
    "UNKNOWN",
    "AccountSample",
    "Seat",
    "Segment",
    "account_of_seat",
    "account_samples",
    "organization_at",
    "seat_of_segment",
    "seats_of_segments",
    "week_end",
]
