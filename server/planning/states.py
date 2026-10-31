"""How a caller names a workflow state, and which state a claim starts work in.

A workflow's states are rows, so their keys belong to the installation: the
default workflow says `dev`, another may say `in-flight`. What every workflow
shares is the category, which is why an agent that has not read the workflow
reaches for a category word. `in_progress` was refused with nothing to go on;
the refusal now lists what the workflow has, and a category that names exactly
one of its states is read as that state.

Reads only. The writes that use these answers live in `service`.
"""

from __future__ import annotations

import sqlite3

from . import model


def resolve(conn: sqlite3.Connection, workflow_id: str, reference: object) -> sqlite3.Row:
    """The state a caller named: its id, its key, or a category only one state has.

    A key wins over a category. The default workflow has states whose keys are
    category words (`backlog`, `review`, `blocked`, `cancelled`), and a key is
    the more specific name, so `review` is the state keyed `review` even in a
    workflow that gives the category to two states.
    """

    text = model.text_field(reference, "workflow state", limit=64)
    row = conn.execute(
        "SELECT * FROM workflow_states WHERE workflow_id = ? AND (state_id = ? OR key = ?)",
        (workflow_id, text, text),
    ).fetchone()
    if row is not None:
        return row
    states = _ordered(conn, workflow_id)
    if text in model.STATE_CATEGORIES:
        matching = [state for state in states if state["category"] == text]
        if len(matching) == 1:
            return matching[0]
        if matching:
            raise model.PlanningError(
                f"category {text} names {len(matching)} states in this workflow:"
                f" {', '.join(str(state['key']) for state in matching)}; name one by its key"
            )
    raise model.PlanningError(f"this workflow has no state named {text}; {_listing(states)}")


#: The categories work is started from. Coming back to active from review or
#: blocked is not starting it.
STARTABLE = frozenset({"backlog", "queued"})


def start_state(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The state a claim starts this item in, or None when it has nowhere to go.

    The first `active` state in workflow order that the workflow lets the item
    reach from where it stands. The caller decides whether the item is one that
    starts at all; this only answers where it would go.
    """

    found: sqlite3.Row | None = conn.execute(
        "SELECT s.* FROM workflow_states s JOIN workflow_transitions t"
        " ON t.workflow_id = s.workflow_id AND t.to_state_id = s.state_id"
        " WHERE s.workflow_id = ? AND s.category = 'active' AND t.from_state_id = ?"
        " ORDER BY s.position LIMIT 1",
        (row["workflow_id"], row["state_id"]),
    ).fetchone()
    return found


def queue_state(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The state a released item goes back to, or None when it has nowhere to go.

    The first `queued` state in workflow order that the item can reach from
    where it stands, or failing that the first reachable `backlog` state: the
    states the take-next queue takes work from.
    """

    found: sqlite3.Row | None = conn.execute(
        "SELECT s.* FROM workflow_states s JOIN workflow_transitions t"
        " ON t.workflow_id = s.workflow_id AND t.to_state_id = s.state_id"
        " WHERE s.workflow_id = ? AND s.category IN ('queued','backlog') AND t.from_state_id = ?"
        " ORDER BY CASE s.category WHEN 'queued' THEN 0 ELSE 1 END, s.position LIMIT 1",
        (row["workflow_id"], row["state_id"]),
    ).fetchone()
    return found


def cancel_state(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The state a merged item closes in, or None when it has no way to close so.

    The first `cancelled` state in workflow order that the item can reach from
    where it stands: a duplicate is work that is not done, not work that is.
    """

    found: sqlite3.Row | None = conn.execute(
        "SELECT s.* FROM workflow_states s JOIN workflow_transitions t"
        " ON t.workflow_id = s.workflow_id AND t.to_state_id = s.state_id"
        " WHERE s.workflow_id = ? AND s.category = 'cancelled' AND t.from_state_id = ?"
        " ORDER BY s.position LIMIT 1",
        (row["workflow_id"], row["state_id"]),
    ).fetchone()
    return found


def _ordered(conn: sqlite3.Connection, workflow_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM workflow_states WHERE workflow_id = ? ORDER BY position",
            (workflow_id,),
        )
    )


def _listing(states: list[sqlite3.Row]) -> str:
    """Every state as `key (category)`, and the categories that name one state alone."""

    counts: dict[str, int] = {}
    for state in states:
        counts[str(state["category"])] = counts.get(str(state["category"]), 0) + 1
    named = [category for category in model.STATE_CATEGORIES if counts.get(category) == 1]
    listed = ", ".join(f"{state['key']} ({state['category']})" for state in states)
    return (
        f"its states are {listed}; a category names a state when exactly one state has it:"
        f" {', '.join(named) if named else 'none here'}"
    )
