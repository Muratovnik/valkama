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
from collections.abc import Mapping

from . import calls, leases, model, person_events

Finding = tuple[str, str]

#: The guards `force` does not carry: past them the store would hold what the work
#: model has no place for — a container at work, accepted work with no basis, a
#: task at work with nobody holding it, or a deferral with no condition to end it.
UNFORCED = frozenset({"goal_or_stage", "container_state", "deferred", "acceptance", "executor"})


def refuse(refusals: list[Finding], force: bool) -> None:
    """Refuse a write its findings stop: any of them without `force`, an unforced one with it."""

    if any(guard in UNFORCED for guard, _ in refusals) or (refusals and not force):
        raise model.WorkflowGuardError(
            "; ".join(f"[{guard}] {message}" for guard, message in refusals)
        )


def placement(
    item: Mapping[str, object] | sqlite3.Row,
    current: sqlite3.Row | None,
    target: sqlite3.Row,
    *,
    reference: str,
    basis: object,
) -> list[Finding]:
    """What the work model refuses of an item standing in `target`, coming from `current`.

    `current` is None for an item being created. `basis` is the acceptance the item
    has or the write gives it. These refusals hold however the item gets there —
    created, moved or started by a claim — and none of them is forced.
    """

    found: list[Finding] = []
    container = item["kind"] == model.CONTAINER_KIND
    category = str(target["category"])
    was = None if current is None else str(current["category"])
    if container and category in model.TASK_ONLY_CATEGORIES:
        found.append(
            (
                "goal_or_stage",
                f"{reference} is a goal or stage: nobody works one, so it never stands in"
                f" {target['name']}; accept it with ready, and work the tasks under it",
            )
        )
    if category == "deferred" and was != "deferred":
        found.append(
            (
                "deferred",
                f"{reference} is deferred by the deferral action, with the condition it"
                " comes back on, not by a move",
            )
        )
    if container and category == "triage" and was == model.SERVICE_CATEGORY:
        found.append(
            (
                "container_state",
                f"{reference} is an accepted goal or stage: it is closed or cancelled,"
                " never put back in triage",
            )
        )
    if container and category == "completed" and was in (None, *model.UNACCEPTED_CATEGORIES):
        found.append(
            (
                "container_state",
                f"{reference} was never accepted: work that is not to be done is cancelled,"
                " not completed",
            )
        )
    if category in model.ACCEPTED_CATEGORIES and not basis:
        found.append(
            (
                "acceptance",
                f"{reference} is not accepted: pass acceptance {model.NAMED_BASIS} for work"
                " you were asked to do, or leave it to the owner to accept",
            )
        )
    return found


def findings(
    conn: sqlite3.Connection,
    item: sqlite3.Row,
    target: sqlite3.Row,
    *,
    reason: str = "",
    basis: object = None,
    held: bool | None = None,
) -> tuple[list[Finding], list[str]]:
    """Hard refusals and soft warnings for moving `item` to `target` state.

    `basis` is the acceptance the item has or the move gives it. `held` says
    whether a holder stands on the item after the write, for a write that takes
    the claim itself; left out, it is read from the item.
    """

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
    refusals += placement(item, current, target, reference=reference, basis=basis)
    if (
        target["category"] == "active"
        and current["category"] != "active"
        and item["kind"] != model.CONTAINER_KIND
    ):
        # Coming in from anywhere else, a task at work has a holder after the write: a
        # claim this write takes, or one it already has, as a blocked task keeps it.
        if held is None:
            held = bool(item["claim_ref"]) or any(step["claimed_by"] for step in checklist)
        if not held:
            refusals.append(
                (
                    "executor",
                    f"{reference} has no executor: claim the item or claim one of its"
                    " checklist steps before starting it",
                )
            )
        warning = lease_warning(conn, item, reference)
        if warning:
            warnings.append(warning)
    if target["category"] == "review" and entering:
        # A confirmed write names its session as well as a session ref does, and
        # agents no longer attach one by hand now that Valkama records it. A commit
        # counts while it is attached as the card shows it, not rewritten.
        evidence = (
            conn.execute(
                "SELECT 1 FROM work_item_refs WHERE work_item_id = ? AND kind = 'session'"
                " UNION ALL SELECT 1 FROM work_item_commits a"
                " JOIN commits c ON c.commit_id = a.commit_id"
                " WHERE a.work_item_id = ? AND c.rewritten_to IS NULL LIMIT 1",
                (item["work_item_id"], item["work_item_id"]),
            ).fetchone()
            or conn.execute(
                "SELECT 1 FROM execution_events WHERE work_item_id = ? AND kind = 'planning_write'"
                " AND identity_state = 'confirmed' AND COALESCE(session_id, '') <> '' LIMIT 1",
                (item["work_item_id"],),
            ).fetchone()
        )
        if evidence is None:
            warnings.append(
                f"{reference} enters {target['name']} with no session ref or attached commit"
            )
    if target["category"] in ("review", "completed") and entering:
        unconfirmed = previous_holder(reference, checklist)
        if unconfirmed:
            refusals.append(("previous_holder", unconfirmed))
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


def previous_holder(reference: str, checklist: list[dict]) -> str:
    """What stops review or a close while a lapsed holder's ticks wait for confirmation.

    Nobody stands behind a tick whose holder's lease lapsed, so a fresh tick
    confirms the work it claims before that work is offered as done. A cancelled
    close claims nothing, so it is not asked.
    """

    flagged = sum(1 for step in checklist if step["done"] and step[model.PREVIOUS_HOLDER])
    if not flagged:
        return ""
    return (
        f"{reference} has {flagged} step(s) ticked by a holder whose lease lapsed:"
        " tick them again to confirm them, or reopen them"
    )


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


def lease_warning(conn: sqlite3.Connection, item: sqlite3.Row, reference: str) -> str:
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
