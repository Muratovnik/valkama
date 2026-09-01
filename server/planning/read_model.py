"""What a caller sees about a work item, and the reads that build it.

This is the other half of `service`: that module owns every write and the guard
that makes a write safe, and this one owns identity lookups and the shape of the
record those writes hand back. They change for different reasons — a new field
in the payload is not a new rule about who may write — and the dependency runs
one way, from the writer to the reader.

Readiness and containment are computed here rather than by each view, because
the Board era left that to the callers and they disagreed about a held item and
about a container.
"""

from __future__ import annotations

import json
import sqlite3

from . import model


def item_row(conn: sqlite3.Connection, reference: object) -> sqlite3.Row:
    """The item a caller named, by UUID or by what a person types."""

    text = model.text_field(reference, "work item", limit=64)
    row = conn.execute("SELECT * FROM work_items WHERE work_item_id = ?", (text,)).fetchone()
    if row is not None:
        return row
    key, number = model.parse_human_id(text)
    row = conn.execute(
        "SELECT i.* FROM work_items i JOIN planning_spaces p"
        " ON p.planning_space_id = i.planning_space_id WHERE p.key = ? AND i.number = ?",
        (key, number),
    ).fetchone()
    if row is None:
        raise model.PlanningError(f"no work item {text}")
    return row


def item_by_id(conn: sqlite3.Connection, work_item_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM work_items WHERE work_item_id = ?", (work_item_id,)
    ).fetchone()
    if row is None:
        raise model.PlanningError("work item disappeared mid-write")
    return row


def state_by_id(conn: sqlite3.Connection, state_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM workflow_states WHERE state_id = ?", (state_id,)).fetchone()
    if row is None:
        raise model.PlanningError("workflow state does not exist")
    return row


def reference(conn: sqlite3.Connection, row: sqlite3.Row) -> str:
    key = conn.execute(
        "SELECT key FROM planning_spaces WHERE planning_space_id = ?",
        (str(row["planning_space_id"]),),
    ).fetchone()
    return model.human_id(str(key[0]), int(row["number"]))


def comment_count(conn: sqlite3.Connection, row: sqlite3.Row) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM work_item_comments WHERE work_item_id = ?",
            (str(row["work_item_id"]),),
        ).fetchone()[0]
    )


def links(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    outgoing = conn.execute(
        "SELECT kind, to_id AS other, 1 AS outgoing FROM work_item_links WHERE from_id = ?"
        " UNION ALL"
        " SELECT kind, from_id AS other, 0 AS outgoing FROM work_item_links WHERE to_id = ?"
        " ORDER BY kind, other",
        (work_item_id, work_item_id),
    ).fetchall()
    found = []
    for row in outgoing:
        other = item_by_id(conn, str(row["other"]))
        found.append(
            {
                "kind": row["kind"],
                "direction": "outgoing" if row["outgoing"] else "incoming",
                "work_item_id": other["work_item_id"],
                "reference": reference(conn, other),
                "title": other["title"],
            }
        )
    return found


def blocked(conn: sqlite3.Connection, work_item_id: str) -> bool:
    """Whether anything unfinished blocks this item."""

    return (
        conn.execute(
            "SELECT 1 FROM work_item_links l"
            " JOIN work_items b ON b.work_item_id = l.from_id"
            " JOIN workflow_states s ON s.state_id = b.state_id"
            " WHERE l.to_id = ? AND l.kind = 'blocks' AND s.is_terminal = 0 LIMIT 1",
            (work_item_id,),
        ).fetchone()
        is not None
    )


def is_container(conn: sqlite3.Connection, work_item_id: str) -> bool:
    """Whether anything calls this item its parent, which makes it a container."""

    return (
        conn.execute(
            "SELECT 1 FROM work_items WHERE parent_id = ? LIMIT 1", (work_item_id,)
        ).fetchone()
        is not None
    )


def present(conn: sqlite3.Connection, row: sqlite3.Row, *, full: bool = False) -> dict:
    state = state_by_id(conn, str(row["state_id"]))
    record = {
        "work_item_id": row["work_item_id"],
        "planning_space_id": row["planning_space_id"],
        "reference": reference(conn, row),
        "number": int(row["number"]),
        "title": row["title"],
        "kind": row["kind"],
        "priority": row["priority"],
        "state": {
            "state_id": state["state_id"],
            "key": state["key"],
            "name": state["name"],
            "category": state["category"],
            "is_terminal": bool(state["is_terminal"]),
        },
        "claim_ref": row["claim_ref"],
        "parent_id": row["parent_id"],
        "labels": model.labels(loads(row["labels"])),
        "source": row["source"],
        "checklist": model.checklist(row["checklist"]),
        "revision": int(row["revision"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
    # Readiness is computed here, once, so the list, the board and the graph all
    # answer the same question the same way. The Board era left it to each view,
    # and they disagreed about a held item and about a container.
    identity = str(row["work_item_id"])
    record["container"] = is_container(conn, identity)
    record["ready"] = (
        not record["container"]
        and not row["claim_ref"]
        and state["category"] in ("backlog", "queued")
        and not blocked(conn, identity)
    )
    if not full:
        # A count, under its own name. Calling it `comments` in the brief and
        # `comments` in the full record made one key mean two shapes, which a
        # strict reader cannot describe.
        record["comment_count"] = comment_count(conn, row)
        return record
    record["description"] = row["description"]
    record["summary"] = model.summary(row["summary"], required=False)
    record["links"] = links(conn, str(row["work_item_id"]))
    record["refs"] = [
        {
            "kind": ref["kind"],
            "value": ref["value"],
            "label": ref["label"],
            "author": ref["author"],
            "at": ref["created_at"],
        }
        for ref in conn.execute(
            "SELECT * FROM work_item_refs WHERE work_item_id = ? ORDER BY id",
            (str(row["work_item_id"]),),
        )
    ]
    record["comments"] = [
        {"author": item["author"], "body": item["body"], "at": item["created_at"]}
        for item in conn.execute(
            "SELECT * FROM work_item_comments WHERE work_item_id = ? ORDER BY id",
            (str(row["work_item_id"]),),
        )
    ]
    record["events"] = [
        {
            "action": event["action"],
            "detail": event["detail"],
            "author": event["author"],
            "at": event["created_at"],
        }
        for event in conn.execute(
            "SELECT * FROM work_item_events WHERE work_item_id = ? ORDER BY id",
            (str(row["work_item_id"]),),
        )
    ]
    return record


def loads(value: object) -> object:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise model.PlanningError("stored JSON column is malformed") from error
    return value
