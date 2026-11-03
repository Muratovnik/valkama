"""Writing hook events into the store, directly or from the spool.

The direct write is a light open of a store that is already current: no
migration lock, no adoption, no integrity check, and never a new file. A hook
process does not bring a store up; the next full `store.connect()` does, and
until then events wait in the spool.

One event is one `execution_events` row plus what it says about its session.
The row's `event_uid` is the emitter's, so delivering the same event twice --
a drain that committed and then died before deleting its file -- inserts
nothing the second time and changes no session.
"""

from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass
from urllib.parse import quote

from .. import sessions, transcripts
from . import spool
from .normalize import AGENT_LAUNCH, HookEvent

#: A hook event is the client's own report about its own session.
IDENTITY_STATE = "confirmed"
IDENTITY_SOURCE = "hook"

#: How long a hook waits for a writer before it spools: far under the shortest
#: client hook timeout (Codex gives `SessionEnd` three seconds).
BUSY_TIMEOUT_SECONDS = 1.0

#: What a hook drains after its own write, so the client is not kept waiting
#: behind a backlog; the server's start-up drain takes the rest.
HOOK_DRAIN_FILES = 50
HOOK_DRAIN_SECONDS = 0.3

#: Which session transition each kind applies, when the event is current.
_TRANSITIONS = {
    "session_start": "start",
    "session_end": "end",
    "subagent_start": "start",
    "subagent_stop": "end",
    "turn_end": "waiting",
    "attention": "blocked",
    "prompt": "working",
}
_SESSION_KINDS = frozenset({"session_start", "session_end"})
_SUBAGENT_KINDS = frozenset({"subagent_start", "subagent_stop"})


class UnwritableError(Exception):
    """The store cannot take a direct write now; `reason` says why, for the spool line."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


def _uri(path: str) -> str:
    """A read-write URI for an existing file: SQLite refuses rather than creating one."""

    absolute = os.path.abspath(path).replace(os.sep, "/")
    if not absolute.startswith("/"):
        absolute = "/" + absolute
    return f"file://{quote(absolute, safe='/:')}?mode=rw"


def open_light(path: str, schema_version: int) -> sqlite3.Connection:
    """Open a store that exists and is at `schema_version`, or raise `UnwritableError`."""

    if not os.path.isfile(path):
        raise UnwritableError("missing")
    try:
        conn = sqlite3.connect(
            _uri(path), uri=True, timeout=BUSY_TIMEOUT_SECONDS, isolation_level=None
        )
    except sqlite3.Error as error:
        raise UnwritableError("error", str(error)) from error
    try:
        stored = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if stored != schema_version:
            raise UnwritableError("schema", f"store {stored}, hook {schema_version}")
        conn.execute("PRAGMA foreign_keys=ON")
    except sqlite3.Error as error:
        conn.close()
        raise UnwritableError(_reason(error), str(error)) from error
    except UnwritableError:
        conn.close()
        raise
    return conn


def _reason(error: sqlite3.Error) -> str:
    text = str(error).lower()
    return "busy" if "locked" in text or "busy" in text else "error"


def record(
    conn: sqlite3.Connection, event: HookEvent, *, delivery: str, spooled_at: str | None = None
) -> bool:
    """Record one event inside the caller's transaction; false when it was already there."""

    cursor = conn.execute(
        "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
        " delivery, occurred_at, spooled_at, client, hook_event, session_id, agent_id,"
        " agent_type, turn_id, permission_mode, model, source, reason, cwd, transcript_path)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        " ON CONFLICT(event_uid) DO NOTHING",
        (
            event.event_uid,
            event.kind,
            IDENTITY_STATE,
            IDENTITY_SOURCE,
            delivery,
            event.occurred_at,
            spooled_at,
            event.client,
            event.hook_event,
            event.session_id,
            event.agent_id,
            event.agent_type,
            event.turn_id,
            event.permission_mode,
            event.model,
            event.source,
            event.reason,
            event.cwd,
            event.agent_transcript_path or event.transcript_path,
        ),
    )
    if cursor.rowcount == 0:
        return False
    _apply_to_sessions(conn, event)
    return True


def _apply_to_sessions(conn: sqlite3.Connection, event: HookEvent) -> None:
    """Advance the session rows the event belongs to, and apply its transition if current.

    A subagent's events carry its parent's session id plus its own agent id.
    The parent row is written first, then the subagent's own row; the
    transition applies to the row the event is about. A session start or end
    is always about the top-level session.
    """

    top = event.session_id
    current = sessions.touch(
        conn,
        top,
        client=event.client,
        at=event.occurred_at,
        cwd=event.cwd or "",
        transcript_path=event.transcript_path or "",
    )
    if event.kind == "session_start" and event.opened_in is not None:
        sessions.record_place(
            conn,
            top,
            opened_in=event.opened_in,
            opened_host=event.opened_host or "",
            opened_folder=event.cwd or "",
            host_session_id=event.host_session_id or "",
            current=current,
        )
    if event.kind == AGENT_LAUNCH:
        # The event's agent is the one it started, not the one it came from. The
        # label reaches this row only: `execution_events` can never be edited, and
        # a label may hold what its owner later wants gone.
        sessions.name_agent(
            conn,
            top,
            str(event.agent_id),
            client=event.client,
            at=event.occurred_at,
            label=event.label,
        )
        return
    target = top
    if event.agent_id and event.kind not in _SESSION_KINDS:
        target = sessions.subagent_session_id(top, event.agent_id)
        current = sessions.touch(
            conn,
            target,
            client=event.client,
            at=event.occurred_at,
            cwd=event.cwd or "",
            transcript_path=event.agent_transcript_path or "",
            parent_session_id=top,
            agent_id=event.agent_id,
        )
    elif event.kind in _SUBAGENT_KINDS:
        return  # a subagent event that names no subagent says nothing about the parent's state
    name = _TRANSITIONS.get(event.kind)
    if name is not None and current:
        sessions.transition(conn, target, name, at=event.occurred_at, client=event.client)


def write(
    conn: sqlite3.Connection, events: list[tuple[HookEvent, str | None]], *, delivery: str
) -> int:
    """Record events in one transaction and return how many were new."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        inserted = sum(
            record(conn, event, delivery=delivery, spooled_at=spooled_at)
            for event, spooled_at in events
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return inserted


@dataclass
class DrainResult:
    """What one drain did: files delivered, events new to the store, files set aside."""

    files: int = 0
    inserted: int = 0
    rejected: int = 0
    stopped: str = ""


def drain(
    conn: sqlite3.Connection,
    directory: str,
    *,
    max_files: int | None = None,
    seconds: float | None = None,
) -> DrainResult:
    """Deliver pending spool files in order, one transaction per file.

    A file is deleted only after its transaction commits, so a crash in between
    replays it as no-ops. A file another process holds is left for the next
    drain; a store error stops the drain and leaves the rest pending.

    Nothing a file holds makes a drain raise. A file is read from disk, so its
    content is input: one that fails validation, or that fails to apply for any
    reason other than the store itself, is set aside as `*.rejected` and the
    drain goes on. A long-lived process drains at start-up, and a file left
    pending that raised would stop every later start the same way.
    """

    result = DrainResult()
    deadline = time.monotonic() + seconds if seconds is not None else None
    names = spool.pending(directory)
    for name in names if max_files is None else names[:max_files]:
        if deadline is not None and time.monotonic() >= deadline:
            break
        path = os.path.join(directory, name)
        try:
            events = spool.read(path)
        except OSError:
            continue
        except Exception:  # noqa: BLE001 -- file content, never a reason to stop
            events = None
        if events is None:
            result.rejected += spool.reject(path)
            continue
        try:
            result.inserted += write(conn, list(events), delivery="spooled")
        except sqlite3.Error as error:
            result.stopped = str(error)
            break
        except Exception:  # noqa: BLE001 -- `write` rolled back; the file is the cause
            result.rejected += spool.reject(path)
            continue
        spool.remove(path)
        result.files += 1
    return result


def _archive(
    conn: sqlite3.Connection, event: HookEvent, store_path: str, *, deadline: float
) -> None:
    """Copy the transcript an ending session names, inside the hook's budget.

    The event is already committed, so nothing here can lose it. A copy that
    does not fit, or a row the store would not take now, leaves the end pending
    for `transcripts.sweep`.
    """

    try:
        transcripts.archive_event(conn, event, store_path=store_path, deadline=deadline)
    except sqlite3.Error:
        pass


def deliver(
    event: HookEvent, *, store_path: str, schema_version: int, occurred_ns: int, now: str
) -> str:
    """Write one event directly and drain a little, or spool it. Returns what happened.

    After a direct write of a session end or subagent stop, the transcript it
    names is archived when the copy fits the hook's budget; see `transcripts`.
    """

    started = time.monotonic()
    directory = spool.directory(store_path)
    try:
        conn = open_light(store_path, schema_version)
    except UnwritableError as refusal:
        spool.write(
            directory, event, occurred_ns=occurred_ns, spooled_at=now, reason=refusal.reason
        )
        return refusal.reason
    try:
        try:
            inserted = write(conn, [(event, None)], delivery="direct")
        except sqlite3.Error as error:
            spool.write(
                directory, event, occurred_ns=occurred_ns, spooled_at=now, reason=_reason(error)
            )
            return _reason(error)
        if inserted:
            _archive(conn, event, store_path, deadline=started + transcripts.HOOK_SECONDS)
        drain(conn, directory, max_files=HOOK_DRAIN_FILES, seconds=HOOK_DRAIN_SECONDS)
        return "direct"
    finally:
        conn.close()
