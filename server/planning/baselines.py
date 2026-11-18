"""How many tasks stood under a goal or stage when it was accepted: the count a goal's
"was, now" reads beside the tasks under it now.

Which goal or stage a task stood under is not kept in the history, so the count is
taken when it happens and kept in `work_item_baselines`: the tasks (`task`, `bug`,
`improvement`) under it at any depth, in any state, the basis it was taken on and when.

- **Accepted.** A write that accepts a goal or stage with a task under it takes the
  count, `accepted`. Turning an accepted task into a goal or stage with the rest of
  its work under it is an acceptance too: the count is the tasks under it after.
- **Started.** A goal or stage accepted with no task under it gets no count then: a
  plan of nothing says nothing. The write that starts it -- the first task under it,
  at any depth, to get its start -- takes the count, `started`.
- **Gone.** Entering triage or deferred takes the acceptance away, and the count
  with it; accepted again, it is taken anew. A close keeps the acceptance and the count.
- **Migrated.** An acceptance the work-model migration gave has no count: how many
  tasks stood under it then is not known. A task accepted so and turned into a goal
  or stage keeps that basis, and gets none either.

`settle` runs once at the end of each write (`service.marking`), over the items the
write marked (`closing.note`) and every goal and stage above them: a task that starts
under a stage starts the goal over it as well.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping

from . import item_tree, model
from .closing import Stood

#: The two bases a count is taken on.
ACCEPTED, STARTED = model.BASELINE_BASES
#: The one basis whose acceptance takes no count.
MIGRATED = "migrated"

_ROWS = (
    "SELECT i.work_item_id, i.kind, i.acceptance, i.accepted_at, b.basis"
    " FROM work_items i LEFT JOIN work_item_baselines b ON b.work_item_id = i.work_item_id"
    " WHERE i.work_item_id IN (SELECT value FROM json_each(?))"
)
_TAKE = (
    "INSERT INTO work_item_baselines(work_item_id, tasks, basis, taken_at)"
    " VALUES(?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))"
    " ON CONFLICT(work_item_id) DO UPDATE SET tasks = excluded.tasks,"
    " basis = excluded.basis, taken_at = excluded.taken_at"
)
_DROP = "DELETE FROM work_item_baselines WHERE work_item_id = ?"


def settle(conn: sqlite3.Connection, marked: Mapping[str, Stood | None]) -> None:
    """Take, keep or drop the count of each goal or stage the write reached.

    `marked` is what the write marked, each with what it stood on before the write
    (`closing.Settled.marked`); the goals and stages over them are read with them.
    An item the write marked and changed the kind, basis or time of acceptance of was
    accepted by it; any other was accepted before, or is not accepted.
    """

    reached = _reached(conn, marked)
    if not reached:
        return
    rows = conn.execute(_ROWS, (json.dumps(sorted(reached)),)).fetchall()
    tree = item_tree.below(conn, reached)
    for identity, kind, basis, accepted_at, held in rows:
        found = str(identity)
        if kind != model.CONTAINER_KIND or basis is None or basis == MIGRATED:
            if held is not None:
                conn.execute(_DROP, (found,))
            continue
        accepted_now = found in marked and marked[found] != (kind, basis, accepted_at)
        tasks = _tasks_under(tree, found)
        if accepted_now:
            if tasks:
                conn.execute(_TAKE, (found, tasks, ACCEPTED))
            elif held is not None:
                conn.execute(_DROP, (found,))
        elif held is None and tree.started_at(found) is not None:
            conn.execute(_TAKE, (found, tasks, STARTED))


def _reached(conn: sqlite3.Connection, marked: Mapping[str, Stood | None]) -> list[str]:
    """The goals and stages among the items marked and over them, each once."""

    found: dict[str, None] = {}
    for identity in marked:
        if identity in found:
            # Reached as a goal or stage over another: what is over it is read already.
            continue
        for over, kind, _category in item_tree.above(conn, identity):
            if kind == model.CONTAINER_KIND:
                found[over] = None
    return list(found)


def _tasks_under(tree: item_tree.Tree, identity: str) -> int:
    """The tasks under a goal or stage, at any depth and in any state."""

    count = 0
    pending = list(tree.children.get(identity, ()))
    seen = set(pending)
    while pending:
        current = pending.pop()
        if not tree.nodes[current].container:
            count += 1
        for child in tree.children.get(current, ()):
            # A cycle is a damaged store; the count still ends.
            if child not in seen:
                seen.add(child)
                pending.append(child)
    return count
