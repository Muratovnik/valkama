"""What the open work is likely to take yet, judged by done work like it: the estimates.

The basis is the store's tasks (`task`, `bug`, `improvement`) that stand completed, spent
agent time and were counted whole: they began no earlier than usage was first counted to
an item (`usage.counted_whole`). A cancelled task's spending says nothing of what done work
costs, and a task done with nothing spent was carried over or closed with no work.

A task's group is its project and its kind. A task naming several projects or none adds its
space to the group, so that no project does not mix the work of different spaces. An open
task that has spent `s` of agent time is judged on the first rung of a ladder that holds at
least `MIN_BASIS` tasks of the basis that spent more than `s`:

1. its group, the tasks sharing a label with it;
2. its group;
3. its project, or for several projects or none, that mark in its space.

What it has left is the mean of `v - s` over those tasks, leaving out the tenth of them,
rounded down, that had the most left; its tokens of each kind and its cost are the mean of
`v - s` over the same tasks, never below zero. With no such rung the task has no estimate:
it has spent more than the work it could be judged by, and nothing left would be untrue. A
goal leaves what its open tasks leave, triage and deferred ones too, and says how many
different done tasks its estimates were judged by. The groups are read across the store,
whatever the scope: a project is one project in every space.

The table describes the basis a scope holds: a row for each project and kind, and under
it a row for each label one of its tasks carries, with how many tasks there are and the
median, quartiles and mean of their agent time, the tokens they wrote anew and their
cost. A task's cost is what its priced rows cost. The mean, not the median, is what adds
up over a goal's tasks, and the table gives both. About half of the goals checked halfway
through their work came within a factor of two: an estimate is a rough figure.

The basis is one statement over the usage rows, with one walk of the items' projects.
"""

from __future__ import annotations

import json
import sqlite3
import statistics
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

from . import item_projects, model, usage

#: The fewest done tasks a rung of the ladder must hold for an estimate.
MIN_BASIS = 5
#: The kinds of token a task wrote anew: what came in, what it wrote to the cache, what went out.
ANEW = ("input", "cache_write_5m", "cache_write_1h", "output")
PROJECT_KIND = "project_kind"
PROJECT_KIND_LABEL = "project_kind_label"

#: Each done task of the store that spent agent time, with what its usage rows add up to,
#: when it began, whether the scope keeps it (`{where}`), and when usage was first counted.
_SUMS = ", ".join(f"SUM(g.{column}) AS {column}" for _kind, column in usage.TOKEN_KINDS)
_BASIS = (
    "SELECT f.first, i.work_item_id, i.kind, i.labels,"  # noqa: S608 - constant text
    " COALESCE(i.started_at, i.created_at) AS begun, p.key AS space_key, p.name AS space_name,"
    " CASE WHEN {where} THEN 1 ELSE 0 END AS kept, SUM(g.seconds) AS seconds,"
    f" {_SUMS}, SUM(g.estimated_api_cost_usd) AS estimated_api_cost_usd"
    f" FROM ({usage.FIRST_COUNTED}) f, work_items i"
    " JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " JOIN usage_segments g ON g.work_item_id = i.work_item_id"
    " WHERE s.category = 'completed' AND i.kind IN (SELECT value FROM json_each(?))"
    " GROUP BY i.work_item_id HAVING SUM(g.seconds) > 0"
)


@dataclass(frozen=True)
class Spent:
    """What a task spent in each measure: a kind of token none reported is 0 here, and the
    cost is what its priced rows cost."""

    seconds: float
    tokens: dict[str, int]
    cost: float

    @classmethod
    def of(cls, tally: usage.Tally) -> Spent:
        return cls(
            tally.seconds,
            {kind: tally.tokens.get(kind, 0) for kind, _column in usage.TOKEN_KINDS},
            tally.cost or 0.0,
        )

    def anew(self) -> int:
        return sum(self.tokens[kind] for kind in ANEW)


@dataclass(frozen=True)
class Task:
    """A task as the ladder groups it, with what it has spent."""

    work_item_id: str
    kind: str
    labels: frozenset[str]
    #: Its one project, `usage.SEVERAL` or None.
    project: usage.Value
    projects: frozenset[str]
    #: The key and name of its space when its project does not say which work it is.
    space: tuple[str, str] | None
    spent: Spent

    @property
    def whole(self) -> tuple:
        """The third rung: its project, or that it names several or none, in its space."""

        return (self.project, self.space)

    @property
    def group(self) -> tuple:
        return (*self.whole, self.kind)


def task(
    identity: str,
    kind: str,
    labels: str,
    projects: frozenset[str],
    space: tuple[str, str],
    tally: usage.Tally,
) -> Task:
    """A task as the ladder groups it, from its row's kind, labels and space, its projects and
    its usage rows added up."""

    project: usage.Value = usage.SEVERAL if len(projects) > 1 else next(iter(projects), None)
    return Task(
        identity,
        kind,
        frozenset(model.labels(json.loads(labels))),
        project,
        projects,
        None if isinstance(project, str) else space,
        Spent.of(tally),
    )


@dataclass(frozen=True)
class Left:
    """What one open task has left by its estimate, and the done tasks it was judged by."""

    seconds: float
    tokens: dict[str, float]
    cost: float
    judged_by: frozenset[str]


class Basis:
    """The done tasks the estimates are judged by, read across the store."""

    def __init__(self, tasks: Sequence[Task]) -> None:
        self.tasks = tasks
        self._wholes: dict[tuple, list[Task]] = {}
        for done in tasks:
            self._wholes.setdefault(done.whole, []).append(done)

    def left(self, open_task: Task) -> Left | None:
        """What the open task has left, from the first rung with `MIN_BASIS` tasks that spent
        more than it has; None when no rung has them."""

        spent = open_task.spent
        rungs: tuple[Callable[[Task], bool], ...] = (
            lambda done: done.group == open_task.group and bool(done.labels & open_task.labels),
            lambda done: done.group == open_task.group,
            lambda _done: True,
        )
        candidates = self._wholes.get(open_task.whole, [])
        for rung in rungs:
            longer = [
                done for done in candidates if rung(done) and done.spent.seconds > spent.seconds
            ]
            if len(longer) >= MIN_BASIS:
                return _mean_left(longer, spent)
        return None


def _mean_left(longer: list[Task], spent: Spent) -> Left:
    """The mean of what these tasks spent beyond `spent`, without the tenth with the most."""

    longer.sort(key=lambda done: (spent.seconds - done.spent.seconds, done.work_item_id))
    kept = longer[len(longer) // 10 :]

    def mean(beyond: Iterable[float]) -> float:
        return sum(beyond) / len(kept)

    return Left(
        mean(done.spent.seconds - spent.seconds for done in kept),
        {
            kind: max(mean(done.spent.tokens[kind] - spent.tokens[kind] for done in kept), 0.0)
            for kind, _column in usage.TOKEN_KINDS
        },
        max(mean(done.spent.cost - spent.cost for done in kept), 0.0),
        frozenset(done.work_item_id for done in kept),
    )


@dataclass
class Remaining:
    """What the open tasks of a goal or stage leave, added up as their estimates come."""

    seconds: float = 0.0
    tokens: dict[str, float] = field(
        default_factory=lambda: dict.fromkeys((kind for kind, _ in usage.TOKEN_KINDS), 0.0)
    )
    cost: float = 0.0
    judged_by: set[str] = field(default_factory=set)
    estimated: int = 0
    unestimated: int = 0

    def add(self, left: Left | None) -> None:
        if left is None:
            self.unestimated += 1
            return
        self.estimated += 1
        self.seconds += left.seconds
        for kind, count in left.tokens.items():
            self.tokens[kind] += count
        self.cost += left.cost
        self.judged_by |= left.judged_by

    def answer(self) -> dict | None:
        """None when no open task stands under it; zeros with `estimated` 0 when none of
        them has an estimate."""

        if not self.estimated and not self.unestimated:
            return None
        return {
            "agent_seconds": round(self.seconds, 3),
            "tokens": {kind: usage.whole_units(count) for kind, count in self.tokens.items()},
            "estimated_api_cost_usd": round(self.cost, 6),
            "basis": len(self.judged_by),
            "estimated": self.estimated,
            "unestimated": self.unestimated,
        }


def read(
    conn: sqlite3.Connection, where: str = "1 = 1", parameters: Sequence[object] = ()
) -> tuple[Basis, list[Task]]:
    """The basis of the whole store, and the part of it that `where` and its `parameters`,
    conditions on `work_items i`, keep."""

    rows = conn.execute(
        _BASIS.format(where=where), (*parameters, json.dumps(sorted(model.TASK_KINDS)))
    ).fetchall()
    first = None if not rows else usage.stored_micro(str(rows[0]["first"]))
    counted = [row for row in rows if usage.counted_whole(str(row["begun"]), first)]
    projects = item_projects.ids_of_items(conn, [str(row["work_item_id"]) for row in counted])
    tasks: list[Task] = []
    kept: list[Task] = []
    for row in counted:
        tally = usage.Tally()
        tally.add(row)
        identity = str(row["work_item_id"])
        found = task(
            identity,
            str(row["kind"]),
            str(row["labels"]),
            projects.get(identity, frozenset()),
            (str(row["space_key"]), str(row["space_name"])),
            tally,
        )
        tasks.append(found)
        if row["kept"]:
            kept.append(found)
    return Basis(tasks), kept


# -- the table -------------------------------------------------------------------


def table(
    conn: sqlite3.Connection, where: str = "1 = 1", parameters: Sequence[object] = ()
) -> dict:
    """The basis the scope holds described: a row for each project and kind, the most tasks
    first, each followed by a row for each label its tasks carry, the most tasks first."""

    _basis, kept = read(conn, where, parameters)
    groups: dict[tuple, list[Task]] = {}
    for done in kept:
        groups.setdefault(done.group, []).append(done)
    names = usage.project_names(done.projects for done in kept)
    rows: list[dict] = []
    for key, found in sorted(groups.items(), key=lambda entry: _ranked(*entry)):
        first = found[0]
        shown = {
            "project": usage.project_group(first.project, names, (done.projects for done in found)),
            "space": None
            if first.space is None
            else {"key": first.space[0], "name": first.space[1]},
            "kind": key[-1],
        }
        rows.append(_row(PROJECT_KIND, shown, None, found))
        by_label: dict[str, list[Task]] = {}
        for done in found:
            for label in done.labels:
                by_label.setdefault(label, []).append(done)
        for label, labelled in sorted(
            by_label.items(), key=lambda entry: (-len(entry[1]), entry[0])
        ):
            rows.append(_row(PROJECT_KIND_LABEL, shown, label, labelled))
    return {"min_basis": MIN_BASIS, "basis": len(kept), "rows": rows}


def _ranked(key: tuple, found: list[Task]) -> tuple:
    """Where a group's row stands: the most tasks first, then by project as a breakdown
    orders it, then by space and kind."""

    project, space, kind = key
    return (*usage.ranking(len(found), None, (project,)), space or ("", ""), kind)


def _row(level: str, shown: dict, label: str | None, tasks: Iterable[Task]) -> dict:
    spent = [done.spent for done in tasks]
    return {
        "level": level,
        **shown,
        "label": label,
        "tasks": len(spent),
        "agent_seconds": described([found.seconds for found in spent], 3),
        "tokens_anew": described([found.anew() for found in spent], 0),
        "estimated_api_cost_usd": described([found.cost for found in spent], 6),
    }


def described(values: Sequence[float], places: int) -> dict:
    """The median, the quartiles and the mean of some values, rounded to `places`: the
    quartiles by linear interpolation between the values in order, the first value being the
    lowest quartile and the last the highest."""

    ordered = sorted(values)
    if len(ordered) == 1:
        low = middle = high = float(ordered[0])
    else:
        low, middle, high = statistics.quantiles(ordered, n=4, method="inclusive")

    def shown(figure: float) -> float:
        return round(figure, places) if places else usage.whole_units(figure)

    return {
        "median": shown(middle),
        "q1": shown(low),
        "q3": shown(high),
        "mean": shown(statistics.fmean(ordered)),
    }
