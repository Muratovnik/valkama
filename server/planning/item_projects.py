"""The projects a work item changes, each with the source it came by.

An item names a set of projects, one row each in `work_item_projects`: no order,
no repeats, at most `MAX_PROJECTS`. A project is a registered repository root, so
a project is named only while the registry reads and records it; a write that
names none passes whatever the registry says. The space an item lies in is not
one of its projects and does not change with them.

Each row says how the project came to the item (`SOURCES`): `named` by whoever
filed or edited it, `commits` derived from the repositories of its commits,
`migrated` when nothing else said and the item took its space's former project.
A project has one source on an item; when it arrives by two ways, the strongest
stays, in the order of `SOURCES`.

A goal or stage stores none: its projects are those of every task under it, at
any depth, each with the strongest source any of them gives it. The name a reader
sees is the registry's, read when the item is, since the store holds only the id.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Sequence

from ..projects import project_registry
from . import model

#: The sources a project comes to an item by, strongest first.
SOURCES = model.PROJECT_SOURCES
NAMED = SOURCES[0]
#: The most projects one item names.
MAX_PROJECTS = 20
_PROJECT_ID_LIMIT = 160
_RANK = {source: index for index, source in enumerate(SOURCES)}

CONTAINER_NAMES_NONE = "[project] a goal or stage names no projects: the tasks under it do"
REGISTRY_UNREADABLE = (
    "[project] the project registry cannot be read, so projects cannot be named now"
)

#: Each item's own rows, and for a goal or stage those of every item under it: the
#: walk starts at each item read and goes down, so a task is its own only member.
_UNDER = (
    "WITH RECURSIVE under(root, work_item_id) AS ("
    " SELECT value, value FROM json_each(?)"
    " UNION ALL SELECT u.root, w.work_item_id FROM work_items w"
    " JOIN under u ON w.parent_id = u.work_item_id)"
    " SELECT u.root, p.project_id, p.source FROM under u"
    " JOIN work_item_projects p ON p.work_item_id = u.work_item_id"
)


def strongest(first: str, second: str) -> str:
    """The source a project keeps when it comes to one item by both."""

    return first if _RANK[first] <= _RANK[second] else second


def named(value: object, field: str = "projects") -> list[str] | None:
    """The project ids a write names, as a set in the order given; None when it names none."""

    if value is None:
        return None
    if not isinstance(value, list):
        raise model.PlanningError(f"{field} must be a list of project ids")
    seen: list[str] = []
    for index, entry in enumerate(value):
        project = model.text_field(entry, f"{field}[{index}]", limit=_PROJECT_ID_LIMIT)
        if project not in seen:
            seen.append(project)
    if len(seen) > MAX_PROJECTS:
        raise model.PlanningError(f"{field} must hold at most {MAX_PROJECTS} projects")
    return seen


def require_nameable(projects: Sequence[str], *, container: bool) -> None:
    """Refuse a set of projects an item cannot name, before anything is written.

    An empty set is always nameable: it needs no registry, and a goal or stage
    names exactly that.
    """

    if not projects:
        return
    if container:
        raise model.PlanningError(CONTAINER_NAMES_NONE)
    listing = project_registry.read_registry()
    if listing["status"] != "available":
        raise model.PlanningError(REGISTRY_UNREADABLE)
    registered = sorted(str(project["project_id"]) for project in listing["projects"])
    missing = [project for project in projects if project not in registered]
    if not missing:
        return
    shown = ", ".join(registered) or "none"
    subject = (
        f"project {missing[0]} is" if len(missing) == 1 else f"projects {', '.join(missing)} are"
    )
    raise model.PlanningError(
        f"[project] {subject} not registered: registered projects are {shown}"
    )


def _stored(conn: sqlite3.Connection, work_item_id: str) -> dict[str, str]:
    return {
        str(row[0]): str(row[1])
        for row in conn.execute(
            "SELECT project_id, source FROM work_item_projects WHERE work_item_id = ?",
            (work_item_id,),
        )
    }


def _put(conn: sqlite3.Connection, work_item_id: str, project_id: str, source: str) -> None:
    """One project on an item, keeping the stronger source when it is there already."""

    current = conn.execute(
        "SELECT source FROM work_item_projects WHERE work_item_id = ? AND project_id = ?",
        (work_item_id, project_id),
    ).fetchone()
    if current is None:
        conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source) VALUES(?,?,?)",
            (work_item_id, project_id, source),
        )
    elif strongest(source, str(current[0])) != str(current[0]):
        conn.execute(
            "UPDATE work_item_projects SET source = ? WHERE work_item_id = ? AND project_id = ?",
            (source, work_item_id, project_id),
        )


def differs(conn: sqlite3.Connection, work_item_id: str, projects: Sequence[str]) -> bool:
    """Whether `replace` with `projects` would change the item's set or a source."""

    before = _stored(conn, work_item_id)
    return set(before) != set(projects) or any(before[project] != NAMED for project in projects)


def replace(conn: sqlite3.Connection, work_item_id: str, projects: Sequence[str]) -> None:
    """Make `projects` the item's whole set, each named.

    The caller has held the set to `require_nameable` and holds the write lock.
    A project the item keeps is named now, and named is the strongest source.
    """

    gone = sorted(set(_stored(conn, work_item_id)) - set(projects))
    if gone:
        conn.execute(
            "DELETE FROM work_item_projects WHERE work_item_id = ?"
            " AND project_id IN (SELECT value FROM json_each(?))",
            (work_item_id, json.dumps(gone)),
        )
    for project in projects:
        _put(conn, work_item_id, project, NAMED)


def carry(conn: sqlite3.Connection, source_id: str, target_id: str) -> int:
    """Move one item's projects to another, each keeping the stronger source; how many moved."""

    moving = _stored(conn, source_id)
    for project, source in sorted(moving.items()):
        _put(conn, target_id, project, source)
    conn.execute("DELETE FROM work_item_projects WHERE work_item_id = ?", (source_id,))
    return len(moving)


def of_items(conn: sqlite3.Connection, rows: Iterable[sqlite3.Row]) -> dict[str, list[dict]]:
    """The projects of each item read, by work item id, in one walk of the store.

    A task's are its own rows; a goal's or stage's are the rows of everything
    under it, each project once with its strongest source. The registry is read
    only when some item names a project, and a project it does not record now
    shows `display_name` null. An attached store an earlier build wrote is read
    as it is: it has no such table, and its items name no projects.
    """

    identities = [str(row["work_item_id"]) for row in rows]
    found: dict[str, dict[str, str]] = {identity: {} for identity in identities}
    # Asked for directly rather than probed first: a probe is one more statement on
    # every read, and the read's statement count is bounded.
    try:
        held_rows = conn.execute(_UNDER, (json.dumps(identities),)).fetchall()
    except sqlite3.OperationalError as error:
        if not str(error).startswith("no such table: work_item_projects"):
            raise
        return {identity: [] for identity in identities}
    for root, project, source in held_rows:
        held = found[str(root)]
        held[str(project)] = strongest(str(source), held.get(str(project), str(source)))
    names: dict[str, str] = {}
    if any(found.values()):
        listing = project_registry.read_registry()
        if listing["status"] == "available":
            names = {
                str(entry["project_id"]): str(entry["display_name"])
                for entry in listing["projects"]
            }
    return {
        identity: [
            {"project_id": project, "display_name": names.get(project), "source": source}
            for project, source in sorted(held.items())
        ]
        for identity, held in found.items()
    }


def of_item(conn: sqlite3.Connection, row: sqlite3.Row) -> list[dict]:
    """One item's projects, as `of_items` reads them."""

    return of_items(conn, [row])[str(row["work_item_id"])]
