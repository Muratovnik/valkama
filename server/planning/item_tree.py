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
did. A record also says which open items block it, `waits_for`, by reference, and
which cancelled ones are still linked to block it, `cancelled_blockers`.

A tree also holds what the take-next queue asks of an item and the items over it
(`queue.withheld`): each item's category, what blocks each, and which items an open
question to the owner holds up.

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

from . import model, questions, states

#: What an accepted open container derives, in the order the work goes through them.
CONTAINER_STATES = ("not_started", "in_progress", "awaiting_confirmation")

#: The facts of each item the rule reads, from its row and its state's, and whether its
#: workflow lets a claim start it where it stands. An attached store an earlier build
#: wrote is read as it is: it records no start, and its `{started}` reads as null there.
_FACTS = (
    "SELECT i.work_item_id, i.parent_id, i.kind, {started}, s.category,"  # noqa: S608 - constant text
    " CASE WHEN i.kind = 'container' THEN EXISTS (SELECT 1 FROM work_item_events e"
    "  WHERE e.work_item_id = i.work_item_id AND e.action = 'child_left') ELSE 0 END, "
    + states.STARTS_CLAUSE
    + " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
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
#: Every item over the one named, at any height. `UNION` keeps each once, so a cycle
#: in a damaged store ends instead of looping.
_OVER = (
    "WITH RECURSIVE over(id) AS (SELECT parent_id FROM work_items WHERE work_item_id = ?"  # noqa: S608 - constant text
    " UNION SELECT w.parent_id FROM over o JOIN work_items w ON w.work_item_id = o.id"
    " WHERE w.parent_id IS NOT NULL)" + _FACTS + " JOIN over o ON o.id = i.work_item_id"
)
#: The items that block each item named and are open or cancelled, by reference, and
#: whether each is open: the open ones are what it waits for, the cancelled ones what
#: its `cancelled_blockers` names.
_WAITS = (
    "SELECT l.to_id, p.key, b.number, bs.is_terminal = 0 FROM work_item_links l"
    " JOIN work_items b ON b.work_item_id = l.from_id"
    " JOIN workflow_states bs ON bs.state_id = b.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = b.planning_space_id"
    " WHERE l.kind = 'blocks' AND (bs.is_terminal = 0 OR bs.category = 'cancelled')"
    " AND l.to_id IN ({targets})"
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
    #: Its stored state's category; `model.SERVICE_CATEGORY` for an accepted open container.
    category: str
    #: Accepted and open: a container standing in the service state.
    accepted_open: bool
    #: Its stored category is completed or cancelled.
    closed: bool
    started_at: str | None
    #: A `child_left` event names a child that left it.
    lost_child: bool
    #: Its workflow leads from its state into work (`states.STARTS_CLAUSE`); None
    #: where it was not loaded, as for one task's own record.
    startable: bool | None


@dataclass(frozen=True)
class Tree:
    """The loaded facts of some items, and the rule that reads them."""

    nodes: Mapping[str, _Node]
    #: The open items that block each item, by reference.
    waits: Mapping[str, tuple[str, ...]]
    children: Mapping[str, tuple[str, ...]] = field(init=False)
    #: The cancelled items that block each item, by reference: a link that stands to
    #: work that will not be done.
    cancelled: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    #: The items over the ones loaded with what is under them: one task's record loads
    #: its own row and these, and nothing here derives what they derive.
    over: Mapping[str, _Node] = field(default_factory=dict)
    #: The items an open question to the owner holds up (`questions.asked`); None
    #: where the tree was loaded without them, as for what a link's end derives.
    asked: frozenset[str] | None = None

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

    def cancelled_blockers(self, identity: str) -> list[str]:
        """The cancelled items still linked `blocks` to this open one, by reference.

        `waits_for` no longer names them, and this says why the wait ended: the work it
        waited for will not be done. It lasts while the link stands; a closed item has none.
        """

        node = self.nodes.get(identity)
        if node is not None and node.closed:
            return []
        return list(self.cancelled.get(identity, ()))

    def startable(self, identity: str) -> bool | None:
        """Whether a claim can start the item where it stands; None when it was not loaded."""

        node = self.nodes.get(identity)
        return None if node is None else node.startable

    def node(self, identity: str) -> _Node | None:
        """The loaded facts of one item, wherever in the tree they were loaded."""

        return self.nodes.get(identity) or self.over.get(identity)

    def ancestors(self, identity: str) -> list[str]:
        """Every item over this one up to its root, nearest first, as far as the tree holds them."""

        found: list[str] = []
        node = self.node(identity)
        while node is not None and node.parent_id is not None and node.parent_id not in found:
            # A cycle is a damaged store; the climb still ends.
            found.append(node.parent_id)
            node = self.node(node.parent_id)
        return found

    def question(self, identity: str) -> bool:
        """Whether an open question to the owner holds this item up."""

        if self.asked is None:
            raise LookupError("this tree was loaded without the questions to the owner")
        return identity in self.asked

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
        category=str(row[4]),
        accepted_open=container and str(row[4]) == model.SERVICE_CATEGORY,
        closed=str(row[4]) in model.TERMINAL_CATEGORIES,
        started_at=None if row[3] is None else str(row[3]),
        lost_child=bool(row[5]),
        startable=None if len(row) < 7 or row[6] is None else bool(row[6]),
    )


def _waits(rows: Iterable[sqlite3.Row]) -> dict[str, dict[str, tuple[str, ...]]]:
    """The blockers of each item, by reference, as `Tree` takes them: `waits` the open
    ones, `cancelled` the cancelled ones."""

    found: dict[str, dict[str, list[str]]] = {"waits": {}, "cancelled": {}}
    for target, key, number, blocking in rows:
        side = found["waits" if blocking else "cancelled"]
        side.setdefault(str(target), []).append(model.human_id(str(key), int(number)))
    return {
        name: {target: tuple(references) for target, references in side.items()}
        for name, side in found.items()
    }


def of_spaces(conn: sqlite3.Connection, space_ids: Iterable[str]) -> Tree:
    """Every item of these spaces: three statements, whatever the spaces hold."""

    named = sorted(set(space_ids))
    spaces = json.dumps(named)
    blockers = _waits(conn.execute(_WAITS_IN_SPACES, (spaces,)))
    return Tree(
        nodes={str(row[0]): _node(row) for row in conn.execute(_facts(conn, _SPACES), (spaces,))},
        waits=blockers["waits"],
        cancelled=blockers["cancelled"],
        asked=questions.asked(conn, spaces=named),
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
    nodes = {str(row[0]): _node(row) for row in conn.execute(_facts(conn, _BELOW), (named,))}
    blockers = _waits(conn.execute(_WAITS_ON_ITEMS, (named,)))
    return Tree(nodes=nodes, waits=blockers["waits"], cancelled=blockers["cancelled"])


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


#: The open items under one, at any depth, by reference in number order: open as the
#: rule reads it, in a state of any category but completed and cancelled.
_OPEN_UNDER = (
    "WITH RECURSIVE under(id) AS (SELECT work_item_id FROM work_items WHERE parent_id = ?"
    " UNION SELECT w.work_item_id FROM under u JOIN work_items w ON w.parent_id = u.id)"
    " SELECT p.key, i.number FROM under u JOIN work_items i ON i.work_item_id = u.id"
    " JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE s.category NOT IN ('completed', 'cancelled')"
    " ORDER BY i.number"
)


def open_under(conn: sqlite3.Connection, identity: str) -> list[str]:
    """Every open item under `identity`, at any depth, by reference: what keeps it from closing."""

    return [
        model.human_id(str(key), int(number))
        for key, number in conn.execute(_OPEN_UNDER, (identity,))
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
    """One item and what is under it, or over it: all a record of that item derives from.

    `category` is the item's own state's. A container's record derives from what is
    under it, and the queue gives no container whatever is over it. A task has
    nothing under it to read, so its facts come from its row; the queue asks about
    the items over it, what blocks it and them, and its questions to the owner. Its
    own row says whether the store records a start, so that costs no statement, and
    a closed task has no open question to ask for: closing ended them
    (`questions.lapse`).
    """

    identity = str(row["work_item_id"])
    if str(row["kind"]) == model.CONTAINER_KIND:
        return below(conn, [identity])
    columns = row.keys()  # `in row` would search a Row's values, not its names
    recorded = "started_at" in columns
    started = row["started_at"] if recorded else None
    node = _node((identity, row["parent_id"], row["kind"], started, category, 0))
    query = _OVER.format(started="i.started_at" if recorded else "NULL")
    over = {str(found[0]): _node(found) for found in conn.execute(query, (identity,))}
    blockers = _waits(conn.execute(_WAITS_ON_ITEMS, (json.dumps([identity, *over]),)))
    return Tree(
        nodes={identity: node},
        waits=blockers["waits"],
        cancelled=blockers["cancelled"],
        over=over,
        asked=frozenset() if node.closed else questions.asked(conn, items=[identity]),
    )
