"""One chain of work: what an item's work grew into, and whether it converges.

An epic's children say what was planned. They do not say what the work turned
into: an item found while doing a child is linked `discovered-from` it, and
often lands under another epic or under none, so the epic can close with every
child done while the work it started is still growing elsewhere. A chain follows
that growth.

For a root R, scope `epic` is R's children. Scope `chain` starts there and keeps
adding, until nothing new is found, every item discovered from R or from a
member and every child of a member. The walk goes downward only: it never adds
a member's parent and never follows `discovered-from` upstream. `relates-to`
and `duplicates` never extend it, because they join otherwise unrelated work —
followed, they merge most of a space into one chain — and `blocks` says what
must finish first, not where the work came from. R itself is never a member, and
members stay in R's planning space.

Everything is read in one query per table and computed here, so a space of a
thousand items answers in one pass rather than one read per member; only a held
member costs one more, to read its lease. Readiness is the read model's own
rule, asked through `read_model.workable` with facts loaded in bulk.
"""

from __future__ import annotations

import operator
import sqlite3
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from functools import partial

from . import leases, model, read_model

#: The scopes a chain is read in.
SCOPES = ("chain", "epic")
#: How many UTC days, today included, the `recent` window covers.
RECENT_DAYS = 7
#: The link kinds a chain answers as edges. `discovered-from` is also what
#: extends the boundary; `blocks` only describes it.
EDGE_KINDS = ("blocks", "discovered-from")


def utc_now() -> datetime:
    """The clock `recent` is read against. Tests replace it through this module."""

    return datetime.now(UTC)


def chain(conn: sqlite3.Connection, reference: object, scope: str = "chain") -> dict:
    """The chain rooted at the named item, in the named scope."""

    if scope not in SCOPES:
        raise model.PlanningError("scope must be chain or epic")
    root = read_model.item_row(conn, reference)
    root_id = str(root["work_item_id"])
    space_id = str(root["planning_space_id"])
    key = str(
        conn.execute(
            "SELECT key FROM planning_spaces WHERE planning_space_id = ?", (space_id,)
        ).fetchone()[0]
    )
    rows = {
        str(row["work_item_id"]): row
        for row in conn.execute(
            "SELECT i.*, s.key AS state_key, s.name AS state_name,"
            " s.category AS state_category, s.is_terminal AS state_terminal"
            " FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
            " WHERE i.planning_space_id = ? ORDER BY i.number",
            (space_id,),
        )
    }
    links = conn.execute(
        "SELECT l.from_id, l.to_id, l.kind, fs.is_terminal AS from_terminal"
        " FROM work_item_links l"
        " JOIN work_items f ON f.work_item_id = l.from_id"
        " JOIN workflow_states fs ON fs.state_id = f.state_id"
        " JOIN work_items t ON t.work_item_id = l.to_id"
        " WHERE f.planning_space_id = ? OR t.planning_space_id = ? ORDER BY l.id",
        (space_id, space_id),
    ).fetchall()
    closed_by_event: dict[str, str] = {}
    for event in conn.execute(
        "SELECT e.work_item_id, e.created_at FROM work_item_events e"
        " JOIN work_items i ON i.work_item_id = e.work_item_id"
        " WHERE i.planning_space_id = ? AND e.action = 'transitioned' ORDER BY e.id",
        (space_id,),
    ):
        # Ordered by id, so the last one written wins even when two share a second.
        closed_by_event[str(event["work_item_id"])] = str(event["created_at"])

    children: dict[str, list[str]] = {}
    for identity, row in rows.items():
        if row["parent_id"] is not None:
            children.setdefault(str(row["parent_id"]), []).append(identity)
    members = _members(root_id, scope, rows, children, links)

    # What an unfinished item blocks, wherever the blocker lives.
    blocked = {
        str(link["to_id"])
        for link in links
        if link["kind"] == "blocks" and not link["from_terminal"]
    }
    found = []
    for identity in sorted(members, key=lambda item: int(rows[item]["number"])):
        row = rows[identity]
        terminal = bool(row["state_terminal"])
        parent = str(row["parent_id"]) if row["parent_id"] is not None else None
        found.append(
            {
                "work_item_id": identity,
                "reference": model.human_id(key, int(row["number"])),
                "title": row["title"],
                "state": {
                    "key": row["state_key"],
                    "name": row["state_name"],
                    "category": row["state_category"],
                    "is_terminal": terminal,
                },
                "claim_ref": row["claim_ref"],
                "claim_state": leases.state(conn, row),
                "parent_reference": model.human_id(key, int(rows[parent]["number"]))
                if parent is not None and parent in rows
                else None,
                "created_at": row["created_at"],
                "closed_at": closed_by_event.get(identity, row["updated_at"]) if terminal else None,
                "ready": read_model.workable(
                    container=identity in children,
                    claim_ref=row["claim_ref"],
                    category=str(row["state_category"]),
                    blocked=partial(operator.contains, blocked, identity),
                ),
                "_parent_id": parent,
            }
        )
    ends = members | {root_id}
    return {
        "root": {
            "work_item_id": root_id,
            "reference": model.human_id(key, int(root["number"])),
            "title": root["title"],
            "kind": root["kind"],
            # The read model calls an item with children a container; both
            # names are published so a reader need not know that.
            "container": root_id in children,
            "has_children": root_id in children,
        },
        "scope": scope,
        **_counts(found),
        "origins": _origins(found, root_id, rows, key),
        "series": _series(found),
        "recent": _recent(found, utc_now().date()),
        "members": [
            {name: value for name, value in member.items() if name != "_parent_id"}
            for member in found
        ],
        "edges": [
            {"from": str(link["from_id"]), "to": str(link["to_id"]), "kind": str(link["kind"])}
            for link in links
            if link["kind"] in EDGE_KINDS
            and str(link["from_id"]) in ends
            and str(link["to_id"]) in ends
        ],
    }


def _members(
    root_id: str,
    scope: str,
    rows: dict[str, sqlite3.Row],
    children: dict[str, list[str]],
    links: list[sqlite3.Row],
) -> set[str]:
    """Who belongs to the chain, by the definition in the module docstring."""

    members = set(children.get(root_id, []))
    if scope == "epic":
        return members
    discovered: dict[str, list[str]] = {}
    for link in links:
        # Stored from the item that was found to the item it was found from.
        if link["kind"] == "discovered-from":
            discovered.setdefault(str(link["to_id"]), []).append(str(link["from_id"]))
    pending = [root_id, *members]
    while pending:
        current = pending.pop()
        found = list(discovered.get(current, []))
        if current != root_id:
            found.extend(children.get(current, []))
        for identity in found:
            if identity == root_id or identity in members or identity not in rows:
                continue
            members.add(identity)
            pending.append(identity)
    return members


def _counts(found: list[dict]) -> dict:
    closed = sum(1 for member in found if member["state"]["is_terminal"])
    categories = Counter(str(member["state"]["category"]) for member in found)
    return {
        "total": len(found),
        "closed": closed,
        "open": len(found) - closed,
        "ready": sum(1 for member in found if member["ready"]),
        "by_category": dict(sorted(categories.items())),
    }


def _origins(found: list[dict], root_id: str, rows: dict[str, sqlite3.Row], key: str) -> list[dict]:
    """Members grouped by their parent: R's own children first, then the largest group.

    Groups of one size keep their parent's number order, and the members with
    no parent come after every parent of their size.
    """

    groups: dict[str | None, dict] = {}
    for member in found:
        parent = member["_parent_id"]
        group = groups.get(parent)
        if group is None:
            row = rows.get(parent) if parent is not None else None
            group = groups[parent] = {
                "parent_reference": model.human_id(key, int(row["number"]))
                if row is not None
                else None,
                "parent_title": row["title"] if row is not None else None,
                "count": 0,
                "open": 0,
                "_order": (
                    0 if parent == root_id else 1,
                    int(row["number"]) if row is not None else float("inf"),
                ),
            }
        group["count"] += 1
        if not member["state"]["is_terminal"]:
            group["open"] += 1
    ordered = sorted(
        groups.values(),
        key=lambda group: (group["_order"][0], -group["count"], group["_order"][1]),
    )
    return [{name: value for name, value in group.items() if name != "_order"} for group in ordered]


def _day(stamp: object) -> str:
    return str(stamp)[:10]


def _series(found: list[dict]) -> list[dict]:
    """Per UTC day with any change: what was created and closed, and the totals so far."""

    created = Counter(_day(member["created_at"]) for member in found)
    closed = Counter(_day(member["closed_at"]) for member in found if member["closed_at"])
    series = []
    total = closed_total = 0
    for day in sorted(set(created) | set(closed)):
        total += created[day]
        closed_total += closed[day]
        series.append(
            {
                "day": day,
                "created": created[day],
                "closed": closed[day],
                "total": total,
                "closed_total": closed_total,
            }
        )
    return series


def _recent(found: list[dict], today: date) -> dict:
    """The last `RECENT_DAYS` UTC days, today included, and which way they lean."""

    first = (today - timedelta(days=RECENT_DAYS - 1)).isoformat()
    last = today.isoformat()

    def within(stamp: object) -> bool:
        return stamp is not None and first <= _day(stamp) <= last

    created = sum(1 for member in found if within(member["created_at"]))
    closed = sum(1 for member in found if within(member["closed_at"]))
    trend = "growing" if created > closed else "converging" if created < closed else "steady"
    return {"days": RECENT_DAYS, "created": created, "closed": closed, "trend": trend}
