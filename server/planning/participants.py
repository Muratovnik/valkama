"""Who works on a goal or a stage: the sessions behind the work under it and those following it.

A session is a participant of a container when it is live and it, or a subagent of
it, either

- holds the claim or an open step of a task anywhere under the container, or
- follows the container or an item over it (`subscriptions`).

A participant is always a session's own conversation: its subagents are reached
through it. A task has no participants; it has a holder.

Live is one rule, whatever made the session a participant: the session half of a
live lease (`leases.session_live`). It has a row, it has not ended or failed, and it
was seen within `leases.LEASE_PERIOD`. An ended session works on nothing from the
moment it ended, with no grace: its claim stands through `leases.ENDED_GRACE` in case
it comes back, but it can neither hear nor answer. Resumed, it is a participant again
while its claim or its subscription stands. A subscription outlives a silent session
by its own rule and still carries the item's news to it when it returns, but makes
no participant of it.

Nothing here is stored. The holders and the subscriptions are, and a second copy
would drift from them, so every read derives the participants afresh. The steps'
holders are known only by their label (`calls.holder_ids`), so a session whose id a
label cannot carry is not found through a step it holds.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field

from . import calls, item_tree, leases, model

#: How many participants a container lists, and how many held tasks each names.
MOST_PARTICIPANTS = 50
MOST_HOLDS = 20

#: The tasks named, as one JSON array, each with the session its claim's call proved.
_TASKS = (
    "SELECT p.key, i.number, i.checklist,"
    " CASE WHEN i.claim_ref != '' AND c.identity_state = ? THEN c.session_id END AS session_id,"
    " c.identity_source, c.agent_id"
    " FROM work_items i JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " LEFT JOIN execution_events c ON c.id = i.claim_call_id"
    " WHERE i.kind != ? AND i.work_item_id IN (SELECT value FROM json_each(?))"
    " ORDER BY p.key, i.number"
)
#: Who follows the items named, with the channel that proved the subscribing call.
_FOLLOWERS = (
    "SELECT u.session_id, c.identity_source FROM work_item_subscriptions u"
    " JOIN execution_events c ON c.id = u.call_id"
    " WHERE u.follows = 1 AND u.work_item_id IN (SELECT value FROM json_each(?))"
    " ORDER BY u.created_at, u.session_id"
)
_SESSIONS = (
    "SELECT id, client, status, last_seen, ended_at FROM sessions"
    " WHERE id IN (SELECT value FROM json_each(?))"
)


@dataclass
class _Found:
    label: str
    holds: list[str] = field(default_factory=list)
    follows: bool = False


def of_container(conn: sqlite3.Connection, row: sqlite3.Row) -> list[dict]:
    """The participants of the item of `row`, by label; none for a task.

    Each is `session`, `client` (the client its session row names), `label` (the
    holder its own conversation records), `holds` (the tasks under the container it
    or its subagents hold, by reference, at most `MOST_HOLDS`), `follows` (whether it
    follows the container or an item over it) and `last_seen`. At most
    `MOST_PARTICIPANTS`.
    """

    if str(row["kind"]) != model.CONTAINER_KIND:
        return []
    identity = str(row["work_item_id"])
    return _live(conn, identity, _containers(conn, identity))


def live(conn: sqlite3.Connection, work_item_id: str) -> bool:
    """Whether anyone works on this container now; never for a task."""

    return bool(sessions(conn, work_item_id))


def sessions(conn: sqlite3.Connection, work_item_id: str) -> list[str]:
    """The sessions that work on this container now, by their participants' order."""

    chain = _containers(conn, work_item_id)
    if not chain or chain[0] != work_item_id:
        return []
    return [entry["session"] for entry in _live(conn, work_item_id, chain)]


def heard(conn: sqlite3.Connection, work_item_id: str) -> bool:
    """Whether a live session hears this item: a participant of it or of any container over it.

    A participant of a goal hears the whole tree of that goal, so this is the
    question for words left on an item, a task included, rather than `live`.
    """

    chain = _containers(conn, work_item_id)
    # The containers over an item nest, so the work under the topmost holds the
    # work under each of them, and following any of them is following one of these.
    return bool(chain) and bool(_live(conn, chain[-1], chain))


def holds_under(
    conn: sqlite3.Connection, work_item_id: str, session_id: str, agent_id: str | None
) -> bool:
    """Whether this session, or this agent of it, holds a task or an open step under the item.

    The holds that make a session a participant of a container, read for one
    session: what lets its mute stand on the container (`subscriptions.subscribe`).
    The session's own conversation finds what its agents hold as well, an agent
    only its own, as a holder label is matched (`subscriptions.holds`).
    """

    agent = calls.label_id(agent_id) if agent_id else None
    return any(
        session == session_id and (agent is None or held_by == agent)
        for session, held_by, _label, _reference in _holdings(conn, work_item_id)
    )


def _containers(conn: sqlite3.Connection, work_item_id: str) -> list[str]:
    """The item and the items over it that are containers, nearest first."""

    return [
        identity
        for identity, kind, _category in item_tree.above(conn, work_item_id)
        if kind == model.CONTAINER_KIND
    ]


def _live(conn: sqlite3.Connection, root: str, followed: Iterable[str]) -> list[dict]:
    """The live sessions holding work under `root` or following one of `followed`."""

    found: dict[str, _Found] = {}
    for holder, _agent, named, reference in _holdings(conn, root):
        _hold(found, holder, named, reference)
    for row in conn.execute(_FOLLOWERS, (json.dumps(list(followed)),)):
        session = str(row["session_id"])
        label = calls.channel_holder(str(row["identity_source"]), session)
        if label is not None:
            found.setdefault(session, _Found(label)).follows = True
    if not found:
        return []
    rows = {str(row["id"]): row for row in conn.execute(_SESSIONS, (json.dumps(sorted(found)),))}
    listed = [
        {
            "session": session,
            "client": rows[session]["client"],
            "label": entry.label,
            "holds": entry.holds[:MOST_HOLDS],
            "follows": entry.follows,
            "last_seen": rows[session]["last_seen"],
        }
        for session, entry in found.items()
        if leases.session_live(rows.get(session))
    ]
    listed.sort(key=lambda entry: (entry["label"], entry["session"]))
    return listed[:MOST_PARTICIPANTS]


def _holdings(conn: sqlite3.Connection, root: str) -> Iterator[tuple[str, str | None, str, str]]:
    """Every hold of a task under `root`, a claim or an open step: the session, the agent as
    a holder label carries it or None for the session's own conversation, the label of
    that conversation, and the task's reference."""

    under = json.dumps(sorted(item_tree.below(conn, [root]).nodes))
    for task in conn.execute(_TASKS, (calls.CONFIRMED, model.CONTAINER_KIND, under)):
        reference = model.human_id(str(task["key"]), int(task["number"]))
        if task["session_id"]:
            session = str(task["session_id"])
            label = calls.channel_holder(str(task["identity_source"]), session)
            if label is not None:
                agent = calls.label_id(task["agent_id"]) if task["agent_id"] else None
                yield session, agent, label, reference
        for step in model.checklist(task["checklist"]):
            holder = str(step["claimed_by"] or "")
            ids = None if step["done"] else calls.holder_ids(holder)
            label = calls.session_holder(holder)
            if ids is not None and label is not None:
                yield ids[0], ids[1], label, reference


def _hold(found: dict[str, _Found], session: str, label: str, reference: str) -> None:
    entry = found.setdefault(session, _Found(label))
    if reference not in entry.holds:
        entry.holds.append(reference)
