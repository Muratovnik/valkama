"""What a record derives from the items around it: a container's state, a start, a wait.

A container's state is never stored. An accepted open goal or stage stands in the
workflow's service state, and what a reader sees of it is worked out at every read
from three facts about the work under it:

- whether it had children: it has some now, or a `child_left` event says one left;
- whether any child is open: its stored category is neither completed nor cancelled,
  so a child in triage or deferred is open, and a child container is open until it
  is closed or cancelled;
- whether any descendant started: some item under it, at any depth, has a
  `started_at`. The work under a closed stage counts; work moved out does not.

No children is `not_started`. Children and none open is `awaiting_confirmation`,
even when every one was cancelled before it began: confirming is where the owner
decides what a goal whose work was all cancelled is for. Children with one open is
`in_progress` once anything under it started, and `not_started` until then.

A container records no start of its own: it started when the first thing under it
did. A record also says which open items block it, `waits_for`, by reference.

The rule is stated once, here, over a `Tree` of loaded facts, and every read asks
it: one item's record loads the tree below that item, and a read of many items
loads the whole of their spaces in one statement, however many containers they
hold, so a board of a thousand items costs no statement per container.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from . import model

#: What an accepted open container derives, in the order the work goes through them.
CONTAINER_STATES = ("not_started", "in_progress", "awaiting_confirmation")

#: The facts of each item the rule reads, from its row and its state's. An attached
#: store an earlier build wrote is read as it is: it records no start, and its
#: `{started}` reads as null there.
_FACTS = (
    "SELECT i.work_item_id, i.parent_id, i.kind, {started}, s.category,"
    " CASE WHEN i.kind = 'container' THEN EXISTS (SELECT 1 FROM work_item_events e"
    "  WHERE e.work_item_id = i.work_item_id AND e.action = 'child_left') ELSE 0 END"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
)
#: Every item of the spaces named, as one JSON array.
_SPACES = _FACTS + " WHERE i.planning_space_id IN (SELECT value FROM json_each(?))"  # noqa: S608 - constant text
#: The items named, as one JSON array, and everything under each, at any depth.
_BELOW = (
    "WITH RECURSIVE below(id) AS (SELECT value FROM json_each(?)"  # noqa: S608 - constant text
    " UNION SELECT w.work_item_id FROM below b JOIN work_items w ON w.parent_id = b.id)"
    + _FACTS
    + " JOIN below b ON b.id = i.work_item_id"
)
#: The open items that block each item named: its open blockers, by reference.
_WAITS = (
    "SELECT l.to_id, p.key, b.number FROM work_item_links l"
    " JOIN work_items b ON b.work_item_id = l.from_id"
    " JOIN workflow_states bs ON bs.state_id = b.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = b.planning_space_id"
    " WHERE l.kind = 'blocks' AND bs.is_terminal = 0 AND l.to_id IN ({targets})"
    " ORDER BY l.to_id, p.key, b.number"
)
_WAITS_IN_SPACES = _WAITS.format(
    targets="SELECT work_item_id FROM work_items"
    " WHERE planning_space_id IN (SELECT value FROM json_each(?))"
)
_WAITS_ON_ITEMS = _WAITS.format(targets="SELECT value FROM json_each(?)")


def _facts(conn: sqlite3.Connection, query: str) -> str:
    """The query with the start each row records, or null where the store has none."""

    recorded = conn.execute(
        "SELECT 1 FROM pragma_table_info('work_items') WHERE name = 'started_at'"
    ).fetchone()
    return query.format(started="i.started_at" if recorded else "NULL")


@dataclass(frozen=True)
class _Node:
    parent_id: str | None
    container: bool
    #: Accepted and open: a container standing in the service state.
    accepted_open: bool
    #: Its stored category is completed or cancelled.
    closed: bool
    started_at: str | None
    #: A `child_left` event names a child that left it.
    lost_child: bool


@dataclass(frozen=True)
class Tree:
    """The loaded facts of some items, and the rule that reads them."""

    nodes: Mapping[str, _Node]
    waits: Mapping[str, tuple[str, ...]]
    children: Mapping[str, tuple[str, ...]] = field(init=False)

    def __post_init__(self) -> None:
        children: dict[str, list[str]] = {}
        for identity, node in self.nodes.items():
            if node.parent_id is not None:
                children.setdefault(node.parent_id, []).append(identity)
        object.__setattr__(
            self, "children", {parent: tuple(found) for parent, found in children.items()}
        )

    def container_state(self, identity: str) -> str | None:
        """What an accepted open container derives; None for any other item."""

        node = self.nodes.get(identity)
        if node is None or not node.accepted_open:
            return None
        children = self.children.get(identity, ())
        if not children and not node.lost_child:
            return "not_started"
        if not any(not self.nodes[child].closed for child in children):
            return "awaiting_confirmation"
        return "in_progress" if self._first_start(identity) is not None else "not_started"

    def started_at(self, identity: str) -> str | None:
        """When the item started: a task's own record, a container's earliest descendant's."""

        node = self.nodes.get(identity)
        if node is None:
            return None
        return self._first_start(identity) if node.container else node.started_at

    def waits_for(self, identity: str) -> list[str]:
        """The open items that block this one, by reference; none for a closed item."""

        node = self.nodes.get(identity)
        if node is not None and node.closed:
            return []
        return list(self.waits.get(identity, ()))

    def _first_start(self, identity: str) -> str | None:
        found: str | None = None
        pending = list(self.children.get(identity, ()))
        seen = set(pending)
        while pending:
            current = pending.pop()
            started = self.nodes[current].started_at
            if started is not None and (found is None or started < found):
                found = started
            for child in self.children.get(current, ()):
                # A cycle is a damaged store; the rule still ends.
                if child not in seen:
                    seen.add(child)
                    pending.append(child)
        return found


def _node(row: sqlite3.Row | tuple[object, ...]) -> _Node:
    container = str(row[2]) == model.CONTAINER_KIND
    return _Node(
        parent_id=None if row[1] is None else str(row[1]),
        container=container,
        accepted_open=container and str(row[4]) == model.SERVICE_CATEGORY,
        closed=str(row[4]) in model.TERMINAL_CATEGORIES,
        started_at=None if row[3] is None else str(row[3]),
        lost_child=bool(row[5]),
    )


def _waits(rows: Iterable[sqlite3.Row]) -> dict[str, tuple[str, ...]]:
    found: dict[str, list[str]] = {}
    for target, key, number in rows:
        found.setdefault(str(target), []).append(model.human_id(str(key), int(number)))
    return {target: tuple(references) for target, references in found.items()}


def of_spaces(conn: sqlite3.Connection, space_ids: Iterable[str]) -> Tree:
    """Every item of these spaces: two statements, whatever the spaces hold."""

    spaces = json.dumps(sorted(set(space_ids)))
    return Tree(
        nodes={str(row[0]): _node(row) for row in conn.execute(_facts(conn, _SPACES), (spaces,))},
        waits=_waits(conn.execute(_WAITS_IN_SPACES, (spaces,))),
    )


def below(conn: sqlite3.Connection, identities: Iterable[str]) -> Tree:
    """The items named and everything under them, with what blocks the items named.

    Two statements, however many items: what a read of a few items, such as the
    other ends of a record's links, derives from.
    """

    unique = sorted(set(identities))
    if not unique:
        return Tree(nodes={}, waits={})
    named = json.dumps(unique)
    return Tree(
        nodes={str(row[0]): _node(row) for row in conn.execute(_facts(conn, _BELOW), (named,))},
        waits=_waits(conn.execute(_WAITS_ON_ITEMS, (named,))),
    )


#: An item and every item over it, nearest first: its id, its kind and its state's
#: category. The climb stops after as many steps as its space has items, so a cycle
#: in a damaged store ends instead of looping.
_ABOVE = (
    "WITH RECURSIVE above(id, depth) AS (SELECT ?, 0"
    " UNION ALL SELECT w.parent_id, a.depth + 1 FROM above a"
    " JOIN work_items w ON w.work_item_id = a.id"
    " WHERE w.parent_id IS NOT NULL AND a.depth < (SELECT COUNT(*) FROM work_items"
    "  WHERE planning_space_id = (SELECT planning_space_id FROM work_items WHERE work_item_id = ?)))"
    " SELECT a.id, i.kind, s.category FROM above a JOIN work_items i ON i.work_item_id = a.id"
    " JOIN workflow_states s ON s.state_id = i.state_id ORDER BY a.depth"
)


def above(conn: sqlite3.Connection, identity: str) -> list[tuple[str, str, str]]:
    """`identity` and every item over it up to the root, nearest first, in one statement.

    Each is its id, its stored kind and its state's category: what the rules of a
    parent read, the cycle a new parent would close and the chain of accepted
    containers an item inherits its acceptance from.
    """

    return [
        (str(row[0]), str(row[1]), str(row[2]))
        for row in conn.execute(_ABOVE, (identity, identity))
    ]


def accepted_chain(conn: sqlite3.Connection, parent_id: str | None) -> bool:
    """Whether an item under `parent_id` stands in accepted open containers all the way up.

    The owner's decision about a goal covers the work inside it, so work under such
    a chain is accepted as part of it. One container above that is not accepted, or
    no container at all, and the chain is not there.
    """

    if parent_id is None:
        return False
    chain = above(conn, parent_id)
    return bool(chain) and all(
        kind == model.CONTAINER_KIND and category == model.SERVICE_CATEGORY
        for _identity, kind, category in chain
    )


def of_item(conn: sqlite3.Connection, row: sqlite3.Row, category: str) -> Tree:
    """One item and what is under it: all a record of that item derives from.

    `category` is the item's own state's. A task has nothing under it to read, so its
    facts come from its row, and only its waits cost a statement.
    """

    identity = str(row["work_item_id"])
    if str(row["kind"]) == model.CONTAINER_KIND:
        return below(conn, [identity])
    columns = row.keys()  # `in row` would search a Row's values, not its names
    started = row["started_at"] if "started_at" in columns else None
    node = _node((identity, row["parent_id"], row["kind"], started, category, 0))
    return Tree(
        nodes={identity: node},
        waits=_waits(conn.execute(_WAITS_ON_ITEMS, (json.dumps([identity]),))),
    )
