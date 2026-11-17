"""Which open work items one agent session holds, for a reader showing it beside that session.

Two readers ask it: `held_by_session`, behind `GET /api/planning/held`, and
`held_for_note`, the facts a session's resume note tells it of the work it holds.
Both take the holds by one rule. `lost_since_last_call` gives the note the other
side: what the lease expiry took from the session since its last call.

A session holds an item while the item's claim, or a step of its checklist that
is not done, carries a holder label of that session: the rule `subscriptions`
and `hooks.notify` hold to. A subagent's label ends in its session's suffix, so
what a subagent holds is its session's as well.

A claim counts while its lease has not lapsed, read as the work-item read reads
its `claim_state` (`leases`): a `stale` lease is nobody's work any more, though
nothing has released it yet. A step records no call of its own, so it lapses
with the session that holds it, by the same rule, read from that session's
newest confirmed call (`leases.of_step`). An open question to the owner on the
item stops the count of silence for both. An item in a terminal state holds
nothing: closing releases every claim on it.

Read-only: nothing here writes, releases or expires anything.
"""

from __future__ import annotations

import json
import sqlite3

from ..projects import project_registry
from . import (
    acknowledgements,
    calls,
    item_projects,
    item_tree,
    leases,
    model,
    questions,
    read_model,
    states,
    subscriptions,
)

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


#: The newest confirmed write call of a session, or of one agent of it, on each item;
#: with one MAX, SQLite reads the bare `received_at` from the row that has it.
_LAST_WRITES = (
    "SELECT work_item_id, MAX(id) AS id, received_at AS at FROM execution_events"
    " WHERE session_id = ? AND kind = ? AND identity_state = ? AND work_item_id IS NOT NULL"
    " AND (? IS NULL OR agent_id = ?) GROUP BY work_item_id"
)
#: An item's threads with no resolved mark, and its questions answered after a time:
#: every answer when the time is NULL. A changed answer moves `resolved_at`, so it
#: counts as new again.
_NOTE_COUNTS = (
    "SELECT (SELECT COUNT(*) FROM work_item_comments WHERE work_item_id = :item"
    "  AND reply_to IS NULL AND reply_to_request IS NULL AND resolved_at IS NULL),"
    " (SELECT COUNT(*) FROM work_item_requests WHERE work_item_id = :item"
    "  AND status = 'answered'"
    "  AND (:after IS NULL OR julianday(resolved_at) > julianday(:after)))"
)
_REFERENCES = (
    "SELECT w.work_item_id, p.key, w.number FROM work_items w"
    " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " WHERE w.work_item_id IN (SELECT value FROM json_each(?))"
)
#: The mark a step carries when a previous holder ticked it: a tick to confirm, not a done step.
FLAG = model.PREVIOUS_HOLDER

#: The newest confirmed write call of a session, or of one agent of it: the recipient's
#: last call. A session start is a lifecycle event, not a call, so a resume does not
#: move it past the losses it is to be told.
_LAST_CALL = (
    "SELECT MAX(id) FROM execution_events WHERE session_id = ? AND kind = ?"
    " AND identity_state = ? AND (? IS NULL OR agent_id = ?)"
)
#: Each hold the lease expiry released on an open item after a call, the newest first:
#: an item's claim (`released`, whose detail names its holder) or a step
#: (`checklist_released`, whose detail is the step's text).
_SWEPT = (
    "SELECT e.id AS event_id, e.action, e.detail, w.*, p.key AS space_key"
    " FROM execution_events c JOIN work_item_events e ON e.call_id = c.id"
    " JOIN work_items w ON w.work_item_id = e.work_item_id"
    " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
    " JOIN workflow_states s ON s.state_id = w.state_id"
    " WHERE c.tool = ? AND c.id > ? AND s.is_terminal = 0"
    " AND (e.action = 'checklist_released' OR (e.action = 'released' AND instr(e.detail, ?) > 0))"
    " ORDER BY e.id DESC"
)
#: Who took a step of this text on the item last before an event: the call behind its
#: newest claim or takeover. Both events record the step's text as its release does.
_STEP_TAKEN = (
    "SELECT c.session_id, c.agent_id, c.identity_state FROM work_item_events e"
    " LEFT JOIN execution_events c ON c.id = e.call_id"
    " WHERE e.work_item_id = ? AND e.id < ? AND e.detail = ?"
    " AND e.action IN ('checklist_claimed', 'checklist_taken_over')"
    " ORDER BY e.id DESC LIMIT 1"
)


@read_model.whole_store_read()
def held_by_session(conn: sqlite3.Connection, session: object) -> dict:
    """The open items `session` holds, most recently changed first.

    Each names how it is held (`held_as`: its claim, else a step), its state, how
    many of its steps are done, how many of its questions wait for a person, and
    the address that opens it. A session nothing names answers with no items.
    """

    session = _required(session)
    held = _holds(conn, subscriptions.holder_suffix(session))
    return {"session": session, "items": [_item(conn, row, held_as) for row, held_as in held]}


@read_model.whole_store_read()
def held_for_note(
    conn: sqlite3.Connection, session: object, agent: str | None = None
) -> list[dict]:
    """What a session, or one agent of it, holds, with what a resume note tells of each.

    The holds are those of `held_by_session` under the same rules, for the holder
    labels of `agent` alone when one is named and of the whole session, its agents
    with it, when none is. Each item carries the fields `held_by_session` gives it and:

    - `next_condition`: the first step not done that the recipient holds, else the
      first step that is not done or that a previous holder ticked, as
      `{text, done, total, flagged}`, where `done` counts the ticked steps no
      previous holder ticked; null when every step is ticked so, or there is none;
    - `open_threads`, the roots with no resolved mark; `new_answers`, the questions
      answered after the recipient's newest write on the item, every answered one
      when it wrote none; `to_confirm`, the steps a previous holder ticked;
    - `stage` and `goal`: the nearest container over the item when it is a stage,
      and the topmost one, by reference, or null;
    - `roots`: the item's `item_projects.project_roots`, as a claim answers with
      them, from one read of the registry for every item;
    - `last_write`: the id of the recipient's newest confirmed write call on the
      item, or null.

    The items come by `last_write`, the newest first and those with none last,
    each group in the order `held_by_session` gives. Read-only, like that read.
    """

    session = _required(session)
    agent = agent or None
    suffix = subscriptions.holder_suffix(session, agent)
    held = _holds(conn, suffix)
    if not held:
        return []
    writes = {
        str(row["work_item_id"]): row
        for row in conn.execute(
            _LAST_WRITES, (session, calls.KIND, calls.CONFIRMED, agent, agent)
        ).fetchall()
    }
    listing = project_registry.read_registry()
    items = []
    for row, held_as in held:
        identity = str(row["work_item_id"])
        write = writes.get(identity)
        items.append(
            {
                **_item(conn, row, held_as),
                **_note_facts(conn, row, suffix, None if write is None else str(write["at"])),
                "roots": item_projects.project_roots(conn, identity, listing=listing),
                "last_write": None if write is None else int(write["id"]),
            }
        )
    # A stable sort: items with no write keep the order of `held_by_session`.
    items.sort(key=lambda item: (item["last_write"] is None, -(item["last_write"] or 0)))
    return items


@read_model.whole_store_read()
def lost_since_last_call(
    conn: sqlite3.Connection, session: object, agent: str | None = None
) -> list[str]:
    """The open items a session, or one agent of it, lost to the lease expiry since its last call.

    The last call is the recipient's newest confirmed write call, whatever agent of
    the session made it when no `agent` is named. A loss is a hold the expiry
    released after that call:

    - the item's claim, when the item's `lapsed_claim`, read by the code the
      record reads it with, names a holder label of the recipient: so not once
      somebody claimed the item again;
    - a step, when the newest claim or takeover of a step with that text on the
      item before the release was a call of the recipient. A step whose text
      changed between the two is not paired, and so not named.

    Taking an item back is a call of the recipient's, so what it took back is
    behind its last call. By reference, the newest loss first, each item once.
    Read-only.
    """

    session = _required(session)
    agent = agent or None
    suffix = subscriptions.holder_suffix(session, agent)
    last = conn.execute(
        _LAST_CALL, (session, calls.KIND, calls.CONFIRMED, agent, agent)
    ).fetchone()[0]
    swept = conn.execute(_SWEPT, (leases.EXPIRY_TOOL, last or 0, suffix)).fetchall()
    lost: dict[str, str] = {}
    for row in swept:
        identity = str(row["work_item_id"])
        if identity in lost:
            continue
        if row["action"] == "released":
            lapsed = read_model.lapsed_claims(conn, [row]).get(identity)
            mine = lapsed is not None and str(lapsed["holder"]).endswith(suffix)
        else:
            taken = conn.execute(
                _STEP_TAKEN, (identity, int(row["event_id"]), row["detail"])
            ).fetchone()
            mine = (
                taken is not None
                and taken["identity_state"] == calls.CONFIRMED
                and taken["session_id"] == session
                and (agent is None or taken["agent_id"] == agent)
            )
        if mine:
            lost[identity] = model.human_id(str(row["space_key"]), int(row["number"]))
    return list(lost.values())


def _required(session: object) -> str:
    if not isinstance(session, str) or not session.strip():
        raise model.PlanningError("session is required")
    return session


def _holds(conn: sqlite3.Connection, suffix: str) -> list[tuple[sqlite3.Row, str]]:
    """Each open item a label ending in `suffix` holds, and how: the one rule of holding."""

    # The SQL finds every candidate; the label rule decides, because a suffix
    # inside a step's text or a done step's holder is not a hold.
    rows = conn.execute(_OPEN_ITEMS, (suffix, suffix)).fetchall()
    found = []
    for row in rows:
        lease = leases.lease(conn, row) if subscriptions.holds_claim(row, suffix) else None
        if lease is not None and lease.state != leases.STALE:
            held_as = CLAIM
        elif _holds_standing_step(conn, row, suffix):
            held_as = STEP
        else:
            continue
        found.append((row, held_as))
    return found


def _holds_standing_step(conn: sqlite3.Connection, row: sqlite3.Row, suffix: str) -> bool:
    """Whether an open step of the item is held under `suffix` by a lease not gone stale."""

    for step in model.checklist(row["checklist"]):
        holder = str(step["claimed_by"] or "")
        if not step["done"] and holder.endswith(suffix):
            return leases.of_step(conn, row, holder).state != leases.STALE
    return False


def _note_facts(
    conn: sqlite3.Connection, row: sqlite3.Row, suffix: str, last_write_at: str | None
) -> dict:
    identity = str(row["work_item_id"])
    steps = model.checklist(row["checklist"])
    threads, answers = conn.execute(
        _NOTE_COUNTS, {"item": identity, "after": last_write_at}
    ).fetchone()
    stage, goal = _containers(conn, row["parent_id"])
    return {
        "next_condition": next_condition(steps, suffix),
        "open_threads": int(threads),
        "new_answers": int(answers),
        "to_confirm": sum(1 for step in steps if step.get(FLAG)),
        "stage": stage,
        "goal": goal,
    }


def next_condition(steps: list[dict], suffix: str) -> dict | None:
    """The step a holder works next, with how many steps are ticked and of how many.

    The first step not done that a label ending in `suffix` holds; failing that the
    first step that is not done or that a previous holder ticked, which is not done
    until somebody confirms it.
    """

    def ticked(step: dict) -> bool:
        return bool(step["done"]) and not step.get(FLAG)

    own = (
        step
        for step in steps
        if not step["done"] and str(step["claimed_by"] or "").endswith(suffix)
    )
    found = next(own, None) or next((step for step in steps if not ticked(step)), None)
    if found is None:
        return None
    return {
        "text": found["text"],
        "done": sum(1 for step in steps if ticked(step)),
        "total": len(steps),
        "flagged": bool(found.get(FLAG)),
    }


def _containers(conn: sqlite3.Connection, parent_id: object) -> tuple[str | None, str | None]:
    """The stage an item stands in and the goal over it, by reference.

    Only a container holds items, so everything over an item is one: the nearest is
    a stage when something is over it, and the topmost is the goal.
    """

    if not parent_id:
        return None, None
    chain = [identity for identity, _kind, _category in item_tree.above(conn, str(parent_id))]
    stage = chain[0] if len(chain) > 1 else None
    wanted = [identity for identity in (stage, chain[-1]) if identity is not None]
    references = {
        str(found[0]): model.human_id(str(found[1]), int(found[2]))
        for found in conn.execute(_REFERENCES, (json.dumps(wanted),))
    }
    return (None if stage is None else references.get(stage), references.get(chain[-1]))


def _item(conn: sqlite3.Connection, row: sqlite3.Row, held_as: str) -> dict:
    reference = model.human_id(str(row["space_key"]), int(row["number"]))
    steps = model.checklist(row["checklist"])
    # Only open items are read, and nobody holds a container, so a state is always shown.
    shown = states.public_state(
        {
            "key": row["state_key"],
            "name": row["state_name"],
            "category": row["state_category"],
            "is_terminal": 0,
        }
    )
    return {
        "reference": reference,
        "title": row["title"],
        "state": None
        if shown is None
        else {name: shown[name] for name in ("key", "name", "category")},
        "held_as": held_as,
        "steps": {"done": sum(1 for step in steps if step["done"]), "total": len(steps)},
        "pending_questions": len(questions.open_rows(conn, str(row["work_item_id"]))),
        "url": acknowledgements.work_item_url(reference),
    }
