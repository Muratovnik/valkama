"""What a caller sees about a work item, and the reads that build it.

This is the other half of `service`: that module owns every write and the guard
that makes a write safe, and this one owns identity lookups and the shape of the
record those writes hand back. They change for different reasons — a new field
in the payload is not a new rule about who may write — and the dependency runs
one way, from the writer to the reader.

Readiness and what a container derives are computed here, through `item_tree`,
rather than by each view, because the Board era left that to the callers and
they disagreed about a held item and about a container. A state leaves through
`states.public_state` alone, so the service state an accepted open container
stands in never reaches a reader.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence

from . import acknowledgements, calls, item_tree, leases, mentions, model, states, subscriptions


@contextlib.contextmanager
def whole_store_read() -> Iterator[None]:
    """A read that needs the store's whole schema, or a refusal saying it cannot have it.

    No statement here branches on what a store holds: the one schema this build
    knows is asked for, and a store without it answers with `StoreSchemaError`.
    Anything else SQLite says, such as a busy database, is not about the schema
    and stays what it is.
    """

    try:
        yield
    except sqlite3.OperationalError as error:
        if str(error).startswith(("no such table", "no such column")):
            raise model.StoreSchemaError(
                "this store was written by another build of Valkama and cannot answer this read"
            ) from error
        raise


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


def end_state(row: sqlite3.Row, container_state: str | None = None) -> dict[str, object]:
    """The state a link names for one of its ends, from that end's state columns.

    Every read that names a link's end selects them as `state_name`,
    `state_category` and `is_terminal`, through a LEFT JOIN, so a state the
    store cannot resolve arrives as nulls; it is said as unknown here, with the
    reason beside it, and never as open. An end that is an accepted open container
    stands in a state of no category: its name and category are null, it is open,
    nothing is unavailable, and `container_state` says what it derives, which the
    caller read from the items under it (`item_tree`).
    """

    readable = row["state_category"] is not None
    shown = (
        states.public_state(
            {
                "key": None,
                "name": row["state_name"],
                "category": row["state_category"],
                "is_terminal": row["is_terminal"],
            }
        )
        if readable
        else None
    )
    return {
        "state_name": shown["name"] if shown is not None else None,
        "state_category": shown["category"] if shown is not None else None,
        "is_terminal": bool(row["is_terminal"]) if readable else None,
        "state_unavailable": None if readable else STATE_MISSING,
        "container_state": container_state if readable and shown is None else None,
    }


def service_ends(rows: Sequence[sqlite3.Row], column: str) -> list[str]:
    """The ends among link rows that stand in the service state, by the id `column` names."""

    return [str(row[column]) for row in rows if row["state_category"] == model.SERVICE_CATEGORY]


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
    ends = item_tree.below(conn, service_ends(rows, "work_item_id"))
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
                **end_state(row, ends.container_state(str(row["work_item_id"]))),
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


def outward_kind(kind: object, parent_id: object) -> str:
    """The kind a reader sees: a container is a goal, or a stage under a parent.

    Every place a kind leaves the server from a row reads it through this.
    """

    if kind == model.CONTAINER_KIND:
        return "stage" if parent_id else "goal"
    return str(kind)


def acceptance(row: sqlite3.Row) -> dict | None:
    """Why accepted work was accepted and when, or None while it is not.

    An attached store an earlier build wrote is read as it is, and it records no
    acceptance: its rows have no such column, and nothing there was accepted so.
    """

    columns = row.keys()  # `in row` would search a Row's values, not its names
    if "acceptance" not in columns or row["acceptance"] is None:
        return None
    return {"basis": row["acceptance"], "at": row["accepted_at"]}


def workable(
    *,
    container: bool,
    claim_ref: object,
    checklist: object,
    category: str,
    blocked: Callable[[], bool],
    startable: Callable[[], bool],
) -> bool:
    """Whether an item is workable now: a task, unheld, unblocked, startable from triage or ready.

    The rule the take-next queue applies, stated once with its query's form
    (`WORKABLE_CLAUSES`), so a projection that loaded its facts in bulk answers it
    the way a single item's record does and the queue hands out what reads
    workable. A container is never workable: nobody holds one. Unheld is the item
    and every step of it. A task in a state with no way into work is not workable
    either: a claim of it is refused, and a queue that offered it would stick on it.
    `blocked` and `startable` are asked last and only when the rest already holds,
    because they are the facts that may cost a query.
    """

    return (
        not container
        and not claim_ref
        and not any(step["claimed_by"] for step in model.checklist(checklist))
        and category in model.WORKABLE_CATEGORIES
        and not blocked()
        and startable()
    )


def startable(conn: sqlite3.Connection, row: sqlite3.Row, loaded: bool | None) -> bool:
    """Whether a claim can start the item where it stands: what a read loaded, or asked now.

    A read of many items loads it with their tree in the queue's own form
    (`states.STARTS_CLAUSE`); one task's record asks `states.start_state`.
    """

    return states.start_state(conn, row) is not None if loaded is None else loaded


#: `workable` as the take-next queue's conditions on an item `i` in its state `s`.
WORKABLE_CLAUSES = (
    f"i.kind != '{model.CONTAINER_KIND}'",
    "i.claim_ref = ''",
    "NOT EXISTS (SELECT 1 FROM json_each(i.checklist) j"
    " WHERE COALESCE(json_extract(j.value, '$.claimed_by'), '') != '')",
    "s.category IN (" + ",".join(f"'{category}'" for category in model.WORKABLE_CATEGORIES) + ")",
    "NOT EXISTS (SELECT 1 FROM work_item_links l JOIN work_items b"
    " ON b.work_item_id = l.from_id JOIN workflow_states bs ON bs.state_id = b.state_id"
    " WHERE l.to_id = i.work_item_id AND l.kind = 'blocks' AND bs.is_terminal = 0)",
    states.STARTS_CLAUSE,
)


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
#: How many unresolved roots one read answers with. The next page starts after the
#: last root read rather than at an offset, so a root marked between two pages
#: moves nothing the reader has yet to see.
UNRESOLVED_PAGE = 20


#: Every comment column, and the sources of the calls that wrote the row and its
#: resolved mark, which are what the two `by_person` values are read from; and,
#: for a comment that waits for a reply, whether one came, worked out only for it:
#: a later reply in its thread (`r`, through its call `rc`) by a person, or by a
#: confirmed session other than the one whose call `c` wrote the comment. The
#: roots below read the same.
_COMMENT_ROWS = (
    "SELECT m.*, c.identity_source AS call_source, k.identity_source AS resolved_source,"
    " CASE WHEN m.awaits_reply = 1 THEN EXISTS (SELECT 1 FROM work_item_comments r"
    " LEFT JOIN execution_events rc ON rc.id = r.call_id WHERE r.id > m.id"
    " AND CASE WHEN m.reply_to_request IS NULL THEN r.reply_to = COALESCE(m.reply_to, m.id)"
    " ELSE r.reply_to_request = m.reply_to_request END"
    " AND (rc.identity_source = 'browser' OR (rc.identity_state = 'confirmed'"
    " AND rc.identity_source <> 'valkama' AND rc.session_id IS NOT NULL"
    " AND rc.session_id IS NOT c.session_id))) END AS answered"
    " FROM work_item_comments m"
    " LEFT JOIN execution_events c ON c.id = m.call_id"
    " LEFT JOIN execution_events k ON k.id = m.resolved_call_id"
)
#: The roots of an item with how many replies each has and its newest. A read
#: closes the inner query with its own filter, order and limit, then `_ROOT_CALLS`.
_ROOT_ROWS = (
    "SELECT t.*, c.identity_source AS call_source, k.identity_source AS resolved_source,"
    " CASE WHEN t.awaits_reply = 1 THEN EXISTS (SELECT 1 FROM work_item_comments r"
    " LEFT JOIN execution_events rc ON rc.id = r.call_id WHERE r.reply_to = t.id"
    " AND (rc.identity_source = 'browser' OR (rc.identity_state = 'confirmed'"
    " AND rc.identity_source <> 'valkama' AND rc.session_id IS NOT NULL"
    " AND rc.session_id IS NOT c.session_id))) END AS answered FROM ("
    "  SELECT m.*,"
    "   (SELECT COUNT(*) FROM work_item_comments r WHERE r.reply_to = m.id) AS replies,"
    "   (SELECT MAX(r.id) FROM work_item_comments r WHERE r.reply_to = m.id) AS newest"
    "  FROM work_item_comments m WHERE m.work_item_id = ?"
    "  AND m.reply_to IS NULL AND m.reply_to_request IS NULL"
)
_ROOT_CALLS = (
    " ) t LEFT JOIN execution_events c ON c.id = t.call_id"
    " LEFT JOIN execution_events k ON k.id = t.resolved_call_id"
)


def comment_record(row: sqlite3.Row) -> dict:
    """One comment as every read shows it, selected through `_COMMENT_ROWS`.

    A root names no parent; a reply names the comment or the question it stands
    under. `by_person` is true when the interface wrote it, false for any other
    call, and null for a row no call wrote: one older than identity, or the
    runner's. `resolution` is the resolved mark a root carries, or null: never
    on a reply, which the store refuses to mark. `mentions` is filled in by
    `with_mentions`, which every read passes its comments through. A comment that
    waits for a reply says so, `awaits_reply: true`, with whether another session or
    a person has `answered`; any other carries neither key.
    """

    record = {
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
        "mentions": [],
    }
    if row["awaits_reply"]:
        record["awaits_reply"] = True
        record["answered"] = bool(row["answered"])
    return record


def with_mentions(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Comments with the items each named in `mentions`, by reference in the order named.

    One statement for every comment of a read. The record a mention leaves is an
    event on the item it names, found by the comment's id; on an attached store from
    before mentions there is none, and every comment named nothing.
    """

    identities = [int(record["id"]) for record in records]
    if not identities:
        return records
    named: dict[int, list[str]] = {}
    for row in conn.execute(
        "SELECT x.detail, s.key, w.number FROM work_item_events x"
        " JOIN work_items w ON w.work_item_id = x.work_item_id"
        " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id"
        " WHERE x.action = 'mentioned'"
        " AND x.detail IN (SELECT CAST(value AS TEXT) FROM json_each(?)) ORDER BY x.id",
        (json.dumps(identities),),
    ):
        named.setdefault(int(row[0]), []).append(model.human_id(str(row[1]), int(row[2])))
    return [{**record, "mentions": named.get(int(record["id"]), [])} for record in records]


def comment(conn: sqlite3.Connection, comment_id: int) -> dict:
    """One comment as every read shows it, for a write to answer with what it left."""

    row = conn.execute(_COMMENT_ROWS + " WHERE m.id = ?", (comment_id,)).fetchone()
    return with_mentions(conn, [comment_record(row)])[0]


#: How many of the texts that named an item its full record carries, the newest.
HTTP_MENTIONS = 50
#: How much of the naming text a mention record quotes, the ellipsis counted.
MENTION_QUOTE = 300
#: A `mentioned` event's detail when the words are an item's description, its id after it;
#: any other detail is the id of a comment.
IN_DESCRIPTION = "description:"

#: Each record with where its words stand now: the comment and its item, or the item
#: whose description it is. A detail is one or the other, so one join finds nothing.
_MENTION_ROWS = (
    "SELECT e.detail, e.created_at, e.author, e.call_id, c.identity_source,"
    " m.body, m.report, s.key, w.number, w.summary_comment_id = m.id,"
    " d.description, ds.key, d.number"
    " FROM work_item_events e LEFT JOIN execution_events c ON c.id = e.call_id"
    " LEFT JOIN work_item_comments m ON e.detail NOT LIKE 'description:%'"
    " AND m.id = CAST(e.detail AS INTEGER)"
    " LEFT JOIN work_items w ON w.work_item_id = m.work_item_id"
    " LEFT JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id"
    " LEFT JOIN work_items d ON e.detail LIKE 'description:%'"
    " AND d.work_item_id = substr(e.detail, length('description:') + 1)"
    " LEFT JOIN planning_spaces ds ON ds.planning_space_id = d.planning_space_id"
    " WHERE e.work_item_id = ? AND e.action = 'mentioned' ORDER BY e.id DESC"
)


def mentions_of(
    conn: sqlite3.Connection, work_item_id: str, limit: int | None
) -> tuple[list[dict], int]:
    """The newest `limit` records of texts that named this item, oldest first, and how many."""

    query = _MENTION_ROWS
    parameters: tuple[object, ...] = (work_item_id,)
    if limit is not None:
        query += " LIMIT ?"
        parameters = (work_item_id, limit)
    rows = conn.execute(query, parameters).fetchall()
    total = int(
        conn.execute(
            "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ? AND action = 'mentioned'",
            (work_item_id,),
        ).fetchone()[0]
    )
    named = reference(conn, item_by_id(conn, work_item_id)) if rows else ""
    return [_mention_record(row, named) for row in reversed(rows)], total


def _mention_record(row: sqlite3.Row, named: str) -> dict:
    """Where the words are and what they say: `in` a comment, a report, a summary or a description.

    A report is `summary` while it is its item's summary. A description is quoted
    from the line that names this item, since it is long and changes; a comment
    from its start.
    """

    record = {
        "in": "description",
        "comment_id": None,
        "from": None,
        "at": row[1],
        "by_person": None if row[3] is None else row[4] == calls.BROWSER,
        "author": row[2],
        "quote": None,
    }
    if str(row[0]).startswith(IN_DESCRIPTION):
        if row[11] is not None:
            record["from"] = model.human_id(str(row[11]), int(row[12]))
            record["quote"] = _cut_quote(mentions.from_line_of(str(row[10]), named))
        return record
    record["comment_id"] = int(row[0])
    record["in"] = "summary" if row[9] else "report" if row[6] else "comment"
    if row[7] is not None:
        record["from"] = model.human_id(str(row[7]), int(row[8]))
        record["quote"] = _mention_quote(str(row[5]), str(row[6]))
    return record


def _mention_quote(body: str, report: str) -> str:
    """The start of what the comment said: its body, or a report's `done`."""

    said = body
    if report:
        stored = model.summary(report, required=False)
        said = str(stored["done"]) if stored else ""
    return _cut_quote(said)


def _cut_quote(said: str) -> str:
    return said if len(said) <= MENTION_QUOTE else said[: MENTION_QUOTE - 1] + "…"


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


def request_replies(conn: sqlite3.Connection, request_id: str) -> list[dict]:
    """Every reply under a question, oldest first, each as every read shows a comment."""

    return with_mentions(
        conn,
        [
            comment_record(row)
            for row in conn.execute(
                _COMMENT_ROWS + " WHERE m.reply_to_request = ? ORDER BY m.id", (request_id,)
            )
        ],
    )


def request_threads(
    conn: sqlite3.Connection, request_ids: list[str]
) -> dict[str, tuple[int, dict]]:
    """For each question with replies, how many it has and the newest one's record.

    A question without a reply is absent. Two statements for every question named,
    however many: the counts, then the newest replies' records.
    """

    totals = {
        int(row[0]): int(row[1])
        for row in conn.execute(
            "SELECT MAX(id), COUNT(*) FROM work_item_comments"
            " WHERE reply_to_request IN (SELECT value FROM json_each(?)) GROUP BY reply_to_request",
            (json.dumps(request_ids),),
        )
    }
    return {
        str(row["reply_to_request"]): (totals[int(row["id"])], comment_record(row))
        for row in conn.execute(
            _COMMENT_ROWS + " JOIN json_each(?) w ON w.value = m.id", (json.dumps(list(totals)),)
        )
    }


def _thread_counts(conn: sqlite3.Connection, identity: str) -> dict[str, int]:
    """Every comment row of an item, how many are the roots of threads, and how many of
    those have no resolved mark."""

    found = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(reply_to IS NULL AND reply_to_request IS NULL), 0),"
        " COALESCE(SUM(reply_to IS NULL AND reply_to_request IS NULL AND resolved_at IS NULL), 0)"
        " FROM work_item_comments WHERE work_item_id = ?",
        (identity,),
    ).fetchone()
    return {
        "comments_total": int(found[0]),
        "threads_total": int(found[1]),
        "unresolved_total": int(found[2]),
    }


def _newest_threads(conn: sqlite3.Connection, identity: str, limit: int) -> list[dict]:
    """The roots of the `limit` threads with the newest activity, the most recent last.

    A thread's activity is its newest row, root or reply, so a reply in an old
    thread lifts it past newer roots. A reply to a question is no thread here:
    the question is its root, and `get_work_item_request` reads it.
    """

    return _with_replies(
        conn,
        conn.execute(
            _ROOT_ROWS
            + "  ORDER BY COALESCE(newest, m.id) DESC LIMIT ?"
            + _ROOT_CALLS
            + " ORDER BY COALESCE(t.newest, t.id)",
            (identity, limit),
        ).fetchall(),
    )


def _unresolved_threads(
    conn: sqlite3.Connection, identity: str, after: int
) -> tuple[list[dict], bool]:
    """One page of the roots without the resolved mark after `after`, oldest first.

    Read one past its size, so whether more remain is known rather than guessed.
    """

    roots = conn.execute(
        _ROOT_ROWS
        + "  AND m.resolved_at IS NULL AND m.id > ? ORDER BY m.id LIMIT ?"
        + _ROOT_CALLS
        + " ORDER BY t.id",
        (identity, after, UNRESOLVED_PAGE + 1),
    ).fetchall()
    return _with_replies(conn, roots[:UNRESOLVED_PAGE]), len(roots) > UNRESOLVED_PAGE


def _with_replies(conn: sqlite3.Connection, roots: list[sqlite3.Row]) -> list[dict]:
    """Roots read through `_ROOT_ROWS`, each with how many replies it has and the newest."""

    newest = {
        int(row["id"]): comment_record(row)
        for row in conn.execute(
            _COMMENT_ROWS + " JOIN json_each(?) w ON w.value = m.id",
            (json.dumps([row["newest"] for row in roots if row["newest"] is not None]),),
        )
    }
    return with_mentions(
        conn,
        [
            {
                **comment_record(row),
                "replies": int(row["replies"]),
                "last_reply": last_reply(newest.get(row["newest"])),
            }
            for row in roots
        ],
    )


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
    return with_mentions(
        conn,
        [
            comment_record(row)
            for row in conn.execute(
                _COMMENT_ROWS + " WHERE m.id = ? OR m.reply_to = ? ORDER BY m.id", (root, root)
            )
        ],
    )


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
    unresolved: bool = False,
    events: int | None = None,
    closed: Mapping[str, tuple[str | None, str | None]] | None = None,
    tree: item_tree.Tree | None = None,
) -> dict:
    """One item: a brief record, or the full one with its history.

    `comments` and `events` cut a full record's history to that many of the
    newest entries, still oldest first, and add the totals and whether anything
    was left out; `comments_after` does the same with the comments up to that
    id, so a reader takes only what came since. Those reads are flat: every
    row, root or reply, in the order written. `threads` instead keeps the roots
    of that many threads with the newest activity, each carrying how many
    replies it has and the newest one, `thread` one thread whole, named by any
    of its comments, and `unresolved` one page of the roots without the resolved
    mark, carrying the same and `truncated`, the next page after `comments_after`.
    None given is the whole history, which is what every write answers with and
    what a screen draws from. `closed` is what `closings` loaded for a read of
    many items; absent, the item asks `closing` itself. `tree` is what such a read
    loaded of its spaces (`item_tree.of_spaces`); absent, the item loads what is
    under it.

    `state` is what `states.public_state` makes of the item's state: null for an
    accepted open container, which says what it derives as `container_state`
    instead. `open` says whether work on it is over, whatever its kind.
    """

    record, lease = _record(conn, row, closed=closed, tree=tree)
    identity = str(row["work_item_id"])
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
    record["links"] = links(conn, identity)
    record["refs"] = refs(conn, identity)
    record["comments"], shown_threads, more = _cut_comments(
        conn,
        identity,
        str(record["reference"]),
        comments=comments,
        comments_after=comments_after,
        threads=threads,
        thread=thread,
        unresolved=unresolved,
    )
    if more is not None:
        record["truncated"] = more
    record["events"] = _events(conn, identity, events)
    if shown_threads is not None or comments is not None or comments_after or events is not None:
        counts = _thread_counts(conn, identity)
        events_total = _events_total(conn, identity)
        record.update(counts)
        record["events_total"] = events_total
        # A thread read leaves out the threads it does not show; a flat read the rows.
        record["history_truncated"] = (
            shown_threads < counts["threads_total"]
            if shown_threads is not None
            else len(record["comments"]) < counts["comments_total"]
        ) or len(record["events"]) < events_total
    # The comments elsewhere that named it, which every full record carries:
    # a write's answer is the same record a read gives.
    record["mentions"], record["mentions_total"] = mentions_of(conn, identity, HTTP_MENTIONS)
    # Who follows it without holding it, for the card to name.
    record["subscribers"] = subscriptions.subscribers(conn, identity)
    return record


def _record(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    closed: Mapping[str, tuple[str | None, str | None]] | None = None,
    tree: item_tree.Tree | None = None,
) -> tuple[dict, leases.Lease | None]:
    """What the brief record, the full one and the card share, and the lease it read.

    Everything here is read from the item's row, its state and what is under it,
    never from its history, so it costs the same however long the history is.
    """

    state = state_by_id(conn, str(row["state_id"]))
    shown = states.public_state(state)
    record = {
        "work_item_id": row["work_item_id"],
        "planning_space_id": row["planning_space_id"],
        "reference": reference(conn, row),
        "number": int(row["number"]),
        "title": row["title"],
        "kind": outward_kind(row["kind"], row["parent_id"]),
        "priority": row["priority"],
        "state": None if shown is None else {"state_id": state["state_id"], **shown},
        "open": not state["is_terminal"],
        "container_state": None,
        "acceptance": acceptance(row),
        "started_at": None,
        "waits_for": [],
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
    facts = tree if tree is not None else item_tree.of_item(conn, row, str(state["category"]))
    record["container_state"] = facts.container_state(identity)
    record["started_at"] = facts.started_at(identity)
    record["waits_for"] = facts.waits_for(identity)
    record["workable"] = workable(
        container=row["kind"] == model.CONTAINER_KIND,
        claim_ref=row["claim_ref"],
        checklist=record["checklist"],
        category=str(state["category"]),
        blocked=lambda: bool(record["waits_for"]),
        startable=lambda: startable(conn, row, facts.startable(identity)),
    )
    return record, lease


#: The parts an item is read by, in the order its table of contents names them.
#: `card` is the item itself; every other part is the field of that name in its
#: full record, but `sections`, which divides the description, and `participants`,
#: which only a goal or a stage has.
PARTS = (
    "card",
    "comments",
    "events",
    "links",
    "refs",
    "questions",
    "mentions",
    "sessions",
    "images",
    "subscribers",
    "claim",
    "sections",
    "participants",
)
#: The card's fields, in the order it carries them. `withheld`, `projects` and
#: `lapsed_claim` are named ahead of the builds that add them to the record, and a
#: card carries each when its record has it, so no build edits this list for them.
CARD_FIELDS = (
    "reference",
    "title",
    "kind",
    "priority",
    "state",
    "open",
    "container_state",
    "acceptance",
    "started_at",
    "waits_for",
    "workable",
    "withheld",
    "projects",
    "claim_ref",
    "claim_state",
    "last_claim_ref",
    "lapsed_claim",
    "closed_at",
    "labels",
    "source",
    "revision",
    "created_at",
    "updated_at",
    "url",
    "parent",
    "description",
    "checklist",
    "summary",
)
#: What a step carries on the card beyond its id, text and whether it is done, each
#: only when it is set: who holds it, who ticked it, and that a previous holder did.
CARD_STEP_MARKS = ("claimed_by", "done_by", "by_previous_holder")
#: The state's fields on the card; whether work is over in it is `open`.
CARD_STATE = ("key", "name", "category")
#: What the full record holds that is neither on the card nor a part: the ids the
#: card's `reference` and `parent` stand for, the summary's comment, and the counts
#: and marks of a cut history, which the table of contents and the parts carry.
OFF_CARD = (
    "work_item_id",
    "planning_space_id",
    "number",
    "parent_id",
    "summary_comment_id",
    "comment_count",
    "comments_total",
    "threads_total",
    "unresolved_total",
    "events_total",
    "history_truncated",
    "truncated",
    "mentions_total",
)
#: How many threads and events the comments and events parts carry when no cut is named.
PART_THREADS = 5
PART_EVENTS = 10
#: The most newest events the events part reads when the caller names how many.
PART_EVENTS_MOST = 1000
#: How many comments one page of the comments part after a comment id carries. The
#: next page starts after the last one read, as an unresolved page does, because the
#: longest discussions do not fit one answer.
COMMENTS_PAGE = 50


def part_names(names: Iterable[str]) -> list[str]:
    """The parts named, each once in the order named; a name no part has is refused."""

    found = list(dict.fromkeys(names))
    for name in found:
        if name not in PARTS:
            raise model.PlanningError(f"unknown part '{name}'; parts are {', '.join(PARTS)}")
    return found


def card(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    counted: Mapping[str, Mapping[str, int]] | None = None,
) -> dict:
    """An item as an agent reads it first: its fields, its own text and what else it has.

    Built from the item's row and what is under it, with every other part counted
    by aggregates (`part_counts`) rather than read, so a card costs the same however
    long its history is. `counted` carries what a reader above this module counts:
    the questions, which `requests` reads.
    """

    record, lease = _record(conn, row)
    state = record["state"]
    found = {
        **record,
        # The card reads the state the record published and keeps what a reader names.
        "state": None if state is None else {name: state[name] for name in CARD_STATE},
        "url": acknowledgements.work_item_url(str(record["reference"])),
        "parent": _parent_reference(conn, row["parent_id"]),
        "description": row["description"],
        "checklist": [card_step(step) for step in record["checklist"]],
        "summary": model.summary(row["summary"], required=False),
    }
    shown = {name: found[name] for name in CARD_FIELDS if name in found}
    if shown["summary"] is None:
        del shown["summary"]
    shown["parts"] = table_of_contents(
        {**part_counts(conn, str(row["work_item_id"]), lease), **(counted or {})}
    )
    return shown


def card_step(step: Mapping[str, object]) -> dict:
    """A step as the card carries it: its id, text and whether it is done, and each mark set."""

    return {
        "id": step["id"],
        "text": step["text"],
        "done": step["done"],
        **{mark: step[mark] for mark in CARD_STEP_MARKS if step.get(mark)},
    }


def _parent_reference(conn: sqlite3.Connection, parent_id: object) -> str | None:
    if not parent_id:
        return None
    found = conn.execute(
        "SELECT p.key, i.number FROM work_items i JOIN planning_spaces p"
        " ON p.planning_space_id = i.planning_space_id WHERE i.work_item_id = ?",
        (str(parent_id),),
    ).fetchone()
    if found is None:
        raise model.PlanningError("work item disappeared mid-write")
    return model.human_id(str(found[0]), int(found[1]))


def table_of_contents(counts: Mapping[str, Mapping[str, int]]) -> dict:
    """Every part an item has but the card, in the order of `PARTS`, each with its counts.

    A part with nothing in it is left out, so the card names only what there is to read.
    """

    return {
        name: dict(counts[name])
        for name in PARTS
        if name != "card" and name in counts and int(counts[name].get("count", 0)) > 0
    }


#: Which calls name a session behind the writes to item `:id`; `sessions` lists them.
_SESSION_CALLS = (
    " FROM execution_events WHERE kind = :kind AND work_item_id = :id"
    " AND identity_state = :confirmed AND COALESCE(session_id, '') != ''"
)


def _session_calls(identity: str) -> dict[str, str]:
    """The values `_SESSION_CALLS` names."""

    return {"id": identity, "kind": calls.KIND, "confirmed": calls.CONFIRMED}


def part_counts(
    conn: sqlite3.Connection, identity: str, lease: leases.Lease | None
) -> dict[str, dict[str, int]]:
    """How much an item has of each part but its questions, in one statement of aggregates.

    Each count is the one reading the part answers with: the totals of `comments`
    and `events`, the length of the rest. The followers are counted by reading
    them, since whether one has lapsed is decided outside the store.
    """

    found = conn.execute(
        "SELECT COUNT(*),"  # noqa: S608 - constant text
        " COALESCE(SUM(reply_to IS NULL AND reply_to_request IS NULL), 0),"
        " COALESCE(SUM(reply_to IS NULL AND reply_to_request IS NULL AND resolved_at IS NULL), 0),"
        " COALESCE(SUM(length(body) + COALESCE(length(report), 0)), 0),"
        " (SELECT COUNT(*) FROM work_item_events WHERE work_item_id = :id),"
        " (SELECT COALESCE(SUM(length(detail)), 0) FROM work_item_events"
        "  WHERE work_item_id = :id),"
        " (SELECT COUNT(*) FROM work_item_links WHERE from_id = :id)"
        " + (SELECT COUNT(*) FROM work_item_links WHERE to_id = :id),"
        " (SELECT COUNT(*) FROM work_item_refs WHERE work_item_id = :id),"
        " (SELECT COUNT(*) FROM work_item_events WHERE work_item_id = :id"
        "  AND action = 'mentioned'),"
        " (SELECT COUNT(DISTINCT session_id)" + _SESSION_CALLS + "),"
        " (SELECT COUNT(*) FROM work_item_images WHERE work_item_id = :id)"
        " FROM work_item_comments WHERE work_item_id = :id",
        _session_calls(identity),
    ).fetchone()
    (
        comments,
        roots,
        unresolved,
        said,
        events,
        detail,
        linked,
        pointed,
        named,
        writers,
        pictures,
    ) = (int(value) for value in found)
    return {
        "comments": {
            "count": comments,
            "threads": roots,
            "unresolved": unresolved,
            "chars": said,
        },
        "events": {"count": events, "chars": detail},
        "links": {"count": linked},
        "refs": {"count": pointed},
        "mentions": {"count": named},
        "sessions": {"count": writers},
        "images": {"count": pictures},
        "subscribers": {"count": len(subscriptions.subscribers(conn, identity))},
        "claim": {"count": 0 if lease is None else 1},
    }


def comments_part(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    comments_after: int | None = None,
    thread: int | None = None,
    unresolved: bool = False,
) -> dict:
    """The comments part: the newest threads, or the cut a comment mode names.

    Without a mode it is the `PART_THREADS` threads with the newest activity.
    `comments_after` alone is one flat page of `COMMENTS_PAGE` comments after that
    id, roots and replies in the order written, 0 starting from the first; beside
    `unresolved` it is where that page of roots starts. `truncated` says the cut
    leaves out what it would have shown with more room: older threads, or a next
    page.
    """

    identity = str(row["work_item_id"])
    # Any `comments_after`, 0 too, is a page start a thread read cannot take.
    _exclusive(thread=thread, comments_after=comments_after)
    if comments_after is not None and not unresolved:
        page, more = _comments_page(conn, identity, comments_after)
        return {"comments": page, **_thread_counts(conn, identity), "truncated": more}
    newest = thread is None and comments_after is None and not unresolved
    found, shown, more = _cut_comments(
        conn,
        identity,
        reference(conn, row),
        comments_after=comments_after or 0,
        threads=PART_THREADS if newest else None,
        thread=thread,
        unresolved=unresolved,
    )
    counts = _thread_counts(conn, identity)
    if more is None:
        more = newest and shown is not None and shown < counts["threads_total"]
    return {"comments": found, **counts, "truncated": more}


def _comments_page(conn: sqlite3.Connection, identity: str, after: int) -> tuple[list[dict], bool]:
    """The first `COMMENTS_PAGE` comments after `after`, oldest first, and whether more follow.

    Read one past its size, so whether more remain is known rather than guessed.
    """

    rows = conn.execute(
        _COMMENT_ROWS + " WHERE m.work_item_id = ? AND m.id > ? ORDER BY m.id LIMIT ?",
        (identity, after, COMMENTS_PAGE + 1),
    ).fetchall()
    page = with_mentions(conn, [comment_record(item) for item in rows[:COMMENTS_PAGE]])
    return page, len(rows) > COMMENTS_PAGE


def claim(conn: sqlite3.Connection, row: sqlite3.Row) -> dict | None:
    """The lease on the item as the full record carries it, or None while nobody holds it."""

    lease = leases.lease(conn, row)
    return None if lease is None else lease.as_dict()


def events_part(conn: sqlite3.Connection, row: sqlite3.Row, newest: int | None = None) -> dict:
    """The events part: the `newest` events, `PART_EVENTS` unless named, oldest first.

    Beside them how many there are, and `events_truncated` when some are left out:
    a flag of its own, so that read beside the comments part it says which of the
    two was cut.
    """

    identity = str(row["work_item_id"])
    found = _events(conn, identity, PART_EVENTS if newest is None else events_count(newest))
    total = _events_total(conn, identity)
    return {"events": found, "events_total": total, "events_truncated": len(found) < total}


def events_count(value: object) -> int:
    """How many newest events a read of the events part names: 1 to `PART_EVENTS_MOST`.

    An integer, never a boolean or text: the HTTP boundary reads its parameter as a
    number first, so both surfaces are held to the one range with the one refusal.
    """

    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= PART_EVENTS_MOST:
        raise model.PlanningError(f"events must be between 1 and {PART_EVENTS_MOST}")
    return value


def refs(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    """The pointers attached to an item, in the order they were attached."""

    return [
        {
            "kind": ref["kind"],
            "value": ref["value"],
            "label": ref["label"],
            "author": ref["author"],
            "at": ref["created_at"],
        }
        for ref in conn.execute(
            "SELECT * FROM work_item_refs WHERE work_item_id = ? ORDER BY id", (work_item_id,)
        )
    ]


def _cut_comments(
    conn: sqlite3.Connection,
    identity: str,
    reference_text: str,
    *,
    comments: int | None = None,
    comments_after: int = 0,
    threads: int | None = None,
    thread: int | None = None,
    unresolved: bool = False,
) -> tuple[list[dict], int | None, bool | None]:
    """An item's comments as one cut of them reads, as `present` names the cuts.

    Beside them, how many threads the cut shows, or None for a flat read of rows,
    and whether an unresolved page leaves more after it, or None for any other cut.
    """

    # A count may narrow `comments_after`; a thread read takes neither. An unresolved
    # read takes `comments_after` as where its next page starts, and no count.
    after = comments_after or None
    marks = unresolved or None
    if thread is not None:
        _exclusive(
            thread=thread,
            threads=threads,
            comments=comments,
            comments_after=after,
            unresolved=marks,
        )
    if threads is not None:
        _exclusive(threads=threads, comments=comments, comments_after=after, unresolved=marks)
    if unresolved:
        _exclusive(unresolved=marks, comments=comments)
    if thread is not None:
        return _one_thread(conn, identity, reference_text, thread), 1, None
    if threads is not None:
        found = _newest_threads(conn, identity, threads)
        return found, len(found), None
    if unresolved:
        found, more = _unresolved_threads(conn, identity, comments_after)
        return found, len(found), more
    flat = with_mentions(
        conn,
        [
            comment_record(item)
            for item in _newest(
                conn,
                _COMMENT_ROWS + " WHERE m.work_item_id = ? AND m.id > ?",
                "m.id",
                (identity, comments_after),
                comments,
            )
        ],
    )
    return flat, None, None


def _events(conn: sqlite3.Connection, identity: str, limit: int | None) -> list[dict]:
    """An item's history, oldest first: every event, or only the newest `limit`."""

    return [
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
            limit,
        )
    ]


def _events_total(conn: sqlite3.Connection, identity: str) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ?", (identity,)
        ).fetchone()[0]
    )


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
        "SELECT session_id, client, identity_source, received_at" + _SESSION_CALLS + " ORDER BY id",
        _session_calls(work_item_id),
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
