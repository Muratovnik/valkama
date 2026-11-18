"""The gates an agent's move out of triage into accepted work meets.

A goal with no parent that nobody accepted, moved by an agent to ready on no one's
word, meets the owner's setting `proposed_goal` before the `acceptance` refusal: left
to the agent, the goal is accepted on the basis `agent` and the acceptance is marked
in the summary of decisions as `proposed_goal`; kept for the owner, it stays in triage,
an action of kind `accept` waits on the question `goal`, and the answer says
`waits_for_owner`. An assignment the agent names is the owner's word and meets no gate,
nor does a person's move. The expectations come from the contract of the participation
setting and of a write that waits for the owner, the same as a goal the agent files.
"""

from __future__ import annotations

import functools
import unittest

from server.planning import api, participation
from tests.test_planning_pending_actions import AGENT, REFUSED, SettingHarness

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


if __name__ == "__main__":
    unittest.main()
