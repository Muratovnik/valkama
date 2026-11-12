"""Which seat of its organization a stretch of usage was spent on, read when it is read.

A usage segment keeps the organization its requests were made for and no seat: changing
seats leaves no trace in a transcript, so the seat is joined at read time from the quota
samples instead, and a sample that arrives after the segment rewrites nothing.

The rule: the sample nearest in time to the segment, among the samples with a seat that
lie within `NEAR` of it, and of those the samples of the segment's own session first.
Only when its own session has none does a sample of the same organization count: one
the poll or an import made for that organization, or another session's that was then
working for it. A session's sample counts for an organization when the session's own
usage rows say it was working for that organization at the sample's moment: the latest
of its main run's segments begun at or before then names it. A segment with no
organization, or with no such sample near enough, has no seat it can be shown to be on:
`UNKNOWN`.
"""

from __future__ import annotations

import datetime as dt
import sqlite3
from dataclasses import dataclass

from . import samples

#: How far from a segment a sample may lie and still name its seat. The poll reads every
#: five to fifteen minutes and a session's source after each answer, but a sample is kept
#: only when its value changed, so an hour of unchanged work holds none: this is twice the
#: poll's longer interval, past which a seat change in between would go unseen.
NEAR = dt.timedelta(minutes=30)


@dataclass(frozen=True)
class Seat:
    """The seat a segment was spent on and what says so, or the seat unknown.

    `basis` is `session` when a sample of the segment's own session named the seat and
    `organization` when only another sample of its organization did; `sample_at` is that
    sample's time. All three are `None` for a seat unknown.
    """

    seat: str | None
    basis: str | None
    sample_at: str | None


UNKNOWN = Seat(None, None, None)


def organization_at(conn: sqlite3.Connection, session_id: str, at: str) -> str | None:
    """The organization a session was working for at `at`, as its usage rows say; or None."""

    row = conn.execute(
        "SELECT organization FROM usage_segments WHERE session_id = ? AND agent_id = ''"
        " AND started_at <= ? ORDER BY started_at DESC, id DESC LIMIT 1",
        (session_id, at),
    ).fetchone()
    return None if row is None else row[0]


def seat_of_segment(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    organization: str | None,
    started_at: str,
    ended_at: str,
) -> Seat:
    """The seat of one usage segment, from the samples near it; `UNKNOWN` with none."""

    if organization is None:
        return UNKNOWN
    start, end = dt.datetime.fromisoformat(started_at), dt.datetime.fromisoformat(ended_at)
    window = (
        samples.instant((start - NEAR).isoformat()),
        samples.instant((end + NEAR).isoformat()),
    )

    def distance(at: str) -> dt.timedelta:
        moment = dt.datetime.fromisoformat(at)
        if moment < start:
            return start - moment
        return max(moment - end, dt.timedelta(0))

    def nearest(rows: list[tuple[str, str]], basis: str) -> Seat | None:
        if not rows:
            return None
        seat, at = min(rows, key=lambda row: (distance(row[1]), row[1]))
        return Seat(seat, basis, at)

    own = [
        (str(seat), str(at))
        for seat, at in conn.execute(
            "SELECT seat, at FROM quota_samples WHERE session_id = ? AND seat IS NOT NULL"
            " AND at BETWEEN ? AND ? ORDER BY at, id",
            (session_id, *window),
        )
        if organization_at(conn, session_id, at) == organization
    ]
    found = nearest(own, "session")
    if found is not None:
        return found
    others = [
        (str(seat), str(at))
        for seat, at, sample_organization, sample_session in conn.execute(
            "SELECT seat, at, organization, session_id FROM quota_samples"
            " WHERE seat IS NOT NULL AND at BETWEEN ? AND ?"
            " AND (organization = ? OR (session_id IS NOT NULL AND session_id != ?))"
            " ORDER BY at, id",
            (*window, organization, session_id),
        )
        if sample_organization == organization
        or organization_at(conn, sample_session, at) == organization
    ]
    return nearest(others, "organization") or UNKNOWN


__all__ = ["NEAR", "UNKNOWN", "Seat", "organization_at", "seat_of_segment"]
