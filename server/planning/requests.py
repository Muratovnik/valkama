"""Durable requests with independent revisions and read-only expiry.

A request asks the owner, or, with an `addressee`, one top-level agent session
(`ask_sessions`). Only that session answers or declines one asked of it, from its
conversation or any of its subagents, and only the session that asked it, or Valkama,
withdraws it. A session that ended or went quiet past its lease answers nothing: its
requests read expired with `session_gone` while it stays so, and wait again when it
resumes. That reason is read, never stored, as `deadline` is. Closing the item ends
every request still pending on it, stored as done or cancelled (`questions.end`).

A question with a purpose, such as the one a move into review asks, is the owner's
to answer, in Valkama; its answer is carried out in the write that gives it
(`carry_out`), so it is never declined or changed, and only the session that asked
it withdraws it.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Iterator

from . import (
    calls,
    closing,
    deferral,
    leases,
    model,
    questions,
    read_model,
    request_model,
    service,
    states,
    waiting,
    words,
)

#: How many questions a read of one item carries; `questions.total` says the rest.
ITEM_QUESTIONS = 5
#: How many sessions an agent's call asks at once (`addressees`).
MOST_ADDRESSEES = 5
#: How often one session may ask one other session within the hour.
MOST_ASKS_PER_HOUR = 3

#: The requests one session's confirmed calls asked of one other session within the last
#: hour, counted by their `request_created` events: from the requests asked of that
#: session, each event found among its item's.
_ASKED_THIS_HOUR = (
    "SELECT COUNT(*) FROM work_item_requests r"
    " JOIN work_item_events e ON e.work_item_id = r.work_item_id"
    " AND e.action = 'request_created' AND e.detail = r.request_id"
    " JOIN execution_events c ON c.id = e.call_id"
    " WHERE r.addressee = ? AND c.session_id = ? AND c.identity_state = ?"
    " AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')"
)


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
    """Why a request no longer waits for an answer, or None while it still does.

    What lapses any request is `questions.lapse`; a request asked of an agent
    session lapses as well while that session is gone (`session_gone`), read
    rather than written, so it waits again once the session is back.
    """

    reason = questions.expired(conn, str(row["request_id"]), at)
    if reason is not None:
        return reason
    addressee = _addressee(row)
    if addressee is not None and not leases.session_live(
        conn.execute(
            "SELECT status, ended_at, last_seen FROM sessions WHERE id=?", (addressee,)
        ).fetchone()
    ):
        return "session_gone"
    return None


def _addressee(row: sqlite3.Row) -> str | None:
    """The agent session a request row asks; None for the owner, as on a store from before."""

    # `in` on a row reads its values, so its column names are asked for by name.
    columns = row.keys()
    return row["addressee"] if "addressee" in columns else None


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
        # The agent session asked instead of the owner; an attached store from before
        # such requests has none.
        "addressee": _addressee(row),
        "expires_at": row["expires_at"],
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"],
        "revision": int(row["revision"]),
        "expired_reason": reason,
        # The comment a list stands under; an attached store from before lists has none.
        "comment_id": row["comment_id"] if "comment_id" in columns else None,
        # What the owner's answer carries out; an attached store from before has none.
        "purpose": row["purpose"] if "purpose" in columns else None,
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


def _complete(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
    """Requests with who closed each one and the answers each current one replaced."""

    return _with_history(conn, with_by_person(conn, records))


def with_by_person(conn: sqlite3.Connection, records: list[dict]) -> list[dict]:
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
    how many there are in all and whether this is all of them. A request asked of
    an agent session is left out, and `addressed_open` counts the open ones: that
    session reads them, and they would take the places of the owner's questions.
    """

    every = of_item(conn, work_item_id)
    found = [record for record in every if record["addressee"] is None]
    addressed_open = sum(
        1 for record in every if record["addressee"] is not None and record["status"] == "pending"
    )
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
        "addressed_open": addressed_open,
    }


def question_counts(conn: sqlite3.Connection, work_item_id: str) -> dict[str, int]:
    """How many questions `item_questions` counts on one item, how many are open, and
    how many requests asked of agent sessions are open (`addressed_open`).

    Counted rather than read: only a pending row can be open, and only it is read,
    to ask whether it has lapsed as `item_questions` would.
    """

    total = int(
        conn.execute(
            "SELECT COUNT(*) FROM work_item_requests WHERE work_item_id=? AND addressee IS NULL",
            (work_item_id,),
        ).fetchone()[0]
    )
    at = request_model.now()
    waiting = [
        row
        for row in conn.execute(
            "SELECT * FROM work_item_requests WHERE work_item_id=? AND status='pending'",
            (work_item_id,),
        ).fetchall()
        if not _expired(conn, row, at)
    ]
    return {
        "count": total,
        "open": sum(_addressee(row) is None for row in waiting),
        "addressed_open": sum(_addressee(row) is not None for row in waiting),
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
    addressed: bool = False,
    session: str | None = None,
) -> dict:
    """One page of requests, and whether more follow.

    Newest first, or, asked for what was answered after a time, oldest answer first
    by `resolved_at` and then `request_id`, so a reader that keeps the last time it
    read moves forward through them. Such a page never ends between two answers of
    one time: it runs past `limit` by the tie, because the next page starts after
    that time and would otherwise skip the other one.

    A request asked of an agent session is left out. `lists=False` leaves out every
    list on a comment as well: a reader of what waits for a person, which nobody waits
    on a list for. `addressed=True` reads instead the open requests asked of the
    session the call in progress proved, and refuses a call that proved none.
    `session` names that session instead, for a reader with no call of its own, the
    note a session start gets (`waiting_items`); no surface passes it.
    """

    if status is not None:
        model.enum_field(status, request_model.STATUSES, "status")
    clauses: list[str] = []
    parameters: list[object] = []
    if addressed:
        if status not in (None, "pending"):
            raise model.PlanningError("addressed lists the open requests; leave status out")
        status = "pending"
        clauses.append("r.addressee=?")
        parameters.append(_own_session() if session is None else session)
    if space is not None:
        clauses.append("i.planning_space_id=?")
        parameters.append(service.space_identity(conn, space))
    if reference is not None:
        item = read_model.item_row(conn, reference)
        if space is not None and item["planning_space_id"] != parameters[-1]:
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
    if not addressed:
        clauses.append(questions.OWNER_ASKED if not lists else "r.addressee IS NULL")
    # Effective expiry depends on item/execution state. Filter after projection,
    # fetching in pages so terminal history cannot hide a pending request.
    query = service.with_clauses(
        f"SELECT r.* FROM {_requests_table(conn)} r"  # noqa: S608 - column names, no value
        " JOIN work_items i ON i.work_item_id=r.work_item_id",
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


def waiting_items(conn: sqlite3.Connection, session: str) -> list[str]:
    """The items with an open request asked of `session`, by reference, each once.

    The item of the newest such request comes first. The requests are those
    `list_page` reads with `addressed`, asked of `session` rather than of a call's
    proved session, which the hook of a session start does not have.
    """

    found: dict[str, None] = {}
    offset = 0
    while True:
        page = list_page(conn, addressed=True, session=session, limit=200, offset=offset)
        for record in page["requests"]:
            found.setdefault(str(record["reference"]), None)
        if page["next_offset"] is None:
            return list(found)
        offset = int(page["next_offset"])


#: The columns a reader of requests names that a store an earlier build wrote may lack.
_LATER_COLUMNS = ("comment_id", "addressee", "purpose")


def _requests_table(conn: sqlite3.Connection) -> str:
    """The requests table, or for a store an earlier build wrote one that reads null in
    each column it lacks: that build wrote nothing such a column would hold.

    One statement asks which columns there are.
    """

    have = {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM pragma_table_info('work_item_requests')"
            " WHERE name IN (SELECT value FROM json_each(?))",
            (json.dumps(_LATER_COLUMNS),),
        )
    }
    missing = [name for name in _LATER_COLUMNS if name not in have]
    if not missing:
        return "work_item_requests"
    standing = ", ".join(f"NULL AS {name}" for name in missing)
    return f"(SELECT *, {standing} FROM work_item_requests)"  # noqa: S608 - column names


def _own_session() -> str:
    """The session the call in progress proved, or a refusal saying why one is needed."""

    identity = calls.current()
    if identity is None or identity.state != calls.CONFIRMED or identity.session_id is None:
        raise model.PlanningError(
            "addressed lists the requests asked of your own session, and this call proved"
            " no agent session"
        )
    return identity.session_id


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
    parsed_kind = model.enum_field(kind, frozenset({"question", "decision"}), "kind")
    parsed_prompt = model.multiline_field(prompt, "prompt", limit=8000)
    if not parsed_prompt:
        raise model.PlanningError("prompt is required")
    parsed_fields = request_model.fields(fields)
    deadline = request_model.timestamp(expires_at)
    live = "a request requires a live work item, live execution and future deadline"
    with _transaction(conn):
        item = read_model.item_row(conn, reference)
        execution, session = _bindings(conn, item, execution_id, session_id)
        _refuse_closed(conn, item, live)
        identity = questions.ask(
            conn,
            str(item["work_item_id"]),
            kind=parsed_kind,
            prompt=parsed_prompt,
            fields=parsed_fields,
            author=author,
            execution_id=execution,
            session_id=session,
            expires_at=deadline,
        )
        if _expired(conn, _row(conn, identity), request_model.now()):
            raise model.PlanningError(live)
    words.bring_current(conn)
    return get(conn, identity)


def _refuse_closed(conn: sqlite3.Connection, item: sqlite3.Row, message: str) -> None:
    """Refuse a request on a closed item: its close ended every one, and a new one
    would wait for an answer nobody acts on."""

    if read_model.state_by_id(conn, str(item["state_id"]))["is_terminal"]:
        raise model.PlanningError(message)


def ask_sessions(
    conn: sqlite3.Connection,
    reference: str,
    *,
    sessions: object,
    prompt: object,
    fields: object,
    expires_at: object = None,
    author: str | None = None,
    kind: object = "question",
) -> list[dict]:
    """Ask agent sessions instead of the owner: one request on the item for each, in one write.

    Each is a question (or a `kind` of `decision`) with these fields, asked of one
    top-level session, written by the call in progress, which is who asked. Refused,
    naming the session, when one is unknown, has ended or gone quiet past its lease,
    is the caller's own, is a subagent's rather than a top-level one, or is named
    twice; and when none is named. An agent session that asked one session
    `MOST_ASKS_PER_HOUR` times in the last hour is refused with `AskLimitError`;
    Valkama's own asking counts toward no hour. A refusal writes nothing.
    """

    parsed_kind = model.enum_field(kind, frozenset({"question", "decision"}), "kind")
    parsed_prompt = model.multiline_field(prompt, "prompt", limit=8000)
    if not parsed_prompt:
        raise model.PlanningError("prompt is required")
    parsed_fields = request_model.fields(fields)
    deadline = request_model.timestamp(expires_at)
    identities: list[str] = []
    with _transaction(conn):
        asked = _addressees(conn, sessions)
        item = read_model.item_row(conn, reference)
        live = "a request requires a live work item and future deadline"
        _refuse_closed(conn, item, live)
        for session in asked:
            identity = questions.ask(
                conn,
                str(item["work_item_id"]),
                kind=parsed_kind,
                prompt=parsed_prompt,
                fields=parsed_fields,
                author=author,
                expires_at=deadline,
                addressee=session,
            )
            if _expired(conn, _row(conn, identity), request_model.now()):
                raise model.PlanningError(live)
            identities.append(identity)
    words.bring_current(conn)
    return [get(conn, identity) for identity in identities]


def _addressees(conn: sqlite3.Connection, sessions: object) -> list[str]:
    """The sessions a request may be asked of, as named, or the refusal of the first that may not."""

    if not isinstance(sessions, list) or not sessions:
        raise model.PlanningError("sessions names at least one agent session to ask")
    identity = calls.current()
    own = (
        identity.session_id if identity is not None and identity.state == calls.CONFIRMED else None
    )
    asked: list[str] = []
    for value in sessions:
        session = model.text_field(value, "sessions", limit=128)
        if session in asked:
            raise model.PlanningError(f"session {session} is named twice; ask it once")
        if session == own:
            raise model.PlanningError(
                f"session {session} is your own; ask another session, or the owner"
            )
        row = conn.execute(
            "SELECT status, ended_at, last_seen, parent_session_id FROM sessions WHERE id=?",
            (session,),
        ).fetchone()
        if row is None:
            raise model.PlanningError(f"no session {session} is known to Valkama")
        if row["parent_session_id"]:
            raise model.PlanningError(
                f"session {session} is a subagent's; ask the session it works for,"
                f" {row['parent_session_id']}"
            )
        if not leases.session_live(row):
            raise model.PlanningError(
                f"session {session} has ended or gone quiet past its lease, and would not answer"
            )
        asked.append(session)
    # The limit comes after every session is known to be one that may be asked, so a
    # list that names one wrongly is refused for that, as a well-formed one is not.
    for session in asked if own is not None else []:
        found = conn.execute(_ASKED_THIS_HOUR, (session, own, calls.CONFIRMED)).fetchone()
        if int(found[0]) >= MOST_ASKS_PER_HOUR:
            raise model.AskLimitError(
                f"session {session} was asked {MOST_ASKS_PER_HOUR} times in the last hour by"
                " this session; write once there, or wait"
            )
    return asked


def ask_from_agent(
    conn: sqlite3.Connection,
    reference: str,
    *,
    addressees: object,
    kind: object,
    prompt: object,
    fields: object,
    expires_at: object = None,
    author: str | None = None,
) -> dict:
    """An agent's `create_work_item_request` with `addressees`: `ask_sessions` in its call.

    Only a call that proved an agent session asks one, since the session that asked
    is who withdraws it and whom its answer wakes; the interface and an unproved call
    are refused. At most `MOST_ADDRESSEES` sessions at once. The answer names each
    request and the session it asks.
    """

    identity = calls.current()
    if (
        identity is None
        or identity.state != calls.CONFIRMED
        or identity.session_id is None
        or not calls.from_agent()
    ):
        raise model.PlanningError(
            "addressees asks other agent sessions, and only a call that proved its agent"
            " session asks one; this call proved none"
        )
    if not isinstance(addressees, list) or not addressees:
        raise model.PlanningError("addressees names at least one agent session to ask")
    if len(addressees) > MOST_ADDRESSEES:
        raise model.PlanningError(f"addressees names at most {MOST_ADDRESSEES} sessions")
    asked = ask_sessions(
        conn,
        reference,
        sessions=addressees,
        kind=kind,
        prompt=prompt,
        fields=fields,
        expires_at=expires_at,
        author=author,
    )
    return {
        "requests": [
            {"request_id": record["request_id"], "addressee": record["addressee"]}
            for record in asked
        ]
    }


def _check_closer(conn: sqlite3.Connection, row: sqlite3.Row, status: str) -> None:
    """Refuse a caller who may not close or change a request asked of an agent session.

    That session answers, changes and declines it, from its conversation or any of
    its subagents; the session that asked, from any of its agents, or Valkama
    withdraws it. Code of the server outside any call counts as Valkama. A
    question to the owner is closed by whoever closes it today.
    """

    addressee = _addressee(row)
    if addressee is None:
        return
    identity = calls.current()
    proved = (
        identity.session_id if identity is not None and identity.state == calls.CONFIRMED else None
    )
    if status != "expired":
        if proved != addressee:
            raise model.NotAddressedError(
                f"this request was asked of session {addressee}; only that session or one of"
                " its subagents answers it"
            )
        return
    if identity is None or identity.source == calls.VALKAMA:
        return
    if proved is None or proved != _asker(conn, str(row["request_id"])):
        raise model.NotAskerError(
            "only the session that asked this request, or Valkama, withdraws it"
        )


def _asker(conn: sqlite3.Connection, request_id: str) -> str | None:
    """The session whose proved call asked this request; None when Valkama or nobody proved asked it."""

    found = conn.execute(
        "SELECT c.session_id FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
        " WHERE e.action = 'request_created' AND e.detail = ? AND c.identity_state = ?"
        " ORDER BY e.id LIMIT 1",
        (request_id, calls.CONFIRMED),
    ).fetchone()
    return None if found is None or found[0] is None else str(found[0])


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
    are one write. A closed item takes none: its close ended every request on
    it, and a list written now could only be ticked after the item reopened.
    """

    prompt, fields = question
    with _transaction(conn):
        _refuse_closed(
            conn,
            read_model.item_by_id(conn, work_item_id),
            "a list on a closed item could never be answered; reopen it first,"
            " or leave the list out",
        )
        identity = questions.ask(
            conn,
            work_item_id,
            kind="question",
            prompt=prompt,
            fields=fields,
            author=author,
            comment_id=comment_id,
        )
    words.bring_current(conn)
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
    A question with a purpose carries its answer, or its withdrawal, out in the same
    write (`carry_out`), and the record says what it did as `carried_out`; a refusal
    of that writes neither.
    """

    expected_revision = model.count_field(expected_revision, "expected_revision")
    model.enum_field(status, frozenset({"answered", "declined", "expired"}), "status")
    said = _note(note)
    with _transaction(conn):
        row = _row(conn, identity)
        if row["revision"] != expected_revision:
            raise model.RevisionConflictError(expected_revision, row["revision"])
        _check_closer(conn, row, status)
        _check_purpose(conn, row, status)
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
        questions.log_event(conn, row["work_item_id"], f"request_{status}", identity, author)
        carried = carry_out(conn, row, parsed, said, author)
    words.bring_current(conn)
    record = get(conn, identity)
    if carried is not None:
        record["carried_out"] = carried
    return record


def _purpose(row: sqlite3.Row) -> str | None:
    """What a request row's answer carries out; None for any other, as on a store from before."""

    # `in` on a row reads its values, so its column names are asked for by name.
    columns = row.keys()
    purpose: str | None = row["purpose"] if "purpose" in columns else None
    return purpose


def _check_purpose(conn: sqlite3.Connection, row: sqlite3.Row, status: str) -> None:
    """Refuse a caller who may not close a question with a purpose this way.

    Its answer is carried out as it is given, so it is never declined. It decides
    what the owner decides, so only the owner answers it, from Valkama's
    interface; an agent that answered it would accept its own work. Only the
    session that asked it withdraws it, from any of its agents: one Valkama asked
    ends only with the write that ends it, and a question withdrawn by anyone else
    would take work out of review, or leave the owner without the question that
    was to reach them.
    """

    purpose = _purpose(row)
    if purpose is None:
        return
    if status == "declined":
        raise model.PlanningError(
            f"[purpose] this question carries out its answer ({purpose}): it is answered or"
            " withdrawn, never declined"
        )
    if status == "answered":
        if not calls.by_person():
            raise model.OwnerOnlyError("this is the owner's to answer, in Valkama")
        return
    identity = calls.current()
    proved = (
        identity.session_id if identity is not None and identity.state == calls.CONFIRMED else None
    )
    if proved is None or proved != _asker(conn, str(row["request_id"])):
        raise model.NotAskerError("only the session that asked this question withdraws it")


def carry_out(
    conn: sqlite3.Connection, row: sqlite3.Row, answers: dict | None, note: str, author: str | None
) -> str | None:
    """What the answer to a question with a purpose does, in the write that gives it.

    `answers` is the answer as stored, None for a withdrawal. Review's answer
    `accept` moves the work to its first completed state, `return` to its first
    ready state, started as it was, and so does its asker's withdrawal. The move is
    the answerer's, held to its guards, so a refusal refuses the answer with it.
    The owner's note is the move's reason when it fits the event that records the
    move; the answer keeps it whole either way. The answer to confirm a goal or
    stage is carried out by `_confirmed`, and the answer about put-off work that came
    back by `_returned`. Answers what the move did: the category it reached,
    `deferred` or `left_for_next_session`; None for a question with no purpose.
    """

    purpose = _purpose(row)
    if purpose == closing.CONFIRM:
        return _confirmed(conn, row, answers, note, author)
    if purpose == deferral.RETURN:
        return _returned(conn, row, answers, note, author)
    if purpose != "review":
        return None
    given = None if answers is None else answers.get(request_model.REVIEW_ANSWER)
    if answers is not None and given not in (
        request_model.REVIEW_ACCEPT,
        request_model.REVIEW_RETURN,
    ):
        raise model.PlanningError(
            f"[purpose] answer is {request_model.REVIEW_ACCEPT} or {request_model.REVIEW_RETURN}:"
            " an own variant carries nothing out; say more in note"
        )
    category = "completed" if given == request_model.REVIEW_ACCEPT else "ready"
    item = read_model.item_by_id(conn, str(row["work_item_id"]))
    key = _first_state(conn, item, category)
    reason = _said(note if answers is not None else "review withdrawn", key)
    service.transition_work_item(
        conn, read_model.reference(conn, item), key, reason=reason, author=author
    )
    return category


#: What a summary the owner's confirmation writes says comes next.
CONFIRMED_NEXT = "Nothing: the work under it is closed."


def _confirmed(
    conn: sqlite3.Connection, row: sqlite3.Row, answers: dict | None, note: str, author: str | None
) -> str | None:
    """The owner's answer to confirm a goal or stage whose work is all closed.

    `confirm` ticks the steps still open, as the owner's, writes the summary
    (`closing.CONFIRMED`, with the note as its `why`) and moves the goal or stage to
    its workflow's first completed state; `leave` leaves it to the next session that
    takes work in its space, and the period of waiting asks the owner nothing again.
    Valkama asked it, so nobody withdraws it: the write that ends the wait ends it.
    """

    if answers is None:
        return None
    given = answers.get(request_model.REVIEW_ANSWER)
    if given not in (request_model.CONFIRM_CONFIRM, request_model.CONFIRM_LEAVE):
        raise model.PlanningError(
            f"[purpose] answer is {request_model.CONFIRM_CONFIRM} or"
            f" {request_model.CONFIRM_LEAVE}: an own variant carries nothing out; say more in note"
        )
    identity = str(row["work_item_id"])
    if given == request_model.CONFIRM_LEAVE:
        waiting.leave(conn, identity, waiting.SPACE)
        closing.left(conn, identity)
        return "left_for_next_session"
    item = read_model.item_by_id(conn, identity)
    reference = read_model.reference(conn, item)
    for step in model.checklist(item["checklist"]):
        if not step["done"]:
            service.tick_checklist_item(conn, reference, str(step["id"]), author=author, force=True)
    summary = {"done": closing.CONFIRMED, "next": CONFIRMED_NEXT}
    if note:
        summary["why"] = note[: model.SUMMARY_LIMIT]
    service.set_summary(conn, reference, summary, author=author)
    key = _first_state(conn, item, "completed")
    service.transition_work_item(conn, reference, key, author=author)
    return "completed"


#: What a summary the owner's drop of put-off work writes says comes next.
DROPPED_NEXT = "Nothing: the owner dropped it when it came back."


def _returned(
    conn: sqlite3.Connection, row: sqlite3.Row, answers: dict | None, note: str, author: str | None
) -> str | None:
    """The owner's answer about put-off work whose condition came under accepted goals.

    `do` moves it to its workflow's first ready state, accepted as a move there is;
    `later` puts it off again until the answer's `until` (`service.defer_again`);
    `drop` cancels it, with the answer's `cancels` for a goal or stage with open work
    under it, writing a summary that keeps what it says was done. Valkama asked it,
    so nobody withdraws it: the write that takes the item out of deferred ends it.
    """

    if answers is None:
        return None
    given = answers.get(request_model.REVIEW_ANSWER)
    choices = (request_model.RETURN_DO, request_model.RETURN_LATER, request_model.RETURN_DROP)
    if given not in choices:
        raise model.PlanningError(
            f"[purpose] answer is {choices[0]}, {choices[1]} or {choices[2]}: an own variant"
            " carries nothing out; say more in note"
        )
    identity = str(row["work_item_id"])
    item = read_model.item_by_id(conn, identity)
    reference = read_model.reference(conn, item)
    if given == request_model.RETURN_LATER:
        service.defer_again(conn, identity, answers.get(request_model.RETURN_UNTIL))
        return "deferred"
    if given == request_model.RETURN_DO:
        key = _first_state(conn, item, "ready")
        service.transition_work_item(conn, reference, key, reason=_said(note, key), author=author)
        return "ready"
    said = model.summary(item["summary"], required=False)
    done = "" if said is None else str(said.get("done") or "").strip()
    summary = {
        "done": done or "Nothing: it was put off, and dropped when it came back.",
        "next": DROPPED_NEXT,
    }
    if note:
        summary["why"] = note[: model.SUMMARY_LIMIT]
    service.set_summary(conn, reference, summary, author=author)
    key = _first_state(conn, item, "cancelled")
    service.transition_work_item(
        conn,
        reference,
        key,
        reason=_said(note, key),
        author=author,
        cancels=answers.get(request_model.RETURN_CANCELS) or None,
    )
    return "cancelled"


def _said(note: str, key: str) -> str:
    """The owner's note as a move's reason, when it fits the event that records the move."""

    try:
        return service.transition_reason(note, key)
    except model.PlanningError:
        return ""


def _first_state(conn: sqlite3.Connection, item: sqlite3.Row, category: str) -> str:
    """The key of the first state of `category` in the item's workflow, for an answer to move it to."""

    target = states.first_state(conn, str(item["workflow_id"]), category)
    if target is None:
        raise model.WorkflowGuardError(
            f"[transition] {read_model.reference(conn, item)} has no {category} state in its"
            " workflow for this answer to move it to"
        )
    return str(target["key"])


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

    Held to the rules of a first answer. Refused for a question with a purpose,
    whose answer was carried out as it was given (`[purpose]`), for one that is not
    answered, on a closed item (`[item_closed]`: nobody is left to act on the
    change, and a goal or stage is closed as a task is), when nothing
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
        _check_closer(conn, row, "answered")
        purpose = _purpose(row)
        if purpose is not None:
            raise model.PlanningError(
                f"[purpose] this question carried out its answer ({purpose}) when it was"
                " given: that answer is not changed"
            )
        if row["status"] != "answered":
            raise model.WorkflowGuardError("only an answered question's answer can be changed")
        item = read_model.item_by_id(conn, row["work_item_id"])
        if read_model.state_by_id(conn, item["state_id"])["is_terminal"]:
            raise model.WorkflowGuardError(
                "[item_closed] the work item is closed; reopen it to change the answer"
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
        questions.log_event(conn, row["work_item_id"], "request_changed", row["request_id"], author)
    words.bring_current(conn)
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
