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
from collections.abc import Callable

from . import calls, leases, model


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
        raise model.WorkItemNotFoundError(f"no work item {text}")
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


#: Why a link cannot say what state its other end is in. The item is there — a
#: link cannot outlive it — but its state row is not, which only a store written
#: without its foreign keys can hold.
STATE_MISSING = "state_missing"


def end_state(row: sqlite3.Row) -> dict[str, object]:
    """The state a link names for one of its ends, from that end's state columns.

    Every read that names a link's end selects them as `state_name`,
    `state_category` and `is_terminal`, through a LEFT JOIN, so a state the
    store cannot resolve arrives as nulls; it is said as unknown here, with the
    reason beside it, and never as open.
    """

    readable = row["state_category"] is not None
    return {
        "state_name": row["state_name"] if readable else None,
        "state_category": row["state_category"] if readable else None,
        "is_terminal": bool(row["is_terminal"]) if readable else None,
        "state_unavailable": None if readable else STATE_MISSING,
    }


def links(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    """Both directions of an item's links, each naming the state of its other end.

    A reader judges a link by that state: a finished blocker blocks nothing, and
    the item's own state cannot tell it so. The other end may live in another
    space and so another workflow, which is why its state is read here rather
    than looked up in the reader's workflow. One query for every link, because
    an item with dozens of links used to cost two queries for each.
    """

    rows = conn.execute(
        "SELECT l.kind, l.outgoing, o.work_item_id, o.number, o.title, p.key AS space_key,"
        " s.name AS state_name, s.category AS state_category, s.is_terminal"
        " FROM ("
        "  SELECT kind, to_id AS other, 1 AS outgoing FROM work_item_links WHERE from_id = ?"
        "  UNION ALL"
        "  SELECT kind, from_id AS other, 0 AS outgoing FROM work_item_links WHERE to_id = ?"
        " ) l"
        " LEFT JOIN work_items o ON o.work_item_id = l.other"
        " LEFT JOIN planning_spaces p ON p.planning_space_id = o.planning_space_id"
        " LEFT JOIN workflow_states s ON s.state_id = o.state_id"
        " ORDER BY l.kind, l.other",
        (work_item_id, work_item_id),
    ).fetchall()
    found = []
    for row in rows:
        if row["work_item_id"] is None or row["space_key"] is None:
            raise model.PlanningError("work item disappeared mid-write")
        found.append(
            {
                "kind": row["kind"],
                "direction": "outgoing" if row["outgoing"] else "incoming",
                "work_item_id": row["work_item_id"],
                "reference": model.human_id(str(row["space_key"]), int(row["number"])),
                "title": row["title"],
                **end_state(row),
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


def workable(
    *, container: bool, claim_ref: object, category: str, blocked: Callable[[], bool]
) -> bool:
    """Whether an item is workable now: unheld, uncontained, unblocked and not started.

    The one statement of the rule, so a projection that loaded its facts in bulk
    answers it the way a single item's record does. `blocked` is asked last and
    only when the rest already holds, because it is the one fact that may cost
    a query.
    """

    return not container and not claim_ref and category in ("backlog", "queued") and not blocked()


def closing(
    conn: sqlite3.Connection, row: sqlite3.Row, terminal: bool
) -> tuple[str | None, str | None]:
    """When a finished item closed, and who held it then; both null for open work.

    It closed at its latest transition, the rule a chain's `closed_at` uses, or
    when it was last written if it never moved. Whoever held it then is the
    claim still on it, for an item closed before a close ended its claim, or
    else the holder the newest release since that transition names: the one
    the close itself wrote, or the separate release that used to follow it.
    No such release means it closed unheld. One query, and only for a closed
    item, because a board reads every item of a space through here.
    """

    if not terminal:
        return None, None
    identity = str(row["work_item_id"])
    found = conn.execute(
        "SELECT t.created_at, (SELECT e.detail FROM work_item_events e"
        "  WHERE e.work_item_id = ? AND e.action = 'released' AND e.id > t.id"
        "  AND e.detail != '' ORDER BY e.id DESC LIMIT 1)"
        " FROM (SELECT id, created_at FROM work_item_events WHERE work_item_id = ?"
        "  AND action = 'transitioned' ORDER BY id DESC LIMIT 1) t",
        (identity, identity),
    ).fetchone()
    closed_at = str(found[0]) if found is not None else str(row["updated_at"])
    if row["claim_ref"]:
        return closed_at, str(row["claim_ref"])
    holder = leases.released_holder(str(found[1])) if found is not None and found[1] else ""
    return closed_at, holder or None


def present(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    full: bool = False,
    comments: int | None = None,
    events: int | None = None,
) -> dict:
    """One item: a brief record, or the full one with its history.

    `comments` and `events` cut a full record's history to that many of the
    newest entries, still oldest first, and add the totals and whether anything
    was left out. Neither given is the whole history, which is what every write
    answers with and what a screen draws from.
    """

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
        "claim_state": None,
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
    # Read, never written: a stale lease stays on the record until a write
    # meets it, and the state says so rather than hiding it.
    lease = leases.lease(conn, row)
    record["claim_state"] = lease.state if lease is not None else None
    record["closed_at"], record["last_claim_ref"] = closing(conn, row, bool(state["is_terminal"]))
    record["container"] = is_container(conn, identity)
    record["ready"] = workable(
        container=record["container"],
        claim_ref=row["claim_ref"],
        category=state["category"],
        blocked=lambda: blocked(conn, identity),
    )
    if not full:
        # A count, under its own name. Calling it `comments` in the brief and
        # `comments` in the full record made one key mean two shapes, which a
        # strict reader cannot describe.
        record["comment_count"] = comment_count(conn, row)
        return record
    record["claim"] = lease.as_dict() if lease is not None else None
    record["description"] = row["description"]
    record["summary"] = model.summary(row["summary"], required=False)
    record["summary_comment_id"] = row["summary_comment_id"]
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
        {
            "id": item["id"],
            "kind": "report" if item["report"] else "comment",
            "report": model.summary(item["report"], required=False),
            "checklist_item_id": item["checklist_item_id"],
            "checklist_item_text": item["checklist_item_text"],
            "author": item["author"],
            "body": item["body"],
            "at": item["created_at"] or None,
        }
        for item in _newest(
            conn,
            "SELECT * FROM work_item_comments WHERE work_item_id = ?",
            "id",
            identity,
            comments,
        )
    ]
    record["events"] = [
        {
            "action": event["action"],
            "detail": event["detail"],
            "author": event["author"],
            "at": event["created_at"],
            "identity": _identity(event),
        }
        for event in _newest(
            conn,
            "SELECT e.id, e.action, e.detail, e.author, e.created_at,"
            " c.identity_state, c.identity_source, c.session_id, c.agent_id"
            " FROM work_item_events e LEFT JOIN execution_events c ON c.id = e.call_id"
            " WHERE e.work_item_id = ?",
            "e.id",
            identity,
            events,
        )
    ]
    if comments is not None or events is not None:
        comments_total = comment_count(conn, row)
        events_total = int(
            conn.execute(
                "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ?", (identity,)
            ).fetchone()[0]
        )
        record["comments_total"] = comments_total
        record["events_total"] = events_total
        record["history_truncated"] = (
            len(record["comments"]) < comments_total or len(record["events"]) < events_total
        )
    return record


def _newest(
    conn: sqlite3.Connection, query: str, order: str, work_item_id: str, limit: int | None
) -> list[sqlite3.Row]:
    """Every row of one item's history oldest first, or only the newest `limit` of them."""

    if limit is None:
        return conn.execute(query + " ORDER BY " + order, (work_item_id,)).fetchall()
    newest = conn.execute(
        query + " ORDER BY " + order + " DESC LIMIT ?", (work_item_id, limit)
    ).fetchall()
    return newest[::-1]


def sessions(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    """The agent sessions a client proved behind this item's write calls.

    One entry per session, in the order each first wrote here. Only a confirmed
    call counts: an unconfirmed one names a session nobody verified, and a
    browser or Valkama call has no session at all. A call is charged to the item
    it acted on first, so a link counts for its source item, not its target.
    """

    found: dict[str, dict] = {}
    for call in conn.execute(
        "SELECT session_id, client, identity_source, received_at FROM execution_events"
        " WHERE kind = ? AND work_item_id = ? AND identity_state = ?"
        " AND COALESCE(session_id, '') != '' ORDER BY id",
        (calls.KIND, work_item_id, calls.CONFIRMED),
    ):
        entry = found.setdefault(
            str(call["session_id"]),
            {"session_id": call["session_id"], "first_at": call["received_at"], "writes": 0},
        )
        # The latest call names how the session is reached now.
        entry["client"] = call["client"]
        entry["identity_source"] = call["identity_source"]
        entry["last_at"] = call["received_at"]
        entry["writes"] += 1
    return [
        {
            name: entry[name]
            for name in ("session_id", "client", "identity_source", "first_at", "last_at", "writes")
        }
        for entry in found.values()
    ]


def _identity(event: sqlite3.Row) -> dict:
    """Who made the call that wrote this event, as far as the call proved it.

    `author` beside it is what the caller wrote about itself; this is what the
    call carried. An event with no call row — written before identity existed,
    by an older build, or by the runner outside any call — is unconfirmed and
    names nobody.
    """

    return {
        "state": event["identity_state"] or calls.UNCONFIRMED,
        "source": event["identity_source"],
        "session_id": event["session_id"],
        "agent_id": event["agent_id"],
    }


def loads(value: object) -> object:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise model.PlanningError("stored JSON column is malformed") from error
    return value
