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

Which project a commit belongs to is `commit_projects`: the one answer to it, asked
of Git in the registered roots.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from .. import processes
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


#: A list's clause on `work_items i`: the item names the project bound to it. A goal or
#: stage names none, so it is not kept for the projects of the tasks under it.
NAMES_PROJECT = (
    "i.work_item_id IN (SELECT work_item_id FROM work_item_projects WHERE project_id = ?)"
)


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


# -- the project of a commit ---------------------------------------------------

# A recorded commit value may name its repository before the revision, as
# `repo@abc1234` or `repo abc1234`: a name that starts with a letter or digit,
# then `@` or spaces, then one word that is not git's own `@{...}` syntax.
# Anything else is the revision as written. The web's `sameCommit` reads a
# value by this same rule, and both test suites hold the same examples.
_NAMED_COMMIT = re.compile(r"(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:@(?!\{)| +)(?P<rev>\S+)")
#: A revision that is a commit hash, full or abbreviated, and nothing else. Shorter
#: than seven, a hex word such as `facade` would be asked about as one.
_COMMIT_HASH = re.compile(r"[0-9a-fA-F]{7,64}")
#: How long one repository may take to answer for every hash at once.
_GIT_TIMEOUT = 120


def split_commit_value(value: str) -> tuple[str | None, str]:
    """The repository name a commit value carries, if any, and its revision."""

    named = _NAMED_COMMIT.fullmatch(value)
    if named is None:
        return None, value
    return named["name"], named["rev"]


def _held_commits(root: str, hashes: Sequence[str]) -> set[str]:
    """The hashes whose commit the repository at `root` holds.

    One `git cat-file --batch-check` for all of them; its answer has one line per
    question, in order. A root that is no repository of its own holds none: Git
    would answer from the repository around it, which is another project's.
    """

    # A linked worktree's `.git` is a file, and it is a repository too.
    if not os.path.exists(os.path.join(root, ".git")):
        return set()
    question = "".join(f"{value}^{{commit}}\n" for value in hashes).encode("ascii")
    try:
        answered = processes.run_text(
            ["git", "-C", root, "cat-file", "--batch-check"], timeout=_GIT_TIMEOUT, stdin=question
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"git cannot be asked in {root}: {error}") from error
    if answered.returncode != 0:
        raise RuntimeError(f"git cat-file failed in {root}: {answered.stderr.strip()}")
    held: set[str] = set()
    for value, line in zip(hashes, answered.stdout.split("\n"), strict=False):
        fields = line.split()
        if len(fields) == 3 and fields[1] == "commit":
            held.add(value)
    return held


def commit_projects(values: Iterable[str], projects: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    """The registered project each commit value belongs to, by value.

    A value that names a registered project's id before its revision
    (`valkama@1a2b3c4`, `valkama 1a2b3c4`) belongs to that project. A bare hash
    belongs to the one registered project whose repository holds that commit. A
    value that resolves to no project or to more than one -- a name nobody
    registered, a hash two repositories hold, a range, a url -- is left out.
    """

    roots = {str(project["project_id"]): str(project["canonical_root"]) for project in projects}
    found: dict[str, str] = {}
    bare: dict[str, list[str]] = {}
    for value in values:
        name, revision = split_commit_value(value.strip())
        if name is not None:
            if name.lower() in roots:
                found[value] = name.lower()
        elif _COMMIT_HASH.fullmatch(revision):
            bare.setdefault(revision.lower(), []).append(value)
    if not bare:
        return found
    asked = sorted(bare)
    holders: dict[str, set[str]] = {}
    for project, root in sorted(roots.items()):
        for commit in _held_commits(root, asked):
            holders.setdefault(commit, set()).add(project)
    for commit, written in bare.items():
        owners = holders.get(commit, set())
        if len(owners) == 1:
            for value in written:
                found[value] = next(iter(owners))
    return found
