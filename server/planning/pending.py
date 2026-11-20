"""The writes an agent asked for that wait for the owner's answer.

Where the owner's setting keeps a decision for the owner (`participation`), the write
the agent sent is not made: the item stays as it was, the owner is asked, and the
call answers that it waits (`Waiting.answer`, the `waits_for_owner` of a write's
answer). The write waits here as an action, until the owner's answer carries it out
or declines it (`requests.carry_out`), it no longer applies or its item goes
another way (`dropped`), or the session that asked withdraws its question
(`withdrawn`). It is not a second state of the item: the item is what it was, and
the action is what was asked of it.

- **Asking** (`ask`). One action stands open per item and point. The same action sent
  again while it waits answers the same `Waiting` and writes nothing; another one of
  that point is refused with `[participation]`. The action is written with the call
  that asked (`asked_call`), and its question names it (`action_id`). The top-level
  session of an agent that asked follows the item (`subscriptions.follow`) unless it
  holds it, so a coordinator whose subagent asked hears the answer; Valkama's own
  asking subscribes nobody.
- **What is stored.** The action is the write as its gate checked it (`Proposal`): the
  kind of write (`KINDS`), its `params`, what the asker `seen` of the item, the line
  the summary of decisions would carry once it is done (`what`), the asker's reason,
  and what it `proposed` as the question shows it.
- **The round of consent** (`ask_sessions`). A cancel of work other live sessions do
  asks each of them too, by a call of Valkama's own, for `SILENCE`; their answers stand
  in the action's `consent` (`part`), and the cancel waits on them (`Round`) where the
  owner left it to the agent.
- **Ending** (`end`). An action ends once, with its outcome and the call that ended it;
  its questions still open end with it. A dropped one leaves `action_dropped` on its
  item, `<point>: <why>`. A close or a merge of the item drops every action open on
  it (`drop_on`), and a delete takes them with the item.
- **Whether it still applies** (`inapplicable`), read on the item as it stands when
  the owner answers, against what the asker saw.

The module sits below the service, as `questions` does, and imports neither it nor
`requests`: the service's writes and `requests` call it inside their transactions.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import timedelta

from . import calls, closing, composed, leases, model, questions, request_model, subscriptions
from . import store as planning_store

#: The points an action waits at, and how one ends.
POINTS = planning_store.PENDING_POINTS
CARRIED_OUT, DECLINED, DROPPED, WITHDRAWN = planning_store.PENDING_OUTCOMES
#: The writes an action stands for: accept an item that lies in triage, move it, edit
#: its checklist, put it off, give it a parent, and the review of many findings at once.
KINDS = ("accept", "transition", "checklist", "defer", "parent", "group")
#: Who an action Valkama asked names as its asker.
VALKAMA = "Valkama"
#: The longest detail of an event.
DETAIL_LIMIT = 512
#: The purposes whose question shows the cancel list as it stands (`part`): a goal's, a
#: cancel's and a group's, whose `drop` cancels the goal by it.
_LISTED = frozenset({"goal", "cancel", "triage"})
#: Why a cancel no longer applies when its list alone changed: the owner may confirm
#: the list as it stands instead (`requests.Carrier.by_list`).
LIST_CHANGED = "the work it cancels changed since"

_ITEM = (
    "SELECT i.*, p.key AS space_key, s.key AS state_key, s.category AS state_category,"
    " s.is_terminal AS state_terminal FROM work_items i"
    " JOIN planning_spaces p ON p.planning_space_id = i.planning_space_id"
    " JOIN workflow_states s ON s.state_id = i.state_id WHERE i.work_item_id = ?"
)
_OPEN = "SELECT * FROM pending_actions WHERE work_item_id = ? AND outcome IS NULL"


@dataclass(frozen=True)
class Proposal:
    """A write a gate kept back for the owner, as the gate checked it.

    `params` and `seen` are JSON objects: the write's arguments, and what the asker
    saw of the item that the answer must still find (`inapplicable` reads, by point:
    `parent` in `params` and in `seen` for a task in a goal, and `accepted` in `seen`
    too for one being moved there; `item`, `cancels` and `dependents` for a cancel, as `cancel_seen`
    gives them; for a group, `items`, each task with the state it stood in). `proposed` is
    what the question shows was proposed (`removed` and `rewritten` for a condition,
    `until` for putting a goal off, `summary` for a close, and for a group its
    `conditions`, `items`, `answer`, `until` and `why`), and `what` the line of the
    summary of decisions once it is carried out: composed with its key and values
    (`composed.decision`), or a text alone, stored without them.
    """

    kind: str
    params: Mapping[str, object]
    what: composed.Text | str
    seen: Mapping[str, object] = field(default_factory=dict)
    reason: str | None = None
    proposed: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Action:
    """One action as stored: `what` as composed, or as text alone where it was stored
    without its key."""

    id: str
    work_item_id: str
    point: str
    kind: str
    params: dict
    seen: dict
    what: composed.Text | str
    reason: str | None
    proposed: dict
    asked_call: int
    created_at: str
    outcome: str | None

    @classmethod
    def of_row(cls, row: sqlite3.Row) -> Action:
        stored = json.loads(row["action_json"])
        return cls(
            id=str(row["action_id"]),
            work_item_id=str(row["work_item_id"]),
            point=str(row["point"]),
            kind=str(stored["kind"]),
            params=dict(stored.get("params") or {}),
            seen=dict(stored.get("seen") or {}),
            what=_what(stored),
            reason=stored.get("reason"),
            proposed=dict(stored.get("proposed") or {}),
            asked_call=int(row["asked_call"]),
            created_at=str(row["created_at"]),
            outcome=row["outcome"],
        )


def _what(stored: Mapping[str, object]) -> composed.Text | str:
    """An action's `what` as `hold` stored it: with its key and values, or its text alone."""

    text = str(stored.get("what") or "")
    key, values = stored.get("what_key"), stored.get("what_values")
    if isinstance(key, str) and isinstance(values, dict):
        return composed.Text(key, values, text)
    return text


@dataclass(frozen=True)
class Waiting:
    """A write that waits for the owner: what its call answers."""

    action: str
    point: str
    question: str
    what: str

    def answer(self) -> dict[str, str]:
        """The `waits_for_owner` of the write's answer."""

        return {
            "action": self.action,
            "point": self.point,
            "question": self.question,
            "what": self.what,
        }


def ask(
    conn: sqlite3.Connection,
    work_item_id: str,
    point: str,
    proposal: Proposal,
    *,
    purpose: str,
    prompt: composed.Text,
    fields: list[dict],
    author: str | None,
) -> Waiting:
    """Keep `proposal` back on the item until the owner answers the question about it.

    Written by the call in progress, which is who asked. The same action of a point
    that already waits answers that wait again and writes nothing; another one is
    refused, and so is a call that is none (an action names the call that asked).
    """

    action, fresh = hold(conn, work_item_id, point, proposal)
    what = composed.plain(action.what)
    if not fresh:
        return Waiting(action.id, point, owner_question(conn, action), what)
    question = ask_owner(conn, action, purpose=purpose, prompt=prompt, fields=fields, author=author)
    return Waiting(action.id, point, question, what)


def hold(
    conn: sqlite3.Connection, work_item_id: str, point: str, proposal: Proposal
) -> tuple[Action, bool]:
    """Keep `proposal` back on the item, asking nobody yet: the action, and whether this
    call wrote it.

    The same action of a point that already waits is that action, written by nobody
    now; another one is refused, and so is a call that is none (an action names the
    call that asked). The asker's session follows the item (`_follow`).
    """

    model.enum_field(point, frozenset(POINTS), "point")
    model.enum_field(proposal.kind, frozenset(KINDS), "kind")
    params = json.loads(model.dumps(dict(proposal.params)))
    for found in open_on(conn, work_item_id, point):
        if found.kind == proposal.kind and found.params == params:
            return found, False
        raise model.PlanningError(
            f"[participation] {_reference(conn, work_item_id)} already waits for the owner on"
            f" {point}: withdraw that question first"
        )
    asked = calls.call_id(conn, work_item_id)
    if asked is None:
        raise RuntimeError("an action waits on the call that asked it, and no call is in progress")
    identity = model.new_id()
    stored = {
        "kind": proposal.kind,
        "params": params,
        "seen": dict(proposal.seen),
        "what": composed.plain(proposal.what),
        **(
            {"what_key": proposal.what.key, "what_values": dict(proposal.what.values)}
            if isinstance(proposal.what, composed.Text)
            else {}
        ),
        "reason": proposal.reason,
        "proposed": dict(proposal.proposed),
    }
    conn.execute(
        "INSERT INTO pending_actions(action_id,work_item_id,point,action_json,asked_call,"
        "created_at) VALUES(?,?,?,?,?,?)",
        (identity, work_item_id, point, model.dumps(stored), asked, request_model.now()),
    )
    _follow(conn, work_item_id)
    return get(conn, identity), True


def ask_owner(
    conn: sqlite3.Connection,
    action: Action,
    *,
    purpose: str,
    prompt: composed.Text,
    fields: list[dict],
    author: str | None,
) -> str:
    """Ask the owner the question an action waits on, by the call in progress; its id."""

    return questions.ask(
        conn,
        action.work_item_id,
        kind="question",
        prompt=prompt,
        fields=fields,
        author=author,
        purpose=purpose,
        action_id=action.id,
    )


def join(conn: sqlite3.Connection, action: Action, request_id: str) -> None:
    """Let an action wait on a question to the owner that was asked already, about the same
    write: the confirmation its goal's period of waiting asked. Its answer carries the
    action out, and its end ends it."""

    conn.execute(
        "UPDATE work_item_requests SET action_id = ? WHERE request_id = ? AND work_item_id = ?",
        (action.id, request_id, action.work_item_id),
    )


# -- the round of consent ---------------------------------------------------------

#: How long the sessions asked about a cancel of their work have to answer: past it, the
#: owner decides.
SILENCE = timedelta(days=1)
#: The call Valkama asks the sessions in, so that the asker is the server and not a
#: session, which may not ask itself.
ROUND_TOOL = "consent-round"
CONSENT = "consent"


@dataclass(frozen=True)
class Round:
    """A cancel that waits for the sessions whose work it ends: what its call answers."""

    action: str
    point: str
    sessions: list[str]
    until: str | None

    def answer(self) -> dict[str, object]:
        """The `waits_for_sessions` of the write's answer."""

        return {
            "action": self.action,
            "point": self.point,
            "sessions": self.sessions,
            "until": self.until,
        }


def ask_sessions(
    conn: sqlite3.Connection,
    action: Action,
    sessions: list[str],
    *,
    prompt: composed.Text,
    author: str | None,
) -> None:
    """Ask each session whose work the action's cancel ends whether it agrees, by a call of
    Valkama's own, each request open for `SILENCE` by the clock of the sweep."""

    until = request_model.stamp(leases.utc_now() + SILENCE)
    fields = request_model.fields(request_model.consent_fields())
    with calls.bind(calls.valkama(), ROUND_TOOL):
        for session in sessions:
            questions.ask(
                conn,
                action.work_item_id,
                kind="question",
                prompt=prompt,
                fields=fields,
                author=author,
                purpose=CONSENT,
                expires_at=until,
                addressee=session,
                action_id=action.id,
            )


#: The requests an action asked of sessions, each with `channel`: the source of the
#: latest confirmed call its session made through a channel that names a holder.
_CONSENT_ROWS = (
    "SELECT r.*, (SELECT c.identity_source FROM execution_events c"
    " WHERE c.session_id = r.addressee AND c.identity_state = ?"
    " AND c.identity_source IN (SELECT value FROM json_each(?))"
    " ORDER BY c.id DESC LIMIT 1) AS channel"
    " FROM work_item_requests r"
    " WHERE r.work_item_id = ? AND r.action_id = ? AND r.addressee IS NOT NULL"
    # The order they were asked in: their ids are random, and one write asks them all.
    " ORDER BY r.created_at, r.rowid"
)


def consent_rows(conn: sqlite3.Connection, action: Action) -> list[sqlite3.Row]:
    """The requests an action asked of sessions, oldest first, each with the channel that
    proved its session (`session_label`)."""

    channels = json.dumps(list(calls.CHANNEL_SOURCES))
    return conn.execute(
        _CONSENT_ROWS, (calls.CONFIRMED, channels, action.work_item_id, action.id)
    ).fetchall()


def session_label(row: sqlite3.Row) -> str:
    """How a request asked of a session names that session: as it holds, by the channel its
    confirmed calls proved it through (`calls.channel_holder`), never by the client name its
    session row took from a handshake. A session a round asks holds or follows work, so a
    call of it proved a channel; `agent` names one whose calls proved none."""

    session = str(row["addressee"])
    held = calls.channel_holder(str(row["channel"]), session) if row["channel"] else None
    return held if held is not None else calls.holder_label("agent", session)


def round_of(conn: sqlite3.Connection, action: Action) -> Round:
    """The round an action waits on: the sessions it asked and until when."""

    rows = consent_rows(conn, action)
    until = rows[0]["expires_at"] if rows else None
    return Round(action.id, action.point, [session_label(row) for row in rows], until)


def _follow(conn: sqlite3.Connection, work_item_id: str) -> None:
    """The asking agent's session follows the item, unless it holds it; Valkama's
    asking, or a person's, makes no follower."""

    session = subscriptions.agent_session(calls.current())
    if session is None:
        return
    holder = conn.execute(
        "SELECT c.session_id FROM work_items i JOIN execution_events c ON c.id = i.claim_call_id"
        " WHERE i.work_item_id = ? AND i.claim_ref != ''",
        (work_item_id,),
    ).fetchone()
    if holder is not None and holder[0] == session:
        return
    subscriptions.follow(conn, work_item_id, session)


def open_on(conn: sqlite3.Connection, work_item_id: str, point: str | None = None) -> list[Action]:
    """The actions waiting on an item, or the one of `point`, oldest first."""

    query, parameters = _OPEN, [work_item_id]
    if point is not None:
        query, parameters = query + " AND point = ?", [work_item_id, point]
    return [
        Action.of_row(row)
        for row in conn.execute(query + " ORDER BY created_at, action_id", parameters)
    ]


def get(conn: sqlite3.Connection, action_id: str) -> Action:
    row = conn.execute("SELECT * FROM pending_actions WHERE action_id = ?", (action_id,)).fetchone()
    if row is None:
        raise model.PlanningError("that action does not exist")
    return Action.of_row(row)


def of_request(row: sqlite3.Row) -> str | None:
    """The action a request row is about; None for any other, as on a store from before."""

    # `in` on a row reads its values, so its column names are asked for by name.
    columns = row.keys()
    found: str | None = row["action_id"] if "action_id" in columns else None
    return found


def end(
    conn: sqlite3.Connection,
    action: Action,
    outcome: str,
    *,
    author: str | None,
    why: str = "",
    reason: str = "withdrawn",
) -> bool:
    """End an action with `outcome`, once; whether this call ended it.

    Its questions and requests still open end with it, as `reason`. A dropped one
    records `action_dropped` on its item, saying the point and `why`.
    """

    model.enum_field(outcome, frozenset(planning_store.PENDING_OUTCOMES), "outcome")
    item = action.work_item_id
    changed = conn.execute(
        "UPDATE pending_actions SET outcome = ?, ended_call = ?, ended_at = ?"
        " WHERE action_id = ? AND outcome IS NULL",
        (outcome, calls.call_id(conn, item), request_model.now(), action.id),
    ).rowcount
    if not changed:
        return False
    if outcome == DROPPED:
        detail = f"{action.point}: {why}" if why else action.point
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author,call_id)"
            " VALUES(?,?,?,?,?)",
            (
                item,
                model.event_action("action_dropped"),
                detail[:DETAIL_LIMIT],
                model.actor(author),
                calls.call_id(conn, item),
            ),
        )
    questions.end(conn, item, reason, author, action_id=action.id)
    return True


def drop_on(
    conn: sqlite3.Connection, work_item_id: str, why: str, *, reason: str, author: str | None
) -> list[str]:
    """Drop every action open on an item that is going away, its questions ending as
    `reason`; the ids dropped."""

    dropped = []
    for action in open_on(conn, work_item_id):
        if end(conn, action, DROPPED, author=author, why=why, reason=reason):
            dropped.append(action.id)
    return dropped


def inapplicable(conn: sqlite3.Connection, action: Action) -> str | None:
    """Why the action no longer applies to its item as it stands now; None while it does.

    Read when the owner answers: the action applies while what its asker saw has not
    changed in a way they were not asked about.
    """

    row = conn.execute(_ITEM, (action.work_item_id,)).fetchone()
    if row is None:
        return "the item is gone"
    if row["state_terminal"]:
        return f"the item closed in {row['state_key']}"
    accepted = row["acceptance"] is not None
    # A group of findings waits on its goal as a proposed goal does: in triage, unaccepted.
    if action.point in ("proposed_goal", "finding"):
        if row["state_category"] != "triage":
            return f"the goal left triage for {row['state_key']}"
        return "the goal was accepted" if accepted else None
    if action.point == "task_in_goal":
        return _task_in_goal(conn, action, row)
    if action.point in ("cancel_outside", "cancel_shared"):
        return _cancel_changed(conn, action, row)
    if action.point == "condition":
        return _steps_changed(action, row)
    if action.point == "goal_close":
        confirmable = closing.confirmable(conn, action.work_item_id)
        return None if confirmable else "it no longer awaits confirmation"
    if action.point == "goal_defer":
        return None if accepted else "it is not accepted"
    return None


def own_variant(choices: Iterable[str]) -> model.PlanningError:
    """The refusal of an answer that names none of the `choices` a carrier carries out."""

    return model.PlanningError(
        f"[purpose] answer is one of {', '.join(choices)}: an own variant carries nothing out;"
        " say more in note"
    )


def _task_in_goal(conn: sqlite3.Connection, action: Action, row: sqlite3.Row) -> str | None:
    """A task lying in a goal applies while it is not accepted, and one being moved there
    while it is not accepted since it was asked (`accepted` in `seen`); either while it
    stands where it stood (`parent` in `seen`) and the goal is open and accepted."""

    if row["acceptance"] is not None and not action.seen.get("accepted"):
        return "the task was accepted"
    if "parent" in action.seen and row["parent_id"] != action.seen["parent"]:
        return "the task moved"
    goal = conn.execute(_ITEM, (str(action.params.get("parent")),)).fetchone()
    if goal is None:
        return "the goal is gone"
    if goal["state_terminal"]:
        return f"the goal closed in {goal['state_key']}"
    return None if goal["acceptance"] is not None else "the goal is not accepted"


def cancel_seen(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, list]:
    """What the asker of a cancel sees of the item, the `seen` of its action: where the
    item stands and who holds it, and the rows the cancel list's token fingerprints."""

    item = conn.execute(_ITEM, (str(row["work_item_id"]),)).fetchone()
    listing = closing.cancel_list(conn, item) if item["kind"] == model.CONTAINER_KIND else None
    rows = (
        closing.projection(listing.cancels, listing.dependents)
        if listing is not None
        else {"cancels": [], "dependents": []}
    )
    return {"item": [str(item["state_key"]), closing.holders(item)], **rows}


def _cancel_changed(conn: sqlite3.Connection, action: Action, row: sqlite3.Row) -> str | None:
    """Whether what a cancel would close changed since it was asked: the item moved or
    changed holders, or a row of its list is new or changed. A row gone is no change."""

    now = cancel_seen(conn, row)
    if now["item"] != action.seen.get("item"):
        return "the item changed since"
    return LIST_CHANGED if _grown(action, now) else None


def list_changed(conn: sqlite3.Connection, action: Action) -> bool:
    """Whether a row of the cancel list is new or changed since the cancel was asked."""

    row = conn.execute(_ITEM, (action.work_item_id,)).fetchone()
    return _grown(action, cancel_seen(conn, row))


def _grown(action: Action, now: Mapping[str, list]) -> bool:
    for part in ("cancels", "dependents"):
        seen = {json.dumps(entry) for entry in action.seen.get(part) or []}
        if any(json.dumps(entry) not in seen for entry in now[part]):
            return True
    return False


def _steps_changed(action: Action, row: sqlite3.Row) -> str | None:
    """Whether a step the action removes or rewrites no longer stands as it was asked."""

    texts = {str(step["id"]): str(step["text"]) for step in model.checklist(row["checklist"])}
    named = [
        *((entry["id"], entry["text"]) for entry in action.proposed.get("removed") or []),
        *((entry["id"], entry["from"]) for entry in action.proposed.get("rewritten") or []),
    ]
    for identity, text in named:
        if texts.get(str(identity)) != text:
            return "a step it changes was changed since"
    return None


def part(conn: sqlite3.Connection, action_id: str, purpose: str | None, author: str) -> dict:
    """The `action` of a question read whole: what waits, who asked it and when, why, what
    it proposes and how it ended; for a goal or a cancel the cancel list as it stands, and
    for a shared cancel what each session asked answered. `author` names the asker of an
    action whose call proved no session."""

    action = get(conn, action_id)
    found: dict[str, object] = {
        "id": action.id,
        "point": action.point,
        "asked_by": asker(conn, action, author),
        "asked_at": action.created_at,
        "reason": action.reason,
        "proposed": action.proposed,
        "outcome": action.outcome,
    }
    if purpose in _LISTED:
        item = conn.execute(_ITEM, (action.work_item_id,)).fetchone()
        listing = closing.cancel_list(conn, item) if item["kind"] == model.CONTAINER_KIND else None
        cancels = [] if listing is None else listing.cancels
        dependents = [] if listing is None else listing.dependents
        found["cancel_list"] = {
            "cancels": cancels,
            "dependents": dependents,
            "list_token": closing.token(cancels, dependents),
        }
    if action.point == "cancel_shared":
        found["consent"] = _consent(conn, action)
    return found


def _asking_call(conn: sqlite3.Connection, action: Action) -> sqlite3.Row | None:
    """The call that asked an action: the one source of who asked it.

    It is the agent's call whose write set the action going, also where a call of
    Valkama's own then asked on that agent's behalf (the sessions in a round of
    consent, the owner once the round passes the cancel on): Valkama writes, the
    agent asks. An action Valkama asked itself, such as a goal that came back, names
    Valkama's call.
    """

    found: sqlite3.Row | None = conn.execute(
        "SELECT identity_state, identity_source, session_id FROM execution_events WHERE id = ?",
        (action.asked_call,),
    ).fetchone()
    return found


def asked_session(conn: sqlite3.Connection, action: Action) -> str | None:
    """The session that asked an action, which alone withdraws its questions; None when
    Valkama asked it or its call proved no session."""

    return _proved(_asking_call(conn, action))


def asker(conn: sqlite3.Connection, action: Action, author: str) -> str:
    """Who asked an action, as a holder is named: `Valkama` for one it asked itself, and
    `author` for a call that proved no session."""

    row = _asking_call(conn, action)
    if row is None:
        return author
    if row["identity_source"] == calls.VALKAMA:
        return VALKAMA
    session = _proved(row)
    held = None if session is None else calls.channel_holder(str(row["identity_source"]), session)
    return held if held is not None else author


def _proved(row: sqlite3.Row | None) -> str | None:
    """The session an asking call proved; None for Valkama's call or one that proved none."""

    if row is None or row["identity_source"] == calls.VALKAMA:
        return None
    if row["identity_state"] != calls.CONFIRMED or not row["session_id"]:
        return None
    return str(row["session_id"])


def _consent(conn: sqlite3.Connection, action: Action) -> list[dict]:
    """What each session the action asked answered: its answer, its reason and when."""

    found = []
    for row in consent_rows(conn, action):
        answers = json.loads(row["answers_json"]) if row["answers_json"] else {}
        answered = row["status"] == "answered"
        found.append(
            {
                "session": session_label(row),
                "answer": answers.get(request_model.REVIEW_ANSWER) if answered else None,
                "reason": answers.get(request_model.CONSENT_REASON) if answered else None,
                "at": row["resolved_at"] if answered else None,
            }
        )
    return found


def owner_question(conn: sqlite3.Connection, action: Action) -> str:
    """The question to the owner an action asked."""

    row = conn.execute(
        "SELECT request_id FROM work_item_requests WHERE work_item_id = ? AND action_id = ?"
        " AND addressee IS NULL ORDER BY created_at, request_id LIMIT 1",
        (action.work_item_id, action.id),
    ).fetchone()
    return "" if row is None else str(row[0])


def _reference(conn: sqlite3.Connection, work_item_id: str) -> str:
    row = conn.execute(_ITEM, (work_item_id,)).fetchone()
    return model.human_id(str(row["space_key"]), int(row["number"]))
