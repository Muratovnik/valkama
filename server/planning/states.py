"""How a caller names a workflow state.

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
