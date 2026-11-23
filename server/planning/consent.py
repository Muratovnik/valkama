"""The round of consent: a cancel of work other sessions do, decided by their answers.

An agent's cancel of an item other live sessions work on, a goal's or a stage's
participants or a task's holders, waits at the point `cancel_shared`, and the service
asks each of those sessions at once, by a call of Valkama's own
(`pending.ask_sessions`). Where the owner's setting says `human` the owner is asked
beside them and decides: their answers only show in the question. Where it leaves the
cancel to the agent, or the cancel follows an owner's answer, the round decides it
(`settle`), on each session's answer and at each pass of the sweep:

- an objection passes the cancel to the owner, with the objection; the other sessions
  may still answer until the owner does or their day runs out, so the owner sees more;
- once every session asked agreed or moved its work out of what the cancel closes, or
  has ended since, the cancel is made as Valkama's write (`CANCEL_TOOL`), if it still
  applies, its reason saying who agreed, and marked `cancel_shared` in the summary of
  decisions; one that no longer applies is dropped;
- a day of silence (`pending.SILENCE`) passes it to the owner, the requests nobody
  answered ending with their deadline.

A round is no table of its own: it is the action and its requests, the answers in
those, the day in their `expires_at` and the result in the action's outcome. Once the
owner is asked, the round is the owner's and nothing here touches it again, so a
second pass changes nothing.

The module sits above the service, beside `requests`, which calls it on a session's
answer; it imports neither `requests` nor the sweep.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

from . import (
    calls,
    closing,
    item_tree,
    leases,
    model,
    participation,
    pending,
    questions,
    read_model,
    request_model,
    service,
)

#: The call a cancel the sessions agreed to is made in.
CANCEL_TOOL = "consent-cancel"
#: Who signs what the round writes.
AUTHOR = leases.EXPIRY_AUTHOR
#: What `settle` did: passed the cancel to the owner, made it, or dropped it.
OWNER = "owner"

_MALFORMED = "[consent] answer is agree, object or moved_out; object needs a reason"
_ROUNDS = (
    "SELECT * FROM pending_actions a WHERE a.point = 'cancel_shared' AND a.outcome IS NULL"
    " AND NOT EXISTS (SELECT 1 FROM work_item_requests r WHERE r.action_id = a.action_id"
    " AND r.addressee IS NULL) ORDER BY a.created_at, a.action_id"
)
_SESSION = "SELECT status, ended_at, last_seen FROM sessions WHERE id = ?"


def check_answer(conn: sqlite3.Connection, row: sqlite3.Row, answers: object, own: object) -> None:
    """Refuse a session's answer about a cancel of its work before anything is written.

    It is `agree`, `object` with a reason, or `moved_out`, and no variant of its own.
    `moved_out` stands only once nothing the session holds is left in what the cancel
    closes: the item itself, or the work under a goal or stage.
    """

    given = answers.get(request_model.REVIEW_ANSWER) if isinstance(answers, dict) else None
    reason = answers.get(request_model.CONSENT_REASON) if isinstance(answers, dict) else None
    if (
        own
        or given not in request_model.CONSENT_ANSWERS
        or (
            given == request_model.CONSENT_OBJECT
            and not (isinstance(reason, str) and reason.strip())
        )
    ):
        raise model.PlanningError(_MALFORMED)
    if given != request_model.CONSENT_MOVED_OUT:
        return
    left = _still_held(conn, pending.get(conn, str(row["action_id"])), str(row["addressee"]))
    if left is not None:
        raise model.PlanningError(
            f"[consent] {left} is still in the list: move it out with move_out first"
        )


def asked_of_mover(conn: sqlite3.Connection, row: sqlite3.Row) -> bool:
    """Whether the session of the call in progress is asked, and has not yet answered,
    whether a cancel of a goal or stage over the item may end its work: then its move of
    the item out of that goal or stage is how it answers `moved_out`, and keeps the
    item's holders, state and basis (`split.move_out`)."""

    session = calls.confirmed_session()
    if session is None or not calls.from_agent():
        return False
    over = [
        identity for identity, _kind, _category in item_tree.above(conn, str(row["work_item_id"]))
    ]
    found = conn.execute(
        "SELECT 1 FROM work_item_requests r JOIN pending_actions a ON a.action_id = r.action_id"
        " WHERE a.point = 'cancel_shared' AND a.outcome IS NULL AND r.status = 'pending'"
        " AND r.addressee = ? AND a.work_item_id IN (SELECT value FROM json_each(?)) LIMIT 1",
        (session, json.dumps(over[1:])),
    ).fetchone()
    return found is not None


def _still_held(conn: sqlite3.Connection, action: pending.Action, session: str) -> str | None:
    """The first item the cancel closes that `session` or one of its agents holds, or None."""

    item = read_model.item_by_id(conn, action.work_item_id)
    held = [(read_model.reference(conn, item), closing.holders(item))]
    listing = closing.cancel_list(conn, item) if item["kind"] == model.CONTAINER_KIND else None
    if listing is not None:
        held += [(entry["reference"], entry["holder"]) for entry in listing.cancels]
    named = calls.label_id(session)
    for reference, holders in held:
        for holder in holders:
            ids = calls.holder_ids(holder)
            if ids is not None and ids[0] == named:
                return reference
    return None


def settle(conn: sqlite3.Connection, action: pending.Action) -> str | None:
    """Decide a round by its answers as they stand, at the clock of the sweep: `owner`,
    `carried_out` or `dropped` for what it did, None while it waits or is not the round's
    to decide (ended, or the owner asked)."""

    if action.outcome is not None or pending.owner_question(conn, action):
        return None
    verdict = _verdict(conn, action)
    if verdict is None:
        return None
    if isinstance(verdict, _Told):
        _pass_to_owner(conn, action, verdict)
        return OWNER
    return _cancel(conn, action, verdict)


@dataclass(frozen=True)
class _Told:
    """What the owner is told of a round passed on: each session that objected with its
    reason, or the sessions that did not answer within a day."""

    objections: list[tuple[str, str]] = field(default_factory=list)
    unanswered: list[str] = field(default_factory=list)


def _verdict(conn: sqlite3.Connection, action: pending.Action) -> _Told | list[str] | None:
    """What the answers decide: the owner's question, with what the owner is told, or the
    cancel, with the sessions that agreed; None while a live session that has not answered
    has time."""

    rows = pending.consent_rows(conn, action)
    objections = []
    agreed = []
    for row in rows:
        if row["status"] != "answered":
            continue
        answer = json.loads(row["answers_json"])
        label = pending.session_label(row)
        if answer.get(request_model.REVIEW_ANSWER) == request_model.CONSENT_OBJECT:
            objections.append((label, str(answer.get(request_model.CONSENT_REASON))))
        else:
            agreed.append(label)
    if objections:
        return _Told(objections=objections)
    settings = participation.load(conn)
    silent = [
        row
        for row in rows
        if row["status"] == "pending"
        and leases.session_live(
            conn.execute(_SESSION, (str(row["addressee"]),)).fetchone(), settings=settings
        )
    ]
    if not silent:
        return agreed
    now = request_model.stamp(leases.utc_now())
    if any(row["expires_at"] and row["expires_at"] <= now for row in silent):
        return _Told(unanswered=[pending.session_label(row) for row in silent])
    return None


def _pass_to_owner(conn: sqlite3.Connection, action: pending.Action, told: _Told) -> None:
    """Ask the owner whether to make the cancel, telling them what the sessions said; a
    day of silence ends the requests nobody answered with their deadline."""

    item = read_model.item_by_id(conn, action.work_item_id)
    with calls.bind(calls.valkama(), pending.ROUND_TOOL):
        if _past(conn, action):
            questions.end(conn, action.work_item_id, "deadline", AUTHOR, action_id=action.id)
        pending.ask_owner(
            conn,
            action,
            purpose="cancel",
            prompt=service.cancel_asked(
                conn,
                item,
                action.point,
                action.reason,
                objections=told.objections,
                unanswered=told.unanswered,
            ),
            fields=request_model.fields(request_model.cancel_fields()),
            author=AUTHOR,
        )


def _past(conn: sqlite3.Connection, action: pending.Action) -> bool:
    now = request_model.stamp(leases.utc_now())
    return any(
        row["status"] == "pending" and row["expires_at"] and row["expires_at"] <= now
        for row in pending.consent_rows(conn, action)
    )


def _cancel(conn: sqlite3.Connection, action: pending.Action, agreed: list[str]) -> str:
    """Make the cancel the sessions agreed to, as Valkama's write, while it still applies:
    the work under a goal or stage by its list as it stands, which holds nothing new or
    changed since the agent asked. One that no longer applies, or that a guard now
    refuses, is dropped saying why, so a round never stops the answer or the pass that
    settles it."""

    with calls.bind(calls.valkama(), CANCEL_TOOL):
        why = pending.inapplicable(conn, action)
        if why is None:
            conn.execute("SAVEPOINT consent_cancel")
            try:
                _make(conn, action, agreed)
            except model.PlanningError as refused:
                conn.execute("ROLLBACK TO consent_cancel")
                why = str(refused)
            conn.execute("RELEASE consent_cancel")
        if why is not None:
            pending.end(conn, action, pending.DROPPED, author=AUTHOR, why=why)
            return pending.DROPPED
    return pending.CARRIED_OUT


def _make(conn: sqlite3.Connection, action: pending.Action, agreed: list[str]) -> None:
    item = read_model.item_by_id(conn, action.work_item_id)
    state = str(action.params["state"])
    listing = closing.cancel_list(conn, item) if item["kind"] == model.CONTAINER_KIND else None
    said = [
        str(action.params.get("reason") or ""),
        f"agreed by {', '.join(agreed)}" if agreed else "",
    ]
    limit = service.EVENT_DETAIL_LIMIT - len(f"{state}: ")
    pending.end(conn, action, pending.CARRIED_OUT, author=AUTHOR)
    service.cancel_agreed(
        conn,
        read_model.reference(conn, item),
        state,
        reason="; ".join(part for part in said if part)[:limit],
        cancels=None if listing is None else listing.token,
        what=action.what,
        author=AUTHOR,
    )


def rounds(conn: sqlite3.Connection) -> list[pending.Action]:
    """The rounds still the sessions' to decide: open shared cancels with no owner's question."""

    return [pending.Action.of_row(row) for row in conn.execute(_ROUNDS)]


def sweep_pending(conn: sqlite3.Connection) -> bool:
    """Whether a pass has a round to decide: one past its day, or with nobody live left to answer."""

    return any(_verdict(conn, action) is not None for action in rounds(conn))


def sweep(conn: sqlite3.Connection, *, limit: int) -> int:
    """Settle the rounds a day of silence or ended sessions decide, at most `limit`."""

    settled = 0
    for action in rounds(conn):
        if settled >= limit:
            break
        if settle(conn, action) is not None:
            settled += 1
    return settled
