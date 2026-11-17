"""What a person did on one work item since an agent last wrote to it.

A person working in the interface and an agent working through its tools share
an item and no channel, so what the person said used to wait until somebody told
the agent to go and look. This is the read that closes the gap: an agent's write
carries it back (`tools`), and a close is refused over it (`transitions`).

It keeps no state. The window is what the store already holds: the writes that
came through the interface after the last write an agent made to this item, so
an agent's write moves the boundary by being written, and a refused one, rolled
back, moves nothing. It belongs to the item and not to one agent: whichever agent
writes next is the one told, once.

Order is the call rows' ids, because they are one sequence across every table,
where `created_at` is whole seconds in two of them and a tie decides who was told.
A row that points at no call, the runner's or one from before calls were recorded,
is on neither side: nobody proved it came through the interface, and no agent got
an answer from it. Nor does Valkama's own write move the boundary. Releasing a
lapsed claim tells nobody anything, so it must not end the window for the agent
that comes next.

Only what an agent should act on counts. A launch writes under the interface's
credential, but its claim and notes are the launch's words rather than a person's,
so only Planning's own paths do. An edit logs no event, so its call row names what
it edited (`calls.call_id`), and an edit that changed nothing names nothing and
is nobody speaking.

A client hook keeps its own place instead (`since_call`): it tells the agents of
one session, and an item's window ends at any agent's write, so a subagent's tick
would end it before the session's orchestrator was told. The hook remembers the
last call it has read for each item and asks for what came after that. The same
hook reads what other agents wrote apart (`agents_since`), from the same rows and
into the same entries: it is told to the holders and followers, and never as a
person's; so is what Valkama recorded in a call of its own, a lease that ran out
(`valkama_since`). What is written under a goal an orchestrator works on reaches it from
items it never wrote to, so for those the hook reads every item's new rows at once,
from three places of its own (`tree_since`), and keeps the items of its tree.

Nothing here is imported at module level past `sqlite3`: a client hook calls this
on a read-only connection of its own, in a process that starts for one tool call,
where every module loaded is paid on every call. `json` and `request_model` are
needed only for a report or an answer, so they are loaded there. The rows are
read by position for the same reason, since such a connection sets no factory.
"""

from __future__ import annotations

import sqlite3

# `typing` and `collections.abc` cost a client hook time it does not spend; the checker
# reads the names.
TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

#: What `execution_events.identity_source` says about a call; `calls` publishes these.
BROWSER = "browser"
VALKAMA = "valkama"
#: A launch's claim (`calls.launch`): its session is proved by the launch, not by the
#: client, so it is no agent speaking, as it was not while it rode the interface's call.
LAUNCH = "launch"
#: What `execution_events.kind` says about a Planning write call.
KIND = "planning_write"

#: How much of what was written one event quotes, the ellipsis counted: most comments
#: come whole, so the reader need not open the item. A cut one says `cut: true`.
MAX_TEXT = 1500
#: How many events one answer names, the newest ones.
MOST_SHOWN = 20

#: Every action a person's write can be told as, by the kind it is told under.
KINDS = {
    "transitioned": "status",
    # A container that came to stand open again: a change of its state, as a move is.
    "opened": "status",
    "claimed": "claimed",
    "released": "released",
    "taken_over": "taken_over",
    "linked": "linked",
    "unlinked": "unlinked",
    "checklist_replaced": "steps_edited",
    "checklist_claimed": "step_claimed",
    "checklist_taken_over": "step_taken_over",
    "checklist_released": "step_released",
    "checklist_completed": "step_completed",
    "checklist_reopened": "step_reopened",
    "summarized": "summary_selected",
    "request_created": "question_asked",
    "request_answered": "question_answered",
    "request_declined": "question_declined",
    "request_expired": "question_withdrawn",
    "comment_resolved": "thread_resolved",
    "comment_reopened": "thread_reopened",
    "request_changed": "question_changed",
    # A person's words about this item, written on another one in a comment's `mentions`.
    "mentioned": "mentioned",
    # Nothing under a goal or stage is open any more: it waits for its confirmation.
    "awaiting_confirmation": "awaiting_confirmation",
    # A task made a goal or stage, or back: a change of what it is, not of where it
    # stands, which the `opened` or `transitioned` beside it tells as `status`.
    "converted": "converted",
}
#: The kinds that say where the work stands: its state changed, it got its summary, it
#: was left without a holder or changed holders, it came to wait for the owner or
#: stopped waiting. An orchestrator hears these of its own subagents' writes.
WORK_KINDS = frozenset(
    {"status", "summary_selected", "released", "taken_over", "question_asked", "question_withdrawn"}
)
#: The actions never told. `created`: an item a person filed says what it says, in
#: the description an agent reads when it takes it. `execution_attached`: a launch
#: or an observed session, which the agent in question already knows. `overridden`:
#: a note on the transition or merge beside it, which is told. `labels_changed`: a
#: person's edit of the labels, which is told as the edit its call row names.
#: `accepted`: the basis of an acceptance, beside the write that accepted the item.
#: `child_left`: a child's move out of this container, told on the child itself.
#: `returned`: why put-off work came back, beside the move that brought it, which is told.
NOT_TOLD = frozenset(
    {
        "created",
        "execution_attached",
        "overridden",
        "labels_changed",
        "accepted",
        "child_left",
        "returned",
    }
)
#: What a goal or stage put off is told with, after the move's own words: the work
#: under it is not put off with it.
DEFERRED_WORK = (
    "Work under it stays with whoever holds it; the queue hands out none of it until it comes back."
)
#: Whether a move went into a deferred state of a goal's or stage's workflow, by the
#: key its detail opens with.
_DEFERRED_CONTAINER = (
    "SELECT 1 FROM work_items i JOIN workflow_states s ON s.workflow_id = i.workflow_id"
    " WHERE i.work_item_id = ? AND i.kind = 'container' AND s.category = 'deferred'"
    " AND s.key = ?"
)
#: The kinds of Valkama's own records that ask for a session: one wakes it, as a person's
#: act does, and waits on a goal or stage nobody works on for the next session that takes
#: work there (`waiting`). A goal or stage awaiting its confirmation asks to be confirmed,
#: which is the point of saying so; a lease that ran out is told at the next tool call.
SERVER_ASKS: frozenset[str] = frozenset({"awaiting_confirmation"})

#: The call that edits an item's fields, and those fields' columns by the name
#: `calls.call_id` records. The one place a name read back from a row meets SQL.
_EDIT_TOOL = "/api/planning/work-item/update"
_EDITED_COLUMNS = {
    "title": 0,
    "description": 1,
    "source": 2,
    "priority": 3,
    "labels": 4,
    "kind": 5,
    "parent_id": 6,
}
_ITEM_FIELDS = (
    "SELECT title,description,source,priority,labels,kind,parent_id"
    " FROM work_items WHERE work_item_id = ?"
)

_LAST_AGENT_EVENT = (
    "SELECT MAX(c.id) FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND c.work_item_id = ?"
    " AND c.identity_source NOT IN (?,?,?) AND c.id <> ?"
)
_LAST_AGENT_COMMENT = (
    "SELECT MAX(c.id) FROM work_item_comments m JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.work_item_id = ? AND c.work_item_id = ?"
    " AND c.identity_source NOT IN (?,?,?) AND c.id <> ?"
)
#: A person's writes come through Planning's own paths, under both of its mounts: the
#: interface answers a question through the module surface (`interactions.WRITE_PATHS`)
#: and does the rest through `/api/planning/`. A launch writes through neither.
_PERSON_COMMENTS = (
    "SELECT m.id, m.body, m.report, m.created_at, m.call_id, m.reply_to, m.reply_to_request"
    " FROM work_item_comments m JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.work_item_id = ? AND m.call_id > ? AND c.identity_source = ?"
    " AND (c.tool LIKE '/api/planning/%' OR c.tool LIKE '/api/modules/planning/%')"
    " ORDER BY m.id"
)
_PERSON_EVENTS = (
    "SELECT e.id, e.action, e.detail, e.created_at, e.call_id"
    " FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.call_id > ? AND c.identity_source = ?"
    " AND (c.tool LIKE '/api/planning/%' OR c.tool LIKE '/api/modules/planning/%')"
    " ORDER BY e.id"
)
#: Who wrote a thread's root and who asked a question, by the call that did it. Only
#: a confirmed call says: a session an unconfirmed one names was never proved.
_ROOT_AUTHOR = (
    "SELECT c.session_id, c.agent_id FROM work_item_comments m"
    " JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.id = ? AND c.identity_state = 'confirmed'"
)
_ASKER = (
    "SELECT c.session_id, c.agent_id FROM work_item_events e"
    " JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.action = 'request_created' AND e.detail = ?"
    " AND c.identity_state = 'confirmed' ORDER BY e.id LIMIT 1"
)


def since_last_agent_write(
    conn: sqlite3.Connection, work_item_id: str, *, own_call: int | None = None
) -> list[dict]:
    """The person's events on one item that no agent's write has come after, oldest first.

    Each says its `kind`, `via` (always `interface`: the one thing this store can
    prove about who did it, since an `author` is text the caller wrote), `at`, and
    `comment_id`, `request_id` or `fields` when it has one, and `text`, the start
    of what it said, when it said anything. The whole text is in `get_work_item`.

    `own_call` is the call in progress, left out of the agent's writes: everything
    one call writes is one write, so what its first group wrote does not move the
    boundary for its last. A read outside any call passes nothing.
    """

    boundary, edits = _boundary_and_edits(conn, work_item_id, own_call)
    return [entry for _call, entry in _window(conn, work_item_id, boundary, edits)]


def since_call(
    conn: sqlite3.Connection, work_item_id: str, after: int, *, with_edits: bool = True
) -> list[tuple[int, dict]]:
    """The person's events on one item whose call came after `after`, oldest first.

    Each comes with the id of its call row, so a reader that keeps its own place
    can remember how far it has read. The entries are the ones
    `since_last_agent_write` gives; only where the window starts differs.

    Edits are found on the call rows, which have no index by item, so a reader
    with no use for them passes `with_edits=False` and stays on the item's indexes.
    """

    edits = (
        conn.execute(
            "SELECT id, identity_source, tool, reason, received_at FROM execution_events"
            " WHERE id > ? AND work_item_id = ? AND kind = ? AND identity_source = ?"
            " AND tool = ? AND reason <> '' ORDER BY id",
            (after, work_item_id, KIND, BROWSER, _EDIT_TOOL),
        ).fetchall()
        if with_edits
        else []
    )
    return _window(conn, work_item_id, after, edits)


#: How long a comment that waits for a reply goes on asking for the holders, as
#: SQLite's date modifier: an older one is told and wakes nobody.
ASKS_FOR = "-1 day"
#: What other agents wrote on an item: the speaker is the call's proved session and
#: agent, never the `author` it signed, and an unproved call names nobody. The same
#: rows `_window` reads for a person, through an agent's call instead.
_AGENT_COMMENTS = (
    "SELECT m.id, m.body, m.report, m.created_at, m.call_id, m.reply_to, m.reply_to_request,"
    " c.session_id, c.agent_id, m.awaits_reply,"
    " m.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) FROM work_item_comments m"
    " JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.work_item_id = ? AND m.call_id > ? AND c.identity_state = 'confirmed'"
    " AND c.identity_source NOT IN (?,?,?) AND c.session_id IS NOT NULL ORDER BY m.id"
)
_AGENT_EVENTS = (
    "SELECT e.id, e.action, e.detail, e.created_at, e.call_id, c.session_id, c.agent_id"
    " FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.call_id > ? AND c.identity_state = 'confirmed'"
    " AND c.identity_source NOT IN (?,?,?) AND c.session_id IS NOT NULL ORDER BY e.id"
)


def agents_since(conn: sqlite3.Connection, work_item_id: str, after: int) -> list[tuple[int, dict]]:
    """What agents wrote on one item through calls after `after`, oldest first, with the call.

    The kinds a person's act is told by, and the same entries: a comment, a reply,
    a report, every event `KINDS` names, a mention of this item written on another.
    No agent's act is a person's, so `_window` never reads these and they are in
    neither `from_person` nor the `person_spoke` guard: a client hook tells them
    apart. Each entry has `via: "agent"`, and `session` and `agent`, the speaker as
    its call row names it, so the hook can leave out the recipient's own words and
    always says whose these are; a comment that waits for a reply says
    `awaits_reply: true`, and `recent: true` while it is younger than `ASKS_FOR`,
    as does a mention by one. Who is told is the hook's to decide.
    """

    found: list[tuple[tuple[int, int, int], dict]] = []
    bound = (work_item_id, after, BROWSER, VALKAMA, LAUNCH)
    reports: set[int] = set()
    for row in conn.execute(_AGENT_COMMENTS, (ASKS_FOR, *bound)).fetchall():
        if row[2]:
            reports.add(int(row[4]))
        entry = _spoken(_comment_entry(row), row[7], row[8])
        if row[9]:
            entry["awaits_reply"] = True
            if row[10]:
                entry["recent"] = True
        found.append(((int(row[4]), 1, int(row[0])), entry))
    for row in conn.execute(_AGENT_EVENTS, bound).fetchall():
        action = str(row[1])
        if action not in KINDS or (action == "summarized" and int(row[4]) in reports):
            continue
        found.append(
            (
                (int(row[4]), 2, int(row[0])),
                _spoken(_event_entry(conn, row, work_item_id), row[5], row[6]),
            )
        )
    return [(order[0], entry) for order, entry in sorted(found, key=lambda pair: pair[0])]


#: What Valkama recorded on an item in a call of its own (`calls.valkama()`): a write the
#: server makes inside another caller's call is that caller's, and read as theirs.
_VALKAMA_EVENTS = (
    "SELECT e.id, e.action, e.detail, e.created_at, e.call_id"
    " FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.call_id > ? AND c.identity_source = ? ORDER BY e.id"
)


def valkama_since(
    conn: sqlite3.Connection, work_item_id: str, after: int
) -> list[tuple[int, dict]]:
    """What Valkama recorded on one item through calls of its own after `after`, with the call.

    The events `KINDS` names, in the entries a person's act is told by, with
    `via: "valkama"`: neither a person's words nor another agent's, so they are in
    neither `from_person` nor `agents_since`. One of a kind in `SERVER_ASKS` says
    `asks: true`. Who is told is the hook's to decide.
    """

    found = []
    for row in conn.execute(_VALKAMA_EVENTS, (work_item_id, after, VALKAMA)).fetchall():
        if str(row[1]) in KINDS:
            found.append((int(row[4]), _by_valkama(_event_entry(conn, row, work_item_id))))
    return found


def unheard(conn: sqlite3.Connection, work_item_id: str, after: int) -> list[tuple[int, dict]]:
    """What waits on a container for whoever works there, after `after`, with its call.

    A person's acts as `from_person` gives them, and Valkama's own records of a kind
    that asks for a session (`SERVER_ASKS`), in the order of their calls. Valkama's
    other records wake nobody, so a session that missed them lost nothing. Words left
    waiting (`waiting`) are these, and so is what a client hook tells the orchestrator
    whose subagent was handed them.
    """

    found = since_call(conn, work_item_id, after)
    asking = [
        (call, entry)
        for call, entry in valkama_since(conn, work_item_id, after)
        if entry.get("asks")
    ]
    if not asking:
        return found
    return sorted([*found, *asking], key=lambda pair: pair[0])


def _by_valkama(entry: dict) -> dict:
    entry["via"] = VALKAMA
    if entry["kind"] in SERVER_ASKS:
        entry["asks"] = True
    return entry


#: How many rows of each source one read of the tree's news takes: the rest is read the
#: next time, from where this one stopped, so nothing is lost and no read grows unbounded.
MOST_FEED_ROWS = 2000
#: The rows after a place, of every item, in order, with what the call that wrote each
#: proved: whose words they are is decided here, from the call row, as for one item.
_FEED_EVENTS = (
    "SELECT e.id, e.action, e.detail, e.created_at, e.call_id, e.work_item_id,"
    " c.identity_source, c.identity_state, c.tool, c.session_id, c.agent_id"
    " FROM work_item_events e LEFT JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.id > ? ORDER BY e.id LIMIT ?"
)
_FEED_COMMENTS = (
    "SELECT m.id, m.body, m.report, m.created_at, m.call_id, m.reply_to, m.reply_to_request,"
    " m.work_item_id, c.identity_source, c.identity_state, c.tool, c.session_id, c.agent_id,"
    " m.awaits_reply, m.created_at >= (SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?))"
    " FROM work_item_comments m LEFT JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.id > ? ORDER BY m.id LIMIT ?"
)
#: The call rows are read by key alone: the last of the next ones a read takes, and among
#: those the person's edits, which no event or comment row names.
_FEED_LAST_CALL = (
    "SELECT MAX(id) FROM (SELECT id FROM execution_events WHERE id > ? ORDER BY id LIMIT ?)"
)
_FEED_EDITS = (
    "SELECT id, identity_source, tool, reason, received_at, work_item_id FROM execution_events"
    " WHERE id > ? AND id <= ? AND kind = ? AND identity_source = ? AND tool = ?"
    " AND reason <> '' AND work_item_id IS NOT NULL ORDER BY id"
)
#: The tools a person's write comes through, the `LIKE` of `_PERSON_EVENTS` as prefixes.
_PERSON_TOOLS = ("/api/planning/", "/api/modules/planning/")


def tree_since(
    conn: sqlite3.Connection,
    after: tuple[int, int, int],
    choose: Callable[[set[str]], Mapping[str, bool]],
    *,
    asked_of: str | None = None,
) -> tuple[list[tuple[str, int, dict]], tuple[int, int, int]]:
    """What was written on any item after three places, for the items `choose` keeps,
    and every event of a request asked of the session `asked_of`, wherever it was asked.

    The places are an event, a comment and a call row: the three sources a person's
    or an agent's write lands in, an edit being found on its call row alone. Each
    source is read by its primary key after its place, at most `MOST_FEED_ROWS` rows,
    and `choose` is asked once which of the items those rows name to read, so a reader
    of a whole tree pays for the rows written since, not for the size of the tree.
    For each item it keeps it says whether everything there is read, or only what
    says where the work stands (`WORK_KINDS`).

    Each entry is the one `since_call` or `agents_since` gives for that item: a
    person's act with `via: "interface"`, an edit with what it edited as it reads
    now, another agent's write with its `session` and `agent`, an event Valkama
    recorded in a call of its own as `valkama_since` gives it. A row whose call proved
    nobody is nobody's words and is left out, and so is a comment of Valkama's. They come
    as `(work_item_id, call, entry)` in the order the calls were made, with the
    places the next read starts from: the last row read of each source.

    The events of a request asked of `asked_of` come whatever `choose` says of their
    item, every kind of them: a session is asked from anywhere on the board. Each
    request's entry names its `addressee` (`_request_entry`), so the reader can leave
    out what was asked of somebody else; who is told is the reader's to decide.
    """

    most = MOST_FEED_ROWS
    events = conn.execute(_FEED_EVENTS, (after[0], most)).fetchall()
    comments = conn.execute(_FEED_COMMENTS, (ASKS_FOR, after[1], most)).fetchall()
    last = conn.execute(_FEED_LAST_CALL, (after[2], most)).fetchone()[0]
    edits = (
        conn.execute(_FEED_EDITS, (after[2], last, KIND, BROWSER, _EDIT_TOOL)).fetchall()
        if last
        else []
    )
    places = (
        int(events[-1][0]) if events else after[0],
        int(comments[-1][0]) if comments else after[1],
        int(last) if last else after[2],
    )
    named = {str(row[5]) for row in events} | {str(row[7]) for row in comments}
    named |= {str(row[5]) for row in edits}
    kept = choose(named) if named else {}
    theirs = _asked_of(conn, asked_of, events) if asked_of else set()
    found: list[tuple[tuple[int, int, int], str, dict]] = []
    reports: set[int] = set()
    for row in comments:
        item = str(row[7])
        if not kept.get(item):
            continue  # not kept, or a task, where no comment says where the work stands
        speaker = _feed_speaker(row[8], row[9], row[10], row[11])
        if speaker is None or speaker == VALKAMA:
            continue
        if row[2]:
            reports.add(int(row[4]))
        entry = _comment_entry(row)
        if speaker != BROWSER:
            entry = _spoken(entry, row[11], row[12])
            if row[13]:
                entry["awaits_reply"] = True
                if row[14]:
                    entry["recent"] = True
        found.append(((int(row[4]), 1, int(row[0])), item, entry))
    for row in events:
        item, action = str(row[5]), str(row[1])
        if action not in KINDS:
            continue
        if not (action.startswith("request_") and str(row[2]) in theirs) and (
            item not in kept or not (kept[item] or KINDS[action] in WORK_KINDS)
        ):
            continue
        speaker = _feed_speaker(row[6], row[7], row[8], row[9])
        if speaker is None:
            continue
        if action == "summarized" and int(row[4]) in reports:
            continue
        entry = _event_entry(conn, row, item)
        if speaker == VALKAMA:
            entry = _by_valkama(entry)
        elif speaker != BROWSER:
            entry = _spoken(entry, row[9], row[10])
        found.append(((int(row[4]), 2, int(row[0])), item, entry))
    by_item: dict[str, list[tuple]] = {}
    for row in edits:
        if kept.get(str(row[5])):
            by_item.setdefault(str(row[5]), []).append(row)
    for item, rows in by_item.items():
        found.extend((order, item, entry) for order, entry in _edit_entries(conn, item, rows))
    found.sort(key=lambda each: each[0])
    return [(item, order[0], entry) for order, item, entry in found], places


def _asked_of(conn: sqlite3.Connection, session: str, events: list[tuple]) -> set[str]:
    """Which of the requests these event rows name were asked of `session`: one read, and
    none when no row is a request's."""

    named = {str(row[2]) for row in events if str(row[1]).startswith("request_")}
    if not named:
        return set()
    import json

    return {
        str(row[0])
        for row in conn.execute(
            "SELECT request_id FROM work_item_requests WHERE addressee = ?"
            " AND request_id IN (SELECT value FROM json_each(?))",
            (session, json.dumps(sorted(named))),
        )
    }


def _feed_speaker(source: object, state: object, tool: object, session: object) -> str | None:
    """Whose a row of the tree's news is: `browser` for a person, `valkama` for Valkama's
    own call, the session for an agent.

    The rules of `_PERSON_EVENTS`, `_VALKAMA_EVENTS` and `_AGENT_EVENTS`, read off the
    call row: a person through Planning's own paths, an agent through a call that proved
    its session.
    """

    if source == BROWSER:
        return BROWSER if isinstance(tool, str) and tool.startswith(_PERSON_TOOLS) else None
    if source == VALKAMA:
        return VALKAMA
    if source == LAUNCH:
        return None
    if state != "confirmed" or session is None:
        return None
    return str(session)


#: A thread's comments in order, with what the call that wrote each proved: whoever
#: waits for a reply there is told, and woken, by the first that answers it.
_THREAD_ROWS = (
    "SELECT m.id, m.call_id, m.awaits_reply, c.identity_state, c.identity_source, c.tool,"
    " c.session_id, c.agent_id FROM work_item_comments m"
    " LEFT JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.id = ? OR m.reply_to = ? ORDER BY m.id"
)
_QUESTION_THREAD_ROWS = (
    "SELECT m.id, m.call_id, m.awaits_reply, c.identity_state, c.identity_source, c.tool,"
    " c.session_id, c.agent_id FROM work_item_comments m"
    " LEFT JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.reply_to_request = ? ORDER BY m.id"
)
#: The calls that set a root's resolved mark, `<id>` or `<id>: <decision>` in the event,
#: and those that removed it, `<id>`, in order: whether each set it.
_THREAD_MARKS = (
    "SELECT call_id, action = 'comment_resolved' FROM work_item_events WHERE work_item_id = ?"
    " AND action IN ('comment_resolved', 'comment_reopened') AND (detail = ? OR detail LIKE ?)"
    " ORDER BY id"
)


def awaited(
    conn: sqlite3.Connection,
    work_item_id: str,
    entry: dict,
    session_id: str,
    agent_id: str | None,
) -> dict[int, bool]:
    """Who waits in a reply's thread: each comment after this recipient first waited
    there, and whether it is the answer that ended a wait.

    The recipient waits from a comment its own call wrote with `awaits_reply`: its
    session for an orchestrator, itself for a subagent. A wait ends at the first
    later reply by a person or by another confirmed session; the recipient's own
    session never answers it. That reply is the awaited answer unless the thread
    carried its resolved mark when it was written: the wait follows the mark, so a
    resolved thread waits for nothing and a reopened one waits again, and a reply
    under the mark ends the wait as no answer. Every comment after the first wait is
    addressed to the recipient. Empty when it never waited in this thread, which is
    one query for a thread nobody waits in.
    """

    root, question = entry.get("reply_to"), entry.get("reply_to_request")
    if root is not None:
        rows = conn.execute(_THREAD_ROWS, (root, root)).fetchall()
    elif question is not None:
        rows = conn.execute(_QUESTION_THREAD_ROWS, (question,)).fetchall()
    else:
        return {}
    if not any(row[2] and _wrote(row, session_id, agent_id) for row in rows):
        return {}
    marks = (
        [
            (int(row[0]), bool(row[1]))
            for row in conn.execute(_THREAD_MARKS, (work_item_id, str(root), f"{root}: %"))
            if row[0] is not None
        ]
        if root is not None
        else []
    )
    found: dict[int, bool] = {}
    waiting = started = False
    for row in rows:
        call = int(row[1] or 0)
        if _wrote(row, session_id, agent_id):
            if row[2]:
                waiting = started = True
            continue
        if not started:
            continue
        answers = _answers(row, session_id)
        found[int(row[0])] = answers and waiting and not _marked(marks, call)
        if answers:
            waiting = False
    return found


def _marked(marks: list[tuple[int, bool]], call: int) -> bool:
    """Whether a thread carried its resolved mark when `call` wrote in it: the last
    mark set or removed by an earlier call says."""

    state = False
    for mark, resolved in marks:
        if mark < call:
            state = resolved
    return state


def _wrote(row: tuple, session_id: str, agent_id: str | None) -> bool:
    """Whether a thread row is the recipient's own: its session, or for a subagent itself."""

    return (
        row[3] == "confirmed" and row[6] == session_id and (agent_id is None or row[7] == agent_id)
    )


def _answers(row: tuple, session_id: str) -> bool:
    """Whether a thread row answers this session: a person's, or another proved session's."""

    if row[4] == BROWSER:
        tool = str(row[5] or "")
        return tool.startswith(("/api/planning/", "/api/modules/planning/"))
    return (
        row[3] == "confirmed"
        and row[4] not in (VALKAMA, LAUNCH)
        and row[6] is not None
        and row[6] != session_id
    )


#: What a container that came to stand accepted and open is told as: `opened` names no
#: state, and this reader loads nothing that could say what the container derives.
OPENED = "accepted and open"
#: Every move after a call of each item that blocks this one, with the state it
#: reached, whether it is the blocker's last, and what its call proved. A transition
#: logs the key of the state it reached, before `: ` and a note when there is one;
#: an `opened` names no state, only a reason, and is told as `OPENED`, the query's first
#: parameter. The last move is the newest entry into
#: any state, an `opened` among them: a close that a reopening undid is not the last.
_BLOCKER_CHANGES = (
    "SELECT s.key, b.number, b.title,"
    " CASE WHEN e.action = 'opened' THEN ? ELSE COALESCE(st.name, e.detail) END,"
    " e.created_at, e.call_id, c.identity_state, c.identity_source, c.tool, c.session_id,"
    " c.agent_id, COALESCE(st.is_terminal, 0), e.id = (SELECT MAX(t.id) FROM work_item_events t"
    # The actions of `model.STATE_ENTRY_ACTIONS`: this module imports nothing of the product.
    " WHERE t.work_item_id = b.work_item_id AND t.action IN ('created', 'transitioned', 'opened'))"
    " FROM work_item_links l JOIN work_items b ON b.work_item_id = l.from_id"
    " JOIN planning_spaces s ON s.planning_space_id = b.planning_space_id"
    " JOIN work_item_events e ON e.work_item_id = b.work_item_id"
    " AND e.action IN ('transitioned', 'opened')"
    " JOIN execution_events c ON c.id = e.call_id"
    " LEFT JOIN workflow_states st ON e.action = 'transitioned'"
    " AND st.workflow_id = b.workflow_id AND st.key ="
    " CASE WHEN instr(e.detail, ': ') > 0 THEN substr(e.detail, 1, instr(e.detail, ': ') - 1)"
    " ELSE e.detail END"
    " WHERE l.to_id = ? AND l.kind = 'blocks' AND e.call_id > ? ORDER BY e.call_id, e.id"
)


def blocker_changes(
    conn: sqlite3.Connection, work_item_id: str, after: int
) -> list[tuple[int, dict]]:
    """Each state an item blocking this one reached through a call after `after`, oldest first.

    `blocker_closed` when the blocker reached a terminal state and is still there,
    its last transition; `blocker_changed` for every other, a close a later
    transition undid included. Each has the blocker's reference as `blocker`, the
    state that transition reached as `state` and the blocker's title as the text. A
    person's transition through Planning's own paths is a person's act
    (`via: "interface"`); another agent's says who, as `agents_since` does.
    Valkama's own write, a launch and an unproved call name nobody, and are not told.
    """

    found = []
    for row in conn.execute(_BLOCKER_CHANGES, (OPENED, work_item_id, after)).fetchall():
        entry = _entry(
            "blocker_closed" if row[11] and row[12] else "blocker_changed",
            str(row[4]),
            blocker=f"{row[0]}-{row[1]}",
            state=str(row[3]),
            text=str(row[2]),
        )
        source = str(row[7] or "")
        if source == BROWSER:
            if str(row[8] or "").startswith(("/api/planning/", "/api/modules/planning/")):
                found.append((int(row[5]), entry))
        elif row[6] == "confirmed" and source not in (VALKAMA, LAUNCH) and row[9] is not None:
            found.append((int(row[5]), _spoken(entry, row[9], row[10])))
    return found


def _spoken(entry: dict, session: object, agent: object) -> dict:
    entry["via"] = "agent"
    entry["session"] = str(session)
    entry["agent"] = None if agent is None else str(agent)
    return entry


def author_of(
    conn: sqlite3.Connection, work_item_id: str, entry: dict
) -> tuple[str, str | None] | None:
    """The session and agent a reply or a question's event answers, or None.

    The author of the thread's root, or whoever asked the question: read from the
    call that wrote it, never from a name it signed. None for a person's root, a
    row no confirmed call wrote, and a question a merge moved here, whose
    `request_created` stayed on the item it was asked on.
    """

    if "reply_to" in entry:
        row = conn.execute(_ROOT_AUTHOR, (entry["reply_to"],)).fetchone()
    else:
        question = entry.get("reply_to_request", entry.get("request_id"))
        row = conn.execute(_ASKER, (work_item_id, question)).fetchone()
    if row is None or row[0] is None:
        return None
    return str(row[0]), None if row[1] is None else str(row[1])


def _window(
    conn: sqlite3.Connection, work_item_id: str, boundary: int, edits: list[tuple]
) -> list[tuple[int, dict]]:
    """Every entry after `boundary`, with its call, in the order the calls were made."""

    found: list[tuple[tuple[int, int, int], dict]] = []
    if edits:
        found.extend(_edit_entries(conn, work_item_id, edits))
    reports: set[int] = set()
    for row in conn.execute(_PERSON_COMMENTS, (work_item_id, boundary, BROWSER)).fetchall():
        if row[2]:
            reports.add(int(row[4]))
        found.append(((int(row[4]), 1, int(row[0])), _comment_entry(row)))
    for row in conn.execute(_PERSON_EVENTS, (work_item_id, boundary, BROWSER)).fetchall():
        action = str(row[1])
        # A report made current says so itself; only selecting an old one is news.
        if action not in KINDS or (action == "summarized" and int(row[4]) in reports):
            continue
        found.append(((int(row[4]), 2, int(row[0])), _event_entry(conn, row, work_item_id)))
    return [(order[0], entry) for order, entry in sorted(found, key=lambda pair: pair[0])]


def _boundary_and_edits(
    conn: sqlite3.Connection, work_item_id: str, own_call: int | None
) -> tuple[int, list[tuple]]:
    """The last call an agent made on this item, and the person's edits after it.

    The events and comments give it through their item's index. A call that wrote
    neither, an edit or a ref, is found only on the call rows, which have no such
    index, so those are read from the last call known by then: the range is what
    happened since, and no more of the table than that. An agent's row on another
    item's write, the far end of a link, is not this item's: that agent was told
    about the item it wrote to, so this item's news has not reached anybody.
    """

    excluded = -1 if own_call is None else own_call
    bound = (work_item_id, work_item_id, BROWSER, VALKAMA, LAUNCH, excluded)
    boundary = 0
    for query in (_LAST_AGENT_EVENT, _LAST_AGENT_COMMENT):
        boundary = max(boundary, conn.execute(query, bound).fetchone()[0] or 0)
    start = boundary
    if not start:
        first = conn.execute(
            "SELECT MIN(call_id) FROM work_item_events WHERE work_item_id = ?", (work_item_id,)
        ).fetchone()[0]
        start = (first or 1) - 1
    edits: list[tuple] = []
    for row in conn.execute(
        "SELECT id, identity_source, tool, reason, received_at FROM execution_events"
        " WHERE id > ? AND work_item_id = ? AND kind = ? AND id <> ? ORDER BY id",
        (start, work_item_id, KIND, excluded),
    ).fetchall():
        source = str(row[1])
        if source == BROWSER:
            if row[2] == _EDIT_TOOL and row[3]:
                edits.append(row)
        elif source not in (VALKAMA, LAUNCH):
            boundary = int(row[0])
            edits.clear()
    return boundary, edits


def _edit_entries(
    conn: sqlite3.Connection, work_item_id: str, edits: list[tuple]
) -> list[tuple[tuple[int, int, int], dict]]:
    """Each edit by the fields it named, quoting them as they read now: no old value is kept."""

    current = conn.execute(_ITEM_FIELDS, (work_item_id,)).fetchone()
    entries = []
    for row in edits:
        names = [name for name in str(row[3]).split(",") if name in _EDITED_COLUMNS]
        quoted = "; ".join(f"{name}: {current[_EDITED_COLUMNS[name]]}" for name in names)
        entry = _entry("edited", str(row[4]), fields=names, text=quoted)
        entries.append(((int(row[0]), 0, int(row[0])), entry))
    return entries


def _comment_entry(row: tuple) -> dict:
    report = str(row[2])
    at, said = str(row[3]), str(row[1])
    if row[5] is not None:
        return _entry("reply", at, comment_id=int(row[0]), reply_to=int(row[5]), text=said)
    if row[6] is not None:
        return _entry("reply", at, comment_id=int(row[0]), reply_to_request=str(row[6]), text=said)
    if not report:
        return _entry("comment", at, comment_id=int(row[0]), text=said)
    done = _json(report)
    text = str(done.get("done", "")) if isinstance(done, dict) else ""
    return _entry("report", at, comment_id=int(row[0]), text=text)


def _event_entry(conn: sqlite3.Connection, row: tuple, work_item_id: str) -> dict:
    action, detail, at = str(row[1]), str(row[2]), str(row[3])
    kind = KINDS[action]
    if action.startswith("request_"):
        return _request_entry(conn, kind, at, action, detail)
    if action == "checklist_replaced":
        return _entry(kind, at, text=f"{detail} steps")
    if action in ("comment_resolved", "comment_reopened"):
        # `<id>: <decision>` or `<id>`, as `service.resolve_comment` logs it.
        root, _colon, decision = detail.partition(": ")
        return _entry(kind, at, comment_id=int(root), text=decision)
    if action == "mentioned" and detail.startswith(_IN_DESCRIPTION):
        return _described(conn, at, detail.removeprefix(_IN_DESCRIPTION), work_item_id)
    if action == "mentioned":
        return _mentioned(conn, at, int(detail))
    if action == "opened":
        # The detail is a reason, if one was named, and never a state.
        return _entry(kind, at, text=f"{OPENED}: {detail}" if detail else OPENED)
    if action == "transitioned" and _deferred_container(conn, work_item_id, detail):
        return _entry(kind, at, text=f"{detail.rstrip('.')}. {DEFERRED_WORK}")
    return _entry(kind, at, text=detail)


def _deferred_container(conn: sqlite3.Connection, work_item_id: str, detail: str) -> bool:
    """Whether a move's detail took a goal or stage into a deferred state."""

    key = detail.split(": ", 1)[0]
    return conn.execute(_DEFERRED_CONTAINER, (work_item_id, key)).fetchone() is not None


_MENTIONING = (
    "SELECT m.body, m.report, s.key, w.number, m.awaits_reply,"
    " m.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) FROM work_item_comments m"
    " JOIN work_items w ON w.work_item_id = m.work_item_id"
    " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id WHERE m.id = ?"
)


def _mentioned(conn: sqlite3.Connection, at: str, comment_id: int) -> dict:
    """A comment on another item that named this one: where it stands now, and what it said.

    `from` is that item's reference, after a merge the survivor's; with the item
    deleted the comment went with it, and `from` is null with nothing to quote. A
    comment that waits for a reply says so, as `agents_since` says it.
    """

    row = conn.execute(_MENTIONING, (ASKS_FOR, comment_id)).fetchone()
    if row is None:
        return _entry("mentioned", at, comment_id=comment_id, text="", **{"from": None})
    said = str(row[0])
    if row[1]:
        done = _json(str(row[1]))
        said = str(done.get("done", "")) if isinstance(done, dict) else ""
    entry = _entry(
        "mentioned", at, comment_id=comment_id, text=said, **{"from": f"{row[2]}-{row[3]}"}
    )
    if row[4]:
        entry["awaits_reply"] = True
        if row[5]:
            entry["recent"] = True
    return entry


#: A mention's detail when the words are a description, as `read_model.IN_DESCRIPTION` says.
_IN_DESCRIPTION = "description:"
_DESCRIBED = (
    "SELECT d.description, s.key, d.number, n.key, w.number FROM work_items d"
    " JOIN planning_spaces s ON s.planning_space_id = d.planning_space_id,"
    " work_items w JOIN planning_spaces n ON n.planning_space_id = w.planning_space_id"
    " WHERE d.work_item_id = ? AND w.work_item_id = ?"
)


def _described(conn: sqlite3.Connection, at: str, source: str, named: str) -> dict:
    """Another item's description that named this one: that item, and the line naming it.

    With that item deleted its description went with it, and `from` is null with
    nothing to quote, as for a comment.
    """

    row = conn.execute(_DESCRIBED, (source, named)).fetchone()
    place = {"in": "description"}
    if row is None:
        return _entry("mentioned", at, text="", **place, **{"from": None})
    from .mentions import from_line_of

    said = from_line_of(str(row[0]), f"{row[3]}-{row[4]}")
    return _entry("mentioned", at, text=said, **place, **{"from": f"{row[1]}-{row[2]}"})


def _request_entry(
    conn: sqlite3.Connection, kind: str, at: str, action: str, request_id: str
) -> dict:
    """A question's event: what was asked, or what came back, and of whom it was asked.

    A request asked of a session says so, `addressee` naming it, since who hears what
    becomes of it is decided by that; its asking also names its fields, `asked`, each
    as `(id, type, option ids)`, so the session asked can answer without a read. A
    question to the owner carries neither.
    """

    row = conn.execute(
        "SELECT prompt, fields_json, answers_json, comment_id, addressee FROM work_item_requests"
        " WHERE request_id = ?",
        (request_id,),
    ).fetchone()
    if row is None:
        return _entry(kind, at, request_id=request_id, text="")
    entry = _entry(
        kind, at, request_id=request_id, text=_question_text(conn, action, request_id, row)
    )
    if row[4] is not None:
        entry["addressee"] = str(row[4])
        fields = _json(str(row[1])) if action == "request_created" else None
        if isinstance(fields, list):
            entry["asked"] = [
                (
                    str(field.get("id")),
                    str(field.get("type")),
                    [str(option.get("id")) for option in field.get("options") or []],
                )
                for field in fields
                if isinstance(field, dict)
            ]
    return entry


def _question_text(conn: sqlite3.Connection, action: str, request_id: str, row: tuple) -> str:
    """What came back when a person answered, and otherwise what was asked.

    An answer reads as it stands now, as an edit does: a change says what differs
    between the current answer and the version it replaced, row by row, whichever
    change of a window it is. Two whole answers of a review do not fit in one event.
    The answer of a session asked reads by field and option ids instead.
    `row` is the request's prompt, fields, answers, comment and addressee.
    """

    if action not in ("request_answered", "request_changed"):
        return str(row[0])
    fields = _json(str(row[1]))
    stored = _json(str(row[2]))
    if not isinstance(fields, list) or not isinstance(stored, dict):
        return ""
    from . import request_model

    if action == "request_answered" and row[4] is not None:
        # Only the session that asked hears this answer, and it reads it by its own ids.
        return request_model.session_answer_text(fields, stored)
    listed = row[3] is not None
    answer = request_model.answer_text(fields, stored, listed=listed)
    if action == "request_answered":
        return answer
    replaced = conn.execute(
        "SELECT answers_json FROM work_item_request_answers WHERE request_id = ?"
        " ORDER BY version DESC LIMIT 1",
        (request_id,),
    ).fetchone()
    was = _json(str(replaced[0])) if replaced is not None else None
    if not isinstance(was, dict):
        return answer
    return request_model.change_text(fields, was, stored, limit=MAX_TEXT, listed=listed)


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _json(text: str) -> object:
    """A stored value, or nothing: telling an agent is no place to refuse a stored row."""

    import json

    try:
        return json.loads(text)
    except ValueError:
        return None


def _entry(kind: str, at: str, *, text: str, **identity: object) -> dict:
    entry: dict = {"kind": kind, "via": "interface", "at": at, **identity}
    if text:
        entry["text"] = _cut(text, MAX_TEXT)
        if len(text) > MAX_TEXT:
            entry["cut"] = True
    return entry


def lists(conn: sqlite3.Connection, request_ids: set[str]) -> set[str]:
    """Which of these requests are lists on a comment, which nobody waits for.

    A list is asked and withdrawn as a question is, but the work never waits on it:
    it raises no alert and holds nothing open (`questions.open_rows`).
    """

    if not request_ids:
        return set()
    import json

    return {
        str(row[0])
        for row in conn.execute(
            "SELECT request_id FROM work_item_requests"
            " WHERE request_id IN (SELECT value FROM json_each(?)) AND comment_id IS NOT NULL",
            (json.dumps(sorted(request_ids)),),
        )
    }


def describe(events: list[dict]) -> str:
    """The newest events as one sentence, for a refusal to name."""

    shown = events[-MOST_SHOWN:]
    told = "; ".join(
        f"{event['kind']} at {event['at']}" + (f": {event['text']}" if "text" in event else "")
        for event in shown
    )
    left = len(events) - len(shown)
    return f"{told}; and {left} earlier" if left else told
