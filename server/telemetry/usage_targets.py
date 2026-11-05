"""Which transcripts there are to read, sessions still open first.

The sessions the store knows, by the transcript path their client reported. A subagent's
file sits in a folder beside its parent's, and a Codex child thread's rollout in the same
or a following day's folder, naming its parent in its first line. Nothing else is
crawled. A transcript the client has since deleted is read from Valkama's archive of it,
at the same offset, since the archive holds the same bytes.

A session that ended and had nothing new in a pass that reached all its files is settled:
until it is heard from again, nothing of it is even looked at. That is kept in memory,
so the first whole pass after a start looks at everything once. A pass that ran out of
time in the middle of a session has settled nothing, whatever it had read of it.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .. import sessions, transcripts
from ..hooks.normalize import normalize_path
from ..planning import agents

CODEX = "codex"
CLAUDE = "claude"
#: How much of a rollout's first line is read for who its parent is.
_HEAD_BYTES = 256 * 1024
_ROLLOUT_DAYS_AHEAD = 1


@dataclass
class Target:
    """One transcript to read and where it might be."""

    session: str
    agent: str
    client: str
    path: str = ""
    archive: str = ""
    #: The session's own transcript, which a subagent's file sits beside.
    parent: str = ""


def _rollout_head(path: str) -> tuple[str, str] | None:
    """A rollout's thread and the thread it was spawned by, from its first line."""

    try:
        with open(path, "rb") as handle:
            row = json.loads(handle.readline(_HEAD_BYTES))
    except (OSError, ValueError):
        return None
    payload = row.get("payload") if isinstance(row, dict) else None
    if not isinstance(payload, dict) or not payload.get("id"):
        return None
    return str(payload["id"]), str(payload.get("parent_thread_id") or "")


def _rollout_folders(path: str) -> list[Path]:
    """The folder of a rollout and of the day after it: threads outlive midnight."""

    folder = Path(path).parent
    found = [folder]
    try:
        day = dt.date(int(folder.parent.parent.name), int(folder.parent.name), int(folder.name))
    except ValueError:
        return found
    for ahead in range(1, _ROLLOUT_DAYS_AHEAD + 1):
        later = day + dt.timedelta(days=ahead)
        found.append(
            folder.parents[2] / f"{later.year:04}" / f"{later.month:02}" / f"{later.day:02}"
        )
    return found


class Finder:
    """What one store's reader remembers about where to look."""

    def __init__(self, conn: sqlite3.Connection, archive_root: str) -> None:
        self.conn = conn
        self.archive_root = archive_root
        self._rollouts: dict[str, tuple[str, str] | None] = {}
        self._settled: dict[str, str] = {}

    def targets(self, moved: set[str]) -> Iterator[Target]:
        """Everything to look at. `moved` is filled in by the caller as it finds new bytes."""

        archives = self._archives()
        rows = self.conn.execute(
            "SELECT id, client, transcript_path, status, last_seen FROM sessions"
            " WHERE parent_session_id = '' ORDER BY status != 'active', last_seen DESC"
        ).fetchall()
        known = {str(row["id"]) for row in rows}
        for row in rows:
            session, client = str(row["id"]), sessions.client_family(row["client"])
            seen = str(row["last_seen"] or "")
            if self._settled.get(session) == seen:
                continue
            path = normalize_path(str(row["transcript_path"] or ""))
            kept = archives.get(session, {})
            if client not in (CLAUDE, CODEX) or not (path or kept):
                continue
            if client == CODEX and self._parent_is_read(path, known):
                continue
            yield Target(session, "", client, path, kept.get("", ""), path)
            if client == CODEX:
                yield from self._codex_children(session, path)
            else:
                yield from self._claude_agents(session, path, kept)
            if row["status"] != "active" and session not in moved:
                self._settled[session] = seen

    def _archives(self) -> dict[str, dict[str, str]]:
        found: dict[str, dict[str, str]] = {}
        for row in self.conn.execute(
            "SELECT session_id, COALESCE(agent_id, '') AS agent, archive_path FROM execution_events"
            " WHERE kind = ? AND COALESCE(archive_path, '') != '' AND session_id IS NOT NULL"
            " ORDER BY id",
            (transcripts.ARCHIVED,),
        ):
            found.setdefault(str(row["session_id"]), {})[str(row["agent"])] = os.path.join(
                self.archive_root, *str(row["archive_path"]).split("/")
            )
        return found

    def _head(self, path: str) -> tuple[str, str] | None:
        if path not in self._rollouts:
            self._rollouts[path] = _rollout_head(path)
        return self._rollouts[path]

    def _parent_is_read(self, path: str, known: set[str]) -> bool:
        """Whether this thread is another session's child, and so is read under that session.

        A child thread may report as a session of its own. Reading it there as well would
        count it twice.
        """

        head = self._head(path) if path else None
        return head is not None and head[1] in known

    def _claude_agents(self, session: str, path: str, kept: dict[str, str]) -> Iterator[Target]:
        found = {agent for agent in kept if agent}
        if path:
            with_files = os.path.join(os.path.dirname(path), session, "subagents")
            try:
                with os.scandir(with_files) as entries:
                    for entry in entries:
                        name = entry.name
                        if name.startswith("agent-") and name.endswith(".jsonl"):
                            found.add(name[len("agent-") : -len(".jsonl")])
            except OSError:
                pass
        for agent in sorted(found):
            yield Target(
                session,
                agent,
                CLAUDE,
                agents.agent_transcript(path, session, agent),
                kept.get(agent, ""),
                path,
            )

    def _codex_children(self, session: str, path: str) -> Iterator[Target]:
        """Threads spawned from this session, directly or through another child."""

        if not path:
            return
        files: dict[str, str] = {}
        parents: dict[str, str] = {}
        for folder in _rollout_folders(path):
            try:
                names = os.listdir(folder)
            except OSError:
                continue
            for name in names:
                if not (name.startswith("rollout-") and name.endswith(".jsonl")):
                    continue
                full = str(folder / name)
                head = self._head(full)
                if head is not None:
                    files[head[0]] = full
                    parents[head[0]] = head[1]
        for thread, full in sorted(files.items()):
            walk, hops = parents.get(thread, ""), 0
            while walk and walk != session and hops < len(parents):
                walk, hops = parents.get(walk, ""), hops + 1
            if walk == session:
                yield Target(session, thread, CODEX, full, "", path)
