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

Nothing here imports past `request_model` and `model`: a client hook is meant to
call this on a read-only connection of its own, in a process that starts for one
event. The rows are read by position for the same reason, since such a connection
sets no factory.
"""

from __future__ import annotations

import json
import sqlite3

from . import request_model

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
_PERSON_COMMENTS = (
    "SELECT m.id, m.body, m.report, m.created_at, m.call_id"
    " FROM work_item_comments m JOIN execution_events c ON c.id = m.call_id"
    " WHERE m.work_item_id = ? AND m.call_id > ? AND c.identity_source = ?"
    " AND c.tool LIKE '/api/planning/%' ORDER BY m.id"
)
_PERSON_EVENTS = (
    "SELECT e.id, e.action, e.detail, e.created_at, e.call_id"
    " FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.call_id > ? AND c.identity_source = ?"
    " AND c.tool LIKE '/api/planning/%' ORDER BY e.id"
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
    return [entry for _order, entry in sorted(found, key=lambda pair: pair[0])]


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
    if not report:
        return _entry("comment", str(row[3]), comment_id=int(row[0]), text=str(row[1]))
    done = _json(report)
    text = str(done.get("done", "")) if isinstance(done, dict) else ""
    return _entry("report", str(row[3]), comment_id=int(row[0]), text=text)


def _event_entry(conn: sqlite3.Connection, row: tuple) -> dict:
    action, detail, at = str(row[1]), str(row[2]), str(row[3])
    kind = KINDS[action]
    if action.startswith("request_"):
        return _entry(kind, at, request_id=detail, text=_question_text(conn, action, detail))
    if action == "checklist_replaced":
        return _entry(kind, at, text=f"{detail} steps")
    return _entry(kind, at, text=detail)


def _question_text(conn: sqlite3.Connection, action: str, request_id: str) -> str:
    """What came back when a person answered, and otherwise what was asked."""

    row = conn.execute(
        "SELECT prompt, fields_json, answers_json FROM work_item_requests WHERE request_id = ?",
        (request_id,),
    ).fetchone()
    if row is None:
        return ""
    if action != "request_answered":
        return str(row[0])
    fields = _json(str(row[1]))
    stored = _json(str(row[2]))
    if not isinstance(fields, list) or not isinstance(stored, dict):
        return ""
    return request_model.answer_text(fields, stored)


def _json(text: str) -> object:
    """A stored value, or nothing: telling an agent is no place to refuse a stored row."""

    try:
        return json.loads(text)
    except ValueError:
        return None


def _entry(kind: str, at: str, *, text: str, **identity: object) -> dict:
    entry: dict = {"kind": kind, "via": "interface", "at": at, **identity}
    if text:
        entry["text"] = text if len(text) <= MAX_TEXT else text[: MAX_TEXT - 1] + "…"
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
