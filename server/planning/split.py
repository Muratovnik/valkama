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
- **Converting** (`convert`). A task becomes a goal or stage, the word its place
  gives, and one with nothing under it becomes a task again. It keeps its number,
  text, discussion, history, links, questions, subscribers, refs, steps and the
  wait it was put off on; its claims end, and every session that held it follows it.
  A held task leaves its work at hand in a new task under it, with the same holders
  and claims, started as it was and with its projects: work under way is never
  stranded by a container nobody holds.

- **Splitting a part off** (`split_off`). A new item takes some of an open task's
  steps and stands beside it, under the same parent: it is the same work, so it is
  accepted as the task is, put off when it is, and names its projects. The steps go
  with their ids, ticks and marks and without their claims; the task records
  `split_off`, the part `split_from`.
"""

from __future__ import annotations

import dataclasses
import json
import sqlite3
from collections.abc import Mapping

from . import (
    calls,
    deferral,
    item_projects,
    item_tree,
    model,
    read_model,
    service,
    states,
    subscriptions,
    words,
)
from . import transitions as guards

#: The tag a refusal of moving out carries, as the refusals of its action group read.
MOVE_OUT = "move_out"
#: The tag a refusal of converting carries.
CONVERT = "convert"
#: The tag a refusal of splitting a part off carries.
SPLIT = "split"
#: What the task a part is split off sets for the part, and a creation that splits names
#: none of.
_SET_BY_SOURCE = ("parent", "state", "acceptance")
#: What a goal or stage made a task records as the move into its ready state, and an
#: accepted task made a goal or stage as its opening: `converted from a stage`.
_FROM = "converted from a {}"


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


def convert(
    conn: sqlite3.Connection,
    reference: str,
    *,
    to: object,
    leftover: object = None,
    force: bool = False,
    expected_revision: int | None = None,
    author: str | None = None,
) -> dict:
    """Turn a task into a goal or stage, or a goal or stage with nothing under it into a task.

    `to` is the word the item's place gives a task, `stage` under a parent and `goal`
    without one, or `task`, `bug` or `improvement` for a goal or stage. Everything the
    item has stays on it; a bug or improvement made a goal or stage keeps its kind as
    a label. A task accepted and open comes to stand in the service state (`opened`),
    and a goal or stage accepted and open in the first ready state (`transitioned`),
    keeping its basis; one in triage or deferred stays there. Its claims end.

    A task held, by its claim or a claim of a step, leaves the work at hand in a new
    task under it (`service.file_leftover`): its holder and every claimed step go
    there with their claims, with the steps `leftover.steps` names, under
    `leftover.title` or its own title; it stands in the first active state, or
    blocked for the reason the task was, started as the task was, `inherited` under
    goals and stages all accepted, and takes the task's projects. A task nobody holds
    leaves one only when `leftover` is sent, in the first ready state, or triage under
    a goal or stage not accepted; without one its projects are dropped, since a goal or
    stage names none. The top-level session of each holder follows the converted item.

    Refused, with nothing written, for another word (`[convert]`, naming the one that
    passes), a closed item, one in review, a goal or stage with anything under it, a
    step `leftover` does not find, an agent's conversion over a question to the owner
    open on the item (`question`, which `force` does not carry), and for an item
    another session holds unless `force`, recorded as `overridden`. The answer is the
    item with `converted: {from, to, leftover, projects_dropped}`, `released`,
    `overridden` and `awaiting_confirmation`.
    """

    with service.one_write(conn) as entered:
        row = service.locked_row(conn, reference, expected_revision)
        item = read_model.reference(conn, row)
        identity = str(row["work_item_id"])
        current = read_model.state_by_id(conn, str(row["state_id"]))
        was = model.outward_kind(row["kind"], row["parent_id"])
        word = _word(conn, row, to, item=item, was=was)
        if current["is_terminal"]:
            raise model.PlanningError(f"[{CONVERT}] {item} is closed: reopen it first")
        if current["category"] == guards.REVIEW:
            raise model.PlanningError(
                f"[{CONVERT}] {item} is in review: the owner's answer decides it first"
            )
        plan: _Plan | None = None
        if row["kind"] == model.CONTAINER_KIND:
            _nothing_under(conn, row, leftover, item=item)
        else:
            plan = _Plan.of(row, current, leftover, item=item, was=was)
        target = _target(conn, row, current, item=item)
        asked = guards.converting_question(conn, row, item)
        guards.refuse([("question", asked)] if asked else [], False)
        overridden = service.held_elsewhere(conn, [row], author, force, doing="convert it")
        reformed = service.reform(
            conn,
            row,
            kind=model.work_item_kind(word),
            state=target,
            reason=_FROM.format(was),
            steps=model.checklist(row["checklist"]) if plan is None else plan.kept,
            labels=model.labels(json.loads(str(row["labels"]))) if plan is None else plan.labels,
            author=author,
        )
        left, dropped = (None, []) if plan is None else plan.leave(conn, row, author)
        detail = f"{was} -> {word}"
        if left is not None:
            detail += f"; leftover {left}"
        if dropped:
            detail += f"; projects dropped: {_listed(dropped, len(detail))}"
        service.log_converted(conn, identity, detail, author)
        if overridden:
            service.record_overrides(conn, identity, ["claim"], author)
        words.bring_current(conn)
    answer = read_model.present(conn, read_model.item_by_id(conn, identity), full=True)
    answer["converted"] = {"from": was, "to": word, "leftover": left, "projects_dropped": dropped}
    if reformed.get("released"):
        answer["released"] = reformed["released"]
    if overridden:
        answer["overridden"] = ["claim"]
    if entered:
        answer["awaiting_confirmation"] = entered
    return answer


def _word(conn: sqlite3.Connection, row: sqlite3.Row, to: object, *, item: str, was: str) -> str:
    """The kind `to` names, refused with the word that passes where it is not that one."""

    if row["kind"] == model.CONTAINER_KIND:
        if isinstance(to, str) and to in model.TASK_KINDS:
            return to
        raise model.PlanningError(
            f"[{CONVERT}] {item} is a {was}: it becomes a task with convert {{to: task}}, or"
            " bug or improvement, and goal or stage follows from its place"
        )
    expected = "stage" if row["parent_id"] else "goal"
    if to == expected:
        return expected
    if row["parent_id"]:
        parent = read_model.item_by_id(conn, str(row["parent_id"]))
        place = f"stands under {read_model.reference(conn, parent)}"
    else:
        place = "stands under no goal or stage"
    raise model.PlanningError(
        f"[{CONVERT}] {item} {place}, so it becomes a {expected}: send convert"
        f" {{to: {expected}}}; an edit changes kind among task, bug and improvement"
    )


def _nothing_under(
    conn: sqlite3.Connection, row: sqlite3.Row, leftover: object, *, item: str
) -> None:
    """Refuse to make a goal or stage a task while anything stands under it, or with a leftover.

    A child that left it does not stand under it any more, and does not count.
    """

    if leftover is not None:
        raise model.PlanningError(
            f"[{CONVERT}] {item} is a goal or stage, which leaves no work of its own: send"
            " leftover only to convert a task"
        )
    under = conn.execute(
        "SELECT COUNT(*) FROM work_items WHERE parent_id = ?", (str(row["work_item_id"]),)
    ).fetchone()[0]
    if under:
        raise model.PlanningError(
            f"[{CONVERT}] {item} has {under} item(s) under it, and a task holds none: move"
            " them out or under another goal or stage first"
        )


def _target(
    conn: sqlite3.Connection, row: sqlite3.Row, current: sqlite3.Row, *, item: str
) -> sqlite3.Row | None:
    """Where the converted item stands, or None where it stays: in triage or deferred.

    Accepted and open, a task made a goal or stage stands in the service state, and a
    goal or stage made a task in the first ready state, each keeping its basis.
    """

    if current["category"] in model.UNACCEPTED_CATEGORIES:
        return None
    container = row["kind"] == model.CONTAINER_KIND
    category = "ready" if container else model.SERVICE_CATEGORY
    found = states.first_state(conn, str(row["workflow_id"]), category)
    if found is None:
        raise model.PlanningError(
            f"[{CONVERT}] {item} has nowhere to stand once converted: its workflow has no"
            f" {'ready' if container else 'goal or stage'} state"
        )
    return found


@dataclasses.dataclass(frozen=True)
class _Plan:
    """What converting a task leaves: the steps it keeps and the new task's, read up front.

    `wanted` says the caller sent `leftover`, which files the new task even when
    nobody held the converted one.
    """

    current: sqlite3.Row
    title: str
    kept: list[dict]
    moved: list[dict]
    labels: list[str]
    wanted: bool

    @classmethod
    def of(
        cls, row: sqlite3.Row, current: sqlite3.Row, leftover: object, *, item: str, was: str
    ) -> _Plan:
        """Read `leftover` against the task, refused before anything is written.

        A claimed step always goes to the new task with its claim: it is work under
        way, and a goal or stage is held by nobody.
        """

        title, named = _leftover(leftover, row, item=item)
        steps = model.checklist(row["checklist"])
        moving = {step["id"] for step in steps if step["claimed_by"] or step["id"] in named}
        labels = model.labels(json.loads(str(row["labels"])))
        if was in ("bug", "improvement") and was not in labels:
            # The kind a goal or stage cannot have stays with it as a label.
            labels = model.labels([*labels, was])
        return cls(
            current=current,
            title=title,
            kept=[step for step in steps if step["id"] not in moving],
            moved=[step for step in steps if step["id"] in moving],
            labels=labels,
            wanted=leftover is not None,
        )

    def leave(
        self, conn: sqlite3.Connection, row: sqlite3.Row, author: str | None
    ) -> tuple[str | None, list[str]]:
        """File the new task, or drop the projects nothing takes: its reference, the dropped.

        The top-level session of each holder follows the converted item first: the
        conversation that leads the work hears its goal or stage.
        """

        identity = str(row["work_item_id"])
        holders = [str(row["claim_ref"])] if row["claim_ref"] else []
        holders += [str(step["claimed_by"]) for step in self.moved if step["claimed_by"]]
        for session in dict.fromkeys(
            found[0] for found in map(calls.holder_ids, holders) if found is not None
        ):
            subscriptions.follow(conn, identity, session)
        if not holders and not self.wanted:
            return None, item_projects.drop(conn, identity)
        reason = ""
        state: sqlite3.Row | None
        if holders and self.current["category"] == "blocked":
            state, reason = self.current, _blocked_for(conn, identity)
        elif holders:
            state = states.first_state(conn, str(row["workflow_id"]), "active")
        else:
            accepted = self.current["category"] not in model.UNACCEPTED_CATEGORIES
            state = states.first_state(
                conn, str(row["workflow_id"]), "ready" if accepted else "triage"
            )
        if state is None:
            raise model.PlanningError(
                f"[{CONVERT}] {read_model.reference(conn, row)} leaves work its workflow has"
                " no state for"
            )
        basis = None
        if state["category"] in model.ACCEPTED_CATEGORIES:
            basis = "inherited" if item_tree.accepted_chain(conn, identity) else row["acceptance"]
        left = service.file_leftover(
            conn,
            row,
            title=self.title,
            steps=self.moved,
            state=state,
            basis=basis,
            holder=bool(row["claim_ref"]),
            reason=reason,
            author=author,
        )
        return left, []


def _leftover(leftover: object, row: sqlite3.Row, *, item: str) -> tuple[str, set[str]]:
    """The new task's title and the ids of the steps `leftover` names for it."""

    if leftover is None:
        return str(row["title"]), set()
    if not isinstance(leftover, Mapping):
        raise model.PlanningError(f"[{CONVERT}] leftover is an object: {{title?, steps?}}")
    unknown = sorted(set(leftover) - {"title", "steps"})
    if unknown:
        raise model.PlanningError(
            f"[{CONVERT}] leftover: unknown field(s) {', '.join(unknown)}; expected steps, title"
        )
    given = leftover.get("title")
    title = str(row["title"]) if given is None else model.text_field(given, "leftover.title")
    named = leftover.get("steps", [])
    if not isinstance(named, list) or not all(isinstance(entry, str) for entry in named):
        raise model.PlanningError(f"[{CONVERT}] leftover.steps is a list of step ids")
    ids = {str(step["id"]) for step in model.checklist(row["checklist"])}
    for wanted in named:
        if wanted not in ids:
            raise model.PlanningError(f"[{CONVERT}] {item} has no step {wanted}")
    return title, set(named)


def split_off(
    conn: sqlite3.Connection,
    reference: object,
    *,
    steps: object,
    title: object,
    kind: object = None,
    priority: object = None,
    description: object = None,
    labels: object = None,
    source: object = None,
    projects: object = None,
    set_by_source: Mapping[str, object] | None = None,
    force: bool = False,
    author: str | None = None,
) -> dict:
    """Split a part off an open task: a new item beside it, with the steps `steps` names.

    The part stands under the task's parent and is accepted with it: a task accepted
    gives it the first ready state, `inherited` under goals and stages all accepted and
    open and the task's own basis otherwise; one in triage gives it triage, and one put
    off puts it off on the same condition. The steps go with their ids, ticks, `done_by`
    and `by_previous_holder`, each claim on one ending on the task (`checklist_released`).
    It names `projects`, or the task's projects, each `named`; its kind and priority
    are the task's unless named. The task records `split_off`, `MAIN-15: 2 steps`, and
    the part `split_from`, the task's reference.

    `set_by_source` is what the caller sent of `parent`, `state` and `acceptance`, which
    the task sets: any of them is refused, as is a closed task, a goal or stage, one in
    review, whose steps the owner is checking, a step the task does not have, and a task
    another session holds unless `force`, recorded on the task as `overridden`. A question
    to the owner on the task does not stop it: the task stays open with it. The answer
    is the part, with `split_from`, `moved_steps` (the ids it took), `overridden` and
    `awaiting_confirmation`.
    """

    with service.one_write(conn) as entered:
        row = service.locked_row(conn, reference)
        item = read_model.reference(conn, row)
        identity = str(row["work_item_id"])
        sent = [
            name for name in _SET_BY_SOURCE if (set_by_source or {}).get(name) not in (None, "")
        ]
        if sent:
            raise model.PlanningError(
                f"[{SPLIT}] a part stands beside {item} and is accepted as it is: send no"
                f" {', '.join(sent)}"
            )
        current = read_model.state_by_id(conn, str(row["state_id"]))
        if row["kind"] == model.CONTAINER_KIND:
            raise model.PlanningError(
                f"[{SPLIT}] {item} is a goal or stage: a part is split off a task, and work"
                " for a goal or stage is filed under it with parent"
            )
        if current["is_terminal"]:
            raise model.PlanningError(f"[{SPLIT}] {item} is closed: reopen it first")
        if current["category"] == guards.REVIEW:
            raise model.PlanningError(
                f"[{SPLIT}] {item} is in review, where the owner checks its steps: split it"
                " once the answer returns it"
            )
        moved = _taken(row, steps, item=item)
        state, basis, held = _part_place(conn, row, current, item=item)
        named = item_projects.named(projects)
        if named is not None:
            item_projects.require_nameable(named, container=False)
        part_kind = model.public_kind(row["kind"] if kind is None else kind)
        if part_kind not in model.TASK_KINDS:
            raise model.PlanningError(
                f"[{SPLIT}] a part is a task, bug or improvement, as the work it was part of"
            )
        part = service.Part(
            title=model.text_field(title, "work_item.title"),
            kind=part_kind,
            priority=model.priority(row["priority"] if priority is None else priority),
            description=model.multiline_field(description or "", "work_item.description"),
            labels=model.labels(labels),
            source=model.text_field(source or "", "work_item.source", limit=512, required=False),
            projects=(
                sorted(item_projects.ids_of_items(conn, [identity])[identity])
                if named is None
                else named
            ),
            steps=moved,
            state=state,
            basis=basis,
            deferred=held,
        )
        overridden = service.held_elsewhere(conn, [row], author, force, doing="split a part off it")
        made = service.file_part(conn, row, part, author)
        service.hand_over_steps(conn, row, moved, made, author)
        if overridden:
            service.record_overrides(conn, identity, ["claim"], author)
        words.bring_current(conn)
    answer = read_model.present(conn, read_model.item_row(conn, made), full=True)
    answer["split_from"] = item
    answer["moved_steps"] = [str(step["id"]) for step in moved]
    if overridden:
        answer["overridden"] = ["claim"]
    if entered:
        answer["awaiting_confirmation"] = entered
    return answer


def _taken(row: sqlite3.Row, steps: object, *, item: str) -> list[dict]:
    """The task's steps `steps` names, in the task's order, each without its claim."""

    named = [] if steps is None else steps
    if not isinstance(named, list) or not all(isinstance(entry, str) for entry in named):
        raise model.PlanningError(f"[{SPLIT}] steps is a list of the ids of {item}'s steps")
    own = model.checklist(row["checklist"])
    ids = {str(step["id"]) for step in own}
    for wanted in named:
        if wanted not in ids:
            raise model.PlanningError(f"[{SPLIT}] {item} has no step {wanted}")
    return [{**step, "claimed_by": ""} for step in own if str(step["id"]) in set(named)]


def _part_place(
    conn: sqlite3.Connection, row: sqlite3.Row, current: sqlite3.Row, *, item: str
) -> tuple[sqlite3.Row, str | None, deferral.Held | None]:
    """Where a part split off the task `row` stands, on what basis, and the condition it waits on.

    In the task's own state when that is triage or deferred, the condition copied with
    it; else in the first ready state, as accepted work.
    """

    category = str(current["category"])
    if category == "deferred":
        return current, None, deferral.held(conn, str(row["work_item_id"]))
    if category == "triage" or row["acceptance"] is None:
        found = (
            current
            if category == "triage"
            else states.first_state(conn, str(row["workflow_id"]), "triage")
        )
        basis = None
    else:
        found = states.first_state(conn, str(row["workflow_id"]), "ready")
        parent = None if row["parent_id"] is None else str(row["parent_id"])
        basis = "inherited" if item_tree.accepted_chain(conn, parent) else str(row["acceptance"])
    if found is None:
        raise model.PlanningError(
            f"[{SPLIT}] {item}'s workflow has no state a part of it could stand in"
        )
    return found, basis, None


def _blocked_for(conn: sqlite3.Connection, identity: str) -> str:
    """The reason a blocked task entered its state, which the work it leaves is blocked for."""

    found = conn.execute(
        "SELECT detail FROM work_item_events WHERE work_item_id = ?"
        " AND action IN ('created', 'transitioned') ORDER BY id DESC LIMIT 1",
        (identity,),
    ).fetchone()
    return "" if found is None else str(found[0]).partition(": ")[2]


def _listed(projects: list[str], used: int) -> str:
    """The dropped projects, as many as the event's detail has room for after `used`."""

    room = service.EVENT_DETAIL_LIMIT - used - len("; projects dropped: ")
    for shown in range(len(projects), 0, -1):
        hidden = len(projects) - shown
        text = ", ".join(projects[:shown]) + (f" and {hidden} more" if hidden else "")
        if len(text) <= room:
            return text
    return f"{len(projects)} projects"
