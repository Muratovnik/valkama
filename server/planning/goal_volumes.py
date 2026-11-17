"""What a goal or a stage took: its rows in the Volumes read and in `goal-volumes`.

A goal's bounds are the items under it now, at any depth, with the goal itself
(`item_tree.below`). An item moved out or filed under another goal leaves with what
it spent; a move between the goal's own stages changes nothing of the goal.

A row gives what its bounds spent twice. `spent` leaves out every item that stands
cancelled now, whose children still count by their own state: a stage cancelled takes
its own work and its cancelled tasks out, and a task done under it stays.
`spent_with_cancelled` holds every item. Both come from one pass over the usage rows,
which adds each item's rows to every row over it, so for each number a row is its own
work, its stages' rows and its tasks'. Time is `agent_seconds`, the sum of the
stretches: it adds up from tasks to goals, and the union a card's line shows does not.
A task that started before usage was first counted to an item spent more than its rows
say, and each number counts its tasks of that kind as `partly_measured`.

A read narrowed to some items, as the Volumes read of a project is, adds up those
items alone; a row whose bounds hold others is `partial`. A row names the space of a
goal from another space than the one read, as `other_space`.

The usage rows of every item a read takes are one statement, grouped by item, by
whether a row is priced and by its quality, however many goals it reads.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from . import item_tree, model, read_model, states, usage

#: How many goals and stages one `goal-volumes` read takes.
MOST_READ = 100
TOO_MANY = f"id takes 1 to {MOST_READ} goals or stages"
A_TASK = "{reference} is a task: goal volumes read goals and stages"

#: The moment usage was first counted to an item, and each item's rows added up by
#: whether they are priced and by their quality: one statement, one row at least.
_SPENDING = (
    "SELECT f.first, g.* FROM"  # noqa: S608 - constant text
    " (SELECT MIN(started_at) AS first FROM usage_segments WHERE work_item_id IS NOT NULL) f"
    " LEFT JOIN (SELECT work_item_id, quality, SUM(seconds) AS seconds, "
    + ", ".join(f"SUM({column}) AS {column}" for _kind, column in usage.TOKEN_KINDS)
    + ", SUM(estimated_api_cost_usd) AS estimated_api_cost_usd FROM usage_segments"
    " WHERE work_item_id IN (SELECT value FROM json_each(?))"
    " GROUP BY work_item_id, estimated_api_cost_usd IS NULL, quality) g ON 1 = 1"
)

#: What a row says of each item in the bounds, and whether the read keeps it.
_ITEMS = (
    "SELECT i.work_item_id, i.number, i.title, i.kind, i.parent_id,"
    " COALESCE(i.started_at, i.created_at) AS begun, i.planning_space_id,"
    " p.key AS space_key, p.name AS space_name,"
    " s.key, s.name, s.category, s.is_terminal,"
    " up.number AS parent_number, upp.key AS parent_key,"
    " CASE WHEN {where} THEN 1 ELSE 0 END AS kept"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " LEFT JOIN work_items up ON up.work_item_id = i.parent_id"
    " LEFT JOIN planning_spaces upp ON upp.planning_space_id = up.planning_space_id"
    " WHERE i.work_item_id IN (SELECT value FROM json_each(?))"
)


def _micro(text: str) -> int:
    moment = dt.datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.UTC)
    return usage.micro(moment)


@dataclass
class _Sum:
    """One number of a row: what its items' rows add up to, and how well they were counted."""

    tally: usage.Tally = field(default_factory=usage.Tally)
    estimated: float = 0.0
    partly_measured: int = 0

    def add(self, row: sqlite3.Row) -> None:
        self.tally.add(row)
        if row["quality"] == "estimated":
            self.estimated += float(row["seconds"])

    def answer(self) -> dict:
        return {
            "agent_seconds": round(self.tally.seconds, 3),
            **self.tally.spent(),
            "quality": usage.quality(self.tally.seconds - self.estimated, self.estimated),
            "partly_measured": self.partly_measured,
        }


@dataclass
class _Row:
    spent: _Sum = field(default_factory=_Sum)
    with_cancelled: _Sum = field(default_factory=_Sum)
    partial: bool = False


def rows(
    conn: sqlite3.Connection,
    roots: Sequence[str],
    *,
    where: str = "1 = 1",
    parameters: Sequence[object] = (),
    space_id: str | None = None,
    children: bool = False,
) -> list[dict]:
    """The row of each goal or stage of `roots`, in their order.

    `where` and its `parameters`, conditions on `work_items i`, keep the items the
    read adds up; an item they leave out makes each row over it `partial`. `space_id`
    is the space read, whose own goals name no `other_space`. With `children`, a row
    holds the rows of the stages under it that the read keeps, in number order.
    """

    if not roots:
        return []
    tree = item_tree.below(conn, roots)
    items = {
        str(row["work_item_id"]): row
        for row in conn.execute(
            _ITEMS.format(where=where), (*parameters, json.dumps(sorted(tree.nodes)))
        )
    }
    kept = [identity for identity, row in items.items() if row["kept"]]
    spending = conn.execute(_SPENDING, (json.dumps(sorted(kept)),)).fetchall()
    first = spending[0]["first"]
    shown = set(roots)
    if children:
        shown |= {
            identity
            for identity in kept
            if items[identity]["kind"] == model.CONTAINER_KIND
            and items[identity]["parent_id"] is not None
        }
    sums = {identity: _Row() for identity in shown}

    def over(identity: str) -> Iterable[_Row]:
        """The rows the item adds to: its own, when it has one, and every one above it."""

        for found in (identity, *tree.ancestors(identity)):
            if found in sums:
                yield sums[found]

    def cancelled(identity: str) -> bool:
        return str(items[identity]["category"]) == "cancelled"

    for row in spending:
        if row["work_item_id"] is None:
            continue
        identity = str(row["work_item_id"])
        for summed in over(identity):
            summed.with_cancelled.add(row)
            if not cancelled(identity):
                summed.spent.add(row)
    started = None if first is None else _micro(str(first))
    for identity, item in items.items():
        if not item["kept"]:
            for summed in over(identity):
                summed.partial = True
            continue
        if item["kind"] == model.CONTAINER_KIND or started is None:
            continue
        if _micro(str(item["begun"])) < started:
            for summed in over(identity):
                summed.with_cancelled.partly_measured += 1
                if not cancelled(identity):
                    summed.spent.partly_measured += 1

    under: dict[str, list[str]] = {}
    for identity in sorted(shown - set(roots), key=lambda found: int(items[found]["number"])):
        under.setdefault(str(items[identity]["parent_id"]), []).append(identity)

    def answer(identity: str) -> dict:
        item = items[identity]
        summed = sums[identity]
        own = space_id is None or str(item["planning_space_id"]) == space_id
        found = {
            "work_item_id": identity,
            "reference": model.human_id(str(item["space_key"]), int(item["number"])),
            "title": item["title"],
            "kind": model.outward_kind(item["kind"], item["parent_id"]),
            "state": states.public_state(item),
            "container_state": tree.container_state(identity),
            "open": str(item["category"]) not in model.TERMINAL_CATEGORIES,
            "parent_reference": None
            if item["parent_number"] is None
            else model.human_id(str(item["parent_key"]), int(item["parent_number"])),
            "other_space": None
            if own
            else {"key": str(item["space_key"]), "name": str(item["space_name"])},
            "partial": summed.partial,
            "spent": summed.spent.answer(),
            "spent_with_cancelled": summed.with_cancelled.answer(),
        }
        if children:
            found["children"] = [answer(child) for child in under.get(identity, [])]
        return found

    return [answer(identity) for identity in roots]


def read(conn: sqlite3.Connection, references: Sequence[str]) -> list[dict]:
    """The rows of the goals and stages named, whole, in the order named: `goal-volumes`."""

    if not 1 <= len(references) <= MOST_READ:
        raise model.PlanningError(TOO_MANY)
    roots = []
    for reference in references:
        row = read_model.item_row(conn, reference)
        if str(row["kind"]) != model.CONTAINER_KIND:
            raise model.PlanningError(A_TASK.format(reference=read_model.reference(conn, row)))
        roots.append(str(row["work_item_id"]))
    return rows(conn, roots)
