"""Review: work enters it with the question of what the owner is to check, and leaves it by the answer.

A move into review asks for every step ticked, a summary and `to_check`, and
writes `to_check` as the owner's question on the item in the same write. Only the
owner answers it, accepting the work or returning it; only the session that asked
withdraws it. While a question to the owner is open on an item, an agent neither
completes it nor takes it out of review, except to cancel it, and `force` does not
carry it past; a person is not held to that.

The writes go through the HTTP paths every surface reaches, bound as the agent
session or the person makes them, and the answers through the MCP tool where the
refusal's code is what an agent reads.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Mapping
from unittest import mock

from server import mcp_surface, store
from server.planning import api, calls, model, questions, requests, service

SESSION_A = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
SESSION_B = "019a3c2e-6c8e-7c11-9e0f-2f4b6d8a1c3e"
A = calls.Identity(state=calls.CONFIRMED, source=calls.CODEX_META, session_id=SESSION_A)
B = calls.Identity(state=calls.CONFIRMED, source=calls.CODEX_META, session_id=SESSION_B)
PERSON = calls.browser()
TO_CHECK = "Run the parser over the fixtures and read the three new cases."
APPLY = "/api/planning/work-item/apply"
TRANSITION = "/api/planning/work-item/transition"
ANSWER = "/api/planning/request/answer"
CHANGE = "/api/planning/request/change"
DECLINE = "/api/planning/request/decline"
EXPIRE = "/api/planning/request/expire"
FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}


class ReviewHarness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "review.sqlite3")}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Alpha", key="ALPHA")
        self.conn.commit()
        self.ref = self.done_at_work("Parse the new format")

    def done_at_work(self, title: str) -> str:
        """A task session A holds at work, its one step ticked and its summary written."""

        created = service.create_work_item(
            self.conn, space="ALPHA", title=title, state="ready", acceptance="assignment"
        )
        reference = str(created["reference"])
        self.write(
            A,
            APPLY,
            {
                "id": reference,
                "claim": True,
                "checklist": [{"text": "parse it", "done": True}],
                "summary": {"done": "parsed", "next": "nothing"},
            },
        )
        return reference

    def write(self, identity: calls.Identity, path: str, payload: Mapping[str, object]) -> dict:
        with calls.bind(identity, path):
            answer = api.handle_post(self.conn, path, payload)
            self.conn.commit()
        assert answer is not None
        return answer[1]

    def refused(
        self, identity: calls.Identity, path: str, payload: Mapping[str, object]
    ) -> tuple[int, dict]:
        """The status and error a write is refused with; a write that passes fails the test."""

        with calls.bind(identity, path):
            try:
                api.handle_post(self.conn, path, payload)
            except (model.PlanningError, api.PlanningHttpError) as error:
                self.conn.rollback()
                status, body = api.error_response(error)
                return status, body["error"]
        self.conn.rollback()
        raise AssertionError(f"{path} passed: {payload}")

    def move(self, identity: calls.Identity, state: str, reference: str = "", **fields: object):
        return self.write(
            identity,
            APPLY,
            {"id": reference or self.ref, "transition": {"state": state, **fields}},
        )

    def to_review(self, reference: str = "") -> str:
        answer = self.move(A, "review", reference, to_check=TO_CHECK)
        return str(answer["applied"]["transition"]["review_request_id"])

    def item(self, reference: str = "") -> dict:
        return service.get_work_item(self.conn, reference or self.ref)

    def state(self, reference: str = "") -> str:
        return str(self.item(reference)["state"]["key"])

    def questions(self, reference: str = "") -> dict[str, int]:
        return requests.question_counts(self.conn, str(self.item(reference)["work_item_id"]))

    def request(self, request_id: str) -> dict:
        return requests.get(self.conn, request_id)

    def answer(self, request_id: str, **fields: object) -> dict:
        """The body of an answer, a decline or a withdrawal, at the request's revision."""

        return {
            "id": request_id,
            "expected_revision": self.request(request_id)["revision"],
            **fields,
        }

    def started_at(self, reference: str = "") -> str | None:
        row = self.conn.execute(
            "SELECT started_at FROM work_items WHERE work_item_id = ?",
            (self.item(reference)["work_item_id"],),
        ).fetchone()
        return None if row[0] is None else str(row[0])

    def last_move(self, reference: str = "") -> tuple[str, str]:
        row = self.conn.execute(
            "SELECT detail, author FROM work_item_events WHERE work_item_id = ?"
            " AND action = 'transitioned' ORDER BY id DESC LIMIT 1",
            (self.item(reference)["work_item_id"],),
        ).fetchone()
        return str(row[0]), str(row[1])


class EnteringReviewTests(ReviewHarness):
    def test_review_without_to_check_is_refused_and_force_does_not_carry_it(self) -> None:
        # Refused without to_check; then in review, released, asked, no launch.
        for force in (False, True):
            status, error = self.refused(
                A, APPLY, {"id": self.ref, "transition": {"state": "review", "force": force}}
            )
            self.assertEqual((409, "workflow_guard"), (status, error["code"]))
            self.assertIn("[review_question]", error["message"])
            self.assertEqual("dev", self.state())

        answer = self.move(A, "review", to_check=TO_CHECK)

        moved = answer["applied"]["transition"]
        self.assertEqual("review", moved["state"])
        self.assertIn(SESSION_A, moved["released"], "entering review ends the claim")
        self.assertEqual("", self.item()["claim_ref"])
        asked = self.request(moved["review_request_id"])
        self.assertEqual(
            ("question", "review", TO_CHECK, "pending", None),
            (
                asked["kind"],
                asked["purpose"],
                asked["prompt"],
                asked["status"],
                asked["execution_id"],
            ),
        )
        self.assertEqual(
            ["accept", "return"], [option["id"] for option in asked["fields"][0]["options"]]
        )
        self.assertEqual(1, self.questions()["open"])

    def test_review_asks_what_a_completed_close_asks(self) -> None:
        # An open step, no summary, a step its lapsed holder ticked.
        open_step = self.done_at_work("With a step left")
        self.write(
            A,
            APPLY,
            {"id": open_step, "checklist": [{"text": "parse it", "done": True}, "test it"]},
        )
        no_summary = service.create_work_item(
            self.conn, space="ALPHA", title="Unsummed", state="ready", acceptance="assignment"
        )["reference"]
        self.write(A, APPLY, {"id": no_summary, "claim": True})
        lapsed = self.done_at_work("Ticked by a lapsed holder")
        steps = self.item(lapsed)["checklist"]
        steps[0][model.PREVIOUS_HOLDER] = True
        self.conn.execute(
            "UPDATE work_items SET checklist = ? WHERE work_item_id = ?",
            (model.dumps(steps), self.item(lapsed)["work_item_id"]),
        )
        self.conn.commit()

        for reference, guard in (
            (open_step, "[checklist]"),
            (no_summary, "[summary]"),
            (lapsed, "[previous_holder]"),
        ):
            status, error = self.refused(
                A,
                APPLY,
                {"id": reference, "transition": {"state": "review", "to_check": TO_CHECK}},
            )
            self.assertEqual(409, status, reference)
            self.assertIn(guard, error["message"], reference)
            self.assertEqual("dev", self.state(reference))
            self.assertEqual(0, self.questions(reference)["count"], "nothing asked")

    def test_to_check_with_a_move_that_does_not_enter_review_is_refused(self) -> None:
        status, error = self.refused(
            A, APPLY, {"id": self.ref, "transition": {"state": "done", "to_check": TO_CHECK}}
        )
        self.assertEqual(400, status)
        self.assertIn("to_check goes with a move into review", error["message"])
        self.assertEqual("dev", self.state())

    def test_a_person_moving_work_into_review_is_refused(self) -> None:
        # The board's drop into review sends no question.
        for force in (False, True):
            status, error = self.refused(
                PERSON, TRANSITION, {"id": self.ref, "state": "review", "force": force}
            )
            self.assertEqual(409, status)
            self.assertIn("[review_question]", error["message"])
        self.assertEqual("dev", self.state())


class TheOwnersAnswerTests(ReviewHarness):
    def test_accept_completes_the_work_as_the_owner(self) -> None:
        asked = self.to_review()
        answered = self.write(PERSON, ANSWER, self.answer(asked, answers={"answer": "accept"}))
        self.assertEqual(("answered", "completed"), (answered["status"], answered["carried_out"]))
        self.assertEqual("done", self.state())
        self.assertEqual(("done", "user"), self.last_move())

    def test_return_puts_the_work_back_in_ready_started_with_the_note_as_its_reason(self) -> None:
        started = self.started_at()
        asked = self.to_review()
        answered = self.write(
            PERSON,
            ANSWER,
            self.answer(asked, answers={"answer": "return"}, note="The third case fails"),
        )
        self.assertEqual("ready", answered["carried_out"])
        self.assertEqual("ready", self.state())
        self.assertIsNotNone(started)
        self.assertEqual(started, self.started_at(), "it stays started")
        self.assertEqual(("ready: The third case fails", "user"), self.last_move())

    def test_a_guard_the_accepting_move_meets_refuses_the_answer(self) -> None:
        asked = self.to_review()
        # A step added in review is open, so the move to completed is refused.
        self.write(
            PERSON,
            "/api/planning/work-item/checklist",
            {"id": self.ref, "items": [{"text": "parse it", "done": True}, "and document it"]},
        )
        status, error = self.refused(
            PERSON, ANSWER, self.answer(asked, answers={"answer": "accept"})
        )
        self.assertEqual(409, status)
        self.assertIn("[checklist]", error["message"])
        self.assertEqual("pending", self.request(asked)["status"], "the answer is not written")
        self.assertEqual("review", self.state())

    def test_an_own_variant_carries_nothing_out_and_is_refused(self) -> None:
        asked = self.to_review()
        status, error = self.refused(
            PERSON, ANSWER, self.answer(asked, answers={}, own={"answer": "Half of it"})
        )
        self.assertEqual(400, status)
        self.assertIn("[purpose]", error["message"])
        self.assertEqual("pending", self.request(asked)["status"])

    def test_the_answer_is_never_declined_or_changed(self) -> None:
        asked = self.to_review()
        status, error = self.refused(PERSON, DECLINE, self.answer(asked))
        self.assertEqual(400, status)
        self.assertIn("[purpose]", error["message"])
        self.write(PERSON, ANSWER, self.answer(asked, answers={"answer": "return"}))
        status, error = self.refused(
            PERSON, CHANGE, self.answer(asked, answers={"answer": "accept"})
        )
        self.assertEqual(400, status)
        self.assertIn("[purpose]", error["message"])
        self.assertEqual("ready", self.state())


class WhoAnswersTests(ReviewHarness):
    """The agents are refused, the person's answer is carried out."""

    def test_no_agent_answers_the_question_of_review(self) -> None:
        asked = self.to_review()
        for identity in (A, B):
            with self.assertRaises(model.OwnerOnlyError) as refusal:
                mcp_surface.run_tool_call(
                    self.conn,
                    "answer_work_item_request",
                    self.answer(asked, answers={"answer": "accept"}),
                    meta={"sessionId": identity.session_id},
                )
            self.conn.rollback()
            self.assertEqual(
                (403, "owner_only"), self._code(refusal.exception), "its code reaches the agent"
            )
        self.assertEqual("pending", self.request(asked)["status"])
        self.assertEqual("review", self.state())

    def test_only_the_session_that_asked_withdraws_it(self) -> None:
        asked = self.to_review()
        for identity in (B, PERSON):
            status, error = self.refused(identity, EXPIRE, self.answer(asked))
            self.assertEqual((403, "not_asker"), (status, error["code"]))
        self.assertEqual("pending", self.request(asked)["status"])
        self.assertEqual("review", self.state())

        # The asker withdraws it, and the work goes back to ready, started.
        started = self.started_at()
        withdrawn = self.write(A, EXPIRE, self.answer(asked))
        self.assertEqual(
            ("expired", "withdrawn", "ready"),
            (withdrawn["status"], withdrawn["expired_reason"], withdrawn["carried_out"]),
        )
        self.assertEqual("ready", self.state())
        self.assertEqual(started, self.started_at())

    def test_the_persons_answer_is_carried_out(self) -> None:
        asked = self.to_review()
        self.write(PERSON, ANSWER, self.answer(asked, answers={"answer": "accept"}))
        self.assertEqual("done", self.state())
        self.assertEqual("answered", self.request(asked)["status"])

    @staticmethod
    def _code(error: Exception) -> tuple[int, str]:
        status, body = api.error_response(error)
        return status, str(body["error"]["code"])


class LeavingReviewTests(ReviewHarness):
    def test_an_agent_takes_nothing_out_of_review_but_a_cancel(self) -> None:
        asked = self.to_review()
        for state in ("ready", "done"):
            for force in (False, True):
                status, error = self.refused(
                    A, APPLY, {"id": self.ref, "transition": {"state": state, "force": force}}
                )
                self.assertEqual(409, status, state)
                self.assertIn("[question]", error["message"], state)
        self.assertEqual("review", self.state())

        self.move(A, "cancelled")
        self.assertEqual("cancelled", self.state())
        ended = self.request(asked)
        self.assertEqual(("expired", "item_cancelled"), (ended["status"], ended["expired_reason"]))

    def test_a_person_completing_the_work_ends_the_question(self) -> None:
        asked = self.to_review()
        self.write(PERSON, TRANSITION, {"id": self.ref, "state": "done"})
        self.assertEqual("done", self.state())
        ended = self.request(asked)
        self.assertEqual(("expired", "item_completed"), (ended["status"], ended["expired_reason"]))

    def test_a_person_moving_the_work_elsewhere_withdraws_the_question(self) -> None:
        asked = self.to_review()
        self.write(PERSON, TRANSITION, {"id": self.ref, "state": "ready"})
        ended = self.request(asked)
        self.assertEqual(("expired", "withdrawn"), (ended["status"], ended["expired_reason"]))

    def test_review_to_review_keeps_its_question(self) -> None:
        asked = self.to_review()
        self.move(A, "review")
        self.assertEqual("pending", self.request(asked)["status"])
        self.assertEqual(1, self.questions()["count"], "and asks no second one")

    def test_work_in_review_with_no_question_is_moved_out_as_before(self) -> None:
        # Work that stood in review before it took a question has none to wait for.
        self.conn.execute(
            "UPDATE work_items SET state_id = (SELECT state_id FROM workflow_states s"
            " WHERE s.workflow_id = work_items.workflow_id AND s.key = 'review'),"
            " claim_ref = '' WHERE work_item_id = ?",
            (self.item()["work_item_id"],),
        )
        self.conn.commit()
        self.move(A, "ready")
        self.assertEqual("ready", self.state())


class TheQuestionGuardTests(ReviewHarness):
    """An open question to the owner holds an agent's close, never a person's."""

    def ask_owner(self, reference: str = "") -> str:
        asked = self.write(
            A,
            "/api/planning/work-item/request",
            {
                "id": reference or self.ref,
                "kind": "question",
                "prompt": "Which?",
                "fields": [FIELD],
            },
        )
        return str(asked["request_id"])

    def test_an_agent_does_not_complete_over_the_owners_question(self) -> None:
        # The agent's refusal.
        self.ask_owner()
        for force in (False, True):
            status, error = self.refused(
                A, APPLY, {"id": self.ref, "transition": {"state": "done", "force": force}}
            )
            self.assertEqual((409, "workflow_guard"), (status, error["code"]))
            self.assertIn("[question]", error["message"])
        self.assertEqual("dev", self.state())

    def test_a_person_completes_over_it_and_ends_it(self) -> None:
        asked = self.ask_owner()
        self.write(PERSON, TRANSITION, {"id": self.ref, "state": "done"})
        self.assertEqual("done", self.state())
        self.assertEqual("item_completed", self.request(asked)["expired_reason"])

    def test_the_agent_may_still_cancel(self) -> None:
        asked = self.ask_owner()
        self.move(A, "cancelled")
        self.assertEqual("item_cancelled", self.request(asked)["expired_reason"])

    def test_withdrawing_its_own_question_lets_the_agent_complete(self) -> None:
        asked = self.ask_owner()
        self.write(A, EXPIRE, self.answer(asked))
        self.move(A, "done")
        self.assertEqual("done", self.state())

    def test_a_question_asked_of_a_session_holds_nothing(self) -> None:
        self.conn.execute("INSERT INTO sessions(id, client) VALUES(?, 'codex')", (SESSION_B,))
        self.conn.commit()
        self.write(
            A,
            "/api/planning/work-item/request",
            {
                "id": self.ref,
                "kind": "question",
                "prompt": "Agree?",
                "fields": [FIELD],
                "addressees": [SESSION_B],
            },
        )
        self.move(A, "done")
        self.assertEqual("done", self.state())

    def test_the_confirmation_question_does_not_hold_its_goals_completion(self) -> None:
        goal = service.create_work_item(
            self.conn,
            space="ALPHA",
            title="The goal",
            kind="goal",
            state="ready",
            acceptance="assignment",
        )["reference"]
        self.write(
            A,
            APPLY,
            {
                "id": goal,
                "checklist": [{"text": "it holds", "done": True}],
                "summary": {"done": "all of it", "next": "nothing"},
            },
        )
        with calls.bind(calls.valkama(), "test"):
            confirm = questions.ask(
                self.conn,
                str(self.item(goal)["work_item_id"]),
                kind="question",
                prompt="Confirm it",
                fields=[FIELD],
                author="valkama",
                purpose="confirm",
            )
            self.conn.commit()
        self.move(A, "done", goal)
        self.assertEqual("done", self.state(goal))
        self.assertEqual("item_completed", self.request(confirm)["expired_reason"])


if __name__ == "__main__":
    unittest.main()
