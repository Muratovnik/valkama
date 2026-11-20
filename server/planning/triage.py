"""The triage stack: the items that wait for a review in triage, and the review's mark.

An item waits in the stack when it stands in a state of the category `triage` and
nothing else decides it:

- it has no parent -- a finding, another task filed with none, a goal nobody has
  accepted -- or every goal and stage over it is accepted and open
  (`item_tree.accepted_chain`): a task that waits inside an accepted goal;
- and no question to the owner is open on it (`questions.OWNER_QUESTION`): the answer
  decides it. A request asked of an agent session and a list under a comment ask the
  owner nothing, and leave it in the stack.

An item under a goal or stage nobody has accepted is not in the stack: the answer
about that goal decides it.

An item entered the stack at its last state entry in history order (`standing.ENTERED_AT`),
or at its creation when the history records none: put-off work that came back and work
moved out of a goal enter it anew. The stack is read oldest entry first, then by the
space's key and the item's number, so a page cut by an offset holds each item once.

A review that saw an item and left it where it is marks it (`triage_marks`, `mark`).
The store takes the mark away (`store.TRIAGE_MARK_TRIGGERS`) when anything changes
what the review saw, so a mark stands only on an item in triage; it records no event
then, the write that took it away says why.

A space whose stack has grown past the owner's thresholds shows a line that it is
time for a review (`due`). It is read from the stack each time and stored nowhere, so
it goes once the stack is reviewed.

A store an earlier build wrote, attached and read as it is, lacks the tables the
stack is made of (`STACK_TABLES`): it has no stack, no mark and no line.

The module sits below the service, which calls it inside its writes and reads: it
reads and writes the store itself and imports none of the writes.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import timedelta

from . import leases, model, participation, questions, standing, store

#: The items of the spaces named, as one JSON array, that wait in the stack, each with
#: its entry and its mark. `accepted` climbs from each goal or stage with no parent
#: down through accepted open ones only, so an item under it stands in accepted open
#: goals and stages all the way up; `UNION` ends a cycle in a damaged store.
_WAITING = (
    "WITH RECURSIVE accepted(id) AS ("  # noqa: S608 - constant text
    " SELECT i.work_item_id FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " WHERE i.planning_space_id IN (SELECT value FROM json_each(:spaces))"
    f" AND i.parent_id IS NULL AND i.kind = '{model.CONTAINER_KIND}'"
    f" AND s.category = '{model.SERVICE_CATEGORY}'"
    " UNION SELECT w.work_item_id FROM accepted a JOIN work_items w ON w.parent_id = a.id"
    " JOIN workflow_states s ON s.state_id = w.state_id"
    f" WHERE w.kind = '{model.CONTAINER_KIND}' AND s.category = '{model.SERVICE_CATEGORY}')"
    f" SELECT i.work_item_id, p.key, i.number, {standing.ENTERED_AT} AS since,"
    " m.seen_at, m.author"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " LEFT JOIN triage_marks m ON m.work_item_id = i.work_item_id"
    " WHERE i.planning_space_id IN (SELECT value FROM json_each(:spaces))"
    " AND s.category = 'triage'"
    " AND (i.parent_id IS NULL OR i.parent_id IN (SELECT id FROM accepted))"
    " AND (:items IS NULL OR i.work_item_id IN (SELECT value FROM json_each(:items)))"
    " AND NOT EXISTS (SELECT 1 FROM work_item_requests r"
    f" WHERE r.work_item_id = i.work_item_id AND {questions.OWNER_QUESTION})"
    " ORDER BY since, p.key, i.number"
)
#: The tables the stack is read from: a store without one of them has no stack.
STACK_TABLES = ("triage_marks", "work_item_requests")
_SPACES_OF = (
    "SELECT DISTINCT planning_space_id FROM work_items"
    " WHERE work_item_id IN (SELECT value FROM json_each(?))"
)
_ENTERED = f"SELECT {standing.ENTERED_AT} FROM work_items i WHERE i.work_item_id = ?"  # noqa: S608 - constant text
_MARK = (
    "INSERT INTO triage_marks(work_item_id, seen_at, author, call_id)"
    " VALUES(?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?)"
    " ON CONFLICT(work_item_id) DO UPDATE SET seen_at = excluded.seen_at,"
    " author = excluded.author, call_id = excluded.call_id"
)
_SEEN_AT = "SELECT seen_at FROM triage_marks WHERE work_item_id = ?"
_UNMARK = "DELETE FROM triage_marks WHERE work_item_id = ?"
#: An item's state category, kind, parent and reference parts, for the reason it does not wait.
_HEAD = (
    "SELECT s.category, i.kind, i.parent_id, p.key, i.number FROM work_items i"
    " JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE i.work_item_id = ?"
)
_OPEN_OWNER_QUESTION = (
    "SELECT 1 FROM work_item_requests r WHERE r.work_item_id = ? AND "  # noqa: S608 - constant text
    + questions.OWNER_QUESTION
)
_SPACE = "SELECT key, name FROM planning_spaces WHERE planning_space_id = ?"


@dataclass(frozen=True)
class Waiting:
    """One item in the stack: where it is, when it entered, and its mark, if any."""

    work_item_id: str
    space_key: str
    number: int
    since: str
    seen_at: str | None
    seen_by: str | None


def waiting(
    conn: sqlite3.Connection, space: str | None = None, *, items: Iterable[str] | None = None
) -> list[Waiting]:
    """The stack of one space, by its id, or of every space, oldest entry first.

    With `items`, only those of them that wait in it, read in their own spaces when no
    space is named: whether an item may be marked, or what a card shows. A store
    without the stack's tables (`STACK_TABLES`) has none; they are looked for only
    when the read fails, so a current store's read costs no statement more.
    """

    named = None if items is None else json.dumps(sorted(set(items)))
    if space is not None:
        spaces = [space]
    elif named is not None:
        spaces = [str(row[0]) for row in conn.execute(_SPACES_OF, (named,))]
    else:
        spaces = [
            str(row[0]) for row in conn.execute("SELECT planning_space_id FROM planning_spaces")
        ]
    if not spaces:
        return []
    try:
        rows = conn.execute(_WAITING, {"spaces": json.dumps(spaces), "items": named}).fetchall()
    except sqlite3.OperationalError:
        if all(store.has_table(conn, table) for table in STACK_TABLES):
            raise
        return []
    return [
        Waiting(str(row[0]), str(row[1]), int(row[2]), str(row[3]), row[4], row[5]) for row in rows
    ]


def entered(conn: sqlite3.Connection, work_item_id: str) -> str | None:
    """When the item came to stand where it is, or None for an item the store lacks."""

    found = conn.execute(_ENTERED, (work_item_id,)).fetchone()
    return None if found is None else str(found[0])


def mark(
    conn: sqlite3.Connection,
    work_item_id: str,
    seen: bool,
    *,
    author: str,
    call_id: int | None,
) -> dict:
    """Set the review's mark on an item, or take it away, and say which.

    The caller has checked that the item waits in the stack (`waiting`) and records
    the write's event: this writes the row alone. Marking it again moves the mark to
    this call.
    """

    if not seen:
        conn.execute(_UNMARK, (work_item_id,))
        return {"cleared": True}
    conn.execute(_MARK, (work_item_id, author, call_id))
    return {"seen_at": str(conn.execute(_SEEN_AT, (work_item_id,)).fetchone()[0])}


def field(
    conn: sqlite3.Connection, ids: Iterable[str], space: str | None = None
) -> Mapping[str, dict]:
    """The `triage_stack` of each of these items that waits in the stack, in one read:
    `{seen_at, seen_by}`, both None for an item no review has marked. An item not in
    the stack has none. `space`, by id, is where they all lie, which spares a read of
    their spaces."""

    return {found.work_item_id: shown(found) for found in waiting(conn, space, items=ids)}


def shown(found: Waiting) -> dict:
    """An item's `triage_stack` as a record carries it."""

    return {"seen_at": found.seen_at, "seen_by": found.seen_by}


#: What the list's `triage_stack` filter takes: the items of the stack no review marked,
#: or those it did.
UNSEEN = "unseen"
SEEN = "seen"
FILTERS = frozenset({UNSEEN, SEEN})


def listed(conn: sqlite3.Connection, ids: Iterable[str], seen: str) -> list[Waiting]:
    """Those of these items that wait in the stack, unmarked (`UNSEEN`) or marked (`SEEN`),
    in the stack's order: oldest entry first, then by space key and number."""

    return [
        found for found in waiting(conn, items=ids) if (found.seen_at is not None) == (seen == SEEN)
    ]


def due(conn: sqlite3.Connection, settings: participation.Settings, space: str) -> dict | None:
    """The line that it is time to review the stack of one space, by its id, or None.

    It stands while the space's reminder is on (`triage_reminder`) and the items of its
    stack no review has marked are at least `triage_count`, or the oldest of them entered
    at least `triage_age_days` days ago by the Planning clock (`leases.utc_now`). It says
    how many there are and when the oldest entered; the reader counts the age, so the
    answer carries no clock of the server. A store an earlier build wrote has no stack
    (`waiting`), and no line.
    """

    if not settings.on(space, "triage_reminder"):
        return None
    unseen = [found for found in waiting(conn, space) if found.seen_at is None]
    if not unseen:
        return None
    oldest_at = unseen[0].since
    entered = leases.moment(oldest_at)
    aged = entered is not None and entered <= leases.utc_now() - timedelta(
        days=settings.number(space, "triage_age_days")
    )
    if len(unseen) < settings.number(space, "triage_count") and not aged:
        return None
    key, name = conn.execute(_SPACE, (space,)).fetchone()
    return {
        "space": {"key": str(key), "name": str(name)},
        "count": len(unseen),
        "oldest_at": oldest_at,
    }


def refusal(conn: sqlite3.Connection, work_item_id: str) -> str:
    """Why an item the store holds does not wait in the stack, in the words a refused mark gives.

    The first reason that holds decides: it is not in triage, it waits for the owner's
    answer, or it lies under the nearest goal or stage that nobody accepted. An item
    that waits gets the last line, which a caller that asks only of an item `waiting`
    lacks never reads.
    """

    category, _kind, parent, key, number = conn.execute(_HEAD, (work_item_id,)).fetchone()
    if category != "triage":
        return "it is not in triage"
    if conn.execute(_OPEN_OWNER_QUESTION, (work_item_id,)).fetchone() is not None:
        return "it waits for the owner's answer"
    current = parent
    while current is not None:
        category, kind, parent, key, number = conn.execute(_HEAD, (current,)).fetchone()
        # The stack's own rule (`_WAITING`): every goal or stage above must be accepted.
        if kind != model.CONTAINER_KIND or category != model.SERVICE_CATEGORY:
            return f"it lies under {model.human_id(str(key), int(number))}"
        current = parent
    return "it waits in the stack already"


__all__ = [
    "FILTERS",
    "SEEN",
    "UNSEEN",
    "Waiting",
    "due",
    "entered",
    "field",
    "listed",
    "mark",
    "refusal",
    "shown",
    "waiting",
]
