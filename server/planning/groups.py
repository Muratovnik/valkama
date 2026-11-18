"""A triage review's group: tasks waiting in the triage stack proposed as one new goal.

The creation of a goal takes the step `group` (`propose`): 2 to 20 tasks of the stack
that lie under no goal, the answer the agent gives about them (`do`, `later` with
`until`, `drop`) and why. The goal is created in triage, the tasks move under it at
once and leave the stack with it, and then:

- **The owner decides** (`human`) when the setting of the space keeps findings
  (`finding`) or proposed goals (`proposed_goal`) for the owner, and for `drop` also
  when it keeps cancels outside the agent's own work (`cancel_outside`) and a task of
  the group was filed outside it (`service.filed_by_caller`). The answer waits as an
  action of kind `group` at the point `finding` (`pending`), and the owner is asked the
  question `triage`, whose fields the server builds (`request_model.triage_fields`).
  While it waits, the question on the goal holds its tasks: no claim, move or label
  rule takes one of them (`questions.acceptance_asked`).
- **The agent decides** otherwise, and the same write carries its answer out: `do`
  accepts the goal on the basis `agent` with the tasks `inherited`; `later` puts the
  goal off with the tasks under it; `drop` cancels the tasks, then the goal. One mark
  of the summary of decisions, at `finding`, stands on the goal's event that records
  the answer.
- **A person's write** is the owner's decision, carried out at once.

The module sits above the service, beside `requests`: it composes the service's writes
and the rules below them, and nothing below the service imports it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass

from . import (
    calls,
    deferral,
    leases,
    model,
    participation,
    pending,
    read_model,
    request_model,
    service,
    states,
    triage,
)

#: The refusals of a group name it so.
TAG = "[group]"
#: The answers an agent gives about its group.
ANSWERS = (request_model.RETURN_DO, request_model.RETURN_LATER, request_model.RETURN_DROP)
#: How many tasks one group holds: a group of one is a goal for one task, and twenty is
#: the most options one field of the owner's question offers.
FEWEST, MOST = 2, 20
#: Who decides on a group.
OWNER, AGENT, HUMAN = "owner", participation.AGENT, participation.HUMAN
#: The longest reason a group gives, one line. Each reason an answer writes from it must
#: hold it whole, so the bound is the narrowest of those reasons: `later`'s, which
#: `service.PUT_OFF_REASON_LIMIT` bounds less the prefix `<who>: later: ` the decider's
#: name puts before it (`agent` and `owner` make it the same length). The `drop` reason
#: and the closing summary leave more room. The form refuses a longer why; no reason is cut.
WHY_LIMIT = service.PUT_OFF_REASON_LIMIT - max(len(f"{who}: later: ") for who in (OWNER, AGENT))
#: The longest label of a task the owner's question offers.
_LABEL_LIMIT = 200
#: What the owner reads at the head of a refusal of the group's form.
_FORM = (
    f"{TAG} a group is a new goal without a parent, with its conditions in checklist and"
    f" {FEWEST} to {MOST} items"
)


@dataclass(frozen=True)
class Group:
    """The step `group` as its form passed: the tasks named, the answer, until and why."""

    items: tuple[str, ...]
    answer: str
    until: str | None
    why: str


def form(payload: Mapping[str, object]) -> Group:
    """The group a creation names, or the refusal of its form, before anything is created.

    The goal is a new goal with no parent, its conditions in `checklist`, neither
    accepted, claimed nor placed in a state by the call; the group names 2 to 20
    distinct tasks, an answer, why, and `until` with `later` and only with it.
    """

    raw = payload.get("group")
    if not isinstance(raw, Mapping):
        raise model.PlanningError(f"{_FORM}: group is an object")
    wrong: list[str] = []
    kind = payload.get("kind") or "task"
    if kind != "goal":
        wrong.append(f"kind is {kind}")
    for name in ("parent", "acceptance", "state", "split_from"):
        if payload.get(name) not in (None, ""):
            wrong.append(f"{name} is named")
    if payload.get("claim") is True:
        wrong.append("claim is named")
    if not _conditions(payload.get("checklist")):
        wrong.append("checklist names no condition")
    group, said = _read(raw)
    wrong += said
    if wrong:
        raise model.PlanningError(f"{_FORM}: {'; '.join(wrong)}")
    return group


def parse(raw: Mapping[str, object]) -> Group:
    """The step `group` of a creation whose form has passed (`form`)."""

    group, wrong = _read(raw)
    if wrong:
        raise model.PlanningError(f"{_FORM}: {'; '.join(wrong)}")
    return group


def _read(raw: Mapping[str, object]) -> tuple[Group, list[str]]:
    """The group as the step names it, and what is wrong with it."""

    wrong: list[str] = []
    named_items = raw.get("items")
    items: list[str] = []
    if not isinstance(named_items, list) or not all(isinstance(item, str) for item in named_items):
        wrong.append("items is a list of references")
    else:
        items = [str(item) for item in named_items]
        if not FEWEST <= len(items) <= MOST:
            wrong.append(f"items names {len(items)}")
    twice = sorted({item for item in items if items.count(item) > 1})
    if twice:
        wrong.append(f"items names {', '.join(twice)} twice")
    answer = raw.get("answer")
    if answer not in ANSWERS:
        wrong.append("answer is do, later or drop")
    why = raw.get("why")
    if not isinstance(why, str) or not why.strip():
        wrong.append("why is missing")
    elif "\n" in why or len(why) > WHY_LIMIT:
        wrong.append(f"why is one line of at most {WHY_LIMIT} characters")
    until = raw.get("until")
    if until in (None, ""):
        if answer == request_model.RETURN_LATER:
            wrong.append("later needs until")
    elif not isinstance(until, str):
        wrong.append("until is a day YYYY-MM-DD or an item's reference")
    elif answer != request_model.RETURN_LATER:
        wrong.append("until goes with later alone")
    named = until if isinstance(until, str) and until else None
    return Group(tuple(items), str(answer), named, str(why).strip()), wrong


def _conditions(checklist: object) -> bool:
    """Whether the creation's `checklist` names a condition, in either form it takes."""

    steps = checklist.get("items") if isinstance(checklist, Mapping) else checklist
    return isinstance(steps, list) and bool(steps)


@dataclass(frozen=True)
class Proposed:
    """What the step `group` did: the tasks by reference, the answer, whether it was
    carried out, and the wait for the owner's answer when it was not."""

    items: list[str]
    answer: str
    waits: pending.Waiting | None

    def applied(self) -> dict:
        """The `applied.group` of the creation's answer."""

        return {"items": self.items, "answer": self.answer, "carried_out": self.waits is None}


def propose(conn: sqlite3.Connection, goal_id: str, group: Group, author: str | None) -> Proposed:
    """Move the tasks of `group` under the goal just created, and carry out its answer or
    ask the owner about it, by who decides on it (`_decides`).

    Each task waits in the triage stack of the goal's space and lies under no goal; the
    first that does not is refused, naming why, before anything moves.
    """

    goal = read_model.item_by_id(conn, goal_id)
    rows = _tasks(conn, goal, group.items)
    if group.until is not None:
        _check_until(conn, group.until)
    reference = read_model.reference(conn, goal)
    for row in rows:
        service.update_work_item(conn, str(row["work_item_id"]), parent=reference, author=author)
    references = [read_model.reference(conn, row) for row in rows]
    what = f"group «{goal['title']}»: {group.answer} {len(rows)} items"
    deciding = _decides(conn, goal, group, rows)
    if deciding == HUMAN:
        waits = _ask(conn, goal_id, group, rows, what, author)
        return Proposed(references, group.answer, waits)
    decided = service.Decided("finding", what) if deciding == AGENT else None
    _carry_out(conn, goal_id, group, rows, decided, author)
    return Proposed(references, group.answer, None)


def _tasks(
    conn: sqlite3.Connection, goal: sqlite3.Row, items: tuple[str, ...]
) -> list[sqlite3.Row]:
    """The rows of the tasks named, each one a task of the goal's space waiting in its
    triage stack with no goal over it; the first that is not is refused (`workflow_guard`)."""

    rows = [read_model.item_row(conn, item) for item in items]
    ids = [str(row["work_item_id"]) for row in rows]
    if len(set(ids)) != len(ids):
        raise model.PlanningError(f"{_FORM}: items names one item twice")
    space = str(goal["planning_space_id"])
    stack = {found.work_item_id for found in triage.waiting(conn, space, items=ids)}
    for row in rows:
        why = _not_waiting(conn, row, space, stack)
        if why is not None:
            raise model.WorkflowGuardError(
                f"{TAG} {read_model.reference(conn, row)} is not waiting for a triage review: {why}"
            )
    return rows


def _not_waiting(
    conn: sqlite3.Connection, row: sqlite3.Row, space: str, stack: set[str]
) -> str | None:
    """Why a task named cannot join the group, or None when it can."""

    if str(row["planning_space_id"]) != space:
        return "it is in another space"
    if row["kind"] == model.CONTAINER_KIND:
        return "it is a goal or stage"
    if read_model.state_by_id(conn, str(row["state_id"]))["category"] != "triage":
        return "it is not in triage"
    if row["parent_id"] is not None:
        parent = read_model.item_by_id(conn, str(row["parent_id"]))
        return f"it lies under {read_model.reference(conn, parent)}"
    if str(row["work_item_id"]) not in stack:
        return "it waits for the owner's answer"
    return None


def _check_until(conn: sqlite3.Connection, until: str) -> None:
    """Refuse an `until` that names no day, time or work item, as putting off reads it."""

    text = model.text_field(until, "until", limit=64)
    if deferral.moment(text, leases.utc_now()) is not None:
        return
    try:
        read_model.item_row(conn, text)
    except model.PlanningError as error:
        raise model.PlanningError(f"{_FORM}: until {text} is no day, time or work item") from error


def _decides(
    conn: sqlite3.Connection, goal: sqlite3.Row, group: Group, rows: list[sqlite3.Row]
) -> str:
    """Who decides on the group: the owner by their own write, else `human` where either
    setting the group meets says so, and for `drop` where cancels outside the agent's own
    work wait for the owner and a task lies outside it; `agent` otherwise. Reading one
    setting alone would let the other be bypassed."""

    if not calls.from_agent():
        return OWNER
    settings = participation.load(conn)
    space = str(goal["planning_space_id"])
    if HUMAN in (settings.mode(space, "finding"), settings.mode(space, "proposed_goal")):
        return HUMAN
    if (
        group.answer == request_model.RETURN_DROP
        and settings.mode(space, "cancel_outside") == HUMAN
        and not all(service.filed_by_caller(conn, str(row["work_item_id"])) for row in rows)
    ):
        return HUMAN
    return AGENT


def _ask(
    conn: sqlite3.Connection,
    goal_id: str,
    group: Group,
    rows: list[sqlite3.Row],
    what: str,
    author: str | None,
) -> pending.Waiting:
    """Keep the group's answer back for the owner on the goal, which stays in triage: the
    action holds the tasks with the state each stood in when asked, the answer, until and
    why; the question `triage` offers the answer, the tasks and until."""

    goal = read_model.item_by_id(conn, goal_id)
    listed = [
        (
            str(row["work_item_id"]),
            read_model.reference(conn, row),
            str(row["title"]),
            str(read_model.state_by_id(conn, str(row["state_id"]))["key"]),
        )
        for row in rows
    ]
    proposed: dict[str, object] = {
        "conditions": [str(step["text"]) for step in model.checklist(goal["checklist"])],
        "items": [{"reference": reference, "title": title} for _, reference, title, _ in listed],
        "answer": group.answer,
        "why": group.why,
    }
    if group.until is not None:
        proposed["until"] = group.until
    proposal = pending.Proposal(
        "group",
        {
            "items": [identity for identity, _, _, _ in listed],
            "answer": group.answer,
            "until": group.until,
            "why": group.why,
        },
        what,
        seen={"items": [{"id": identity, "state": state} for identity, _, _, state in listed]},
        reason=group.why,
        proposed=proposed,
    )
    options = [(reference.lower(), _label(reference, title)) for _, reference, title, _ in listed]
    return pending.ask(
        conn,
        goal_id,
        "finding",
        proposal,
        purpose="triage",
        prompt=f"Group of {len(rows)} items: «{goal['title']}»",
        fields=request_model.fields(
            request_model.triage_fields(group.answer, group.why, options, group.until)
        ),
        author=author,
    )


def _label(reference: str, title: str) -> str:
    """How the owner's question offers a task: its reference and title, cut to fit."""

    return _fit(f"{reference} · {title}", _LABEL_LIMIT)


def _fit(text: str, limit: int) -> str:
    """`text`, cut with an ellipsis to `limit` characters when it is longer."""

    return text if len(text) <= limit else text[: limit - 1] + "…"


#: What a task a group drops, and the goal, close with, unless it said what was done.
DROPPED_DONE = "Nothing: it is not to be done."
DROPPED_NEXT = "Nothing."


def _carry_out(
    conn: sqlite3.Connection,
    goal_id: str,
    group: Group,
    rows: list[sqlite3.Row],
    decided: service.Decided | None,
    author: str | None,
) -> None:
    """Carry the group's answer out at once: the agent's own decision, marked as
    `decided` says, or the owner's write. `do` accepts the goal and, by the cascade, the
    tasks under it; `later` puts the goal off with the tasks under it; `drop` cancels the
    tasks, then the goal, which then has no open work under it."""

    goal = read_model.item_by_id(conn, goal_id)
    reference = read_model.reference(conn, goal)
    if group.answer == request_model.RETURN_DO:
        ready = _state(conn, goal, "ready")
        if decided is None:
            service.transition_work_item(conn, reference, ready, author=author)
        else:
            service.decided_move(conn, reference, ready, reason="", decided=decided, author=author)
        return
    who = OWNER if decided is None else AGENT
    if group.answer == request_model.RETURN_LATER:
        service.defer_work_item(
            conn,
            reference,
            until=group.until,
            reason=f"{who}: later: {group.why}",
            author=author,
            decided=decided,
        )
        return
    cancelled = _state(conn, goal, "cancelled")
    reason = f"Not to be done: {group.why}"
    for row in rows:
        task = read_model.reference(conn, row)
        _close_summary(conn, task, group.why, author)
        service.transition_work_item(conn, task, cancelled, reason=reason, author=author)
    _close_summary(conn, reference, group.why, author)
    if decided is None:
        service.transition_work_item(conn, reference, cancelled, reason=reason, author=author)
    else:
        service.decided_move(
            conn, reference, cancelled, reason=reason, decided=decided, author=author
        )


def _close_summary(conn: sqlite3.Connection, reference: str, why: str, author: str | None) -> None:
    """The summary a cancel by the group's `drop` needs: what the item said was done, or
    that nothing is to be, and why."""

    said = model.summary(read_model.item_row(conn, reference)["summary"], required=False)
    kept = "" if said is None else str(said.get("done") or "").strip()
    summary = {"done": kept or DROPPED_DONE, "next": DROPPED_NEXT, "why": why}
    service.set_summary(conn, reference, summary, author=author)


def _state(conn: sqlite3.Connection, row: sqlite3.Row, category: str) -> str:
    """The key of the first state of `category` in the item's workflow."""

    found = states.first_state(conn, str(row["workflow_id"]), category)
    if found is None:
        raise model.WorkflowGuardError(
            f"{TAG} the workflow of {read_model.reference(conn, row)} has no {category} state"
        )
    return str(found["key"])


__all__ = ["ANSWERS", "Group", "Proposed", "form", "parse", "propose"]
