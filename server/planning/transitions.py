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
from collections.abc import Callable

from . import model

# Categories an item may be started from. Coming back to active from review or
# blocked is not "starting" it, so it does not need an executor again.
_STARTABLE = frozenset({"backlog", "queued"})

Finding = tuple[str, str]

# What Improvements needs to say about closing an item raised from a case. It is
# passed in rather than imported: Planning owns the choke point, not the policy
# of another module, and a Planning test should not need an Improvements store.
ImprovementGuard = Callable[[str, str], dict | None]


def findings(
    conn: sqlite3.Connection,
    item: sqlite3.Row,
    target: sqlite3.Row,
    *,
    reason: str = "",
    improvement_guard: ImprovementGuard | None = None,
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
    if target["category"] == "active" and current["category"] in _STARTABLE:
        claimed_step = any(step["claimed_by"] for step in checklist)
        if not item["claim_ref"] and not claimed_step:
            refusals.append(
                (
                    "executor",
                    f"{reference} has no executor: claim the item or claim one of its"
                    " checklist steps before starting it",
                )
            )
    if target["category"] == "review" and entering:
        evidence = conn.execute(
            "SELECT 1 FROM work_item_refs WHERE work_item_id = ?"
            " AND kind IN ('session','commit') LIMIT 1",
            (item["work_item_id"],),
        ).fetchone()
        if evidence is None:
            warnings.append(f"{reference} enters {target['name']} with no session or commit ref")
    if target["is_terminal"] and entering:
        open_steps = [step for step in checklist if not step["done"]]
        if open_steps:
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
        source = str(item["source"] or "")
        if improvement_guard is not None and source.startswith("improvement://"):
            verdict = improvement_guard(source, str(item["summary"] or ""))
            if verdict is not None and not verdict.get("allowed"):
                refusals.append(
                    (
                        str(verdict.get("guard") or "improvement_eval"),
                        str(verdict.get("message") or "Improvement evaluation is incomplete"),
                    )
                )
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


def _space_key(conn: sqlite3.Connection, planning_space_id: str) -> str:
    row = conn.execute(
        "SELECT key FROM planning_spaces WHERE planning_space_id = ?", (planning_space_id,)
    ).fetchone()
    if row is None:
        raise model.PlanningError("planning space does not exist")
    return str(row[0])
