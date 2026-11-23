"""Putting work off: the condition it comes back on, and who waits on what.

An item is put off until a day, a time, a count of new comments, a count or a day or
time whichever comes first, or another item's close (`defer`), and it stands in a
deferred state for exactly as long as a row of `work_item_deferrals` holds that
condition. The row is the condition; the state is where the item stands.
Nothing here changes a state: the service moves the item and calls this module for
the row in the same write.

- **Until.** `moment` reads a day (`YYYY-MM-DD`, coming back at 00:00 UTC) or a time
  with its zone, and refuses one that has passed. `until` reads those, a count of new
  comments (`3 comments`) and a count with a moment joined by `or`, in either order
  (`2026-12-01 or 3 comments`); anything else names an item, which the service
  resolves and `check_item` holds to being open, another item, and not one the
  put-off item stands under: a goal or stage closes only once nothing under it is
  open, so a condition on it would never come.
- **The count.** Every comment and reply written on the item after the condition was
  set counts, a person's or an agent's: `put` keeps the newest comment's id then, and
  the count reads the item's comments after it. A comment goes only with its item, so
  the count never falls. The write of a comment asks `due` about its item as it ends,
  after any move of the same write, and the sweep's `returns` step reads every count
  again, so no comment is missed; the condition comes once, as every other does.
- **The row.** `put` sets it, `clear` takes it away with the move out of the deferred
  state, `held` and `restore` keep it across a failed launch's put-back, and `repoint`
  sends the waiting of a merged item to the item it merged into.
- **Coming back.** `waiting` names who waits on items that close or go, and `due`
  what the clock or a close the service did not see has brought; `reach` marks a
  condition that came for an item the owner is asked about instead
  (`questions.acceptance_asked` finds that question).
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

from . import item_tree, leases, model

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
COMMENTS = "comments"
DELETED = "deleted"
#: The most new comments a condition counts to; the store's CHECK holds the same.
COMMENTS_MOST = 999

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T")
_COUNT = re.compile(r"^(\d{1,4}) comments?$")
#: What joins a count and a moment, whichever comes first.
_EITHER = " or "

_COLUMNS = (
    "until_at, until_item_id, until_comments, comments_after, reason, call_id, since, reached_at"
)
_PUT = (
    f"INSERT INTO work_item_deferrals(work_item_id, {_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?)"
    " ON CONFLICT(work_item_id) DO UPDATE SET until_at = excluded.until_at,"
    " until_item_id = excluded.until_item_id, until_comments = excluded.until_comments,"
    " comments_after = excluded.comments_after, reason = excluded.reason,"
    " call_id = excluded.call_id, since = excluded.since, reached_at = excluded.reached_at"
)
#: An item's condition with what its field shows: the item it waits on by reference,
#: and who set it, by the author of that call's first event on the item and its session.
_RECORD = (
    "SELECT d.until_at, d.until_comments, d.reason, d.since, d.reached_at, p.key, w.number,"
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
#: The conditions that came and were not yet acted on: a moment that passed, a count of
#: comments reached, or an item that closed by a path that did not bring its waiting back.
_DUE = (
    "SELECT work_item_id, until_at, until_item_id, until_comments, category FROM ("
    " SELECT d.work_item_id, d.until_at, d.until_item_id, d.until_comments, d.reached_at,"
    " s.category, s.is_terminal, i.planning_space_id, i.number,"
    " (SELECT COUNT(*) FROM work_item_comments c WHERE c.work_item_id = d.work_item_id"
    "  AND c.id > d.comments_after) AS counted"
    " FROM work_item_deferrals d JOIN work_items i ON i.work_item_id = d.work_item_id"
    " LEFT JOIN work_items w ON w.work_item_id = d.until_item_id"
    " LEFT JOIN workflow_states s ON s.state_id = w.state_id)"
    " WHERE reached_at IS NULL"
    " AND (until_at <= ? OR is_terminal = 1 OR counted >= until_comments)"
    " AND (? IS NULL OR planning_space_id = ?) AND (? IS NULL OR work_item_id = ?)"
    " ORDER BY planning_space_id, number LIMIT ?"
)


@dataclass(frozen=True)
class Held:
    """A condition as its row holds it, kept across a write that takes it away and back."""

    until_at: str | None
    until_item_id: str | None
    until_comments: int | None
    comments_after: int | None
    reason: str
    call_id: int | None
    since: str


@dataclass(frozen=True)
class Due:
    """A condition that came: the item put off, why it comes back, and the item it waited
    on, the moment or the count of comments."""

    work_item_id: str
    because: str
    until_item_id: str | None
    until_at: str | None
    until_comments: int | None = None


@dataclass(frozen=True)
class Until:
    """A condition `until` names that is no item: the moment, the count of new comments,
    or both, whichever comes first."""

    until_at: str | None
    comments: int | None

    def said(self) -> str:
        """How a person reads it: `2026-12-01`, `3 comments`, `2026-12-01 or 3 comments`."""

        parts = [] if self.until_at is None else [said(self.until_at)]
        if self.comments is not None:
            parts.append(comments_said(self.comments))
        return _EITHER.join(parts)


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


def comments_said(count: int) -> str:
    """A count of new comments as `until` names it: `1 comment`, `3 comments`."""

    return f"{count} comment" if count == 1 else f"{count} comments"


#: The forms `until` takes, in the words a refusal gives them: a day, a time, a count,
#: both, or an item's reference.
FORMS = (
    "a day YYYY-MM-DD, a time with its zone such as 2026-12-01T09:00:00Z, a count such as"
    " 3 comments, a count or a day such as 2026-12-01 or 3 comments, or an item's reference"
)

#: What a condition joined by ` or ` that is not one count and one moment is refused with.
_ONE_OR_BOTH = (
    "is no condition: join one count and one day or time, such as 2026-12-01 or 3 comments"
)


def until(text: str, now: datetime) -> Until | None:
    """The moment, the count of new comments or both that `text` names, or None when it
    names none of them, which leaves an item's reference.

    A count is `3 comments` (`1 comment`), from 1 to `COMMENTS_MOST`; a count and a
    moment are joined by ` or `, in either order, and the work comes back on whichever
    comes first. A count goes with no item, and two moments or two counts are no
    condition: each is refused, as `moment` refuses a moment that is not one.
    """

    parts = text.split(_EITHER)
    if len(parts) > 2:
        raise model.PlanningError(f"[{TAG}] until {text} {_ONE_OR_BOTH}")
    counts = [_count(part) for part in parts]
    if len(parts) == 1:
        if counts[0] is not None:
            return Until(None, counts[0])
        at = moment(text, now)
        return None if at is None else Until(at, None)
    found = [count for count in counts if count is not None]
    if len(found) != 1:
        raise model.PlanningError(f"[{TAG}] until {text} {_ONE_OR_BOTH}")
    at = moment(parts[1] if counts[0] is not None else parts[0], now)
    if at is None:
        raise model.PlanningError(
            f"[{TAG}] until {text}: a count of comments goes with a day or a time, not with"
            " an item; put it off until the item alone, or until the count"
        )
    return Until(at, found[0])


def _count(part: str) -> int | None:
    """The count of new comments `part` names, or None when it names none."""

    found = _COUNT.match(part)
    if found is None:
        return None
    count = int(found[1])
    if not 1 <= count <= COMMENTS_MOST:
        raise model.PlanningError(
            f"[{TAG}] {part} is no count: count 1 to {COMMENTS_MOST} new comments"
        )
    return count


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
    until_comments: int | None = None,
    comments_after: int | None = None,
) -> None:
    """Set the item's condition, replacing one it had: not yet come.

    A count starts now, after the item's newest comment, unless `comments_after` names
    where it started, as a condition set back does.
    """

    if until_comments is not None and comments_after is None:
        comments_after = int(
            conn.execute(
                "SELECT COALESCE(MAX(id), 0) FROM work_item_comments WHERE work_item_id = ?",
                (work_item_id,),
            ).fetchone()[0]
        )
    conn.execute(
        _PUT,
        (
            work_item_id,
            until_at,
            until_item_id,
            until_comments,
            comments_after,
            reason,
            call_id,
            since,
            None,
        ),
    )


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
    until_at, until_item, counted, after, reason, call, since, _reached = found
    return Held(
        until_at,
        until_item,
        None if counted is None else int(counted),
        None if after is None else int(after),
        str(reason),
        None if call is None else int(call),
        str(since),
    )


def restore(conn: sqlite3.Connection, work_item_id: str, kept: Held) -> None:
    """Set a condition back as it was, under the call that set it, not yet come.

    A condition that had come is set back as one that has not: the question its coming
    asked ended with the write that took it away, and the next pass asks again. A count
    keeps where it started.
    """

    put(
        conn,
        work_item_id,
        until_at=kept.until_at,
        until_item_id=kept.until_item_id,
        reason=kept.reason,
        call_id=kept.call_id,
        since=kept.since,
        until_comments=kept.until_comments,
        comments_after=kept.comments_after,
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


def due(
    conn: sqlite3.Connection,
    at: str,
    limit: int,
    *,
    space_id: str | None = None,
    work_item_id: str | None = None,
) -> list[Due]:
    """The conditions that came by `at` and were not acted on, at most `limit`, in order,
    of one space's items when `space_id` names it, of one item when `work_item_id` does.

    A moment that passed comes back by `date`, before a count reached with it: the write
    of a comment reads its count at once, so a count still unread when its moment has
    passed came after it. A count reached comes back by `comments`; an item that closed
    by a path that did not bring its waiting back -- none does, but a store may hold
    one -- by the way it closed.
    """

    try:
        rows = conn.execute(
            _DUE, (at, space_id, space_id, work_item_id, work_item_id, limit)
        ).fetchall()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return []
    found = []
    for identity, until_at, until_item, counted, category in rows:
        if until_at is not None and until_at <= at:
            because = DATE
        elif until_item is None:
            because = COMMENTS
        else:
            because = str(category)
        count = None if counted is None else int(counted)
        found.append(Due(str(identity), because, until_item, until_at, count))
    return found


def reach(conn: sqlite3.Connection, work_item_id: str, at: str, *, gone: bool = False) -> bool:
    """The condition came at `at`, and the owner is asked instead of the item coming
    back; whether it came only now.

    A condition that came before keeps that moment: the owner was asked then, and
    the item it waits on closing again, or going, asks nothing new. `gone` says
    that item is being deleted: the row then keeps the moment the condition came in
    place of the item, which it can no longer name.
    """

    found = conn.execute(
        "SELECT reached_at FROM work_item_deferrals WHERE work_item_id = ?", (work_item_id,)
    ).fetchone()
    came = found is not None and found[0] is not None
    if gone:
        # Every right-hand side reads the row as it stood before this statement.
        conn.execute(
            "UPDATE work_item_deferrals SET reached_at = COALESCE(reached_at, ?),"
            " until_at = COALESCE(reached_at, ?), until_item_id = NULL WHERE work_item_id = ?",
            (at, at, work_item_id),
        )
    elif not came:
        conn.execute(
            "UPDATE work_item_deferrals SET reached_at = ? WHERE work_item_id = ?",
            (at, work_item_id),
        )
    return not came


def record(conn: sqlite3.Connection, work_item_id: str) -> dict | None:
    """The item's `deferred` field: the condition, why and since when, who set it, and
    when it came; None for an item with none.

    `until` is the moment and `until_comments` the count of new comments, either or both,
    or `until_item` the item's reference alone; `by`
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
    until_at, counted, reason, since, reached_at, key, number, author, session = found
    return {
        "until": until_at,
        "until_item": None if key is None else model.human_id(str(key), int(number)),
        "until_comments": None if counted is None else int(counted),
        "reason": reason,
        "since": since,
        "by": {"author": author, "session_id": session},
        "reached_at": reached_at,
    }


#: The fields of `deferred` the card carries: when or on what it comes back, and
#: whether that came. Why, and who put it off, are read with the events part.
CARD_DEFERRED = ("until", "until_item", "until_comments", "reached_at")


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
        "item": None if because in (DATE, COMMENTS) else rest,
        "at": found[1],
    }


def because_text(due: Due, item: str | None) -> str:
    """Why work came back as its `returned` event says it: `date 2026-12-01`, `comments 3`,
    `completed MAIN-12`."""

    if due.because == DATE:
        return f"{DATE} {said(str(due.until_at))}"
    if due.because == COMMENTS:
        return f"{COMMENTS} {due.until_comments}"
    return f"{due.because} {item}"


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
