"""Essential session lifecycle and exact Planning association context.

Historical session events remain stored; current ingestion admits lifecycle only.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3

from .projects import project_registry
from .store_identity.metadata import read_store_metadata
from .store_identity.refs import planning_space_entity

# The current contract is docs/product-model.md#work-item-context. The historic
# class value is retained for lifecycle rows so existing durable records keep
# their identity; this is not an analytics or universal stream admission path.
SESSION_EVENT_KINDS = {
    "session_start": "analytics",
    "session_end": "analytics",
    "turn_end": "analytics",
    "attention": "analytics",
}

# A finished turn is a session waiting for its owner, not a finished session --
# clients end a turn many times per session. It rings the inbox, and the next
# sign of work clears it again without anyone acknowledging anything.
WAITING_ATTENTION = "waiting"

#: The one `source` of a session start that starts nothing: the running client
#: compacted its context, and its turn and its subagents go on, in the middle of a
#: turn too. Claude Code and Codex both send it. Every other start is a new run:
#: `startup`, `resume`, `clear`, `fork` and one that names no source, which an
#: earlier client or a value not known here may be. So a reader asking whether the
#: client really started compares with this and with nothing else.
COMPACTED_START = "compact"

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

#: What Claude Code names a folder's transcripts by: its absolute path with every
#: non-alphanumeric character a `-`. A longer name is cut at the limit and given a
#: hash of the whole path, which only the client can compute, so it is compared up to
#: the cut. The drive's letter comes in either case: the extension writes `c--Users-…`.
_NOT_IN_A_PROJECT_NAME = re.compile(r"[^0-9A-Za-z]")
_PROJECT_NAME_LIMIT = 200


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
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"session": session_id, "event": kind, "klass": klass, "id": cursor.lastrowid}


#: Second precision, the format `sessions.last_seen` has always had. Kept so
#: older builds and every reader still compare these columns as text.
_SECOND = 19


def _second(at: str) -> str:
    """`at` (UTC, `%Y-%m-%dT%H:%M:%S` with any fraction) cut to the stored precision."""

    if len(at) < _SECOND or at[10] != "T":
        raise ValueError(f"session time {at!r} is not a UTC timestamp")
    return at[:_SECOND] + "Z"


def subagent_session_id(session_id: str, agent_id: str) -> str:
    """The row id of a subagent: its parent session and its own agent id."""

    return f"{session_id}:{agent_id}"


def touch(
    conn: sqlite3.Connection,
    session_id: str,
    *,
    client: str,
    at: str,
    cwd: str = "",
    transcript_path: str = "",
    parent_session_id: str = "",
    agent_id: str = "",
    client_version: str = "",
) -> bool:
    """Make sure one session row exists and advance its heartbeat to `at`.

    The one upsert behind every sign of life a session gives -- a hook event,
    and a confirmed tool call -- so all of them agree on what moving a session
    forward means. Runs inside the caller's transaction.

    `last_seen` becomes the later of what it was and `at`, never "now", so
    replaying old events can never make a dead session look live. The answer is
    whether `at` is current: a new row, or not older than the row's
    `last_seen`. Only a current event may change the row's other columns or its
    state; an older one is history.
    """

    second = _second(at)
    row = conn.execute("SELECT last_seen FROM sessions WHERE id = ?", (session_id,)).fetchone()
    described = {
        "cwd": cwd,
        "transcript_path": transcript_path,
        "parent_session_id": parent_session_id,
        "agent_id": agent_id,
        "client_version": client_version,
    }
    if row is None:
        conn.execute(
            "INSERT INTO sessions(id, client, started_at, last_seen, cwd, transcript_path,"
            " parent_session_id, agent_id, client_version) VALUES (?,?,?,?,?,?,?,?,?)",
            (session_id, client, second, second, *described.values()),
        )
        return True
    current = second >= str(row[0])
    updates = ["last_seen = MAX(last_seen, ?)"]
    values: list[str] = [second]
    if current:
        for column, value in described.items():
            if value:
                updates.append(f"{column} = ?")
                values.append(value)
    conn.execute(f"UPDATE sessions SET {', '.join(updates)} WHERE id = ?", (*values, session_id))
    return current


def _names_folder(directory: str, folder: str) -> bool:
    """Whether a transcript's directory is the one its client keeps for this folder."""

    name = _NOT_IN_A_PROJECT_NAME.sub("-", folder).casefold()
    if len(name) <= _PROJECT_NAME_LIMIT:
        return directory.casefold() == name
    limit = _PROJECT_NAME_LIMIT
    return len(directory) > limit and directory[:limit].casefold() == name[:limit]


def transcript_folder(transcript_path: str, *folders: str) -> str:
    """Which of these folders or their parents a Claude transcript's directory names.

    The name goes one way only, so it is checked against the folders a session is known
    to have stood in. Its client looks a session up there first and an extension link in
    a window of any other folder starts an empty conversation, so this outranks what a
    session's own record says of its folder.
    """

    directory = os.path.basename(os.path.dirname(transcript_path))
    if not directory:
        return ""
    for start in folders:
        folder = start
        while folder:
            if _names_folder(directory, folder):
                return folder
            parent = os.path.dirname(folder)
            folder = parent if parent != folder else ""
    return ""


def session_folders(row: sqlite3.Row) -> tuple[str, ...]:
    """A session's folder, likeliest first: the one every caller opens it in takes the first usable.

    `opened_folder` says where the last start reported it and `cwd` where its shell stands
    now; a Claude transcript says where it was started, or `/cd` moved it. A Codex rollout
    does not say, and for Codex `cwd` is the session's working directory.
    """

    known = (row["opened_folder"], row["cwd"])
    named = (
        transcript_folder(row["transcript_path"], *known)
        if client_family(row["client"]) == "claude"
        else ""
    )
    return (named, *known)


def record_place(
    conn: sqlite3.Connection,
    session_id: str,
    *,
    opened_in: str,
    opened_host: str,
    opened_folder: str,
    host_session_id: str,
    current: bool,
    keep_folder: bool = False,
) -> None:
    """Say where a session start found its session open, inside the caller's transaction.

    A start is the one event that says where a session now is, so a current
    one replaces all four columns, the empty ones too: an id Desktop gave the
    session, left behind after it moved to VS Code, would send it back to
    Desktop. A start that is history (`current` is `touch`'s answer for it)
    places only a row that has no place yet: it waited in the spool while a
    later event went in directly, and nothing newer says where the session is.

    `keep_folder` is for a start inside a run that goes on: it reports where the shell
    has got to, which says nothing of where the session was started, so a folder the row
    has stands.
    """

    conn.execute(
        "UPDATE sessions SET opened_in = ?, opened_host = ?,"
        " opened_folder = CASE WHEN ? AND opened_folder <> '' THEN opened_folder ELSE ? END,"
        " host_session_id = ? WHERE id = ? AND (? OR (opened_in = '' AND opened_host = ''"
        " AND opened_folder = '' AND host_session_id = ''))",
        (
            opened_in,
            opened_host,
            keep_folder,
            opened_folder,
            host_session_id,
            session_id,
            current,
        ),
    )


def note_opened_in(conn: sqlite3.Connection, session_id: str, opened_in: str) -> None:
    """Move how a session is open after a confirmed call reported it, inside the caller's transaction.

    A client can resume a session without a session start, so the call is then
    the only report. It names how the session is open and not in what, so the
    other place columns stay as the last start left them.
    """

    conn.execute(
        "UPDATE sessions SET opened_in = ? WHERE id = ? AND opened_in != ?",
        (opened_in, session_id, opened_in),
    )


def name_agent(
    conn: sqlite3.Connection,
    parent_session_id: str,
    agent_id: str,
    *,
    client: str,
    at: str,
    label: str | None,
) -> None:
    """Say what an agent was started for, inside the caller's transaction.

    The parent reports this, not the agent, so it moves none of the agent's
    times: a foreground agent's call answers after its stop, and that answer is
    not a sign of its life. It holds whatever the order, because a label says
    the same thing however late it arrives: a spooled launch delivered after the
    agent's own events still names it. A row the agent's own events have not made
    yet is made here, and the first of them finds it.
    """

    second = _second(at)
    conn.execute(
        "INSERT INTO sessions(id, client, started_at, last_seen, label, parent_session_id,"
        " agent_id) VALUES (?,?,?,?,?,?,?)"
        " ON CONFLICT(id) DO UPDATE SET label = CASE WHEN excluded.label != ''"
        " THEN excluded.label ELSE label END",
        (
            subagent_session_id(parent_session_id, agent_id),
            client,
            second,
            second,
            label or "",
            parent_session_id,
            agent_id,
        ),
    )


def resume(conn: sqlite3.Connection, session_id: str, *, at: str) -> bool:
    """Make an `ended` session `active` again because it acted after its end.

    A client can resume an ended session without a new `SessionStart` and go
    on writing. Its confirmed write calls are the only evidence, and without
    this the session would read `ended` -- its claims `stale` -- while it works,
    until a lease expiry past their grace released them. Only a write the
    client proved, made now, may call this: a drained or replayed hook event is
    history and never brings a session back. A `failed` session stays failed
    until an explicit start, and an end not older than `at` stands. Runs inside
    the caller's transaction; the answer is whether the row changed.
    """

    cursor = conn.execute(
        "UPDATE sessions SET status = 'active', ended_at = NULL, attention = '',"
        " attention_seen = 0 WHERE id = ? AND status = 'ended'"
        " AND ended_at IS NOT NULL AND ended_at < ?",
        (session_id, _second(at)),
    )
    return cursor.rowcount > 0


#: What a lifecycle transition does to a session row. A terminal status stays
#: until an explicit start: a late end, turn or notification cannot downgrade a
#: `failed` session or bring an ended one back, and only a live session can be
#: waiting or blocked. A compaction (`COMPACTED_START`) shows the client is running,
#: and it answers nothing: what a live session waits for from a person still stands.
_TRANSITIONS = {
    "start": "status = 'active', ended_at = NULL, attention = '', attention_seen = 0, client = ?",
    "compacted": (
        "attention = CASE WHEN status = 'active' THEN attention ELSE '' END,"
        " attention_seen = CASE WHEN status = 'active' THEN attention_seen ELSE 0 END,"
        " status = 'active', ended_at = NULL, client = ?"
    ),
    "end": (
        "ended_at = CASE WHEN status = 'failed' THEN ended_at ELSE ? END,"
        " attention = CASE WHEN status = 'failed' THEN 'failed' ELSE 'ended' END,"
        " attention_seen = 0,"
        " status = CASE WHEN status = 'failed' THEN 'failed' ELSE 'ended' END"
    ),
    "waiting": (
        f"attention = CASE WHEN status = 'active' THEN '{WAITING_ATTENTION}' ELSE attention END,"
        " attention_seen = CASE WHEN status = 'active' THEN 0 ELSE attention_seen END"
    ),
    "blocked": (
        "attention = CASE WHEN status = 'active' THEN 'blocked' ELSE attention END,"
        " attention_seen = CASE WHEN status = 'active' THEN 0 ELSE attention_seen END"
    ),
    "working": "attention = CASE WHEN status = 'active' THEN '' ELSE attention END",
}


def transition(
    conn: sqlite3.Connection, session_id: str, name: str, *, at: str, client: str = ""
) -> None:
    """Apply one lifecycle transition to an existing row, inside the caller's transaction.

    The caller decides whether the event is current (see `touch`); this only
    knows what each transition means.
    """

    if name not in _TRANSITIONS:
        raise ValueError(f"unknown session transition {name!r}")
    if name in ("start", "compacted"):
        parameters: tuple[str, ...] = (client,)
    elif name == "end":
        parameters = (_second(at),)
    else:
        parameters = ()
    conn.execute(
        f"UPDATE sessions SET {_TRANSITIONS[name]} WHERE id = ?", (*parameters, session_id)
    )


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
        "SELECT s.id, s.client, s.cwd, s.opened_folder, s.transcript_path, s.status,"
        " s.last_seen,"
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
    folders = [folder for folder in session_folders(row) if folder]
    folder = next((folder for folder in folders if os.path.isdir(folder)), "".join(folders[:1]))
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
            "session_folder": folder,
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
        "session_folder": folder,
        "status": row["status"],
        "work_item": scope["work_item"],
        "space_root": root,
        "detail": f"{row['client']} · {row['status']} · {row['cwd'] or 'no directory'}",
        "at": row["last_seen"],
    }
