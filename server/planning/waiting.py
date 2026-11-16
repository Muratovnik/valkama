"""Words a person left on a goal or stage while nobody worked there, kept for the next session.

For a task this needs no table: `from_person` tells whichever agent writes to it
next. A container is never held, so what a person says on one reaches only the
sessions working under it (`participants`), and when there are none it would reach
nobody. Who was listening cannot be read back later, since no history of a
session's liveness is kept, so the row is written when it is known: in the same
transaction as the act nobody heard.

A row (`work_item_waiting_notices`) names its container, its scope -- `tree`, for
work under the container, or `space`, for work anywhere in its space -- the call
its words start at and the call that left it. One row per container and scope
stands open: a later act adds no row, since a delivery reads everything from the
row's call on.

- **Left.** A person's act on a container, any of those `person_events` tells or an
  edit, while no live session hears it (`participants.heard`), leaves a `tree` row
  (`after_person`). A stage that writes for the server leaves one with `leave`.
- **What waits.** A person's acts, and the records Valkama makes in a call of its
  own whose kind asks for a session (`person_events.SERVER_ASKS`): both wake whoever
  works there, so both are lost on nobody (`person_events.unheard`).
- **Recovered.** A participant can stop without saying so: its lease runs out, and
  whatever a person said after its last call reached nobody, since the server
  cannot see what a client hook told it. `recover` looks for such acts on the
  containers over the work a lapsed session left, once nobody hears them, and
  leaves a row from the first of them. `service._expire` calls it for every claim
  it releases, inside its own call, so the row names that call.
- **Delivered.** A claim of a task or of one of its steps by an agent session a
  client proved takes every open row on the containers over the task (`tree`) and
  in its space (`space`), in the claim's own transaction: a claim that is refused
  and rolled back leaves them open. The row records the session, its agent, the
  call and the time; the agent reads the words in its answer (`delivered`).

A row never lapses: words are not stale because nobody was there to hear them.
A delivered one stays as the record of who got them, and a row goes with its item.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from . import calls, item_tree, model, participants, person_events, read_model

TREE = "tree"
SPACE = "space"
SCOPES = (TREE, SPACE)

_LEAVE = (
    "INSERT INTO work_item_waiting_notices(work_item_id, scope, from_call, created_call)"
    " VALUES(?,?,?,?) ON CONFLICT(work_item_id, scope) WHERE delivered_call IS NULL"
    # An open row already holds every word from its own call on; one found to start
    # earlier is read from there.
    " DO UPDATE SET from_call = min(from_call, excluded.from_call)"
)
#: The open rows a claim of a task takes: on the containers over it, and in its space.
_DELIVER = (
    "UPDATE work_item_waiting_notices SET delivered_session = ?, delivered_agent = ?,"
    " delivered_call = ?, delivered_at = ?"
    " WHERE delivered_call IS NULL AND ("
    "(scope = 'tree' AND work_item_id IN (SELECT value FROM json_each(?)))"
    " OR (scope = 'space' AND work_item_id IN"
    " (SELECT work_item_id FROM work_items WHERE planning_space_id = ?)))"
)
_DELIVERED = (
    "SELECT n.work_item_id, n.from_call FROM work_item_waiting_notices n"
    " WHERE n.delivered_call = ? ORDER BY n.notice_id"
)
#: A delivered row that gave its session the act at a call: it started at or before
#: that call and was delivered after it.
_COVERED = (
    "SELECT 1 FROM work_item_waiting_notices WHERE work_item_id = ? AND scope = 'tree'"
    " AND delivered_call IS NOT NULL AND from_call <= ? AND delivered_call > ?"
)
#: The last Planning call a session made, its subagents' included.
_LAST_CALL = "SELECT MAX(id) FROM execution_events WHERE session_id = ? AND kind = ?"


@dataclass(frozen=True)
class Place:
    """How far the history and the comments reached before a write: what it adds comes after."""

    event: int
    comment: int


def leave(
    conn: sqlite3.Connection, work_item_id: str, scope: str, *, from_call: int | None = None
) -> bool:
    """Leave the words on `work_item_id` from `from_call` on for the next session, in this call.

    `from_call` defaults to the call in progress, which the row names as the one that
    left it either way. An open row of the container and scope already stands for
    every later word, so it is kept, read from the earlier of the two calls. Outside
    any call nothing is left, since a row must name the call that left it; the answer
    says whether a row stands open now.
    """

    if scope not in SCOPES:
        raise model.PlanningError(f"waiting words have no scope {scope!r}")
    call = calls.call_id(conn, work_item_id)
    if call is None:
        return False
    conn.execute(_LEAVE, (work_item_id, scope, call if from_call is None else from_call, call))
    return True


def place(conn: sqlite3.Connection) -> Place:
    """Where the history and the comments end now, read before a person's write."""

    event, comment = conn.execute(
        "SELECT (SELECT coalesce(MAX(id), 0) FROM work_item_events),"
        " (SELECT coalesce(MAX(id), 0) FROM work_item_comments)"
    ).fetchone()
    return Place(int(event), int(comment))


def after_person(conn: sqlite3.Connection, before: Place) -> int:
    """Leave a `tree` row on each container this person's write told something nobody hears.

    The containers are the ones the write recorded an event or a comment on past
    `before`, and the one its call row names, where an edit is recorded. What counts
    as told is what `person_events` tells for this call; a write that told nothing,
    such as a drag in its column, leaves nothing. Nor does filing a goal or a stage,
    though it opens one accepted: an item a person filed says what it says, in the
    description an agent reads when it takes work there. How many rows stand open
    for it is the answer.
    """

    call = calls.written(conn)
    if call is None or not calls.by_person():
        return 0
    identity, named = call
    touched: set[str] = set()
    filed: set[str] = set()
    for work_item_id, action, call_id in conn.execute(
        "SELECT work_item_id, action, call_id FROM work_item_events WHERE id > ?"
        " UNION ALL SELECT work_item_id, NULL, call_id FROM work_item_comments WHERE id > ?",
        (before.event, before.comment),
    ):
        touched.add(str(work_item_id))
        if action == "created" and call_id == identity:
            filed.add(str(work_item_id))
    if named is not None:
        touched.add(named)
    left = 0
    for work_item_id in sorted(_containers_of(conn, touched - filed)):
        if not person_events.since_call(conn, work_item_id, identity - 1):
            continue
        if participants.heard(conn, work_item_id):
            continue
        left += leave(conn, work_item_id, TREE)
    return left


def deliver(conn: sqlite3.Connection, row: sqlite3.Row) -> int:
    """Hand the open rows over the task of `row` to the agent session claiming it; how many.

    Only an agent's call whose session its client proved takes them: the person
    and Valkama never do, and nor does a session nobody proved, so the words wait
    on for a session that can be told.
    """

    identity = calls.current()
    if (
        identity is None
        or not calls.from_agent()
        or identity.state != calls.CONFIRMED
        or not identity.session_id
    ):
        return 0
    task = str(row["work_item_id"])
    call = calls.call_id(conn, task)
    over = [found for found, _kind, _category in item_tree.above(conn, task) if found != task]
    at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return conn.execute(
        _DELIVER,
        (
            identity.session_id,
            identity.agent_id or "",
            call,
            at,
            json.dumps(over),
            str(row["planning_space_id"]),
        ),
    ).rowcount


def delivered(conn: sqlite3.Connection, call: int) -> list[dict]:
    """The words the rows delivered by `call` hold, for the claiming agent's answer.

    One entry per row: the container's `reference` and `title`, and `said`, what
    waits on it from the row's call on (`person_events.unheard`), in the entries of `from_person`,
    the newest `person_events.MOST_SHOWN`, with `omitted` counting the earlier ones.
    """

    found = []
    for work_item_id, from_call in conn.execute(_DELIVERED, (call,)).fetchall():
        container = read_model.item_by_id(conn, str(work_item_id))
        said = [
            entry
            for _call, entry in person_events.unheard(conn, str(work_item_id), int(from_call) - 1)
        ]
        shown = said[-person_events.MOST_SHOWN :]
        entry: dict = {
            "reference": read_model.reference(conn, container),
            "title": str(container["title"]),
            "said": shown,
        }
        if len(said) > len(shown):
            entry["omitted"] = len(said) - len(shown)
        found.append(entry)
    return found


def recover(conn: sqlite3.Connection, lapsed: Iterable[tuple[str, str]]) -> int:
    """Leave a `tree` row where a lapsed session took words with it; how many stand open.

    `lapsed` pairs a session that stopped working with an item it stopped working
    on: a task whose claim lapsed, a container it followed. For each container over
    that item (the item too, when it is one) that no live session hears any more, what
    waits there (`person_events.unheard`) after the last call of the sessions gone from it reached
    nobody: after its last call a session heard nothing, since it called nothing. A
    row is left from the first of it, in the call in progress, unless a row delivered
    after that already gave it to a session.
    """

    gone: dict[str, int] = {}
    for session, work_item_id in lapsed:
        last = conn.execute(_LAST_CALL, (session, calls.KIND)).fetchone()[0]
        if last is None:
            # A session with no call of its own held and followed nothing here.
            continue
        for container in _over(conn, work_item_id):
            gone[container] = max(gone.get(container, 0), int(last))
    left = 0
    for container, last in sorted(gone.items()):
        if participants.heard(conn, container):
            continue
        found = person_events.unheard(conn, container, last)
        if not found:
            continue
        first = found[0][0]
        if conn.execute(_COVERED, (container, first, first)).fetchone() is not None:
            continue
        left += leave(conn, container, TREE, from_call=first)
    return left


def _over(conn: sqlite3.Connection, work_item_id: str) -> list[str]:
    """The containers over an item, the item first when it is one, nearest first."""

    return [
        found
        for found, kind, _category in item_tree.above(conn, work_item_id)
        if kind == model.CONTAINER_KIND
    ]


def _containers_of(conn: sqlite3.Connection, identities: set[str]) -> set[str]:
    if not identities:
        return set()
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT work_item_id FROM work_items WHERE kind = ?"
            " AND work_item_id IN (SELECT value FROM json_each(?))",
            (model.CONTAINER_KIND, json.dumps(sorted(identities))),
        )
    }
