"""The one read model every Planning view is built from.

It is deliberately flat. The Board era shipped a payload already grouped into
six lanes, so Kanban was the only view the data could express and a list or a
graph had to take the grouping apart again. Here the states, the items and the
links arrive separately and each view decides what to do with them — which is
what makes Kanban one view rather than the model.
"""

from __future__ import annotations

import json
import sqlite3

from ..projects import project_registry
from ..store_identity.metadata import read_store_metadata
from . import (
    item_projects,
    item_tree,
    leases,
    live_work,
    model,
    read_model,
    service,
    states,
)

READ_MODEL_INTERFACE = f"{model.PLANNING_INTERFACE}-read-model"


@read_model.whole_store_read()
def planning_payload(
    conn: sqlite3.Connection, *, space: str | None = None, project: str | None = None
) -> dict:
    """One space's whole graph: its workflow, its items, and the edges between.

    A space's read holds its items and the items of other spaces that name one of
    its projects, each marked `other_space` (`service.list_work_items`), and every
    link with an end among them. The end of such a link the read does not hold is
    in `other_space_ends`. `project` narrows the read to the items naming it, and
    other spaces bring theirs only when it is one of the space's projects.
    """

    spaces = service.list_planning_spaces(conn)
    if not spaces:
        return {
            "interface_version": READ_MODEL_INTERFACE,
            "planning_spaces": [],
            "planning_space": None,
            "workflow": None,
            "work_items": [],
            "links": [],
            "other_space_ends": [],
            "stale_claims": [],
            "live_work": {},
        }
    chosen = service.get_planning_space(conn, space or spaces[0]["planning_space_id"])
    space_id = str(chosen["planning_space_id"])
    items = service.list_work_items(
        conn, space=space_id, project=project, other_spaces=True, limit=None
    )
    links, ends = _links(conn, items)
    workflow = chosen.pop("workflow")
    # The store this read is of names the spaces its projects are bound to.
    listing = project_registry.read_registry()
    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    spaces = item_projects.with_projects(spaces, listing, data_scope_id)
    (shown,) = item_projects.with_projects([chosen], listing, data_scope_id)
    return {
        "interface_version": READ_MODEL_INTERFACE,
        "planning_spaces": spaces,
        "planning_space": shown,
        "workflow": workflow,
        "work_items": items,
        "links": links,
        "other_space_ends": ends,
        "stale_claims": stale_claims(conn, space=space_id),
        # Which items an agent is at work on now: by `live_work`'s rule, and
        # only for the items that have some.
        "live_work": live_work.live_work(conn, items),
    }


def stale_claims(conn: sqlite3.Connection, *, space: str | None = None) -> list[dict]:
    """Held items whose holder is no longer there, so their ownership is abandoned.

    Abandoned by the lease's own rule (`leases.abandoned`): a lease a confirmed
    session holds when it reads `stale`, in its grace or not, however recently
    somebody else touched the item, and never while it is `live`; a claim no
    session proved when its item has had no event for `leases.QUIET_PERIOD`,
    the owner's own claim from the browser and a launch's for its runner alike.
    Such a claim stays here only until the next sweep releases it.

    A claim only stands where somebody is supposed to be working: at work or
    blocked at it. The categories are asked of the workflow rather than named, so
    a space that calls its states something else is still covered.
    """

    clauses = [
        "w.claim_ref != ''",
        "s.category IN (SELECT value FROM json_each(?))",
    ]
    parameters: list[object] = [json.dumps(model.HELD_CATEGORIES)]
    if space is not None:
        clauses.append("w.planning_space_id = ?")
        parameters.append(read_model.space_identity(conn, space))
    query = service.with_clauses(
        "SELECT w.*, p.key || '-' || w.number AS reference, s.key, s.name, s.category,"
        " s.is_terminal,"
        " COALESCE(MAX(e.created_at), w.updated_at) AS last_event,"
        " CAST(julianday('now') - julianday(COALESCE(MAX(e.created_at), w.updated_at))"
        "  AS INTEGER) AS quiet_days"
        " FROM work_items w"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " JOIN workflow_states s ON s.state_id = w.state_id"
        " LEFT JOIN work_item_events e ON e.work_item_id = w.work_item_id",
        clauses,
    )
    query += " GROUP BY w.work_item_id ORDER BY quiet_days DESC, w.number"
    abandoned = []
    for row in conn.execute(query, parameters).fetchall():
        lease = leases.lease(conn, row)
        if lease is None or not leases.abandoned(lease):
            continue
        abandoned.append(
            {
                "reference": row["reference"],
                "title": row["title"],
                "claim_ref": row["claim_ref"],
                "claim_state": lease.state,
                "state": (states.public_state(row) or {}).get("key"),
                "last_event": row["last_event"],
                "quiet_days": int(row["quiet_days"]),
            }
        )
    return abandoned


def activity_feed(conn: sqlite3.Connection, limit: int = 100) -> list[dict]:
    """The newest events across every space, as one stream."""

    bounded = max(1, min(int(limit), 500))
    rows = conn.execute(
        # The category comes from the state the detail names, so a reader can
        # act on "this reached review" without knowing what that space calls it.
        # Only `created` and `transitioned` name a state there: any other detail,
        # an `opened` reason or a step's text among them, may read like a key.
        "SELECT e.*, i.number, i.title, p.key, s.category FROM work_item_events e"
        " JOIN work_items i ON i.work_item_id = e.work_item_id"
        " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
        " LEFT JOIN workflow_states s"
        "  ON e.action IN ('created', 'transitioned')"
        "  AND s.workflow_id = i.workflow_id"
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
#: finished item and a blocked one without reading the label; an accepted open
#: goal or stage takes the shape of what it derives.
MERMAID_SHAPES = {
    "completed": ("([", "])"),
    "blocked": ("{{", "}}"),
    "not_started": ("[[", "]]"),
    "in_progress": ("[/", "/]"),
    "awaiting_confirmation": ("[(", ")]"),
}


def graph_payload(
    conn: sqlite3.Connection, *, space: str | None = None, project: str | None = None
) -> dict:
    """The space as a dependency graph: parents, blockers, provenance, frontier.

    Depth is the longest chain of unfinished blockers behind an item, which is
    what makes the ready frontier obvious: depth zero, startable, unheld and not
    a container is workable now. Everything here is computed from the store
    rather than from a lane name, so a space that renames its states keeps its
    frontier. Its nodes are the items of the space's read (`planning_payload`),
    other spaces' marked `other_space`, and `other_space_ends` the ends of its
    edges it holds no node for.
    """

    payload = planning_payload(conn, space=space, project=project)
    if payload["planning_space"] is None:
        return {
            "interface_version": READ_MODEL_INTERFACE,
            "planning_space": None,
            "nodes": [],
            "edges": [],
            "other_space_ends": [],
        }
    items = {str(item["work_item_id"]): item for item in payload["work_items"]}
    edges = list(payload["links"])
    # A block holds while its source is open, and the link names the source's
    # state whichever space it lives in: a finished blocker in another space
    # must not make an item wait, nor an open one go unseen.
    blockers: dict[str, list[str]] = {identity: [] for identity in items}
    for edge in payload["links"]:
        if edge["kind"] == "blocks" and edge["to"] in blockers and edge["is_terminal"] is False:
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
        open_blockers = blockers.get(identity, [])
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
                "open": item["open"],
                "container_state": item["container_state"],
                "priority": item["priority"],
                "claim_ref": item["claim_ref"],
                # A close ends the claim; these say when, and who held it then.
                "closed_at": item["closed_at"],
                "last_claim_ref": item["last_claim_ref"],
                "parent_id": item["parent_id"],
                # It comes from the item's own record: readiness is one
                # question with one answer, and the depth below is the only
                # thing this projection adds to it.
                "depth": level,
                "workable": item["workable"] and level == 0,
                "other_space": item["other_space"],
            }
        )
    return {
        "interface_version": READ_MODEL_INTERFACE,
        "planning_space": payload["planning_space"],
        "nodes": nodes,
        "edges": edges,
        "other_space_ends": payload["other_space_ends"],
    }


def graph_mermaid(payload: dict) -> str:
    """The same graph as a Mermaid flowchart, for a document or a review."""

    lines = ["flowchart LR"]
    for node in payload["nodes"]:
        shape = node["state"]["category"] if node["state"] is not None else node["container_state"]
        opening, closing = MERMAID_SHAPES.get(shape, ("[", "]"))
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
    frontier = [node["reference"] for node in payload["nodes"] if node["workable"]]
    lines.extend(f"  class {_mermaid_id(reference)} ready" for reference in frontier)
    if frontier:
        lines.append("  classDef ready stroke-width:3px")
    return "\n".join(lines)


def _mermaid_id(reference: str) -> str:
    """A Mermaid node id: a reference with its separator removed."""

    return str(reference).replace("-", "_")


def _links(conn: sqlite3.Connection, items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Every link with an end among the items read, each naming its source, and the
    ends of those links the read does not hold.

    Both directions and every kind: a space's read draws its links with other
    spaces. The source is the end a reader asks about: a block holds while its
    source is open, and that source may lie outside the read, so its reference and
    state come with the link. Only links leaving the space used to be read, so a
    blocker in another space was missing from every view: an item was not workable
    and nothing said why, and a finished foreign blocker could not be told from an
    open one. The source's state comes the way every link names an end
    (`read_model.end_state`): null, with the reason beside it, when the store
    cannot resolve it — which never means the source is open. A chain's edges name
    their source the same way.
    """

    held = [str(item["work_item_id"]) for item in items]
    rows = conn.execute(
        "WITH held(work_item_id) AS (SELECT value FROM json_each(?))"
        " SELECT l.from_id, l.to_id, l.kind, f.number, p.key AS space_key,"
        " s.name AS state_name, s.category AS state_category, s.is_terminal"
        " FROM work_item_links l"
        " JOIN work_items f ON f.work_item_id = l.from_id"
        " JOIN planning_spaces p ON p.planning_space_id = f.planning_space_id"
        " LEFT JOIN workflow_states s ON s.state_id = f.state_id"
        " WHERE l.from_id IN (SELECT work_item_id FROM held)"
        "  OR l.to_id IN (SELECT work_item_id FROM held) ORDER BY l.id",
        (json.dumps(held),),
    ).fetchall()
    ends = item_tree.below(conn, read_model.service_ends(rows, "from_id"))
    edges = [
        {
            "from": str(row["from_id"]),
            "to": str(row["to_id"]),
            "kind": str(row["kind"]),
            "reference": model.human_id(str(row["space_key"]), int(row["number"])),
            **read_model.end_state(row, ends.container_state(str(row["from_id"]))),
        }
        for row in rows
    ]
    outside = {str(row[end]) for row in rows for end in ("from_id", "to_id")} - set(held)
    return edges, read_model.other_space_ends(conn, outside)
