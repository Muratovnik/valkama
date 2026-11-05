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
| at work, and a live subagent of it wrote to this item since that subagent last started | `working` |
| at work, and a live subagent of it holds an open step of this item | `working` |
| at work, and the label of a live subagent of it names this item by its number | `working` |
| at work, and a live subagent of it with no write and no step was given this item's number first in its packet | `working` |
| at work, and a live subagent of it with no other sign is under a session holding this item and no other | `working` |
| at work, and none of those | `held` |
| otherwise: the turn ended, it waits for a person, or it was opened with no prompt | `waiting` |

A session at work that wrote to an item since its last `prompt`, or whose live
subagent is seen on it, moves that item too when it holds neither its claim nor a
step: what it writes to is what it is working on. Those sessions are found among
the active ones heard from within `LIVE_QUIET`, since only such a session can be
at work.

A prompt comes with every notice that wakes a coordinator, so its own window says
little about a subagent working for an hour. What places a live subagent is `ladder`'s
order, the one usage is counted by, strongest first: it wrote to the item since it last
started, it holds an open step, the packet it was given or the label its launch gave it
names the item's number, as `mentions` reads a number in an agent's prose, or else its
parent holds this one item. A parent holding several places it on none: `agents` may say
a subagent stands on each item its parent held when it started and how many those were,
but as a reason to move they would move them all. The packet's number comes from the
usage reader's pass over the subagent's transcript, so it arrives up to a pass late, and
until then that subagent has only its lower signs.

A session is at work when its last lifecycle event is a `prompt`, so a turn is
running, or when it has a live subagent: a subagent row of it that is `active`,
started since its last real start and not fallen silent. A compacted context is
reported as a start too, and it is none: the client runs on with its turn and its
subagents (`sessions.COMPACTED_START`), so it counts neither as a lifecycle event
nor as a start here. A subagent continued later starts again under its own id, and
its row's `last_seen` says when, since only its start and its stop move that time.
A write is any Planning write call this session confirmed and that names the item:
a claim, a step, a comment, a link (which names its source item). A session at work
moves only the items it or its live subagents are seen working on; the others it
holds stand still, so a coordinator holding many items does not move them all on
every turn or for every subagent. A session with no prompt recorded has written
nothing since one. Only the items the caller passes are mapped, whatever else a
session wrote to.

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
last real start is taken to run.

One that fell with the client running leaves no end either, and its row's
`last_seen` cannot tell: between a start and a stop nothing moves it, so an hour
behind is what a subagent working for an hour looks like. What does move is its
transcript, written with every message and tool result, whose time is read as
`agents` reads it. So a subagent runs for `SUBAGENT_SILENT` past the later of its
last start and that time. With no such file to read, as for a client that keeps
none there, time since its start says nothing about its work, and only the day a
silent session gets stops it.

What the rule cannot see: a client that died in the middle of a turn reads as
at work for a day and `quiet` after it, since only a check of the process could
tell more. A subagent that fell moves its items for up to `SUBAGENT_SILENT` more,
and one in a single step that writes nothing for longer stops moving until it
writes. A long turn that writes nothing moves nothing: its items read `held`
until its first write, and so do those of a coordinator holding several while a subagent
of it works having written nothing, held no step and been given no number. A
label says what its launch meant and not what the subagent does, so one that names
an item it only reads moves that item. A link moves only its source item, the one
its call names. A session that is not at work puts nothing in the map for an item
it only wrote to.

The map is five reads, whatever the number of items, and the status of one file
for each live subagent started longer ago than `SUBAGENT_SILENT`. A live subagent with
no write of its own adds the two reads of `_lower_signs` and, when its label has a
number no listed item answers to, one more for that number. A store an earlier build
wrote may lack what they ask for, and then the map is empty rather than an error.

`placed` is the same read, and the map it gives is this one. Beside it, it says where
each live subagent stands, on one item by `ladder`'s order, and which sessions are at
work and on what, which the live-work frame (`live_frame`) counts. It adds no read.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .. import sessions
from . import agents, calls, ladder, leases

#: How long a live session may stay silent before it reads `quiet`.
LIVE_QUIET = timedelta(hours=24)
#: How long a subagent's transcript may stay unwritten before it no longer runs. A
#: running agent's transcript goes unwritten for as long as one tool call or one
#: answer takes: the longest stretch across hundreds of recorded runs, some over three
#: hours long, was ten minutes, the limit of one shell command. Twice the hour a very
#: long step may take leaves it running, at the cost of two hours' motion on a fallen one.
SUBAGENT_SILENT = timedelta(hours=2)

WORKING = "working"
HELD = "held"
WAITING = "waiting"
QUIET = "quiet"
_STRENGTH = {WORKING: 0, HELD: 1, WAITING: 2, QUIET: 3}

_SECOND = 19
_STAMP = "%Y-%m-%dT%H:%M:%SZ"
_MOMENT = "%Y-%m-%dT%H:%M:%S"

#: Whether this store holds every column the reads below ask for. A table that
#: is not there has no rows here, so one answer covers a missing table as well.
_HOLDS_EVERYTHING = (
    "SELECT (SELECT COUNT(*) FROM pragma_table_info('work_items') WHERE name = 'claim_call_id')"
    " + (SELECT COUNT(*) FROM pragma_table_info('sessions')"
    "    WHERE name IN ('parent_session_id', 'agent_id', 'label', 'transcript_path'))"
    " + (SELECT COUNT(*) FROM pragma_table_info('execution_events')"
    "    WHERE name IN ('agent_id', 'work_item_id', 'source'))"
    " + (SELECT COUNT(*) FROM pragma_table_info('executions') WHERE name = 'status')"
    " + (SELECT COUNT(*) FROM pragma_table_info('usage_runs') WHERE name = 'packet_item')"
)
_COLUMNS_ASKED = 10

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
    " SELECT id, '' AS parent, '' AS agent_id, '' AS label, status, last_seen,"
    " transcript_path, NULL AS packet_item FROM sessions WHERE id IN (SELECT id FROM top)"
    " UNION ALL"
    " SELECT id, parent_session_id, agent_id, label, status, last_seen, '',"
    " (SELECT u.packet_item FROM usage_runs u WHERE u.session_id = parent_session_id"
    "  AND u.agent_id = sessions.agent_id) FROM sessions"
    " WHERE parent_session_id != '' AND status = 'active'"
    " AND parent_session_id IN (SELECT id FROM top)"
)

#: One row per session: its last lifecycle event of its own and when it last
#: really started, a compacted context being neither. Then one row per item it
#: wrote to since its last prompt: its own confirmed write calls and its
#: subagents', which carry its id. Then, in the order they happened, each start of
#: a subagent of it and each of their writes since that real start: what a subagent
#: wrote before it last started is not what it is doing now. Each subquery walks
#: `execution_events_session` back from the newest event, and the writes are ranges
#: of that index.
_LIFECYCLE = (
    "WITH last AS (SELECT j.value AS session_id,"
    " (SELECT e.kind FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind IN ('session_start', 'prompt', 'turn_end', 'attention', 'session_end')"
    "  AND NOT (e.kind = 'session_start' AND COALESCE(e.source, '') = ?4)"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS last_kind,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'session_start' AND COALESCE(e.source, '') != ?4"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS last_start,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'prompt' AND COALESCE(e.agent_id, '') = ''"
    "  ORDER BY e.id DESC LIMIT 1) AS last_prompt"
    " FROM json_each(?1) j)"
    " SELECT l.session_id, l.last_kind,"
    " (SELECT COALESCE(s.occurred_at, s.received_at) FROM execution_events s"
    "  WHERE s.id = l.last_start) AS started, NULL AS written, '' AS agent_id, 0 AS happened"
    " FROM last l"
    " UNION ALL"
    " SELECT DISTINCT l.session_id, NULL, NULL, e.work_item_id, '', 0 FROM last l"
    " JOIN execution_events e ON e.session_id = l.session_id AND e.id > l.last_prompt"
    " WHERE e.kind = ?2 AND e.identity_state = ?3 AND e.work_item_id IS NOT NULL"
    " UNION ALL"
    " SELECT l.session_id, NULL, NULL, e.work_item_id, e.agent_id, e.id FROM last l"
    " JOIN execution_events e ON e.session_id = l.session_id"
    " AND e.id > COALESCE(l.last_start, 0)"
    " WHERE COALESCE(e.agent_id, '') != '' AND (e.kind = 'subagent_start'"
    " OR (e.kind = ?2 AND e.identity_state = ?3 AND e.work_item_id IS NOT NULL))"
    " ORDER BY happened"
)

#: Every item these sessions' confirmed calls claimed and still hold, in any space.
_HOLDS = (
    "SELECT c.session_id, w.work_item_id FROM work_items w"
    " JOIN execution_events c ON c.id = w.claim_call_id"
    " WHERE w.claim_ref != '' AND c.identity_state = ?"
    " AND c.session_id IN (SELECT value FROM json_each(?))"
)

#: The items an attempt is running on.
_ATTEMPTS = (
    "SELECT DISTINCT work_item_id FROM executions"
    " WHERE work_item_id IN (SELECT value FROM json_each(?))"
    " AND status IN ('starting', 'running')"
)


def _holds_everything(conn: sqlite3.Connection) -> bool:
    return int(conn.execute(_HOLDS_EVERYTHING).fetchone()[0]) == _COLUMNS_ASKED


@dataclass
class _Lifecycle:
    """What the lifecycle read says of one session."""

    last_kind: str = ""
    started: str = ""
    written: set[str] = field(default_factory=set)
    #: What each subagent wrote to since it last started.
    by_agent: dict[str, set[str]] = field(default_factory=dict)
    #: The item of each subagent's latest write since it last started.
    last_by_agent: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class _Unwritten:
    """What is known of a live subagent that has written nothing since it started."""

    packet_item: str | None
    label: str


@dataclass(frozen=True)
class _SeenOn:
    """What a session is seen doing, whether or not it is at work."""

    items: set[str]
    #: Its live subagents, each spelled as a holder's label spells it.
    agents: set[str]
    #: Those with no write of their own, and what their launch said of them.
    unwritten: dict[str, _Unwritten] = field(default_factory=dict)
    #: The others, each with the item its latest write named: where `ladder` places it.
    last_written: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class AtWork:
    """A session at work, as the live-work frame counts it."""

    #: Every item its work is on: what it holds, what it is seen on, where its subagents stand.
    items: frozenset[str]
    #: How many live subagents it has.
    subagents: int


@dataclass(frozen=True)
class Placement:
    """What `placed` reads: the map a graph moves by, and who stands where.

    `agents` counts the live subagents `ladder`'s order places on each item, each on
    one item, so it may name an item the caller did not pass. `at_work` holds every
    session at work, whether or not any of its work is among the items passed.
    """

    live: dict[str, dict]
    agents: dict[str, int] = field(default_factory=dict)
    at_work: dict[str, AtWork] = field(default_factory=dict)


@dataclass(frozen=True)
class _LowerSigns:
    """What `_lower_signs` finds for subagents with no write of their own."""

    #: The items the map moves for them: a packet's item, or a parent's single hold.
    moved: set[str]
    #: Where each stands, by session and agent, as `ladder` orders the signs.
    placed: dict[tuple[str, str], str]


def _behind(
    conn: sqlite3.Connection, listed: list[Mapping], identities: str
) -> dict[str, dict[str, set[str]]]:
    """The sessions behind each item, its claim's and its open steps' holders'.

    Each comes with the subagents of that session that hold an open step of the item.
    """

    behind: dict[str, dict[str, set[str]]] = {}
    for row in conn.execute(_CLAIMS, (identities, calls.CONFIRMED)):
        behind.setdefault(str(row["work_item_id"]), {}).setdefault(str(row["session_id"]), set())
    for item in listed:
        for step in item["checklist"]:
            holder = None if step["done"] else calls.holder_ids(str(step["claimed_by"] or ""))
            if holder is not None:
                agents = behind.setdefault(str(item["work_item_id"]), {}).setdefault(
                    holder[0], set()
                )
                if holder[1] is not None:
                    agents.add(holder[1])
    return behind


def _lifecycle(conn: sqlite3.Connection, awake: list[str]) -> dict[str, _Lifecycle]:
    found = {session: _Lifecycle() for session in awake}
    parameters = (json.dumps(awake), calls.KIND, calls.CONFIRMED, sessions.COMPACTED_START)
    for row in conn.execute(_LIFECYCLE, parameters):
        read = found[str(row["session_id"])]
        agent, item = str(row["agent_id"]), row["written"]
        if agent and item is None:
            read.by_agent[agent] = set()
            read.last_by_agent.pop(agent, None)
        elif agent:
            read.by_agent.setdefault(agent, set()).add(str(item))
            read.last_by_agent[agent] = str(item)
        elif item is not None:
            read.written.add(str(item))
        else:
            read.last_kind = str(row["last_kind"] or "")
            read.started = str(row["started"] or "")[:_SECOND]
    return found


def _named_by(label: str, references: Mapping[str, str]) -> set[str]:
    """The items a subagent's label names by number. A number its cut ran through names none."""

    return {
        references[reference]
        for reference in ladder.named_references(label)
        if reference in references
    }


def _runs(subagent: sqlite3.Row, session: str, transcript: str, now: datetime) -> bool:
    """Whether a subagent started since its session really started has not fallen silent."""

    started = str(subagent["last_seen"])[:_SECOND]
    if started >= (now - SUBAGENT_SILENT).strftime(_MOMENT):
        return True
    written = agents.transcript_moment(transcript, session, str(subagent["agent_id"]))
    if written:
        return written >= (now - SUBAGENT_SILENT).strftime(_MOMENT)
    return started >= (now - LIVE_QUIET).strftime(_MOMENT)


def _states(
    conn: sqlite3.Connection, named: set[str], references: Mapping[str, str]
) -> tuple[dict[str, dict], dict[str, _SeenOn]]:
    """The state of every live session, named or recently heard from, and what it is seen on.

    A session at work reads `working` here; which items it moves is the item's
    question, answered in `live_work`. `references` are the items a label can name.
    """

    now = leases.utc_now()
    recent = (now - LIVE_QUIET).strftime(_STAMP)
    live: dict[str, dict] = {}
    subagents: dict[str, list[sqlite3.Row]] = {}
    transcripts: dict[str, str] = {}
    for row in conn.execute(_SESSIONS, (json.dumps(sorted(named)), recent)):
        if row["parent"]:
            subagents.setdefault(str(row["parent"]), []).append(row)
            continue
        transcripts[str(row["id"])] = str(row["transcript_path"] or "")
        seen = leases.moment(row["last_seen"])
        if row["status"] != "active" or seen is None or seen < now - leases.LEASE_PERIOD:
            continue
        if seen < now - LIVE_QUIET:
            live[str(row["id"])] = {"state": QUIET, "quiet_since": seen.strftime(_STAMP)}
        else:
            live[str(row["id"])] = {"state": WAITING}
    awake = sorted(session for session, state in live.items() if state["state"] != QUIET)
    if not awake:
        return live, {}
    seen_on: dict[str, _SeenOn] = {}
    for session, read in _lifecycle(conn, awake).items():
        items = set(read.written)
        running: set[str] = set()
        unwritten: dict[str, _Unwritten] = {}
        last_written: dict[str, str] = {}
        for row in subagents.get(session, []):
            # A subagent started in the second its session started counts, as a
            # claim and a launch in one second do in `agents`.
            if str(row["last_seen"])[:_SECOND] >= read.started and _runs(
                row, session, transcripts[session], now
            ):
                agent, label = str(row["agent_id"]), str(row["label"] or "")
                running.add(calls.label_id(agent))
                written = read.by_agent.get(agent, set())
                items |= written | _named_by(label, references)
                if written:
                    last_written[calls.label_id(agent)] = read.last_by_agent[agent]
                else:
                    packet = row["packet_item"]
                    unwritten[calls.label_id(agent)] = _Unwritten(
                        str(packet) if packet else None, label
                    )
        seen_on[session] = _SeenOn(items, running, unwritten, last_written)
        if read.last_kind == "prompt" or running:
            live[session] = {"state": WORKING}
    return live, seen_on


def _lower_signs(
    conn: sqlite3.Connection,
    states: Mapping[str, dict],
    seen_on: Mapping[str, _SeenOn],
    held_steps: Mapping[str, str] | None,
) -> _LowerSigns:
    """What subagents with no write of their own stand on, by the rest of `ladder`'s order.

    A step it holds, wherever that is, leaves nothing to add to the map: `live_work`
    moves a listed one, and an unlisted one still says this subagent is on it and not
    on its parent's. A label's number moves nothing here either, since `_states` has
    moved every listed item a label names; it only places the subagent.
    """

    asked = {
        session: seen.unwritten
        for session, seen in seen_on.items()
        if seen.unwritten and states[session]["state"] == WORKING
    }
    if not asked:
        return _LowerSigns(set(), {})
    holds: dict[str, set[str]] = {session: set() for session in asked}
    for row in conn.execute(_HOLDS, (calls.CONFIRMED, json.dumps(sorted(asked)))):
        holds[str(row["session_id"])].add(str(row["work_item_id"]))
    on_a_step: dict[tuple[str, str], str] = {}
    held = ladder.held_steps(conn) if held_steps is None else held_steps
    for holder, item in held.items():
        ids = calls.holder_ids(holder)
        if ids is not None and ids[0] in holds:
            holds[ids[0]].add(item)
            if ids[1] is not None:
                on_a_step[(ids[0], ids[1])] = item
    found = _LowerSigns(set(), {})
    for session, unwritten in asked.items():
        for agent, known in unwritten.items():
            step = on_a_step.get((session, agent))
            if step is not None:
                found.placed[(session, agent)] = step
                continue
            if known.packet_item is not None:
                found.moved.add(known.packet_item)
                found.placed[(session, agent)] = known.packet_item
                continue
            named = ladder.first_named_item(conn, known.label)
            if named is not None:
                found.placed[(session, agent)] = named
            elif len(holds[session]) == 1:
                found.moved.update(holds[session])
                found.placed[(session, agent)] = next(iter(holds[session]))
    return found


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
    if not listed:
        return {}
    return placed(conn, listed).live


def placed(
    conn: sqlite3.Connection,
    items: Iterable[Mapping],
    *,
    held_steps: Mapping[str, str] | None = None,
) -> Placement:
    """The map `live_work` gives, with where each live subagent stands and who is at work.

    One read for both: the map is the graph's, unchanged, and the rest is what the
    live-work frame counts. A subagent stands where `ladder` places it: the item of
    its latest write since it last started, else an open step it holds, the item its
    packet names first, the first item its label names, or its session's one hold.

    `held_steps` is `ladder.held_steps` as the caller already read it, by holder,
    for a caller whose items are every open item: it saves the read of them all.
    """

    listed = list(items)
    if not _holds_everything(conn):
        return Placement({})
    order = [str(item["work_item_id"]) for item in listed]
    identities = json.dumps(order)
    behind = _behind(conn, listed, identities)
    references = {
        str(item["reference"]): str(item["work_item_id"]) for item in listed if "reference" in item
    }
    states, seen_on = _states(
        conn, {session for held in behind.values() for session in held}, references
    )
    found: dict[str, dict] = {}
    for identity, holders in behind.items():
        for session, holding in holders.items():
            state = states.get(session)
            if state is None:
                continue
            if state["state"] == WORKING and not holding & seen_on[session].agents:
                state = {"state": HELD}
            found[identity] = _stronger(found.get(identity), state)
    # What a session at work is seen on moves, whether it holds the item or not.
    mapped = set(order)
    for session, seen in seen_on.items():
        if states[session]["state"] == WORKING:
            for identity in seen.items & mapped:
                found[identity] = {"state": WORKING}
    lower = _lower_signs(conn, states, seen_on, held_steps)
    for identity in lower.moved & mapped:
        found[identity] = {"state": WORKING}
    for row in conn.execute(_ATTEMPTS, (identities,)):
        found[str(row["work_item_id"])] = {"state": WORKING}
    # In the items' order, so an unchanged map is an unchanged frame of the stream.
    live = {identity: found[identity] for identity in order if identity in found}
    agents: dict[str, int] = {}
    at_work: dict[str, AtWork] = {}
    for session, seen in seen_on.items():
        if states[session]["state"] != WORKING:
            continue
        standing = dict(seen.last_written)
        for agent in seen.unwritten:
            item = lower.placed.get((session, agent))
            if item is not None:
                standing[agent] = item
        for item in standing.values():
            agents[item] = agents.get(item, 0) + 1
        held = {identity for identity, holders in behind.items() if session in holders}
        work = frozenset(seen.items | held | set(standing.values()))
        at_work[session] = AtWork(work, len(seen.agents))
    return Placement(live, agents, at_work)
