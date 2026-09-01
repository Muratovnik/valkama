"""Agent sessions: ingest, the monitor read model, and stream retention.

Hooks post one event per lifecycle step from the agent's own process. Events
are classified as they arrive: `analytics` rows are kept for reporting and
`stream` rows are a bounded tail that `purge_stream_events` can drop without
touching the analytics history.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3

from .platform.contracts import planning_space_entity
from .platform.scope import read_store_metadata
from .projects import project_registry

# --- session monitor: normalized ingest, live view, stream hygiene -----------

# The published contract lives in docs/session-event-contract.md. The server is
# the authority for the analytics/stream split: adapters name what happened,
# retention policy stays in one place.
SESSION_EVENT_KINDS = {
    "session_start": "analytics",
    "session_end": "analytics",
    "turn_end": "analytics",
    "tool_end": "analytics",
    "attention": "analytics",
    "tool_start": "stream",
    "step": "stream",
}

# A finished turn is a session waiting for its owner, not a finished session --
# clients end a turn many times per session. It rings the inbox, and the next
# sign of work clears it again without anyone acknowledging anything.
WAITING_ATTENTION = "waiting"

RESUMES_WORK = frozenset({"tool_start", "tool_end", "step"})

# This is a presentation threshold, not a fourth durable status.  An active
# session remains active until a client explicitly ends it, even if its client
# has disconnected or stopped reporting events.
SESSION_STALE_AFTER_SECONDS = 5 * 60

# A long interactive session emits thousands of stream rows; only the recent
# tail has any monitor value, so inserts self-trim. Analytics is never trimmed.
STREAM_TAIL_PER_SESSION = 300

SESSION_FIELD_LIMITS = {
    "session_id": 128,
    "client": 32,
    "cwd": 512,
    "label": 200,
    "tool": 128,
    "server": 128,
    "status": 64,
}

SESSION_DETAIL_LIMIT = 4096


def client_family(client: str) -> str:
    """Which client family a recorded client string belongs to.

    Session identity is this domain's word, so the reading of it lives here. It
    sat in the Kernel because the Kernel was the first caller, and the Kernel
    itself never used either of these.
    """

    value = str(client).strip().lower()
    if value.startswith("codex"):
        return "codex"
    if value.startswith("claude"):
        return "claude"
    return "other"


def session_adapter_id(client: str) -> str:
    family = client_family(client)
    return f"{family}-sessions" if family != "other" else "unknown"


def _session_text(payload: dict, key: str, required: bool = False) -> str:
    value = payload.get("session_id" if key == "session_id" else key, "")
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"session event {key} must be a string")
    value = "".join(ch for ch in value.strip() if ch >= " ")
    if required and not value:
        raise ValueError(f"session event {key} is required")
    return value[: SESSION_FIELD_LIMITS.get(key, 256)]


def _work_item_id(conn: sqlite3.Connection, reference: str) -> str | None:
    """The stored identity behind a reference, or nothing when it names none."""

    space_key, _, number = str(reference).partition("-")
    if not number.isdigit():
        return None
    row = conn.execute(
        "SELECT w.work_item_id FROM work_items w"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE p.key = ? AND w.number = ?",
        (space_key, int(number)),
    ).fetchone()
    return str(row[0]) if row is not None else None


def op_ingest_session_event(conn: sqlite3.Connection, payload: dict) -> dict:
    """Store one normalized client event and keep the session row honest."""
    if not isinstance(payload, dict):
        raise ValueError("session event must be a JSON object")
    kind = str(payload.get("event", "")).strip()
    if kind not in SESSION_EVENT_KINDS:
        raise ValueError(
            f"unknown session event {kind!r}, use one of {sorted(SESSION_EVENT_KINDS)}"
        )
    session_id = _session_text(payload, "session_id", required=True)
    client = _session_text(payload, "client", required=True)
    cwd = _session_text(payload, "cwd")
    label = _session_text(payload, "label")
    tool = _session_text(payload, "tool")
    server = _session_text(payload, "server")
    status = _session_text(payload, "status")
    launched_item = payload.get("work_item")
    if launched_item is not None and not isinstance(launched_item, str):
        raise ValueError("session event work_item must be a reference")
    detail_value = payload.get("detail")
    if detail_value in (None, ""):
        detail = ""
    else:
        detail = json.dumps(detail_value, ensure_ascii=False, separators=(",", ":"))
        if len(detail) > SESSION_DETAIL_LIMIT:
            detail = json.dumps({"truncated": True}, ensure_ascii=False, separators=(",", ":"))
    klass = SESSION_EVENT_KINDS[kind]

    try:
        conn.execute("BEGIN IMMEDIATE")
        # Events may arrive before session_start (an adapter attached
        # mid-session), so every event may create the row.
        conn.execute(
            "INSERT INTO sessions(id, client, cwd, label) VALUES (?,?,?,?)"
            " ON CONFLICT(id) DO NOTHING",
            (session_id, client, cwd, label),
        )
        updates = ["last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')"]
        values: list = []
        for column, value in (("cwd", cwd), ("label", label)):
            if value:
                updates.append(f"{column} = ?")
                values.append(value)
        launched_id = _work_item_id(conn, launched_item) if launched_item else None
        if launched_id is not None:
            # A launched session says which item it serves; an unknown reference is
            # ignored rather than written, so a stale env var cannot corrupt a row.
            updates.append("work_item_id = ?")
            values.append(launched_id)
        if kind == "session_start":
            # A resumed session is alive again: leaving stale attention up
            # would keep ringing the inbox for work that has continued.
            # The new start is also the one authoritative identity boundary:
            # events observed mid-session may create a provisional row, but a
            # fresh reporter must be allowed to correct that stale identity.
            updates.append("client = ?")
            values.append(client)
            updates.append("status = 'active'")
            updates.append("ended_at = NULL")
            updates.append("attention = ''")
            updates.append("attention_seen = 0")
        elif kind == "session_end":
            ended = "failed" if status in ("error", "failed") else "ended"
            # A failed terminal event is authoritative until a fresh explicit
            # session_start reopens the session.  Late clean ends, attention,
            # or stream events must not downgrade it.
            updates.append("status = CASE WHEN status = 'failed' THEN 'failed' ELSE ? END")
            values.append(ended)
            updates.append(
                "ended_at = CASE WHEN status = 'failed' THEN ended_at"
                " ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now') END"
            )
            updates.append("attention = CASE WHEN status = 'failed' THEN 'failed' ELSE ? END")
            values.append(ended)
            updates.append("attention_seen = 0")
        elif kind == "turn_end":
            # Only a live session can be waiting; an ended one keeps the
            # stronger reason it already carries.
            updates.append("attention = CASE WHEN status = 'active' THEN ? ELSE attention END")
            values.append(WAITING_ATTENTION)
            updates.append(
                "attention_seen = CASE WHEN status = 'active' THEN 0 ELSE attention_seen END"
            )
        elif kind in RESUMES_WORK:
            # New observed work makes every nonterminal attention reason
            # obsolete.  Terminal state is intentionally left untouched; only
            # session_start is allowed to reopen it.
            updates.append("attention = CASE WHEN status = 'active' THEN '' ELSE attention END")
            updates.append(
                "attention_seen = CASE WHEN status = 'active' THEN 0 ELSE attention_seen END"
            )
        elif kind == "attention":
            # A terminal status owns its presentation until an explicit new
            # session_start.  In particular a late blocked event cannot hide
            # a failed end.
            updates.append("attention = CASE WHEN status = 'active' THEN ? ELSE attention END")
            values.append(status or "attention")
            updates.append(
                "attention_seen = CASE WHEN status = 'active' THEN 0 ELSE attention_seen END"
            )
        conn.execute(
            f"UPDATE sessions SET {', '.join(updates)} WHERE id = ?",
            (*values, session_id),
        )
        cursor = conn.execute(
            "INSERT INTO session_events(session_id, klass, kind, tool, server, status, detail)"
            " VALUES (?,?,?,?,?,?,?)",
            (session_id, klass, kind, tool, server, status, detail),
        )
        if klass == "stream":
            conn.execute(
                "DELETE FROM session_events WHERE session_id = ? AND klass = 'stream'"
                " AND id NOT IN (SELECT id FROM session_events"
                " WHERE session_id = ? AND klass = 'stream'"
                " ORDER BY id DESC LIMIT ?)",
                (session_id, session_id, STREAM_TAIL_PER_SESSION),
            )
        if kind == "session_end":
            # The ended session's live tail is noise now; its analytics rows
            # keep the durable record of what it called.
            conn.execute(
                "DELETE FROM session_events WHERE session_id = ? AND klass = 'stream'",
                (session_id,),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"session": session_id, "event": kind, "klass": klass, "id": cursor.lastrowid}


def _session_associations(
    conn: sqlite3.Connection,
    session_id: str,
    explicit_work_item: str | None = None,
) -> dict:
    """The work items and spaces explicitly associated with one session.

    A session may be linked from more than one item. Links inside one space are
    still an exact association, but links spanning spaces are unsafe to resolve:
    picking the newest ref would silently cross-map a global row.
    """

    references: list[str] = []
    if explicit_work_item:
        references.append(str(explicit_work_item))
    for ref in conn.execute(
        "SELECT p.key || '-' || w.number AS reference FROM work_item_refs r"
        " JOIN work_items w ON w.work_item_id = r.work_item_id"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE r.kind = 'session' AND r.value = ? ORDER BY r.id",
        (session_id,),
    ).fetchall():
        reference = str(ref["reference"] if isinstance(ref, sqlite3.Row) else ref[0])
        if reference not in references:
            references.append(reference)
    if not references:
        return _no_association()

    placeholders = ",".join("?" for _ in references)
    rows = conn.execute(
        "SELECT p.key || '-' || w.number AS reference, p.planning_space_id, p.key AS space"
        " FROM work_items w JOIN planning_spaces p"
        " ON p.planning_space_id = w.planning_space_id"
        f" WHERE p.key || '-' || w.number IN ({placeholders})",
        tuple(references),
    ).fetchall()
    found = {str(row["reference"]): row for row in rows}
    associations = [found[reference] for reference in references if reference in found]
    spaces: list[tuple[str, str]] = []
    for row in associations:
        pair = (str(row["planning_space_id"]), str(row["space"]))
        if pair not in spaces:
            spaces.append(pair)
    if len(spaces) > 1:
        return {
            "status": "ambiguous",
            "resource_ref": None,
            "work_item": None,
            "work_items": [str(row["reference"]) for row in associations],
        }
    if not spaces:
        return _no_association()
    _, space_key = spaces[0]
    resource_ref = planning_space_entity(
        {
            "data_scope_id": read_store_metadata(conn)["data_scope_id"],
            "space_key": space_key,
        }
    )
    return {
        "status": "mapped",
        "resource_ref": resource_ref,
        "work_item": str(associations[-1]["reference"]) if associations else None,
        "work_items": [str(row["reference"]) for row in associations],
    }


def _no_association() -> dict:
    return {
        "status": "missing",
        "resource_ref": None,
        "work_item": None,
        "work_items": [],
    }


def _session_root_context(
    resource_ref: object | None, cwd: str, *, ambiguous: bool = False
) -> dict:
    if not ambiguous:
        return project_registry.session_space_context(resource_ref, cwd)
    observed = str(cwd or "")
    return {
        "resource_ref": None,
        "status": "ambiguous",
        "canonical_root": None,
        "effective_cwd": "",
        "session_cwd": observed,
        "source": "session_association",
        "reason": "session is linked across planning spaces; an exact root is refused",
        "fallback": False,
    }


def _monitor_clock(now: dt.datetime | None = None) -> dt.datetime:
    """Return an injectable UTC clock for the derived monitor presentation."""
    if now is None:
        return dt.datetime.now(dt.UTC)
    if not isinstance(now, dt.datetime):
        raise TypeError("monitor clock must be a datetime")
    if now.tzinfo is None:
        raise ValueError("monitor clock must be timezone-aware")
    return now.astimezone(dt.UTC)


def _session_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value)


def sessions_payload(
    conn: sqlite3.Connection,
    recent_ended: int = 30,
    *,
    now: dt.datetime | None = None,
) -> dict:
    """The monitor read model: live sessions, their current step, the inbox."""
    rows = conn.execute(
        "SELECT s.*,"
        " (SELECT p.key || '-' || w.number FROM work_item_refs r"
        "  JOIN work_items w ON w.work_item_id = r.work_item_id"
        "  JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        "  WHERE r.kind = 'session' AND r.value = s.id"
        "  ORDER BY r.id DESC LIMIT 1) AS ref_work_item,"
        " (SELECT p.key || '-' || w.number FROM work_items w"
        "  JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        "  WHERE w.work_item_id = s.work_item_id) AS own_work_item"
        " FROM sessions s ORDER BY (s.status = 'active') DESC, s.last_seen DESC"
    ).fetchall()
    # A stream row is a current step only when it follows every durable
    # boundary.  This prevents a pre-attention step from leaking into the
    # waiting/blocked view and suppresses late stream events after session_end.
    current_steps = dict(
        conn.execute(
            "SELECT session_id, COALESCE(NULLIF(tool, ''), kind) FROM session_events"
            " WHERE klass = 'stream' AND id IN ("
            "  SELECT MAX(stream.id) FROM session_events stream"
            "  WHERE stream.klass = 'stream' AND stream.id > COALESCE(("
            "   SELECT MAX(boundary.id) FROM session_events boundary"
            "   WHERE boundary.session_id = stream.session_id"
            "    AND boundary.klass = 'analytics'"
            "    AND boundary.kind IN ('attention','turn_end','session_end')"
            "  ), 0) GROUP BY stream.session_id"
            " )"
        ).fetchall()
    )
    # Which attempt each session belongs to, read once rather than per row. A
    # session belongs to at most one: the link is written by the launch that
    # created it or by a person attaching it, never inferred.
    attempts = dict(
        conn.execute(
            "SELECT session_id, execution_id FROM execution_sessions"
            " GROUP BY session_id HAVING MAX(linked_at)"
        ).fetchall()
    )
    clock = _monitor_clock(now)
    sessions = []
    ended_kept = 0
    for row in rows:
        if row["status"] != "active":
            ended_kept += 1
            if ended_kept > recent_ended and not (row["attention"] and not row["attention_seen"]):
                continue
        last_seen = _session_time(row["last_seen"])
        quiet_seconds = max(0, int((clock - last_seen).total_seconds()))
        stale = row["status"] == "active" and quiet_seconds >= SESSION_STALE_AFTER_SECONDS
        healthy = row["status"] == "active" and not row["attention"] and not stale
        scope = _session_associations(conn, row["id"], row["own_work_item"] or row["ref_work_item"])
        ambiguous_scope = scope["status"] == "ambiguous"
        sessions.append(
            {
                "id": row["id"],
                "execution_id": attempts.get(row["id"], ""),
                "client": row["client"],
                "client_family": client_family(row["client"]),
                "adapter_id": session_adapter_id(row["client"]),
                "cwd": row["cwd"],
                "label": row["label"],
                "work_item": None if ambiguous_scope else scope["work_item"],
                "space_root": _session_root_context(
                    scope["resource_ref"], row["cwd"], ambiguous=ambiguous_scope
                ),
                "status": row["status"],
                "attention": row["attention"],
                "attention_seen": bool(row["attention_seen"]),
                "started_at": row["started_at"],
                "last_seen": row["last_seen"],
                "ended_at": row["ended_at"],
                "quiet_seconds": quiet_seconds,
                # status stays the durable active|ended|failed enum. Presence
                # expresses reporter connectivity without fabricating a
                # terminal event or duplicating the same fact in a boolean.
                "presence": "stale"
                if stale
                else ("connected" if row["status"] == "active" else "terminal"),
                "current_step": current_steps.get(row["id"], "") if healthy else "",
            }
        )
    inbox = [item for item in sessions if item["attention"] and not item["attention_seen"]]
    return {"sessions": sessions, "inbox": inbox}


def session_context(conn: sqlite3.Connection, value: str) -> dict:
    """Resolve one exact/prefix session and the space its work item names.

    The space is never inferred from the current page, client name, or cwd.
    Prefixes are accepted for compatibility only when they identify one row;
    an ambiguous prefix is a typed failure.
    """

    text = str(value or "").strip()
    if not text:
        raise ValueError("a session value is required")
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = conn.execute(
        "SELECT s.id, s.client, s.cwd, s.status, s.last_seen,"
        " (SELECT p.key || '-' || w.number FROM work_items w"
        "  JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        "  WHERE w.work_item_id = s.work_item_id) AS work_item"
        " FROM sessions s WHERE s.id = ? OR s.id LIKE ? ESCAPE '\\'"
        " ORDER BY (s.id = ?) DESC, s.last_seen DESC LIMIT 2",
        (text, escaped + "%", text),
    ).fetchall()
    exact = [row for row in rows if row["id"] == text]
    if not exact and len(rows) > 1:
        return {
            "kind": "session",
            "value": text,
            "resolved": False,
            "status": "ambiguous",
            "detail": "session prefix is ambiguous: several observed sessions match",
        }
    if not rows:
        return {
            "kind": "session",
            "value": text,
            "resolved": False,
            "status": "missing",
            "detail": "no observed session matches this id",
        }
    row = exact[0] if exact else rows[0]
    scope = _session_associations(conn, row["id"], row["work_item"])
    ambiguous_scope = scope["status"] == "ambiguous"
    root = _session_root_context(scope["resource_ref"], row["cwd"], ambiguous=ambiguous_scope)
    if ambiguous_scope:
        return {
            "kind": "session",
            "value": text,
            "resolved": False,
            "status": "ambiguous",
            "detail": "session is linked across planning spaces; its space is ambiguous",
            "session": row["id"],
            "client": row["client"],
            "client_family": client_family(row["client"]),
            "cwd": row["cwd"],
            "session_cwd": row["cwd"],
            "work_item": None,
            "space_root": root,
            "at": row["last_seen"],
        }
    return {
        "kind": "session",
        "value": text,
        "resolved": True,
        "session": row["id"],
        "client": row["client"],
        "client_family": client_family(row["client"]),
        "cwd": row["cwd"],
        "session_cwd": row["cwd"],
        "status": row["status"],
        "work_item": scope["work_item"],
        "space_root": root,
        "detail": f"{row['client']} · {row['status']} · {row['cwd'] or 'no directory'}",
        "at": row["last_seen"],
    }


def session_feed(conn: sqlite3.Connection, session_id: str, limit: int = 50) -> dict:
    """One session's recent actions, newest first: the expanded monitor row."""
    row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        raise ValueError(f"no session {session_id!r}")
    bounded = max(1, min(int(limit), 200))
    events = [
        {
            "id": e["id"],
            "klass": e["klass"],
            "kind": e["kind"],
            "tool": e["tool"],
            "server": e["server"],
            "status": e["status"],
            "detail": e["detail"],
            "at": e["created_at"],
        }
        for e in conn.execute(
            "SELECT * FROM session_events WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, bounded),
        ).fetchall()
    ]
    return {"session": session_id, "events": events}


def op_mark_attention_seen(conn: sqlite3.Connection, session_id: str) -> dict:
    changed = conn.execute(
        "UPDATE sessions SET attention_seen = 1 WHERE id = ? AND attention != ''",
        (session_id,),
    ).rowcount
    conn.commit()
    return {"session": session_id, "seen": bool(changed)}


def purge_stream_events(
    conn: sqlite3.Connection,
    session_id: str | None = None,
    include_active: bool = False,
    older_than_days: int | None = None,
) -> dict:
    """Manual stream hygiene; analytics rows are deliberately untouchable here.

    `older_than_days` is the per-scope retention policy from the registry. It
    can only be applied to the scope this process owns as its primary store,
    because federation reads attached files read-only: the platform that owns a file
    is the one allowed to prune it.
    """
    where = ["klass = 'stream'"]
    values: list = []
    if session_id:
        where.append("session_id = ?")
        values.append(session_id)
    elif not include_active:
        where.append("session_id IN (SELECT id FROM sessions WHERE status != 'active')")
    if older_than_days is not None:
        where.append("julianday('now') - julianday(created_at) >= ?")
        values.append(int(older_than_days))
    cursor = conn.execute(
        f"DELETE FROM session_events WHERE {' AND '.join(where)}",
        values,
    )
    conn.commit()
    return {"purged_stream_events": cursor.rowcount}
