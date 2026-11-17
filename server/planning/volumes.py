"""How much work stands in a scope, and what it took: the read behind the Volumes page.

A read names its scope and its period. The scope is every space of the store this
service writes, or one space, or one space narrowed to a project, and it holds the
items the space's board holds (`item_projects.space_read`): a number here opens the
board on the same items. The period is the Analytics grammar (`usage.period`): a
date is the start of that day in the caller's zone, and `to` is not in it.

The read is a frame — the scope, the period and the moment usage was first counted
to items — and its sections, each one function of the request (`SECTIONS`). The
counts by category are the first section: work in an open category is counted as
it stands now, with the card longest in it, and work that came to be completed or
cancelled is counted when it came to stand there inside the period.

Only the store this service writes is read. Usage is written there alone, and an
attached store is read as an earlier build left it, so a space of one is refused
rather than counted short.
"""

from __future__ import annotations

import datetime as dt
import sqlite3
from collections.abc import Callable
from typing import NamedTuple

from ..projects import project_registry, scopes
from ..store_identity.metadata import read_store_metadata
from . import item_projects, model, usage

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
    """What one read is asked: what it counts and over which period."""

    scope: Scope
    period: Period


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

#: Each item of a scope with its category and the moment it came to stand where it is:
#: its last state entry (`model.STATE_ENTRY_ACTIONS`), or its creation when it has none.
_STANDING = (
    "SELECT i.work_item_id, i.number, i.kind, i.parent_id, s.category, p.key AS space_key,"
    " COALESCE((SELECT e.created_at FROM work_item_events e"
    "  WHERE e.work_item_id = i.work_item_id"
    "  AND e.action IN ({entries}) ORDER BY e.id DESC LIMIT 1), i.created_at) AS since"
    " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE {where}"
)


def _micro(text: str) -> int:
    moment = dt.datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.UTC)
    return usage.micro(moment)


def category_counts(
    conn: sqlite3.Connection, scope: Scope, period: Period | None = None
) -> dict[str, dict]:
    """The scope's tasks, goals and stages in each stored category, with the card longest there.

    Keyed by every category the store holds, the service one too, where an accepted
    open goal or stage stands. Each says `tasks`, `goals`, `stages` and `oldest`: the
    card that came to stand there first, with its `since`, or None when none stands
    there. With a period, a completed or cancelled card counts only when it came to
    stand there inside it; without one, every card counts as it stands now.
    """

    entries = ", ".join("?" * len(model.STATE_ENTRY_ACTIONS))
    query = _STANDING.format(entries=entries, where=scope.where())
    rows = conn.execute(query, (*model.STATE_ENTRY_ACTIONS, *scope.parameters)).fetchall()
    found: dict[str, dict] = {
        category: {"tasks": 0, "goals": 0, "stages": 0, "oldest": None}
        for category in model.STORED_CATEGORIES
    }
    first: dict[str, tuple] = {}
    for row in rows:
        category = str(row["category"])
        since = _micro(str(row["since"]))
        if period is not None and category in model.TERMINAL_CATEGORIES and not period.holds(since):
            continue
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


def _categories(conn: sqlite3.Connection, request: Request) -> list[dict]:
    """The eight categories in the model's order, the longest-standing card of each open one."""

    counted = category_counts(conn, request.scope, request.period)
    return [
        {
            "category": category,
            "tasks": counted[category]["tasks"],
            "goals": counted[category]["goals"],
            "stages": counted[category]["stages"],
            "oldest": counted[category]["oldest"] if category in OPEN_CATEGORIES else None,
        }
        for category in model.PUBLIC_CATEGORIES
    ]


def _counts(conn: sqlite3.Connection, request: Request) -> dict:
    return {"categories": _categories(conn, request)}


# -- the read --------------------------------------------------------------------


def measured_from(conn: sqlite3.Connection) -> str | None:
    """When usage was first counted to an item in this store: before it, work is counted short."""

    row = conn.execute(
        "SELECT MIN(started_at) FROM usage_segments WHERE work_item_id IS NOT NULL"
    ).fetchone()
    return None if row is None or row[0] is None else str(row[0])


Section = Callable[[sqlite3.Connection, Request], object]

#: The sections of the answer after its frame, in the order it gives them. Each is one
#: function of the request; a part of the read is added as one more entry here.
SECTIONS: tuple[tuple[str, Section], ...] = (("counts", _counts),)


def read(conn: sqlite3.Connection, request: Request) -> dict:
    """What stands in the request's scope and what came to a close in its period."""

    return {
        "scope": request.scope.answer(),
        "period": request.period.answer(),
        "measured_from": measured_from(conn),
        **{name: section(conn, request) for name, section in SECTIONS},
    }
