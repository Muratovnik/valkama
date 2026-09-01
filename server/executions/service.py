"""Reading and writing one attempt at a work item.

The lifecycle module decides what an attempt means for the work; this module is
where the attempt itself is a row. The split matters because the two answer to
different owners: a transition is Planning's rule and a launch record is the
execution module's fact, and the launch path used to have only the first.

Identity comes first, and that is the whole point of `open_execution` running
before the process is spawned. The identity a client reports arrives late — for
Codex it arrives only once the client has spoken — so an execution that were
created afterwards could be matched to its session by nothing better than time.
Creating the row first means the correlation is carried into the child process
in its environment and read back out, never inferred.
"""

from __future__ import annotations

import json
import sqlite3
import uuid

from . import artifacts, store

#: How many attempts one work item shows before the rest are history.
DEFAULT_HISTORY = 20

#: What the runner's own verdict means for the attempt's durable status. The
#: outcome stays on the row unchanged; this is the lifecycle reading of it.
_OUTCOME_STATUS = {
    "complete": "complete",
    "expected_no_change": "complete",
    "unexpected_no_change": "partial",
    "partial": "partial",
    "refused": "refused",
    "launch_failed": "failed",
}


def new_execution_id() -> str:
    """A fresh attempt identity, minted before anything can observe the attempt."""

    return f"exec-{uuid.uuid4().hex}"


def open_execution(
    conn: sqlite3.Connection,
    *,
    execution_id: str,
    work_item_id: str,
    project_id: str,
    packet: dict,
    adapter_lineage_id: str = "",
) -> str:
    """Record an attempt that is about to start, in the caller's transaction.

    `starting` rather than `running`: the process does not exist yet, and a row
    that claimed otherwise would be a lie for however long the spawn takes and
    forever if the spawn fails.

    No baseline is written here, and that is `record_baseline`'s reason to exist:
    at this point nobody knows which checkout the attempt will run in.
    """

    conn.execute(
        "INSERT INTO executions(execution_id, work_item_id, project_id, adapter_lineage_id,"
        " client_family, role, environment, model, effort, expected_effect, review_mode,"
        " status)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,'starting')",
        (
            execution_id,
            work_item_id,
            project_id,
            adapter_lineage_id,
            str(packet.get("client") or ""),
            str(packet.get("role") or ""),
            str(packet.get("environment") or ""),
            str(packet.get("model") or ""),
            str(packet.get("effort") or ""),
            str(packet.get("expected_effect") or ""),
            str(packet.get("review_mode") or ""),
        ),
    )
    return execution_id


def record_baseline(
    conn: sqlite3.Connection, execution_id: str, base_artifact: dict | None
) -> None:
    """What the checkout was, once it is known and before the process exists.

    Its own call rather than a column filled in at `open_execution`, because the
    two facts become knowable at different moments: the attempt has an identity
    before anything is resolved, while the checkout it will run in is resolved
    afterwards — and for a worktree environment it is a sibling directory, not
    the repository the packet named. Written before the spawn either way, so it
    still says what was there before the attempt could change it.
    """

    conn.execute(
        "UPDATE executions SET base_artifact_json=?, revision = revision + 1"
        " WHERE execution_id = ?",
        (_json(base_artifact), execution_id),
    )


def mark_running(
    conn: sqlite3.Connection,
    execution_id: str,
    *,
    launch_id: str,
    cwd: str,
    resumed_from: str = "",
) -> None:
    """The process exists; record what the runner had to spawn it to learn."""

    conn.execute(
        "UPDATE executions SET status='running', launch_id=?, cwd=?, resumed_from=?,"
        " revision = revision + 1 WHERE execution_id = ?",
        (launch_id, cwd, resumed_from, execution_id),
    )


def link_session(
    conn: sqlite3.Connection, execution_id: str, session_id: str, relation: str
) -> None:
    """Bind one observed session to this attempt, saying how it got there.

    Idempotent by primary key: a launch links the identity it assigned, and the
    same session may be linked again when the client finally announces the one
    it minted. The first relation recorded wins, because it is the one that
    describes how the binding was made.
    """

    if relation not in store.SESSION_RELATIONS:
        raise ValueError(f"unknown execution session relation {relation!r}")
    if not session_id:
        return
    conn.execute(
        "INSERT INTO execution_sessions(execution_id, session_id, relation)"
        " VALUES (?,?,?) ON CONFLICT(execution_id, session_id) DO NOTHING",
        (execution_id, session_id, relation),
    )


def close_execution(
    conn: sqlite3.Connection,
    execution_id: str,
    *,
    status: str,
    outcome: str = "",
    exit_code: int | None = None,
    result: dict | None = None,
    final_artifact: dict | None = None,
) -> bool:
    """Finish an attempt: its verdict, its exit code, and what it left behind.

    Written once, by whichever path actually observed the end. `ended_at IS
    NULL` is the guard, and it is what stops a stop that arrives after a real
    completion from replacing `complete` with `cancelled` — two paths watch one
    process, and the later of them used to win by being later. `False` says the
    attempt was already closed and this call changed nothing, which a caller can
    report honestly instead of assuming it rewrote history.
    """

    if status not in store.STATUSES:
        raise ValueError(f"unknown execution status {status!r}")
    cursor = conn.execute(
        "UPDATE executions SET status=?, outcome=?, exit_code=?, result_json=?,"
        " final_artifact_json=?, ended_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),"
        " revision = revision + 1 WHERE execution_id = ? AND ended_at IS NULL",
        (
            status,
            outcome,
            exit_code,
            _json(result),
            _json(final_artifact),
            execution_id,
        ),
    )
    return cursor.rowcount > 0


def status_for_outcome(outcome: str) -> str:
    """The durable status one runner verdict means, defaulting to the honest one.

    An outcome this build does not recognise becomes `partial` rather than
    `complete`: an unreadable verdict is not a delivery.
    """

    return _OUTCOME_STATUS.get(outcome, "partial")


def close_open_executions(conn: sqlite3.Connection, reason: str = "platform restarted") -> int:
    """Close attempts a previous platform process left running.

    A launch lives in the process that spawned it, so a restart leaves rows
    saying `running` for processes this platform can no longer see or stop.
    Leaving them would make the newest attempt on an item look live forever;
    `cancelled` with the reason on the row is what actually happened.
    """

    rows = conn.execute("SELECT execution_id FROM executions WHERE ended_at IS NULL").fetchall()
    # Counted by what was written rather than by what was selected: the close is
    # guarded on the row still being open, so the two can differ and the number
    # this returns is the one the caller reports.
    return sum(
        close_execution(
            conn,
            str(row["execution_id"] if isinstance(row, sqlite3.Row) else row[0]),
            status="cancelled",
            outcome="cancelled",
            result={"delivery": "", "oracle": reason, "unresolved": reason, "structured": False},
        )
        for row in rows
    )


def executions_for_work_item(
    conn: sqlite3.Connection, work_item_id: str, limit: int = DEFAULT_HISTORY
) -> list[dict]:
    """This item's attempts, newest first, each with the sessions it opened."""

    bounded = max(1, min(int(limit), 200))
    rows = conn.execute(
        "SELECT * FROM executions WHERE work_item_id = ?"
        " ORDER BY started_at DESC, rowid DESC LIMIT ?",
        (work_item_id, bounded),
    ).fetchall()
    if not rows:
        return []
    sessions: dict[str, list[dict]] = {str(row["execution_id"]): [] for row in rows}
    # Joined through `executions` rather than filtered by a built list of ids:
    # the item is the parameter either way, and a query with a fixed shape is
    # one nobody has to read twice to see that it is parameterised.
    for link in conn.execute(
        "SELECT l.execution_id, l.session_id, l.relation, s.status, s.attention, s.client"
        " FROM execution_sessions l"
        " JOIN executions e ON e.execution_id = l.execution_id"
        " LEFT JOIN sessions s ON s.id = l.session_id"
        " WHERE e.work_item_id = ? ORDER BY l.linked_at, l.rowid",
        (work_item_id,),
    ).fetchall():
        identity = str(link["execution_id"])
        if identity not in sessions:
            continue  # an older attempt, outside the page this read asked for
        sessions[identity].append(
            {
                "session_id": str(link["session_id"]),
                "relation": str(link["relation"]),
                "status": str(link["status"] or "unknown"),
                "attention": str(link["attention"] or ""),
                "client": str(link["client"] or ""),
            }
        )
    return [_present(row, sessions[str(row["execution_id"])]) for row in rows]


def execution_for_session(conn: sqlite3.Connection, session_id: str) -> dict | None:
    """The attempt one session belongs to, when a link says so and nothing else does."""

    row = conn.execute(
        "SELECT e.*, p.key || '-' || w.number AS reference FROM execution_sessions l"
        " JOIN executions e ON e.execution_id = l.execution_id"
        " JOIN work_items w ON w.work_item_id = e.work_item_id"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE l.session_id = ? ORDER BY e.started_at DESC, e.rowid DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if row is None:
        return None
    record = _present(row, [])
    record["work_item"] = str(row["reference"])
    return record


def _present(row: sqlite3.Row, sessions: list[dict]) -> dict:
    """One attempt in the shape a read model hands to an interface.

    `waiting` is derived here rather than stored: it is true exactly while a
    live session of this attempt is asking for its owner, which the session
    monitor already knows and which stops being true without anything writing
    to this table.
    """

    waiting = any(entry["status"] == "active" and entry["attention"] for entry in sessions)
    return {
        "execution_id": str(row["execution_id"]),
        "work_item_id": str(row["work_item_id"]),
        "project_id": str(row["project_id"] or ""),
        "adapter_lineage_id": str(row["adapter_lineage_id"] or ""),
        "client_family": str(row["client_family"]),
        "role": str(row["role"]),
        "environment": str(row["environment"]),
        "model": str(row["model"] or ""),
        "effort": str(row["effort"] or ""),
        "expected_effect": str(row["expected_effect"]),
        "review_mode": str(row["review_mode"] or ""),
        "status": str(row["status"]),
        "presence": "waiting" if waiting else _presence(str(row["status"])),
        "outcome": str(row["outcome"] or ""),
        "launch_id": str(row["launch_id"] or ""),
        "cwd": str(row["cwd"] or ""),
        "resumed_from": str(row["resumed_from"] or ""),
        "exit_code": row["exit_code"],
        "result": _record(row["result_json"]),
        "base_artifact": _record(row["base_artifact_json"]),
        "final_artifact": _record(row["final_artifact_json"]),
        "started_at": str(row["started_at"]),
        "ended_at": row["ended_at"],
        "revision": int(row["revision"]),
        "sessions": sessions,
    }


def _presence(status: str) -> str:
    return "live" if status in ("starting", "running") else "terminal"


def _json(value: dict | None) -> str:
    return "" if not value else json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _record(value: object) -> dict | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def observe_baseline(repo: str) -> dict:
    """The checkout an attempt is about to run in, as evidence rather than a claim."""

    return artifacts.baseline(repo)


def observe_outcome(repo: str, base: dict | None) -> dict:
    """What the attempt changed in that checkout, measured from the same base."""

    return artifacts.outcome(repo, base or {})


__all__ = [
    "DEFAULT_HISTORY",
    "close_execution",
    "close_open_executions",
    "execution_for_session",
    "executions_for_work_item",
    "link_session",
    "mark_running",
    "new_execution_id",
    "observe_baseline",
    "observe_outcome",
    "open_execution",
    "record_baseline",
    "status_for_outcome",
]
