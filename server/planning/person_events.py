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
it edited (`calls.call_id`), which is also what keeps a card dragged within its
column, an edit of nothing but `rank`, from reading as somebody speaking.

A client hook keeps its own place instead (`since_call`): it tells the agents of
one session, and an item's window ends at any agent's write, so a subagent's tick
would end it before the session's orchestrator was told. The hook remembers the
last call it has read for each item and asks for what came after that. The same
hook reads another agent's mentions of an item apart (`agent_mentions_since`):
they are told to the holders, and never as a person's.

Nothing here is imported at module level past `sqlite3`: a client hook calls this
on a read-only connection of its own, in a process that starts for one tool call,
where every module loaded is paid on every call. `json` and `request_model` are
needed only for a report or an answer, so they are loaded there. The rows are
read by position for the same reason, since such a connection sets no factory.
"""

from __future__ import annotations

import sqlite3

#: What `execution_events.identity_source` says about a call; `calls` publishes these.
BROWSER = "browser"
VALKAMA = "valkama"
#: What `execution_events.kind` says about a Planning write call.
KIND = "planning_write"

#: How much of what a person wrote one event quotes, the ellipsis counted.
MAX_TEXT = 300
#: How many events one answer names, the newest ones.
MOST_SHOWN = 20

#: Every action a person's write can be told as, by the kind it is told under.
KINDS = {
    "transitioned": "status",
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
}
#: The actions never told. `created`: an item a person filed says what it says, in
#: the description an agent reads when it takes it. `execution_attached`: a launch
#: or an observed session, which the agent in question already knows. `overridden`:
#: a note on the transition or merge beside it, which is told.
NOT_TOLD = frozenset({"created", "execution_attached", "overridden"})

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
    " AND c.identity_source NOT IN (?,?) AND c.id <> ?"
)
_LAST_AGENT_COMMENT = (
    "SELECT MAX(c.id) FROM work_item_comments m JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.work_item_id = ? AND c.work_item_id = ?"
    " AND c.identity_source NOT IN (?,?) AND c.id <> ?"
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


#: Another agent's mentions of an item: the speaker is the call's proved session and
#: agent, never the `author` it signed, and an unproved call names nobody.
_AGENT_MENTIONS = (
    "SELECT e.call_id, e.detail, e.created_at, c.session_id, c.agent_id"
    " FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.call_id > ? AND e.action = 'mentioned'"
    " AND c.identity_state = 'confirmed' AND c.identity_source NOT IN (?,?)"
    " AND c.session_id IS NOT NULL ORDER BY e.id"
)


def agent_mentions_since(
    conn: sqlite3.Connection, work_item_id: str, after: int
) -> list[tuple[int, dict]]:
    """Agents' mentions of one item whose call came after `after`, oldest first, with the call.

    Not a person's act, so `_window` never reads them and they are in neither
    `from_person` nor the `person_spoke` guard: a client hook tells them apart.
    Each entry is a `mentioned` one with `via: "agent"`, and `session` and `agent`,
    the speaker as its call row names it, so a hook can leave the speaker out.
    """

    found = []
    for row in conn.execute(_AGENT_MENTIONS, (work_item_id, after, BROWSER, VALKAMA)).fetchall():
        entry = _mentioned(conn, str(row[2]), int(row[1]))
        entry["via"] = "agent"
        entry["session"] = str(row[3])
        entry["agent"] = None if row[4] is None else str(row[4])
        found.append((int(row[0]), entry))
    return found


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
        found.append(((int(row[4]), 2, int(row[0])), _event_entry(conn, row)))
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
    bound = (work_item_id, work_item_id, BROWSER, VALKAMA, excluded)
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
        elif source != VALKAMA:
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


def _event_entry(conn: sqlite3.Connection, row: tuple) -> dict:
    action, detail, at = str(row[1]), str(row[2]), str(row[3])
    kind = KINDS[action]
    if action.startswith("request_"):
        return _entry(kind, at, request_id=detail, text=_question_text(conn, action, detail))
    if action == "checklist_replaced":
        return _entry(kind, at, text=f"{detail} steps")
    if action in ("comment_resolved", "comment_reopened"):
        # `<id>: <decision>` or `<id>`, as `service.resolve_comment` logs it.
        root, _colon, decision = detail.partition(": ")
        return _entry(kind, at, comment_id=int(root), text=decision)
    if action == "mentioned":
        return _mentioned(conn, at, int(detail))
    return _entry(kind, at, text=detail)


_MENTIONING = (
    "SELECT m.body, m.report, s.key, w.number FROM work_item_comments m"
    " JOIN work_items w ON w.work_item_id = m.work_item_id"
    " JOIN planning_spaces s ON s.planning_space_id = w.planning_space_id WHERE m.id = ?"
)


def _mentioned(conn: sqlite3.Connection, at: str, comment_id: int) -> dict:
    """A comment on another item that named this one: where it stands now, and what it said.

    `from` is that item's reference, after a merge the survivor's; with the item
    deleted the comment went with it, and `from` is null with nothing to quote.
    """

    row = conn.execute(_MENTIONING, (comment_id,)).fetchone()
    if row is None:
        return _entry("mentioned", at, comment_id=comment_id, text="", **{"from": None})
    said = str(row[0])
    if row[1]:
        done = _json(str(row[1]))
        said = str(done.get("done", "")) if isinstance(done, dict) else ""
    return _entry(
        "mentioned", at, comment_id=comment_id, text=said, **{"from": f"{row[2]}-{row[3]}"}
    )


def _question_text(conn: sqlite3.Connection, action: str, request_id: str) -> str:
    """What came back when a person answered, and otherwise what was asked.

    An answer reads as it stands now, as an edit does: a change says what differs
    between the current answer and the version it replaced, row by row, whichever
    change of a window it is. Two whole answers of a review do not fit in one event.
    """

    row = conn.execute(
        "SELECT prompt, fields_json, answers_json FROM work_item_requests WHERE request_id = ?",
        (request_id,),
    ).fetchone()
    if row is None:
        return ""
    if action not in ("request_answered", "request_changed"):
        return str(row[0])
    fields = _json(str(row[1]))
    stored = _json(str(row[2]))
    if not isinstance(fields, list) or not isinstance(stored, dict):
        return ""
    from . import request_model

    answer = request_model.answer_text(fields, stored)
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
    return request_model.change_text(fields, was, stored, limit=MAX_TEXT)


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
    return entry


def describe(events: list[dict]) -> str:
    """The newest events as one sentence, for a refusal to name."""

    shown = events[-MOST_SHOWN:]
    told = "; ".join(
        f"{event['kind']} at {event['at']}" + (f": {event['text']}" if "text" in event else "")
        for event in shown
    )
    left = len(events) - len(shown)
    return f"{told}; and {left} earlier" if left else told
