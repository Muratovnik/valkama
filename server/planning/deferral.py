"""Putting work off: the condition it comes back on, and who waits on what.

An item is put off until a day, a time, or another item's close (`defer`), and it
stands in a deferred state for exactly as long as a row of `work_item_deferrals`
holds that condition. The row is the condition; the state is where the item stands.
Nothing here changes a state: the service moves the item and calls this module for
the row in the same write.

- **Until.** `moment` reads a day (`YYYY-MM-DD`, coming back at 00:00 UTC) or a time
  with its zone, and refuses one that has passed; anything else names an item, which
  the service resolves and `check_item` holds to being open, another item, and not
  one the put-off item stands under: a goal or stage closes only once nothing under
  it is open, so a condition on it would never come.
- **The row.** `put` sets it, `clear` takes it away with the move out of the deferred
  state, `held` and `restore` keep it across a failed launch's put-back, and `repoint`
  sends the waiting of a merged item to the item it merged into.
- **Coming back.** `waiting` names who waits on items that close or go, and `due`
  what the clock or a close the service did not see has brought; `reach` marks a
  condition that came for an item the owner is asked about instead (`asked` finds
  that question).
- **Reading.** `record` is the item's `deferred` field, `card` its short form on the
  card, and `returned` the field of an item that came back to triage.

A read writes nothing: a condition whose day has come still stands until the sweep's
`returns` step, the take-next path or a write brings the item back.

This module sits below the read model and the service, as `closing` does: it imports
neither (`pyproject.toml` holds the direction), and nothing else reads the row.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from . import item_tree, leases, model, questions

#: The tag of a refusal of putting work off.
TAG = "deferral"
#: The purpose of the question the owner is asked when the condition of work put off
#: under goals and stages all accepted has come.
RETURN = "return"
#: The tool Valkama's own call that brings put-off work back is recorded under.
RETURN_TOOL = "deferral-return"
#: Who that call names as its author: Valkama, as the lease expiry does.
AUTHOR = leases.EXPIRY_AUTHOR
#: Why work came back, as the `returned` event and field say it.
DATE = "date"
DELETED = "deleted"

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T")

_COLUMNS = "until_at, until_item_id, reason, call_id, since, reached_at"
_PUT = (
    f"INSERT INTO work_item_deferrals(work_item_id, {_COLUMNS}) VALUES(?,?,?,?,?,?,?)"
    " ON CONFLICT(work_item_id) DO UPDATE SET until_at = excluded.until_at,"
    " until_item_id = excluded.until_item_id, reason = excluded.reason,"
    " call_id = excluded.call_id, since = excluded.since, reached_at = excluded.reached_at"
)
#: An item's condition with what its field shows: the item it waits on by reference,
#: and who set it, by the author of that call's first event on the item and its session.
_RECORD = (
    "SELECT d.until_at, d.reason, d.since, d.reached_at, p.key, w.number,"
    " (SELECT e.author FROM work_item_events e WHERE e.work_item_id = d.work_item_id"
    "  AND e.call_id = d.call_id ORDER BY e.id LIMIT 1), c.session_id"
    " FROM work_item_deferrals d"
    " LEFT JOIN work_items w ON w.work_item_id = d.until_item_id"
    " LEFT JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " LEFT JOIN execution_events c ON c.id = d.call_id WHERE d.work_item_id = ?"
)
#: The newest `returned` of an item, and whether the newest move was its call's.
_RETURNED = (
    "SELECT r.detail, r.created_at, r.call_id = (SELECT t.call_id FROM work_item_events t"
    " WHERE t.work_item_id = r.work_item_id AND t.action = 'transitioned'"
    " ORDER BY t.id DESC LIMIT 1)"
    " FROM work_item_events r WHERE r.work_item_id = ? AND r.action = 'returned'"
    " ORDER BY r.id DESC LIMIT 1"
)
#: The items waiting on any of the items named, as one JSON array, by space and number.
_WAITING = (
    "SELECT d.work_item_id, d.until_item_id FROM work_item_deferrals d"
    " JOIN work_items i ON i.work_item_id = d.work_item_id"
    " WHERE d.until_item_id IN (SELECT value FROM json_each(?))"
    " ORDER BY i.planning_space_id, i.number"
)
#: The same, with what a cancel list shows of each and of the item it waits on.
_DEPENDENTS = (
    "SELECT i.work_item_id, i.title, i.kind, i.parent_id, p.key, i.number, wp.key, w.number"
    " FROM work_item_deferrals d JOIN work_items i ON i.work_item_id = d.work_item_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " JOIN work_items w ON w.work_item_id = d.until_item_id"
    " JOIN planning_spaces wp ON wp.planning_space_id = w.planning_space_id"
    " WHERE d.until_item_id IN (SELECT value FROM json_each(?))"
)
#: The conditions that came and were not yet acted on: a moment that passed, or an item
#: that closed by a path that did not bring its waiting back.
_DUE = (
    "SELECT d.work_item_id, d.until_at, d.until_item_id, s.category"
    " FROM work_item_deferrals d JOIN work_items i ON i.work_item_id = d.work_item_id"
    " LEFT JOIN work_items w ON w.work_item_id = d.until_item_id"
    " LEFT JOIN workflow_states s ON s.state_id = w.state_id"
    " WHERE d.reached_at IS NULL AND (d.until_at <= ? OR s.is_terminal = 1)"
    " AND (? IS NULL OR i.planning_space_id = ?)"
    " ORDER BY i.planning_space_id, i.number LIMIT ?"
)


@dataclass(frozen=True)
class Held:
    """A condition as its row holds it, kept across a write that takes it away and back."""

    until_at: str | None
    until_item_id: str | None
    reason: str
    call_id: int | None
    since: str


@dataclass(frozen=True)
class Due:
    """A condition that came: the item put off, why it comes back, and the item it waited on."""

    work_item_id: str
    because: str
    until_item_id: str | None
    until_at: str | None


def stamp(moment: datetime) -> str:
    """A moment as the store writes it: ISO 8601, UTC, to the second."""

    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def moment(until: str, now: datetime) -> str | None:
    """The moment `until` names, as stored, or None when it names no day or time.

    A day comes back at 00:00 UTC; a time names its zone. A moment that is not after
    `now` is refused: the work would be put off until something that has happened.
    """

    day = _DAY.match(until)
    if day is not None:
        try:
            found = datetime(int(day[1]), int(day[2]), int(day[3]), tzinfo=UTC)
        except ValueError as error:
            raise model.PlanningError(f"[{TAG}] {until} is no day of the calendar") from error
    elif _TIME.match(until):
        try:
            found = datetime.fromisoformat(until)
        except ValueError as error:
            raise model.PlanningError(
                f"[{TAG}] {until} is no time: send a day YYYY-MM-DD, or a time with its zone"
                " such as 2026-12-01T09:00:00Z"
            ) from error
        if found.tzinfo is None:
            raise model.PlanningError(
                f"[{TAG}] {until} names no zone: a time is read in its zone, such as"
                " 2026-12-01T09:00:00Z"
            )
    else:
        return None
    if found <= now:
        raise model.PlanningError(
            f"[{TAG}] {until} has come already: put work off until a day or time to come"
        )
    return stamp(found)


def said(until_at: str) -> str:
    """A stored moment as a person reads it: the day alone when it is the day's start."""

    return until_at[:10] if until_at.endswith("T00:00:00Z") else until_at


def check_item(conn: sqlite3.Connection, item: sqlite3.Row, until: sqlite3.Row) -> None:
    """Refuse an item `item` cannot wait on: itself, one it stands under, or a closed one."""

    named = reference(conn, str(item["work_item_id"]))
    waited = reference(conn, str(until["work_item_id"]))
    if str(until["work_item_id"]) == str(item["work_item_id"]):
        raise model.PlanningError(f"[{TAG}] {named} cannot wait on itself")
    if _closed(conn, str(until["state_id"])):
        raise model.PlanningError(
            f"[{TAG}] {waited} is closed already: name an open item, or a day"
        )
    over = item_tree.above(conn, str(item["parent_id"])) if item["parent_id"] else []
    if any(identity == str(until["work_item_id"]) for identity, _kind, _category in over):
        raise model.PlanningError(
            f"[{TAG}] {named} stands under {waited}, which closes only once nothing under"
            " it is open: put it off until another item, or a day"
        )


def put(
    conn: sqlite3.Connection,
    work_item_id: str,
    *,
    until_at: str | None,
    until_item_id: str | None,
    reason: str,
    call_id: int | None,
    since: str,
) -> None:
    """Set the item's condition, replacing one it had: not yet come."""

    conn.execute(_PUT, (work_item_id, until_at, until_item_id, reason, call_id, since, None))


def held(conn: sqlite3.Connection, work_item_id: str) -> Held | None:
    """The item's condition as its row holds it, or None; a store with no table has none."""

    try:
        found = conn.execute(
            f"SELECT {_COLUMNS} FROM work_item_deferrals WHERE work_item_id = ?",  # noqa: S608 - constant columns
            (work_item_id,),
        ).fetchone()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return None
    if found is None:
        return None
    call = None if found[3] is None else int(found[3])
    return Held(found[0], found[1], str(found[2]), call, str(found[4]))


def restore(conn: sqlite3.Connection, work_item_id: str, kept: Held) -> None:
    """Set a condition back as it was, under the call that set it, not yet come.

    A condition that had come is set back as one that has not: the question its coming
    asked ended with the write that took it away, and the next pass asks again.
    """

    put(
        conn,
        work_item_id,
        until_at=kept.until_at,
        until_item_id=kept.until_item_id,
        reason=kept.reason,
        call_id=kept.call_id,
        since=kept.since,
    )


def clear(conn: sqlite3.Connection, work_item_id: str) -> None:
    """Take the item's condition away: it left the deferred state."""

    conn.execute("DELETE FROM work_item_deferrals WHERE work_item_id = ?", (work_item_id,))


def repoint(conn: sqlite3.Connection, merged: str, survivor: str, involved: set[str]) -> int:
    """Make what waits on `merged` wait on `survivor`, which now holds its work.

    An item of the merge itself is left as it is: it would wait on itself, and the
    merged item's close brings it back instead. Answers how many conditions moved.
    """

    moved = 0
    for identity, _until in conn.execute(_WAITING, (json.dumps([merged]),)).fetchall():
        if str(identity) in involved:
            continue
        conn.execute(
            "UPDATE work_item_deferrals SET until_item_id = ? WHERE work_item_id = ?",
            (survivor, str(identity)),
        )
        moved += 1
    return moved


def waiting(conn: sqlite3.Connection, items: Iterable[str]) -> list[tuple[str, str]]:
    """Each item waiting on one of `items`, with the item it waits on, by space and number."""

    named = json.dumps(sorted(set(items)))
    return [(str(row[0]), str(row[1])) for row in conn.execute(_WAITING, (named,))]


def dependents(conn: sqlite3.Connection, items: Iterable[str]) -> list[tuple]:
    """The items waiting on one of `items`, as a cancel list names them: id, title, kind,
    parent, space key and number, and the key and number of the item each waits on."""

    named = json.dumps(sorted(set(items)))
    try:
        return [tuple(row) for row in conn.execute(_DEPENDENTS, (named,))]
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return []


def due(conn: sqlite3.Connection, at: str, limit: int, *, space_id: str | None = None) -> list[Due]:
    """The conditions that came by `at` and were not acted on, at most `limit`, in order,
    of one space's items when `space_id` names it.

    A moment that passed comes back by `date`; an item that closed by a path that did
    not bring its waiting back -- none does, but a store may hold one -- by the way it
    closed.
    """

    try:
        rows = conn.execute(_DUE, (at, space_id, space_id, limit)).fetchall()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return []
    found = []
    for identity, until_at, until_item, category in rows:
        because = DATE if until_at is not None else str(category)
        found.append(Due(str(identity), because, until_item, until_at))
    return found


def reach(conn: sqlite3.Connection, work_item_id: str, at: str, *, gone: bool = False) -> None:
    """The condition came, and the owner is asked instead of the item coming back.

    `gone` says the item it waited on is being deleted: the row then keeps the moment
    it came in place of that item, which it can no longer name.
    """

    if gone:
        conn.execute(
            "UPDATE work_item_deferrals SET reached_at = ?, until_at = ?, until_item_id = NULL"
            " WHERE work_item_id = ?",
            (at, at, work_item_id),
        )
        return
    conn.execute(
        "UPDATE work_item_deferrals SET reached_at = ? WHERE work_item_id = ?", (at, work_item_id)
    )


def asked(conn: sqlite3.Connection, work_item_id: str) -> str | None:
    """The id of the open question whether to take the item up again, or None."""

    for row in questions.open_rows(conn, work_item_id):
        if row["purpose"] == RETURN:
            return str(row["request_id"])
    return None


def record(conn: sqlite3.Connection, work_item_id: str) -> dict | None:
    """The item's `deferred` field: the condition, why and since when, who set it, and
    when it came; None for an item with none.

    `until` is the moment, `until_item` the item's reference, one of them null; `by`
    the author and the session of the call that set it, as the history names them.
    """

    try:
        found = conn.execute(_RECORD, (work_item_id,)).fetchone()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return None
    if found is None:
        return None
    until_at, reason, since, reached_at, key, number, author, session = found
    return {
        "until": until_at,
        "until_item": None if key is None else model.human_id(str(key), int(number)),
        "reason": reason,
        "since": since,
        "by": {"author": author, "session_id": session},
        "reached_at": reached_at,
    }


#: The fields of `deferred` the card carries: when or on what it comes back, and
#: whether that came. Why, and who put it off, are read with the events part.
CARD_DEFERRED = ("until", "until_item", "reached_at")


def card(found: dict) -> dict:
    """The `deferred` field as the card carries it."""

    return {name: found[name] for name in CARD_DEFERRED}


def returned(conn: sqlite3.Connection, work_item_id: str) -> dict | None:
    """The `returned` field of an item that came back: why, the item, and when.

    It stands while the item's newest move is the one its return made, in the same
    call as its newest `returned`; the caller asks it only of an item in triage.
    """

    found = conn.execute(_RETURNED, (work_item_id,)).fetchone()
    if found is None or not found[2]:
        return None
    because, _space, rest = str(found[0]).partition(" ")
    return {
        "because": because,
        "item": None if because == DATE else rest,
        "at": found[1],
    }


def because_text(because: str, until_at: str | None, item: str | None) -> str:
    """Why work came back as its `returned` event says it: `date 2026-12-01`, `completed
    MAIN-12`."""

    if because == DATE:
        return f"{DATE} {said(str(until_at))}"
    return f"{because} {item}"


def reference(conn: sqlite3.Connection, identity: str) -> str:
    """An item's reference by its id, for the words of a condition."""

    found = conn.execute(
        "SELECT p.key, i.number FROM work_items i JOIN planning_spaces p"
        " ON p.planning_space_id = i.planning_space_id WHERE i.work_item_id = ?",
        (identity,),
    ).fetchone()
    return model.human_id(str(found[0]), int(found[1]))


def _closed(conn: sqlite3.Connection, state_id: str) -> bool:
    found = conn.execute(
        "SELECT is_terminal FROM workflow_states WHERE state_id = ?", (state_id,)
    ).fetchone()
    return found is not None and bool(found[0])
