"""The take-next queue's rule: which work it gives, and why it gives no other.

A task is given when it is in a ready state, nobody holds it or any step of it,
nothing unfinished blocks it, no question to the owner waits on it, its workflow
leads from where it stands into work, and no goal or stage over it is in triage
or deferred, closed, or waiting on a blocker. `withheld` says which of those fail,
as codes in one fixed order, and an item is `workable` exactly when it names none.
A read of one space that holds another space's item, for a project of the space
read it names, adds `outside_space`: the queue of the space read never gives it.

The rule has this one form, over facts a read loaded in bulk (`item_tree.Tree`),
so the queue and every record answer it the same way: the queue gives the items a
read of their space shows with nothing withheld. There is no query form of it.

The order is computed too, and nothing stores it. The key of work (`work_key`)
puts urgent work first, then work already started — which is also work the lease
sweep handed back, since it keeps its start — then the work of a goal or stage
already under way, then priority, then age. The queue gives its items by that key,
the smaller number first on a tie, and an item's `queue_order` is its place there.
Every read of many items stands on one total order (`list_key`): the state's place
in its workflow, the key of work, the space's key, the number. It reads stored
fields and the tree, never the clock or a lease, so a row moves only when a write
changes it; what the passing of time changes is its `queue_order` alone.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Sequence

from . import item_tree, model, states

#: Where each priority stands, highest first; urgent is also the key's first part.
_PRIORITY_ORDER = {"urgent": 0, "high": 1, "medium": 2, "low": 3}

#: The tasks of the spaces named, as one JSON array, standing in a category work is
#: given from, with their space's key: the only rows the queue can give.
_CANDIDATES = (
    "SELECT i.*, p.key AS space_key FROM work_items i"
    " JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE i.planning_space_id IN (SELECT value FROM json_each(?))"
    " AND s.category IN (SELECT value FROM json_each(?)) AND i.kind != ?"
)

#: Why the queue does not give an item, in the order `withheld` names them.
CODES = (
    #: It is a goal or a stage: nobody works one, and it has no other code.
    "goal_or_stage",
    #: It does not stand in a ready state.
    "not_ready",
    #: Somebody holds it, or a step of it.
    "held",
    #: An unfinished item blocks it.
    "waits",
    #: A question to the owner on it is open.
    "question",
    #: It is ready, and its workflow leads nowhere into work from its state.
    "no_start",
    #: A goal or stage over it is in triage, not yet accepted.
    "ancestor_triage",
    #: A goal or stage over it is deferred.
    "ancestor_deferred",
    #: An unfinished item blocks a goal or stage over it.
    "ancestor_waits",
    #: A goal or stage over it is closed while it is open.
    "ancestor_closed",
    #: A read of another space holds it, for a project of that space it names: the
    #: queue of the space read never gives it, whatever its own space's queue does.
    "outside_space",
)


def withheld(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    tree: item_tree.Tree,
    *,
    read_space: str | None = None,
) -> list[str]:
    """Why the queue of its space does not give this item; empty when it does.

    `row` is the item's own, and `tree` holds its facts and those of every item
    over it. A goal or stage is never given and says only that. Every other reason
    that holds is named. A task in a ready state is asked last whether its
    workflow can start it, and only that one: in any other state `not_ready`
    already says it is not given, and coming back to work from review or
    blocked is not starting it. That fact is the one that may cost a query,
    for one task's record, which loads no workflow (`states.start_state`).

    `read_space` is the space a read of one space is of, by id: an item of
    another space it holds is asked of that space's queue, and adds
    `outside_space`. Without it the item is asked of its own space's queue.
    """

    identity = str(row["work_item_id"])
    node = tree.node(identity)
    if node is None:
        raise model.PlanningError("work item disappeared mid-write")
    if node.container:
        return ["goal_or_stage"]
    found: list[str] = []
    ready = node.category in model.WORKABLE_CATEGORIES
    if not ready:
        found.append("not_ready")
    if row["claim_ref"] or any(step["claimed_by"] for step in model.checklist(row["checklist"])):
        found.append("held")
    if tree.waits_for(identity):
        found.append("waits")
    if tree.question(identity):
        found.append("question")
    if ready and not _startable(conn, row, tree.startable(identity)):
        found.append("no_start")
    ancestors = tree.ancestors(identity)
    over = [ancestor for ancestor in map(tree.node, ancestors) if ancestor is not None]
    if any(ancestor.category == "triage" for ancestor in over):
        found.append("ancestor_triage")
    if any(ancestor.category == "deferred" for ancestor in over):
        found.append("ancestor_deferred")
    if any(tree.waits_for(ancestor) for ancestor in ancestors):
        found.append("ancestor_waits")
    if not node.closed and any(ancestor.closed for ancestor in over):
        found.append("ancestor_closed")
    if read_space is not None and str(row["planning_space_id"]) != read_space:
        found.append("outside_space")
    return found


def _startable(conn: sqlite3.Connection, row: sqlite3.Row, loaded: bool | None) -> bool:
    """Whether a claim can start the item where it stands: what a read loaded, or asked now."""

    return states.start_state(conn, row) is not None if loaded is None else loaded


def work_key(row: sqlite3.Row, tree: item_tree.Tree) -> tuple[bool, bool, bool, int, str]:
    """The key of work, smaller first: urgent, started, under way above, priority, age.

    `row` carries the item's `work_item_id`, `parent_id`, `priority` and
    `created_at`; `tree` holds its space (`item_tree.of_spaces`). A goal or stage
    takes its parts from the same facts: its own priority, the earliest start under
    it, and the goal or stage over it. The nearest container is the parent, so a
    task of a stage not yet started under a goal under way is not under way.
    """

    priority = str(row["priority"])
    parent = row["parent_id"]
    under_way = parent is not None and tree.container_state(str(parent)) == "in_progress"
    return (
        priority != "urgent",
        tree.started_at(str(row["work_item_id"])) is None,
        not under_way,
        _PRIORITY_ORDER.get(priority, len(_PRIORITY_ORDER)),
        str(row["created_at"]),
    )


def list_key(
    row: sqlite3.Row, tree: item_tree.Tree
) -> tuple[float, tuple[bool, bool, bool, int, str], str, int]:
    """The total order of every read of many items, given and not given alike.

    The state's place in its workflow (`state_position`), the key of work, the
    space's key (`space_key`), the number: a space and a number name one item, so no
    two rows tie.
    """

    return (
        float(row["state_position"]),
        work_key(row, tree),
        str(row["space_key"]),
        int(row["number"]),
    )


def of_spaces(
    conn: sqlite3.Connection, space_ids: Iterable[str], tree: item_tree.Tree
) -> list[sqlite3.Row]:
    """What the queues of these spaces give, each in its order; `tree` holds the spaces.

    One statement, however many items: the tasks in a category work is given from,
    of which the rule keeps those with nothing withheld. One space's rows, in the
    order they come here, are its queue; between spaces a tie on the key of work
    goes to the smaller space key. A read does not release a lapsed lease, so an
    item whose lease lapsed reads held here until the sweep or the queue itself
    releases it.
    """

    named = sorted(set(space_ids))
    if not named:
        return []
    rows = conn.execute(
        _CANDIDATES,
        (json.dumps(named), json.dumps(model.WORKABLE_CATEGORIES), model.CONTAINER_KIND),
    ).fetchall()
    return sorted(
        (row for row in rows if not withheld(conn, row, tree)),
        key=lambda row: (work_key(row, tree), str(row["space_key"]), int(row["number"])),
    )


def places(given: Sequence[sqlite3.Row]) -> dict[str, int]:
    """Each given item's `queue_order`: its 1-based place in its own space's queue."""

    counted: dict[str, int] = {}
    found: dict[str, int] = {}
    for row in given:
        space = str(row["planning_space_id"])
        counted[space] = counted.get(space, 0) + 1
        found[str(row["work_item_id"])] = counted[space]
    return found
