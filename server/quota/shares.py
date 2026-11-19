"""How much of each account's week some usage took: the quota of a card's work.

The rows are a card's usage segments, its own or its tree's. Each row's seat is the one
`seats.seats_of_segments` gives it, and a seat is one account's week. In that week the
rows' share is their cost at API prices divided by the cost of every segment of their
organization on the same seat, theirs and others'. The week's percent is the `percent`
of the latest `week` sample of that seat, so the rows took `share` times that percent of it.

That assumes a quota is spent in proportion to the API price, which no published formula
confirms, and the week's percent counts work the store never saw, other clients' and a
browser chat's, while the share counts only recorded rows. So the figure leans high, and
a reader shows it as approximate.

Rows on no seat that can be shown stand in `unknown_share`: their part of the rows' cost.
Weeks of different accounts are never added: no figure here is a sum of percentages, the
rule the account quota read keeps too. A share is rounded here, to four places, and a
percent to two.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from collections.abc import Sequence

from . import samples, seats

#: The kind of sample whose percent is a week's.
_WEEK = "week"
#: How long before its seat's week ends a sample can name it: the week, rounded by up to
#: five minutes. A segment on a seat ends no earlier than the sample that names it.
_WEEK_LENGTH = dt.timedelta(days=7, minutes=5)
#: Every segment of these organizations that a seat in the span can hold.
_SEGMENTS_OF = (
    "SELECT session_id, organization, started_at, ended_at, estimated_api_cost_usd"
    " FROM usage_segments WHERE organization IN (SELECT value FROM json_each(?))"
    " AND ended_at >= ? AND started_at < ?"
)

#: The columns of a usage row the seat rule reads, in `seats.Segment`'s order.
_READ = ("session_id", "organization", "started_at", "ended_at")

#: A seat of an organization: one account's week.
_Place = tuple[str, str]


def _before(moment: str, by: dt.timedelta) -> str:
    """A moment in the store's form, `by` earlier, in the same form."""

    return samples.instant((dt.datetime.fromisoformat(moment) - by).isoformat())


def _segment(
    session: object, organization: object, started: object, ended: object
) -> seats.Segment:
    """A usage row as the seat rule reads it."""

    return seats.Segment(
        str(session), None if organization is None else str(organization), str(started), str(ended)
    )


def _cost(value: float | None) -> float:
    """A row's cost at API prices, a row with none adding nothing."""

    return 0.0 if value is None else float(value)


def _places(
    conn: sqlite3.Connection, segments: Sequence[seats.Segment]
) -> list[tuple[_Place | None, str | None]]:
    """Each segment's place, its organization and seat, with the UUID of the seat's account
    where one is known; or None."""

    found = seats.seats_of_segments(conn, segments)
    return [
        (None, None)
        if seat.seat is None
        else (
            (str(segment.organization), seat.seat),
            None if seat.account is None else seat.account.account_uuid,
        )
        for segment, seat in zip(segments, found, strict=True)
    ]


def _place_costs(conn: sqlite3.Connection, places: set[_Place]) -> dict[_Place, float]:
    """What every segment on each of these places cost, whoever's work it was."""

    ends = [seats.week_end(seat) for _, seat in places]
    organizations = sorted({organization for organization, _ in places})
    cursor = conn.cursor()
    cursor.row_factory = None
    rows = cursor.execute(
        _SEGMENTS_OF,
        (json.dumps(organizations), _before(min(ends), _WEEK_LENGTH), max(ends)),
    ).fetchall()
    costs: dict[_Place, float] = {}
    for row, (place, _) in zip(
        rows, _places(conn, [_segment(*row[:4]) for row in rows]), strict=True
    ):
        if place in places:
            costs[place] = costs.get(place, 0.0) + _cost(row[4])
    return costs


def _week_percents(conn: sqlite3.Connection, places: set[_Place]) -> dict[_Place, float | None]:
    """The percent of each place's week its latest `week` sample gives; absent with none."""

    ends = [seats.week_end(seat) for _, seat in places]
    latest: dict[_Place, seats.AccountSample] = {}
    for sample in seats.account_samples(
        conn, _before(min(ends), _WEEK_LENGTH), (_WEEK,), until=max(ends)
    ):
        place = (sample.organization, str(sample.seat))
        if place in places:
            held = latest.get(place)
            if held is None or (sample.at, sample.percent or 0.0) >= (held.at, held.percent or 0.0):
                latest[place] = sample
    return {place: sample.percent for place, sample in latest.items()}


def of_segments(conn: sqlite3.Connection, rows: Sequence[sqlite3.Row]) -> dict:
    """The quota these usage rows took: one line per account's week they worked in, the
    newest first, and the part of their cost on no seat that can be shown.

    A row is read by its `session_id`, `organization`, `started_at`, `ended_at` and
    `estimated_api_cost_usd`. A week whose seat's segments cost nothing has no share, and a
    week no `week` sample of its seat reads has no percent; `unknown_share` is None when the
    rows cost nothing.
    """

    placed = _places(conn, [_segment(*(row[name] for name in _READ)) for row in rows])
    spent: dict[_Place, float] = {}
    accounts: dict[_Place, set[str | None]] = {}
    unknown = whole = 0.0
    for row, (place, account) in zip(rows, placed, strict=True):
        cost = _cost(row["estimated_api_cost_usd"])
        whole += cost
        if place is None:
            unknown += cost
            continue
        spent[place] = spent.get(place, 0.0) + cost
        accounts.setdefault(place, set()).add(account)
    places = set(spent)
    costs = _place_costs(conn, places) if places else {}
    percents = _week_percents(conn, places) if places else {}
    weeks = []
    for place in sorted(places, key=lambda one: (seats.week_end(one[1]), one), reverse=True):
        organization, seat = place
        named = accounts[place]
        total = costs.get(place, 0.0)
        share = spent[place] / total if total > 0 else None
        used = percents.get(place)
        weeks.append(
            {
                "account": {
                    "organization": organization,
                    # A seat whose segments name two accounts names none of them.
                    "account_uuid": next(iter(named)) if len(named) == 1 else None,
                },
                "seat": seat,
                "week_ends_at": seats.week_end(seat),
                "share": None if share is None else round(share, 4),
                "week_used_percent": used,
                "percent": None if share is None or used is None else round(share * used, 2),
            }
        )
    return {
        "weeks": weeks,
        "unknown_share": round(unknown / whole, 4) if whole > 0 else None,
    }


__all__ = ["of_segments"]
