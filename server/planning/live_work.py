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

| A session behind the item, checked in order | The item's state |
|---|---|
| not `active`, no row, or `last_seen` older than `leases.LEASE_PERIOD` | none |
| `last_seen` older than `LIVE_QUIET` | `quiet`, with `quiet_since` |
| at work, and it wrote to this item since its last `prompt`, itself or through a subagent | `working` |
| at work, and one of its subagents holds an open step of this item | `working` |
| at work, and neither | `held` |
| otherwise: the turn ended, it waits for a person, or it was opened with no prompt | `waiting` |

A session at work that wrote to an item since its last `prompt` moves that item
too when it holds neither its claim nor a step: what it writes to is what it is
working on. Those writers are found among the active sessions heard from within
`LIVE_QUIET`, since only such a session can be at work.

A session is at work when its last lifecycle event is a `prompt`, so a turn is
running, or when a subagent row of it is `active` and started since its last
`session_start`. A write is any Planning write call this session confirmed and
that names the item: a claim, a step, a comment, a link (which names its source
item). A session at work moves only the items it is seen working on; the others
it holds stand still, so a coordinator holding many items does not move them all
on every turn. A session with no prompt recorded has written nothing since one.
Only the items the caller passes are mapped, whatever else a session wrote to.

An item takes the strongest state of its sessions and attempts, `working`
before `held` before `waiting` before `quiet`, and an item with none stands in
no map. A quiet item says when its latest session last gave a sign of life. The
others carry no time on purpose: `last_seen` moves with every event, and a time
in the map would make every event a new frame of the stream rather than every
change of state.

`attention` alone cannot tell a running turn from a session just opened or
resumed: both read blank. The lifecycle events can, so they are what is read.
A subagent's own events carry its parent's session id and are about the
subagent, so only the session's own events count as its last one. A subagent a
client restart cut off leaves no end, so only one started since the session's
last start is taken to run.

What the rule cannot see: a client that died in the middle of a turn reads as
at work for a day and `quiet` after it, since only a check of the process could
tell more. A long turn that writes nothing moves nothing: its items read `held`
until its first write. A link moves only its source item, the one its call
names. A session that is not at work puts nothing in the map for an item it only
wrote to.

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
HELD = "held"
WAITING = "waiting"
QUIET = "quiet"
_STRENGTH = {WORKING: 0, HELD: 1, WAITING: 2, QUIET: 3}

_SECOND = 19
_STAMP = "%Y-%m-%dT%H:%M:%SZ"

#: Whether this store holds every column the reads below ask for. A table that
#: is not there has no rows here, so one answer covers a missing table as well.
_HOLDS_EVERYTHING = (
    "SELECT (SELECT COUNT(*) FROM pragma_table_info('work_items') WHERE name = 'claim_call_id')"
    " + (SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'parent_session_id')"
    " + (SELECT COUNT(*) FROM pragma_table_info('execution_events')"
    "    WHERE name IN ('agent_id', 'work_item_id'))"
    " + (SELECT COUNT(*) FROM pragma_table_info('executions') WHERE name = 'status')"
)
_COLUMNS_ASKED = 5

#: The session of each confirmed call that took a claim on one of these items.
_CLAIMS = (
    "SELECT w.work_item_id, c.session_id FROM work_items w"
    " JOIN execution_events c ON c.id = w.claim_call_id"
    " WHERE w.work_item_id IN (SELECT value FROM json_each(?))"
    " AND w.claim_ref != '' AND c.identity_state = ?"
    " AND COALESCE(c.session_id, '') != ''"
)

#: The rows of these sessions and of every active top-level session heard from
#: since the second given, which may have written to an item without holding it;
#: then the running subagents under all of them. One read, so the map stays at
#: five. The subagents are the `sessions_parent` index; the recent sessions are a
#: scan of the session rows, which no index orders by time.
_SESSIONS = (
    "WITH top AS (SELECT value AS id FROM json_each(?1)"
    " UNION SELECT id FROM sessions"
    "  WHERE status = 'active' AND parent_session_id = '' AND last_seen >= ?2)"
    " SELECT id, '' AS parent, status, last_seen, started_at FROM sessions"
    " WHERE id IN (SELECT id FROM top)"
    " UNION ALL"
    " SELECT id, parent_session_id, status, last_seen, started_at FROM sessions"
    " WHERE parent_session_id != '' AND status = 'active'"
    " AND parent_session_id IN (SELECT id FROM top)"
)

#: One row per session: its last lifecycle event of its own and when it last
#: started. Then one row per item it wrote to since its last prompt: its own
#: confirmed write calls and its subagents', which carry its id. Each subquery
#: walks `execution_events_session` back from the newest event, and the writes
#: are the range of that index past the prompt.
_LIFECYCLE = (
    "WITH last AS (SELECT j.value AS session_id,"
    " (SELECT e.kind FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind IN ('session_start', 'prompt', 'turn_end', 'attention', 'session_end')"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS last_kind,"
    " (SELECT COALESCE(e.occurred_at, e.received_at) FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'session_start' AND COALESCE(e.agent_id, '') = ''"
    "  ORDER BY e.id DESC LIMIT 1) AS last_start,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'prompt' AND COALESCE(e.agent_id, '') = ''"
    "  ORDER BY e.id DESC LIMIT 1) AS last_prompt"
    " FROM json_each(?1) j)"
    " SELECT session_id, last_kind, last_start, NULL AS written FROM last"
    " UNION ALL"
    " SELECT DISTINCT l.session_id, NULL, NULL, e.work_item_id FROM last l"
    " JOIN execution_events e ON e.session_id = l.session_id AND e.id > l.last_prompt"
    " WHERE e.kind = ?2 AND e.identity_state = ?3 AND e.work_item_id IS NOT NULL"
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
) -> dict[str, dict[str, bool]]:
    """The sessions behind each item, its claim's and its open steps' holders'.

    Each says whether a subagent of that session holds an open step of the item.
    """

    behind: dict[str, dict[str, bool]] = {}
    for row in conn.execute(_CLAIMS, (identities, calls.CONFIRMED)):
        behind.setdefault(str(row["work_item_id"]), {}).setdefault(str(row["session_id"]), False)
    for item in listed:
        for step in item["checklist"]:
            holder = None if step["done"] else calls.holder_ids(str(step["claimed_by"] or ""))
            if holder is not None:
                sessions = behind.setdefault(str(item["work_item_id"]), {})
                sessions[holder[0]] = sessions.get(holder[0], False) or holder[1] is not None
    return behind


def _states(
    conn: sqlite3.Connection, named: set[str]
) -> tuple[dict[str, dict], dict[str, set[str]]]:
    """The state of every live session, named or recently heard from, and its writes.

    A session at work reads `working` here; which items it moves is the item's
    question, answered in `live_work`. Its writes are the items it wrote to since
    its last prompt.
    """

    written: dict[str, set[str]] = {}
    now = leases.utc_now()
    recent = (now - LIVE_QUIET).strftime(_STAMP)
    live: dict[str, dict] = {}
    started: dict[str, list[str]] = {}
    for row in conn.execute(_SESSIONS, (json.dumps(sorted(named)), recent)):
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
        return live, written
    for row in conn.execute(_LIFECYCLE, (json.dumps(awake), calls.KIND, calls.CONFIRMED)):
        session = str(row["session_id"])
        if row["written"] is not None:
            written.setdefault(session, set()).add(str(row["written"]))
            continue
        since = str(row["last_start"] or "")[:_SECOND]
        # A subagent started in the second its session started counts, as a
        # claim and a launch in one second do in `agents`.
        running = any(moment >= since for moment in started.get(session, []))
        if row["last_kind"] == "prompt" or running:
            live[session] = {"state": WORKING}
    return live, written


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
    states, written = _states(conn, {session for held in behind.values() for session in held})
    found: dict[str, dict] = {}
    for identity, sessions in behind.items():
        for session, by_subagent in sessions.items():
            state = states.get(session)
            if state is None:
                continue
            if state["state"] == WORKING and not by_subagent:
                state = {"state": HELD}
            found[identity] = _stronger(found.get(identity), state)
    # What a session at work wrote to moves, whether it holds the item or not.
    mapped = set(order)
    for session, items_written in written.items():
        if states[session]["state"] == WORKING:
            for identity in items_written & mapped:
                found[identity] = {"state": WORKING}
    for row in conn.execute(_ATTEMPTS, (identities,)):
        found[str(row["work_item_id"])] = {"state": WORKING}
    # In the items' order, so an unchanged map is an unchanged frame of the stream.
    return {identity: found[identity] for identity in order if identity in found}
