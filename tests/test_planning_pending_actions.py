"""Writes that wait for the owner: how one is asked, read, answered, and how it ends.

The expectations come from the contract of a waiting action: one open per item and
point, the same one sent again answering the same wait and another refused with
`[participation]`; the asking agent's session following the item and Valkama's asking
making no follower; the `action` of the question read whole and its point in the
compact form; an answer ending the action before its write is made, an action that no
longer applies dropped with the answer standing; and a merge, a close or a delete of
its item taking it. The cancel list a question shows is held to the one a cancel's
own refusal hands over, not to the module that builds both.
"""

from __future__ import annotations

import functools
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime
from unittest import mock

from server import store
from server.planning import (
    api,
    calls,
    decisions,
    leases,
    model,
    participation,
    pending,
    person_events,
    questions,
    request_model,
    requests,
    service,
    sweep,
    tools,
)

AGENT = calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-a")
#: A subagent of the same session: what it asks, the session's conversation follows.
SUBAGENT = calls.Identity(
    calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-a", agent_id="worker-a"
)
OTHER = calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-b")
#: How the question names the agent that asked: as a holder is named.
ASKER = "claude (session session-a)"
FIELDS = [
    {
        "id": "answer",
        "label": "Answer",
        "type": "choice",
        "required": True,
        "options": [{"id": "do", "label": "Do it"}, {"id": "drop", "label": "Drop it"}],
    }
]
GOAL = pending.Proposal("accept", {"basis": "owner"}, "accept the goal", reason="the plan needs it")


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Alpha", key="ALPHA")
        self.conn.commit()

    # -- writes ---------------------------------------------------------------------

    def filed(
        self,
        title: str,
        *,
        kind: str = "task",
        parent: str | None = None,
        by: calls.Identity = AGENT,
    ) -> str:
        """An item filed by `by`: an agent's lies in triage, the owner's is accepted.

        An agent's goal with no parent is filed outside any call, so it lies in triage
        with nothing asked about it, for the action a test asks on it: in a call, the
        goal an agent proposes meets the owner's setting (`ProposedGoalTests`).
        """

        create = functools.partial(
            service.create_work_item,
            self.conn,
            space="ALPHA",
            title=title,
            kind=kind,
            parent=parent,
        )
        if kind == "goal" and parent is None and by.source not in (calls.BROWSER, calls.VALKAMA):
            created = create()
        else:
            with calls.bind(by, "create_work_item"):
                created = create()
        self.conn.commit()
        return str(created["reference"])

    def ask(
        self,
        reference: str,
        proposal: pending.Proposal = GOAL,
        *,
        point: str = "proposed_goal",
        purpose: str = "goal",
        by: calls.Identity = AGENT,
        tool: str = "create_work_item",
    ) -> pending.Waiting:
        try:
            with calls.bind(by, tool):
                waiting = pending.ask(
                    self.conn,
                    self.id(reference),
                    point,
                    proposal,
                    purpose=purpose,
                    prompt="Take it on?",
                    fields=request_model.fields(FIELDS),
                    author="claude",
                )
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        return waiting

    def answer(
        self, question: str, choice: str, by: calls.Identity | None = None, **more: object
    ) -> dict:
        row = self.request(question)
        try:
            with calls.bind(by or calls.browser(), "/api/planning/request/resolve"):
                record = requests.resolve(
                    self.conn,
                    question,
                    status="answered",
                    expected_revision=int(row["revision"]),
                    answers={"answer": choice, **more},
                    author="user",
                )
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        return record

    def withdraw(self, question: str, by: calls.Identity = AGENT) -> dict:
        row = self.request(question)
        try:
            with calls.bind(by, "expire_work_item_request"):
                record = requests.resolve(
                    self.conn,
                    question,
                    status="expired",
                    expected_revision=int(row["revision"]),
                    author="claude",
                )
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        return record

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    # -- reads ----------------------------------------------------------------------

    def id(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def row(self, reference: str) -> sqlite3.Row:
        return self.conn.execute(
            "SELECT * FROM work_items WHERE work_item_id = ?", (self.id(reference),)
        ).fetchone()

    def request(self, question: str) -> sqlite3.Row:
        return self.conn.execute(
            "SELECT * FROM work_item_requests WHERE request_id = ?", (question,)
        ).fetchone()

    def action(self, identity: str) -> sqlite3.Row:
        return self.conn.execute(
            "SELECT * FROM pending_actions WHERE action_id = ?", (identity,)
        ).fetchone()

    def counts(self) -> tuple[int, int, int, int]:
        return tuple(  # type: ignore[return-value]
            int(self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in (
                "pending_actions",
                "work_item_requests",
                "work_item_events",
                "work_item_subscriptions",
            )
        )

    def events(self, reference: str, action: str) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT detail FROM work_item_events WHERE work_item_id = ? AND action = ?"
                " ORDER BY id",
                (self.id(reference), action),
            )
        ]

    def followers(self, reference: str) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT session_id, agent_id, follows FROM work_item_subscriptions"
                " WHERE work_item_id = ? ORDER BY session_id, agent_id",
                (self.id(reference),),
            )
        ]

    def applies(self, waiting: pending.Waiting) -> str | None:
        return pending.inapplicable(self.conn, pending.get(self.conn, waiting.action))


class AskTests(Harness):
    def test_an_agents_action_waits_on_its_question_and_its_session_follows(self) -> None:
        goal = self.filed("A goal of the agent's own", kind="goal", by=OTHER)
        self.assertEqual([], self.followers(goal))
        waiting = self.ask(goal, by=SUBAGENT)

        question = self.request(waiting.question)
        self.assertEqual(
            {
                "action": waiting.action,
                "point": "proposed_goal",
                "question": waiting.question,
                "what": "accept the goal",
            },
            waiting.answer(),
        )
        self.assertEqual(
            ("goal", waiting.action, None),
            (question["purpose"], question["action_id"], question["addressee"]),
        )
        stored = self.action(waiting.action)
        asked_by = self.conn.execute(
            "SELECT session_id, agent_id FROM execution_events WHERE id = ?",
            (stored["asked_call"],),
        ).fetchone()
        self.assertEqual(("session-a", "worker-a"), tuple(asked_by))
        self.assertEqual(
            ("proposed_goal", None, None), (stored["point"], stored["outcome"], stored["ended_at"])
        )
        # The session's own conversation follows the goal, though its subagent asked.
        self.assertEqual([("session-a", "", 1)], self.followers(goal))
        self.assertEqual(
            ["request_created"],
            [
                str(row[0])
                for row in self.conn.execute(
                    "SELECT action FROM work_item_events WHERE work_item_id = ? AND id >"
                    " (SELECT MAX(id) FROM work_item_events WHERE work_item_id = ? AND action = 'created')",
                    (self.id(goal), self.id(goal)),
                )
            ],
        )
        self.assertEqual(["triage"], [service.get_work_item(self.conn, goal)["state"]["category"]])

    def test_the_same_action_again_answers_the_same_wait_and_writes_nothing(self) -> None:
        goal = self.filed("Asked twice", kind="goal")
        first = self.ask(goal)
        before = self.counts()
        again = self.ask(goal, pending.Proposal("accept", {"basis": "owner"}, "accept the goal"))
        self.assertEqual(first, again)
        self.assertEqual(before, self.counts())

    def test_another_action_of_the_point_is_refused_and_another_point_waits_beside_it(
        self,
    ) -> None:
        goal = self.filed("One wait a point", kind="goal")
        self.ask(goal)
        before = self.counts()
        with self.assertRaises(model.PlanningError) as refused:
            self.ask(goal, pending.Proposal("accept", {"basis": "assignment"}, "accept it"))
        self.assertEqual(
            "[participation] ALPHA-1 already waits for the owner on proposed_goal:"
            " withdraw that question first",
            str(refused.exception),
        )
        self.assertEqual(
            (400, "invalid_request"),
            (
                api.error_response(refused.exception)[0],
                api.error_response(refused.exception)[1]["error"]["code"],
            ),
        )
        self.assertEqual(before, self.counts())
        beside = self.ask(
            goal,
            pending.Proposal("defer", {"until": "2026-12-01"}, "put it off"),
            point="goal_defer",
        )
        self.assertEqual(2, len(pending.open_on(self.conn, self.id(goal))))
        self.assertEqual("goal_defer", beside.point)

    def test_a_question_valkama_asked_subscribes_nobody(self) -> None:
        goal = self.filed("Came back", kind="goal", by=OTHER)
        before = self.followers(goal)
        waiting = self.ask(goal, by=calls.valkama(), tool="deferral-return")
        self.assertEqual(before, self.followers(goal))
        part = requests.get(self.conn, waiting.question)["action"]
        self.assertEqual("Valkama", part["asked_by"])

    def test_the_holder_that_asks_is_not_made_a_follower(self) -> None:
        task = self.filed("Held by its asker")
        with calls.bind(AGENT, "claim_work_item"):
            service.claim_work_item(self.conn, task, author="claude")
        self.conn.commit()
        self.ask(
            task,
            pending.Proposal("transition", {"state": "cancelled"}, f"cancel {task}"),
            point="cancel_outside",
            purpose="cancel",
        )
        self.assertEqual([], self.followers(task))


class ReadTests(Harness):
    def test_the_question_carries_the_action_whole_and_its_point_compact(self) -> None:
        goal = self.filed("Owner's goal", kind="goal", by=calls.browser())
        self.filed("Work under it", parent=goal, by=calls.browser())
        waiting = self.ask(
            goal,
            pending.Proposal(
                "transition",
                {"state": "cancelled"},
                f"cancel {goal}",
                seen=pending.cancel_seen(self.conn, self.row(goal)),
                reason="superseded by another plan",
                proposed={"state": "cancelled"},
            ),
            point="cancel_outside",
            purpose="cancel",
        )
        # The list and token a cancel of the goal is refused with, read apart.
        with self.assertRaises(api.PlanningHttpError) as caught:
            self.person(
                "/api/planning/work-item/apply",
                id=goal,
                summary={"done": "Not needed", "next": "Nothing"},
                transition={"state": "cancelled", "reason": "not needed"},
            )
        self.conn.rollback()
        status, body = api.error_response(caught.exception)
        self.assertEqual((409, "cancel_list"), (status, body["error"]["code"]))
        listed = body["error"]
        record = requests.get(self.conn, waiting.question)
        part = record["action"]
        self.assertEqual(
            {
                "id": waiting.action,
                "point": "cancel_outside",
                "asked_by": ASKER,
                "reason": "superseded by another plan",
                "proposed": {"state": "cancelled"},
                "outcome": None,
                "cancel_list": {
                    "cancels": listed["cancels"],
                    "dependents": listed["dependents"],
                    "list_token": listed["list_token"],
                },
            },
            {name: value for name, value in part.items() if name != "asked_at"},
        )
        self.assertEqual(str(self.action(waiting.action)["created_at"]), part["asked_at"])
        self.assertEqual("cancel", record["purpose"])
        [compact] = requests.item_questions(self.conn, self.id(goal))["items"]
        self.assertEqual(
            ({"point": "cancel_outside"}, "cancel"), (compact["action"], compact["purpose"])
        )

    def test_a_question_about_no_action_reads_as_before(self) -> None:
        task = self.filed("Asked plainly")
        with calls.bind(AGENT, "create_work_item_request"):
            record = requests.create(
                self.conn, task, kind="question", prompt="Which road?", fields=FIELDS
            )
        self.conn.commit()
        self.assertNotIn("action", record)
        [compact] = requests.item_questions(self.conn, self.id(task))["items"]
        self.assertNotIn("action", compact)


class CarryOutTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.ran: list[tuple[str, str | None]] = []

        def run(conn, _row, action, answers, _note, _author):  # type: ignore[no-untyped-def]
            # What the write would find: the action already ended.
            self.ran.append((answers["answer"], pending.get(conn, action.id).outcome))

        carriers = mock.patch.dict(
            requests.CARRIERS,
            {
                "proposed_goal": requests.Carrier(
                    {"do": pending.CARRIED_OUT, "drop": pending.DECLINED}, run
                )
            },
        )
        carriers.start()
        self.addCleanup(carriers.stop)
        self.goal = self.filed("Proposed by the agent", kind="goal")

    def ended(self, waiting: pending.Waiting) -> tuple:
        row = self.action(waiting.action)
        return (row["outcome"], row["ended_call"] is not None, row["ended_at"] is not None)

    def test_the_owners_choice_ends_the_action_before_its_write_is_made(self) -> None:
        for choice, outcome in (("do", "carried_out"), ("drop", "declined")):
            with self.subTest(choice=choice):
                goal = self.filed(f"Answered {choice}", kind="goal")
                waiting = self.ask(goal)
                record = self.answer(waiting.question, choice)
                self.assertEqual(outcome, record["carried_out"])
                self.assertEqual((outcome, True, True), self.ended(waiting))
                self.assertEqual((choice, outcome), self.ran[-1])
                self.assertEqual([], pending.open_on(self.conn, self.id(goal)))

    def test_an_own_variant_or_a_point_nothing_carries_is_refused_and_nothing_written(
        self,
    ) -> None:
        waiting = self.ask(self.goal)
        before = self.counts()
        with self.assertRaises(model.PlanningError) as refused:
            self.answer(waiting.question, "maybe")
        self.assertEqual("answer answer does not match its field", str(refused.exception))
        self.assertEqual(before, self.counts())
        self.assertEqual((None, False, False), self.ended(waiting))
        # The review of findings asks at its own point, which nothing here carries out.
        task = self.filed("Nothing carries this point")
        other = self.ask(
            task,
            pending.Proposal("group", {"items": [self.id(task)]}, f"accept {task}"),
            point="finding",
            purpose="triage",
        )
        before = self.counts()
        with self.assertRaises(model.PlanningError) as nothing:
            self.answer(other.question, "do")
        self.assertEqual(before, self.counts())
        self.assertIsNone(self.action(other.action)["outcome"])
        self.assertTrue(
            str(nothing.exception).startswith(
                "[purpose] this build carries out no answer on finding"
            )
        )
        self.assertEqual("pending", self.request(other.question)["status"])
        self.assertEqual([], self.ran)

    def test_an_action_that_no_longer_applies_is_dropped_and_the_answer_stands(self) -> None:
        # The stage asked about is accepted with the goal over it, which the person
        # takes on: their move answers the questions on that goal, not the stage's.
        stage = self.filed("A stage of it", kind="stage", parent=self.goal)
        waiting = self.ask(stage)
        self.person("/api/planning/work-item/apply", id=self.goal, transition={"state": "ready"})
        self.assertIsNotNone(service.get_work_item(self.conn, stage)["acceptance"])
        record = self.answer(waiting.question, "do")
        self.assertEqual("dropped", record["carried_out"])
        stored = self.request(waiting.question)
        self.assertEqual(
            ("answered", {"answer": "do"}), (stored["status"], json.loads(stored["answers_json"]))
        )
        self.assertEqual(("dropped", True, True), self.ended(waiting))
        [detail] = self.events(stage, "action_dropped")
        self.assertTrue(detail.startswith("proposed_goal: "), detail)
        self.assertEqual([], self.ran)

    def test_the_asker_withdraws_the_action_with_every_question_of_it(self) -> None:
        waiting = self.ask(self.goal)
        # A request of the same action asked of another session ends with it; that
        # session has made a call, so it can be addressed.
        with calls.bind(OTHER, "claim_ready_work_item"):
            calls.call_id(self.conn, None)
        with calls.bind(AGENT, "create_work_item"):
            asked = questions.ask(
                self.conn,
                self.id(self.goal),
                kind="question",
                prompt="Do you agree?",
                fields=request_model.fields(FIELDS),
                author="claude",
                purpose="consent",
                addressee="session-b",
                action_id=waiting.action,
            )
        self.conn.commit()
        record = self.withdraw(waiting.question)
        self.assertEqual("withdrawn", record["carried_out"])
        self.assertEqual(("withdrawn", True, True), self.ended(waiting))
        self.assertEqual(
            ("expired", "withdrawn"),
            tuple(self.request(asked)[name] for name in ("status", "expired_reason")),
        )
        self.assertEqual([], self.events(self.goal, "action_dropped"))
        with self.assertRaises(model.NotAskerError):
            self.withdraw(self.ask(self.filed("Another", kind="goal")).question, by=OTHER)


class ApplicabilityTests(Harness):
    def test_a_proposed_goal_applies_while_it_lies_unaccepted_in_triage(self) -> None:
        goal = self.filed("Proposed", kind="goal")
        waiting = self.ask(goal)
        self.assertIsNone(self.applies(waiting))
        self.person("/api/planning/work-item/apply", id=goal, transition={"state": "ready"})
        self.assertIsNotNone(self.applies(waiting))

    def test_a_task_in_a_goal_applies_while_the_goal_is_accepted_and_the_task_stayed(
        self,
    ) -> None:
        accepted = self.filed("Accepted goal", kind="goal", by=calls.browser())
        proposed = self.filed("Proposed goal", kind="goal")
        task = self.filed("A finding")
        before = service.get_work_item(self.conn, task)["parent_id"]
        moving = self.ask(
            task,
            pending.Proposal(
                "parent",
                {"parent": self.id(accepted)},
                f"move {task} under {accepted}",
                seen={"parent": before},
            ),
            point="task_in_goal",
            purpose="task",
        )
        self.assertIsNone(self.applies(moving))
        self.person("/api/planning/work-item/update", id=task, parent=proposed)
        self.assertEqual("the task moved", self.applies(moving))
        other = self.filed("Another finding")
        under = self.ask(
            other,
            pending.Proposal("parent", {"parent": self.id(proposed)}, f"move {other}"),
            point="task_in_goal",
            purpose="task",
        )
        self.assertEqual("the goal is not accepted", self.applies(under))

    def test_a_cancel_applies_while_nothing_new_or_changed_stands_in_what_it_closes(
        self,
    ) -> None:
        goal = self.filed("Goal to cancel", kind="goal", by=calls.browser())
        first = self.filed("First under it", parent=goal, by=calls.browser())
        self.filed("Second under it", parent=goal, by=calls.browser())
        row = self.row(goal)
        waiting = self.ask(
            goal,
            pending.Proposal(
                "transition",
                {"state": "cancelled"},
                f"cancel {goal}",
                seen=pending.cancel_seen(self.conn, row),
            ),
            point="cancel_outside",
            purpose="cancel",
        )
        self.assertIsNone(self.applies(waiting))
        # Work that left the list does not stand in the way.
        self.person(
            "/api/planning/work-item/apply",
            id=first,
            summary={"done": "Not needed", "next": "Nothing"},
            transition={"state": "cancelled", "reason": "covered elsewhere"},
        )
        self.assertIsNone(self.applies(waiting))
        # New work under it does.
        self.filed("Third under it", parent=goal, by=calls.browser())
        self.assertEqual("the work it cancels changed since", self.applies(waiting))

    def test_a_condition_applies_while_each_step_it_changes_stands_as_asked(self) -> None:
        goal = self.filed("Goal with conditions", kind="goal", by=calls.browser())
        self.person("/api/planning/work-item/apply", id=goal, checklist=["X", "Y"])
        steps = service.get_work_item(self.conn, goal)["checklist"]
        waiting = self.ask(
            goal,
            pending.Proposal(
                "checklist",
                {"remove": [steps[0]["id"]]},
                "remove a step",
                proposed={
                    "removed": [{"id": steps[0]["id"], "text": "X"}],
                    "rewritten": [{"id": steps[1]["id"], "from": "Y", "to": "Y, said better"}],
                },
            ),
            point="condition",
            purpose="condition",
        )
        self.assertIsNone(self.applies(waiting))
        # The owner rewrites the step the action would rewrite.
        self.person("/api/planning/work-item/apply", id=goal, checklist=["X", "Y2"])
        self.assertEqual("a step it changes was changed since", self.applies(waiting))

    def test_putting_off_a_goal_applies_while_it_is_accepted(self) -> None:
        accepted = self.filed("Accepted", kind="goal", by=calls.browser())
        proposed = self.filed("Proposed", kind="goal")
        defer = pending.Proposal("defer", {"until": "2026-12-01T00:00:00Z"}, "put it off")
        self.assertIsNone(self.applies(self.ask(accepted, defer, point="goal_defer")))
        self.assertEqual(
            "it is not accepted", self.applies(self.ask(proposed, defer, point="goal_defer"))
        )

    def test_a_goals_close_applies_while_it_awaits_confirmation(self) -> None:
        goal = self.filed("Goal closing", kind="goal", by=calls.browser())
        task = self.filed("Its one task", parent=goal, by=calls.browser())
        close = pending.Proposal("transition", {"state": "done"}, f"close {goal}")
        waiting = self.ask(goal, close, point="goal_close", purpose="confirm")
        self.assertEqual("it no longer awaits confirmation", self.applies(waiting))
        self.person(
            "/api/planning/work-item/apply",
            id=task,
            summary={"done": "Done", "next": "Nothing"},
            transition={"state": "done"},
        )
        self.assertIsNone(self.applies(waiting))


class EndTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.survivor = self.filed("The one that stays")
        self.merged = self.filed("Its duplicate")
        self.waiting = self.ask(
            self.merged,
            pending.Proposal("transition", {"state": "cancelled"}, "cancel the duplicate"),
            point="cancel_outside",
            purpose="cancel",
        )
        with calls.bind(AGENT, "create_work_item_request"):
            self.plain = requests.create(
                self.conn, self.merged, kind="question", prompt="Which road?", fields=FIELDS
            )["request_id"]
        self.conn.commit()

    def test_a_merge_drops_the_action_and_ends_its_question_where_it_was(self) -> None:
        self.person(
            "/api/planning/work-item/merge", id=self.survivor, items=[self.merged], reason="one"
        )
        row = self.action(self.waiting.action)
        self.assertEqual(("dropped", self.id(self.merged)), (row["outcome"], row["work_item_id"]))
        self.assertEqual(
            ["cancel_outside: merged into ALPHA-1"], self.events(self.merged, "action_dropped")
        )
        question = self.request(self.waiting.question)
        self.assertEqual(
            ("expired", "item_cancelled", self.id(self.merged)),
            (question["status"], question["expired_reason"], question["work_item_id"]),
        )
        self.assertIn(self.waiting.question, self.events(self.merged, "request_expired"))
        # The question about the work itself moves to the survivor and waits there.
        plain = self.request(self.plain)
        self.assertEqual(
            ("pending", self.id(self.survivor)), (plain["status"], plain["work_item_id"])
        )
        # What the person's merge said of the duplicate: the dropped action beside the
        # withdrawn question, the one told as news, not as where the work stands.
        told = {
            entry["kind"]
            for entry in person_events.since_last_agent_write(self.conn, self.id(self.merged))
        }
        self.assertLessEqual({"action_dropped", "question_withdrawn"}, told)
        self.assertNotIn("action_dropped", person_events.WORK_KINDS)

    def test_a_close_drops_the_action_and_its_question_ends_as_the_item_closed(self) -> None:
        self.person(
            "/api/planning/work-item/apply",
            id=self.merged,
            summary={"done": "Not needed", "next": "Nothing"},
            transition={"state": "cancelled", "reason": "not needed"},
        )
        self.assertEqual("dropped", self.action(self.waiting.action)["outcome"])
        self.assertEqual(
            ["cancel_outside: the item closed in cancelled"],
            self.events(self.merged, "action_dropped"),
        )
        self.assertEqual(
            ("expired", "item_cancelled"),
            tuple(
                self.request(self.waiting.question)[name] for name in ("status", "expired_reason")
            ),
        )

    def test_a_delete_takes_the_action_and_its_questions_with_the_item(self) -> None:
        identity = self.id(self.merged)
        with calls.bind(calls.browser(), "/api/planning/work-item/delete"):
            service.delete_work_item(self.conn, self.merged)
        self.conn.commit()
        for table in ("pending_actions", "work_item_requests"):
            found = self.conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE work_item_id = ?", (identity,)
            ).fetchone()[0]
            self.assertEqual(0, found, table)


#: The clock these scenarios run at, the day a goal is put off until, and a moment
#: after it has come, when the sweep brings the goal back.
NOW = datetime(2026, 11, 17, 9, 30, tzinfo=UTC)
UNTIL = "2026-11-18"
CAME = datetime(2026, 11, 18, 0, 0, 1, tzinfo=UTC)


class SettingHarness(Harness):
    """Scenarios at a setting of the space, at a fixed clock, through the agent's tools."""

    def setUp(self) -> None:
        super().setUp()
        clock = mock.patch.object(leases, "utc_now", lambda: NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.space = service.space_identity(self.conn, "ALPHA")

    def at(self, name: str) -> None:
        participation.write_set(self.conn, self.space, name)
        self.conn.commit()

    def tool(self, name: str, **arguments: object) -> dict:
        """The agent's call of a planning tool, and its answer."""

        try:
            with calls.bind(AGENT, name):
                answer = tools.OPS[name](self.conn, arguments)
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def card(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def decided(self) -> list[tuple[str, str, str]]:
        return [
            (entry["point"], entry["item"]["reference"], entry["what"])
            for entry in decisions.page(self.conn, space=self.space)["items"]
        ]

    def waiting_on(self, reference: str) -> list[pending.Action]:
        return pending.open_on(self.conn, self.id(reference))

    def owners_list(self) -> list[str]:
        """The questions waiting for the owner's answer, everywhere."""

        return [str(row["request_id"]) for row in questions.open_rows(self.conn)]

    def returned_goal(self) -> tuple[str, str]:
        """An accepted goal with a task under it that B works on, put off by A and
        brought back by the sweep after its day: the goal and the task."""

        goal = self.filed("A goal put off", kind="goal", by=calls.browser())
        task = self.filed("Work going on under it", parent=goal, by=calls.browser())
        self.person("/api/planning/work-item/apply", id=task, checklist=["X"])
        with calls.bind(OTHER, "claim_work_item"):
            service.claim_work_item(self.conn, task, author="claude")
        with calls.bind(AGENT, "apply_work_item_changes"):
            service.defer_work_item(
                self.conn, goal, until=UNTIL, reason="waits for the next release", author="claude"
            )
        self.conn.commit()
        self.before_return = self.followers(goal)
        with mock.patch.object(leases, "utc_now", lambda: CAME):
            done = sweep.run_pass(self.conn)
        self.assertEqual({sweep.RETURNS: 1}, done.changed)
        card = self.card(goal)
        self.assertEqual("triage", card["state"]["category"])
        self.assertEqual(1, len(self.events(goal, "returned")))
        return goal, task


class ProposedGoalTests(SettingHarness):
    """A goal an agent files with no parent, and a goal that comes back from being put
    off: by the owner's setting of its space the agent's decision stands, as the basis
    `agent` marked in the summary of decisions, or the owner is asked the question
    `goal`, whose answers `do`, `later` and `drop` take it on, put it off or cancel it."""

    def propose(self, title: str = "A goal of the agent's own", **arguments: object) -> dict:
        """The agent files a goal with no parent through its tool, and the answer."""

        return self.tool("create_work_item", space="ALPHA", title=title, kind="goal", **arguments)

    # -- the goal an agent proposes ---------------------------------------------------

    def test_an_agent_goal_is_accepted_when_the_agent_decides(self) -> None:
        self.at(participation.MINIMAL)
        answer = self.propose()
        card = self.card("ALPHA-1")
        self.assertEqual(
            (None, "not_started", "agent"),
            (card["state"], card["container_state"], card["acceptance"]["basis"]),
        )
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual([], self.waiting_on("ALPHA-1"))
        self.assertEqual([], self.owners_list())
        self.assertEqual([("proposed_goal", "ALPHA-1", "accepted ALPHA-1")], self.decided())
        # The mark stands on the event that recorded the acceptance.
        [entry] = decisions.page(self.conn, space=self.space)["items"]
        marked = self.conn.execute(
            "SELECT action, detail FROM work_item_events WHERE id = ?", (entry["event_id"],)
        ).fetchone()
        self.assertEqual(("accepted", "agent"), tuple(marked))

    def test_an_agent_goal_waits_for_the_owner(self) -> None:
        answer = self.propose()
        card = self.card("ALPHA-1")
        self.assertEqual(("triage", None), (card["state"]["category"], card["acceptance"]))
        [action] = self.waiting_on("ALPHA-1")
        waits = answer["waits_for_owner"]
        self.assertEqual(
            {
                "action": action.id,
                "point": "proposed_goal",
                "question": waits["question"],
                "what": "accepted ALPHA-1",
            },
            waits,
        )
        question = self.request(waits["question"])
        self.assertEqual(
            ("goal", action.id, None, "pending"),
            (question["purpose"], question["action_id"], question["addressee"], question["status"]),
        )
        self.assertEqual([waits["question"]], self.owners_list())
        [choice, until, cancels] = json.loads(question["fields_json"])
        self.assertEqual(
            [("do", True), ("later", False), ("drop", False)],
            [(option["id"], bool(option.get("recommended"))) for option in choice["options"]],
        )
        self.assertEqual(
            [("until", "later"), ("cancels", "drop")],
            [(field["id"], field["under"]["option"]) for field in (until, cancels)],
        )
        self.assertEqual([("session-a", "", 1)], self.followers("ALPHA-1"))
        self.assertEqual([], self.decided())

    def test_an_assignment_passes_and_is_summarised(self) -> None:
        self.at(participation.MAXIMAL)
        answer = self.propose(acceptance="assignment")
        card = self.card("ALPHA-1")
        self.assertEqual(
            ("not_started", "assignment"), (card["container_state"], card["acceptance"]["basis"])
        )
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual(([], []), (self.waiting_on("ALPHA-1"), self.owners_list()))
        self.assertEqual([("assignment", "ALPHA-1", "accepted ALPHA-1")], self.decided())

    def test_the_owners_own_goal_and_a_stage_meet_no_gate(self) -> None:
        # The owner's word, and work under a goal, are no goal an agent proposes.
        goal = self.filed("The owner's goal", kind="goal", by=calls.browser())
        self.at(participation.MANUAL)
        with calls.bind(AGENT, "create_work_item"):
            stage = service.create_work_item(
                self.conn, space="ALPHA", title="A stage", kind="stage", parent=goal
            )
        self.conn.commit()
        self.assertEqual("owner", self.card(goal)["acceptance"]["basis"])
        self.assertEqual("inherited", stage["acceptance"]["basis"])
        self.assertNotIn("waits_for_owner", stage)
        self.assertEqual([], self.owners_list())

    # -- the owner's answers ----------------------------------------------------------

    def proposed_with_work(self) -> tuple[str, str]:
        """A goal waiting for the owner and a task the agent filed under it meanwhile."""

        waits = self.propose()["waits_for_owner"]
        task = self.filed("Work under the proposed goal", parent="ALPHA-1")
        self.assertEqual("triage", self.card(task)["state"]["category"])
        return waits["question"], task

    def test_do_accepts_the_goal_and_tells_the_asker(self) -> None:
        question, task = self.proposed_with_work()
        record = self.answer(question, "do")
        self.assertEqual("carried_out", record["carried_out"])
        goal = self.card("ALPHA-1")
        self.assertEqual(
            (None, "not_started", "owner"),
            (goal["state"], goal["container_state"], goal["acceptance"]["basis"]),
        )
        under = self.card(task)
        self.assertEqual(
            ("ready", "inherited"), (under["state"]["category"], under["acceptance"]["basis"])
        )
        self.assertEqual("carried_out", self.action(record["action"]["id"])["outcome"])
        # The asker follows the goal and hears the answer and the acceptance on it.
        told = {
            entry["kind"]
            for entry in person_events.since_last_agent_write(self.conn, self.id("ALPHA-1"))
        }
        self.assertLessEqual({"question_answered", "status"}, told)
        self.assertIn(("session-a", "", 1), self.followers("ALPHA-1"))
        # The owner took it on: nothing goes into the summary of agent decisions.
        self.assertEqual([], self.decided())

    def test_drop_cancels_the_goal_by_its_list(self) -> None:
        question, task = self.proposed_with_work()
        before = self.counts()
        with self.assertRaises(model.PlanningError) as caught:
            self.answer(question, "drop")
        status, body = api.error_response(caught.exception)
        self.assertEqual((409, "cancel_list"), (status, body["error"]["code"]))
        self.assertEqual([task], [entry["reference"] for entry in body["error"]["cancels"]])
        self.assertEqual(before, self.counts())
        self.assertEqual("pending", self.request(question)["status"])
        token = requests.get(self.conn, question)["action"]["cancel_list"]["list_token"]
        self.assertEqual(body["error"]["list_token"], token)
        record = self.answer(question, "drop", cancels=token)
        self.assertEqual("declined", record["carried_out"])
        self.assertEqual(
            ["cancelled", "cancelled"],
            [self.card(reference)["state"]["category"] for reference in ("ALPHA-1", task)],
        )

    def test_later_puts_the_goal_off(self) -> None:
        question, _task = self.proposed_with_work()
        record = self.answer(question, "later", until=UNTIL)
        self.assertEqual("declined", record["carried_out"])
        goal = self.card("ALPHA-1")
        self.assertEqual(("deferred", None), (goal["state"]["category"], goal["acceptance"]))
        self.assertTrue(goal["deferred"]["until"].startswith(UNTIL), goal["deferred"])

    # -- the goal that comes back -----------------------------------------------------

    def test_a_returned_goal_asks_the_owner_when_proposed_goals_are_theirs(self) -> None:
        goal, task = self.returned_goal()
        [action] = self.waiting_on(goal)
        self.assertEqual(("proposed_goal", "accept"), (action.point, action.kind))
        asked = self.conn.execute(
            "SELECT identity_source, tool FROM execution_events WHERE id = ?", (action.asked_call,)
        ).fetchone()
        self.assertEqual((calls.VALKAMA, "deferral-return"), tuple(asked))
        [question] = self.owners_list()
        record = requests.get(self.conn, question)
        self.assertEqual(("goal", "Valkama"), (record["purpose"], record["action"]["asked_by"]))
        choice = json.loads(self.request(question)["fields_json"])[0]
        self.assertFalse(any(option.get("recommended") for option in choice["options"]))
        self.assertEqual(self.before_return, self.followers(goal))
        # The work under it stays accepted and held: its holder takes a step of it.
        step = self.card(task)["checklist"][0]["id"]
        with calls.bind(OTHER, "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, task, step, author="claude")
        self.conn.commit()
        record = self.answer(question, "do")
        self.assertEqual("carried_out", record["carried_out"])
        card = self.card(goal)
        self.assertEqual(
            (None, "in_progress", "owner"),
            (card["state"], card["container_state"], card["acceptance"]["basis"]),
        )
        self.assertEqual("carried_out", self.action(action.id)["outcome"])

    def test_a_returned_goal_waits_for_triage_when_the_agent_decides(self) -> None:
        self.at(participation.MINIMAL)
        goal, _task = self.returned_goal()
        self.assertEqual([], self.waiting_on(goal))
        self.assertEqual([], self.owners_list())
        self.assertIsNone(self.card(goal)["acceptance"])
        self.assertEqual(
            participation.AGENT, participation.load(self.conn).mode(self.space, "proposed_goal")
        )


class TaskInGoalTests(SettingHarness):
    """A task an agent files in an accepted goal, or moves there: by the owner's setting
    of its space it is accepted with the goal, `inherited` and marked `task_in_goal` in
    the summary of decisions, or the owner is asked the question `task`, whose answers
    `do`, `later`, `out` and `drop` take it on, put it off under the goal, keep it out of
    the goal or cancel it. The goal is the owner's, so it stands accepted."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.filed("The owner's goal", kind="goal", by=calls.browser())

    def file_in_goal(self, title: str, **more: object) -> dict:
        return self.tool("create_work_item", space="ALPHA", title=title, parent=self.goal, **more)

    def ready_elsewhere(self, title: str) -> str:
        """A ready task the owner filed outside the goal."""

        task = self.filed(title, by=calls.browser())
        self.assertEqual("ready", self.card(task)["state"]["category"])
        return task

    def test_a_task_in_an_accepted_goal_is_inherited(self) -> None:
        answer = self.file_in_goal("Work inside the goal")
        task = str(answer["reference"])
        card = self.card(task)
        self.assertEqual(
            ("ready", "inherited", self.id(self.goal)),
            (card["state"]["category"], card["acceptance"]["basis"], card["parent_id"]),
        )
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual(([], []), (self.waiting_on(task), self.owners_list()))
        # A finding the agent moves into the goal is filed there, and summarised the same way.
        finding = self.filed("A finding")
        moved = self.tool("apply_work_item_changes", id=finding, update={"parent": self.goal})
        self.assertNotIn("waits_for_owner", moved)
        self.assertEqual(
            ("ready", "inherited"),
            (self.card(finding)["state"]["category"], self.card(finding)["acceptance"]["basis"]),
        )
        self.assertEqual(
            [
                ("task_in_goal", finding, f"accepted {finding} under {self.goal}"),
                ("task_in_goal", task, f"accepted {task} under {self.goal}"),
            ],
            self.decided(),
        )
        marked = [
            str(row[0])
            for row in self.conn.execute(
                "SELECT e.action FROM agent_decisions d JOIN work_item_events e"
                " ON e.id = d.event_id ORDER BY e.id"
            )
        ]
        self.assertEqual(["accepted", "accepted"], marked)
        # A ready task moved in was accepted before: nothing is decided, nothing marked.
        ready = self.ready_elsewhere("Ready elsewhere")
        self.tool("apply_work_item_changes", id=ready, update={"parent": self.goal})
        self.assertEqual(self.id(self.goal), self.card(ready)["parent_id"])
        self.assertEqual(2, len(self.decided()))

    def manual_tasks(self) -> tuple[dict, dict, str]:
        """At the manual set: the answer filing a task in the goal, the answer moving the
        ready task u there, and u."""

        self.at(participation.MANUAL)
        filed = self.file_in_goal("A new task in the goal")
        moving = self.ready_elsewhere("Ready task u")
        moved = self.tool("apply_work_item_changes", id=moving, update={"parent": self.goal})
        return filed, moved, moving

    def test_manual_work_asks_for_every_task_in_a_goal(self) -> None:
        filed, moved, moving = self.manual_tasks()
        task = str(filed["reference"])
        card = self.card(task)
        self.assertEqual(
            ("triage", None, self.id(self.goal)),
            (card["state"]["category"], card["acceptance"], card["parent_id"]),
        )
        [action] = self.waiting_on(task)
        self.assertEqual(
            {
                "action": action.id,
                "point": "task_in_goal",
                "question": filed["waits_for_owner"]["question"],
                "what": f"accepted {task} under {self.goal}",
            },
            filed["waits_for_owner"],
        )
        question = self.request(filed["waits_for_owner"]["question"])
        self.assertEqual(
            ("task", action.id, None, "pending"),
            (question["purpose"], question["action_id"], question["addressee"], question["status"]),
        )
        [choice, until] = json.loads(question["fields_json"])
        self.assertEqual(
            [("do", True), ("later", False), ("out", False), ("drop", False)],
            [(option["id"], bool(option.get("recommended"))) for option in choice["options"]],
        )
        self.assertEqual(("until", "later"), (until["id"], until["under"]["option"]))
        # The ready task moved under the goal stays where it was, and waits on its own question.
        card = self.card(moving)
        self.assertEqual(("ready", None), (card["state"]["category"], card["parent_id"]))
        waits = moved["waits_for_owner"]
        self.assertEqual(
            ("task_in_goal", f"moved {moving} under {self.goal}"), (waits["point"], waits["what"])
        )
        self.assertEqual("task", self.request(waits["question"])["purpose"])
        self.assertEqual(
            [filed["waits_for_owner"]["question"], waits["question"]], self.owners_list()
        )
        self.assertEqual("parent", self.waiting_on(moving)[0].kind)
        # Filed with a link, the task still says what it waits for.
        linked = self.file_in_goal("A linked task", links=[{"other": task, "kind": "relates-to"}])
        self.assertEqual("task_in_goal", linked["waits_for_owner"]["point"])
        # Nothing the agent decided alone: the summary of decisions stays empty.
        self.assertEqual([], self.decided())

    def test_the_four_answers_to_a_task_in_a_goal(self) -> None:
        filed, moved, moving = self.manual_tasks()
        taken = str(filed["reference"])
        outside = self.file_in_goal("A task that belongs elsewhere")
        dropped = self.file_in_goal("A task nobody needs")
        out_task, drop_task = str(outside["reference"]), str(dropped["reference"])
        answered = {
            taken: self.answer(filed["waits_for_owner"]["question"], "do"),
            moving: self.answer(moved["waits_for_owner"]["question"], "later", until=UNTIL),
            out_task: self.answer(outside["waits_for_owner"]["question"], "out"),
            drop_task: self.answer(dropped["waits_for_owner"]["question"], "drop"),
        }
        self.assertEqual(
            {taken: "carried_out", moving: "declined", out_task: "declined", drop_task: "declined"},
            {reference: record["carried_out"] for reference, record in answered.items()},
        )
        goal = self.id(self.goal)
        do = self.card(taken)
        self.assertEqual(
            ("ready", "inherited", goal),
            (do["state"]["category"], do["acceptance"]["basis"], do["parent_id"]),
        )
        later = self.card(moving)
        self.assertEqual(
            ("deferred", None, goal),
            (later["state"]["category"], later["acceptance"], later["parent_id"]),
        )
        self.assertTrue(later["deferred"]["until"].startswith(UNTIL), later["deferred"])
        out = self.card(out_task)
        self.assertEqual(
            ("triage", None, None),
            (out["state"]["category"], out["acceptance"], out["parent_id"]),
        )
        self.assertIn(
            ("discovered-from", self.goal),
            {(link["kind"], link["reference"]) for link in out["links"]},
        )
        drop = self.card(drop_task)
        self.assertEqual(("cancelled", goal), (drop["state"]["category"], drop["parent_id"]))
        self.assertEqual("cancelled: owner: not needed", self.events(drop_task, "transitioned")[-1])
        # Every action ended with its answer, and the owner's answers are not the agent's.
        self.assertEqual(
            [], [self.waiting_on(reference) for reference in answered if self.waiting_on(reference)]
        )
        self.assertEqual([], self.owners_list())
        self.assertEqual([], self.decided())


#: The batch an agent cancels an item with: its summary, and the move with its reason.
SUMMARY = {"done": "Nothing: another item covers it.", "next": "Nothing."}
REASON = "covered by another item"
#: How a refusal reaches a caller: a single write's, or a batch's naming its step.
REFUSED = (model.PlanningError, api.PlanningHttpError)


class CancelOutsideTests(SettingHarness):
    """An agent's cancel of an item its own work did not file: by the owner's setting of
    its space it is made and marked `cancel_outside` in the summary of decisions, or it
    waits on the owner's question `cancel`, whose answers `cancel` and `keep` make it or
    leave the item. A cancel that follows an owner's answer asks nothing. The task lies
    under the owner's accepted goal, filed there by the session `session-b`, which holds
    nothing and is no live session."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.filed("The owner's goal", kind="goal", by=calls.browser())
        self.task = self.filed("Filed by another session", parent=self.goal, by=OTHER)

    def cancel(self, reference: str, **transition: object) -> dict:
        return self.tool(
            "apply_work_item_changes",
            id=reference,
            summary=SUMMARY,
            transition={"state": "cancelled", "reason": REASON, **transition},
        )

    def category(self, reference: str) -> str:
        return str(self.card(reference)["state"]["category"])

    def waits_at_maximal(self) -> dict:
        """At the maximal set the agent's cancel of the task waits; its `waits_for_owner`."""

        self.at(participation.MAXIMAL)
        return self.cancel(self.task)["waits_for_owner"]

    def decided(self) -> list[tuple[str, str, str]]:
        """The cancels in the summary of decisions; filing the task in the goal is there too."""

        return [entry for entry in super().decided() if entry[0] == "cancel_outside"]

    def told(self, reference: str) -> set[str]:
        return {
            entry["kind"]
            for entry in person_events.since_last_agent_write(self.conn, self.id(reference))
        }

    # -- the setting ------------------------------------------------------------------

    def test_cancelling_another_sessions_item_by_the_default(self) -> None:
        answer = self.cancel(self.task)
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual("cancelled", self.category(self.task))
        self.assertEqual(([], []), (self.waiting_on(self.task), self.owners_list()))
        self.assertEqual([("cancel_outside", self.task, f"cancel {self.task}")], self.decided())
        [entry] = decisions.page(self.conn, space=self.space, points=["cancel_outside"])["items"]
        marked = self.conn.execute(
            "SELECT action, detail FROM work_item_events WHERE id = ?", (entry["event_id"],)
        ).fetchone()
        self.assertEqual(("transitioned", f"cancelled: {REASON}"), tuple(marked))

    def test_cancelling_another_sessions_item_waits_at_maximal(self) -> None:
        before = self.card(self.task)
        waits = self.waits_at_maximal()
        card = self.card(self.task)
        self.assertEqual(
            (before["state"]["key"], "Nothing: another item covers it."),
            (card["state"]["key"], card["summary"]["done"]),
        )
        [action] = self.waiting_on(self.task)
        self.assertEqual(
            {
                "action": action.id,
                "point": "cancel_outside",
                "question": waits["question"],
                "what": f"cancel {self.task}",
            },
            waits,
        )
        self.assertEqual(
            ("transition", {"state": "cancelled", "reason": REASON}, REASON),
            (action.kind, action.params, action.reason),
        )
        question = self.request(waits["question"])
        self.assertEqual(
            ("cancel", action.id, None, "pending"),
            (question["purpose"], question["action_id"], question["addressee"], question["status"]),
        )
        self.assertIn(REASON, question["prompt"])
        [choice, cancels] = json.loads(question["fields_json"])
        self.assertEqual(
            [("cancel", True), ("keep", False)],
            [(option["id"], bool(option.get("recommended"))) for option in choice["options"]],
        )
        self.assertEqual(("cancels", "cancel"), (cancels["id"], cancels["under"]["option"]))
        self.assertEqual([waits["question"]], self.owners_list())
        self.assertIn(("session-a", "", 1), self.followers(self.task))
        record = requests.get(self.conn, waits["question"])
        self.assertEqual(
            ("cancel_outside", {"state": "cancelled"}, REASON),
            tuple(record["action"][name] for name in ("point", "proposed", "reason")),
        )
        self.assertEqual([], self.decided())
        # The same cancel sent again answers the same wait and asks nothing more.
        asked = self.counts()[:2]
        again = self.tool(
            "apply_work_item_changes",
            id=self.task,
            transition={"state": "cancelled", "reason": REASON},
        )
        self.assertEqual(waits, again["waits_for_owner"])
        self.assertEqual(asked, self.counts()[:2])

    def test_an_item_of_the_current_work_is_cancelled_freely(self) -> None:
        self.at(participation.MANUAL)
        # Filed by a subagent of the session: the session's own work.
        own = self.filed("Filed by the agent's own work", by=SUBAGENT)
        answer = self.cancel(own)
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual("cancelled", self.category(own))
        self.assertEqual(([], [], []), (self.waiting_on(own), self.owners_list(), self.decided()))

    def test_a_persons_cancel_meets_no_gate(self) -> None:
        self.at(participation.MANUAL)
        self.person(
            "/api/planning/work-item/apply",
            id=self.task,
            summary=SUMMARY,
            transition={"state": "cancelled", "reason": REASON},
        )
        self.assertEqual("cancelled", self.category(self.task))
        self.assertEqual(([], []), (self.owners_list(), self.decided()))

    # -- the owner's answers ----------------------------------------------------------

    def test_the_owner_answers_a_cancel(self) -> None:
        waits = self.waits_at_maximal()
        record = self.answer(waits["question"], "cancel")
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual("cancelled", self.category(self.task))
        self.assertEqual(f"cancelled: {REASON}", self.events(self.task, "transitioned")[-1])
        self.assertEqual("carried_out", self.action(waits["action"])["outcome"])
        # The asker follows the task and hears the answer and the cancel.
        self.assertLessEqual({"question_answered", "status"}, self.told(self.task))
        self.assertIn(("session-a", "", 1), self.followers(self.task))
        # The owner made it: nothing goes into the summary of agent decisions.
        self.assertEqual([], self.decided())
        # In another run the owner keeps the item.
        kept = self.filed("Another filed by another session", parent=self.goal, by=OTHER)
        question = self.cancel(kept)["waits_for_owner"]["question"]
        before = self.card(kept)["state"]
        record = self.answer(question, "keep")
        self.assertEqual("declined", record["carried_out"])
        self.assertEqual(before, self.card(kept)["state"])
        self.assertEqual(([], []), (self.waiting_on(kept), self.owners_list()))

    def test_an_action_that_no_longer_applies_is_dropped(self) -> None:
        waits = self.waits_at_maximal()
        with calls.bind(OTHER, "claim_work_item"):
            service.claim_work_item(self.conn, self.task, author="claude")
        self.conn.commit()
        record = self.answer(waits["question"], "cancel")
        self.assertEqual("dropped", record["carried_out"])
        stored = self.request(waits["question"])
        self.assertEqual(
            ("answered", "cancel"),
            (stored["status"], json.loads(stored["answers_json"])["answer"]),
        )
        self.assertEqual("dropped", self.action(waits["action"])["outcome"])
        self.assertEqual(
            ["cancel_outside: the item changed since"], self.events(self.task, "action_dropped")
        )
        card = self.card(self.task)
        self.assertEqual("active", card["state"]["category"])
        self.assertIn("session-b", card["claim_ref"])

    def test_a_changed_list_is_the_owners_to_confirm(self) -> None:
        # The owner's goal, with the task under it. A goal another live session filed is
        # followed by it, and a cancel of work a live session follows is that session's
        # to hear first.
        self.at(participation.MAXIMAL)
        goal, first = self.goal, self.task
        with self.assertRaises(REFUSED) as listed:
            self.cancel(goal)
        token = api.error_response(listed.exception)[1]["error"]["list_token"]
        question = self.cancel(goal, cancels=token)["waits_for_owner"]["question"]
        # Work filed under it meanwhile: the answer is refused with the list as it stands.
        second = self.filed("Filed under it meanwhile", parent=goal, by=OTHER)
        before = self.counts()
        with self.assertRaises(REFUSED) as changed:
            self.answer(question, "cancel")
        status, body = api.error_response(changed.exception)
        self.assertEqual((409, "cancel_list"), (status, body["error"]["code"]))
        self.assertEqual(
            [first, second], [entry["reference"] for entry in body["error"]["cancels"]]
        )
        self.assertEqual(before, self.counts())
        # The owner confirms the list as it stands, by the token the question reads.
        token = requests.get(self.conn, question)["action"]["cancel_list"]["list_token"]
        self.assertEqual(body["error"]["list_token"], token)
        record = self.answer(question, "cancel", cancels=token)
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual(
            ["cancelled"] * 3, [self.category(reference) for reference in (goal, first, second)]
        )

    def test_a_list_that_stands_needs_no_token(self) -> None:
        self.at(participation.MAXIMAL)
        with self.assertRaises(REFUSED) as listed:
            self.cancel(self.goal)
        token = api.error_response(listed.exception)[1]["error"]["list_token"]
        question = self.cancel(self.goal, cancels=token)["waits_for_owner"]["question"]
        record = self.answer(question, "cancel")
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual(
            ["cancelled", "cancelled"],
            [self.category(reference) for reference in (self.goal, self.task)],
        )

    # -- a cancel that follows the owner's answer -------------------------------------

    def owners_question(self, on: str, by: calls.Identity | None = None) -> str:
        """A question on `on`, answered by `by`, a person when not given; its id."""

        with calls.bind(AGENT, "create_work_item_request"):
            question = str(
                requests.create(
                    self.conn, on, kind="question", prompt="Which road?", fields=FIELDS
                )["request_id"]
            )
        self.conn.commit()
        if by is None:
            self.answer(question, "drop")
            return question
        with calls.bind(by, "answer_work_item_request"):
            requests.resolve(
                self.conn,
                question,
                status="answered",
                expected_revision=int(self.request(question)["revision"]),
                answers={"answer": "drop"},
                author="claude",
            )
        self.conn.commit()
        return question

    def test_a_cancel_following_the_owners_answer_skips_the_question(self) -> None:
        self.at(participation.MAXIMAL)
        question = self.owners_question(self.goal)
        answer = self.cancel(self.task, following=question)
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual("cancelled", self.category(self.task))
        self.assertEqual(([], []), (self.waiting_on(self.task), self.owners_list()))
        self.assertEqual(
            [("cancel_outside", self.task, f"cancel {self.task} following question {question}")],
            self.decided(),
        )

    def test_following_needs_an_answer_the_owner_gave(self) -> None:
        self.at(participation.MAXIMAL)
        by_agent = self.owners_question(self.goal, by=OTHER)
        with calls.bind(AGENT, "create_work_item_request"):
            still_open = str(
                requests.create(
                    self.conn, self.goal, kind="question", prompt="Which road?", fields=FIELDS
                )["request_id"]
            )
        self.conn.commit()
        other_goal = self.filed("Another goal", kind="goal", by=calls.browser())
        elsewhere = self.owners_question(other_goal)
        before = (self.counts(), self.card(self.task)["revision"])
        for named in (by_agent, still_open, elsewhere):
            with self.subTest(named=named):
                with self.assertRaises(REFUSED) as refused:
                    self.cancel(self.task, following=named)
                status, body = api.error_response(refused.exception)
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
                self.assertEqual(
                    "transition: [participation] following names no answered question of the"
                    " owner on this item or above it",
                    body["error"]["message"],
                )
                self.assertEqual(before, (self.counts(), self.card(self.task)["revision"]))
        # Sent with any other move, it is refused as well.
        with self.assertRaises(REFUSED) as moved:
            self.tool(
                "apply_work_item_changes",
                id=self.task,
                transition={"state": "ready", "following": by_agent},
            )
        self.assertIn("[participation] following names the owner's answer", str(moved.exception))


#: A decision that recommends an answer in its one required field.
DECISION = [{**FIELDS[0], "options": [{**FIELDS[0]["options"][0], "recommended": True}]}]


class OpenDecisionTests(SettingHarness):
    def test_closing_a_task_with_an_open_question_is_refused(self) -> None:
        task = self.filed("The owner's task", by=calls.browser())
        self.tool("claim_work_item", id=task)
        asked = self.tool(
            "create_work_item_request", id=task, kind="decision", prompt="Which?", fields=DECISION
        )
        self.assertEqual([asked["request_id"]], self.owners_list())
        before = (self.counts(), self.card(task)["revision"])
        for force in (False, True):
            with self.subTest(force=force):
                with self.assertRaises(REFUSED) as refused:
                    self.tool(
                        "apply_work_item_changes",
                        id=task,
                        summary=SUMMARY,
                        transition={"state": "completed", "force": force},
                    )
                status, body = api.error_response(refused.exception)
                self.assertEqual((409, "workflow_guard"), (status, body["error"]["code"]))
                self.assertIn("[question]", body["error"]["message"])
                self.assertEqual(before, (self.counts(), self.card(task)["revision"]))
        self.assertEqual("active", self.card(task)["state"]["category"])
        self.assertEqual("pending", self.request(asked["request_id"])["status"])


#: How an agent's claim and its move of work the owner is asked whether to do are refused.
TAKE_AFTER = "take it after the answer"
WAIT_FOR = "wait for the answer; only a cancel moves it before then"


class AcceptanceQuestionTests(SettingHarness):
    """Work the owner is asked whether to do: an agent neither takes it nor moves it out of
    triage but to a cancel, while the question stands on it or, for work with no basis,
    over it; a person's claim or move is their answer. An acceptance an agent's claim or
    move makes alone is marked in the summary of decisions: an assignment, and a task in
    accepted goals that nobody triaged."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.filed("The owner's goal", kind="goal", by=calls.browser())

    def proposed(self, title: str) -> tuple[str, str]:
        """A goal the agent proposes at a setting that keeps it for the owner, and its question."""

        answer = self.tool("create_work_item", space="ALPHA", title=title, kind="goal")
        return str(answer["reference"]), str(answer["waits_for_owner"]["question"])

    def waiting_task(self, title: str) -> tuple[str, str]:
        """At the manual set, a task the agent files in the owner's goal, and its question."""

        answer = self.tool("create_work_item", space="ALPHA", title=title, parent=self.goal)
        return str(answer["reference"]), str(answer["waits_for_owner"]["question"])

    def untriaged(self, title: str) -> str:
        """A task the owner put in their goal and left in triage: nobody triaged it."""

        with calls.bind(calls.browser(), "create_work_item"):
            created = service.create_work_item(
                self.conn, space="ALPHA", title=title, parent=self.goal, state="triage"
            )
        self.conn.commit()
        self.assertEqual(("triage", None), (created["state"]["category"], created["acceptance"]))
        return str(created["reference"])

    def refusal(self, write: functools.partial) -> tuple[int, str, str]:
        """The status, code and text a write is refused with, nothing kept."""

        with self.assertRaises(REFUSED) as refused:
            write()
        status, body = api.error_response(refused.exception)
        return status, body["error"]["code"], body["error"]["message"]

    def where(self, reference: str) -> tuple[str, str | None]:
        card = self.card(reference)
        basis = card["acceptance"]["basis"] if card["acceptance"] else None
        return card["state"]["category"], basis

    def described(self, name: str) -> str:
        [tool] = [entry for entry in tools.TOOLS if entry["name"] == name]
        return str(tool["description"])

    def test_an_item_the_owner_has_not_decided_is_not_claimed(self) -> None:
        goal, held = self.returned_goal()
        [question] = self.owners_list()
        under = self.filed("Work filed under the goal that came back", parent=goal)
        self.assertEqual(("triage", None), self.where(under))
        before = self.counts()
        for force in (False, True):
            with self.subTest(force=force):
                self.assertEqual(
                    (
                        409,
                        "workflow_guard",
                        f"[acceptance_question] the owner has not decided whether {under} is to"
                        f" be done (question {question}): {TAKE_AFTER}",
                    ),
                    self.refusal(
                        functools.partial(self.tool, "claim_work_item", id=under, force=force)
                    ),
                )
        self.assertEqual(before, self.counts(), "nothing written")
        # Accepted work under the goal stays with its holder, who takes its steps.
        step = self.card(held)["checklist"][0]["id"]
        with calls.bind(OTHER, "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, held, step, author="claude")
        self.conn.commit()
        self.assertEqual("inherited", self.where(held)[1])
        # Once the owner takes the goal on, the agent takes the work under it.
        self.answer(question, "do")
        claimed = self.tool("claim_work_item", id=under)
        self.assertEqual(("active", "inherited"), self.where(under))
        self.assertEqual("ready", claimed["started"]["from"])
        # The tool says so before the agent calls.
        self.assertIn(
            "Refused while the owner has not answered whether the item, or the goal or stage"
            " over an item not yet accepted, is to be done (acceptance_question).",
            self.described("claim_work_item"),
        )

    def test_a_persons_claim_is_their_answer_and_the_goals_question_stays(self) -> None:
        goal, question = self.proposed("A goal the agent proposes")
        under = self.filed("Work under the proposed goal", parent=goal)
        self.person("/api/planning/work-item/claim", id=under)
        self.assertEqual(("active", "owner"), self.where(under))
        self.assertEqual("pending", self.request(question)["status"])
        self.assertEqual([], self.events(goal, "action_dropped"))
        self.assertEqual([question], self.owners_list())

    def test_an_agent_does_not_move_an_item_the_owner_has_not_decided(self) -> None:
        self.at(participation.MANUAL)
        task, asked = self.waiting_task("A new task in the goal")
        goal, proposed = self.proposed("A goal the agent proposes")
        under = self.filed("Work under the proposed goal", parent=goal)
        before = self.counts()
        for reference, question in ((task, asked), (under, proposed)):
            for force in (False, True):
                with self.subTest(item=reference, force=force):
                    move = {"state": "ready", "acceptance": "assignment", "force": force}
                    status, code, message = self.refusal(
                        functools.partial(
                            self.tool, "apply_work_item_changes", id=reference, transition=move
                        )
                    )
                    self.assertEqual((409, "workflow_guard"), (status, code))
                    self.assertIn(
                        f"[acceptance_question] the owner has not decided whether {reference}"
                        f" is to be done (question {question}): {WAIT_FOR}",
                        message,
                    )
        self.assertEqual(before, self.counts(), "nothing written")
        # A cancel goes before the answer and ends what waited on it.
        [action] = self.waiting_on(task)
        self.tool(
            "apply_work_item_changes",
            id=task,
            summary=SUMMARY,
            transition={"state": "cancelled", "reason": REASON},
        )
        self.assertEqual("cancelled", self.where(task)[0])
        stored = self.request(asked)
        self.assertEqual(
            ("expired", "item_cancelled"), (stored["status"], stored["expired_reason"])
        )
        self.assertEqual("dropped", self.action(action.id)["outcome"])
        self.assertIn(
            "While the owner has not answered whether an item is to be done, only a cancel"
            " moves it out of triage (acceptance_question).",
            self.described("apply_work_item_changes"),
        )

    def test_a_persons_move_is_their_answer(self) -> None:
        self.at(participation.MANUAL)
        task, asked = self.waiting_task("A task the owner takes on")
        [action] = self.waiting_on(task)
        self.person("/api/planning/work-item/apply", id=task, transition={"state": "ready"})
        self.assertEqual(("ready", "inherited"), self.where(task))
        stored = self.request(asked)
        self.assertEqual(("expired", "withdrawn"), (stored["status"], stored["expired_reason"]))
        self.assertEqual("dropped", self.action(action.id)["outcome"])
        self.assertEqual(
            [f"task_in_goal: {service.TAKEN_BY_OWNER}"], self.events(task, "action_dropped")
        )
        self.assertEqual([], self.owners_list())

    def test_an_assignment_an_agent_takes_on_is_summarised(self) -> None:
        finding = self.filed("A finding the agent is asked to do")
        claimed = self.tool("claim_work_item", id=finding)
        self.assertEqual("triage", claimed["started"]["from"])
        own = self.filed("A goal of the agent's own", kind="goal")
        self.tool(
            "apply_work_item_changes",
            id=own,
            transition={"state": "ready", "acceptance": "assignment"},
        )
        self.assertEqual(("active", "assignment"), self.where(finding))
        self.assertEqual("assignment", self.card(own)["acceptance"]["basis"])
        self.assertEqual(
            [
                ("assignment", own, f"accepted {own}"),
                ("assignment", finding, f"accepted {finding}"),
            ],
            self.decided(),
        )
        marked = [
            tuple(row)
            for row in self.conn.execute(
                "SELECT e.action, e.detail FROM agent_decisions d JOIN work_item_events e"
                " ON e.id = d.event_id ORDER BY e.id"
            )
        ]
        self.assertEqual([("accepted", "assignment"), ("accepted", "assignment")], marked)

    def test_an_assignment_does_not_go_past_the_owners_question(self) -> None:
        # The agent's own goal waits for the owner: naming an assignment does not take it on.
        goal, question = self.proposed("A goal waiting for the owner")
        move = {"state": "ready", "acceptance": "assignment"}
        status, code, message = self.refusal(
            functools.partial(self.tool, "apply_work_item_changes", id=goal, transition=move)
        )
        self.assertEqual((409, "workflow_guard"), (status, code))
        self.assertIn(f"(question {question}): {WAIT_FOR}", message)
        # Nor does a claim by number of a task that waits in triage, or a claim sent
        # with the creation that leaves it waiting there.
        self.at(participation.MANUAL)
        task, asked = self.waiting_task("A task waiting for the owner")
        self.assertEqual(
            (409, "workflow_guard"),
            self.refusal(functools.partial(self.tool, "claim_work_item", id=task))[:2],
        )
        before = self.counts()
        status, code, message = self.refusal(
            functools.partial(
                self.tool,
                "create_work_item",
                space="ALPHA",
                title="Filed and claimed at once",
                parent=self.goal,
                claim=True,
            )
        )
        self.assertEqual((409, "workflow_guard"), (status, code))
        self.assertTrue(message.startswith("claim: [acceptance_question]"), message)
        self.assertIn(TAKE_AFTER, message)
        self.assertEqual(before, self.counts(), "nothing created")
        self.assertEqual([], self.decided())
        self.assertEqual("pending", self.request(asked)["status"])

    def test_a_task_nobody_triaged_waits_when_moved_into_work_at_manual(self) -> None:
        self.at(participation.MANUAL)
        task = self.untriaged("A task left in triage")
        moved = self.tool("apply_work_item_changes", id=task, transition={"state": "ready"})
        self.assertEqual(("triage", None), self.where(task))
        [action] = self.waiting_on(task)
        waits = moved["waits_for_owner"]
        self.assertEqual(
            ("task_in_goal", action.id, f"accepted {task} under {self.goal}"),
            (waits["point"], waits["action"], waits["what"]),
        )
        self.assertEqual(("accept", {"parent": self.id(self.goal)}), (action.kind, action.params))
        self.assertEqual("task", self.request(waits["question"])["purpose"])
        # Its answer takes it on with the goal.
        self.answer(waits["question"], "do")
        self.assertEqual(("ready", "inherited"), self.where(task))
        # An assignment passes the gate.
        named = self.untriaged("A task the agent was asked to do")
        answer = self.tool(
            "apply_work_item_changes",
            id=named,
            transition={"state": "ready", "acceptance": "assignment"},
        )
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual(("ready", "inherited"), self.where(named))
        self.assertEqual([], self.decided())
        # Left to the agent, the move takes it on and is summarised.
        self.at(participation.DEFAULT)
        left = self.untriaged("A task the agent takes on")
        self.tool("apply_work_item_changes", id=left, transition={"state": "ready"})
        self.assertEqual(("ready", "inherited"), self.where(left))
        self.assertEqual(
            [("task_in_goal", left, f"accepted {left} under {self.goal}")], self.decided()
        )

    def test_an_agents_claim_of_a_task_nobody_triaged_is_summarised_at_any_setting(
        self,
    ) -> None:
        expected = []
        for name in (
            participation.MINIMAL,
            participation.DEFAULT,
            participation.MAXIMAL,
            participation.MANUAL,
        ):
            with self.subTest(setting=name):
                self.at(name)
                task = self.untriaged(f"A task left in triage at {name}")
                self.tool("claim_work_item", id=task)
                self.assertEqual(("active", "inherited"), self.where(task))
                expected.insert(0, ("task_in_goal", task, f"accepted {task} under {self.goal}"))
                self.assertEqual(expected, self.decided())
        # The owner's claim is no decision of an agent's.
        task = self.untriaged("A task the owner takes")
        self.person("/api/planning/work-item/claim", id=task)
        self.assertEqual(("active", "inherited"), self.where(task))
        self.assertEqual(expected, self.decided())


if __name__ == "__main__":
    unittest.main()
