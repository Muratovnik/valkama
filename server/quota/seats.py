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
import sqlite3
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


def organization_at(conn: sqlite3.Connection, session_id: str, at: str) -> str | None:
    """The organization a session was working for at `at`, as its usage rows say; or None."""

    row = conn.execute(
        "SELECT organization FROM usage_segments WHERE session_id = ? AND agent_id = ''"
        " AND started_at <= ? ORDER BY started_at DESC, id DESC LIMIT 1",
        (session_id, at),
    ).fetchone()
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
    " resets_at FROM quota_samples WHERE at >= ? AND kind IN ({}) ORDER BY at, id"
)


def account_samples(
    conn: sqlite3.Connection, since: str, kinds: tuple[str, ...]
) -> list[AccountSample]:
    """The samples of `kinds` since `since` whose account can be named, oldest first.

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
    ) in conn.execute(query, (since, *kinds)):
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


def _week_end(seat: str) -> str:
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

        week_end = _week_end(self.seat)
        return week_end if self.resets_at is None else min(self.resets_at, week_end)


#: Every sample with a seat of the feeds a read looks at, in the order they were made.
_FEED_SAMPLES = (
    "SELECT id, at, organization, session_id, kind, model, seat, resets_at, account_uuid"
    " FROM quota_samples WHERE seat IS NOT NULL AND at BETWEEN ? AND ? AND ({})"
    " ORDER BY at, id"
)
_OWN = _FEED_SAMPLES.format("session_id = ?")
_OTHERS = _FEED_SAMPLES.format("organization = ? OR (session_id IS NOT NULL AND session_id != ?)")


def seat_of_segment(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    organization: str | None,
    started_at: str,
    ended_at: str,
) -> Seat:
    """The seat of one usage segment, from the feeds holding at it; `UNKNOWN` with none."""

    if organization is None:
        return UNKNOWN
    start, end = samples.instant(started_at), samples.instant(ended_at)
    since = samples.instant((dt.datetime.fromisoformat(start) - _LONGEST_HOLD).isoformat())

    def holding(query: str, values: tuple[str, ...], basis: str) -> Seat | None:
        latest: dict[tuple[str | None, str | None, str, str | None], _Sample] = {}
        for row in conn.execute(query, (since, end, *values)):
            sample = _Sample(*row)
            latest[sample.feed] = sample
        found: _Sample | None = None
        for sample in latest.values():
            if sample.lapses_at <= start:
                continue
            if sample.session_id is not None and (
                organization_at(conn, sample.session_id, sample.at) != organization
            ):
                continue
            if found is None or (sample.at, sample.id) > (found.at, found.id):
                found = sample
        if found is None:
            return None
        account = found.account_uuid or account_of_seat(conn, organization, found.seat)
        return Seat(found.seat, basis, found.at, account)

    return (
        holding(_OWN, (session_id,), "session")
        or holding(_OTHERS, (organization, session_id), "organization")
        or UNKNOWN
    )


__all__ = [
    "UNKNOWN",
    "AccountSample",
    "Seat",
    "account_of_seat",
    "account_samples",
    "organization_at",
    "seat_of_segment",
]
