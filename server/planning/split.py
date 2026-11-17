"""Dividing work: actions that change what an item is part of, composed from the service's writes.

An item belongs to a goal or stage, and work outgrows or leaves it. Each action here
is one write of several of the service's own (`service.one_write`), so each keeps the
guards, events and container marks those writes keep, and the goals and stages the
work under them changed come to await confirmation, or stop, once, at its end.
`api` calls these and nothing below the service does (`pyproject.toml` holds the
direction): each takes the item under the write lock first (`service.locked_row`),
decides on it, then writes.

- **Moving out** (`move_out`). An item leaves its goal or stage for the top level
  with a reason: it goes to triage, keeps that it started, loses its claims and its
  basis, and the goal or stage it left records the reason (`child_left`), which its
  `confirmation` part reads. A goal or stage moved out takes the work under it along,
  and becomes a goal. Clearing a parent by an edit is refused, so this is the one
  way out, and the reason is never skipped. Moving an item under another goal or
  stage is an edit (`service.update_work_item`), which records `moved under` on the
  one it left in the same form.

Converting a task into a goal or stage and back, and splitting a part off a task,
belong here too: they divide work the same way, from the same writes.
"""

from __future__ import annotations

import sqlite3

from . import model, read_model, service, states

#: The tag a refusal of moving out carries, as the refusals of its action group read.
MOVE_OUT = "move_out"


def move_out(
    conn: sqlite3.Connection,
    reference: str,
    *,
    reason: object,
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    """Take an item out of its goal or stage, with the reason it leaves.

    The item goes to the top level and to the first triage state its workflow reaches
    (where it stands, when it is in triage already), with the history reason `moved
    out of MAIN-3: <reason>`: it keeps `started_at`, and the move ends its claims and
    takes its basis away. The goal or stage it left records `child_left` with the
    detail `MAIN-12: <reason>`. Refused, with nothing written, without a reason,
    without a parent, for a closed item, for an item whose workflow reaches no triage
    state, and for an item another session holds unless `force`, which is recorded
    as `overridden`. The answer is the item, with `moved_out: {from, reason}` and
    what the move to triage says: `released`, `warnings`, `overridden`, and
    `awaiting_confirmation` for the goals and stages it left waiting.
    """

    with service.one_write(conn) as entered:
        row = service.locked_row(conn, reference, expected_revision)
        item = read_model.reference(conn, row)
        if row["parent_id"] is None:
            raise model.PlanningError(
                f"[{MOVE_OUT}] {item} stands under no goal or stage: there is nothing to move"
                " it out of"
            )
        current = read_model.state_by_id(conn, str(row["state_id"]))
        if current["is_terminal"]:
            raise model.PlanningError(f"[{MOVE_OUT}] {item} is closed: reopen it first")
        left = read_model.reference(conn, read_model.item_by_id(conn, str(row["parent_id"])))
        target = (
            current if current["category"] == "triage" else states.reachable(conn, row, "triage")
        )
        if target is None:
            raise model.PlanningError(
                f"[{MOVE_OUT}] {item} cannot move from {current['name']} to a triage state:"
                " its workflow has no such transition"
            )
        said = _reason(reason, item=item, left=left, key=str(target["key"]))
        overridden = service.held_elsewhere(conn, [row], author, force, doing="move it out")
        identity = str(row["work_item_id"])
        moved = service.move_to_triage(
            conn,
            identity,
            str(target["state_id"]),
            reason=f"moved out of {left}: {said}",
            author=author,
        )
        service.take_out(conn, identity, said, author)
        if overridden:
            service.record_overrides(conn, identity, ["claim"], author)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["moved_out"] = {"from": left, "reason": said}
    for name in ("released", "warnings"):
        if moved.get(name):
            answer[name] = moved[name]
    if overridden:
        answer["overridden"] = ["claim"]
    if entered:
        answer["awaiting_confirmation"] = entered
    return answer


def _reason(reason: object, *, item: str, left: str, key: str) -> str:
    """The reason an item leaves `left` for, sized to the two events that record it.

    The item's transition reads `<key>: moved out of MAIN-3: <reason>` and the goal's or
    stage's `child_left` reads `MAIN-12: <reason>`, so the reason uses only what the
    longer of the two leaves of an event's detail.
    """

    if not isinstance(reason, str) or not reason.strip():
        raise model.PlanningError(
            f"[{MOVE_OUT}] {item} leaves {left} with a reason, which {left} records: send reason"
        )
    room = service.EVENT_DETAIL_LIMIT - max(len(f"{key}: moved out of {left}: "), len(f"{item}: "))
    return model.text_field(reason.strip(), "reason", limit=room)
