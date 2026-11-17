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

- **The owner's question.** A session working there confirms by completing the
  container. When none of them is live, or none has confirmed within
  `CONFIRMATION_HOLD`, the planning sweep's `confirmations` step asks the owner in a
  call of Valkama's own (`QUESTION_TOOL`), once in a period of waiting: `confirm`
  ticks the container's steps, writes its summary and completes it, `leave` leaves it
  to the next session that takes work in its space (`left`); `requests.carry_out` does
  either in the write that answers. The same step records a container that came to
  wait in a write that went around the marks, so the invariant holds after every pass.

- **The cancel list.** Cancelling a goal or stage cancels the open work under it, at
  any depth, so the caller sees that work first: `cancel_list` builds what the cancel
  would close (`cancels`) and the open work outside it that waits on it
  (`dependents`), and `token` fingerprints the two. The service refuses a cancel sent
  without that token, or with one the list no longer has, with the list
  (`model.CancelListError`), and cancels exactly that list when the token matches. The
  token holds nothing on the server: it is the list's own content, so the same list
  gives the same token to an agent, the interface and the owner, and an edit of a
  title, a description or a comment leaves it as it was.
- **Freed work.** A close says which open items it left with nothing open blocking
  them (`freed`), and an open item still linked `blocks` to a cancelled one says so
  in its `cancelled_blockers` (`item_tree`).

This module sits below the read model and the service, as `questions` does: the
service, `read_model`, `requests` and `sweep` call it, and it imports none of them (nor
`split`; `pyproject.toml` holds the direction).
"""

from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import sqlite3
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from . import (
    calls,
    deferral,
    item_tree,
    leases,
    model,
    participants,
    questions,
    request_model,
    subscriptions,
)

#: What a container derives while nothing under it is open.
AWAITING = "awaiting_confirmation"
#: The tool Valkama's own call that records the wait is recorded under.
EVENT_TOOL = "awaiting-confirmation"
#: The tool Valkama's own call that asks the owner to confirm is recorded under.
QUESTION_TOOL = "confirmation-question"
#: How long the sessions working on a goal or stage have to confirm it before the
#: owner is asked; with none of them live, the owner is asked at once.
CONFIRMATION_HOLD = timedelta(days=1)
#: The longest question the owner is asked, as the longest an agent may ask.
PROMPT_LIMIT = 8000
#: What the summary of a goal or stage the owner confirmed says was done.
CONFIRMED = "Confirmed by the owner: all work under it is closed."
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

    session = subscriptions.agent_session(calls.current())
    if session is not None:
        subscriptions.follow(conn, identity, session)
    with calls.bind(calls.valkama(), EVENT_TOOL):
        _record(conn, identity)
    return _reference_of(conn, identity)


def _record(conn: sqlite3.Connection, identity: str) -> None:
    """The period of waiting begins: its row and its event, both under the call in progress."""

    text = detail(confirmation(conn, _container(conn, identity)))
    call = calls.call_id(conn, identity)
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id) VALUES(?,?,?,?,?)",
        (identity, model.event_action(AWAITING), text, AUTHOR, call),
    )
    conn.execute(_ENTER, (identity, _stamp(leases.utc_now()), call))


def _container(conn: sqlite3.Connection, identity: str) -> sqlite3.Row:
    found: sqlite3.Row = conn.execute(
        "SELECT work_item_id, checklist FROM work_items WHERE work_item_id = ?", (identity,)
    ).fetchone()
    return found


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


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


# -- the confirmation question and the sweep step ---------------------------------------

#: The containers with a row, and of those the ones whose owner has been neither asked
#: nor told to leave them, with when their wait began.
_RECORDED = "SELECT work_item_id FROM work_item_confirmations"
_UNASKED = (
    "SELECT work_item_id, since FROM work_item_confirmations"
    " WHERE request_id IS NULL AND left_at IS NULL"
)
#: The items named, as one JSON array, by space and number.
_NUMBERED = (
    "SELECT work_item_id FROM work_items WHERE work_item_id IN (SELECT value FROM json_each(?))"
    " ORDER BY planning_space_id, number"
)


def pending(conn: sqlite3.Connection) -> bool:
    """Whether the sweep's `confirmations` step has anything to do now; it writes nothing."""

    waiting = awaiting(conn)
    return bool(_unrecorded(conn, waiting) or _unasked(conn, waiting))


def sweep_confirmations(conn: sqlite3.Connection, *, limit: int) -> int:
    """Record the containers no row records, then ask the owner about those due; how many changed.

    A write that went around the marks leaves a container awaiting with no row: it is
    recorded here under the call in progress, the step's own, with its event and no
    follower, since no agent's write brought it to wait. The owner is then asked about
    a container nobody works on (`participants.live`), or one its sessions have not
    confirmed within `CONFIRMATION_HOLD`, once in a period of waiting: a row that names
    its question, or that the owner left to the next session, asks nothing again. Only
    a container that awaits confirmation now is asked about, so a row a damaged store
    keeps for one that does not asks the owner nothing. At most `limit` containers
    change, one recorded and asked counting once.
    """

    waiting = awaiting(conn)
    changed: set[str] = set()
    for identity in _unrecorded(conn, waiting):
        if len(changed) >= limit:
            return len(changed)
        _record(conn, identity)
        changed.add(identity)
    for identity in _unasked(conn, waiting):
        if len(changed) >= limit and identity not in changed:
            continue
        ask(conn, identity)
        changed.add(identity)
    return len(changed)


def ask(conn: sqlite3.Connection, identity: str) -> str:
    """Ask the owner to confirm the container, in Valkama's own call; the question's id.

    The question names what was cancelled and what moved out under it, each with its
    reason, and its steps, or says it has none and is checked against its description.
    Its row names it from then on.
    """

    reference = _reference_of(conn, identity)
    container = _container(conn, identity)
    part = confirmation(conn, container)
    steps = [str(step["text"]) for step in model.checklist(container["checklist"])]
    with calls.bind(calls.valkama(), QUESTION_TOOL):
        asked = questions.ask(
            conn,
            identity,
            kind="question",
            prompt=prompt(reference, part, steps),
            fields=request_model.fields(list(request_model.CONFIRM_FIELDS)),
            author=AUTHOR,
            purpose=CONFIRM,
        )
    conn.execute(
        "UPDATE work_item_confirmations SET request_id = ? WHERE work_item_id = ?",
        (asked, identity),
    )
    return asked


def prompt(reference: str, part: dict, steps: list[str]) -> str:
    """The question to confirm, at most `PROMPT_LIMIT` characters.

    The lines that do not fit are counted at its end rather than cut mid-line.
    """

    head = (
        f"All work under {reference} is closed: confirm it, or leave it to the next session"
        " that takes work in this space."
    )
    lines = [*_listed("Cancelled", part["cancelled"]), *_listed("Moved out", part["moved_out"])]
    if steps:
        lines += ["", "Its steps:", *(f"- {text}" for text in steps)]
    else:
        lines += ["", "It has no steps: check what was done against its description."]
    whole = "\n".join([head, *lines])
    if len(whole) <= PROMPT_LIMIT:
        return whole
    text = head
    for shown, line in enumerate(lines):
        more = f"\n({len(lines) - shown} more line(s) not shown: see {reference})"
        if len(text) + 1 + len(line) + len(more) > PROMPT_LIMIT:
            return text + more
        text += "\n" + line
    return text  # pragma: no cover - every line fitting is the whole fitting


def left(conn: sqlite3.Connection, identity: str) -> None:
    """The owner left the container to the next session: no question in this period again."""

    conn.execute(
        "UPDATE work_item_confirmations SET left_at = ? WHERE work_item_id = ?",
        (_stamp(leases.utc_now()), identity),
    )


def _listed(label: str, entries: list[dict]) -> list[str]:
    if not entries:
        return []
    return [
        "",
        f"{label}:",
        *(
            f"- {entry['reference']}: {entry['reason']}"
            if entry["reason"]
            else f"- {entry['reference']}"
            for entry in entries
        ),
    ]


def _unrecorded(conn: sqlite3.Connection, waiting: set[str]) -> list[str]:
    """The containers awaiting confirmation that no row records."""

    recorded = {str(row[0]) for row in conn.execute(_RECORDED)}
    return _in_order(conn, waiting - recorded)


def _unasked(conn: sqlite3.Connection, waiting: set[str]) -> list[str]:
    """The containers awaiting confirmation whose owner is to be asked now."""

    now = leases.utc_now()
    found = set()
    for identity, since in conn.execute(_UNASKED).fetchall():
        if str(identity) not in waiting:
            continue
        began = leases.moment(since)
        held = began is not None and now < began + CONFIRMATION_HOLD
        # Within the hold the sessions working there may still confirm it; nobody does
        # when none of them is live.
        if not held or not participants.live(conn, str(identity)):
            found.add(str(identity))
    return _in_order(conn, found)


def _in_order(conn: sqlite3.Connection, identities: set[str]) -> list[str]:
    """The items named, by space and number, so a pass takes the same ones first."""

    if not identities:
        return []
    named = json.dumps(sorted(identities))
    return [str(row[0]) for row in conn.execute(_NUMBERED, (named,))]


# -- the cancel list ------------------------------------------------------------------

#: The refusal of a cancel whose list the caller has not confirmed.
CANCEL_LIST = "cancel_list"
#: How many hexadecimal digits of the list's SHA-256 its token keeps.
TOKEN_DIGITS = 16
#: How a dependent waits on what the cancel closes: linked `blocks` to it, or put off
#: until it.
BLOCKS = "blocks"
DEFERRED = "deferred"

#: Every item under one, at any depth, with what its row of the list and its place in
#: the tree need. `UNION` keeps each once, so a cycle in a damaged store ends.
_UNDER = (
    "WITH RECURSIVE under(id) AS (SELECT work_item_id FROM work_items WHERE parent_id = ?"
    " UNION SELECT w.work_item_id FROM under u JOIN work_items w ON w.parent_id = u.id)"
    " SELECT i.*, p.key AS space_key, s.key AS state_key, s.name AS state_name,"
    " s.category AS state_category FROM under u JOIN work_items i ON i.work_item_id = u.id"
    " JOIN workflow_states s ON s.state_id = i.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
)
#: The open items the items named block, as one JSON array, with the one blocking each.
_BLOCKED = (
    "SELECT t.work_item_id, t.title, t.kind, t.parent_id, p.key, t.number, bp.key, b.number"
    " FROM work_item_links l JOIN work_items t ON t.work_item_id = l.to_id"
    " JOIN workflow_states ts ON ts.state_id = t.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = t.planning_space_id"
    " JOIN work_items b ON b.work_item_id = l.from_id"
    " JOIN planning_spaces bp ON bp.planning_space_id = b.planning_space_id"
    " WHERE l.kind = 'blocks' AND ts.is_terminal = 0"
    " AND l.from_id IN (SELECT value FROM json_each(?))"
)
#: Of the open items the items named block, those nothing open blocks any more.
_FREED = (
    "SELECT DISTINCT p.key, t.number FROM work_item_links l"
    " JOIN work_items t ON t.work_item_id = l.to_id"
    " JOIN workflow_states ts ON ts.state_id = t.state_id"
    " JOIN planning_spaces p ON p.planning_space_id = t.planning_space_id"
    " WHERE l.kind = 'blocks' AND ts.is_terminal = 0"
    " AND l.from_id IN (SELECT value FROM json_each(?))"
    " AND NOT EXISTS (SELECT 1 FROM work_item_links o"
    "  JOIN work_items b ON b.work_item_id = o.from_id"
    "  JOIN workflow_states bs ON bs.state_id = b.state_id"
    "  WHERE o.kind = 'blocks' AND o.to_id = t.work_item_id AND bs.is_terminal = 0)"
    " ORDER BY p.key, t.number"
)


@dataclass(frozen=True)
class CancelList:
    """What cancelling one goal or stage would close, and the token that confirms it."""

    #: The goal's or stage's own reference.
    reference: str
    #: The open items under it, at any depth, in number order: `reference`, `title`,
    #: `kind`, `state` (null for an accepted open goal or stage) with `container_state`,
    #: and `holder`, who holds the item or a step of it, empty when nobody does.
    cancels: list[dict]
    #: The open items outside the list that wait on it or on the goal or stage itself:
    #: `reference`, `title`, `kind`, `waits_on` and `how`.
    dependents: list[dict]
    token: str
    #: The rows of what it cancels, deepest first: the order the cancel closes them in,
    #: so that a goal or stage is cancelled once nothing under it is open.
    rows: list[sqlite3.Row]

    def refusal(self, stale: bool) -> model.CancelListError:
        """The refusal that hands the caller this list; `stale` for a token it no longer has."""

        said = (
            f"the work under {self.reference} changed since that list_token"
            if stale
            else f"{self.reference} has {len(self.cancels)} open item(s) under it, and"
            " cancelling it cancels them all"
        )
        return model.CancelListError(
            f"[{CANCEL_LIST}] {said}: read the list, then send the same transition with"
            f" cancels set to list_token {self.token}",
            self.cancels,
            self.dependents,
            self.token,
        )

    def released(self) -> list[dict]:
        """Each claim the cancel ends, on an item or a step of it: `reference`, `holder`."""

        return [
            {"reference": entry["reference"], "holder": holder}
            for entry in self.cancels
            for holder in entry["holder"]
        ]


def cancel_list(conn: sqlite3.Connection, row: sqlite3.Row) -> CancelList | None:
    """What cancelling the goal or stage `row` would close; None with nothing open under it.

    At most six statements, however much is under it: the items under it, the goal's
    or stage's reference, the tree that says what each goal or stage under it derives,
    what the list blocks and what was put off until one of it.
    """

    identity = str(row["work_item_id"])
    under = conn.execute(_UNDER, (identity,)).fetchall()
    found = [entry for entry in under if entry["state_category"] not in model.TERMINAL_CATEGORIES]
    if not found:
        return None
    tree = item_tree.below(conn, [identity])
    depth = _depths(identity, under)
    found.sort(key=lambda entry: int(entry["number"]))
    cancels = [
        _cancel_row(entry, tree.container_state(str(entry["work_item_id"]))) for entry in found
    ]
    dependents = _dependents(conn, {identity, *(str(entry["work_item_id"]) for entry in found)})
    return CancelList(
        reference=_reference_of(conn, identity),
        cancels=cancels,
        dependents=dependents,
        token=token(cancels, dependents),
        rows=sorted(
            found, key=lambda entry: (-depth[str(entry["work_item_id"])], int(entry["number"]))
        ),
    )


def token(cancels: list[dict], dependents: list[dict]) -> str:
    """The list's fingerprint: what is cancelled, where it stands and who holds it, and
    what waits on it and how.

    Titles, kinds, descriptions and comments are not in it: editing them changes nothing
    the cancel does. A new item under the goal or stage, another holder or another state
    changes it.
    """

    text = json.dumps(
        projection(cancels, dependents), sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )
    return hashlib.sha256(text.encode("ascii")).hexdigest()[:TOKEN_DIGITS]


def projection(cancels: list[dict], dependents: list[dict]) -> dict[str, list[list]]:
    """What the token of a list fingerprints, one row a list each: what is cancelled with
    where it stands and who holds it, and what waits on it and how."""

    return {
        "cancels": sorted(
            [entry["reference"], _token_state(entry), sorted(entry["holder"])] for entry in cancels
        ),
        "dependents": sorted(
            [entry["reference"], entry["waits_on"], entry["how"]] for entry in dependents
        ),
    }


def freed(conn: sqlite3.Connection, closed: Iterable[str]) -> list[str]:
    """The open items the items `closed` blocked that nothing open blocks any more."""

    named = json.dumps(sorted(set(closed)))
    return [model.human_id(str(key), int(number)) for key, number in conn.execute(_FREED, (named,))]


def _cancel_row(entry: sqlite3.Row, derived: str | None) -> dict:
    accepted = entry["state_category"] == model.SERVICE_CATEGORY
    state = {
        "key": entry["state_key"],
        "name": entry["state_name"],
        "category": entry["state_category"],
    }
    return {
        "reference": model.human_id(str(entry["space_key"]), int(entry["number"])),
        "title": entry["title"],
        "kind": model.outward_kind(entry["kind"], entry["parent_id"]),
        "state": None if accepted else state,
        "container_state": derived,
        "holder": holders(entry),
    }


def holders(entry: sqlite3.Row) -> list[str]:
    """Who holds the item and who holds a step of it, each once, sorted."""

    found = {str(entry["claim_ref"])} if entry["claim_ref"] else set()
    steps = model.checklist(entry["checklist"])
    found |= {str(step["claimed_by"]) for step in steps if step["claimed_by"]}
    return sorted(found)


def _token_state(entry: dict) -> str:
    """Where an item of the list stands for its token: its state's key, or what it derives."""

    if entry["state"] is None:
        return str(entry["container_state"])
    return str(entry["state"]["key"])


def _depths(root: str, under: list[sqlite3.Row]) -> dict[str, int]:
    """How far below `root` each item stands, 1 for its children."""

    parents = {str(entry["work_item_id"]): str(entry["parent_id"]) for entry in under}
    depths: dict[str, int] = {}
    for identity in parents:
        steps, current = 0, identity
        # The climb ends at the root, or after as many steps as there are items, which
        # only a cycle in a damaged store would take.
        while current != root and current in parents and steps <= len(parents):
            steps, current = steps + 1, parents[current]
        depths[identity] = steps
    return depths


def _dependents(conn: sqlite3.Connection, closing: set[str]) -> list[dict]:
    """The open items outside `closing` that a member of it blocks, one row per blocker,
    and those put off until a member of it, which come back when it closes."""

    found = []
    for identity, title, kind, parent_id, key, number, blocker_key, blocker in conn.execute(
        _BLOCKED, (json.dumps(sorted(closing)),)
    ):
        if str(identity) in closing:
            continue
        found.append(
            {
                "reference": model.human_id(str(key), int(number)),
                "title": title,
                "kind": model.outward_kind(kind, parent_id),
                "waits_on": model.human_id(str(blocker_key), int(blocker)),
                "how": BLOCKS,
            }
        )
    for identity, title, kind, parent_id, key, number, until_key, until in deferral.dependents(
        conn, closing
    ):
        if str(identity) in closing:
            continue
        found.append(
            {
                "reference": model.human_id(str(key), int(number)),
                "title": title,
                "kind": model.outward_kind(kind, parent_id),
                "waits_on": model.human_id(str(until_key), int(until)),
                "how": DEFERRED,
            }
        )
    return sorted(found, key=lambda entry: (entry["reference"], entry["waits_on"]))


def _reference_of(conn: sqlite3.Connection, identity: str) -> str:
    found = conn.execute(_REFERENCE, (identity,)).fetchone()
    return model.human_id(str(found[0]), int(found[1]))
