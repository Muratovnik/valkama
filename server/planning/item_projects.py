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

Where a new item lies is `placement`, where a launch from an item runs
`launch_root`, the roots a claim names `project_roots`, and the roots a launch gets
beside its own `added_roots`: each is the one answer to its question.

Which commits the text of a 2.9 commit ref names, each with its project, is
`commit_pairs`: the one answer to it, asked of Git in the registered roots. The
projects a task takes from its commits, `commit_projects`, are read off those pairs,
so the projects and the commits the migration carries cannot disagree.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, NamedTuple, TypedDict

from .. import processes, sessions
from ..projects import project_registry
from ..store_identity.metadata import read_store_metadata
from . import model

#: The sources a project comes to an item by, strongest first.
SOURCES = model.PROJECT_SOURCES
NAMED = SOURCES[0]
COMMITS = SOURCES[1]
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


def project_id(value: object, field: str) -> str:
    """One project id as a caller names it, held to the length an id may have."""

    return model.text_field(value, field, limit=_PROJECT_ID_LIMIT)


def named(value: object, field: str = "projects") -> list[str] | None:
    """The project ids a write names, as a set in the order given; None when it names none."""

    if value is None:
        return None
    if not isinstance(value, list):
        raise model.PlanningError(f"{field} must be a list of project ids")
    seen: list[str] = []
    for index, entry in enumerate(value):
        project = project_id(entry, f"{field}[{index}]")
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


def with_projects(
    spaces: Iterable[Mapping[str, Any]],
    listing: project_registry.RegistryResult,
    data_scope_id: str,
) -> list[dict]:
    """Each space record with the projects the registry binds to it in `data_scope_id`.

    `projects` lists them the default first, then by id, each with its root, and
    `default_project` names the default one, or None when no project is bound. A
    registry that was not read knows no projects, which is not the same as none:
    both fields are then None.
    """

    known = listing["status"] == "available"
    shown: list[dict] = []
    for space in spaces:
        if not known:
            shown.append({**space, "projects": None, "default_project": None})
            continue
        bound = project_registry.space_projects(
            listing["projects"], {"data_scope_id": data_scope_id, "space_key": str(space["key"])}
        )
        shown.append(
            {
                **space,
                "projects": [
                    {
                        "project_id": str(project["project_id"]),
                        "display_name": str(project["display_name"]),
                        "root": str(project["canonical_root"]),
                        "default": bool(project["planning_binding"]["default"]),
                    }
                    for project in bound
                ],
                "default_project": str(bound[0]["project_id"]) if bound else None,
            }
        )
    return shown


def spaces_shown(conn: sqlite3.Connection, spaces: Iterable[Mapping[str, Any]]) -> list[dict]:
    """`with_projects` for spaces of the store `conn` reads, by the registry as it reads now."""

    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    return with_projects(spaces, project_registry.read_registry(), data_scope_id)


# -- where a new item lies ------------------------------------------------------

PLACEMENT_UNNAMED = "[placement] name the space, or the projects the item changes"


def _listed(words: Sequence[str]) -> str:
    """`A`, `A and B`, `A, B and C`."""

    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def session_space(
    conn: sqlite3.Connection,
    session_id: str | None,
    *,
    listing: project_registry.RegistryResult | None = None,
) -> str | None:
    """The key of the space whose project root holds the session's folder.

    The place is `sessions.session_place`'s; None without a session, without a
    folder under a registered root, or when that root's project binds no space of
    this store, a key the registry still binds after its space is gone included.
    `listing` is the registry as a caller already read it.
    """

    if session_id is None:
        return None
    if listing is None:
        listing = project_registry.read_registry()
    place = sessions.session_place(conn, session_id, listing)
    key = None if place is None else place["space_key"]
    if (
        key is None
        or conn.execute("SELECT 1 FROM planning_spaces WHERE key = ?", (key,)).fetchone()
    ):
        return key
    return None


def placement(
    conn: sqlite3.Connection,
    *,
    space: str | None,
    projects: Sequence[str],
    parent_space: str | None,
    session_id: str | None,
) -> str:
    """The key of the space a new item lies in, or a `[placement]` refusal naming the candidates.

    Under a parent it is the parent's space, as an item and its parent share one.
    Else the projects decide by their home spaces, the spaces of this store the
    registry binds them to: one home is where the item lies, between several
    `space` names one, and with none `space` is needed. Without projects it is
    `space`, and without that the space of the calling session (`session_space`).
    A set of projects has no first one, and a session may stand anywhere, so
    neither breaks a tie. `space` and `parent_space` are keys; where `space` is
    named it must be the space this chooses. The projects are nameable already
    (`require_nameable`).
    """

    if parent_space is not None:
        if space is not None and space != parent_space:
            raise model.PlanningError(
                f"[placement] the parent lies in {parent_space}: an item lies in its parent's space"
            )
        return parent_space
    if not projects:
        found = space if space is not None else session_space(conn, session_id)
        if found is None:
            raise model.PlanningError(PLACEMENT_UNNAMED)
        return found
    homes = _homes(conn, projects)
    candidates = sorted(set(homes.values()))
    if space is not None and (not candidates or space in candidates):
        return space
    if space is not None:
        raise model.PlanningError(
            f"[placement] space {space} is none of the spaces of the item's projects:"
            f" {', '.join(candidates)}"
        )
    if len(candidates) == 1:
        return candidates[0]
    if candidates:
        raise model.PlanningError(
            f"[placement] projects {_listed(sorted(homes))} live in {_listed(candidates)}:"
            " name one of them as space"
        )
    homeless = sorted(projects)
    subject = (
        f"project {homeless[0]} lives"
        if len(homeless) == 1
        else f"projects {_listed(homeless)} live"
    )
    raise model.PlanningError(f"[placement] {subject} in no space of this store: name the space")


def _homes(conn: sqlite3.Connection, projects: Sequence[str]) -> dict[str, str]:
    """The key of each project's home space in this store, for the projects that have one."""

    listing = project_registry.read_registry()
    if listing["status"] != "available":
        raise model.PlanningError(REGISTRY_UNREADABLE)
    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    homes: dict[str, str] = {}
    for entry in listing["projects"]:
        home = project_registry.home_space(entry, data_scope_id)
        if home is not None and str(entry["project_id"]) in projects:
            homes[str(entry["project_id"])] = home
    return homes


# -- the roots a launch and a claim name -----------------------------------------


class LaunchRoot(TypedDict):
    """Where a launch from one item runs, and why the root may be blank."""

    #: The project whose root it is; None when no project is chosen or known.
    project_id: str | None
    #: The project's registered root; None when the registry names none.
    root: str | None
    #: A word of `LAUNCH_ROOT_STATUSES`.
    status: str
    #: The item's space's `launch_place`.
    launch_place: str


#: How a root a claim names stands: its directory is there, is not, the project is
#: no longer registered, or the registry was not read, a registry that does not
#: parse included.
ROOT_STATUSES = ("mapped", "missing", "unregistered", "unavailable")
#: The launch root's own case where the item's space binds no project.
UNBOUND = "unbound"
#: The launch root's own case where the read names no item, or one there is not.
NO_ITEM = "no_item"
#: How the launch root stands: each word of `ROOT_STATUSES` meaning what it means
#: for a claim's root, and the two cases only a launch root has.
LAUNCH_ROOT_STATUSES = (*ROOT_STATUSES, UNBOUND, NO_ITEM)


def _item_place(conn: sqlite3.Connection, work_item_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT s.key, s.launch_place, w.kind FROM work_items w JOIN planning_spaces s"
        " ON s.planning_space_id = w.planning_space_id WHERE w.work_item_id = ?",
        (work_item_id,),
    ).fetchone()
    if row is None:
        raise model.WorkItemNotFoundError(f"no work item {work_item_id}")
    return row


def _bound(
    conn: sqlite3.Connection, listing: project_registry.RegistryResult, space_key: str
) -> list[Mapping[str, Any]]:
    """The projects the registry binds to one space of this store, the default first."""

    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    return project_registry.space_projects(
        listing["projects"], {"data_scope_id": data_scope_id, "space_key": space_key}
    )


def launch_root(
    conn: sqlite3.Connection,
    work_item_id: str,
    *,
    listing: project_registry.RegistryResult | None = None,
) -> LaunchRoot:
    """The root a launch from this item runs in, by its space's launch place.

    `space` takes the space's root, the root of its default project. `item_project`
    takes the root of the item's one project, in whatever space that project
    lives; with no project or with several it takes the space's root too, since a
    set has no first project and the space's root is always registered. A goal or
    stage is never launched from, so its root is always the space's. `listing` is
    the registry as a caller already read it; without one it is read here.
    """

    place = _item_place(conn, work_item_id)
    launch_place = str(place["launch_place"])
    own: list[str] = []
    if launch_place == model.LAUNCH_PLACES[1] and place["kind"] != model.CONTAINER_KIND:
        own = sorted(ids_of_items(conn, [work_item_id])[work_item_id])
    chosen = own[0] if len(own) == 1 else None
    if listing is None:
        listing = project_registry.read_registry()
    if listing["status"] != "available":
        return {
            "project_id": chosen,
            "root": None,
            "status": "unavailable",
            "launch_place": launch_place,
        }
    if chosen is None:
        bound = _bound(conn, listing, str(place["key"]))
        entry = bound[0] if bound else None
    else:
        entry = next(
            (found for found in listing["projects"] if found["project_id"] == chosen), None
        )
    if entry is None:
        # The item's own project left the registry, the word `project_roots` gives
        # it; without one chosen, the space binds none.
        return {
            "project_id": chosen,
            "root": None,
            "status": UNBOUND if chosen is None else "unregistered",
            "launch_place": launch_place,
        }
    root = str(entry["canonical_root"])
    return {
        "project_id": str(entry["project_id"]),
        "root": root,
        "status": "mapped" if os.path.isdir(root) else "missing",
        "launch_place": launch_place,
    }


def project_roots(
    conn: sqlite3.Connection,
    work_item_id: str,
    *,
    listing: project_registry.RegistryResult | None = None,
) -> list[dict]:
    """The root of each project the item changes, the one a claim answers with.

    An item that names none holds its space's default project. The list puts the
    projects of the item's space first, its default one before the others, then
    every other project; inside each part by id, and since an item names a project
    once the order is total. So the project of the launch root comes first whenever
    the item names it. A registry that was not read knows neither roots nor spaces:
    the item's projects then come by id, each `unavailable`, and an item that names
    none has an empty list, its default project being unknown too. `listing` is
    the registry as a caller already read it; without one it is read here.
    """

    place = _item_place(conn, work_item_id)
    named_ids = sorted(ids_of_items(conn, [work_item_id])[work_item_id])
    if listing is None:
        listing = project_registry.read_registry()
    if listing["status"] != "available":
        return [
            {"project_id": project, "display_name": None, "root": None, "status": "unavailable"}
            for project in named_ids
        ]
    bound = _bound(conn, listing, str(place["key"]))
    if not named_ids and bound:
        named_ids = [str(bound[0]["project_id"])]
    rank = {str(project["project_id"]): index for index, project in enumerate(bound)}
    registered = {str(entry["project_id"]): entry for entry in listing["projects"]}
    roots = []
    for project in sorted(named_ids, key=lambda found: (rank.get(found, len(rank)), found)):
        entry = registered.get(project)
        if entry is None:
            roots.append(
                {
                    "project_id": project,
                    "display_name": None,
                    "root": None,
                    "status": "unregistered",
                }
            )
            continue
        root = str(entry["canonical_root"])
        roots.append(
            {
                "project_id": project,
                "display_name": str(entry["display_name"]),
                "root": root,
                "status": "mapped" if os.path.isdir(root) else "missing",
            }
        )
    return roots


class AddedRoot(TypedDict):
    """One root a launch gets beside its launch root."""

    project_id: str
    root: str


def added_roots(conn: sqlite3.Connection, work_item_id: str) -> list[AddedRoot]:
    """The roots a launch from this item gets beside the one it runs in.

    The root of every project of the item's space and of every other project the
    item names, whose directory is there (`mapped`), except the launch root and
    the roots inside it, which the client reaches already. First the item's own
    in the order of `project_roots`, then the space's projects it does not name,
    by id. A registry that was not read gives none: no root is known then.
    """

    listing = project_registry.read_registry()
    if listing["status"] != "available":
        return []
    launch = launch_root(conn, work_item_id, listing=listing)["root"]
    named = project_roots(conn, work_item_id, listing=listing)
    candidates = [
        (str(root["project_id"]), str(root["root"])) for root in named if root["status"] == "mapped"
    ]
    taken = {str(root["project_id"]) for root in named}
    space = _bound(conn, listing, str(_item_place(conn, work_item_id)["key"]))
    candidates += [
        (str(project["project_id"]), str(project["canonical_root"]))
        for project in sorted(space, key=lambda project: str(project["project_id"]))
        if str(project["project_id"]) not in taken and os.path.isdir(str(project["canonical_root"]))
    ]
    # Each root comes once: a project is a candidate once, and the registry refuses
    # two projects with one root.
    return [
        {"project_id": project, "root": root}
        for project, root in candidates
        if launch is None or not project_registry.holds(launch, root)
    ]


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


def put_from_commit(conn: sqlite3.Connection, work_item_id: str, project_id: str) -> None:
    """The project of a commit attached to a task, with the source `commits`.

    A project the task names stays `named`: the stronger source wins.
    """

    _put(conn, work_item_id, project_id, COMMITS)


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


def drop(conn: sqlite3.Connection, work_item_id: str) -> list[str]:
    """Take every project off an item, which is becoming a goal or stage; the ids taken, sorted.

    A goal or stage names none: the tasks under it do (`CONTAINER_NAMES_NONE`).
    """

    dropped = sorted(_stored(conn, work_item_id))
    conn.execute("DELETE FROM work_item_projects WHERE work_item_id = ?", (work_item_id,))
    return dropped


#: The items that name one of the projects of a JSON list, and every goal or stage above
#: them: a container names what the tasks under it name, at any depth.
_NAMING = (
    "WITH RECURSIVE naming(work_item_id) AS ("
    " SELECT work_item_id FROM work_item_projects"
    "  WHERE project_id IN (SELECT value FROM json_each(?))"
    " UNION SELECT w.parent_id FROM work_items w"
    "  JOIN naming n ON w.work_item_id = n.work_item_id WHERE w.parent_id IS NOT NULL)"
    " SELECT work_item_id FROM naming"
)


def naming(conn: sqlite3.Connection, projects: Iterable[str]) -> list[str]:
    """The items that name one of these projects, as a read sees them, by work item id.

    A task names its own; a goal or stage names those of every task under it, so it
    is among them when a task under it is. An attached store an earlier build wrote
    is read as it is: it has no such table, and none of its items names a project.
    """

    wanted = sorted(set(projects))
    if not wanted:
        return []
    try:
        rows = conn.execute(_NAMING, (json.dumps(wanted),)).fetchall()
    except sqlite3.OperationalError as error:
        if not str(error).startswith("no such table: work_item_projects"):
            raise
        return []
    return [str(row[0]) for row in rows]


def space_project_ids(
    conn: sqlite3.Connection,
    space_key: str,
    *,
    listing: project_registry.RegistryResult | None = None,
) -> list[str]:
    """The ids of the projects the registry binds to one space of the store `conn` reads.

    `listing` is the registry a caller read already, read here when it names none. A
    registry that was not read binds none that a read could rely on.
    """

    if listing is None:
        listing = project_registry.read_registry()
    if listing["status"] != "available":
        return []
    return [str(project["project_id"]) for project in _bound(conn, listing, space_key)]


def space_read(
    conn: sqlite3.Connection,
    space: sqlite3.Row | None,
    project: str | None = None,
    *,
    other_spaces: bool = True,
    listing: project_registry.RegistryResult | None = None,
) -> tuple[list[str], list[object]]:
    """The items a read holds, as conditions on `work_items i` and their parameters, in order.

    The one rule of which items a read of a space holds, for every reader that counts
    them as its board does. `space` is the space's row, its `planning_space_id` and
    `key`, or None for every space. A read of a space holds its items and, with
    `other_spaces`, the items of other spaces that name a project the registry binds
    to it. `project` (an id) narrows the read to the items naming it (`naming`): from
    the space, and from other spaces only when it is one of the space's projects, so
    a project of another space that the space's items name brings only the space's
    own. Without a space it keeps the items naming it in every space. The conditions
    are joined by `AND`; none means every item. `listing` is the registry a caller
    read already, read here when it names none.
    """

    kept = naming(conn, [project]) if project is not None else None
    clauses: list[str] = []
    parameters: list[object] = []
    if space is not None:
        space_id = str(space["planning_space_id"])
        foreign = (
            space_project_ids(conn, str(space["key"]), listing=listing) if other_spaces else []
        )
        if kept is not None:
            # Narrowed to one project, other spaces bring what names it, if it is the space's.
            foreign = [found for found in foreign if found == project]
        if foreign:
            clauses.append(
                "(i.planning_space_id = ? OR i.work_item_id IN (SELECT value FROM json_each(?)))"
            )
            reached = kept if kept is not None else naming(conn, foreign)
            parameters.extend([space_id, json.dumps(reached)])
        else:
            clauses.append("i.planning_space_id = ?")
            parameters.append(space_id)
    if kept is not None:
        clauses.append("i.work_item_id IN (SELECT value FROM json_each(?))")
        parameters.append(json.dumps(kept))
    return clauses, parameters


def naming_like(conn: sqlite3.Connection, like: str) -> list[str]:
    """The items that name a project whose id matches a `LIKE` pattern, by work item id.

    An attached store an earlier build wrote is read as it is: it has no such
    table, and none of its items names a project.
    """

    try:
        return [
            str(row[0])
            for row in conn.execute(
                "SELECT DISTINCT work_item_id FROM work_item_projects WHERE project_id LIKE ?",
                (like,),
            )
        ]
    except sqlite3.OperationalError as error:
        if not str(error).startswith("no such table: work_item_projects"):
            raise
        return []


def _walk(conn: sqlite3.Connection, identities: Sequence[str]) -> dict[str, dict[str, str]]:
    """Each item's projects with their strongest source, by work item id, in one walk.

    An item the store does not hold names none here. An attached store an earlier
    build wrote has no such table, and its items name none either.
    """

    found: dict[str, dict[str, str]] = {identity: {} for identity in identities}
    # Asked for directly rather than probed first: a probe is one more statement on
    # every read, and the read's statement count is bounded.
    try:
        held_rows = conn.execute(_UNDER, (json.dumps(list(found)),)).fetchall()
    except sqlite3.OperationalError as error:
        if not str(error).startswith("no such table: work_item_projects"):
            raise
        return found
    for root, project, source in held_rows:
        held = found[str(root)]
        held[str(project)] = strongest(str(source), held.get(str(project), str(source)))
    return found


def ids_of_items(conn: sqlite3.Connection, identities: Iterable[str]) -> dict[str, frozenset[str]]:
    """The project ids of each of these items, by work item id, read as `of_items` reads
    them: a goal's or stage's are those of every task under it. No registry is read."""

    return {
        identity: frozenset(held) for identity, held in _walk(conn, sorted(set(identities))).items()
    }


def of_items(conn: sqlite3.Connection, rows: Iterable[sqlite3.Row]) -> dict[str, list[dict]]:
    """The projects of each item read, by work item id, in one walk of the store.

    A task's are its own rows; a goal's or stage's are the rows of everything
    under it, each project once with its strongest source. The registry is read
    only when some item names a project, and a project it does not record now
    shows `display_name` null. An attached store an earlier build wrote is read
    as it is: it has no such table, and its items name no projects.
    """

    found = _walk(conn, [str(row["work_item_id"]) for row in rows])
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


# -- the project of a commit ---------------------------------------------------

#: How long one repository may take to answer for every hash at once.
_GIT_TIMEOUT = 120


def _held_commits(root: str, hashes: Sequence[str]) -> dict[str, str]:
    """The whole hash of each of `hashes` whose commit the repository at `root` holds.

    One `git cat-file --batch-check` for all of them; its answer has one line per
    question, in order. A root that is no repository of its own holds none: Git
    would answer from the repository around it, which is another project's. A
    branch or tag named like a hash resolves too, to a commit its digits do not
    start, and is not taken.
    """

    # A linked worktree's `.git` is a file, and it is a repository too.
    if not hashes or not os.path.exists(os.path.join(root, ".git")):
        return {}
    question = "".join(f"{value}^{{commit}}\n" for value in hashes).encode("ascii")
    try:
        answered = processes.run_text(
            ["git", "-C", root, "cat-file", "--batch-check"], timeout=_GIT_TIMEOUT, stdin=question
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"git cannot be asked in {root}: {error}") from error
    if answered.returncode != 0:
        raise RuntimeError(f"git cat-file failed in {root}: {answered.stderr.strip()}")
    held: dict[str, str] = {}
    for value, line in zip(hashes, answered.stdout.split("\n"), strict=False):
        fields = line.split()
        if len(fields) == 3 and fields[1] == "commit" and fields[0].startswith(value):
            held[value] = fields[0]
    return held


def _described_commits(root: str, whole: Sequence[str]) -> dict[str, tuple[str, str]]:
    """The subject and committer time of each commit `whole` names, by its whole hash.

    One `git log --no-walk` for all of them, read from its standard input: a command
    line would not hold thousands of hashes. The subject is shown to a person and is
    decoded leniently; the hash that decides the pair was read strictly.
    """

    if not whole:
        return {}
    try:
        logged = processes.run_text(
            [
                "git",
                "-C",
                root,
                "-c",
                "i18n.logOutputEncoding=UTF-8",
                "log",
                "--no-walk",
                "--stdin",
                "--format=%H%x00%cI%x00%s",
            ],
            timeout=_GIT_TIMEOUT,
            stdin="".join(f"{value}\n" for value in whole).encode("ascii"),
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"git cannot be asked in {root}: {error}") from error
    if logged.returncode != 0:
        raise RuntimeError(f"git log failed in {root}: {logged.stderr.strip()}")
    described: dict[str, tuple[str, str]] = {}
    for line in logged.stdout.split("\n"):
        fields = line.split("\x00")
        if len(fields) == 3:
            described[fields[0]] = (fields[2], fields[1])
    return described


# -- the commits a 2.9 commit ref names -------------------------------------------

#: A hex word: 7 to 64 hex digits that no letter, digit or underscore continues on
#: either side. Shorter than seven, a word such as `facade` would be read as one.
_HEX_WORD = re.compile(r"(?<!\w)[0-9a-fA-F]{7,64}(?!\w)")
#: A repository named just before a hex word: `name@`, `name:`, `name ` or
#: `owner/name@`. The hint is the last segment of the path.
_HINT = r"(?:[\w.-]+/)*(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:@|:| +)"
_HINT_BEFORE = re.compile(rf"(?<![\w./-]){_HINT}$")
#: A text that is one hash, with or without a repository before it.
_PLAIN = re.compile(rf"(?:{_HINT})?[0-9a-fA-F]{{7,64}}")
#: A word that names where work started rather than the work: the one right after
#: `base`, `from`, `onto` or `от`, which a bracket or a colon may stand around.
_BASE_BEFORE = re.compile(r"(?<!\w)(?:base|from|onto|от)\s*[(:]?\s*$", re.IGNORECASE)
#: The left end of a range `X..Y` or `X...Y`: where the range starts.
_RANGE_AFTER = re.compile(r"\.{2,3}(?=\w)")
#: An address, and an address of one commit: `…/<name>/commit/<hash>` or GitLab's
#: `…/<name>/-/commit/<hash>`.
_ADDRESS = re.compile(r"https?://\S+", re.IGNORECASE)
_COMMIT_ADDRESS = re.compile(
    r"https?://\S*?/(?P<name>[^/\s]+)(?:/-)?/commit/(?P<hash>[0-9a-fA-F]{7,64})(?:[/?#]\S*)?",
    re.IGNORECASE,
)


class CommitText(NamedTuple):
    """What the text of one commit ref says, before any repository is asked.

    `words` are the hashes it names, each with the repository named before it or
    None, in lower case and in the order written; `skipped` the hex words it names
    as a starting point, not as work; `url` whether it is an address that names no
    commit; `plain` whether it is one hash, with or without a repository before it.
    """

    words: tuple[tuple[str | None, str], ...]
    skipped: tuple[str, ...]
    url: bool
    plain: bool


def read_commit_text(value: str) -> CommitText:
    """The hashes the text of a commit ref names, read by the rule of its forms.

    An address of a commit reads as `<name>@<hash>`; any other address names no
    commit. Otherwise every hex word counts, with the repository a hint before it
    names, except the left end of a range and the word right after `base`, `from`,
    `onto` or `от`, which are skipped.
    """

    text = value.strip()
    address = _COMMIT_ADDRESS.fullmatch(text)
    if address is not None:
        return CommitText(
            ((address["name"].lower(), address["hash"].lower()),), (), url=False, plain=False
        )
    if _ADDRESS.fullmatch(text):
        return CommitText((), (), url=True, plain=False)
    words: list[tuple[str | None, str]] = []
    skipped: list[str] = []
    for found in _HEX_WORD.finditer(text):
        written, before = found[0].lower(), text[: found.start()]
        if _RANGE_AFTER.match(text, found.end()) or _BASE_BEFORE.search(before):
            skipped.append(written)
            continue
        hint = _HINT_BEFORE.search(before)
        words.append((hint["name"].lower() if hint else None, written))
    return CommitText(
        tuple(dict.fromkeys(words)),
        tuple(dict.fromkeys(skipped)),
        url=False,
        plain=_PLAIN.fullmatch(text) is not None,
    )


def commit_label(label: str, value: str) -> str:
    """The label a commit carried over from a ref takes: the ref's own, and its text
    after it when that text says more than which commit it is -- an address, a note."""

    text = value.strip()
    if read_commit_text(text).plain:
        return label
    return f"{label} — {text}" if label else text


class CommitPair(TypedDict):
    """One commit a ref names: its project, or None when no repository holds it,
    and its hash, whole when a repository holds it and as written otherwise."""

    project: str | None
    hash: str
    subject: str
    committed_at: str | None


class CommitRefPairs(TypedDict):
    """What one commit ref's text comes to: its pairs, the hex words it skipped, and
    whether it is an address that names no commit."""

    pairs: list[CommitPair]
    skipped: list[str]
    url: bool


def commit_pairs(
    values: Iterable[str], projects: Sequence[Mapping[str, Any]]
) -> dict[str, CommitRefPairs]:
    """The commits each commit ref text names, each with its registered project.

    For each hash `read_commit_text` finds: a hint that is a registered project's id
    gives that project, with the whole hash when its repository holds the commit and
    the hash as written when it does not; otherwise the one registered repository
    that holds the commit gives its project and the whole hash; otherwise the hash as
    written stands with no project. A commit a repository holds carries its subject
    and committer time. Every repository is asked once for every hash at once.
    """

    roots = {str(project["project_id"]): str(project["canonical_root"]) for project in projects}
    texts = {value: read_commit_text(value) for value in dict.fromkeys(values)}
    hinted: dict[str, set[str]] = {}
    searched: set[str] = set()
    for text in texts.values():
        for hint, written in text.words:
            if hint in roots:
                hinted.setdefault(hint, set()).add(written)
            else:
                searched.add(written)
    held = {
        project: _held_commits(root, sorted(hinted.get(project, set()) | searched))
        for project, root in sorted(roots.items())
    }

    def pair(hint: str | None, written: str) -> tuple[str | None, str]:
        if hint is not None and hint in roots:
            return hint, held[hint].get(written, written)
        owners = {(project, whole[written]) for project, whole in held.items() if written in whole}
        return next(iter(owners)) if len(owners) == 1 else (None, written)

    resolved = {
        value: list(dict.fromkeys(pair(hint, written) for hint, written in text.words))
        for value, text in texts.items()
    }
    holds = {project: set(whole.values()) for project, whole in held.items()}
    found: dict[str, set[str]] = {}
    for named in resolved.values():
        for project, whole in named:
            if project is not None and whole in holds[project]:
                found.setdefault(project, set()).add(whole)
    described = {
        project: _described_commits(roots[project], sorted(hashes))
        for project, hashes in sorted(found.items())
    }
    answer: dict[str, CommitRefPairs] = {}
    for value, text in texts.items():
        pairs: list[CommitPair] = []
        for project, whole in resolved[value]:
            subject, committed_at = described.get(project or "", {}).get(whole, ("", None))
            pairs.append(
                {
                    "project": project,
                    "hash": whole,
                    "subject": subject,
                    "committed_at": committed_at,
                }
            )
        answer[value] = {"pairs": pairs, "skipped": list(text.skipped), "url": text.url}
    return answer


def commit_projects(pairs: Iterable[Mapping[str, Any]]) -> list[str]:
    """The registered projects of `pairs`, sorted: those a task takes from its commits."""

    return sorted({str(pair["project"]) for pair in pairs if pair["project"] is not None})
