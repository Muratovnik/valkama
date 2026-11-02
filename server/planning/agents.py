"""Which agents stand on a work item, and how that is known.

A session's agents are recorded, and so is what they wrote, but an agent that
wrote nothing is linked to no work item by anything written down. So the link is
read, never stored: `exact` when the agent wrote to the item or holds one of its
steps, `claim` when its parent session held the item at the moment it started.
A parent holding several items puts the agent on each and the row says how many,
because a guess written into a column would read as a fact. The claim is only for
an agent nothing else places: one that wrote to any item stands where it wrote. An
agent whose parent held nothing and that wrote nothing stands on no card.

Everything a row says is what the record shows. A session row does not prove a
process is alive and a subagent cut off by a restart leaves no end, so a row gives
the last sign of activity Valkama saw, and an end only when one was recorded. A
running agent's own tool calls reach no hook here, so between its start and its
end its writes to Planning move that sign, and so does the time its transcript
file was last written, read when the card is read. Only that file's time is read:
its content is never opened, and a missing or unreadable file counts for nothing.

Claude Code only for now: `_LISTED_FAMILY` is where that is decided.
"""

from __future__ import annotations

import os
import re
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime

from .. import sessions
from . import calls

EXACT = "exact"
CLAIM = "claim"

_LISTED_FAMILY = "claude"
#: The name a Claude Code holder opens with; see `calls.holder_label`.
_HOLDER_NAME = "claude"

_OPENS_A_HOLD = ("claimed", "taken_over")

#: What says Claude Code started an agent. An agent it runs for itself (a prompt
#: suggestion, a side question) reports a stop and no start.
_STARTED_KINDS = frozenset({"subagent_start", "agent_launch"})
#: What is recorded about an agent without being the agent acting: Valkama's copy
#: of its transcript, and the parent's report of the launch.
_NOT_ITS_ACTIVITY = frozenset({"transcript_archived", "transcript_purged", "agent_launch"})

_SECOND = 19
#: The ids that may name a file: letters, digits, `_` and `-`, nothing that could be a path part.
_FILE_ID = re.compile(r"[A-Za-z0-9_-]+")


def _moment(value: object) -> str:
    """A stored time of either precision as the second it falls in; empty for none."""

    return str(value)[:_SECOND] if value else ""


def _stamp(moment: str) -> str | None:
    return f"{moment}Z" if moment else None


def _agent_transcript(parent_transcript: str, session_id: str, agent_id: str) -> str:
    """Where Claude Code keeps one subagent's transcript; empty when there is none to name.

    The subagent's file sits in a folder named for the parent session, beside the
    parent's own transcript: `<dir>/<sessionId>/subagents/agent-<agentId>.jsonl`.
    """

    if not (parent_transcript and _FILE_ID.fullmatch(session_id) and _FILE_ID.fullmatch(agent_id)):
        return ""
    return os.path.join(
        os.path.dirname(parent_transcript), session_id, "subagents", f"agent-{agent_id}.jsonl"
    )


def _file_moment(path: str) -> str:
    """When a file was last written, as `_moment` reads a stored time; empty when it cannot be read.

    Only the file's status is asked for. Its content is never opened.
    """

    if not path:
        return ""
    try:
        written = os.stat(path).st_mtime
    except OSError:
        return ""
    return datetime.fromtimestamp(int(written), UTC).strftime("%Y-%m-%dT%H:%M:%S")


def _holds_activity(conn: sqlite3.Connection) -> bool:
    """Whether this store records agents: one an earlier build wrote may not."""

    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(sessions)")}
    recorded = {str(row[1]) for row in conn.execute("PRAGMA table_info(execution_events)")}
    return "parent_session_id" in columns and "agent_id" in recorded


@dataclass(frozen=True)
class _Hold:
    session_id: str
    start: str
    end: str

    def covers(self, moment: str) -> bool:
        # A claim and a launch in one second count: the times are whole seconds,
        # and claiming and then launching is the order that matters.
        return self.start <= moment and (not self.end or moment < self.end)


def _holds(rows: Iterable[Mapping]) -> dict[str, list[_Hold]]:
    """Each item's holds by a coordinating session, from its claim events in order.

    Only a session's own confirmed claim counts. A claim an agent took is that
    agent's, and it says nothing about what its siblings were started for; it and
    any other claim still end the hold before it, as a release does.
    """

    holds: dict[str, list[_Hold]] = {}
    open_holds: dict[str, tuple[str, str]] = {}

    def close(item: str, moment: str) -> None:
        current = open_holds.pop(item, None)
        if current is not None:
            holds.setdefault(item, []).append(_Hold(current[0], current[1], moment))

    for row in rows:
        item, moment = str(row["work_item_id"]), _moment(row["created_at"])
        if row["action"] not in _OPENS_A_HOLD:
            close(item, moment)
            continue
        coordinating = (
            row["identity_state"] == calls.CONFIRMED
            and bool(row["session_id"])
            and not row["agent_id"]
        )
        session_id = str(row["session_id"]) if coordinating else ""
        current = open_holds.get(item)
        if current is not None and current[0] == session_id:
            continue
        close(item, moment)
        if session_id:
            open_holds[item] = (session_id, moment)
    for item in list(open_holds):
        close(item, "")
    return holds


def _holds_of_item(conn: sqlite3.Connection, work_item_id: str) -> list[_Hold]:
    rows = conn.execute(
        "SELECT e.work_item_id, e.action, e.created_at, c.identity_state, c.session_id, c.agent_id"
        " FROM work_item_events e LEFT JOIN execution_events c ON c.id = e.call_id"
        " WHERE e.action IN ('claimed', 'taken_over', 'released') AND e.work_item_id = ?"
        " ORDER BY e.id",
        (work_item_id,),
    )
    return _holds(rows).get(work_item_id, [])


def _holds_of_session(conn: sqlite3.Connection, session_id: str) -> list[_Hold]:
    """Every hold of one session, over every item it ever wrote to."""

    rows = conn.execute(
        "SELECT e.work_item_id, e.action, e.created_at, c.identity_state, c.session_id, c.agent_id"
        " FROM work_item_events e LEFT JOIN execution_events c ON c.id = e.call_id"
        " WHERE e.action IN ('claimed', 'taken_over', 'released') AND e.work_item_id IN"
        " (SELECT work_item_id FROM execution_events WHERE kind = ? AND session_id = ?"
        " AND identity_state = ? AND work_item_id IS NOT NULL AND COALESCE(agent_id, '') = '')"
        " ORDER BY e.work_item_id, e.id",
        (calls.KIND, session_id, calls.CONFIRMED),
    )
    return [
        hold for found in _holds(rows).values() for hold in found if hold.session_id == session_id
    ]


@dataclass
class _Agent:
    """One agent as far as the record goes, before it is known to be on this item."""

    agent_id: str
    session_id: str
    client: str = ""
    agent_type: str = ""
    label: str = ""
    started_at: str = ""
    last_activity: str = ""
    ended_at: str = ""
    started: bool = False
    link: str = ""
    coordinator_items: int | None = None
    steps: list[dict] = field(default_factory=list)


def _agents_of(conn: sqlite3.Connection, session_id: str) -> dict[str, _Agent]:
    """Every agent one session's events and rows name."""

    found: dict[str, _Agent] = {}
    for row in conn.execute(
        "SELECT agent_id, kind, agent_type, client, identity_state,"
        " COALESCE(occurred_at, received_at) AS at FROM execution_events"
        " WHERE session_id = ? AND COALESCE(agent_id, '') != '' ORDER BY id",
        (session_id,),
    ):
        if row["identity_state"] != calls.CONFIRMED:
            continue
        agent = found.setdefault(str(row["agent_id"]), _Agent(str(row["agent_id"]), session_id))
        agent.client = agent.client or str(row["client"] or "")
        agent.agent_type = str(row["agent_type"] or "") or agent.agent_type
        agent.started = agent.started or row["kind"] in _STARTED_KINDS
        if row["kind"] not in _NOT_ITS_ACTIVITY:
            moment = _moment(row["at"])
            agent.started_at = agent.started_at or moment
            agent.last_activity = max(agent.last_activity, moment)
    for row in conn.execute(
        "SELECT agent_id, client, label, started_at, last_seen, ended_at FROM sessions"
        " WHERE parent_session_id = ? AND agent_id != ''",
        (session_id,),
    ):
        agent = found.setdefault(str(row["agent_id"]), _Agent(str(row["agent_id"]), session_id))
        agent.client = str(row["client"] or "") or agent.client
        agent.label = str(row["label"] or "")
        agent.started_at = _moment(row["started_at"])
        agent.last_activity = max(agent.last_activity, _moment(row["last_seen"]))
        agent.ended_at = _moment(row["ended_at"])
    return found


def _writers(conn: sqlite3.Connection, session_id: str) -> set[str]:
    """The agents of one session whose own confirmed call wrote to some item."""

    return {
        str(row[0])
        for row in conn.execute(
            "SELECT DISTINCT agent_id FROM execution_events"
            " WHERE kind = ? AND session_id = ? AND identity_state = ?"
            " AND work_item_id IS NOT NULL AND COALESCE(agent_id, '') != ''",
            (calls.KIND, session_id, calls.CONFIRMED),
        )
    }


def _steps_held(session_id: str, agent_id: str, checklist: Iterable[Mapping]) -> list[dict]:
    held = calls.holder_label(_HOLDER_NAME, session_id, agent_id)
    return [
        {"id": step["id"], "text": step["text"]}
        for step in checklist
        if step.get("claimed_by") == held and not step.get("done")
    ]


def _present(agent: _Agent, checklist: Iterable[Mapping]) -> dict:
    return {
        "agent_id": agent.agent_id,
        "session_id": agent.session_id,
        "agent_type": agent.agent_type,
        "label": agent.label,
        "started_at": _stamp(agent.started_at),
        "last_activity_at": _stamp(agent.last_activity),
        "ended_at": _stamp(agent.ended_at),
        "steps": _steps_held(agent.session_id, agent.agent_id, checklist),
        "link": agent.link,
        "coordinator_items": agent.coordinator_items,
    }


def on_item(
    conn: sqlite3.Connection, work_item_id: str, checklist: Iterable[Mapping]
) -> list[dict]:
    """The agents on one item, the most recent activity first; see the module's rule."""

    if not _holds_activity(conn):
        return []
    steps = list(checklist)
    known: dict[str, dict[str, _Agent]] = {}
    transcripts: dict[str, str] = {}

    def agents_of(session_id: str) -> dict[str, _Agent]:
        if session_id not in known:
            known[session_id] = _agents_of(conn, session_id)
        return known[session_id]

    def transcript_of(session_id: str) -> str:
        if session_id not in transcripts:
            row = conn.execute(
                "SELECT transcript_path FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            transcripts[session_id] = str(row[0] or "") if row is not None else ""
        return transcripts[session_id]

    chosen: dict[tuple[str, str], _Agent] = {}
    for row in conn.execute(
        "SELECT DISTINCT session_id, agent_id FROM execution_events"
        " WHERE kind = ? AND work_item_id = ? AND identity_state = ?"
        " AND COALESCE(agent_id, '') != '' AND COALESCE(session_id, '') != ''",
        (calls.KIND, work_item_id, calls.CONFIRMED),
    ):
        agent = agents_of(str(row["session_id"])).get(str(row["agent_id"]))
        if agent is not None:
            agent.link = EXACT
            chosen[(agent.session_id, agent.agent_id)] = agent

    by_session: dict[str, list[_Hold]] = {}
    for hold in _holds_of_item(conn, work_item_id):
        by_session.setdefault(hold.session_id, []).append(hold)
    for session_id, holds in by_session.items():
        everything: list[_Hold] | None = None
        placed = _writers(conn, session_id)
        for agent in agents_of(session_id).values():
            key = (session_id, agent.agent_id)
            if key in chosen or not agent.started or agent.agent_id in placed:
                continue
            if not any(hold.covers(agent.started_at) for hold in holds):
                continue
            if everything is None:
                everything = _holds_of_session(conn, session_id)
            agent.link = CLAIM
            agent.coordinator_items = sum(hold.covers(agent.started_at) for hold in everything)
            chosen[key] = agent

    listed = [
        agent for agent in chosen.values() if sessions.client_family(agent.client) == _LISTED_FAMILY
    ]
    for agent in listed:
        if not agent.ended_at:
            path = _agent_transcript(
                transcript_of(agent.session_id), agent.session_id, agent.agent_id
            )
            agent.last_activity = max(agent.last_activity, _file_moment(path))
    listed.sort(key=lambda agent: (agent.last_activity, agent.agent_id), reverse=True)
    return [_present(agent, steps) for agent in listed]


def signal(conn: sqlite3.Connection) -> int | None:
    """A number that moves when anything is recorded about any agent.

    The card's event stream sends it, so an open card reads its agents again when
    one starts, stops or is named. None of that changes a list row, and a stream
    frame is written only for a changed payload, so no frame would otherwise say it.
    """

    if not _holds_activity(conn):
        return None
    row = conn.execute(
        "SELECT id FROM execution_events WHERE COALESCE(agent_id, '') != ''"
        " ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return int(row[0]) if row is not None else None
