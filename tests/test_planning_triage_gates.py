"""The gates an agent's move out of triage into accepted work meets.

A goal with no parent that nobody accepted, moved by an agent to ready on no one's
word, meets the owner's setting `proposed_goal` before the `acceptance` refusal: left
to the agent, the goal is accepted on the basis `agent` and the acceptance is marked
in the summary of decisions as `proposed_goal`; kept for the owner, it stays in triage,
an action of kind `accept` waits on the question `goal`, and the answer says
`waits_for_owner`. An assignment the agent names is the owner's word and meets no gate,
nor does a person's move. The expectations come from the contract of the participation
setting and of a write that waits for the owner, the same as a goal the agent files.

A task lying in triage under goals and stages all accepted and open, moved by an agent
into accepted work, meets the setting `task_in_goal` the same way, whatever state it
goes to: left to the agent, it is accepted `inherited` and marked `task_in_goal`; kept
for the owner, it stays in triage on the question `task`, an action of kind `accept`
waiting for a move to ready and of kind `transition` for any other, whose answer `do`
makes the move the agent asked. A claim by number meets no gate and is marked.
"""

from __future__ import annotations

import functools
import unittest

from server.planning import api, calls, participation, pending, service
from tests.test_planning_pending_actions import AGENT, ASKER, OTHER, REFUSED, SettingHarness

#: What the summary of decisions and the waiting action say of the goal's acceptance.
ACCEPTED = "accepted ALPHA-1"


class UnacceptedGoalTests(SettingHarness):
    """An agent's move of a goal with no parent out of triage into accepted work."""

    def unaccepted(self) -> str:
        """A goal with no parent lying in triage, with nothing asked about it."""

        goal = self.filed("A goal nobody accepted", kind="goal")
        self.assertEqual(("triage", None), self.where(goal))
        self.assertEqual(([], []), (self.waiting_on(goal), self.owners_list()))
        return goal

    def ready(self, reference: str, **move: object) -> dict:
        """The agent's move of the item to ready through its tool, and the answer."""

        return self.tool(
            "apply_work_item_changes", id=reference, transition={"state": "ready", **move}
        )

    def where(self, reference: str) -> tuple[str | None, str | None]:
        card = self.card(reference)
        state = None if card["state"] is None else card["state"]["category"]
        return state, card["acceptance"]["basis"] if card["acceptance"] else None

    def refusal(self, write: functools.partial) -> tuple[int, str, str]:
        """The status, code and text a write is refused with."""

        with self.assertRaises(REFUSED) as refused:
            write()
        status, body = api.error_response(refused.exception)
        return status, body["error"]["code"], body["error"]["message"]

    def test_a_waiting_goal_is_accepted_by_its_row(self) -> None:
        goal = self.unaccepted()
        under = self.filed("Work under the goal", parent=goal)
        # At the default set the owner decides on a goal an agent proposes.
        self.at(participation.DEFAULT)
        answer = self.ready(goal)
        self.assertEqual(("triage", None), self.where(goal))
        [action] = self.waiting_on(goal)
        waits = answer["waits_for_owner"]
        self.assertEqual(
            {
                "action": action.id,
                "point": "proposed_goal",
                "question": waits["question"],
                "what": ACCEPTED,
            },
            waits,
        )
        self.assertEqual(("proposed_goal", "accept"), (action.point, action.kind))
        question = self.request(waits["question"])
        self.assertEqual(
            ("goal", action.id, "pending"),
            (question["purpose"], question["action_id"], question["status"]),
        )
        self.assertEqual([waits["question"]], self.owners_list())
        self.assertEqual(([], []), (self.events(goal, "accepted"), self.decided()))
        self.assertIn(("session-a", "", 1), self.followers(goal))
        # While the question stands the agent does not move the goal, at any setting.
        self.at(participation.MINIMAL)
        before = self.counts()
        status, code, message = self.refusal(functools.partial(self.ready, goal))
        self.assertEqual((409, "workflow_guard"), (status, code))
        self.assertIn(f"[acceptance_question] the owner has not decided whether {goal}", message)
        self.assertEqual(before, self.counts(), "nothing written")
        # Its question withdrawn, the move at the minimal set is the agent's decision.
        self.withdraw(waits["question"], by=AGENT)
        self.assertEqual("withdrawn", self.action(action.id)["outcome"])
        answer = self.ready(goal)
        self.assertNotIn("waits_for_owner", answer)
        card = self.card(goal)
        self.assertEqual(
            (None, "not_started", "agent"),
            (card["state"], card["container_state"], card["acceptance"]["basis"]),
        )
        self.assertEqual(("ready", "inherited"), self.where(under))
        self.assertEqual([], self.waiting_on(goal))
        self.assertEqual([("proposed_goal", goal, ACCEPTED)], self.decided())
        self.assertEqual([("proposed_goal", "accepted", "agent")], self.marked(goal))

    def test_the_owners_answer_carries_out_the_move_that_waited(self) -> None:
        goal = self.unaccepted()
        waits = self.ready(goal)["waits_for_owner"]
        record = self.answer(waits["question"], "do")
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual((None, "owner"), self.where(goal))
        self.assertEqual("carried_out", self.action(waits["action"])["outcome"])
        # The owner took it on: nothing goes into the summary of agent decisions.
        self.assertEqual([], self.decided())

    def test_a_goal_back_from_being_put_off_is_accepted_by_its_row(self) -> None:
        # A goal that comes back at the minimal set waits in triage with no question.
        self.at(participation.MINIMAL)
        goal, task = self.returned_goal()
        self.assertEqual(("triage", None), self.where(goal))
        self.assertEqual([], self.owners_list())
        answer = self.ready(goal)
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual((None, "agent"), self.where(goal))
        self.assertEqual("inherited", self.where(task)[1])
        self.assertEqual([("proposed_goal", "accepted", "agent")], self.marked(goal))

    def test_an_assignment_and_a_persons_move_meet_no_gate(self) -> None:
        self.at(participation.MANUAL)
        named = self.unaccepted()
        answer = self.ready(named, acceptance="assignment")
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual((None, "assignment"), self.where(named))
        self.assertEqual([("assignment", "accepted", "assignment")], self.marked(named))
        owners = self.filed("A goal the owner takes on", kind="goal")
        self.person("/api/planning/work-item/apply", id=owners, transition={"state": "ready"})
        self.assertEqual((None, "owner"), self.where(owners))
        self.assertEqual(([], []), (self.owners_list(), self.marked(owners)))

    def test_a_stage_under_an_unaccepted_goal_is_still_refused(self) -> None:
        # The gate is a goal's with no parent: a stage has no setting to accept it by.
        self.at(participation.MINIMAL)
        goal = self.unaccepted()
        stage = self.filed("A stage of it", kind="stage", parent=goal)
        before = self.counts()
        status, code, message = self.refusal(functools.partial(self.ready, stage))
        self.assertEqual((409, "workflow_guard"), (status, code))
        self.assertIn(f"[acceptance] {stage} is not accepted", message)
        self.assertEqual(before, self.counts(), "nothing written")

    def test_a_move_the_goal_cannot_make_is_refused_not_asked(self) -> None:
        # Checked as it would be made now, a move the work model refuses opens no question.
        goal = self.unaccepted()
        before = self.counts()
        for state, guard in (("active", "goal_or_stage"), ("completed", "container_state")):
            with self.subTest(state=state):
                write = functools.partial(
                    self.tool,
                    "apply_work_item_changes",
                    id=goal,
                    summary={"done": "Done.", "next": "Nothing."},
                    transition={"state": state},
                )
                status, code, message = self.refusal(write)
                self.assertEqual((409, "workflow_guard"), (status, code))
                self.assertIn(f"[{guard}]", message)
                self.assertNotIn("[acceptance]", message)
        self.assertEqual(before, self.counts(), "nothing written")
        self.assertEqual([], self.waiting_on(goal))


#: Why the agent completes a task lying in the goal, and what it asks checked in review.
REASON = "the release covers it"
TO_CHECK = "Read the release notes."
#: The summary a task completed out of triage carries.
DONE = {"done": "Done with the release.", "next": "Nothing."}


class TaskInGoalTests(SettingHarness):
    """An agent's move of a task lying in triage under goals and stages all accepted and
    open, which another session filed there and nobody triaged."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.filed("The owner's goal", kind="goal", by=calls.browser())

    def waiting(self, title: str) -> str:
        """A task another session filed in the owner's goal and left in triage."""

        with calls.bind(OTHER, "create_work_item"):
            created = service.create_work_item(
                self.conn, space="ALPHA", title=title, parent=self.goal, state="triage"
            )
        self.conn.commit()
        task = str(created["reference"])
        self.assertEqual(("triage", None), self.where(task))
        self.assertEqual([], self.waiting_on(task))
        return task

    def move(self, reference: str, state: str, **more: object) -> dict:
        """The agent's move of the item through its tool, and the answer."""

        return self.tool(
            "apply_work_item_changes", id=reference, transition={"state": state, **more}
        )

    def complete(self, reference: str) -> dict:
        """The agent's completion of the item with its summary and reason, and the answer."""

        return self.tool(
            "apply_work_item_changes",
            id=reference,
            summary=DONE,
            transition={"state": "completed", "reason": REASON},
        )

    def where(self, reference: str) -> tuple[str | None, str | None]:
        card = self.card(reference)
        state = None if card["state"] is None else card["state"]["category"]
        return state, card["acceptance"]["basis"] if card["acceptance"] else None

    def accepted(self, task: str) -> str:
        return f"accepted {task} under {self.goal}"

    def kept_for_the_owner(self, task: str, answer: dict) -> pending.Action:
        """The move stayed undone: the task lies in triage, an action of `task_in_goal`
        waits on the question `task`, which the answer's `waits_for_owner` names."""

        self.assertEqual(("triage", None), self.where(task))
        [action] = self.waiting_on(task)
        waits = answer["waits_for_owner"]
        self.assertEqual(
            {
                "action": action.id,
                "point": "task_in_goal",
                "question": waits["question"],
                "what": self.accepted(task),
            },
            waits,
        )
        question = self.request(waits["question"])
        self.assertEqual(
            ("task", action.id, None, "pending"),
            (question["purpose"], question["action_id"], question["addressee"], question["status"]),
        )
        self.assertEqual([], self.events(task, "accepted"))
        return action

    def test_a_task_waiting_in_a_goal_is_accepted_by_its_row(self) -> None:
        task = self.waiting("A task nobody triaged")
        kept = self.waiting("A task the owner decides on")
        # Left to the agent by the default set, the move takes the task on in the goal.
        self.at(participation.DEFAULT)
        answer = self.move(task, "ready")
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual(("ready", "inherited"), self.where(task))
        self.assertEqual([("task_in_goal", "accepted", "inherited")], self.marked(task))
        self.assertEqual([("task_in_goal", task, self.accepted(task))], self.decided())
        self.assertEqual(([], []), (self.waiting_on(task), self.owners_list()))
        # At manual work the owner decides: the move to ready waits as an acceptance.
        self.at(participation.MANUAL)
        answer = self.move(kept, "ready")
        action = self.kept_for_the_owner(kept, answer)
        self.assertEqual(("accept", {"parent": self.id(self.goal)}), (action.kind, action.params))
        self.assertEqual([answer["waits_for_owner"]["question"]], self.owners_list())
        self.assertEqual([("task_in_goal", task, self.accepted(task))], self.decided())

    def test_any_move_of_a_task_waiting_in_a_goal_passes_its_row(self) -> None:
        first = self.waiting("A task the agent completes")
        second = self.waiting("A task the agent completes at manual work")
        # Completed out of triage by the default set, the task is taken on and closed.
        self.at(participation.DEFAULT)
        answer = self.complete(first)
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual(("completed", "inherited"), self.where(first))
        self.assertEqual([("task_in_goal", "accepted", "inherited")], self.marked(first))
        done = self.card(first)["state"]["key"]
        # At manual work the completion waits as the move it is.
        self.at(participation.MANUAL)
        answer = self.complete(second)
        action = self.kept_for_the_owner(second, answer)
        self.assertEqual(
            (
                "transition",
                {"parent": self.id(self.goal), "state": done, "reason": REASON},
            ),
            (action.kind, action.params),
        )
        self.assertEqual([], self.events(second, "transitioned"))
        self.assertIn(
            f"An agent moves the task {second}, lying in {self.goal}, to {done}:",
            str(self.request(answer["waits_for_owner"]["question"])["prompt"]),
        )
        # The owner's answer makes the move that waited, not only the acceptance.
        record = self.answer(answer["waits_for_owner"]["question"], "do")
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual(("completed", "inherited"), self.where(second))
        self.assertEqual(
            [f"{done}: {REASON}; as asked by {ASKER}"], self.events(second, "transitioned")
        )
        self.assertEqual("carried_out", self.action(action.id)["outcome"])
        # Only the agent's own acceptance is in the summary of decisions.
        self.assertEqual([("task_in_goal", first, self.accepted(first))], self.decided())

    def test_the_answer_makes_a_move_into_review_with_what_to_check(self) -> None:
        task = self.waiting("A task the agent sends to review")
        self.at(participation.MANUAL)
        answer = self.tool(
            "apply_work_item_changes",
            id=task,
            summary=DONE,
            transition={"state": "review", "to_check": TO_CHECK},
        )
        action = self.kept_for_the_owner(task, answer)
        self.answer(answer["waits_for_owner"]["question"], "do")
        self.assertEqual(("review", "inherited"), self.where(task))
        review = self.card(task)["state"]["key"]
        self.assertEqual(
            ("transition", {"parent": self.id(self.goal), "state": review, "to_check": TO_CHECK}),
            (action.kind, action.params),
        )
        # The move into review asks what the agent asked checked.
        [asked] = self.conn.execute(
            "SELECT prompt FROM work_item_requests WHERE work_item_id = ? AND purpose = 'review'",
            (self.id(task),),
        ).fetchall()
        self.assertIn(TO_CHECK, str(asked["prompt"]))

    def test_a_claim_by_number_enters_the_summary(self) -> None:
        task = self.waiting("A task taken by its number")
        # Even at manual work a claim by number meets no gate: the owner gave the work.
        self.at(participation.MANUAL)
        claimed = self.tool("claim_work_item", id=task)
        self.assertEqual("triage", claimed["started"]["from"])
        self.assertNotIn("waits_for_owner", claimed)
        self.assertEqual(("active", "inherited"), self.where(task))
        self.assertEqual(ASKER, self.card(task)["claim_ref"])
        self.assertEqual(([], []), (self.waiting_on(task), self.owners_list()))
        self.assertEqual([("task_in_goal", "accepted", "inherited")], self.marked(task))
        self.assertEqual([("task_in_goal", task, self.accepted(task))], self.decided())


if __name__ == "__main__":
    unittest.main()
