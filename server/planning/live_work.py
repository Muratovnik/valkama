"""Which items of a space have an agent at work on them right now.

A lease (`leases`) says whether anyone still stands behind a claim, over days.
This says what that someone is doing at this moment, for every item a view
draws, so a graph can move the work that is moving and leave the rest still.
An item takes its state from the sessions behind it:

- its claim: the session of the confirmed call that took it;
- each open step: the session its holder's label names. A subagent's step
  names its parent's session, as its claim does;
- an attempt Valkama runs on it, `starting` or `running`: `working` at once,
  because Valkama's runner holds that process itself.

| A session behind the item | State |
|---|---|
| not `active`, no row, or `last_seen` older than `leases.LEASE_PERIOD` | none |
| `last_seen` older than `LIVE_QUIET` | `quiet`, with `quiet_since` |
| its last lifecycle event is a `prompt`: a turn is running | `working` |
| a subagent row `active`, started since its last `session_start` | `working` |
| otherwise: the turn ended, it waits for a person, or it was opened with no prompt | `waiting` |

An item takes the strongest state of its sessions and attempts, `working`
before `waiting` before `quiet`, and an item with none stands in no map. A quiet
item says when its latest session last gave a sign of life. A working or waiting
one carries no time on purpose: `last_seen` moves with every event, and a time
in the map would make every event a new frame of the stream rather than every
change of state.

`attention` alone cannot tell a running turn from a session just opened or
resumed: both read blank. The lifecycle events can, so they are what is read.
A subagent's own events carry its parent's session id and are about the
subagent, so only the session's own events count as its last one. A subagent a
client restart cut off leaves no end, so only one started since the session's
last start is taken to run.

What the rule cannot see: a client that died in the middle of a turn reads
`working` for a day and `quiet` after it, since only a check of the process
could tell more. An agent that writes to an item without holding it or a step
is not seen either; finding it (`agents`) costs several reads per item.

The map is five reads, whatever the number of items. A store an earlier build
wrote may lack what they ask for, and then the map is empty rather than an error.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping
from datetime import timedelta

from . import calls, leases

#: How long a live session may stay silent before it reads `quiet`.
LIVE_QUIET = timedelta(hours=24)

WORKING = "working"
WAITING = "waiting"
QUIET = "quiet"
_STRENGTH = {WORKING: 0, WAITING: 1, QUIET: 2}

_SECOND = 19
_STAMP = "%Y-%m-%dT%H:%M:%SZ"

#: Whether this store holds every column the reads below ask for. A table that
#: is not there has no rows here, so one answer covers a missing table as well.
_HOLDS_EVERYTHING = (
    "SELECT (SELECT COUNT(*) FROM pragma_table_info('work_items') WHERE name = 'claim_call_id')"
    " + (SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'parent_session_id')"
    " + (SELECT COUNT(*) FROM pragma_table_info('execution_events') WHERE name = 'agent_id')"
    " + (SELECT COUNT(*) FROM pragma_table_info('executions') WHERE name = 'status')"
)
_COLUMNS_ASKED = 4

#: The session of each confirmed call that took a claim on one of these items.
_CLAIMS = (
    "SELECT w.work_item_id, c.session_id FROM work_items w"
    " JOIN execution_events c ON c.id = w.claim_call_id"
    " WHERE w.work_item_id IN (SELECT value FROM json_each(?))"
    " AND w.claim_ref != '' AND c.identity_state = ?"
    " AND COALESCE(c.session_id, '') != ''"
)

#: The rows of these sessions, then the running subagents under them. One read,
#: so the map stays at five; the second half is the `sessions_parent` index.
_SESSIONS = (
    "SELECT id, '' AS parent, status, last_seen, started_at FROM sessions"
    " WHERE id IN (SELECT value FROM json_each(?1))"
    " UNION ALL"
    " SELECT id, parent_session_id, status, last_seen, started_at FROM sessions"
    " WHERE parent_session_id != '' AND status = 'active'"
    " AND parent_session_id IN (SELECT value FROM json_each(?1))"
)

#: Each session's last lifecycle event of its own, and when it last started.
#: Both walk `execution_events_session` back from the newest event.
_LIFECYCLE = (
    "SELECT j.value AS session_id,"
    " (SELECT e.kind FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind IN ('session_start', 'prompt', 'turn_end', 'attention', 'session_end')"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS last_kind,"
    " (SELECT COALESCE(e.occurred_at, e.received_at) FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'session_start' AND COALESCE(e.agent_id, '') = ''"
    "  ORDER BY e.id DESC LIMIT 1) AS last_start"
    " FROM json_each(?) j"
)

#: The items an attempt is running on.
_ATTEMPTS = (
    "SELECT DISTINCT work_item_id FROM executions"
    " WHERE work_item_id IN (SELECT value FROM json_each(?))"
    " AND status IN ('starting', 'running')"
)


def _holds_everything(conn: sqlite3.Connection) -> bool:
    return int(conn.execute(_HOLDS_EVERYTHING).fetchone()[0]) == _COLUMNS_ASKED


def _behind(
    conn: sqlite3.Connection, listed: list[Mapping], identities: str
) -> dict[str, set[str]]:
    """The sessions behind each item: its claim's, and its open steps' holders'."""

    behind: dict[str, set[str]] = {}
    for row in conn.execute(_CLAIMS, (identities, calls.CONFIRMED)):
        behind.setdefault(str(row["work_item_id"]), set()).add(str(row["session_id"]))
    for item in listed:
        for step in item["checklist"]:
            holder = None if step["done"] else calls.holder_ids(str(step["claimed_by"] or ""))
            if holder is not None:
                behind.setdefault(str(item["work_item_id"]), set()).add(holder[0])
    return behind


def _states(conn: sqlite3.Connection, named: set[str]) -> dict[str, dict]:
    """The state of every named session that is live, by its id."""

    if not named:
        return {}
    now = leases.utc_now()
    live: dict[str, dict] = {}
    started: dict[str, list[str]] = {}
    for row in conn.execute(_SESSIONS, (json.dumps(sorted(named)),)):
        if row["parent"]:
            started.setdefault(str(row["parent"]), []).append(str(row["started_at"])[:_SECOND])
            continue
        seen = leases.moment(row["last_seen"])
        if row["status"] != "active" or seen is None or seen < now - leases.LEASE_PERIOD:
            continue
        if seen < now - LIVE_QUIET:
            live[str(row["id"])] = {"state": QUIET, "quiet_since": seen.strftime(_STAMP)}
        else:
            live[str(row["id"])] = {"state": WAITING}
    awake = sorted(session for session, state in live.items() if state["state"] != QUIET)
    if not awake:
        return live
    for row in conn.execute(_LIFECYCLE, (json.dumps(awake),)):
        session = str(row["session_id"])
        since = str(row["last_start"] or "")[:_SECOND]
        # A subagent started in the second its session started counts, as a
        # claim and a launch in one second do in `agents`.
        running = any(moment >= since for moment in started.get(session, []))
        if row["last_kind"] == "prompt" or running:
            live[session] = {"state": WORKING}
    return live


def _stronger(first: dict | None, second: dict) -> dict:
    if first is None or _STRENGTH[second["state"]] < _STRENGTH[first["state"]]:
        return second
    if first["state"] == second["state"] == QUIET:
        return {"state": QUIET, "quiet_since": max(first["quiet_since"], second["quiet_since"])}
    return first


def live_work(conn: sqlite3.Connection, items: Iterable[Mapping]) -> dict[str, dict]:
    """The items with live work on them, each with its state; see the module's rule.

    `items` are records as a list read presents them: an id and a checklist.
    """

    listed = list(items)
    if not listed or not _holds_everything(conn):
        return {}
    order = [str(item["work_item_id"]) for item in listed]
    identities = json.dumps(order)
    behind = _behind(conn, listed, identities)
    states = _states(conn, {session for sessions in behind.values() for session in sessions})
    found: dict[str, dict] = {}
    for identity, sessions in behind.items():
        for session in sessions:
            if session in states:
                found[identity] = _stronger(found.get(identity), states[session])
    for row in conn.execute(_ATTEMPTS, (identities,)):
        found[str(row["work_item_id"])] = {"state": WORKING}
    # In the items' order, so an unchanged map is an unchanged frame of the stream.
    return {identity: found[identity] for identity in order if identity in found}
