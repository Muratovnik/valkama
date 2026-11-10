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
| at work in a turn of its own, and this is the item it stands on | `working` |
| at work, and a live subagent of it wrote to this item since that subagent last started | `working` |
| at work, and a live subagent of it holds an open step of this item | `working` |
| at work, and the label of a live subagent of it names this item by its number | `working` |
| at work, and a live subagent of it with no write and no step was given this item's number first in its packet | `working` |
| at work, and a live subagent of it with no other sign is under a session holding this item and no other | `working` |
| at work, and none of those | `held` |
| otherwise: the turn ended, it waits for a person, or it was opened with no prompt | `waiting`, `long` once `last_seen` is older than `WAITING_LONG`, `asks` while a notice stands in its open turn |

A session is at work when a turn of its own runs or it has a live subagent.

A turn of its own runs when the last of its own events that open or end a turn, a
real start, a `prompt`, a `turn_end` or a `session_end`, is a `prompt`, and the client
is seen alive in it. A notice (`attention`) does neither: it comes in the middle of a
turn as often as after one, and what it says is that the client waits for a person.
The client is seen alive by its transcript, written with every message and tool
result, as a subagent is: a turn runs while the later of its last event and that
file's time is within `TURN_SILENT`. After a notice the turn runs again once the
transcript is written later than the notice, which is the person's answer arriving:
of 156 recorded notices in the middle of a turn, the next line the client wrote to the
transcript was the person's answer in 154, and the client's own record of a hook or a
request in two. With no such file to read, as for a client that keeps none there or
one that never wrote it, when the session was last heard from stands in for the file's
time: its hooks and its calls move that, a tool's among them. A notice then stops the
turn until the next prompt. A session whose open turn a notice stopped
`asks`: it stands in the middle of its work until a person answers, which is not the
wait of one whose turn is over.

A session whose own turn runs stands on one item. Among the items it holds, by the
claims its calls took and the open steps it holds itself, that is the one its own
confirmed write named last, whenever that was; the one it holds, when it holds one
and wrote to none; and with several held and none written to, none. Holding nothing,
it stands on the item its own write named last since its last prompt: what it writes
to is what it is working on. Everything else it holds reads `held`. A write is any
Planning write call the session confirmed and that names the item: a claim, a step, a
comment, a link (which names its source item). A session writes to its item when it
takes it and when it hands it over and seldom between, so a rule asking for a write
since the last prompt left the item still for most of the turn spent on it.

A prompt comes with every notice that wakes a coordinator, so its own turn says
little about a subagent working for an hour. What places a live subagent is `ladder`'s
order, the one usage is counted by, strongest first: it wrote to the item since it last
started, it holds an open step, the packet it was given or the label its launch gave it
names the item's number, as `mentions` reads a number in an agent's prose, or else its
parent holds this one item. A parent holding several places it on none: `agents` may say
a subagent stands on each item its parent held when it started and how many those were,
but as a reason to move they would move them all. The packet's number comes from the
usage reader's pass over the subagent's transcript, so it arrives up to a pass late, and
until then that subagent has only its lower signs. A session at work only through its
subagents, its own turn over, stands nowhere itself: its items move by them alone.

A live subagent is a subagent row of the session that is `active`, started since the
session's last real start and not fallen silent. A compacted context is reported as a
start too, and it is none: the client runs on with its turn and its subagents
(`sessions.COMPACTED_START`), so it counts neither as a lifecycle event nor as a start
here. A subagent continued later starts again under its own id, and its row's
`last_seen` says when, since only its start and its stop move that time. Only the
items the caller passes are mapped, whatever else a session wrote to.

An item takes the strongest state of its sessions and attempts, `working` before
`held` before `waiting` before a long `waiting` before `quiet`, a session that asks
before one of the same wait that does not, and an item with none stands in no map. A quiet item says when its latest session last gave a sign of
life. The others carry no time on purpose: `last_seen` moves with every event, and
a time in the map would make every event a new frame of the stream rather than
every change of state. `long` is no time: it turns once, when the session has been
silent for `WAITING_LONG`.

A subagent's own events carry its parent's session id and are about the subagent, so
only the session's own events count as its last one. A subagent a client restart cut
off leaves no end, so only one started since the session's last real start is taken
to run. One that fell with the client running leaves no end either, and its row's
`last_seen` cannot tell: between a start and a stop nothing moves it, so an hour
behind is what a subagent working for an hour looks like. What does move is its
transcript, whose time is read as `agents` reads it. So a subagent runs for
`SUBAGENT_SILENT` past the later of its last start and that time. With no such file
to read, time since its start says nothing about its work, and only the day a silent
session gets stops it.

What the rule cannot see: a client that died in the middle of a turn reads as at
work for `TURN_SILENT` more, and one step of a turn that writes nothing for longer
reads `waiting` until it writes. A message a person queues while a notice waits is
written to the transcript too, and reads as the turn going on. A session that went on
to another item it holds stands on the one before until it writes to the new one. A
subagent that fell moves its items for up to `SUBAGENT_SILENT` more, and one in a
single step that writes nothing for longer stops moving until it writes. A label
says what its launch meant and not what the subagent does, so one that names an item
it only reads moves that item. A link moves only its source item, the one its call
names. A session that is not at work puts nothing in the map for an item it only
wrote to.

The map is at most seven reads, whatever the number of items: what the store holds,
the claims, the sessions, their lifecycle, who holds an open step, what the sessions
at work hold with where each last wrote, and the attempts. The lifecycle is read only
with a session heard from within `LIVE_QUIET`, and the two reads of what is held only
with a session at work. It asks the status
of one file for each session whose open turn is not a prompt within `TURN_SILENT`, and
for each live subagent started longer ago than `SUBAGENT_SILENT`. A live subagent with
no write of its own and a label whose number no listed item answers to adds one read
for that number. A store an earlier build wrote may lack what they ask for, and then
the map is empty rather than an error.

`placed` is the same read, and the map it gives is this one. Beside it, it says where
each live subagent stands, on one item by `ladder`'s order, which session each item's
state comes from, and what every session heard from within `LIVE_QUIET` is doing and
on what, which the live-work frame (`live_frame`) lists. It adds no read.
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
#: How long a waiting session may stay silent before it waits `long`, which a view may
#: fold away. Of 1,550 recorded returns to a session waiting in the same run, 99 in 100
#: came within an hour and every one within three: later than that a person comes back
#: by resuming the session, which starts it again.
WAITING_LONG = timedelta(hours=4)
#: How long a turn may go with no event and nothing written to its transcript before it
#: no longer runs. The longest such stretch across hundreds of recorded runs was ten
#: minutes, the limit of one shell command, and of 1,452 recorded turns 99 in 100 were
#: over within fifteen. A subagent gets longer (`SUBAGENT_SILENT`) because nothing ends
#: one that fell, while a session's turn that goes on writes again and runs again.
TURN_SILENT = timedelta(minutes=15)
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
_STRENGTH = {WORKING: 0.0, HELD: 1.0, WAITING: 2.0, QUIET: 3.0}

#: What a turn of a session's own is doing, when it is open and neither over nor silent.
_RUNS = "runs"
_ASKS = "asks"

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
#: then the running subagents under all of them. One read, so the map stays small.
#: The subagents are the `sessions_parent` index; the recent sessions are a
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

#: One row per session: its last lifecycle event of its own, a notice included, and the
#: last that opens or ends a turn, each with its time; when it last really started, a
#: compacted context being neither; and whether it was ever given a prompt. Then, in
#: the order they happened, each item its own confirmed write calls named since its
#: last prompt. Then, in that order too, each start of a subagent of it and each of
#: their writes since that real start: what a subagent wrote before it last started is
#: not what it is doing now. Each subquery walks `execution_events_session` back from
#: the newest event, and the writes are ranges of that index.
_LIFECYCLE = (
    "WITH last AS (SELECT j.value AS session_id,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind IN ('session_start', 'prompt', 'turn_end', 'attention', 'session_end')"
    "  AND NOT (e.kind = 'session_start' AND COALESCE(e.source, '') = ?4)"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS last_event,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind IN ('session_start', 'prompt', 'turn_end', 'session_end')"
    "  AND NOT (e.kind = 'session_start' AND COALESCE(e.source, '') = ?4)"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS turn_event,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'session_start' AND COALESCE(e.source, '') != ?4"
    "  AND COALESCE(e.agent_id, '') = '' ORDER BY e.id DESC LIMIT 1) AS last_start,"
    " (SELECT e.id FROM execution_events e"
    "  WHERE e.session_id = j.value AND e.session_id IS NOT NULL"
    "  AND e.kind = 'prompt' AND COALESCE(e.agent_id, '') = ''"
    "  ORDER BY e.id DESC LIMIT 1) AS last_prompt"
    " FROM json_each(?1) j)"
    " SELECT l.session_id, a.kind AS last_kind,"
    " COALESCE(a.occurred_at, a.received_at) AS last_at, t.kind AS turn_kind,"
    " COALESCE(t.occurred_at, t.received_at) AS turn_at,"
    " (SELECT COALESCE(s.occurred_at, s.received_at) FROM execution_events s"
    "  WHERE s.id = l.last_start) AS started, l.last_prompt IS NOT NULL AS prompted,"
    " NULL AS written, '' AS agent_id, 0 AS happened"
    " FROM last l LEFT JOIN execution_events a ON a.id = l.last_event"
    " LEFT JOIN execution_events t ON t.id = l.turn_event"
    " UNION ALL"
    " SELECT l.session_id, NULL, NULL, NULL, NULL, NULL, 0, e.work_item_id, '', e.id"
    " FROM last l"
    " JOIN execution_events e ON e.session_id = l.session_id AND e.id > l.last_prompt"
    " WHERE e.kind = ?2 AND e.identity_state = ?3 AND e.work_item_id IS NOT NULL"
    " AND COALESCE(e.agent_id, '') = ''"
    " UNION ALL"
    " SELECT l.session_id, NULL, NULL, NULL, NULL, NULL, 0, e.work_item_id, e.agent_id, e.id"
    " FROM last l"
    " JOIN execution_events e ON e.session_id = l.session_id"
    " AND e.id > COALESCE(l.last_start, 0)"
    " WHERE COALESCE(e.agent_id, '') != '' AND (e.kind = 'subagent_start'"
    " OR (e.kind = ?2 AND e.identity_state = ?3 AND e.work_item_id IS NOT NULL))"
    " ORDER BY happened"
)

#: What these sessions hold, and where each last wrote among it. First every item their
#: confirmed calls claimed and still hold, in any space; the open steps each holds itself
#: are given, since a step's holder is read from its item. Then one row per session that
#: holds anything: the held item its own confirmed write named last. That walks
#: `execution_events_session` back from the session's newest event to the first that
#: names a held item, which a claim is, so it ends at the claim at the latest.
_HOLDS = (
    "WITH held(session_id, item) AS ("
    " SELECT c.session_id, w.work_item_id FROM work_items w"
    " JOIN execution_events c ON c.id = w.claim_call_id"
    " WHERE w.claim_ref != '' AND c.identity_state = ?1"
    " AND c.session_id IN (SELECT value FROM json_each(?2))"
    " UNION SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')"
    " FROM json_each(?3))"
    " SELECT session_id, item, 0 AS stands FROM held"
    " UNION ALL"
    " SELECT s.session_id, (SELECT e.work_item_id FROM execution_events e"
    "  WHERE e.session_id = s.session_id AND e.session_id IS NOT NULL"
    "  AND e.kind = ?4 AND e.identity_state = ?1 AND COALESCE(e.agent_id, '') = ''"
    "  AND e.work_item_id IN (SELECT h.item FROM held h WHERE h.session_id = s.session_id)"
    "  ORDER BY e.id DESC LIMIT 1), 1"
    " FROM (SELECT DISTINCT session_id FROM held) s"
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

    #: Its last own event, a notice included, and when, to the second.
    last_kind: str = ""
    last_at: str = ""
    #: The last of its own events that open or end a turn, and when.
    turn_kind: str = ""
    turn_at: str = ""
    started: str = ""
    prompted: bool = False
    #: The item its own latest write since its last prompt named.
    wrote_last: str | None = None
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
    """What a session heard from within `LIVE_QUIET` is seen doing, at work or not."""

    #: The items its live subagents are seen on, by their writes and their labels.
    items: set[str]
    #: Its live subagents, each spelled as a holder's label spells it.
    agents: set[str]
    #: Whether a turn of its own runs.
    turn: bool
    #: The item its own latest write since its last prompt named.
    wrote_last: str | None
    #: When what it is doing now began: its turn's last event, or the end of its last turn.
    since: str
    #: Whether it was ever given a prompt.
    prompted: bool
    #: Its live subagents with no write of their own, and what their launch said of them.
    unwritten: dict[str, _Unwritten] = field(default_factory=dict)
    #: The others, each with the item its latest write named: where `ladder` places it.
    last_written: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class SessionWork:
    """One top-level session heard from within `LIVE_QUIET`, as the live-work frame lists it."""

    #: `working` or `waiting`.
    state: str
    #: Whether it has waited for longer than `WAITING_LONG`.
    long: bool
    #: Whether a notice stands in its open turn: it waits for a person in the middle of it.
    asks: bool
    #: When what it is doing now began. Only its own lifecycle events move it.
    since: str
    #: Whether it was ever given a prompt: one opened and left alone waits for nobody.
    prompted: bool
    #: Every item its work is on: what it holds, where it stands, where its subagents stand.
    items: frozenset[str]
    #: How many live subagents it has.
    subagents: int


@dataclass(frozen=True)
class Placement:
    """What `placed` reads: the map a graph moves by, and who stands where.

    `agents` counts the live subagents `ladder`'s order places on each item, each on
    one item, so it may name an item the caller did not pass. `shown_by` names, for an
    item of the map, the session its state comes from; an item only an attempt moves
    has none. `sessions` holds every top-level session heard from within `LIVE_QUIET`,
    whether or not any of its work is among the items passed.
    """

    live: dict[str, dict]
    agents: dict[str, int] = field(default_factory=dict)
    shown_by: dict[str, str] = field(default_factory=dict)
    sessions: dict[str, SessionWork] = field(default_factory=dict)


@dataclass(frozen=True)
class _Holds:
    """What the sessions at work hold, in any space."""

    #: By its claims and the open steps it holds itself.
    own: dict[str, set[str]]
    #: Those and the open steps its subagents hold.
    every: dict[str, set[str]]
    #: The open step each subagent holds, by session and agent.
    steps: dict[tuple[str, str], str] = field(default_factory=dict)
    #: Among what it holds itself, the item its own write named last.
    wrote_last: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class _LowerSigns:
    """What `_lower_signs` finds for subagents with no write of their own."""

    #: The items the map moves for them, each with the session that moves it: a packet's
    #: item, or a parent's single hold.
    moved: dict[str, str]
    #: Where each stands, by session and agent, as `ladder` orders the signs.
    placed: dict[tuple[str, str], str]


def _behind(
    conn: sqlite3.Connection, listed: list[Mapping], identities: str
) -> tuple[dict[str, dict[str, set[str]]], dict[str, set[str]]]:
    """The sessions behind each item, its claim's and its open steps' holders'.

    Each comes with the subagents of that session that hold an open step of the item.
    Beside them, the listed items each session holds an open step of itself.
    """

    behind: dict[str, dict[str, set[str]]] = {}
    own_steps: dict[str, set[str]] = {}
    for row in conn.execute(_CLAIMS, (identities, calls.CONFIRMED)):
        behind.setdefault(str(row["work_item_id"]), {}).setdefault(str(row["session_id"]), set())
    for item in listed:
        for step in item["checklist"]:
            holder = None if step["done"] else calls.holder_ids(str(step["claimed_by"] or ""))
            if holder is not None:
                identity = str(item["work_item_id"])
                agents = behind.setdefault(identity, {}).setdefault(holder[0], set())
                if holder[1] is not None:
                    agents.add(holder[1])
                else:
                    own_steps.setdefault(holder[0], set()).add(identity)
    return behind, own_steps


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
            read.wrote_last = str(item)
        else:
            read.last_kind = str(row["last_kind"] or "")
            read.last_at = str(row["last_at"] or "")[:_SECOND]
            read.turn_kind = str(row["turn_kind"] or "")
            read.turn_at = str(row["turn_at"] or "")[:_SECOND]
            read.started = str(row["started"] or "")[:_SECOND]
            read.prompted = bool(row["prompted"])
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


def _turn(read: _Lifecycle, transcript: str, heard: str, now: datetime) -> str:
    """What an open turn of the session's own is doing: `_RUNS`, `_ASKS`, or neither.

    Neither is a turn that is over, or one whose client has not been seen alive in it
    for `TURN_SILENT`. `heard` is when the session was last heard from, which stands
    in for a transcript there is none to read: its hooks and its calls move it, so a
    client that fell does not read as at work for the day a silent session gets.
    """

    if read.turn_kind != "prompt":
        return ""
    limit = (now - TURN_SILENT).strftime(_MOMENT)
    noticed = read.last_kind == "attention"
    if not noticed and read.last_at >= limit:
        return _RUNS
    written = agents.session_transcript_moment(transcript)
    if noticed and written <= read.last_at:
        return _ASKS
    return _RUNS if max(written or heard, read.last_at) >= limit else ""


def _states(
    conn: sqlite3.Connection, named: set[str], references: Mapping[str, str]
) -> tuple[dict[str, dict], dict[str, _SeenOn]]:
    """The state of every live session, named or recently heard from, and what it is seen on.

    A session at work reads `working` here; which items it moves is the item's
    question, answered in `placed`. `references` are the items a label can name.
    """

    now = leases.utc_now()
    recent = (now - LIVE_QUIET).strftime(_STAMP)
    live: dict[str, dict] = {}
    heard: dict[str, str] = {}
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
            live[str(row["id"])] = {
                "state": WAITING,
                "long": seen < now - WAITING_LONG,
                "asks": False,
            }
            heard[str(row["id"])] = seen.strftime(_STAMP)
    awake = sorted(heard)
    if not awake:
        return live, {}
    seen_on: dict[str, _SeenOn] = {}
    for session, read in _lifecycle(conn, awake).items():
        items: set[str] = set()
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
        turn = _turn(read, transcripts[session], heard[session][:_SECOND], now)
        since = read.last_at if read.turn_kind == "prompt" else read.turn_at
        seen_on[session] = _SeenOn(
            items=items,
            agents=running,
            turn=turn == _RUNS,
            wrote_last=read.wrote_last,
            since=f"{since}Z" if since else heard[session],
            prompted=read.prompted,
            unwritten=unwritten,
            last_written=last_written,
        )
        if turn == _RUNS or running:
            live[session] = {"state": WORKING}
        elif turn == _ASKS:
            live[session]["asks"] = True
    return live, seen_on


def _holds(
    conn: sqlite3.Connection,
    at_work: list[str],
    own_steps: Mapping[str, set[str]],
    held_steps: Mapping[str, str] | None,
) -> _Holds:
    """What the sessions at work hold in any space, and where each last wrote among it."""

    found = _Holds({session: set() for session in at_work}, {session: set() for session in at_work})
    if not at_work:
        return found
    for session in at_work:
        found.own[session] |= own_steps.get(session, set())
    held = ladder.held_steps(conn) if held_steps is None else held_steps
    for holder, item in held.items():
        ids = calls.holder_ids(holder)
        if ids is None or ids[0] not in found.own:
            continue
        if ids[1] is None:
            found.own[ids[0]].add(item)
        else:
            found.every[ids[0]].add(item)
            found.steps[(ids[0], ids[1])] = item
    stepped = [[session, item] for session in at_work for item in sorted(found.own[session])]
    parameters = (calls.CONFIRMED, json.dumps(at_work), json.dumps(stepped), calls.KIND)
    for row in conn.execute(_HOLDS, parameters):
        session = str(row["session_id"])
        if not row["stands"]:
            found.own[session].add(str(row["item"]))
        elif row["item"] is not None:
            found.wrote_last[session] = str(row["item"])
    for session in at_work:
        found.every[session] |= found.own[session]
    return found


def _stands(session: str, seen: _SeenOn, holds: _Holds) -> str | None:
    """The one item a session whose own turn runs stands on; see the module's rule."""

    own = holds.own[session]
    if not own:
        return seen.wrote_last
    if session in holds.wrote_last:
        return holds.wrote_last[session]
    return next(iter(own)) if len(own) == 1 else None


def _lower_signs(
    conn: sqlite3.Connection,
    states: Mapping[str, dict],
    seen_on: Mapping[str, _SeenOn],
    holds: _Holds,
) -> _LowerSigns:
    """What subagents with no write of their own stand on, by the rest of `ladder`'s order.

    A step it holds, wherever that is, leaves nothing to add to the map: `placed`
    moves a listed one, and an unlisted one still says this subagent is on it and not
    on its parent's. A label's number moves nothing here either, since `_states` has
    moved every listed item a label names; it only places the subagent.
    """

    found = _LowerSigns({}, {})
    for session, seen in seen_on.items():
        if states[session]["state"] != WORKING:
            continue
        for agent, known in seen.unwritten.items():
            step = holds.steps.get((session, agent))
            if step is not None:
                found.placed[(session, agent)] = step
                continue
            if known.packet_item is not None:
                found.moved[known.packet_item] = session
                found.placed[(session, agent)] = known.packet_item
                continue
            named = ladder.first_named_item(conn, known.label)
            if named is not None:
                found.placed[(session, agent)] = named
            elif len(holds.every[session]) == 1:
                found.moved.update(dict.fromkeys(holds.every[session], session))
                found.placed[(session, agent)] = next(iter(holds.every[session]))
    return found


def _strength(state: Mapping) -> float:
    strength = _STRENGTH[state["state"]]
    return strength + (0.5 if state.get("long") else 0.0) - (0.25 if state.get("asks") else 0.0)


def _outdoes(first: dict | None, second: dict) -> bool:
    """Whether an item that shows `first` shows `second` instead, once both stand behind it."""

    if first is None or _strength(second) < _strength(first):
        return True
    return first["state"] == second["state"] == QUIET and (
        second["quiet_since"] > first["quiet_since"]
    )


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
    """The map `live_work` gives, with where each live subagent stands and what each session does.

    One read for both: the map is the graph's, unchanged, and the rest is what the
    live-work frame lists. A subagent stands where `ladder` places it: the item of
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
    behind, own_steps = _behind(conn, listed, identities)
    references = {
        str(item["reference"]): str(item["work_item_id"]) for item in listed if "reference" in item
    }
    states, seen_on = _states(
        conn, {session for held in behind.values() for session in held}, references
    )
    at_work = sorted(session for session in seen_on if states[session]["state"] == WORKING)
    holds = _holds(conn, at_work, own_steps, held_steps)
    found: dict[str, dict] = {}
    shown_by: dict[str, str] = {}
    for identity, holders in behind.items():
        for session, holding in holders.items():
            state = states.get(session)
            if state is None:
                continue
            if state["state"] == WORKING and not holding & seen_on[session].agents:
                state = {"state": HELD}
            if _outdoes(found.get(identity), state):
                found[identity] = state
                shown_by[identity] = session
    # Where a session at work stands and what its subagents are seen on moves,
    # whether the session holds the item or not.
    mapped = set(order)
    stands: dict[str, str] = {}
    for session in at_work:
        seen = seen_on[session]
        moved = set(seen.items)
        own = _stands(session, seen, holds) if seen.turn else None
        if own is not None:
            stands[session] = own
            moved.add(own)
        for identity in moved & mapped:
            found[identity] = {"state": WORKING}
            shown_by[identity] = session
    lower = _lower_signs(conn, states, seen_on, holds)
    for identity, session in lower.moved.items():
        if identity in mapped:
            found[identity] = {"state": WORKING}
            shown_by[identity] = session
    for row in conn.execute(_ATTEMPTS, (identities,)):
        identity = str(row["work_item_id"])
        if found.get(identity, {}).get("state") != WORKING:
            # The attempt moves the row, so it shows no session's state: the one
            # that waits behind the item is not what the row says.
            found[identity] = {"state": WORKING}
            shown_by.pop(identity, None)
    # In the items' order, so an unchanged map is an unchanged frame of the stream.
    live = {identity: found[identity] for identity in order if identity in found}
    agents: dict[str, int] = {}
    known: dict[str, SessionWork] = {}
    for session, seen in seen_on.items():
        state = states[session]
        work = {identity for identity, holders in behind.items() if session in holders}
        if state["state"] == WORKING:
            standing = dict(seen.last_written)
            for agent in seen.unwritten:
                item = lower.placed.get((session, agent))
                if item is not None:
                    standing[agent] = item
            for item in standing.values():
                agents[item] = agents.get(item, 0) + 1
            work |= seen.items | set(standing.values())
            if session in stands:
                work.add(stands[session])
        known[session] = SessionWork(
            state=str(state["state"]),
            long=bool(state.get("long")),
            asks=bool(state.get("asks")),
            since=seen.since,
            prompted=seen.prompted,
            items=frozenset(work),
            subagents=len(seen.agents),
        )
    return Placement(
        live,
        agents,
        {identity: shown_by[identity] for identity in live if identity in shown_by},
        known,
    )
