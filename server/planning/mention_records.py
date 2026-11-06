"""The items a comment names in `mentions`, and the record each of them keeps of it.

A number in a comment's text is a link and tells nobody: comments name other
items all the time (`mentions` finds those numbers, for links). To tell the work
on another item, a comment names that item in `mentions` instead. The comment
stays where it is written; the item it names gets one `mentioned` event, whose
detail is the comment's id, under the call that wrote the comment. That call
belongs to the comment's item, so the record moves no window on the item it
names, as the far end of a link does not.

Who hears it is decided where every other event is told, from the call row: a
person's mention is a person's act on the item named (`person_events`), and the
answer here only says who will hear it.
"""

from __future__ import annotations

import sqlite3

from . import calls, model, read_model

#: The most items one comment names: a person may tell every item at work at once.
MAX_MENTIONS = 20
NO_HOLDER = "nobody yet: no holder, it stays on the item"
CLOSED = "nobody: closed"
UNPROVED = "nobody: this call proved no session"


def targets(conn: sqlite3.Connection, source: sqlite3.Row, value: object) -> list[sqlite3.Row]:
    """The items a comment on `source` names, each refused before anything is written."""

    if value is None:
        return []
    if not isinstance(value, list):
        raise model.PlanningError("mentions must be a list of work items")
    if len(value) > MAX_MENTIONS:
        raise model.PlanningError(f"mentions holds at most {MAX_MENTIONS} items")
    found: list[sqlite3.Row] = []
    seen: set[str] = set()
    for entry in value:
        row = read_model.item_row(conn, entry)
        identity = str(row["work_item_id"])
        if identity == str(source["work_item_id"]):
            raise model.PlanningError("an item does not mention itself")
        if identity in seen:
            raise model.PlanningError(f"mentions names {read_model.reference(conn, row)} twice")
        seen.add(identity)
        found.append(row)
    return found


def record(
    conn: sqlite3.Connection, comment_id: int, named: list[sqlite3.Row], author: str | None
) -> list[dict]:
    """One `mentioned` event on each item named, and who will hear it, in the order named."""

    told = []
    for row in named:
        identity = str(row["work_item_id"])
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id)"
            " VALUES(?,?,?,?,?)",
            (
                identity,
                model.event_action("mentioned"),
                str(comment_id),
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
