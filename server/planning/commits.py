"""The commits Valkama knows, taken from the records the Git hook leaves.

A commit is the pair of a registry project and a hash: one row of `commits`, with
the session, agent and client of the hook that reported it. The Git hook writes
no store; it leaves a record beside it (`hooks.commit_records`), and the client
hook of the session that made the commit takes it here, in a transaction of its
own, after the shell call the commit was made in.

`take` records the commits of each record, oldest first. Taking a record twice
inserts nothing the second time: the pair is unique. A record that changes nothing
is worked off, and whoever reads it may delete its file, inside a transaction not
yet committed as well: what makes it worked off is either committed already or
written in that same transaction from a file nobody deletes before it commits.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass, field

#: The tool a client hook's own call is bound under (`calls.bind`): what it writes is
#: Valkama's, and the session and agent of the commit live on the commit's row.
HOOK_TOOL = "commit-hook"


@dataclass(frozen=True)
class Hook:
    """The client hook taking records: its client, its session and, inside a subagent,
    the agent; `now` is when it reported the commits."""

    client: str
    session_id: str
    agent_id: str | None
    now: str


@dataclass
class Taken:
    """What one `take` did: the lines that answer the agent, the files of the records that
    changed the store, and those that changed nothing (worked off)."""

    lines: list[str] = field(default_factory=list)
    applied: list[str] = field(default_factory=list)
    worked_off: list[str] = field(default_factory=list)

    @property
    def done(self) -> list[str]:
        """Every file `take` is through with, to delete once the transaction commits."""

        return [*self.applied, *self.worked_off]


def agent_of(hook: Hook, record: dict) -> str | None:
    """Which agent made the record's commits.

    The hook input's `agent_id` when it has one. Codex gives a subagent born of a
    thread its own thread id, which the shell's `CODEX_THREAD_ID` carries, while its
    hooks carry the parent's session: a record whose thread is not the session is
    that agent's.
    """

    if hook.agent_id:
        return hook.agent_id
    codex = record.get("codex")
    if hook.client == "codex" and isinstance(codex, dict):
        thread = codex.get("thread_id")
        if isinstance(thread, str) and thread and thread != hook.session_id:
            return thread
    return None


def take(conn: sqlite3.Connection, records: Iterable[tuple[str, dict]], hook: Hook) -> Taken:
    """Record the commits of each record inside the caller's transaction, oldest first."""

    taken = Taken()
    for path, record in records:
        agent = agent_of(hook, record)
        changed = False
        for commit in record["commits"]:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO commits(project_id, hash, subject, committed_at,"
                " session_id, agent_id, client, reported_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    record["project_id"],
                    commit["hash"],
                    commit["subject"],
                    commit["committed_at"],
                    hook.session_id,
                    agent,
                    hook.client,
                    hook.now,
                ),
            )
            changed = changed or cursor.rowcount > 0
        (taken.applied if changed else taken.worked_off).append(path)
    return taken
