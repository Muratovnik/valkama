"""The summary of agent decisions: what an agent decided on its own, for the owner to read.

At a participation point where the owner's setting let an agent go ahead without
asking -- a goal it proposed and accepted, a decision it answered by its own
recommendation, a cancel, a close -- and at an acceptance by assignment, the point
marks the event that recorded the action with `mark`. The mark is a row beside the
event, not a record of its own: when it happened, on which item and in which
session are the event's and its call's, so the summary and the item's history name
one event and cannot part. Deleting the event, or its item, deletes the mark.

Which event each point marks is fixed (`EVENTS`): a mark on any other is the
point's own mistake, refused before anything is written.

`page` reads the marks newest first, narrowed by point, space, project and period.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

from . import calls, item_projects, model
from . import store as planning_store

#: Every point a decision is marked at.
POINTS = planning_store.DECISION_POINTS
_POINT_SET = frozenset(POINTS)
#: The actions of the events each point marks: an acceptance its `accepted`, an answer
#: its `request_answered`, a cancel, a close or a putting off its `transitioned`, a
#: condition's change its `checklist_replaced`. A finding decided in triage is marked on
#: the event that recorded the answer: its acceptance, or its move to deferred or
#: cancelled.
EVENTS: dict[str, frozenset[str]] = {
    "finding": frozenset({"accepted", "transitioned"}),
    "proposed_goal": frozenset({"accepted"}),
    "task_in_goal": frozenset({"accepted"}),
    "decision": frozenset({"request_answered"}),
    "cancel_outside": frozenset({"transitioned"}),
    "cancel_shared": frozenset({"transitioned"}),
    "condition": frozenset({"checklist_replaced"}),
    "goal_close": frozenset({"transitioned"}),
    "goal_defer": frozenset({"transitioned"}),
    "assignment": frozenset({"accepted"}),
}
#: How long `what` may be; a longer text is cut, the ellipsis counted.
WHAT_LIMIT = 300
#: The most marks one page holds, and how many a page holds when the reader names none.
PAGE_MOST = 200
PAGE_DEFAULT = 50

_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
#: The form events record their time in, which a bound of a period is compared in.
_STAMP = "%Y-%m-%dT%H:%M:%SZ"


def mark(conn: sqlite3.Connection, event_id: int, point: str, what: str) -> None:
    """Mark the event that recorded an agent's own decision at `point`, saying `what`.

    `what` is a short line the point writes, such as `accepted MAIN-12 under MAIN-3`;
    one longer than `WHAT_LIMIT` is cut. An event is marked once. A point unknown
    here, an event that is not there or not of the action the point marks, and an
    empty `what` are the caller's mistakes and raise `ValueError`.
    """

    if point not in _POINT_SET:
        raise ValueError(f"no decision point {point!r}")
    found = conn.execute("SELECT action FROM work_item_events WHERE id = ?", (event_id,)).fetchone()
    if found is None:
        raise ValueError(f"no event {event_id} to mark")
    if str(found[0]) not in EVENTS[point]:
        raise ValueError(f"{point} marks no {found[0]} event")
    text = " ".join(what.split())
    if not text:
        raise ValueError("a decision says what was decided")
    if len(text) > WHAT_LIMIT:
        text = text[: WHAT_LIMIT - 1] + "…"
    conn.execute(
        "INSERT INTO agent_decisions(event_id, point, what) VALUES(?, ?, ?)",
        (event_id, point, text),
    )


def _bound(value: str, field: str, *, end: bool) -> str:
    """One end of the period as events record time.

    A day is a whole UTC day: `from` starts at its first second and `to` takes in
    its last. A timestamp names its timezone and is taken to the second, inward.
    """

    if _DAY.fullmatch(value):
        try:
            day = date.fromisoformat(value)
        except ValueError as error:
            raise model.PlanningError(f"{field} must be a day or an ISO timestamp") from error
        start = datetime(day.year, day.month, day.day, tzinfo=UTC)
        return (start + timedelta(days=1, seconds=-1) if end else start).strftime(_STAMP)
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise model.PlanningError(f"{field} must be a day or an ISO timestamp") from error
    if moment.tzinfo is None:
        raise model.PlanningError(f"{field} must include a timezone")
    moment = moment.astimezone(UTC)
    if moment.microsecond and not end:
        moment += timedelta(seconds=1)
    return moment.replace(microsecond=0).strftime(_STAMP)


_FROM = (
    " FROM agent_decisions d JOIN work_item_events e ON e.id = d.event_id"
    " JOIN work_items w ON w.work_item_id = e.work_item_id"
    " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id"
)
_ROWS = (
    "SELECT d.event_id, d.point, d.what, e.created_at, e.author, w.work_item_id,"
    " w.number, w.title, s.key, c.identity_state, c.identity_source, c.session_id, c.agent_id"
    + _FROM
    + " LEFT JOIN execution_events c ON c.id = e.call_id"
)


def page(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    project: str | None = None,
    points: Sequence[str] = (),
    start: str | None = None,
    end: str | None = None,
    limit: int = PAGE_DEFAULT,
    offset: int = 0,
) -> dict:
    """One page of the decisions marked, newest first, with how many there are in all.

    `space` is a space's id; `project` narrows to the items naming the project, a
    goal or stage by the tasks under it; `points` to those points, every one when
    empty; `start` and `end` (a day or a timestamp) to the period, both ends in.
    """

    if not 1 <= limit <= PAGE_MOST:
        raise model.PlanningError(f"limit must be from 1 to {PAGE_MOST}")
    offset = model.count_field(offset, "offset")
    clauses: list[str] = []
    parameters: list[object] = []
    if space is not None:
        clauses.append("w.planning_space_id = ?")
        parameters.append(space)
    if project is not None:
        named = item_projects.naming(conn, [item_projects.project_id(project, "project")])
        clauses.append("w.work_item_id IN (SELECT value FROM json_each(?))")
        parameters.append(json.dumps(named))
    if points:
        wanted = sorted({model.enum_field(point, _POINT_SET, "point") for point in points})
        clauses.append("d.point IN (SELECT value FROM json_each(?))")
        parameters.append(json.dumps(wanted))
    if start is not None:
        clauses.append("e.created_at >= ?")
        parameters.append(_bound(start, "from", end=False))
    if end is not None:
        clauses.append("e.created_at <= ?")
        parameters.append(_bound(end, "to", end=True))
    where = "".join((" WHERE " if index == 0 else " AND ") + c for index, c in enumerate(clauses))
    total = int(conn.execute("SELECT COUNT(*)" + _FROM + where, parameters).fetchone()[0])
    rows = conn.execute(
        _ROWS + where + " ORDER BY d.event_id DESC LIMIT ? OFFSET ?",
        (*parameters, limit, offset),
    ).fetchall()
    projects = item_projects.ids_of_items(conn, [str(row["work_item_id"]) for row in rows])
    return {
        "items": [
            {
                "at": row["created_at"],
                "point": row["point"],
                "item": {
                    "reference": model.human_id(str(row["key"]), int(row["number"])),
                    "title": row["title"],
                    "space": row["key"],
                    "projects": sorted(projects[str(row["work_item_id"])]),
                },
                "session": _session(row),
                "what": row["what"],
                "event_id": int(row["event_id"]),
            }
            for row in rows
        ],
        "total": total,
        "has_more": offset + len(rows) < total,
    }


def _session(row: sqlite3.Row) -> str:
    """Who decided: the session the call proved, as a holder is named, else the event's author."""

    if row["identity_state"] == calls.CONFIRMED and row["session_id"] is not None:
        held = calls.channel_holder(
            str(row["identity_source"]), str(row["session_id"]), row["agent_id"]
        )
        if held is not None:
            return held
    return str(row["author"])
