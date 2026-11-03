"""What a state change is allowed to claim, and what it may only warn about.

One choke point, so a drag in Kanban, a row action in List and an MCP call
cannot end up with three different rules. The guards are written against a
state's *category*, never its name: an installation that renames Dev to
`In flight` keeps the same refusals, and one that adds a second active state
gets them for free.

A refusal names its guard. `force` carries a move through and is recorded as an
override, so overriding is a decision on the record rather than a workaround.
"""

from __future__ import annotations

import sqlite3

from . import calls, leases, model, person_events, states

Finding = tuple[str, str]


def findings(
    conn: sqlite3.Connection,
    item: sqlite3.Row,
    target: sqlite3.Row,
    *,
    reason: str = "",
) -> tuple[list[Finding], list[str]]:
    """Hard refusals and soft warnings for moving `item` to `target` state."""

    current = conn.execute(
        "SELECT * FROM workflow_states WHERE state_id = ?", (item["state_id"],)
    ).fetchone()
    if current is None:
        raise model.PlanningError("this work item points at a state its workflow does not have")
    if current["workflow_id"] != target["workflow_id"]:
        raise model.PlanningError("a work item cannot move into another workflow's state")

    refusals: list[Finding] = []
    warnings: list[str] = []
    reference = model.human_id(_space_key(conn, item["planning_space_id"]), int(item["number"]))
    checklist = model.checklist(item["checklist"])

    if current["state_id"] != target["state_id"]:
        permitted = conn.execute(
            "SELECT 1 FROM workflow_transitions WHERE workflow_id = ? AND from_state_id = ?"
            " AND to_state_id = ? LIMIT 1",
            (target["workflow_id"], current["state_id"], target["state_id"]),
        ).fetchone()
        if permitted is None:
            refusals.append(
                (
                    "transition",
                    f"{reference} cannot move from {current['name']} to {target['name']}:"
                    " the workflow has no such transition",
                )
            )

    entering = (
        current["category"] != target["category"] or current["state_id"] != target["state_id"]
    )
    if target["category"] == "active" and current["category"] in states.STARTABLE:
        claimed_step = any(step["claimed_by"] for step in checklist)
        if not item["claim_ref"] and not claimed_step:
            refusals.append(
                (
                    "executor",
                    f"{reference} has no executor: claim the item or claim one of its"
                    " checklist steps before starting it",
                )
            )
        warning = _lease_warning(conn, item, reference)
        if warning:
            warnings.append(warning)
    if target["category"] == "review" and entering:
        # A confirmed write names its session as well as a session ref does, and
        # agents no longer attach one by hand now that Valkama records it.
        evidence = (
            conn.execute(
                "SELECT 1 FROM work_item_refs WHERE work_item_id = ?"
                " AND kind IN ('session','commit') LIMIT 1",
                (item["work_item_id"],),
            ).fetchone()
            or conn.execute(
                "SELECT 1 FROM execution_events WHERE work_item_id = ? AND kind = 'planning_write'"
                " AND identity_state = 'confirmed' AND COALESCE(session_id, '') <> '' LIMIT 1",
                (item["work_item_id"],),
            ).fetchone()
        )
        if evidence is None:
            warnings.append(f"{reference} enters {target['name']} with no session or commit ref")
    if target["is_terminal"] and entering:
        # Cancelled work closes with the steps it never did still open: ticking
        # them would claim work that did not happen. The summary still has to
        # say why it stopped.
        open_steps = [step for step in checklist if not step["done"]]
        if open_steps and target["category"] != "cancelled":
            refusals.append(
                (
                    "checklist",
                    f"{reference} has {len(open_steps)} open checklist step(s); tick or"
                    " reopen them honestly before closing it",
                )
            )
        if not item["summary"]:
            refusals.append(
                (
                    "summary",
                    f"{reference} has no closing summary; record what was done and what"
                    " comes next before closing it",
                )
            )
        spoke = person_spoke(conn, item, reference)
        if spoke:
            refusals.append(("person_spoke", spoke))
    if target["category"] == "blocked" and entering:
        blocker = conn.execute(
            "SELECT 1 FROM work_item_links l"
            " JOIN work_items i ON i.work_item_id = l.from_id"
            " JOIN workflow_states s ON s.state_id = i.state_id"
            " WHERE l.to_id = ? AND l.kind = 'blocks' AND s.is_terminal = 0 LIMIT 1",
            (item["work_item_id"],),
        ).fetchone()
        if blocker is None and not reason.strip():
            refusals.append(
                (
                    "blocker",
                    f"{reference} cannot be blocked without a cause: link the blocking"
                    " item, or state a reason for an external blocker",
                )
            )
    return refusals, warnings


def person_spoke(conn: sqlite3.Connection, item: sqlite3.Row, reference: str) -> str:
    """What a person did that the agent closing this item has not been told.

    Only an agent answers to this: a person closes as they see fit, and the runner
    is not deciding anything. What this call itself wrote is left out, so a batch's
    comment does not clear the way for its own transition.
    """

    if not calls.from_agent():
        return ""
    own = calls.written(conn)
    events = person_events.since_last_agent_write(
        conn, str(item["work_item_id"]), own_call=None if own is None else own[0]
    )
    if not events:
        return ""
    return (
        f"a person acted on {reference} through the interface since an agent last wrote to it:"
        f" {person_events.describe(events)}. Read the item with get_work_item and take that"
        " into account; once you have written what you did about it, close again, or pass"
        " force to close over it"
    )


def _lease_warning(conn: sqlite3.Connection, item: sqlite3.Row, reference: str) -> str:
    """What to say when the executor the guard accepted may not be there.

    A claim still counts as an executor: refusing an unconfirmed one would
    refuse every claim made before identity existed and every client without
    it. A claim the owner took in the browser needs no such remark.
    """

    lease = leases.lease(conn, item)
    if lease is None or lease.source == calls.BROWSER:
        return ""
    if lease.state == leases.UNCONFIRMED:
        return f"{reference} starts under a claim by {lease.holder} that no session confirmed"
    if lease.state == leases.STALE:
        return f"{reference} starts under a stale claim by {lease.holder}: its session is gone"
    return ""


def _space_key(conn: sqlite3.Connection, planning_space_id: str) -> str:
    row = conn.execute(
        "SELECT key FROM planning_spaces WHERE planning_space_id = ?", (planning_space_id,)
    ).fetchone()
    if row is None:
        raise model.PlanningError("planning space does not exist")
    return str(row[0])
