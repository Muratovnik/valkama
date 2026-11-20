"""The summary of agent decisions: what an agent decided on its own, for the owner to read.

At a participation point where the owner's setting let an agent go ahead without
asking -- a goal it proposed and accepted, a decision it answered by its own
recommendation, a cancel, a close -- and at an acceptance by assignment, the point
marks the event that recorded the action with `mark`. The mark is a row beside the
event, not a record of its own: when it happened, on which item and in which
session are the event's and its call's, so the summary and the item's history name
one event and cannot part. A mark Valkama's call writes for an agent, as a cancel the
sessions agreed to, names the session of the call that asked it, as the waiting action
keeps it. Deleting the event, or its item, deletes the mark.

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

from . import calls, composed, item_projects, model
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


def mark(conn: sqlite3.Connection, event_id: int, point: str, what: composed.Text | str) -> None:
    """Mark the event that recorded an agent's own decision at `point`, saying `what`.

    `what` is a short line the point composes (`composed.decision`), such as `accepted
    MAIN-12 under MAIN-3`, stored with the key and values it was composed of; a text
    alone, as a waiting action stored before keys carries it, is stored without them.
    A text longer than `WHAT_LIMIT` is cut; its values are not. An event is marked once.
    A point unknown
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
    text = " ".join(composed.plain(what).split())
    if not text:
        raise ValueError("a decision says what was decided")
    if len(text) > WHAT_LIMIT:
        text = text[: WHAT_LIMIT - 1] + "…"
    key, values = (
        (what.key, model.dumps(dict(what.values)))
        if isinstance(what, composed.Text)
        else (None, None)
    )
    conn.execute(
        "INSERT INTO agent_decisions(event_id, point, what, what_key, what_values)"
        " VALUES(?, ?, ?, ?, ?)",
        (event_id, point, text, key, values),
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
#: A mark's rows, with the call that decided: the event's, or, where the event's call
#: carried out a waiting action of the mark's point on its item, as Valkama's call makes
#: the cancel the sessions agreed to, the call that asked that action (`asked_call`).
_ROWS = (
    "SELECT d.event_id, d.point, d.what, d.what_key, d.what_values, e.created_at, e.author,"
    " w.work_item_id,"
    " w.number, w.title, s.key, c.identity_state, c.identity_source, c.session_id, c.agent_id"
    + _FROM
    + " LEFT JOIN pending_actions a ON a.ended_call = e.call_id"
    " AND a.work_item_id = e.work_item_id AND a.point = d.point AND a.outcome = 'carried_out'"
    " LEFT JOIN execution_events c ON c.id = COALESCE(a.asked_call, e.call_id)"
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
                "what_message": _message(row),
                "event_id": int(row["event_id"]),
            }
            for row in rows
        ],
        "total": total,
        "has_more": offset + len(rows) < total,
    }


def _message(row: sqlite3.Row) -> dict | None:
    """The key and values `what` was composed of; None on a mark written before keys."""

    if row["what_key"] is None:
        return None
    return {"key": row["what_key"], "values": json.loads(row["what_values"])}


def _session(row: sqlite3.Row) -> str:
    """Who decided: the session the call proved, as a holder is named, else the event's author."""

    if row["identity_state"] == calls.CONFIRMED and row["session_id"] is not None:
        held = calls.channel_holder(
            str(row["identity_source"]), str(row["session_id"]), row["agent_id"]
        )
        if held is not None:
            return held
    return str(row["author"])
