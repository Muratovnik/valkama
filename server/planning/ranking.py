"""Where a work item stands in the order of work, and the one way to choose it.

The order inside a state is `work_items.position`, lowest first, compared only
between items of one state of one space. It is not new: the cutover carried the
Board's lane positions into it, `create` and `transition` have always put an
item last in its state, and every reader -- the list, the read model, the
take-next queue -- already sorted a state by it. A build from before this module
reads and writes it the same way, which is why choosing it needs no change to
the store. What this module adds is the choosing.

A placement names where an item goes among the items of one state: `first`,
`last`, `before:<item>` or `after:<item>`. The new position is halfway between
the two neighbours the item lands between, so a placement writes one row: no
neighbour is renumbered, and no neighbour's revision moves under an agent that
read it. Halving runs out of room after some fifty placements into one gap, and
an older build's rows can tie; either way the state is renumbered 1..n in the
order it already has, inside the same transaction, and the halving tried again.
The renumbering changes no item's order or anything a reader is shown, so it
bumps no revision: a revision guards a decision taken from what was read, and
nothing read is different.

The order across states is not stored, because it follows from the states.
`WORK_ORDER` says it: work under way first, then work in review, then what is
queued, then the backlog, then what is blocked, then what is finished. `ranks`
numbers a space's items in that order, which is what a reader of one chain
needs to list its open work the way the queue will take it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from typing import NamedTuple

from . import model, read_model

#: Workflow categories in the order work is listed when it spans states. The
#: take-next queue reads it too, so Todo is taken before the backlog.
WORK_ORDER = ("active", "review", "queued", "backlog", "blocked", "completed", "cancelled")

#: `WORK_ORDER` as a sort key over `s.category`, for a query joined to its state.
WORK_ORDER_SQL = (
    "CASE s.category"
    + "".join(f" WHEN '{category}' THEN {index}" for index, category in enumerate(WORK_ORDER))
    + f" ELSE {len(WORK_ORDER)} END"
)

_WHERE = ("first", "last", "before", "after")
_REFUSAL = "rank must be first, last, before:<work item> or after:<work item>"


class Placement(NamedTuple):
    """Where a caller asked an item to go: `where`, and the item it is relative to."""

    where: str
    anchor: str | None


def placement(value: object) -> Placement:
    """Read a placement as a caller spells it, or refuse it in one sentence."""

    if not isinstance(value, str):
        raise model.PlanningError(_REFUSAL)
    where, colon, anchor = value.strip().partition(":")
    anchor = anchor.strip()
    if where in ("first", "last") and not colon:
        return Placement(where, None)
    if where in ("before", "after") and anchor:
        return Placement(where, model.text_field(anchor, "rank", limit=64))
    raise model.PlanningError(_REFUSAL)


def position(
    conn: sqlite3.Connection, row: sqlite3.Row, state: sqlite3.Row, wanted: Placement
) -> float | None:
    """The position that puts `row` where `wanted` says among the items of `state`.

    None means it already stands there, so there is nothing to write. The item
    need not be in `state` yet: a transition places it in the state it moves to.
    An anchor must be another item of that same state, because a position means
    nothing outside its state.
    """

    identity = str(row["work_item_id"])
    space = str(row["planning_space_id"])
    state_id = str(state["state_id"])
    others = _ordered(conn, space, state_id, exclude=identity)
    lower, upper = _neighbours(conn, row, state, others, wanted)
    if str(row["state_id"]) == state_id and _stands_between(conn, row, others, lower, upper):
        return None
    value = _between(
        None if lower is None else others[lower][1],
        None if upper is None else others[upper][1],
    )
    if value is None:
        others = _renumber(conn, others)
        value = _between(
            None if lower is None else others[lower][1],
            None if upper is None else others[upper][1],
        )
    if value is None:  # pragma: no cover - 1..n always leaves a gap of one
        raise model.PlanningError("the order of this state could not be renumbered")
    return value


def ranks(rows: Iterable[sqlite3.Row]) -> dict[str, int]:
    """Each item's 1-based place in the order of work among `rows`.

    A row carries `work_item_id`, `number`, `position`, its state's `category`
    as `state_category` and the state's own `state_position`.
    """

    def key(row: sqlite3.Row) -> tuple:
        category = str(row["state_category"])
        return (
            WORK_ORDER.index(category) if category in WORK_ORDER else len(WORK_ORDER),
            row["state_position"],
            row["position"],
            row["number"],
            str(row["work_item_id"]),
        )

    return {str(row["work_item_id"]): index for index, row in enumerate(sorted(rows, key=key), 1)}


def _ordered(
    conn: sqlite3.Connection, space: str, state_id: str, *, exclude: str
) -> list[tuple[str, float]]:
    """The items of one state in their order, without the one being moved."""

    return [
        (str(item[0]), float(item[1]))
        for item in conn.execute(
            "SELECT work_item_id, position FROM work_items"
            " WHERE planning_space_id = ? AND state_id = ? AND work_item_id != ?"
            " ORDER BY position, number, work_item_id",
            (space, state_id, exclude),
        )
    ]


def _neighbours(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    state: sqlite3.Row,
    others: list[tuple[str, float]],
    wanted: Placement,
) -> tuple[int | None, int | None]:
    """The indexes in `others` the item lands between; None is an open end."""

    if wanted.where == "first":
        return None, 0 if others else None
    if wanted.where == "last":
        return (len(others) - 1 if others else None), None
    anchor = read_model.item_row(conn, wanted.anchor)
    reference = read_model.reference(conn, anchor)
    if str(anchor["work_item_id"]) == str(row["work_item_id"]):
        raise model.PlanningError(f"{reference} cannot be placed relative to itself")
    if str(anchor["planning_space_id"]) != str(row["planning_space_id"]):
        raise model.PlanningError(f"{reference} lives in another planning space")
    if str(anchor["state_id"]) != str(state["state_id"]):
        held = read_model.state_by_id(conn, str(anchor["state_id"]))
        raise model.PlanningError(
            f"{reference} is in {held['name']}, not {state['name']}: an item is ordered"
            " among the items of its own state"
        )
    wanted_id = str(anchor["work_item_id"])
    index = next(at for at, (identity, _) in enumerate(others) if identity == wanted_id)
    if wanted.where == "before":
        return (index - 1 if index > 0 else None), index
    return index, (index + 1 if index + 1 < len(others) else None)


def _stands_between(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    others: list[tuple[str, float]],
    lower: int | None,
    upper: int | None,
) -> bool:
    """Whether the item, in its state already, is exactly between those two."""

    current = [
        identity
        for identity, _ in _ordered(
            conn, str(row["planning_space_id"]), str(row["state_id"]), exclude=""
        )
    ]
    at = current.index(str(row["work_item_id"]))
    before = current[at - 1] if at > 0 else None
    after = current[at + 1] if at + 1 < len(current) else None
    return before == (None if lower is None else others[lower][0]) and after == (
        None if upper is None else others[upper][0]
    )


def _between(lower: float | None, upper: float | None) -> float | None:
    """A position strictly between two, or None when they leave no room."""

    if upper is None:
        return 1.0 if lower is None else lower + 1.0
    if lower is None:
        return upper - 1.0
    middle = (lower + upper) / 2
    return middle if lower < middle < upper else None


def _renumber(conn: sqlite3.Connection, others: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Give a state's items 1..n in the order they already have.

    No revision moves and nothing is logged: the order, and every field a reader
    is shown, stay what they were.
    """

    renumbered = [(identity, float(index)) for index, (identity, _) in enumerate(others, 1)]
    conn.executemany(
        "UPDATE work_items SET position = ? WHERE work_item_id = ?",
        [(value, identity) for identity, value in renumbered],
    )
    return renumbered
