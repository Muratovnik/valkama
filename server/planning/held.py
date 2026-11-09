"""Which open work items one agent session holds, for a reader showing it beside that session.

A session holds an item while the item's claim, or a step of its checklist that
is not done, carries a holder label of that session: the rule `subscriptions`
and `hooks.notify` hold to. A subagent's label ends in its session's suffix, so
what a subagent holds is its session's as well.

A claim counts while its lease has not lapsed, read as the work-item read reads
its `claim_state` (`leases`): a `stale` lease is nobody's work any more, though
nothing has released it yet. A step records no call of its own, so it lapses
with the session that holds it, by the same rule, read from that session's
newest confirmed call. An item in a terminal state holds nothing: closing
releases every claim on it.

Read-only: nothing here writes, releases or expires anything.
"""

from __future__ import annotations

import sqlite3

from . import acknowledgements, calls, leases, model, read_model, requests, subscriptions

CLAIM = "claim"
STEP = "step"

_OPEN_ITEMS = (
    "SELECT w.*, p.key AS space_key, s.key AS state_key, s.name AS state_name,"
    " s.category AS state_category"
    " FROM work_items w JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " JOIN workflow_states s ON s.state_id = w.state_id"
    " WHERE s.is_terminal = 0 AND (instr(w.claim_ref, ?) > 0 OR instr(w.checklist, ?) > 0)"
    " ORDER BY w.updated_at DESC, w.work_item_id"
)
_NEWEST_CALL = leases.CALL + (
    " WHERE c.session_id = ? AND c.identity_state = ? ORDER BY c.id DESC LIMIT 1"
)


@read_model.whole_store_read()
def held_by_session(conn: sqlite3.Connection, session: object) -> dict:
    """The open items `session` holds, most recently changed first.

    Each names how it is held (`held_as`: its claim, else a step), its state, how
    many of its steps are done, how many of its questions wait for a person, and
    the address that opens it. A session nothing names answers with no items.
    """

    if not isinstance(session, str) or not session.strip():
        raise model.PlanningError("session is required")
    suffix = subscriptions.holder_suffix(session)
    # The SQL finds every candidate; the label rule decides, because a suffix
    # inside a step's text or a done step's holder is not a hold.
    rows = conn.execute(_OPEN_ITEMS, (suffix, suffix)).fetchall()
    standing: bool | None = None
    items = []
    for row in rows:
        lease = leases.lease(conn, row) if subscriptions.holds_claim(row, suffix) else None
        if lease is not None and lease.state != leases.STALE:
            held_as = CLAIM
        elif subscriptions.holds_step(row, suffix):
            if standing is None:
                standing = _stands(conn, session)
            if not standing:
                continue
            held_as = STEP
        else:
            continue
        items.append(_item(conn, row, held_as))
    return {"session": session, "items": items}


def _stands(conn: sqlite3.Connection, session: str) -> bool:
    """Whether a claim this session took now would not read `stale`."""

    call = conn.execute(_NEWEST_CALL, (session, calls.CONFIRMED)).fetchone()
    return leases.of_call("", call).state != leases.STALE


def _item(conn: sqlite3.Connection, row: sqlite3.Row, held_as: str) -> dict:
    reference = model.human_id(str(row["space_key"]), int(row["number"]))
    steps = model.checklist(row["checklist"])
    return {
        "reference": reference,
        "title": row["title"],
        "state": {
            "key": row["state_key"],
            "name": row["state_name"],
            "category": row["state_category"],
        },
        "held_as": held_as,
        "steps": {"done": sum(1 for step in steps if step["done"]), "total": len(steps)},
        "pending_questions": len(requests.open_rows(conn, str(row["work_item_id"]))),
        "url": acknowledgements.work_item_url(reference),
    }
