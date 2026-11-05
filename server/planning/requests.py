"""Durable human requests with independent revisions and read-only expiry."""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Iterator

from . import calls, model, read_model, request_model, service

#: How many questions a read of one item carries; `questions.total` says the rest.
ITEM_QUESTIONS = 5


@contextlib.contextmanager
def _transaction(conn: sqlite3.Connection) -> Iterator[None]:
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    conn.execute("SAVEPOINT planning_request")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK TO planning_request")
        conn.execute("RELEASE planning_request")
        raise
    conn.execute("RELEASE planning_request")


def _row(conn: sqlite3.Connection, identity: object) -> sqlite3.Row:
    request_id = model.identifier(identity, "request_id")
    row = conn.execute(
        "SELECT * FROM work_item_requests WHERE request_id=?", (request_id,)
    ).fetchone()
    if row is None:
        raise model.PlanningError("that request does not exist")
    return row


def _expired(conn: sqlite3.Connection, row: sqlite3.Row, at: str) -> str | None:
    if row["status"] != "pending":
        return row["expired_reason"]
    if row["expires_at"] and row["expires_at"] <= at:
        return "deadline"
    item = read_model.item_by_id(conn, row["work_item_id"])
    if read_model.state_by_id(conn, item["state_id"])["is_terminal"]:
        return "task_closed"
    if row["execution_id"]:
        execution = conn.execute(
            "SELECT ended_at,status FROM executions WHERE execution_id=?", (row["execution_id"],)
        ).fetchone()
        if (
            execution is None
            or execution["ended_at"]
            or execution["status"] not in {"starting", "running"}
        ):
            return "execution_closed"
    return None


def _present(conn: sqlite3.Connection, row: sqlite3.Row, at: str) -> dict:
    item = read_model.item_by_id(conn, row["work_item_id"])
    reason = _expired(conn, row, at)
    parts = request_model.split_answers(
        json.loads(row["answers_json"]) if row["answers_json"] is not None else None
    )
    # `in` on a row reads its values, so its column names are asked for by name.
    columns = row.keys()
    return {
        "request_id": row["request_id"],
        "work_item_id": row["work_item_id"],
        "reference": read_model.reference(conn, item),
        "title": item["title"],
        "kind": row["kind"],
        "prompt": row["prompt"],
        "fields": json.loads(row["fields_json"]),
        "answers": parts["answers"],
        "own": parts["own"],
        "field_notes": parts["field_notes"],
        "note": parts["note"],
        # An attached store from before answers had versions is read as it is:
        # what it answered, it answered once.
        "answer_version": int(row["answer_version"])
        if "answer_version" in columns
        else int(row["status"] == "answered"),
        "status": "expired" if reason else row["status"],
        "author": row["author"],
        "answered_by": row["answered_by"],
        "execution_id": row["execution_id"],
        "session_id": row["session_id"],
        "expires_at": row["expires_at"],
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"],
        "revision": int(row["revision"]),
        "expired_reason": reason,
        # The comment a list stands under; an attached store from before lists has none.
        "comment_id": row["comment_id"] if "comment_id" in columns else None,
    }


def get(conn: sqlite3.Connection, identity: object, *, replies: bool = False) -> dict:
    """One whole request; with `replies`, also every reply in its thread, oldest first.

    Only the agent's read asks for the thread: the interface and an export read
    those replies among the item's comments, and a strict reader of the interface
    refuses a key it does not know.
    """

    [record] = _complete(conn, [_present(conn, _row(conn, identity), request_model.now())])
    if not replies:
        return record
    # A store older than question threads has no reply to read.
    thread = (
        read_model.request_replies(conn, record["request_id"])
        if _has_table(conn, "work_item_request_answers")
        else []
    )
    return {**record, "replies": thread}


def _has_table(conn: sqlite3.Connection, name: str) -> bool:
    """Whether a store has a table. An attached store is read as it is, and an older
    one lacks what later schemas added: it has nothing of that to say."""

    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """Whether a table has a column, for the same reason as `_has_table`."""

    return (
        conn.execute("SELECT 1 FROM pragma_table_info(?) WHERE name=?", (table, column)).fetchone()
        is not None
    )


def _complete(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Requests with who closed each one and the answers each current one replaced."""

    return _with_history(conn, _with_by_person(conn, records))


def _with_by_person(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Requests with whether the latest call that closed or changed each came through the interface.

    True for a browser write, false for any other call that answered, changed,
    declined or withdrew it, and null while no call has: still open, run out by
    itself, or written with no call, as on a comment. The latest such event
    decides, so a changed answer is the changer's. The `author` beside it is text
    the caller wrote and says nothing here; the fact stays once, on the call row.
    One statement for every request of a read.
    """

    closed = [record["request_id"] for record in records if record["resolved_at"] is not None]
    sources: dict[str, object] = {}
    # One from before calls were recorded has no such row to read: nothing there
    # came through a call anyone proved.
    if closed and _has_table(conn, "execution_events"):
        # By the request rather than its item: a merge moves a request and leaves
        # its history where it was written. A call row that is there always has a
        # source, so a join that found none means no call.
        sources = {
            str(row["detail"]): row["identity_source"]
            for row in conn.execute(
                "SELECT e.detail, c.identity_source FROM work_item_events e"
                " LEFT JOIN execution_events c ON c.id = e.call_id"
                " WHERE e.id IN (SELECT MAX(id) FROM work_item_events"
                " WHERE action IN"
                " ('request_answered','request_changed','request_declined','request_expired')"
                " AND detail IN (SELECT value FROM json_each(?)) GROUP BY detail)",
                (json.dumps(closed),),
            )
        }
    return [
        {**record, "by_person": _through_interface(sources.get(record["request_id"]))}
        for record in records
    ]


def _through_interface(source: object) -> bool | None:
    """Whether a call of this source came through the interface; null with no call."""

    return None if source is None else source == calls.BROWSER


def _with_history(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Requests with the answers each current answer replaced, oldest first.

    Each version is read as the current answer is, with `by_person` from the
    call that gave it, and null, as on a comment, for a version no call gave.
    One statement for every request of a read.
    """

    versions: dict[str, list[dict]] = {}
    changed = [record["request_id"] for record in records if record["answer_version"] >= 2]
    if changed and _has_table(conn, "work_item_request_answers"):
        for row in conn.execute(
            "SELECT a.request_id, a.version, a.answers_json, a.answered_by, a.answered_at,"
            " a.call_id, c.identity_source FROM work_item_request_answers a"
            " LEFT JOIN execution_events c ON c.id = a.call_id"
            " WHERE a.request_id IN (SELECT value FROM json_each(?))"
            " ORDER BY a.request_id, a.version",
            (json.dumps(changed),),
        ):
            versions.setdefault(str(row["request_id"]), []).append(
                {
                    "version": int(row["version"]),
                    **request_model.split_answers(json.loads(row["answers_json"])),
                    "answered_by": row["answered_by"],
                    "answered_at": row["answered_at"],
                    "by_person": None
                    if row["call_id"] is None
                    else row["identity_source"] == calls.BROWSER,
                }
            )
    return [{**record, "history": versions.get(record["request_id"], [])} for record in records]


def compact_all(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Requests in the compact form, each with how many replies its thread has and the latest.

    One statement for every request of a read.
    """

    identities = [record["request_id"] for record in records]
    threads = (
        read_model.request_threads(conn, identities)
        if identities and _has_table(conn, "work_item_request_answers")
        else {}
    )
    shown = []
    for record in records:
        replies, newest = threads.get(record["request_id"], (0, None))
        shown.append(
            request_model.compact(record, replies=replies, last_reply=read_model.last_reply(newest))
        )
    return shown


def of_item(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    """Every request on one item, newest first and with no page limit."""

    at = request_model.now()
    return _complete(
        conn,
        [
            _present(conn, row, at)
            for row in conn.execute(
                "SELECT * FROM work_item_requests WHERE work_item_id=?"
                " ORDER BY created_at DESC,request_id",
                (work_item_id,),
            ).fetchall()
        ],
    )


def item_questions(conn: sqlite3.Connection, work_item_id: str) -> dict:
    """What an agent reading an item learns of its questions without another call.

    Open ones first, because they are what is waiting, then the newest closed;
    how many there are in all and whether this is all of them.
    """

    found = of_item(conn, work_item_id)
    waiting = [record for record in found if record["status"] == "pending"]
    closed = sorted(
        (record for record in found if record["status"] != "pending"),
        key=lambda record: record["resolved_at"] or record["created_at"],
        reverse=True,
    )
    shown = (waiting + closed)[:ITEM_QUESTIONS]
    return {
        "total": len(found),
        "open": len(waiting),
        "items": compact_all(conn, shown),
        "truncated": len(shown) < len(found),
    }


def list_requests(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    status: str | None = None,
    limit: int = 100,
    reference: str | None = None,
    lists: bool = True,
) -> list[dict]:
    """One page of requests, newest first, for a reader that asks for what it can draw."""

    return list_page(
        conn, space=space, status=status, limit=limit, reference=reference, lists=lists
    )["requests"]


def list_page(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
    reference: str | None = None,
    answered_after: object = None,
    lists: bool = True,
) -> dict:
    """One page of requests, and whether more follow.

    Newest first, or, asked for what was answered after a time, oldest answer first
    by `resolved_at` and then `request_id`, so a reader that keeps the last time it
    read moves forward through them. Such a page never ends between two answers of
    one time: it runs past `limit` by the tie, because the next page starts after
    that time and would otherwise skip the other one.

    `lists=False` leaves out every list on a comment: a reader of what waits for a
    person, which nobody waits on a list for.
    """

    if status is not None:
        model.enum_field(status, request_model.STATUSES, "status")
    clauses: list[str] = []
    parameters: list[object] = []
    if space is not None:
        clauses.append("i.planning_space_id=?")
        parameters.append(service.get_planning_space(conn, space)["planning_space_id"])
    if reference is not None:
        item = read_model.item_row(conn, reference)
        if space is not None and item["planning_space_id"] != parameters[0]:
            raise model.PlanningError("work item is outside the exact planning space")
        clauses.append("r.work_item_id=?")
        parameters.append(item["work_item_id"])
    after = request_model.timestamp(answered_after, "answered_after")
    if after is not None:
        # `resolved_at` of an answered row is when its current answer was given,
        # so a change comes again after the time a reader kept; it has the one
        # format `now` writes.
        clauses.append("r.status='answered' AND r.resolved_at>?")
        parameters.append(after)
    if not lists and _has_column(conn, "work_item_requests", "comment_id"):
        clauses.append("r.comment_id IS NULL")
    # Effective expiry depends on item/execution state. Filter after projection,
    # fetching in pages so terminal history cannot hide a pending request.
    query = service.with_clauses(
        "SELECT r.* FROM work_item_requests r JOIN work_items i ON i.work_item_id=r.work_item_id",
        clauses,
    )
    query += (
        " ORDER BY r.resolved_at,r.request_id LIMIT ? OFFSET ?"
        if after is not None
        else " ORDER BY r.created_at DESC,r.request_id LIMIT ? OFFSET ?"
    )
    bounded = max(1, min(int(limit), 201))
    start = model.count_field(offset, "offset")
    result: list[dict] = []
    at = request_model.now()
    seen = 0
    fetched = 0
    more = False
    while not more:
        rows = conn.execute(query, (*parameters, 200, fetched)).fetchall()
        for row in rows:
            presented = _present(conn, row, at)
            if status is not None and presented["status"] != status:
                continue
            seen += 1
            if seen <= start:
                continue
            if len(result) >= bounded and not (
                after is not None and presented["resolved_at"] == result[-1]["resolved_at"]
            ):
                more = True
                break
            result.append(presented)
        if len(rows) < 200:
            break
        fetched += 200
    return {
        "requests": _complete(conn, result),
        "truncated": more,
        "next_offset": start + len(result) if more else None,
    }


def _bindings(
    conn: sqlite3.Connection, item: sqlite3.Row, execution_id: object, session_id: object
) -> tuple[str | None, str | None]:
    execution = None
    session = None
    if execution_id is not None:
        execution = model.text_field(execution_id, "execution_id", limit=128)
        row = conn.execute(
            "SELECT work_item_id FROM executions WHERE execution_id=?", (execution,)
        ).fetchone()
        if row is None or row["work_item_id"] != item["work_item_id"]:
            raise model.PlanningError("execution must belong to this work item")
    if session_id is not None:
        session = model.text_field(session_id, "session_id", limit=128)
        exists = conn.execute("SELECT 1 FROM sessions WHERE id=?", (session,)).fetchone()
        linked = conn.execute(
            "SELECT 1 FROM execution_sessions l JOIN executions e ON e.execution_id=l.execution_id WHERE l.session_id=? AND e.work_item_id=?",
            (session, item["work_item_id"]),
        ).fetchone()
        direct = conn.execute(
            "SELECT 1 FROM sessions WHERE id=? AND work_item_id=?",
            (session, item["work_item_id"]),
        ).fetchone()
        ref = conn.execute(
            "SELECT 1 FROM work_item_refs WHERE work_item_id=? AND kind='session' AND value=?",
            (item["work_item_id"], session),
        ).fetchone()
        if exists is None or not (linked or direct or ref):
            raise model.PlanningError(
                "session must be an exact stored identity associated with this item"
            )
        if (
            execution
            and conn.execute(
                "SELECT 1 FROM execution_sessions WHERE execution_id=? AND session_id=?",
                (execution, session),
            ).fetchone()
            is None
        ):
            raise model.PlanningError("session must belong to the bound execution")
    return execution, session


def create(
    conn: sqlite3.Connection,
    reference: str,
    *,
    kind: object,
    prompt: object,
    fields: object,
    author: str | None = None,
    execution_id: object = None,
    session_id: object = None,
    expires_at: object = None,
) -> dict:
    identity = model.new_id()
    parsed_kind = model.enum_field(kind, frozenset({"question", "decision"}), "kind")
    parsed_prompt = model.multiline_field(prompt, "prompt", limit=8000)
    if not parsed_prompt:
        raise model.PlanningError("prompt is required")
    parsed_fields = request_model.fields(fields)
    deadline = request_model.timestamp(expires_at)
    with _transaction(conn):
        item = read_model.item_row(conn, reference)
        execution, session = _bindings(conn, item, execution_id, session_id)
        at = request_model.now()
        conn.execute(
            "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,author,execution_id,session_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                identity,
                item["work_item_id"],
                parsed_kind,
                parsed_prompt,
                model.dumps(parsed_fields),
                model.actor(author),
                execution,
                session,
                deadline,
                at,
            ),
        )
        if _expired(conn, _row(conn, identity), at):
            raise model.PlanningError(
                "a request requires a live work item, live execution and future deadline"
            )
        _event(conn, item["work_item_id"], "request_created", identity, author)
    return get(conn, identity)


#: The most options a list on a comment offers: as many as a question's field.
MAX_LIST_OPTIONS = 20
#: The id of a list's one field, which its answer is keyed under: `{"items": [...]}`.
LIST_FIELD = "items"


def list_question(value: object) -> tuple[str, list[dict]]:
    """A list as its question stores it: the label as the prompt, and one `multi_choice` field.

    A list is a question that stands under a comment, so its options are a
    question's options and are checked by the same rules. Read before anything is
    written, so a refused list leaves no comment behind either.
    """

    if (
        not isinstance(value, dict)
        or set(value) != {"label", "options"}
        or not isinstance(value["options"], list)
        or not 1 <= len(value["options"]) <= MAX_LIST_OPTIONS
    ):
        raise model.PlanningError("list requires label and options and takes nothing else")
    label = model.text_field(value["label"], "list.label", limit=200)
    field = {
        "id": LIST_FIELD,
        "label": label,
        "type": "multi_choice",
        "required": False,
        "options": value["options"],
    }
    return label, request_model.fields([field])


def create_list(
    conn: sqlite3.Connection,
    work_item_id: str,
    comment_id: int,
    question: tuple[str, list[dict]],
    author: str | None = None,
) -> str:
    """Put a list under a root comment of its item; the answer is the list's request id.

    Written by the call that wrote the comment, inside its transaction, so the two
    are one write. A closed item takes none: it would read `expired` from the
    start, and a list there could only be ticked after the item reopened.
    """

    prompt, fields = question
    identity = model.new_id()
    with _transaction(conn):
        item = read_model.item_by_id(conn, work_item_id)
        if read_model.state_by_id(conn, item["state_id"])["is_terminal"]:
            raise model.PlanningError(
                "a list on a closed item could never be answered; reopen it first,"
                " or leave the list out"
            )
        conn.execute(
            "INSERT INTO work_item_requests(request_id,work_item_id,comment_id,kind,prompt,"
            "fields_json,author,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                identity,
                work_item_id,
                comment_id,
                "question",
                prompt,
                model.dumps(fields),
                model.actor(author),
                request_model.now(),
            ),
        )
        _event(conn, work_item_id, "request_created", identity, author)
    return identity


def resolve(
    conn: sqlite3.Connection,
    identity: str,
    *,
    status: str,
    expected_revision: object,
    answers: object = None,
    own: object = None,
    field_notes: object = None,
    note: object = None,
    author: str | None = None,
) -> dict:
    """Close a pending request: answer it, decline it or withdraw it, once.

    The first answer is version 1 of the answer; declining or withdrawing gives none.
    """

    expected_revision = model.count_field(expected_revision, "expected_revision")
    model.enum_field(status, frozenset({"answered", "declined", "expired"}), "status")
    said = _note(note)
    with _transaction(conn):
        row = _row(conn, identity)
        if row["revision"] != expected_revision:
            raise model.RevisionConflictError(expected_revision, row["revision"])
        at = request_model.now()
        if row["status"] != "pending" or _expired(conn, row, at):
            raise model.WorkflowGuardError("request is no longer pending")
        parsed = _stored(row, answers, own, field_notes, said) if status == "answered" else None
        changed = conn.execute(
            "UPDATE work_item_requests SET status=?,answers_json=?,answered_by=?,resolved_at=?,expired_reason=?,answer_version=?,revision=revision+1 WHERE request_id=? AND revision=? AND status='pending' AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))",
            (
                status,
                model.dumps(parsed) if parsed is not None else None,
                model.actor(author),
                at,
                "withdrawn" if status == "expired" else None,
                1 if parsed is not None else 0,
                identity,
                expected_revision,
            ),
        )
        if changed.rowcount != 1:
            raise model.WorkflowGuardError("request is no longer pending")
        _event(conn, row["work_item_id"], f"request_{status}", identity, author)
    return get(conn, identity)


def change(
    conn: sqlite3.Connection,
    identity: str,
    *,
    expected_revision: object,
    answers: object,
    own: object = None,
    field_notes: object = None,
    note: object = None,
    author: str | None = None,
) -> dict:
    """Replace the answer to an answered question, keeping the replaced one as a version.

    Held to the rules of a first answer. Refused for a question that is not
    answered, on a closed item (nobody is left to act on the change), when nothing
    differs from the current answer, and past `MAX_ANSWER_VERSIONS`. The current
    answer stays on the request row and moves `resolved_at`, so a reader of what
    was answered after a time finds the change; the replaced one keeps the call
    that gave it.
    """

    expected_revision = model.count_field(expected_revision, "expected_revision")
    said = _note(note)
    with _transaction(conn):
        row = _row(conn, identity)
        if row["revision"] != expected_revision:
            raise model.RevisionConflictError(expected_revision, row["revision"])
        if row["status"] != "answered":
            raise model.WorkflowGuardError("only an answered question's answer can be changed")
        item = read_model.item_by_id(conn, row["work_item_id"])
        if read_model.state_by_id(conn, item["state_id"])["is_terminal"]:
            raise model.WorkflowGuardError(
                "[task_closed] the work item is closed; reopen it to change the answer"
            )
        version = int(row["answer_version"])
        if version >= request_model.MAX_ANSWER_VERSIONS:
            raise model.WorkflowGuardError(
                f"[answer_versions] an answer has at most {request_model.MAX_ANSWER_VERSIONS}"
                " versions, and this one has them all"
            )
        parsed = _stored(row, answers, own, field_notes, said)
        if request_model.same_answer(
            json.loads(row["fields_json"]), parsed, json.loads(row["answers_json"])
        ):
            raise model.PlanningError("[unchanged] that is the answer already given")
        given = conn.execute(
            "SELECT call_id FROM work_item_events WHERE detail=?"
            " AND action IN ('request_answered','request_changed') ORDER BY id DESC LIMIT 1",
            (row["request_id"],),
        ).fetchone()
        conn.execute(
            "INSERT INTO work_item_request_answers(request_id,version,answers_json,answered_by,"
            "answered_at,call_id) VALUES(?,?,?,?,?,?)",
            (
                row["request_id"],
                version,
                row["answers_json"],
                row["answered_by"],
                row["resolved_at"],
                given[0] if given is not None else None,
            ),
        )
        changed = conn.execute(
            "UPDATE work_item_requests SET answers_json=?,answered_by=?,resolved_at=?,"
            "answer_version=answer_version+1,revision=revision+1"
            " WHERE request_id=? AND revision=? AND status='answered'",
            (
                model.dumps(parsed),
                model.actor(author),
                request_model.now(),
                row["request_id"],
                expected_revision,
            ),
        )
        if changed.rowcount != 1:  # pragma: no cover - the row was read under the write lock
            raise model.WorkflowGuardError("only an answered question's answer can be changed")
        _event(conn, row["work_item_id"], "request_changed", row["request_id"], author)
    return get(conn, row["request_id"])


def _note(note: object) -> str:
    """The comment on the whole question, or nothing."""

    return (
        model.multiline_field(note, "note", limit=request_model.MAX_NOTE)
        if note is not None
        else ""
    )


def _stored(row: sqlite3.Row, answers: object, own: object, field_notes: object, note: str) -> dict:
    """An answer as `answers_json` holds it, every part checked against the question's fields."""

    descriptors = json.loads(row["fields_json"])
    variants = request_model.per_field(own, descriptors, "own", limit=request_model.MAX_OWN)
    comments = request_model.per_field(
        field_notes, descriptors, "field_notes", limit=request_model.MAX_FIELD_NOTE
    )
    return request_model.stored_answers(
        request_model.answers(answers, descriptors, own=variants, field_notes=comments),
        note,
        own=variants,
        field_notes=comments,
    )


def open_rows(conn: sqlite3.Connection, work_item_id: str | None = None) -> list[sqlite3.Row]:
    """The questions still open for a person to answer, on one item or everywhere in this store.

    Open as a reader sees it: a pending row past its deadline, on a closed item or
    on a finished execution has lapsed although nothing wrote that down. A list on
    a comment is never one: nobody waits for it, so it raises no alert and holds
    none up.
    """

    query = "SELECT * FROM work_item_requests WHERE status='pending' AND comment_id IS NULL"
    parameters: tuple[str, ...] = ()
    if work_item_id is not None:
        query += " AND work_item_id=?"
        parameters = (work_item_id,)
    at = request_model.now()
    return [
        row for row in conn.execute(query, parameters).fetchall() if not _expired(conn, row, at)
    ]


def _event(
    conn: sqlite3.Connection, work_item_id: str, action: str, request_id: str, author: str | None
) -> None:
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id) VALUES(?,?,?,?,?)",
        (
            work_item_id,
            model.event_action(action),
            request_id,
            model.actor(author),
            calls.call_id(conn, work_item_id),
        ),
    )
