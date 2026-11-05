"""Where work is going on now, across every space of the primary store, in one frame.

The interface's side panel draws it and the picker of mentions offers its rows
first, so it is one small read rather than a space's read model each. It reads
every open item and every pinned one in one query, with every ancestor of them,
and asks `live_work.placed` for the state a graph moves by. It carries no history
and no time that moves, so a store in which nothing changed gives the same frame,
and an unchanged frame is what lets a stream send nothing. Attached stores are not
read: the frame is the primary store's, whichever space a stream follows.

| Row | When |
|---|---|
| an open item | its state is `working`, `held`, `waiting` or `quiet` |
| a pinned item | always, open or closed, whatever its state |
| a parent | of any row, so that `parent` always names a row of the same space |

A space's rows come in the order they are drawn: a row that is another row's
parent is a group, and the groups come first in the order of work, each followed
by its own rows; then the rows with neither a parent nor rows of their own. Rows
that are not groups stand by number, so a change of state does not move one.

`unplaced` and `elsewhere` count the agents at work on no row: a session at work
none of whose work is a row counts once, and each of its live subagents once more.
Its space is the one bound to the project whose root is the longest that contains
the session's `opened_folder`, or else its `cwd`; with no such root, or a project
that binds no space of this store, it counts in `elsewhere`. That labels a counter
and nothing more: nothing is written or routed from it, and no binding is ever
inferred from a folder, so `project_registry.session_space_context` stays the only
answer to where a session's space lives.
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from ..projects import project_registry
from ..store_identity.metadata import read_store_metadata
from ..store_identity.primitives import ContractError
from ..store_identity.refs import planning_space_ref
from . import live_work, read_model

#: Every open item and every pinned one, with all their ancestors, in one read. Only a
#: checklist a session's holder could stand in is parsed; the rest reads as no steps.
#: The open items are found through `work_items_state` from the open states, which the
#: CROSS JOIN holds the planner to: a scan of every item ever filed cost twice as much.
_ITEMS = (
    "WITH RECURSIVE shown(id) AS ("
    " SELECT w.work_item_id FROM workflow_states s"
    " CROSS JOIN workflows f ON f.workflow_id = s.workflow_id"
    " CROSS JOIN work_items w"
    " ON w.planning_space_id = f.planning_space_id AND w.state_id = s.state_id"
    " WHERE s.is_terminal = 0"
    " UNION SELECT work_item_id FROM pinned_work_items),"
    " lineage(id) AS (SELECT id FROM shown"
    " UNION SELECT w.parent_id FROM lineage l JOIN work_items w ON w.work_item_id = l.id"
    " WHERE w.parent_id IS NOT NULL)"
    " SELECT w.work_item_id, w.number, w.title, w.kind, w.parent_id, w.position,"
    " CASE WHEN w.checklist LIKE '%(session %' THEN w.checklist ELSE '[]' END AS checklist,"
    " p.key, s.name AS state_name, s.is_terminal, s.position AS state_position,"
    " EXISTS (SELECT 1 FROM pinned_work_items n WHERE n.work_item_id = w.work_item_id)"
    " AS pinned"
    " FROM lineage l JOIN work_items w ON w.work_item_id = l.id"
    " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " JOIN workflow_states s ON s.state_id = w.state_id"
)

#: Where the sessions that count in `unplaced` were opened.
_FOLDERS = (
    "SELECT id, opened_folder, cwd FROM sessions WHERE id IN (SELECT value FROM json_each(?))"
)


@dataclass(frozen=True)
class _Item:
    identity: str
    key: str
    reference: str
    title: str
    kind: str
    parent: str | None
    pinned: bool
    state_name: str
    is_terminal: bool
    #: The order of work: the state's place in its workflow, then the item's in its state.
    order: tuple[float, float, int]
    number: int


def _item(row: sqlite3.Row) -> _Item:
    key, number = str(row["key"]), int(row["number"])
    return _Item(
        identity=str(row["work_item_id"]),
        key=key,
        reference=f"{key}-{number}",
        title=str(row["title"]),
        kind=str(row["kind"]),
        parent=None if row["parent_id"] is None else str(row["parent_id"]),
        pinned=bool(row["pinned"]),
        state_name=str(row["state_name"]),
        is_terminal=bool(row["is_terminal"]),
        order=(float(row["state_position"]), float(row["position"]), number),
        number=number,
    )


def _steps(checklist: str) -> list[dict]:
    """The steps `live_work` reads, as a list read presents them: done, and who holds it."""

    if checklist == "[]":
        return []
    return [
        {"done": bool(step.get("done")), "claimed_by": str(step.get("claimed_by") or "")}
        for step in json.loads(checklist)
    ]


def _ordered(rows: list[_Item]) -> list[_Item]:
    """A space's rows as they are drawn: groups by the order of work, each with its own."""

    children: dict[str | None, list[_Item]] = {}
    for row in rows:
        children.setdefault(row.parent, []).append(row)

    def under(parent: str | None) -> list[_Item]:
        found = children.get(parent, [])
        drawn: list[_Item] = []
        for group in sorted((row for row in found if row.identity in children), key=_work):
            drawn.append(group)
            drawn.extend(under(group.identity))
        drawn.extend(sorted((row for row in found if row.identity not in children), key=_number))
        return drawn

    return under(None)


def _work(row: _Item) -> tuple[float, float, int]:
    return row.order


def _number(row: _Item) -> int:
    return row.number


@dataclass(frozen=True)
class _Roots:
    """The registered project roots, each with the space of this store it binds, if any."""

    #: Normalized root, project, bound space key or None; longest root first.
    roots: list[tuple[str, str, str | None]]
    #: The project that binds each space of this store.
    bound: dict[str, str]


def _normalized(path: str) -> str:
    return os.path.normcase(os.path.normpath(path))


def _roots(conn: sqlite3.Connection) -> _Roots:
    """What the registry says of this store's spaces; an unreadable registry says nothing."""

    data_scope_id = read_store_metadata(conn)["data_scope_id"]
    roots: list[tuple[str, str, str | None]] = []
    bound: dict[str, str] = {}
    for project in project_registry.read_registry()["projects"]:
        key: str | None = None
        binding = project["planning_binding"]
        if binding is not None:
            try:
                space = planning_space_ref(binding)
            except ContractError:
                space = None
            if space is not None and space["data_scope_id"] == data_scope_id:
                key = str(space["space_key"])
                bound[key] = str(project["project_id"])
        roots.append((_normalized(str(project["canonical_root"])), str(project["project_id"]), key))
    roots.sort(key=lambda root: len(root[0]), reverse=True)
    return _Roots(roots, bound)


def _space_of(folder: str, roots: _Roots) -> str | None:
    """The space a folder's longest containing root binds, as a caption; None for none."""

    if not folder:
        return None
    place = _normalized(folder)
    for root, _project, key in roots.roots:
        if place == root or place.startswith(root.rstrip(os.sep) + os.sep):
            return key
    return None


def _unplaced(
    conn: sqlite3.Connection,
    at_work: Mapping[str, live_work.AtWork],
    rows: set[str],
    roots: _Roots,
) -> tuple[dict[str, int], int]:
    """How many agents are at work on no row, by space key, and how many under no space."""

    counted = {
        session: work.subagents + 1 for session, work in at_work.items() if not work.items & rows
    }
    by_space: dict[str, int] = {}
    elsewhere = 0
    if not counted:
        return by_space, elsewhere
    for row in conn.execute(_FOLDERS, (json.dumps(sorted(counted)),)):
        key = _space_of(str(row["opened_folder"] or row["cwd"] or ""), roots)
        if key is None:
            elsewhere += counted[str(row["id"])]
        else:
            by_space[key] = by_space.get(key, 0) + counted[str(row["id"])]
    return by_space, elsewhere


def _row(item: _Item, live: Mapping[str, dict], agents: Mapping[str, int], parents: dict) -> dict:
    state = live.get(item.identity)
    return {
        "reference": item.reference,
        "title": item.title,
        "kind": item.kind,
        "parent": None if item.parent is None else parents[item.parent],
        "state": None if state is None else state["state"],
        "agents": agents.get(item.identity, 0),
        "quiet_since": None if state is None else state.get("quiet_since"),
        "pinned": item.pinned,
        "state_name": item.state_name,
        "is_terminal": item.is_terminal,
    }


def _shown(items: Iterable[_Item], live: Mapping[str, dict]) -> set[str]:
    """The rows: open items with live work and pinned ones, then every parent of them."""

    by_id = {item.identity: item for item in items}
    shown: set[str] = set()
    for item in by_id.values():
        if (live.get(item.identity) is not None and not item.is_terminal) or item.pinned:
            parent: str | None = item.identity
            while parent is not None and parent not in shown:
                shown.add(parent)
                parent = by_id[parent].parent
    return shown


@read_model.whole_store_read()
def frame(conn: sqlite3.Connection) -> dict:
    """The live-work frame of the primary store `conn` opens; see the module's rule."""

    rows = conn.execute(_ITEMS).fetchall()
    items = [_item(row) for row in rows]
    records = []
    # Who holds an open step, as `ladder.held_steps` reads it: this read has them all.
    held: dict[str, str] = {}
    for item, row in zip(items, rows, strict=True):
        steps = _steps(str(row["checklist"]))
        records.append(
            {"work_item_id": item.identity, "reference": item.reference, "checklist": steps}
        )
        for step in steps if not item.is_terminal else ():
            if step["claimed_by"] and not step["done"]:
                held[step["claimed_by"]] = item.identity
    placement = live_work.placed(conn, records, held_steps=held)
    shown = _shown(items, placement.live)
    roots = _roots(conn)
    unplaced, elsewhere = _unplaced(conn, placement.at_work, shown, roots)
    references = {item.identity: item.reference for item in items}
    by_space: dict[str, list[_Item]] = {}
    for item in items:
        if item.identity in shown:
            by_space.setdefault(item.key, []).append(item)
    names = {
        str(row["key"]): str(row["name"])
        for row in conn.execute("SELECT key, name FROM planning_spaces")
    }
    spaces = []
    for key in sorted(set(by_space) | {key for key in unplaced if key in names}):
        spaces.append(
            {
                "key": key,
                "name": names[key],
                "project_id": roots.bound.get(key),
                "unplaced": unplaced.get(key, 0),
                "rows": [
                    _row(item, placement.live, placement.agents, references)
                    for item in _ordered(by_space.get(key, []))
                ],
            }
        )
    # A session under a project bound to a space this store does not hold is under no
    # space here.
    elsewhere += sum(count for key, count in unplaced.items() if key not in names)
    return {"spaces": spaces, "elsewhere": elsewhere}
