"""The local transcript archive: a copy of each ended session's transcript, kept beside the store.

A client keeps its own transcripts only as long as it likes and deletes them on
its own schedule, so a session's record of what happened would otherwise vanish
while the work item it belongs to is still open. When a session ends, its
transcript -- and a subagent's own transcript when the client reports one -- is
copied under `transcripts/` next to the store, and the execution tree records
where the copy is and its sha256.

Transcripts hold whatever the session saw: personal data, secrets, material
under NDA. Three rules follow, and nothing here bends them:

- the copy stays on this machine, in the store's own directory, created
  owner-only where the OS supports it; the export never reads it;
- retention is explicit (`RETENTION_DAYS`, `sweep`), not "until the disk fills";
- the content never enters the database, a log line or a diagnostic. Rows carry
  paths, hashes and reasons only.

A copy is made in a hook only when it fits the hook's time budget; anything
larger, or anything the hook could not finish, stays pending -- an ended session
with no later `transcript_archived` row -- and `sweep` copies it from a
long-lived process.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import stat
import time
import uuid
from dataclasses import dataclass

from . import store
from .hooks.normalize import HookEvent, normalize_path, timestamp

ROOT_NAME = "transcripts"

ARCHIVED = "transcript_archived"
PURGED = "transcript_purged"

#: Rows this module writes are Valkama's own statement about a file it copied.
IDENTITY_STATE = "confirmed"
IDENTITY_SOURCE = "valkama"

#: The in-hook bound. Codex gives `SessionEnd` about three seconds. Interpreter
#: start and imports take about 0.15 s, the event write may wait up to the
#: one-second busy timeout, the archive row may wait the same, and the drain
#: after it takes at most 0.3 s; a copy that must end 1.2 s after delivery began
#: keeps the whole hook near 2.7 s in the worst case. 8 MiB copies and hashes in
#: well under that at any local disk speed; the deadline covers a slow disk or
#: a scanner holding the file, and an unfinished copy is simply left pending.
HOOK_MAX_BYTES = 8 * 1024 * 1024
HOOK_SECONDS = 1.2

#: How long a purged copy or an abandoned `*.partial` is left alone before
#: `sweep` removes it. A hook renames its copy into place and appends the row a
#: moment later; a sweep between the two must not take the file away from the
#: row about to name it again.
ORPHAN_GRACE_SECONDS = 600

#: Retention: kept while an open item refers to the session, and for at least this
#: long after the later of the session's last sign of life and the newest
#: terminal transition of any item that refers to it.
RETENTION_DAYS = 90

CHUNK_BYTES = 1024 * 1024
PARTIAL_SUFFIX = ".partial"
ARCHIVE_SUFFIX = ".jsonl"

#: Why a row ends a pending copy without a file: the source is gone.
SOURCE_MISSING = "source-missing"
#: Why an archive was purged.
RETENTION = "retention"

_SAFE = re.compile(r"[A-Za-z0-9._-]{1,128}")
#: Names Windows will not create, whatever the extension.
_RESERVED = re.compile(r"(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?")


class DeferredError(Exception):
    """The copy does not fit this caller's budget; it stays pending."""


class SourceMissingError(Exception):
    """The transcript the client named is not a file that exists."""


def directory(store_path: str) -> str:
    """The archive beside one store."""

    return os.path.join(os.path.dirname(os.path.abspath(store_path)), ROOT_NAME)


def safe(value: str) -> str:
    """`value` as one path component: itself when plainly safe, otherwise a digest.

    Session and agent ids come from the client. One that could climb out of
    the archive (`..`), that Windows would refuse or alias (`CON`, a trailing
    dot), or that is simply unusual is named by its sha256 instead.
    """

    if (
        _SAFE.fullmatch(value)
        and value not in {".", ".."}
        and not value.endswith(".")
        and not _RESERVED.fullmatch(value)
    ):
        return value
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def archive_path(session_id: str, agent_id: str | None, sha256: str) -> str:
    """Where one copy lives, relative to the archive root, with `/` separators."""

    name = f"main-{sha256[:16]}" if agent_id is None else f"agent-{safe(agent_id)}-{sha256[:16]}"
    return f"{safe(session_id)}/{name}{ARCHIVE_SUFFIX}"


def _absolute(root: str, relative: str) -> str:
    return os.path.join(root, *relative.split("/"))


def _mkdir(path: str) -> None:
    """One directory, owner-only where the OS honours a mode; never its parents.

    The archive root sits inside the store's directory, and a store directory
    that a hook created would make the first full open start an empty store
    instead of adopting an older one. Only the levels this module owns are made.
    """

    try:
        os.mkdir(path, 0o700)
    except FileExistsError:
        pass


@dataclass(frozen=True)
class Copy:
    """One copy in place: where it is, relative to the root, and its digest."""

    archive_path: str
    sha256: str


def copy(
    source: str,
    root: str,
    session_id: str,
    agent_id: str | None,
    *,
    max_bytes: int | None = None,
    deadline: float | None = None,
) -> Copy:
    r"""Copy one transcript into the archive and return where it landed.

    The file is streamed into a `*.partial` in the destination directory while
    it is hashed, flushed, and only then renamed to its content-addressed name,
    so a name under the root always holds the whole of what it names. If that
    name exists already, the content is identical and the partial is dropped.

    `\\?\` and `\\?\UNC\` prefixes are dropped before the source is read.
    Raises `SourceMissingError` when there is no such regular file,
    `DeferredError` when the file is over `max_bytes` or the copy reaches
    `deadline` (a `time.monotonic()` value), and `OSError` when the file cannot
    be read now. No file is left behind on any of them.
    """

    path = normalize_path(source)
    try:
        info = os.stat(path)
    except (FileNotFoundError, NotADirectoryError) as missing:
        raise SourceMissingError(path) from missing
    if not stat.S_ISREG(info.st_mode):
        raise SourceMissingError(path)
    if max_bytes is not None and info.st_size > max_bytes:
        raise DeferredError(f"{info.st_size} bytes")
    if deadline is not None and time.monotonic() >= deadline:
        raise DeferredError("no time left")
    folder = os.path.join(root, safe(session_id))
    _mkdir(root)
    _mkdir(folder)
    partial = os.path.join(folder, f".{uuid.uuid4().hex}{PARTIAL_SUFFIX}")
    digest = hashlib.sha256()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        with open(path, "rb") as reader, os.fdopen(os.open(partial, flags, 0o600), "wb") as out:
            while chunk := reader.read(CHUNK_BYTES):
                if deadline is not None and time.monotonic() >= deadline:
                    raise DeferredError("the copy ran out of time")
                digest.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        sha256 = digest.hexdigest()
        relative = archive_path(session_id, agent_id, sha256)
        final = _absolute(root, relative)
        if os.path.exists(final):
            os.remove(partial)
        else:
            os.replace(partial, final)
    except BaseException:
        _discard(partial)
        raise
    return Copy(relative, sha256)


def _discard(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _append(
    conn: sqlite3.Connection,
    *,
    kind: str,
    client: str | None,
    session_id: str,
    agent_id: str | None,
    transcript_path: str | None,
    archive: str | None = None,
    sha256: str | None = None,
    reason: str | None = None,
) -> None:
    """One row of the execution tree in its own transaction, committed before returning."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " occurred_at, client, session_id, agent_id, transcript_path, archive_path,"
            " archive_sha256, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                str(uuid.uuid4()),
                kind,
                IDENTITY_STATE,
                IDENTITY_SOURCE,
                timestamp(time.time_ns()),
                client,
                session_id,
                agent_id,
                transcript_path,
                archive,
                sha256,
                reason,
            ),
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def _record_copy(
    conn: sqlite3.Connection,
    copied: Copy,
    *,
    client: str | None,
    session_id: str,
    agent_id: str | None,
    transcript_path: str,
) -> None:
    _append(
        conn,
        kind=ARCHIVED,
        client=client,
        session_id=session_id,
        agent_id=agent_id,
        transcript_path=normalize_path(transcript_path),
        archive=copied.archive_path,
        sha256=copied.sha256,
    )


def archive_event(
    conn: sqlite3.Connection, event: HookEvent, *, store_path: str, deadline: float
) -> str:
    """The hook's attempt at the copy an ending session or subagent asks for.

    A session end archives the session's transcript; a subagent stop archives
    the subagent's own transcript, and only when the client reported one. The
    copy is bounded by `HOOK_MAX_BYTES` and `deadline`; whatever does not fit,
    and a source that is missing or unreadable now, is left pending for
    `sweep`, which decides whether it is gone for good. Returns what happened:
    `none`, `pending` or `archived`.
    """

    if event.kind == "session_end":
        source, agent_id = event.transcript_path, None
    elif event.kind == "subagent_stop" and event.agent_id:
        source, agent_id = event.agent_transcript_path, event.agent_id
    else:
        return "none"
    if not source:
        return "none"
    try:
        copied = copy(
            source,
            directory(store_path),
            event.session_id,
            agent_id,
            max_bytes=HOOK_MAX_BYTES,
            deadline=deadline,
        )
    except (DeferredError, SourceMissingError, OSError):
        return "pending"
    _record_copy(
        conn,
        copied,
        client=event.client,
        session_id=event.session_id,
        agent_id=agent_id,
        transcript_path=source,
    )
    return "archived"


@dataclass(frozen=True)
class Pending:
    """An ended session or subagent whose transcript has no copy recorded after it."""

    event_id: int
    client: str | None
    session_id: str
    agent_id: str | None
    transcript_path: str


#: The latest end per session, agent and path that no later archive row
#: answers. A subagent stop counts only for the subagent's own transcript: a
#: stop without one stores the parent's path, which other events of the same
#: session carry too. `MAX(e.id)` with bare columns takes them from that row.
_PENDING_SQL = """
SELECT MAX(e.id), e.client, e.session_id,
       CASE WHEN e.kind = 'subagent_stop' THEN e.agent_id END AS archive_agent,
       e.transcript_path
FROM execution_events e
WHERE e.session_id IS NOT NULL AND e.transcript_path IS NOT NULL
  AND (e.kind = 'session_end'
       OR (e.kind = 'subagent_stop' AND e.agent_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM execution_events o
               WHERE o.session_id = e.session_id AND o.transcript_path = e.transcript_path
                 AND o.kind NOT IN ('subagent_stop', 'transcript_archived', 'transcript_purged'))))
  AND NOT EXISTS (
      SELECT 1 FROM execution_events a
      WHERE a.session_id = e.session_id AND a.kind = 'transcript_archived'
        AND a.agent_id IS (CASE WHEN e.kind = 'subagent_stop' THEN e.agent_id END)
        AND a.transcript_path = e.transcript_path AND a.id > e.id)
GROUP BY e.session_id, archive_agent, e.transcript_path
ORDER BY 1
"""


def pending(conn: sqlite3.Connection) -> list[Pending]:
    """Every copy still owed, oldest end first."""

    return [
        Pending(int(row[0]), row[1], row[2], row[3], row[4]) for row in conn.execute(_PENDING_SQL)
    ]


@dataclass(frozen=True)
class Archive:
    """A copy the execution tree says is current: its newest row is `transcript_archived`."""

    archive_path: str
    sha256: str
    client: str | None
    session_id: str
    agent_id: str | None
    transcript_path: str | None


def current(conn: sqlite3.Connection) -> dict[str, Archive]:
    """Every archive path whose newest row is a copy rather than a purge."""

    return {path: archive for path, archive in _newest(conn).items() if archive is not None}


def purged(conn: sqlite3.Connection) -> set[str]:
    """Every archive path whose newest row is its purge: the only names a sweep deletes."""

    return {path for path, archive in _newest(conn).items() if archive is None}


def _newest(conn: sqlite3.Connection) -> dict[str, Archive | None]:
    """Each archive path any row names, with its copy, or None when its newest row is a purge."""

    newest: dict[str, Archive | None] = {}
    for row in conn.execute(
        "SELECT kind, archive_path, archive_sha256, client, session_id, agent_id,"
        " transcript_path FROM execution_events"
        " WHERE kind IN ('transcript_archived', 'transcript_purged')"
        " AND archive_path IS NOT NULL ORDER BY id"
    ):
        kind, path = row[0], str(row[1])
        newest[path] = (
            Archive(path, str(row[2]), row[3], str(row[4]), row[5], row[6])
            if kind == ARCHIVED
            else None
        )
    return newest


#: What retention needs to know about session `:s`, in one read: how many
#: non-terminal items refer to it, and the moment its retention counts from.
#:
#: An item refers to the session through a session ref naming it (exactly, by a
#: prefix of it, or as one of its subagents), through any Planning write call
#: the session made on it, or through a current claim the session took. A loose
#: ref match only keeps a copy longer.
#:
#: The moment is the later of the session's `last_seen` and the newest terminal
#: transition of a referring item (its last update when no transition was
#: recorded). A session with no row falls back to its newest event, so a copy
#: is never kept forever for want of a heartbeat.
_RETENTION_SQL = """
WITH referring(work_item_id) AS (
    SELECT r.work_item_id FROM work_item_refs r
    WHERE r.kind = 'session'
      AND (substr(:s, 1, length(r.value)) = r.value
           OR substr(r.value, 1, length(:s) + 1) = :s || ':')
    UNION
    SELECT c.work_item_id FROM execution_events c
    WHERE c.session_id = :s AND c.work_item_id IS NOT NULL
    UNION
    SELECT w.work_item_id FROM work_items w JOIN execution_events c ON c.id = w.claim_call_id
    WHERE c.session_id = :s
)
SELECT
    (SELECT COUNT(*) FROM work_items w JOIN workflow_states st ON st.state_id = w.state_id
     WHERE st.is_terminal = 0 AND w.work_item_id IN referring),
    (SELECT MAX(j) FROM (
        SELECT COALESCE(
            (SELECT julianday(last_seen) FROM sessions WHERE id = :s),
            (SELECT MAX(julianday(COALESCE(occurred_at, received_at))) FROM execution_events
             WHERE session_id = :s
               AND kind NOT IN ('transcript_archived', 'transcript_purged'))) AS j
        UNION ALL
        SELECT julianday(COALESCE(
            (SELECT MAX(ev.created_at) FROM work_item_events ev
             WHERE ev.work_item_id = w.work_item_id AND ev.action = 'transitioned'),
            w.updated_at))
        FROM work_items w WHERE w.work_item_id IN referring))
"""


def purgeable(conn: sqlite3.Connection, session_id: str, *, now: str) -> bool:
    """Whether retention lets this session's archive go at `now` (UTC timestamp)."""

    open_items, anchor = conn.execute(_RETENTION_SQL, {"s": session_id}).fetchone()
    if open_items or anchor is None:
        return False
    age = conn.execute("SELECT julianday(?) - ?", (now, anchor)).fetchone()[0]
    return age is not None and float(age) >= RETENTION_DAYS


@dataclass
class SweepResult:
    """What one sweep did. `missing` counts copies given up because the source is gone."""

    archived: int = 0
    missing: int = 0
    unreadable: int = 0
    purged: int = 0
    orphans: int = 0
    stopped: str = ""


def sweep(
    conn: sqlite3.Connection,
    *,
    seconds: float | None = None,
    root: str | None = None,
    now: str | None = None,
) -> SweepResult:
    """Copy what is pending, purge what retention releases, finish interrupted removals.

    `conn` must not be inside a transaction: each row is its own. With
    `seconds`, no new step starts once that much time has passed; a copy
    already started runs to the end, because a deadline inside it would never
    let a large transcript finish. A store error stops the sweep and leaves
    the rest for the next one.
    """

    result = SweepResult()
    root = root if root is not None else directory(store.db_path())
    now = now if now is not None else timestamp(time.time_ns())
    deadline = time.monotonic() + seconds if seconds is not None else None

    def out_of_time() -> bool:
        return deadline is not None and time.monotonic() >= deadline

    try:
        for owed in pending(conn):
            if out_of_time():
                return result
            _copy_pending(conn, owed, root, result)
        by_session: dict[str, list[Archive]] = {}
        for archive in current(conn).values():
            by_session.setdefault(archive.session_id, []).append(archive)
        for session_id, archives in sorted(by_session.items()):
            if out_of_time():
                return result
            if purgeable(conn, session_id, now=now):
                _purge(conn, root, archives)
                result.purged += len(archives)
        if not out_of_time():
            result.orphans = _remove_orphans(root, purged(conn))
    except sqlite3.Error as error:
        result.stopped = str(error)
    return result


def _adoptable(root: str, owed: Pending, archives: dict[str, Archive]) -> Copy | None:
    """A copy already in place for `owed` that no row names, newest first.

    A hook that renamed its copy into place and then could not append the row
    (the store was busy) leaves exactly this. When the client has deleted the
    source since, that file is the only copy left, so it is recorded rather
    than treated as an orphan. Its content must still match its name.
    """

    folder = safe(owed.session_id)
    prefix = "main-" if owed.agent_id is None else f"agent-{safe(owed.agent_id)}-"
    candidates = sorted(
        (
            (info.st_mtime, relative, path)
            for relative, path, info in _files(root)
            if relative.startswith(f"{folder}/{prefix}")
            and relative.endswith(ARCHIVE_SUFFIX)
            and relative not in archives
        ),
        reverse=True,
    )
    for _mtime, relative, path in candidates:
        digest = hashlib.sha256()
        try:
            with open(path, "rb") as reader:
                while chunk := reader.read(CHUNK_BYTES):
                    digest.update(chunk)
        except OSError:
            continue
        sha256 = digest.hexdigest()
        if archive_path(owed.session_id, owed.agent_id, sha256) == relative:
            return Copy(relative, sha256)
    return None


def _copy_pending(conn: sqlite3.Connection, owed: Pending, root: str, result: SweepResult) -> None:
    try:
        copied = copy(owed.transcript_path, root, owed.session_id, owed.agent_id)
    except SourceMissingError:
        adopted = _adoptable(root, owed, current(conn))
        if adopted is not None:
            _record_copy(
                conn,
                adopted,
                client=owed.client,
                session_id=owed.session_id,
                agent_id=owed.agent_id,
                transcript_path=owed.transcript_path,
            )
            result.archived += 1
            return
        # Gone for good: the client deleted it before anything could copy it.
        # One row says so, and the end stops being owed.
        _append(
            conn,
            kind=ARCHIVED,
            client=owed.client,
            session_id=owed.session_id,
            agent_id=owed.agent_id,
            transcript_path=normalize_path(owed.transcript_path),
            reason=SOURCE_MISSING,
        )
        result.missing += 1
        return
    except OSError:
        result.unreadable += 1
        return
    _record_copy(
        conn,
        copied,
        client=owed.client,
        session_id=owed.session_id,
        agent_id=owed.agent_id,
        transcript_path=owed.transcript_path,
    )
    result.archived += 1


def _purge(conn: sqlite3.Connection, root: str, archives: list[Archive]) -> None:
    """Record each purge, then delete its file: the row is committed first.

    A crash between the two leaves a file whose newest row is the purge, which
    the orphan pass of a later sweep removes.
    """

    for archive in archives:
        _append(
            conn,
            kind=PURGED,
            client=archive.client,
            session_id=archive.session_id,
            agent_id=archive.agent_id,
            transcript_path=archive.transcript_path,
            archive=archive.archive_path,
            sha256=archive.sha256,
            reason=RETENTION,
        )
        _discard(_absolute(root, archive.archive_path))
    if archives:
        _remove_if_empty(os.path.dirname(_absolute(root, archives[0].archive_path)))


def _remove_if_empty(folder: str) -> None:
    try:
        os.rmdir(folder)
    except OSError:
        pass


def _files(root: str) -> list[tuple[str, str, os.stat_result]]:
    """Every file one level below the root: (relative path, absolute path, stat)."""

    found = []
    try:
        folders = sorted(os.listdir(root))
    except OSError:
        return []
    for folder in folders:
        absolute_folder = os.path.join(root, folder)
        if not os.path.isdir(absolute_folder):
            continue
        try:
            names = sorted(os.listdir(absolute_folder))
        except OSError:
            continue
        for name in names:
            path = os.path.join(absolute_folder, name)
            try:
                info = os.stat(path)
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                found.append((f"{folder}/{name}", path, info))
    return found


def _is_unnamed(relative: str, archives: dict[str, Archive]) -> bool:
    """A file no current row names: what `doctor` reports, not what a sweep deletes."""

    name = relative.rpartition("/")[2]
    if name.endswith(PARTIAL_SUFFIX):
        return True
    return name.endswith(ARCHIVE_SUFFIX) and relative not in archives


def _removable(relative: str, purged_paths: set[str]) -> bool:
    """A file a sweep may delete: an abandoned partial, or a copy whose newest row is its purge.

    A copy no row names at all is never one of them. A store restored from a
    snapshot older than its archive, or a second store in the same directory,
    has no rows for files that may be the only copies left; such a file is
    adopted when an owed end matches it (`_adoptable`) and otherwise left for
    `doctor` to report.
    """

    name = relative.rpartition("/")[2]
    return name.endswith(PARTIAL_SUFFIX) or relative in purged_paths


def _remove_orphans(root: str, purged_paths: set[str]) -> int:
    """Remove purged copies a crash left behind, and abandoned partials, past the grace period."""

    cutoff = time.time() - ORPHAN_GRACE_SECONDS
    removed = 0
    for relative, path, info in _files(root):
        if _removable(relative, purged_paths) and info.st_mtime <= cutoff:
            try:
                os.remove(path)
            except OSError:
                continue
            removed += 1
            _remove_if_empty(os.path.dirname(path))
    return removed


def summary(conn: sqlite3.Connection, root: str) -> dict:
    """What `doctor` reports, read without writing anything.

    `archived` and `bytes` count current copies whose file is there, `lost`
    current copies whose file is not, `pending` copies still owed, and
    `orphans` files under the root that no current row names -- which a sweep
    removes only when their newest row is a purge or they are a partial.
    """

    archives = current(conn)
    files = {relative: info for relative, _path, info in _files(root)}
    present = [files[path] for path in archives if path in files]
    owed = pending(conn)
    oldest = None
    if owed:
        oldest = conn.execute(
            "SELECT COALESCE(occurred_at, received_at) FROM execution_events WHERE id = ?",
            (owed[0].event_id,),
        ).fetchone()[0]
    return {
        "archived": len(present),
        "bytes": sum(info.st_size for info in present),
        "lost": len(archives) - len(present),
        "pending": len(owed),
        "oldest_pending": oldest,
        "orphans": sum(1 for relative in files if _is_unnamed(relative, archives)),
        "path": root,
    }
