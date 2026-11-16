"""The take-next queue's rule: which work it gives, and why it gives no other.

A task is given when it is in a ready state, nobody holds it or any step of it,
nothing unfinished blocks it, no question to the owner waits on it, its workflow
leads from where it stands into work, and no goal or stage over it is in triage
or deferred, closed, or waiting on a blocker. `withheld` says which of those fail,
as codes in one fixed order, and an item is `workable` exactly when it names none.

The rule has this one form, over facts a read loaded in bulk (`item_tree.Tree`),
so the queue and every record answer it the same way: the queue gives the items a
read of their space shows with nothing withheld. There is no query form of it.
"""

from __future__ import annotations

import sqlite3

from . import item_tree, model, states

#: Why the queue does not give an item, in the order `withheld` names them.
CODES = (
    #: It is a goal or a stage: nobody works one, and it has no other code.
    "container",
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
)


def withheld(conn: sqlite3.Connection, row: sqlite3.Row, tree: item_tree.Tree) -> list[str]:
    """Why the queue of its space does not give this item; empty when it does.

    `row` is the item's own, and `tree` holds its facts and those of every item
    over it. A container is never given and says only that. Every other reason
    that holds is named. A task in a ready state is asked last whether its
    workflow can start it, and only that one: in any other state `not_ready`
    already says it is not given, and coming back to work from review or
    blocked is not starting it. That fact is the one that may cost a query,
    for one task's record, which loads no workflow (`states.start_state`).
    """

    identity = str(row["work_item_id"])
    node = tree.node(identity)
    if node is None:
        raise model.PlanningError("work item disappeared mid-write")
    if node.container:
        return ["container"]
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
    return found


def _startable(conn: sqlite3.Connection, row: sqlite3.Row, loaded: bool | None) -> bool:
    """Whether a claim can start the item where it stands: what a read loaded, or asked now."""

    return states.start_state(conn, row) is not None if loaded is None else loaded
