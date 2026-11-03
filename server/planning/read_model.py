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
from collections.abc import Callable, Mapping, Sequence

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


#: A closing fact: when the item's latest transition was written, and the
#: detail of the newest named release after it; None for an item never moved.
_Closed = tuple[str, str | None] | None


def closing(
    conn: sqlite3.Connection, row: sqlite3.Row, terminal: bool
) -> tuple[str | None, str | None]:
    """When a finished item closed, and who held it then; both null for open work.

    It closed at its latest transition, the rule a chain's `closed_at` uses, or
    when it was last written if it never moved. Whoever held it then is the
    claim still on it, for an item closed before a close ended its claim, or
    else the holder the newest release since that transition names: the one
    the close itself wrote, or the separate release that used to follow it.
    No such release means it closed unheld. A read of many items asks
    `closings` once instead.
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
    return _closed(row, (str(found[0]), found[1]) if found is not None else None)


def closings(
    conn: sqlite3.Connection, rows: Sequence[sqlite3.Row]
) -> dict[str, tuple[str | None, str | None]]:
    """`closing` for every finished item among `rows`, by item id, in one statement.

    A board reads every item of a space, and a space is mostly finished work:
    asking each closed item on its own cost a statement per row. Open items are
    left out; `present` reads their absence as null.
    """

    terminal = {
        str(state[0])
        for state in conn.execute("SELECT state_id FROM workflow_states WHERE is_terminal = 1")
    }
    finished = [row for row in rows if str(row["state_id"]) in terminal]
    found: dict[str, _Closed] = {}
    # The ids travel as one JSON array, so the statement is the same text for
    # any number of them and no build's limit on parameters applies.
    for identity, closed_at, detail in conn.execute(
        "SELECT t.work_item_id, c.created_at, (SELECT e.detail FROM work_item_events e"
        "  WHERE e.work_item_id = t.work_item_id AND e.action = 'released'"
        "  AND e.id > t.id AND e.detail != '' ORDER BY e.id DESC LIMIT 1)"
        " FROM (SELECT work_item_id, MAX(id) AS id FROM work_item_events"
        "  WHERE action = 'transitioned'"
        "  AND work_item_id IN (SELECT value FROM json_each(?))"
        "  GROUP BY work_item_id) t JOIN work_item_events c ON c.id = t.id",
        (json.dumps([str(row["work_item_id"]) for row in finished]),),
    ):
        found[str(identity)] = (str(closed_at), detail)
    return {
        str(row["work_item_id"]): _closed(row, found.get(str(row["work_item_id"])))
        for row in finished
    }


def _closed(row: sqlite3.Row, found: _Closed) -> tuple[str, str | None]:
    """A finished item's closing time and last holder, from what its history says."""

    closed_at = found[0] if found is not None else str(row["updated_at"])
    if row["claim_ref"]:
        return closed_at, str(row["claim_ref"])
    detail = found[1] if found is not None else None
    holder = leases.released_holder(str(detail)) if detail else ""
    return closed_at, holder or None


#: How much of a thread's newest reply its root carries; `thread` reads it whole.
LAST_REPLY_LIMIT = 500

#: Every comment column, and the sources of the calls that wrote the row and its
#: resolved mark, which are what the two `by_person` values are read from.
_COMMENT_ROWS = (
    "SELECT m.*, c.identity_source AS call_source, k.identity_source AS resolved_source"
    " FROM work_item_comments m"
    " LEFT JOIN execution_events c ON c.id = m.call_id"
    " LEFT JOIN execution_events k ON k.id = m.resolved_call_id"
)


def comment_record(row: sqlite3.Row) -> dict:
    """One comment as every read shows it, selected through `_COMMENT_ROWS`.

    A root names no parent; a reply names the comment or the question it stands
    under. `by_person` is true when the interface wrote it, false for any other
    call, and null for a row no call wrote: one older than identity, or the
    runner's. `resolution` is the resolved mark a root carries, or null: never
    on a reply, which the store refuses to mark.
    """

    return {
        "id": row["id"],
        "kind": "report" if row["report"] else "comment",
        "report": model.summary(row["report"], required=False),
        "checklist_item_id": row["checklist_item_id"],
        "checklist_item_text": row["checklist_item_text"],
        "author": row["author"],
        "body": row["body"],
        "at": row["created_at"] or None,
        "reply_to": row["reply_to"],
        "reply_to_request": row["reply_to_request"],
        "by_person": _by_person(row["call_id"], row["call_source"]),
        "resolution": None
        if row["resolved_at"] is None
        else {
            "at": row["resolved_at"],
            "by": row["resolved_by"],
            "by_person": _by_person(row["resolved_call_id"], row["resolved_source"]),
            "text": row["resolution"],
        },
    }


def _by_person(call: object, source: object) -> bool | None:
    """Whether a call came through the interface; null when no call wrote the row."""

    return None if call is None else source == calls.BROWSER


def last_reply(reply: Mapping[str, object] | None) -> dict | None:
    """The newest reply of a thread as its root carries it, from the reply's record.

    The body is cut at `LAST_REPLY_LIMIT` characters, and `clipped: true` says
    so; the key is absent when nothing was cut.
    """

    if reply is None:
        return None
    body = str(reply["body"])
    found = {name: reply[name] for name in ("id", "author", "by_person", "at")}
    found["body"] = body[:LAST_REPLY_LIMIT]
    if len(body) > LAST_REPLY_LIMIT:
        found["clipped"] = True
    return found


def _thread_counts(conn: sqlite3.Connection, identity: str) -> dict[str, int]:
    """Every comment row of an item, and how many of them are the roots of threads."""

    found = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(reply_to IS NULL AND reply_to_request IS NULL), 0)"
        " FROM work_item_comments WHERE work_item_id = ?",
        (identity,),
    ).fetchone()
    return {"comments_total": int(found[0]), "threads_total": int(found[1])}


def _newest_threads(conn: sqlite3.Connection, identity: str, limit: int) -> list[dict]:
    """The roots of the `limit` threads with the newest activity, the most recent last.

    A thread's activity is its newest row, root or reply, so a reply in an old
    thread lifts it past newer roots. A reply to a question is no thread here:
    the question is its root, and `get_work_item_request` reads it.
    """

    roots = conn.execute(
        "SELECT t.*, c.identity_source AS call_source, k.identity_source AS resolved_source"
        " FROM ("
        "  SELECT m.*,"
        "   (SELECT COUNT(*) FROM work_item_comments r WHERE r.reply_to = m.id) AS replies,"
        "   (SELECT MAX(r.id) FROM work_item_comments r WHERE r.reply_to = m.id) AS newest"
        "  FROM work_item_comments m WHERE m.work_item_id = ?"
        "  AND m.reply_to IS NULL AND m.reply_to_request IS NULL"
        "  ORDER BY COALESCE(newest, m.id) DESC LIMIT ?"
        " ) t LEFT JOIN execution_events c ON c.id = t.call_id"
        " LEFT JOIN execution_events k ON k.id = t.resolved_call_id"
        " ORDER BY COALESCE(t.newest, t.id)",
        (identity, limit),
    ).fetchall()
    newest = {
        int(row["id"]): comment_record(row)
        for row in conn.execute(
            _COMMENT_ROWS + " JOIN json_each(?) w ON w.value = m.id",
            (json.dumps([row["newest"] for row in roots if row["newest"] is not None]),),
        )
    }
    return [
        {
            **comment_record(row),
            "replies": int(row["replies"]),
            "last_reply": last_reply(newest.get(row["newest"])),
        }
        for row in roots
    ]


def _one_thread(
    conn: sqlite3.Connection, identity: str, reference_text: str, comment_id: int
) -> list[dict]:
    """The thread a comment belongs to, root first and its replies oldest first."""

    if comment_id < 1:
        raise model.PlanningError("thread must be a positive integer")
    named = conn.execute(
        "SELECT work_item_id, reply_to, reply_to_request FROM work_item_comments WHERE id = ?",
        (comment_id,),
    ).fetchone()
    if named is None or str(named["work_item_id"]) != identity:
        raise model.PlanningError(f"comment {comment_id} is not on {reference_text}")
    if named["reply_to_request"] is not None:
        raise model.PlanningError(
            f"comment {comment_id} answers question {named['reply_to_request']};"
            " get_work_item_request reads that thread"
        )
    root = int(named["reply_to"] or comment_id)
    return [
        comment_record(row)
        for row in conn.execute(
            _COMMENT_ROWS + " WHERE m.id = ? OR m.reply_to = ? ORDER BY m.id", (root, root)
        )
    ]


def _exclusive(**cuts: object) -> None:
    """Refuse two ways of cutting the comments that cannot hold together."""

    named = [name for name, value in cuts.items() if value is not None]
    if len(named) > 1:
        raise model.PlanningError(f"{named[0]} and {named[1]} exclude each other")


def present(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    full: bool = False,
    comments: int | None = None,
    comments_after: int = 0,
    threads: int | None = None,
    thread: int | None = None,
    events: int | None = None,
    closed: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> dict:
    """One item: a brief record, or the full one with its history.

    `comments` and `events` cut a full record's history to that many of the
    newest entries, still oldest first, and add the totals and whether anything
    was left out; `comments_after` does the same with the comments up to that
    id, so a reader takes only what came since. Those reads are flat: every
    row, root or reply, in the order written. `threads` instead keeps the roots
    of that many threads with the newest activity, each carrying how many
    replies it has and the newest one, and `thread` one thread whole, named by
    any of its comments. None given is the whole history, which is what every
    write answers with and what a screen draws from. `closed` is what
    `closings` loaded for a read of many items; absent, the item asks `closing`
    itself.
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
    # A read of many items hands over every closing it loaded at once.
    record["closed_at"], record["last_claim_ref"] = (
        closing(conn, row, bool(state["is_terminal"]))
        if closed is None
        else closed.get(identity, (None, None))
    )
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
    # A count may narrow `comments_after`; a thread read takes neither.
    after = comments_after or None
    if thread is not None:
        _exclusive(thread=thread, threads=threads, comments=comments, comments_after=after)
    if threads is not None:
        _exclusive(threads=threads, comments=comments, comments_after=after)
    shown_threads: int | None = None
    if thread is not None:
        record["comments"] = _one_thread(conn, identity, record["reference"], thread)
        shown_threads = 1
    elif threads is not None:
        record["comments"] = _newest_threads(conn, identity, threads)
        shown_threads = len(record["comments"])
    else:
        record["comments"] = [
            comment_record(item)
            for item in _newest(
                conn,
                _COMMENT_ROWS + " WHERE m.work_item_id = ? AND m.id > ?",
                "m.id",
                (identity, comments_after),
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
            (identity,),
            events,
        )
    ]
    if shown_threads is not None or comments is not None or comments_after or events is not None:
        counts = _thread_counts(conn, identity)
        events_total = int(
            conn.execute(
                "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ?", (identity,)
            ).fetchone()[0]
        )
        record.update(counts)
        record["events_total"] = events_total
        # A thread read leaves out the threads it does not show; a flat read the rows.
        record["history_truncated"] = (
            shown_threads < counts["threads_total"]
            if shown_threads is not None
            else len(record["comments"]) < counts["comments_total"]
        ) or len(record["events"]) < events_total
    return record


def _newest(
    conn: sqlite3.Connection,
    query: str,
    order: str,
    bound: tuple[str | int, ...],
    limit: int | None,
) -> list[sqlite3.Row]:
    """Every row of one item's history oldest first, or only the newest `limit` of them."""

    if limit is None:
        return conn.execute(query + " ORDER BY " + order, bound).fetchall()
    newest = conn.execute(
        query + " ORDER BY " + order + " DESC LIMIT ?", (*bound, limit)
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
