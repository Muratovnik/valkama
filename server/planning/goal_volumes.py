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

A row counts its tasks (`task`, `bug`, `improvement`) by category, the cancelled
among them, beside how many stood under it when it was accepted (`baselines`). Its
sessions are the sessions behind any of its items, each once, and its commits the
commits attached to any of its items, each once: a session or a commit on two items
is one, so a row's number is never the sum of its stages' and tasks'. A commit of no
known repository is counted apart, by its records (`read_model.attached_commits`).

A read narrowed to some items, as the Volumes read of a project is, adds up those
items alone; a row whose bounds hold others is `partial`, and shows no count at
acceptance. A row names the space of a goal from another space than the one read, as
`other_space`.

A row says what its open tasks have left, triage and deferred ones too, as `remaining`:
the sum of their estimates (`estimates`), judged by done work of the whole store, with
how many of them have an estimate and how many have none. A row with no open task has
none.

A read filtered by kinds and labels adds up only the tasks the filter keeps, which no
goal or stage is: a row is then the rows of its stages and its tasks that match, without
the work of the goal or stage itself, and a goal or stage with no such task under it has
no row. Its tasks are those that match, and it shows no count at acceptance, which was
taken of every task. What each task has left is what it has left without the filter.

Each part a read takes from the store is one statement, however many goals it reads:
the usage rows of every item it adds up, grouped by item, by whether a row is priced
and by its quality; their sessions; their commits; the counts at acceptance of
the rows it shows; and, when it keeps an open task, the projects of the open tasks and
the basis of the estimates, unless the read hands that in.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from . import baselines, estimates, item_projects, item_tree, model, read_model, states, usage

#: How many goals and stages one `goal-volumes` read takes.
MOST_READ = 100
TOO_MANY = f"id takes 1 to {MOST_READ} goals or stages"
A_TASK = "{reference} is a task: goal volumes read goals and stages"

#: The moment usage was first counted to an item, and each item's rows added up by
#: whether they are priced and by their quality: one statement, one row at least.
_SPENDING = (
    f"SELECT f.first, g.* FROM ({usage.FIRST_COUNTED}) f"  # noqa: S608 - constant text
    " LEFT JOIN (SELECT work_item_id, quality, SUM(seconds) AS seconds, "
    + ", ".join(f"SUM({column}) AS {column}" for _kind, column in usage.TOKEN_KINDS)
    + ", SUM(estimated_api_cost_usd) AS estimated_api_cost_usd FROM usage_segments"
    " WHERE work_item_id IN (SELECT value FROM json_each(?))"
    " GROUP BY work_item_id, estimated_api_cost_usd IS NULL, quality) g ON 1 = 1"
)

#: What a row says of each item in the bounds, and whether the read keeps it.
_ITEMS = (
    "SELECT i.work_item_id, i.number, i.title, i.kind, i.parent_id, i.labels,"
    " COALESCE(i.started_at, i.created_at) AS begun, i.planning_space_id, i.acceptance,"
    " p.key AS space_key, p.name AS space_name,"
    " s.key, s.name, s.category, s.is_terminal,"
    " up.number AS parent_number, upp.key AS parent_key,"
    " CASE WHEN {where} THEN 1 ELSE 0 END AS kept,"
    " CASE WHEN {matching} THEN 1 ELSE 0 END AS matched"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " LEFT JOIN work_items up ON up.work_item_id = i.parent_id"
    " LEFT JOIN planning_spaces upp ON upp.planning_space_id = up.planning_space_id"
    " WHERE i.work_item_id IN (SELECT value FROM json_each(?))"
)


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
    tasks: dict[str, int] = field(default_factory=lambda: dict.fromkeys(model.PUBLIC_CATEGORIES, 0))
    sessions: set[str] = field(default_factory=set)
    commits: set[int] = field(default_factory=set)
    commits_unknown: set[int] = field(default_factory=set)
    remaining: estimates.Remaining = field(default_factory=estimates.Remaining)

    def add(self, sessions: set[str], commits: set[tuple[int, bool]]) -> None:
        """An item's sessions and commits, each counted once however many items hold it."""

        self.sessions |= sessions
        for commit, known in commits:
            (self.commits if known else self.commits_unknown).add(commit)

    def counted(self) -> dict:
        """Its tasks: how many, how many closed and how, and how many in each category."""

        completed, cancelled = self.tasks["completed"], self.tasks["cancelled"]
        return {
            "total": sum(self.tasks.values()),
            "closed": completed + cancelled,
            "completed": completed,
            "cancelled": cancelled,
            "by_category": dict(self.tasks),
        }


def rows(
    conn: sqlite3.Connection,
    roots: Sequence[str],
    *,
    where: str = "1 = 1",
    parameters: Sequence[object] = (),
    matching: tuple[str, Sequence[object]] | None = None,
    basis: estimates.Basis | None = None,
    space_id: str | None = None,
    children: bool = False,
) -> list[dict]:
    """The row of each goal or stage of `roots`, in their order.

    `where` and its `parameters`, conditions on `work_items i`, keep the items the
    read adds up; an item they leave out makes each row over it `partial`. `matching`,
    conditions of the same form with their parameters, is a filter's, which no goal or
    stage matches: the rows then add up only the tasks it keeps, without the work of the
    goals and stages, give no count at acceptance, and only the goals and stages with
    such a task under them have a row. `basis` is the basis of the estimates when the
    read holds it already. `space_id` is the space read, whose own goals name no
    `other_space`. With `children`, a row holds the rows of the stages under it that
    the read keeps, in number order.
    """

    if not roots:
        return []
    tree = item_tree.below(conn, roots)
    filtered = matching is not None
    condition, values = ("1 = 1", ()) if matching is None else matching
    items = {
        str(row["work_item_id"]): row
        for row in conn.execute(
            _ITEMS.format(where=where, matching=condition),
            (*parameters, *values, json.dumps(sorted(tree.nodes))),
        )
    }
    kept = [identity for identity, row in items.items() if row["kept"]]
    #: The items the rows add up: those the read keeps, or under a filter its tasks alone.
    added = [identity for identity in kept if items[identity]["matched"]]
    spending = conn.execute(_SPENDING, (json.dumps(sorted(added)),)).fetchall()
    first = spending[0]["first"]
    holding = {over for identity in added for over in tree.ancestors(identity)}
    if filtered:
        roots = [identity for identity in roots if identity in holding]
    shown = set(roots)
    if children:
        shown |= {
            identity
            for identity in kept
            if items[identity]["kind"] == model.CONTAINER_KIND
            and items[identity]["parent_id"] is not None
            and (not filtered or identity in holding)
        }
    sums = {identity: _Row() for identity in shown}
    sessions = read_model.session_ids(conn, added)
    commits = read_model.attached_commits(conn, added)
    counts = {} if filtered else baselines.taken(conn, sorted(shown))

    def over(identity: str) -> Iterable[_Row]:
        """The rows the item adds to: its own, when it has one, and every one above it."""

        for found in (identity, *tree.ancestors(identity)):
            if found in sums:
                yield sums[found]

    def cancelled(identity: str) -> bool:
        return str(items[identity]["category"]) == "cancelled"

    own: dict[str, usage.Tally] = {}
    for row in spending:
        if row["work_item_id"] is None:
            continue
        identity = str(row["work_item_id"])
        own.setdefault(identity, usage.Tally()).add(row)
        for summed in over(identity):
            summed.with_cancelled.add(row)
            if not cancelled(identity):
                summed.spent.add(row)
    started = None if first is None else usage.stored_micro(str(first))
    for identity, item in items.items():
        if not item["kept"]:
            for summed in over(identity):
                summed.partial = True
            continue
        if not item["matched"]:
            continue
        for summed in over(identity):
            summed.add(sessions.get(identity, set()), commits.get(identity, set()))
        if item["kind"] == model.CONTAINER_KIND:
            continue
        for summed in over(identity):
            summed.tasks[str(item["category"])] += 1
        if not usage.counted_whole(str(item["begun"]), started):
            for summed in over(identity):
                summed.with_cancelled.partly_measured += 1
                if not cancelled(identity):
                    summed.spent.partly_measured += 1

    open_tasks = [
        identity
        for identity in added
        if items[identity]["kind"] != model.CONTAINER_KIND
        and str(items[identity]["category"]) not in model.TERMINAL_CATEGORIES
    ]
    if open_tasks:
        if basis is None:
            basis = estimates.read(conn)
        projects = item_projects.ids_of_items(conn, open_tasks)
        for identity in open_tasks:
            item = items[identity]
            left = basis.left(
                estimates.task(
                    identity,
                    str(item["kind"]),
                    str(item["labels"]),
                    projects.get(identity, frozenset()),
                    (str(item["space_key"]), str(item["space_name"])),
                    own.get(identity, usage.Tally()),
                )
            )
            for summed in over(identity):
                summed.remaining.add(left)

    under: dict[str, list[str]] = {}
    for identity in sorted(shown - set(roots), key=lambda found: int(items[found]["number"])):
        under.setdefault(str(items[identity]["parent_id"]), []).append(identity)

    def answer(identity: str) -> dict:
        item = items[identity]
        summed = sums[identity]
        own = space_id is None or str(item["planning_space_id"]) == space_id
        baseline, absent = baselines.shown(
            counts.get(identity), item["acceptance"], partial=summed.partial, filtered=filtered
        )
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
            "tasks": summed.counted(),
            "baseline": baseline,
            "baseline_absent": absent,
            "spent": summed.spent.answer(),
            "spent_with_cancelled": summed.with_cancelled.answer(),
            "sessions": len(summed.sessions),
            "commits": len(summed.commits),
            "commits_unknown_repository": len(summed.commits_unknown),
            "remaining": summed.remaining.answer(),
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
