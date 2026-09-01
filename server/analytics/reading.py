"""Everything one dashboard projection reads from the store, read once.

Four questions with four answers: which space, which states it declares, which
work items and lane events it holds, and which sessions those items point at.
Every aggregate behind the projection is computed from these rows and issues no
query of its own, so one dashboard is one bounded set of reads.
"""

from __future__ import annotations

import datetime as _dt
import sqlite3
from collections import defaultdict
from dataclasses import dataclass

from .timeline import StateVocabulary, _row, _runtime_context


def space(conn: sqlite3.Connection, key: str | None) -> sqlite3.Row:
    """The space a request named, or the only one there is."""

    if key:
        row = conn.execute("SELECT * FROM planning_spaces WHERE key = ?", (key,)).fetchone()
    else:
        rows = conn.execute("SELECT * FROM planning_spaces ORDER BY key LIMIT 2").fetchall()
        if len(rows) != 1:
            raise ValueError("space key is required when there is not exactly one space")
        return rows[0]
    if not row:
        raise ValueError(f"no planning space keyed {key!r}")
    return row


def _states(conn: sqlite3.Connection, space_row: sqlite3.Row) -> StateVocabulary:
    """The space's own states, in workflow order, each with its category.

    Read from the store rather than declared here: the Board era hard-coded six
    lane names, so a renamed lane disappeared from every chart instead of being
    counted under its new name.
    """

    return tuple(
        (str(row["key"]), str(row["category"]))
        for row in conn.execute(
            "SELECT s.key, s.category FROM workflow_states s"
            " JOIN workflows w ON w.workflow_id = s.workflow_id"
            " WHERE w.planning_space_id = ? ORDER BY s.position",
            (str(space_row["planning_space_id"]),),
        )
    )


@dataclass(frozen=True)
class Vocabulary:
    """The states one space declares, in the three shapes the aggregates ask for."""

    states: StateVocabulary
    declared: list[str]
    categories: dict[str, str]
    #: Which states mean finished, asked of the category. The Board era compared
    #: against the literal "done", so a workflow that renamed it counted nothing.
    closing: set[str]


def vocabulary(conn: sqlite3.Connection, space_row: sqlite3.Row) -> Vocabulary:
    """Read one space's states and the three views taken of them."""

    states = _states(conn, space_row)
    return Vocabulary(
        states=states,
        declared=[name for name, _ in states],
        categories=dict(states),
        closing={name for name, category in states if category in {"completed", "cancelled"}},
    )


@dataclass(frozen=True)
class SessionLinks:
    """Which sessions the store's work items point at, and who ran them."""

    #: Sessions attached to an item in the space being projected, by item.
    by_item: dict[str, set[str]]
    #: Every session any work item points at, in any space. Membership is the
    #: whole question this answers: an analytics row from one of these belongs
    #: to another space rather than to nobody.
    linked_anywhere: set[str]
    clients: dict[str, set[str]]


@dataclass(frozen=True)
class SessionEvents:
    """The session event journal, with the two views taken of it."""

    rows: list[dict]
    by_session: dict[str, list[dict]]
    #: The launch context each session settled on as of the projected instant.
    contexts: dict[str, dict]


@dataclass(frozen=True)
class SpaceReading:
    """One space's rows, as the selection and the aggregates read them."""

    space_row: sqlite3.Row
    vocabulary: Vocabulary
    items: list[dict]
    events_by_item: dict[str, list[dict]]
    #: Stored identity to the reference a reader sees, and the reverse: the
    #: aggregates are keyed by the reference while the event rows are keyed by
    #: the identity.
    references: dict[str, str]
    item_ids: dict[str, str]
    links: SessionLinks
    events: SessionEvents

    @property
    def space_id(self) -> str:
        return str(self.space_row["planning_space_id"])


def _work_items(conn: sqlite3.Connection, space_id: str) -> list[dict]:
    return [
        _row(row)
        for row in conn.execute(
            "SELECT w.*, s.key AS state_key FROM work_items w"
            " JOIN workflow_states s ON s.state_id = w.state_id"
            " WHERE w.planning_space_id = ? ORDER BY w.number",
            (space_id,),
        ).fetchall()
    ]


def _item_events(conn: sqlite3.Connection, space_id: str) -> dict[str, list[dict]]:
    events_by_item: dict[str, list[dict]] = defaultdict(list)
    for row in conn.execute(
        "SELECT id, work_item_id, action, detail, author, created_at FROM work_item_events"
        " WHERE work_item_id IN (SELECT work_item_id FROM work_items WHERE planning_space_id = ?)"
        " ORDER BY created_at, id",
        (space_id,),
    ).fetchall():
        events_by_item[str(row["work_item_id"])].append(_row(row))
    return events_by_item


def _session_links(conn: sqlite3.Connection, space_id: str) -> SessionLinks:
    by_item: dict[str, set[str]] = defaultdict(set)
    linked_anywhere: set[str] = set()
    clients: dict[str, set[str]] = defaultdict(set)
    for row in conn.execute(
        "SELECT r.work_item_id, r.value, w.planning_space_id, s.client FROM work_item_refs r"
        " JOIN work_items w ON w.work_item_id = r.work_item_id"
        " LEFT JOIN sessions s ON s.id = r.value WHERE r.kind = 'session'",
    ).fetchall():
        session_id = str(row["value"])
        linked_anywhere.add(session_id)
        if row["client"]:
            clients[session_id].add(str(row["client"]))
        if str(row["planning_space_id"]) == space_id:
            by_item[str(row["work_item_id"])].add(session_id)
    return SessionLinks(by_item=by_item, linked_anywhere=linked_anywhere, clients=clients)


def _session_events(conn: sqlite3.Connection, *, as_of: _dt.datetime) -> SessionEvents:
    rows = [
        _row(row)
        for row in conn.execute(
            "SELECT e.id, e.session_id, e.klass, e.kind, e.tool, e.server, e.status, e.detail,"
            " e.created_at, s.client"
            " FROM session_events e LEFT JOIN sessions s ON s.id = e.session_id"
            " ORDER BY e.created_at, e.id"
        ).fetchall()
    ]
    by_session: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_session[str(row["session_id"])].append(row)
    return SessionEvents(
        rows=rows,
        by_session=by_session,
        contexts={
            session_id: _runtime_context(session_rows, as_of=as_of)
            for session_id, session_rows in by_session.items()
        },
    )


def read_space(
    conn: sqlite3.Connection,
    space_row: sqlite3.Row,
    space_vocabulary: Vocabulary,
    *,
    as_of: _dt.datetime,
) -> SpaceReading:
    """Read one space's items, lane events and session evidence as of one instant.

    The vocabulary arrives already read because the scope needs it to decide
    whether a status filter names a state this space has, and ``as_of`` arrives
    from that same scope because every session context is derived as of it.
    """

    space_id = str(space_row["planning_space_id"])
    items = _work_items(conn, space_id)
    references = {
        str(item["work_item_id"]): f"{space_row['key']}-{int(item['number'])}" for item in items
    }
    return SpaceReading(
        space_row=space_row,
        vocabulary=space_vocabulary,
        items=items,
        events_by_item=_item_events(conn, space_id),
        references=references,
        item_ids={reference: item_id for item_id, reference in references.items()},
        links=_session_links(conn, space_id),
        events=_session_events(conn, as_of=as_of),
    )
