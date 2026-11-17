"""How a goal or stage closes: the wait for its confirmation, and the marks a write leaves.

A goal or stage closes when its work is done, and its work is done when nothing under
it is open. That moment is derived (`item_tree.Tree.container_state` reads
`awaiting_confirmation`), never stored, so it is caught where it happens: in the write
that closed, reopened, moved, filed or deleted the item that made the difference.

- **Marks.** A write of the service opens a frame (`frame`, which `service.one_write`
  and `service.marking` open), and a frame opened inside another joins it. Every path
  that changes whether an item is open, which container it stands under, or whether it
  stands anywhere, calls `note` for the container before it changes it: the frame keeps
  what that container derived before the write's first change to it. At the end of the
  outermost frame `settle` reads what each marked container derives after.
- **Entering the wait** (before not `awaiting_confirmation`, after so): a row of
  `work_item_confirmations` records the period of waiting, the top-level session of
  the agent whose call it was follows the container (`subscriptions.follow`) -- so a
  coordinator whose subagent closed the last task hears it -- and Valkama records
  `awaiting_confirmation` on it in a call of its own (`EVENT_TOOL`). The event names
  what was cancelled and what moved out, and says when the container has no steps to
  check (`NO_STEPS`). Its kind asks for a session (`person_events.SERVER_ASKS`), so it
  wakes whoever works there. A person's write and the server's own subscribe nobody.
- **Leaving it** (a child filed, reopened or moved in, or the container closed): the
  row goes and an open confirmation question ends `withdrawn`. The words waiting for
  the next session on it go too (`waiting.drop`), which `service.marking` does after
  `settle`, since `waiting` reads the read model and this module sits below it.

The invariant: a row stands for exactly the containers that derive
`awaiting_confirmation`. It is not a second state; the state is still derived, and the
row holds what was done in the period of waiting: since when, the call that recorded
it, the question asked and when the owner left it to the next session.

What a confirmer reads is the `confirmation` part of the container (`confirmation`):
the children cancelled and moved out, each with its reason, and how many steps the
container has to check, 0 meaning its description is what to check against.

This module sits below the read model and the service, as `questions` does: the
service and `read_model` call it, and it imports neither (nor `requests`, `split` or
`sweep`; `pyproject.toml` holds the direction). Later parts of closing extend it here:
the cancel list and its token, the confirmation question and its sweep step.
"""

from __future__ import annotations

import contextlib
import contextvars
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, field

from . import calls, item_tree, leases, model, questions, subscriptions

#: What a container derives while nothing under it is open.
AWAITING = "awaiting_confirmation"
#: The tool Valkama's own call that records the wait is recorded under.
EVENT_TOOL = "awaiting-confirmation"
#: Who that record names as its author: Valkama, as the lease expiry does.
AUTHOR = leases.EXPIRY_AUTHOR
#: The longest detail of the event, as every event detail.
DETAIL_LIMIT = 512
#: How the detail ends for a container with no steps: there is nothing to tick.
NO_STEPS = "no steps: check it against its description"
#: The purpose of the question that asks the owner to confirm.
CONFIRM = "confirm"

#: The containers the write in progress marked, each with what it derived before the
#: write's first change to it; None outside a frame.
_MARKS: contextvars.ContextVar[dict[str, _Mark] | None] = contextvars.ContextVar(
    "planning_container_marks", default=None
)

#: The row that records a period of waiting.
_ROW = "SELECT since, request_id, left_at FROM work_item_confirmations WHERE work_item_id = ?"
#: The children of a container that were cancelled, with what says why: the detail of
#: the move that cancelled each and its summary.
_CANCELLED = (
    "SELECT p.key, c.number, c.summary,"
    " (SELECT e.detail FROM work_item_events e WHERE e.work_item_id = c.work_item_id"
    "  AND e.action = 'transitioned' ORDER BY e.id DESC LIMIT 1)"
    " FROM work_items c JOIN workflow_states s ON s.state_id = c.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = c.planning_space_id"
    " WHERE c.parent_id = ? AND s.category = 'cancelled' ORDER BY c.number"
)
#: What the children that left a container left it with, oldest first, beside the
#: references of the children it holds now.
_LEFT = (
    "SELECT detail FROM work_item_events WHERE work_item_id = ? AND action = 'child_left'"
    " ORDER BY id"
)
_HELD = (
    "SELECT p.key, c.number FROM work_items c"
    " JOIN planning_spaces p ON p.planning_space_id = c.planning_space_id WHERE c.parent_id = ?"
)
_REFERENCE = (
    "SELECT p.key, i.number FROM work_items i"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " WHERE i.work_item_id = ?"
)
_ENTER = (
    "INSERT INTO work_item_confirmations(work_item_id, since, call_id) VALUES(?,?,?)"
    " ON CONFLICT(work_item_id) DO UPDATE SET since = excluded.since,"
    " call_id = excluded.call_id, request_id = NULL, left_at = NULL"
)


@dataclass(frozen=True)
class _Mark:
    #: What the container derived before the write changed it.
    before: str | None
    #: Who the write names, for what leaving the wait records under its call.
    author: str | None


@dataclass
class Settled:
    """What the end of one write found: the containers that came to wait, and that stopped."""

    #: The references of the containers that came to await confirmation, in mark order.
    entered: list[str] = field(default_factory=list)
    #: The ids of the containers that stopped awaiting it.
    left: list[str] = field(default_factory=list)


@contextlib.contextmanager
def frame(conn: sqlite3.Connection) -> Iterator[Settled]:
    """The marks of one write: opened here, or joined when a frame is open already.

    The outermost frame settles its marks when its block ends without an error, and
    the `Settled` it yields says what that found. A joined frame yields one that stays
    empty, since the frame it joined settles. A block that raised settles nothing: its
    write is being undone.
    """

    if _MARKS.get() is not None:
        yield Settled()
        return
    marks: dict[str, _Mark] = {}
    token = _MARKS.set(marks)
    settled = Settled()
    try:
        yield settled
    finally:
        _MARKS.reset(token)
    settle(conn, marks, settled)


def note(conn: sqlite3.Connection, identity: object, author: str | None = None) -> None:
    """Mark a container before the write in progress changes the work under it, or it.

    The first mark of a container in a frame keeps what it derived then; a later one
    changes nothing. `identity` None, a parent that is not there, marks nothing. Outside
    a frame there is no end of the write to settle at, so a mark there is refused: a path
    that changes what a container derives runs inside one.
    """

    marks = _MARKS.get()
    if marks is None:
        raise RuntimeError("a container is marked outside a write's frame")
    if identity is None or str(identity) in marks:
        return
    found = str(identity)
    marks[found] = _Mark(_derived(conn, found), author)


def settle(conn: sqlite3.Connection, marks: dict[str, _Mark], settled: Settled) -> None:
    """Enter or leave the wait for each marked container, by what it derives now."""

    for identity, mark in marks.items():
        tree = item_tree.below(conn, [identity])
        if identity not in tree.nodes:
            # Deleted in this write: its row and its questions went with it.
            continue
        after = tree.container_state(identity)
        if after == AWAITING and mark.before != AWAITING:
            settled.entered.append(_enter(conn, identity))
        elif mark.before == AWAITING and after != AWAITING:
            _leave(conn, identity, mark.author)
            settled.left.append(identity)


def awaiting(conn: sqlite3.Connection) -> set[str]:
    """Every container of the store that derives `awaiting_confirmation` now."""

    spaces = [str(row[0]) for row in conn.execute("SELECT planning_space_id FROM planning_spaces")]
    tree = item_tree.of_spaces(conn, spaces)
    return {identity for identity in tree.nodes if tree.container_state(identity) == AWAITING}


def confirmation(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    """The `confirmation` part of a container awaiting it: what the confirmer checks.

    `cancelled` and `moved_out` are its children that closed without being done and
    that left it, each with its reason: a cancelled one's is the reason of the move
    that cancelled it, else the `why` of its summary, else its `done`; one that left
    gives the reason its `child_left` records, null where it records none. `steps` is
    how many steps the container has: 0 means it is checked against its description.
    `since`, `asked` (the confirmation question's id) and `left_for_next_session` (when
    the owner left it to the next session) come from its row, null without one.
    """

    identity = str(row["work_item_id"])
    cancelled = [
        {"reference": model.human_id(str(key), int(number)), "reason": _cancel_reason(detail, kept)}
        for key, number, kept, detail in conn.execute(_CANCELLED, (identity,))
    ]
    stored = _row(conn, identity)
    return {
        "since": None if stored is None else stored[0],
        "steps": len(model.checklist(row["checklist"])),
        "cancelled": cancelled,
        "moved_out": _moved_out(conn, identity),
        "asked": None if stored is None else stored[1],
        "left_for_next_session": None if stored is None else stored[2],
    }


def counted(part: dict) -> int:
    """How many items the part names, as the card's table of contents counts it."""

    return len(part["cancelled"]) + len(part["moved_out"])


def detail(part: dict) -> str:
    """The detail of the event: `cancelled MAIN-12, MAIN-14; moved out MAIN-15`, at most
    `DETAIL_LIMIT` characters.

    A container with no steps ends it with `NO_STEPS`, which the limit keeps first; the
    references that do not fit are counted as `and N more`.
    """

    cancelled = [entry["reference"] for entry in part["cancelled"]]
    moved = [entry["reference"] for entry in part["moved_out"]]
    tail = [] if part["steps"] else [NO_STEPS]
    total = len(cancelled) + len(moved)
    for shown in range(total, -1, -1):
        segments = [
            _segment("cancelled", cancelled, shown),
            _segment("moved out", moved, max(0, shown - len(cancelled))),
        ]
        text = "; ".join([segment for segment in segments if segment] + tail)
        if len(text) <= DETAIL_LIMIT:
            return text
    return "; ".join(tail)  # pragma: no cover - the tail alone always fits


def _segment(label: str, references: list[str], shown: int) -> str:
    if not references:
        return ""
    named = references[:shown]
    hidden = len(references) - len(named)
    if not named:
        return f"{label} {hidden} more"
    more = f" and {hidden} more" if hidden else ""
    return f"{label} {', '.join(named)}{more}"


def _enter(conn: sqlite3.Connection, identity: str) -> str:
    """The container came to wait: its row, its follower and Valkama's record of it."""

    found = conn.execute(_REFERENCE, (identity,)).fetchone()
    reference = model.human_id(str(found[0]), int(found[1]))
    container = conn.execute(
        "SELECT work_item_id, checklist FROM work_items WHERE work_item_id = ?", (identity,)
    ).fetchone()
    text = detail(confirmation(conn, container))
    session = subscriptions.agent_session(calls.current())
    if session is not None:
        subscriptions.follow(conn, identity, session)
    since = leases.utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
    with calls.bind(calls.valkama(), EVENT_TOOL):
        call = calls.call_id(conn, identity)
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id)"
            " VALUES(?,?,?,?,?)",
            (identity, model.event_action(AWAITING), text, AUTHOR, call),
        )
        conn.execute(_ENTER, (identity, since, call))
    return reference


def _leave(conn: sqlite3.Connection, identity: str, author: str | None) -> None:
    """The container stopped waiting: its row goes, and the question that asked to confirm."""

    conn.execute("DELETE FROM work_item_confirmations WHERE work_item_id = ?", (identity,))
    questions.end(conn, identity, "withdrawn", author, purpose=CONFIRM)


def _derived(conn: sqlite3.Connection, identity: str) -> str | None:
    return item_tree.below(conn, [identity]).container_state(identity)


def _row(conn: sqlite3.Connection, identity: str) -> tuple[str, str | None, str | None] | None:
    """The container's row, or None; a store an earlier build wrote may have no table."""

    try:
        found = conn.execute(_ROW, (identity,)).fetchone()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return None
    return None if found is None else (str(found[0]), found[1], found[2])


def _cancel_reason(detail: object, summary: object) -> str | None:
    """Why a child was cancelled: its move's reason, else its summary's `why`, else `done`."""

    _key, _colon, reason = str(detail or "").partition(": ")
    if reason.strip():
        return reason.strip()
    said = model.summary(summary, required=False)
    if said is None:
        return None
    return str(said.get("why") or said.get("done") or "") or None


def _moved_out(conn: sqlite3.Connection, identity: str) -> list[dict]:
    """The children that left the container and did not come back, each with its reason.

    A `child_left` detail is the child's reference, then `: ` and the reason where the
    move gave one. The newest record of a child speaks for it.
    """

    held = {
        model.human_id(str(key), int(number)) for key, number in conn.execute(_HELD, (identity,))
    }
    left: dict[str, str | None] = {}
    for (said,) in conn.execute(_LEFT, (identity,)):
        reference, _colon, reason = str(said).partition(": ")
        left.pop(reference, None)
        left[reference] = reason.strip() or None
    return [
        {"reference": reference, "reason": reason}
        for reference, reason in left.items()
        if reference not in held
    ]
