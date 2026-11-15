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
from collections.abc import Mapping

from . import model


def resolve(conn: sqlite3.Connection, workflow_id: str, reference: object) -> sqlite3.Row:
    """The state a caller named: its id, its key, or a category only one state has.

    A key wins over a category. The default workflow has states whose keys are
    category words (`triage`, `ready`, `review`, `blocked`, `cancelled`), and a key
    is the more specific name, so `review` is the state keyed `review` even in a
    workflow that gives the category to two states.

    Only a state of the eight categories answers. The service state is not one a
    caller names, by id, key or category: `container` is refused with the word that
    replaces it, and its id is a state this workflow does not list.
    """

    text = model.text_field(reference, "workflow state", limit=64)
    model.refuse_retired(text)
    row = conn.execute(
        "SELECT * FROM workflow_states WHERE workflow_id = ? AND (state_id = ? OR key = ?)"
        " AND category != ?",
        (workflow_id, text, text, model.SERVICE_CATEGORY),
    ).fetchone()
    if row is not None:
        return row
    states = public_states(conn, workflow_id)
    if text in model.PUBLIC_CATEGORIES:
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
STARTABLE = frozenset({"triage", "deferred", "ready"})


def reachable(conn: sqlite3.Connection, row: sqlite3.Row, category: str) -> sqlite3.Row | None:
    """The state of `category` the server puts this item in, or None when it has none.

    The first state of that category in workflow order that the workflow lets the
    item reach from where it stands: the one rule for every state the server
    chooses rather than the caller names.
    """

    found: sqlite3.Row | None = conn.execute(
        "SELECT s.* FROM workflow_states s JOIN workflow_transitions t"
        " ON t.workflow_id = s.workflow_id AND t.to_state_id = s.state_id"
        " WHERE s.workflow_id = ? AND s.category = ? AND t.from_state_id = ?"
        " ORDER BY s.position LIMIT 1",
        (row["workflow_id"], category, row["state_id"]),
    ).fetchone()
    return found


def start_state(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The state a claim starts this item in: the first `active` one it can reach.

    The caller decides whether the item is one that starts at all; this only
    answers where it would go.
    """

    return reachable(conn, row, "active")


def queue_state(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The state a task nobody holds any more goes back to: the first `ready` it can reach.

    Never a triage one instead: going back there would take its acceptance away
    unseen, so a workflow with no ready state to reach leaves the item where it is.
    """

    return reachable(conn, row, "ready")


def cancel_state(conn: sqlite3.Connection, row: sqlite3.Row) -> sqlite3.Row | None:
    """The state a merged item closes in: the first `cancelled` one it can reach.

    A duplicate is work that is not done, not work that is.
    """

    return reachable(conn, row, "cancelled")


def first_state(conn: sqlite3.Connection, workflow_id: str, category: str) -> sqlite3.Row | None:
    """The first state of `category` in workflow order, where a new item of it is placed."""

    found: sqlite3.Row | None = conn.execute(
        "SELECT * FROM workflow_states WHERE workflow_id = ? AND category = ?"
        " ORDER BY position LIMIT 1",
        (workflow_id, category),
    ).fetchone()
    return found


def public_state(state: Mapping[str, object] | sqlite3.Row) -> dict | None:
    """A state as a reader sees it: its key, name, category and whether work is over in it.

    The one way a workflow state leaves the server. It takes a `workflow_states` row,
    or the `key`, `name`, `category` and `is_terminal` of one read beside an item,
    and answers None for the service state: an accepted open container shows no
    state of its own but the one it derives, `container_state`.
    """

    if state["category"] == model.SERVICE_CATEGORY:
        return None
    return {
        "key": state["key"],
        "name": state["name"],
        "category": state["category"],
        "is_terminal": bool(state["is_terminal"]),
    }


def public_states(conn: sqlite3.Connection, workflow_id: str) -> list[sqlite3.Row]:
    """The states of a workflow a caller sees and names, in workflow order.

    Every state but the service one: a list of states, a refusal's listing and the
    workflow's description read this, so none of them shows where an accepted open
    container stands.
    """

    return list(
        conn.execute(
            "SELECT * FROM workflow_states WHERE workflow_id = ? AND category != ?"
            " ORDER BY position",
            (workflow_id, model.SERVICE_CATEGORY),
        )
    )


def _listing(states: list[sqlite3.Row]) -> str:
    """Every state as `key (category)`, and the categories that name one state alone."""

    counts: dict[str, int] = {}
    for state in states:
        counts[str(state["category"])] = counts.get(str(state["category"]), 0) + 1
    named = [category for category in model.PUBLIC_CATEGORIES if counts.get(category) == 1]
    listed = ", ".join(f"{state['key']} ({state['category']})" for state in states)
    return (
        f"its states are {listed}; a category names a state when exactly one state has it:"
        f" {', '.join(named) if named else 'none here'}"
    )
