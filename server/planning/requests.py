"""Durable human requests with independent revisions and read-only expiry."""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Iterator

from . import model, read_model, request_model, service


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
    return {
        "request_id": row["request_id"],
        "work_item_id": row["work_item_id"],
        "reference": read_model.reference(conn, item),
        "title": item["title"],
        "kind": row["kind"],
        "prompt": row["prompt"],
        "fields": json.loads(row["fields_json"]),
        "answers": json.loads(row["answers_json"]) if row["answers_json"] is not None else None,
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
    }


def get(conn: sqlite3.Connection, identity: object) -> dict:
    return _present(conn, _row(conn, identity), request_model.now())


def list_requests(
    conn: sqlite3.Connection,
    *,
    space: str | None = None,
    status: str | None = None,
    limit: int = 100,
    reference: str | None = None,
) -> list[dict]:
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
    # Effective expiry depends on item/execution state. Filter after projection,
    # fetching in pages so terminal history cannot hide a pending request.
    query = service.with_clauses(
        "SELECT r.* FROM work_item_requests r JOIN work_items i ON i.work_item_id=r.work_item_id",
        clauses,
    )
    query += " ORDER BY r.created_at DESC,r.request_id LIMIT ? OFFSET ?"
    bounded = max(1, min(int(limit), 201))
    result: list[dict] = []
    at = request_model.now()
    offset = 0
    while len(result) < bounded:
        rows = conn.execute(query, (*parameters, 200, offset)).fetchall()
        for row in rows:
            presented = _present(conn, row, at)
            if status is None or presented["status"] == status:
                result.append(presented)
                if len(result) == bounded:
                    break
        if len(rows) < 200:
            break
        offset += 200
    return result


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


def resolve(
    conn: sqlite3.Connection,
    identity: str,
    *,
    status: str,
    expected_revision: object,
    answers: object = None,
    author: str | None = None,
) -> dict:
    if (
        not isinstance(expected_revision, int)
        or isinstance(expected_revision, bool)
        or expected_revision < 0
    ):
        raise model.PlanningError("expected_revision must be a non-negative integer")
    model.enum_field(status, frozenset({"answered", "declined", "expired"}), "status")
    with _transaction(conn):
        row = _row(conn, identity)
        if row["revision"] != expected_revision:
            raise model.RevisionConflictError(expected_revision, row["revision"])
        at = request_model.now()
        if row["status"] != "pending" or _expired(conn, row, at):
            raise model.WorkflowGuardError("request is no longer pending")
        parsed = (
            request_model.answers(answers, json.loads(row["fields_json"]))
            if status == "answered"
            else None
        )
        changed = conn.execute(
            "UPDATE work_item_requests SET status=?,answers_json=?,answered_by=?,resolved_at=?,expired_reason=?,revision=revision+1 WHERE request_id=? AND revision=? AND status='pending' AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))",
            (
                status,
                model.dumps(parsed) if parsed is not None else None,
                model.actor(author),
                at,
                "withdrawn" if status == "expired" else None,
                identity,
                expected_revision,
            ),
        )
        if changed.rowcount != 1:
            raise model.WorkflowGuardError("request is no longer pending")
        _event(conn, row["work_item_id"], f"request_{status}", identity, author)
    return get(conn, identity)


def _event(
    conn: sqlite3.Connection, work_item_id: str, action: str, request_id: str, author: str | None
) -> None:
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author) VALUES(?,?,?,?)",
        (work_item_id, model.event_action(action), request_id, model.actor(author)),
    )
