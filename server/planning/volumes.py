"""How much work stands in a scope, and what it took: the read behind the Volumes page.

A read names its scope and its period. The scope is every space, or one space of
the store this service writes, or one space narrowed to a project; a space holds the
items its board holds (`item_projects.space_read`): a number here opens the board on
the same items. The period is the Analytics grammar (`usage.period`): a
date is the start of that day in the caller's zone, and `to` is not in it.

The read is a frame — the scope, the period and the moment usage was first counted
to items — and its sections, each one function of the reading (`SECTIONS`): the
request with what more than one section takes from the store, the basis of the
estimates, read once for the goals and the table alike (`Reading`). The
counts by category are the first section: work in an open category is counted as
it stands now, with the card longest in it, and work that came to be completed or
cancelled is counted when it came to stand there inside the period. Beside them
stand the questions waiting for the owner on the scope's items, by the one rule of a
question to the owner (`questions.open_on`), and the commits on no card of the
scope's projects, or of the whole store, as the total of their list
(`commits.unattached`). The goals come next: the open ones and those closed in the
period, each with what it took over all its time and its stages under it
(`goal_volumes`), with what its open tasks have left by their estimates. Then the work
outside goals: the scope's tasks under no goal, by project and by label, counted by
category as the counts are. Then the flow: the scope's tasks created and closed on
each day of the period, the owner's decisions and the commits, with the pace of its
tasks (`volume_flow`). The estimates close the read: the scope's done work that
estimates are judged by, described by project, kind and label (`estimates.table`).

A read may also name kinds of task and labels (`task_filter.WorkFilter`), by the rules of the
board's filter. It then keeps only the scope's tasks that match, by one condition every
section takes (`Request.matching`): a goal or stage never matches, so the counts give
no number of goals and stages, a goal's row adds up only the tasks that match under it,
without its own work and with no count at acceptance, and the commits on no card, which
have no task to match, are counted as without a filter and left out of the flow. The
estimates of open tasks are judged by the whole store as without a filter; the table
describes the done tasks that match.

The read of every space counts its numbers by category and its questions waiting for
the owner in every store the questions window reads every space from: the store this
service writes and each attached store beside it (`sources`), as «All spaces» lists
them. A store an earlier build wrote is read as it is, and its states stand in the
categories of before, so only its questions count. The read names each source it covers
as the questions window names them (`coverage`), so a store that could not be read is
said rather than counted short in silence. The rest of the read is of the store this
service writes alone: usage, the owner's decisions and the commits are written there, so
the goals, the work outside goals, the flow, the estimates and the commits on no card are
its own, which the read says while an attached store it counts holds work
(`attached_work`), and a space of an attached store is refused rather than counted
short. The four numbers of a space's card in the portfolio count no
usage, and are counted in the store that holds the space (`portfolio_numbers`),
unless an earlier build wrote it.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Callable, Iterator, Sequence
from typing import NamedTuple

from ..projects import project_registry, scopes
from ..store_identity.metadata import read_store_metadata
from . import (
    commits,
    estimates,
    goal_volumes,
    item_projects,
    model,
    questions,
    read_model,
    standing,
    task_filter,
    usage,
    volume_flow,
)
from .routing import PlanningRouting

SCOPE_KINDS = ("global", "space")
UNKNOWN_SCOPE = "scope_kind must be global or space"
SPACE_FIELDS_MISSING = "a space scope names data_scope_id and space_key"
GLOBAL_NAMES_NOTHING = "a global scope names no space and no project"
ATTACHED = "volumes read the store this service writes; {key} lives in an attached store"
NO_SPACE = "no planning space {key}"
NO_PROJECT = "no project {project}"

#: The categories whose work is counted as it stands now; the others when it came there.
OPEN_CATEGORIES = tuple(
    category for category in model.PUBLIC_CATEGORIES if category not in model.TERMINAL_CATEGORIES
)


class Scope(NamedTuple):
    """The items one read counts: every space, or one space, narrowed to a project or not."""

    #: The space's `planning_space_id`, `key` and `name`, or None for every space.
    space: sqlite3.Row | None
    project: str | None
    data_scope_id: str
    #: The conditions on `work_items i` that keep the scope's items, joined by `AND`.
    clauses: tuple[str, ...]
    parameters: tuple[object, ...]

    def answer(self) -> dict:
        if self.space is None:
            return {"kind": "global", "space_ref": None, "project_ref": None}
        return {
            "kind": "space",
            "space_ref": {"data_scope_id": self.data_scope_id, "space_key": str(self.space["key"])},
            "project_ref": None if self.project is None else {"project_id": self.project},
        }

    def where(self) -> str:
        return " AND ".join(self.clauses) if self.clauses else "1 = 1"


class Period(NamedTuple):
    """From `begins` up to `ends`, in microseconds since the epoch, read at the caller's offset."""

    begins: int
    ends: int
    utc_offset: int

    def holds(self, moment: int) -> bool:
        return self.begins <= moment < self.ends

    def answer(self) -> dict:
        zone = usage.caller_zone(self.utc_offset)
        return {
            "from": usage.at(self.begins, zone),
            "to": usage.at(self.ends, zone),
            "utc_offset": self.utc_offset,
        }


class Request(NamedTuple):
    """What one read is asked: what it counts, over which period, and which of its tasks."""

    scope: Scope
    period: Period
    work_filter: task_filter.WorkFilter | None = None
    #: The stores counted beside the one the read writes, in the read of every space
    #: (`sources`); a space's read has none.
    beside: tuple[sqlite3.Connection, ...] = ()
    #: Each source the read covers, read or not and why (`Sources.coverage`).
    coverage: tuple[dict, ...] = ()

    def matching(self) -> Scope:
        """The items the sections count: the scope's, or under a filter the scope's tasks
        it keeps (`task_filter.WorkFilter.condition`)."""

        if self.work_filter is None:
            return self.scope
        clauses, parameters = self.work_filter.condition()
        return self.scope._replace(
            clauses=(*self.scope.clauses, *clauses),
            parameters=(*self.scope.parameters, *parameters),
        )


class Reading(NamedTuple):
    """One read under way: the store, the request, and what more than one section takes
    from the store, read once by the read however many goals it holds."""

    conn: sqlite3.Connection
    request: Request
    #: The basis of the estimates: the store's done work, by which the goals' open tasks
    #: are judged, keeping the part the sections count (`Request.matching`), which the
    #: table describes.
    basis: estimates.Basis


def scope(
    conn: sqlite3.Connection,
    kind: str | None,
    *,
    data_scope_id: str | None = None,
    space_key: str | None = None,
    project_id: str | None = None,
) -> Scope:
    """The scope a caller names, or a refusal saying what in it cannot be read."""

    own = str(read_store_metadata(conn)["data_scope_id"])
    if kind not in SCOPE_KINDS:
        raise model.PlanningError(UNKNOWN_SCOPE)
    if kind == "global":
        if data_scope_id is not None or space_key is not None or project_id is not None:
            raise model.PlanningError(GLOBAL_NAMES_NOTHING)
        return Scope(None, None, own, (), ())
    if data_scope_id is None or space_key is None:
        raise model.PlanningError(SPACE_FIELDS_MISSING)
    if data_scope_id != own:
        attached, _unreadable = scopes.data_scope_ids(_store_path(conn))
        raise model.PlanningError(
            (ATTACHED if data_scope_id in attached else NO_SPACE).format(key=space_key)
        )
    space = conn.execute(
        "SELECT planning_space_id, key, name FROM planning_spaces WHERE key = ?", (space_key,)
    ).fetchone()
    if space is None:
        raise model.PlanningError(NO_SPACE.format(key=space_key))
    project = None
    if project_id is not None:
        project = item_projects.project_id(project_id, "project_id")
        if not _known_project(conn, project):
            raise model.PlanningError(NO_PROJECT.format(project=project))
    clauses, parameters = item_projects.space_read(conn, space, project)
    return Scope(space, project, own, tuple(clauses), tuple(parameters))


class Sources(NamedTuple):
    """What a read counts beside the store it writes, and what it covers."""

    #: The stores counted beside `conn`, open while the read runs.
    stores: tuple[sqlite3.Connection, ...]
    #: Each source the read covers, as the questions window's read of every space names
    #: its own (`PlanningRouting.sources`): `space_ref`, `status` `searched` or
    #: `unavailable`, and the stable code of why in `reason`, or None.
    coverage: tuple[dict, ...]


@contextlib.contextmanager
def sources(conn: sqlite3.Connection, scope: Scope) -> Iterator[Sources]:
    """The stores a read counts beside `conn`, open while it reads, and the sources it covers:
    for every space, each attached store of a space «All spaces» lists
    (`PlanningRouting.present_spaces`), the list the questions window reads every space by,
    and every source that list names; for one space, no store and that space alone.

    A source is skipped for the reason the routing gives (`unavailable_reason`), for
    `store_unreadable` when its store went away after the routing listed it, and for
    `requests_unavailable` when its store keeps no questions, as the window skips them.
    """

    if scope.space is not None:
        yield Sources((), (_covered(scope.answer()["space_ref"], None),))
        return
    routing = PlanningRouting(conn, _store_path(conn))
    with routing.attached_stores() as attached:
        opened = {str(read_store_metadata(store)["data_scope_id"]): store for store in attached}
        opened[scope.data_scope_id] = conn
        coverage = []
        for space_ref in routing.sources():
            reason = routing.unavailable_reason(space_ref)
            store = opened.get(space_ref["data_scope_id"])
            if reason is None and store is None:
                reason = "store_unreadable"
            elif reason is None and store is not None and not questions.kept(store):
                reason = "requests_unavailable"
            coverage.append(_covered(space_ref, reason))
        yield Sources(attached, tuple(coverage))


def _covered(space_ref: dict, reason: str | None) -> dict:
    return {
        "space_ref": space_ref,
        "status": "searched" if reason is None else "unavailable",
        "reason": reason,
    }


def _holds_work(stores: Sequence[sqlite3.Connection]) -> bool:
    """Whether any of these stores holds a work item."""

    return any(
        store.execute("SELECT 1 FROM work_items LIMIT 1").fetchone() is not None for store in stores
    )


def space_scope(
    conn: sqlite3.Connection,
    space: sqlite3.Row,
    *,
    other_spaces: bool = True,
    listing: project_registry.RegistryResult | None = None,
) -> Scope:
    """One space of the store `conn` reads, attached or not, as its board holds it.

    Without `other_spaces` it holds the space's own items alone. `listing` is the
    registry a caller read already, read here when it names none.
    """

    clauses, parameters = item_projects.space_read(
        conn, space, other_spaces=other_spaces, listing=listing
    )
    own = str(read_store_metadata(conn)["data_scope_id"])
    return Scope(space, None, own, tuple(clauses), tuple(parameters))


def holds_the_work_model(conn: sqlite3.Connection) -> bool:
    """Whether every state of the store stands in a category of the work model.

    An attached store an earlier build wrote is read as it is, and its states stand in
    the categories of before, which nothing here counts.
    """

    outside = conn.execute(
        "SELECT 1 FROM workflow_states WHERE category NOT IN (SELECT value FROM json_each(?))"
        " LIMIT 1",
        (json.dumps(list(model.STORED_CATEGORIES)),),
    ).fetchone()
    return outside is None


def portfolio_numbers(
    conn: sqlite3.Connection,
    space: sqlite3.Row,
    *,
    listing: project_registry.RegistryResult | None = None,
) -> dict[str, int] | None:
    """The four numbers a space's card in the portfolio shows, or None for a store of before.

    The space reads as its board and its Volumes page hold it (`space_scope`), so the
    card's numbers are the page's: `triage`, every card waiting to be taken up, tasks,
    goals and stages; `ready` and `active`, the tasks; and `waiting_owner`, the
    questions open for the owner on its items.
    """

    if not holds_the_work_model(conn):
        return None
    scope = space_scope(conn, space, listing=listing)
    counted = category_counts(conn, scope)
    triage = counted["triage"]
    return {
        "triage": triage["tasks"] + triage["goals"] + triage["stages"],
        "ready": counted["ready"]["tasks"],
        "active": counted["active"]["tasks"],
        "waiting_owner": len(questions.open_on(conn, scope.where(), scope.parameters)),
    }


def period(start: str, end: str, utc_offset: int) -> Period:
    """The period a caller names by days of its zone, refused in the words Analytics uses."""

    try:
        begins, ends = usage.period(start, end, step="day", utc_offset=utc_offset)
    except usage.UsageQueryError as error:
        raise model.PlanningError(str(error)) from error
    return Period(begins, ends, utc_offset)


def _store_path(conn: sqlite3.Connection) -> str:
    """The file of the store this connection writes, where its list of attached stores lies."""

    for row in conn.execute("PRAGMA database_list"):
        if row[1] == "main" and row[2]:
            return str(row[2])
    return ""


def _known_project(conn: sqlite3.Connection, project: str) -> bool:
    """Whether the registry lists the project or an item of the store names it."""

    listing = project_registry.read_registry()
    if listing["status"] == "available" and any(
        str(entry["project_id"]) == project for entry in listing["projects"]
    ):
        return True
    return bool(item_projects.naming(conn, [project]))


# -- the counts by category ------------------------------------------------------

#: Each item of a scope with its category and the moment it came to stand where it is
#: (`standing.ENTERED_AT`, as the triage stack reads it).
_STANDING = (
    "SELECT i.work_item_id, i.number, i.kind, i.parent_id, i.created_at, i.labels,"
    " s.category,"
    " p.key AS space_key,"
    " {entered} AS since"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE {where}"
)


def _standing(
    conn: sqlite3.Connection, scope: Scope, *more: str, parameters: tuple[object, ...] = ()
) -> list[sqlite3.Row]:
    """The scope's items, each where it stands and since when, kept by `more` conditions too."""

    where = " AND ".join((scope.where(), *more))
    query = _STANDING.format(entered=standing.ENTERED_AT, where=where)
    return conn.execute(query, (*scope.parameters, *parameters)).fetchall()


def category_counts(
    conn: sqlite3.Connection,
    scope: Scope,
    period: Period | None = None,
    beside: Sequence[sqlite3.Connection] = (),
) -> dict[str, dict]:
    """The scope's tasks, goals and stages in each stored category, with the card longest there.

    Keyed by every category the store holds, the service one too, where an accepted
    open goal or stage stands. Each says `tasks`, `goals`, `stages` and `oldest`: the
    card that came to stand there first, with its `since`, or None when none stands
    there. With a period, a completed or cancelled card counts only when it came to
    stand there inside it; without one, every card counts as it stands now. The stores
    `beside` count too, but for one an earlier build wrote (`holds_the_work_model`).
    """

    rows = _standing(conn, scope)
    for store in beside:
        if holds_the_work_model(store):
            rows.extend(_standing(store, scope))
    found: dict[str, dict] = {
        category: {"tasks": 0, "goals": 0, "stages": 0, "oldest": None}
        for category in model.STORED_CATEGORIES
    }
    first: dict[str, tuple] = {}
    for row in rows:
        if not _counted(row, period):
            continue
        category = str(row["category"])
        since = usage.stored_micro(str(row["since"]))
        counted = found[category]
        shape = model.outward_kind(row["kind"], row["parent_id"])
        counted["goals" if shape == "goal" else "stages" if shape == "stage" else "tasks"] += 1
        order = (since, str(row["space_key"]), int(row["number"]))
        if category not in first or order < first[category]:
            first[category] = order
            counted["oldest"] = {
                "work_item_id": str(row["work_item_id"]),
                "reference": model.human_id(str(row["space_key"]), int(row["number"])),
                "since": str(row["since"]),
            }
    return found


def _counted(row: sqlite3.Row, period: Period | None) -> bool:
    """Whether a card counts where it stands: always in an open category, and in completed
    or cancelled only when it came to stand there inside the period, when there is one."""

    if period is None or str(row["category"]) not in model.TERMINAL_CATEGORIES:
        return True
    return period.holds(usage.stored_micro(str(row["since"])))


def _categories(conn: sqlite3.Connection, request: Request) -> list[dict]:
    """The eight categories in the model's order, the longest-standing card of each open one.

    Under a filter only tasks match, and `goals` and `stages` are null rather than none.
    """

    counted = category_counts(conn, request.matching(), request.period, request.beside)
    filtered = request.work_filter is not None
    return [
        {
            "category": category,
            "tasks": counted[category]["tasks"],
            "goals": None if filtered else counted[category]["goals"],
            "stages": None if filtered else counted[category]["stages"],
            "oldest": counted[category]["oldest"] if category in OPEN_CATEGORIES else None,
        }
        for category in model.PUBLIC_CATEGORIES
    ]


def _waiting_owner(
    conn: sqlite3.Connection, scope: Scope, beside: Sequence[sqlite3.Connection] = ()
) -> dict:
    """The questions open for the owner on the scope's items, and the one asked first, in
    `conn` and the stores `beside` it. A store beside it that cannot answer is left out,
    as the questions window skips it."""

    asked = [(conn, row) for row in questions.open_on(conn, scope.where(), scope.parameters)]
    for store in beside:
        try:
            found = questions.open_on(store, scope.where(), scope.parameters)
        except sqlite3.Error:
            continue
        asked.extend((store, row) for row in found)
    if not asked:
        return {"count": 0, "oldest": None}
    holder, first = min(
        asked,
        key=lambda pair: (
            usage.stored_micro(str(pair[1]["created_at"])),
            str(pair[1]["request_id"]),
        ),
    )
    item = read_model.item_by_id(holder, str(first["work_item_id"]))
    return {
        "count": len(asked),
        "oldest": {
            "request_id": str(first["request_id"]),
            "reference": read_model.reference(holder, item),
            "since": str(first["created_at"]),
        },
    }


def _unattached_commits(conn: sqlite3.Connection, scope: Scope) -> int | None:
    """How many commits stand on no card of the project read, of the space's projects or of
    the whole store: the total of the list the number opens.

    None when that list cannot be read for the scope: a project only items name, which
    the registry does not list, or a space or project while the registry cannot be read.
    The number has no list to open then, and the rest of the read still answers.
    """

    try:
        if scope.project is not None:
            listed = commits.unattached(conn, project=scope.project, limit=0)
        elif scope.space is not None:
            listed = commits.unattached(conn, space=str(scope.space["key"]), limit=0)
        else:
            listed = commits.unattached(conn, limit=0)
    except commits.UnknownProjectsError:
        return None
    return int(listed["total"])


def _counts(reading: Reading) -> dict:
    conn, request = reading.conn, reading.request
    # A commit on no card has no task whose kind and labels a filter could test, and its
    # number opens the list it is attached from: no filter narrows it.
    return {
        "categories": _categories(conn, request),
        "waiting_owner": _waiting_owner(conn, request.matching(), request.beside),
        "unattached_commits": _unattached_commits(conn, request.scope),
    }


# -- the goals -------------------------------------------------------------------


def _goals(reading: Reading) -> list[dict]:
    """The scope's open goals and those that came to a close in the period, with their stages.

    In space key and number order. Each adds up what the scope holds of it
    (`goal_volumes.rows`): a goal of another space, or one read through a project,
    may hold work the scope does not, and says so. Under a filter each adds up the
    tasks that match alone, and a goal with none under it has no row.
    """

    conn, request = reading.conn, reading.request
    scope, matching = request.scope, request.matching()
    found = [
        row
        for row in _standing(
            conn, scope, "i.kind = ?", "i.parent_id IS NULL", parameters=(model.CONTAINER_KIND,)
        )
        if str(row["category"]) not in model.TERMINAL_CATEGORIES
        or request.period.holds(usage.stored_micro(str(row["since"])))
    ]
    found.sort(key=lambda row: (str(row["space_key"]), int(row["number"])))
    return goal_volumes.rows(
        conn,
        [str(row["work_item_id"]) for row in found],
        where=scope.where(),
        parameters=scope.parameters,
        matching=None if request.work_filter is None else (matching.where(), matching.parameters),
        basis=reading.basis,
        space_id=None if scope.space is None else str(scope.space["planning_space_id"]),
        children=True,
    )


# -- the work outside goals ------------------------------------------------------


def _outside(reading: Reading) -> dict:
    """The scope's tasks under no goal, by project and by label, counted by category.

    A task counts as it does in the counts (`_counted`). By project, each task stands
    in one row: its one project, several or none, written as a project group of the
    Analytics read, so the rows add up to `tasks`. By label, a task stands in the row
    of each of its labels and one with none in the row of no label, so those rows add
    up to no total. Each row says all eight categories; the most tasks first. Under a
    filter it counts the tasks the filter keeps, and with labels named the rows by label
    are only theirs: a row of another label would show only where it meets the filter.
    """

    conn, request = reading.conn, reading.request
    shown = () if request.work_filter is None else request.work_filter.labels
    rows = [
        row
        for row in _standing(
            conn,
            request.matching(),
            "i.kind != ?",
            "i.parent_id IS NULL",
            parameters=(model.CONTAINER_KIND,),
        )
        if _counted(row, request.period)
    ]
    held = item_projects.ids_of_items(conn, [str(row["work_item_id"]) for row in rows])
    by_project: dict[usage.Value, list[sqlite3.Row]] = {}
    sets: dict[usage.Value, set[frozenset[str]]] = {}
    by_label: dict[str | None, list[sqlite3.Row]] = {}
    for row in rows:
        projects = held.get(str(row["work_item_id"]), frozenset())
        group: usage.Value = usage.SEVERAL if len(projects) > 1 else next(iter(projects), None)
        by_project.setdefault(group, []).append(row)
        sets.setdefault(group, set()).add(projects)
        labels: list[str | None] = [*model.labels(json.loads(str(row["labels"])))]
        for label in labels or [None]:
            if not shown or label in shown:
                by_label.setdefault(label, []).append(row)
    names = usage.project_names(held.values())
    projects_first = sorted(
        by_project.items(), key=lambda entry: usage.ranking(len(entry[1]), None, (entry[0],))
    )
    labels_first = sorted(
        by_label.items(), key=lambda entry: (-len(entry[1]), entry[0] is None, entry[0] or "")
    )
    return {
        "tasks": len(rows),
        "by_project": [
            {
                "project": usage.project_group(group, names, sets[group]),
                "categories": _by_category(found),
            }
            for group, found in projects_first
        ],
        "by_label": [
            {"label": label, "categories": _by_category(found)} for label, found in labels_first
        ],
    }


def _by_category(rows: list[sqlite3.Row]) -> dict[str, int]:
    """How many of these tasks stand in each of the eight categories, in the model's order."""

    found = dict.fromkeys(model.PUBLIC_CATEGORIES, 0)
    for row in rows:
        found[str(row["category"])] += 1
    return found


# -- the flow --------------------------------------------------------------------


def _flow(reading: Reading) -> dict:
    """The scope's tasks created and closed by day, the owner's decisions, its commits, its pace.

    Its commits on no card are those of the scope's projects: the project read, or the
    projects the registry binds to the space read, or every known repository's. Under a
    filter it reads the tasks the filter keeps, their decisions and the commits attached
    to them; a commit on no card has no task to match, and none is counted.
    """

    conn, request = reading.conn, reading.request
    scope, period = request.scope, request.period
    projects: list[str] | None = None
    if request.work_filter is not None:
        projects = []
    elif scope.project is not None:
        projects = [scope.project]
    elif scope.space is not None:
        projects = item_projects.space_project_ids(conn, str(scope.space["key"]))
    kept = request.matching()
    return volume_flow.flow(
        conn,
        _standing(conn, kept, "i.kind != ?", parameters=(model.CONTAINER_KIND,)),
        where=kept.where(),
        parameters=kept.parameters,
        projects=projects,
        begins=period.begins,
        ends=period.ends,
        utc_offset=period.utc_offset,
    )


# -- the estimates ---------------------------------------------------------------


def _estimates(reading: Reading) -> dict:
    """The scope's done work that estimates are judged by, described by project, kind and
    label. Under a filter it is the done tasks that match, and with labels named the rows
    by label are only theirs."""

    work_filter = reading.request.work_filter
    return estimates.table(reading.basis, () if work_filter is None else work_filter.labels)


# -- the read --------------------------------------------------------------------


def measured_from(conn: sqlite3.Connection) -> str | None:
    """When usage was first counted to an item in this store: before it, work is counted short."""

    row = conn.execute(usage.FIRST_COUNTED).fetchone()
    return None if row is None or row[0] is None else str(row[0])


Section = Callable[[Reading], object]

#: The sections of the answer after its frame, in the order it gives them. Each is one
#: function of the reading; a part of the read is added as one more entry here.
SECTIONS: tuple[tuple[str, Section], ...] = (
    ("counts", _counts),
    ("goals", _goals),
    ("outside", _outside),
    ("flow", _flow),
    ("estimates", _estimates),
)


def read(conn: sqlite3.Connection, request: Request) -> dict:
    """What stands in the request's scope and what came to a close in its period."""

    matching = request.matching()
    reading = Reading(conn, request, estimates.read(conn, matching.where(), matching.parameters))
    return {
        "scope": request.scope.answer(),
        "period": request.period.answer(),
        "filter": None if request.work_filter is None else request.work_filter.answer(),
        "measured_from": measured_from(conn),
        "coverage": list(request.coverage),
        # The stores beside it count at the top alone: the sections under it read `conn`.
        "attached_work": _holds_work(request.beside),
        **{name: section(reading) for name, section in SECTIONS},
    }
