"""The items a text about work names in `mentions`, and the record each of them keeps of it.

A number in a text is a link and tells nobody: texts name other items all the
time (`mentions` finds those numbers, for links). To tell the work on another
item, the write names that item in `mentions` instead. A comment, a reply, a
report, a summary and a description take it. The text stays where it is
written; the item it names gets one `mentioned` event under the call that wrote
the text, whose detail says where the words are: a comment's id (a summary is a
report, so a comment too), or `description:` and the id of the item whose
description it is. That call belongs to the item written on, so the record
moves no window on the item it names, as the far end of a link does not.

A summary and a description are written again and again, so their write tells
only the items the text it replaces did not name: saving the same words twice
wakes nobody twice.

Who hears it is decided where every other event is told, from the call row: a
person's mention is a person's act on the item named (`person_events`), another
agent's reaches the holders through the hook alone (`hooks.notify`), and the
answer here only says who will hear it.

Agents telling one another could keep each other talking, so an agent's call
names fewer items than the interface, and one session names one item only a few
times an hour; the hook adds that such a mention wakes nobody unless its comment
waits for a reply (`awaits_reply`), and then only the holders of the item named,
once and within a day.
"""

from __future__ import annotations

import sqlite3

from . import calls, mentions, model, read_model

#: The most items one comment names: a person may tell every item at work at once.
MAX_MENTIONS = 20
#: The most an agent's comment names: every other call than the interface's.
MAX_AGENT_MENTIONS = 5
#: How often one session may name one item within the hour.
MAX_PER_HOUR = 3
NO_HOLDER = "nobody yet: no holder, it stays on the item"
CLOSED = "nobody: closed"
UNPROVED = "nobody: this call proved no session"

#: The mentions of an item one session's confirmed calls wrote within the last hour.
_THIS_HOUR = (
    "SELECT COUNT(*) FROM work_item_events e JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.action = 'mentioned' AND c.session_id = ?"
    " AND c.identity_state = ? AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')"
)


def description_of(work_item_id: str) -> str:
    """The detail of a mention made in this item's description."""

    return read_model.IN_DESCRIPTION + work_item_id


def summary_text(stored: object) -> str:
    """Every field of a stored summary, as the text a new one replaces; none is empty text."""

    found = model.summary(stored, required=False)
    return "\n\n".join(str(value) for value in found.values()) if found else ""


def targets(
    conn: sqlite3.Connection, source: sqlite3.Row, value: object, *, before: str | None = None
) -> list[sqlite3.Row]:
    """The items a text on `source` tells, each refused before anything is written.

    `before` is the text a summary or a description replaces: an item it already
    named is checked like any other and then left out, as told already, so it
    counts toward no hour either.
    """

    if value is None:
        return []
    if not isinstance(value, list):
        raise model.PlanningError("mentions must be a list of work items")
    identity = calls.current()
    person = identity is not None and identity.source == calls.BROWSER
    most = MAX_MENTIONS if person else MAX_AGENT_MENTIONS
    if len(value) > most:
        raise model.PlanningError(f"mentions holds at most {most} items")
    # Only a session that was proved is counted: one that was not tells nobody anyway.
    session = (
        identity.session_id
        if identity is not None and identity.state == calls.CONFIRMED and not person
        else None
    )
    told_before = (
        set()
        if before is None
        else {found.reference for found in mentions.scan(before, mentions.ScanState(), final=True)}
    )
    found: list[sqlite3.Row] = []
    seen: set[str] = set()
    for entry in value:
        row = read_model.item_row(conn, entry)
        named = str(row["work_item_id"])
        reference = read_model.reference(conn, row)
        if named == str(source["work_item_id"]):
            raise model.PlanningError("an item does not mention itself")
        if named in seen:
            raise model.PlanningError(f"mentions names {reference} twice")
        seen.add(named)
        if reference in told_before:
            continue
        if session is not None and _this_hour(conn, named, session) >= MAX_PER_HOUR:
            raise model.MentionLimitError(
                f"{reference} was mentioned {MAX_PER_HOUR} times in the"
                " last hour by this session; write once there, or wait"
            )
        found.append(row)
    return found


def _this_hour(conn: sqlite3.Connection, work_item_id: str, session_id: str) -> int:
    return int(conn.execute(_THIS_HOUR, (work_item_id, session_id, calls.CONFIRMED)).fetchone()[0])


def record(
    conn: sqlite3.Connection, where: str, named: list[sqlite3.Row], author: str | None
) -> list[dict]:
    """One `mentioned` event on each item named, and who will hear it, in the order named.

    `where` is the event's detail: a comment's id, or `description_of` an item.
    """

    told = []
    for row in named:
        identity = str(row["work_item_id"])
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id)"
            " VALUES(?,?,?,?,?)",
            (
                identity,
                model.event_action("mentioned"),
                where,
                model.actor(author),
                calls.call_id(conn, identity),
            ),
        )
        told.append(_heard(conn, read_model.item_by_id(conn, identity)))
    return told


def _heard(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    """Who holds an item now, and why nobody hears it when nobody will."""

    steps = model.checklist(row["checklist"])
    holders = list(
        dict.fromkeys(
            holder
            for holder in (
                str(row["claim_ref"] or ""),
                *(str(step["claimed_by"] or "") for step in steps if not step["done"]),
            )
            if holder
        )
    )
    answer: dict = {"reference": read_model.reference(conn, row), "holders": holders}
    reason = _nobody(conn, row, holders)
    if reason:
        answer["told"] = reason
    return answer


def _nobody(conn: sqlite3.Connection, row: sqlite3.Row, holders: list[str]) -> str | None:
    """Why nobody hears this item, or None when its holders will.

    Who speaks must be proved: the interface, or a confirmed call that names its
    session. Anything else leaves the record and tells nobody.
    """

    identity = calls.current()
    if (
        identity is None
        or identity.state != calls.CONFIRMED
        or (identity.source != calls.BROWSER and not identity.session_id)
    ):
        return UNPROVED
    if read_model.state_by_id(conn, str(row["state_id"]))["is_terminal"]:
        return CLOSED
    return None if holders else NO_HOLDER
