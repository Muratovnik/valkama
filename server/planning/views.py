"""The one read model every Planning view is built from.

It is deliberately flat. The Board era shipped a payload already grouped into
six lanes, so Kanban was the only view the data could express and a list or a
graph had to take the grouping apart again. Here the states, the items and the
links arrive separately and each view decides what to do with them — which is
what makes Kanban one view rather than the model.
"""

from __future__ import annotations

import sqlite3

from . import model, service, store

READ_MODEL_INTERFACE = f"{model.PLANNING_INTERFACE}-read-model"


def planning_payload(
    conn: sqlite3.Connection, *, space: str | None = None, limit: int = 1000
) -> dict:
    """One space's whole graph: its workflow, its items, and the edges between."""

    spaces = service.list_planning_spaces(conn)
    if not spaces:
        return {
            "interface_version": READ_MODEL_INTERFACE,
            "planning_spaces": [],
            "planning_space": None,
            "workflow": None,
            "work_items": [],
            "links": [],
            "stale_claims": [],
        }
    chosen = service.get_planning_space(conn, space or spaces[0]["planning_space_id"])
    space_id = str(chosen["planning_space_id"])
    items = service.list_work_items(conn, space=space_id, limit=limit)
    return {
        "interface_version": READ_MODEL_INTERFACE,
        "planning_spaces": spaces,
        "planning_space": {
            "planning_space_id": chosen["planning_space_id"],
            "project_id": chosen["project_id"],
            "name": chosen["name"],
            "key": chosen["key"],
            "provider_kind": chosen["provider_kind"],
        },
        "workflow": chosen["workflow"],
        "work_items": items,
        "links": _links(conn, space_id),
        "stale_claims": stale_claims(conn, space=space_id),
    }


#: A claim quiet for this many days is treated as abandoned. Cheap protection
#: against a claim that outlived the session holding it: the space says somebody
#: is on the work, and nobody is.
STALE_CLAIM_DAYS = 3


def stale_claims(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    days: int = STALE_CLAIM_DAYS,
) -> list[dict]:
    """Held items nothing has touched, so their ownership is abandoned.

    A claim only goes stale while somebody is supposed to be working: the
    categories are asked of the workflow rather than named, so a space that
    calls its states something else is still covered.
    """

    clauses = [
        "w.claim_ref != ''",
        "s.category IN ('active','review')",
    ]
    parameters: list[object] = []
    if space is not None:
        clauses.append("w.planning_space_id = ?")
        parameters.append(str(service.get_planning_space(conn, space)["planning_space_id"]))
    query = service.with_clauses(
        "SELECT p.key || '-' || w.number AS reference, w.title, w.claim_ref, s.key AS state,"
        " COALESCE(MAX(e.created_at), w.updated_at) AS last_event,"
        " CAST(julianday('now') - julianday(COALESCE(MAX(e.created_at), w.updated_at))"
        "  AS INTEGER) AS quiet_days"
        " FROM work_items w"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " JOIN workflow_states s ON s.state_id = w.state_id"
        " LEFT JOIN work_item_events e ON e.work_item_id = w.work_item_id",
        clauses,
    )
    query += " GROUP BY w.work_item_id HAVING quiet_days >= ?"
    query += " ORDER BY quiet_days DESC, w.number"
    rows = conn.execute(query, (*parameters, int(days))).fetchall()
    return [dict(item) for item in rows]


def activity_feed(conn: sqlite3.Connection, limit: int = 100) -> list[dict]:
    """The newest events across every space, as one stream."""

    bounded = max(1, min(int(limit), 500))
    rows = conn.execute(
        # The category comes from the state the detail names, so a reader can
        # act on "this reached review" without knowing what that space calls it.
        "SELECT e.*, i.number, i.title, p.key, s.category FROM work_item_events e"
        " JOIN work_items i ON i.work_item_id = e.work_item_id"
        " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
        " LEFT JOIN workflow_states s"
        "  ON s.workflow_id = i.workflow_id"
        "  AND s.key = CASE WHEN instr(e.detail, ':') > 0"
        "   THEN substr(e.detail, 1, instr(e.detail, ':') - 1) ELSE e.detail END"
        " ORDER BY e.id DESC LIMIT ?",
        (bounded,),
    ).fetchall()
    return [
        {
            # The event's own row id, which is what lets a reader say "newer
            # than what I already showed" without comparing timestamps that
            # several events share to the second.
            "event_id": int(row["id"]),
            "work_item_id": row["work_item_id"],
            "reference": model.human_id(str(row["key"]), int(row["number"])),
            "title": row["title"],
            "action": row["action"],
            "detail": row["detail"],
            "state_category": row["category"],
            "author": row["author"],
            "at": row["created_at"],
        }
        for row in rows
    ]


#: The shape a state's category gets in a Mermaid node, so a reader sees a
#: finished item and a blocked one without reading the label.
MERMAID_SHAPES = {"completed": ("([", "])"), "blocked": ("{{", "}}")}


def graph_payload(conn: sqlite3.Connection, *, space: str | None = None) -> dict:
    """The space as a dependency graph: parents, blockers, provenance, frontier.

    Depth is the longest chain of unfinished blockers behind an item, which is
    what makes the ready frontier obvious: depth zero, startable, unheld and not
    a container is workable now. Everything here is computed from the store
    rather than from a lane name, so a space that renames its states keeps its
    frontier.
    """

    payload = planning_payload(conn, space=space)
    if payload["planning_space"] is None:
        return {
            "interface_version": READ_MODEL_INTERFACE,
            "planning_space": None,
            "nodes": [],
            "edges": [],
        }
    items = {str(item["work_item_id"]): item for item in payload["work_items"]}
    edges = list(payload["links"])
    blockers: dict[str, list[str]] = {identity: [] for identity in items}
    for edge in payload["links"]:
        if edge["kind"] == "blocks" and edge["to"] in blockers:
            blockers[edge["to"]].append(edge["from"])
    edges.extend(
        {"from": str(item["parent_id"]), "to": identity, "kind": "parent"}
        for identity, item in items.items()
        if item["parent_id"] is not None and str(item["parent_id"]) in items
    )
    depth: dict[str, int] = {}

    def resolve(identity: str, seen: frozenset[str]) -> int:
        if identity in depth:
            return depth[identity]
        if identity in seen:
            return 0  # a blocks-cycle is visible in the graph; do not hang here
        open_blockers = [
            blocker
            for blocker in blockers.get(identity, [])
            if not (items.get(blocker) or {}).get("state", {}).get("is_terminal")
        ]
        value = (
            0
            if not open_blockers
            else 1 + max(resolve(blocker, seen | {identity}) for blocker in open_blockers)
        )
        depth[identity] = value
        return value

    nodes = []
    for identity, item in items.items():
        level = resolve(identity, frozenset())
        nodes.append(
            {
                "work_item_id": identity,
                "reference": item["reference"],
                "title": item["title"],
                "kind": item["kind"],
                "state": item["state"],
                "priority": item["priority"],
                "claim_ref": item["claim_ref"],
                "parent_id": item["parent_id"],
                # Both come from the item's own record: readiness is one
                # question with one answer, and the depth below is the only
                # thing this projection adds to it.
                "container": item["container"],
                "depth": level,
                "ready": item["ready"] and level == 0,
            }
        )
    return {
        "interface_version": READ_MODEL_INTERFACE,
        "planning_space": payload["planning_space"],
        "nodes": nodes,
        "edges": edges,
    }


def graph_mermaid(payload: dict) -> str:
    """The same graph as a Mermaid flowchart, for a document or a review."""

    lines = ["flowchart LR"]
    for node in payload["nodes"]:
        opening, closing = MERMAID_SHAPES.get(node["state"]["category"], ("[", "]"))
        title = str(node["title"]).replace('"', "'")[:60]
        lines.append(
            f'  {_mermaid_id(node["reference"])}{opening}"{node["reference"]} {title}"{closing}'
        )
    names = {str(node["work_item_id"]): str(node["reference"]) for node in payload["nodes"]}
    arrows = {"blocks": "-->", "parent": "-.->", "discovered-from": "==>", "relates-to": "---"}
    for edge in payload["edges"]:
        arrow = arrows.get(edge["kind"])
        if arrow is None or edge["from"] not in names or edge["to"] not in names:
            continue  # an edge to another space has no node here to point at
        lines.append(
            f"  {_mermaid_id(names[edge['from']])} {arrow} {_mermaid_id(names[edge['to']])}"
        )
    frontier = [node["reference"] for node in payload["nodes"] if node["ready"]]
    lines.extend(f"  class {_mermaid_id(reference)} ready" for reference in frontier)
    if frontier:
        lines.append("  classDef ready stroke-width:3px")
    return "\n".join(lines)


def _mermaid_id(reference: str) -> str:
    """A Mermaid node id: a reference with its separator removed."""

    return str(reference).replace("-", "_")


def _links(conn: sqlite3.Connection, planning_space_id: str) -> list[dict]:
    return [
        {"from": str(row["from_id"]), "to": str(row["to_id"]), "kind": str(row["kind"])}
        for row in conn.execute(
            "SELECT l.from_id, l.to_id, l.kind FROM work_item_links l"
            " JOIN work_items f ON f.work_item_id = l.from_id"
            " WHERE f.planning_space_id = ? ORDER BY l.id",
            (planning_space_id,),
        )
    ]


def space_for_project(conn: sqlite3.Connection, project_id: str) -> dict | None:
    """The space a project is bound to, or nothing when it has none yet."""

    row = conn.execute(
        "SELECT * FROM planning_spaces WHERE project_id = ? ORDER BY name LIMIT 1",
        (model.text_field(project_id, "project_id", limit=160),),
    ).fetchone()
    if row is None:
        return None
    return service.get_planning_space(conn, str(row["planning_space_id"]))


def ensure_space_for_project(
    conn: sqlite3.Connection, project_id: str, *, name: str | None = None
) -> dict:
    """The project's space, created on first use rather than by a setup step."""

    existing = space_for_project(conn, project_id)
    if existing is not None:
        return existing
    store.create_space(conn, project_id=project_id, name=name or project_id)
    answer = space_for_project(conn, project_id)
    if answer is None:  # pragma: no cover - the insert above either raises or lands
        raise model.PlanningError("planning space creation did not persist")
    return answer
