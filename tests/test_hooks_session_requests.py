"""A question asked of a session reaches that session alone, and words left waiting reach the
orchestrator whose subagent took them.

The tree of `test_hooks_tree_notices`: goal G holds stage S1 with tasks T1 and T3 and stage S2
with task T2, and goal H holds task U. B holds T2 and E holds T1, so both work under G; A holds
T3 through its subagent a2; F follows G and holds nothing; C holds U under H.

The expectations come from the hook contract, "Asked of a session": the request a session is
asked wakes it, from wherever on the board it was asked, as one line that names the request,
its fields and how to answer; what becomes of the request is told to the session asked and to
the session that asked, and to nobody else, the holders and those who work under the goal
included. A list on a comment asks nobody, so it is no question to the owner either. Words a
person left on a goal nobody worked on are told once to the orchestrator whose subagent took
them with a claim; an orchestrator that took them itself read them in its answer.
"""

from __future__ import annotations

import re
import unittest

from server.hooks import notify
from server.planning import calls, requests
from tests.test_hooks_tree_notices import (
    A1,
    AS_A1,
    AS_A2,
    AS_B,
    AS_C,
    AS_E,
    AS_F,
    COMMENT,
    FROM_AGENTS,
    A,
    B,
    C,
    E,
    F,
    Harness,
)

PROMPT = "May the goal be cancelled?"
CHOICE = {
    "id": "choice",
    "label": "Cancel the goal?",
    "type": "choice",
    "required": True,
    "options": [{"id": "agree", "label": "Agree"}, {"id": "object", "label": "Object"}],
}
WHY = {"id": "why", "label": "Why", "type": "text", "required": False, "options": []}
FIELDS = "fields: choice choice: agree, object; why text"
WOKE_FOR_VALKAMA = "it came now because a record of Valkama's here asks for this session."
B1 = "0b000000-0000-4000-8000-0000000000b1"
AS_B1 = {"sessionId": B, "threadId": B1}
E1 = "0e000000-0000-4000-8000-0000000000e1"
AS_E1 = {"sessionId": E, "threadId": E1}
LIST = {"label": "What to take on", "options": [{"id": "a", "label": "Widen the check"}]}


def asked_line(by: str, request_id: str) -> re.Pattern[str]:
    """The line of a request asked of the session reading it."""

    return re.compile(
        rf"\n- question asked of this session at \S+ by {re.escape(by)} \(asks for your answer\):"
        rf" «{re.escape(PROMPT)}» — answer with answer_work_item_request id={request_id};"
        rf" {re.escape(FIELDS)}\n"
    )


class Asked(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.agent("claim_work_item", AS_B, id=self.t2)
        self.agent("claim_work_item", AS_E, id=self.t1)
        self.agent("claim_work_item", AS_A2, id=self.t3)
        self.agent("apply_work_item_changes", AS_F, id=self.goal, subscribe=True)
        self.agent("claim_work_item", AS_C, id=self.u)
        self.settle(A, B, C, E, F)

    def ask(self, identity: calls.Identity, ref: str, *sessions: str) -> dict[str, dict]:
        """One request per session asked, in the call of `identity`, by addressee."""

        with calls.bind(identity, "test"):
            asked = requests.ask_sessions(
                self.conn, ref, sessions=list(sessions), prompt=PROMPT, fields=[CHOICE, WHY]
            )
        self.conn.commit()
        return {str(record["addressee"]): record for record in asked}

    def by_valkama(self, ref: str, *sessions: str) -> dict[str, dict]:
        return self.ask(calls.valkama(), ref, *sessions)

    def by_agent(self, session: str, agent: str, ref: str, *sessions: str) -> dict[str, dict]:
        identity = calls.Identity(
            state=calls.CONFIRMED,
            source=calls.CLAUDE_PAIR,
            session_id=session,
            agent_id=agent,
            client="claude-code",
        )
        return self.ask(identity, ref, *sessions)

    def nothing_for(self, *sessions: str) -> None:
        for session in sessions:
            with self.subTest(session=session):
                self.assertEqual((0, ""), self.watch(session, alive=1.0), f"{session} is not woken")
                self.assertIsNone(self.hook(session), f"{session} hears nothing of it")


class AskedOfASessionTests(Asked):
    def test_the_session_asked_wakes_with_its_request_and_nobody_else_hears_it(self) -> None:
        """O13, the hook's part: Valkama asks B and E on G, which both work under."""

        asked = self.by_valkama(self.goal, B, E)
        status, text = self.watch(B)
        self.assertEqual(notify.WAKE_STATUS, status, "B's watcher leaves with the request")
        self.assertTrue(text.startswith(FROM_AGENTS), text)
        self.assertIn(f"\n{self.line(self.goal)}\n", text)
        self.assertRegex(text, asked_line("Valkama", asked[B]["request_id"]))
        self.assertNotIn(asked[E]["request_id"], text, "B hears its own request alone")
        self.assertIn(WOKE_FOR_VALKAMA, text)
        self.assertIsNone(self.hook(B), "once")
        continued = self.hook(E, "stop")
        assert continued is not None, "E's turn goes on with its request"
        self.assertRegex(continued, asked_line("Valkama", asked[E]["request_id"]))
        self.assertNotIn(asked[B]["request_id"], continued)
        self.assertIsNone(self.hook(E), "once")
        self.nothing_for(A, F, C)

    def test_a_request_reaches_the_session_asked_wherever_it_was_asked(self) -> None:
        """C works under H alone; a request on T1, under G, still wakes it."""

        asked = self.by_valkama(self.t1, C)
        status, text = self.watch(C)
        self.assertEqual(notify.WAKE_STATUS, status, text)
        self.assertIn(f"\n{self.line(self.t1)}\n", text, "named by the item, under nothing")
        self.assertRegex(text, asked_line("Valkama", asked[C]["request_id"]))
        self.assertIsNone(self.hook(C), "once")
        self.nothing_for(E, A, B, F)

    def test_an_agents_request_names_who_asked(self) -> None:
        asked = self.by_agent(A, A1, self.t1, B)
        told = self.hook(B)
        assert told is not None
        self.assertTrue(told.startswith(FROM_AGENTS), told)
        self.assertIn(f"\n{self.line(self.t1, self.goal)}\n", told)
        self.assertRegex(told, asked_line(f"agent {A1} of session {A}", asked[B]["request_id"]))
        self.assertNotIn("question_asked", told)

    def test_the_rest_of_a_request_reaches_only_the_session_asked_and_the_one_that_asked(
        self,
    ) -> None:
        """A's subagent asks B on T1, which E holds; B's subagent answers it."""

        asked = self.by_agent(A, A1, self.t1, B)[B]
        self.hook(B)
        self.nothing_for(E, F, C)
        self.assertIsNone(self.hook(A), "its subagent's request is no question to the owner")
        self.agent(
            "answer_work_item_request",
            AS_B1,
            id=asked["request_id"],
            answers={"choice": "agree"},
            expected_revision=asked["revision"],
        )
        told = self.hook(A)
        assert told is not None, "the session that asked hears the answer"
        self.assertRegex(told, rf"\n- question_answered at \S+ by agent {B1} of session {B}: «")
        self.assertIsNone(self.hook(B), "its own subagent's answer is no news to B")
        self.nothing_for(E, F, C)

    def test_a_request_withdrawn_is_told_to_the_session_asked_without_a_wake(self) -> None:
        asked = self.by_agent(A, A1, self.t1, B)[B]
        self.hook(B)
        self.agent(
            "expire_work_item_request",
            AS_A1,
            id=asked["request_id"],
            expected_revision=asked["revision"],
        )
        self.assertIsNone(self.hook(B, "stop"), "a withdrawal continues no turn")
        told = self.hook(B)
        assert told is not None
        self.assertRegex(told, rf"\n- question_withdrawn at \S+ by agent {A1} of session {A}: «")
        self.assertNotIn("asks for your answer", told)
        self.nothing_for(E, F, C)
        self.assertIsNone(self.hook(A), "nor does A hear its own subagent withdraw it")


class ListTests(Asked):
    def test_a_list_by_another_session_is_no_question_to_the_holder(self) -> None:
        self.comment(AS_B, self.t1, "Findings on T1, marker L-1", list=LIST)
        told = self.hook(E)
        assert told is not None, "E holds T1 and hears the comment"
        self.assertIn("marker L-1", told)
        self.assertNotIn("question_asked", told)
        self.assertNotIn(LIST["label"], told)

    def test_a_list_on_a_stage_is_no_question_to_whoever_works_under_it(self) -> None:
        self.comment(AS_B, self.s1, "Findings on S1, marker L-2", list=LIST)
        told = self.hook(A)
        assert told is not None, "A works under S1 and hears the comment"
        self.assertIn("marker L-2", told)
        self.assertNotIn("question_asked", told)


SAID = "Use the other library for the whole goal, marker W-1"
LEFT = "words left for whoever takes work here:"


class WordsLeftTests(Harness):
    """G2 holds T4 and T5 and nobody works under it; E holds T1 under G."""

    def setUp(self) -> None:
        super().setUp()
        self.g2 = self.made("goal nobody works on", "goal")
        self.t4 = self.made("T4", parent=self.g2)
        self.agent("claim_work_item", AS_E, id=self.t1)
        self.settle(E)

    def left_line(self) -> str:
        return f"\n{self.g2} «goal nobody works on»: {LEFT}\n- comment at "

    def heard_once(self) -> None:
        self.assertIsNone(self.hook(E, "stop"), "its subagent has the words: no turn goes on")
        self.assertEqual((0, ""), self.watch(E, alive=1.0), "and nothing wakes")
        told = self.hook(E)
        assert told is not None, "E hears what its subagent was handed"
        self.assertIn(self.left_line(), told)
        self.assertEqual(1, told.count(SAID), told)
        self.assertTrue(told.startswith("Valkama notice: a person acted"), told)
        self.assertIsNone(self.hook(E), "once")

    def test_an_orchestrator_hears_once_what_its_subagent_was_handed(self) -> None:
        """O11: no hook of E between the person's words and its subagent's claim."""

        self.person(COMMENT, id=self.g2, body=SAID)
        claimed = self.agent("claim_work_item", AS_E1, id=self.t4)
        self.assertEqual([self.g2], [left["reference"] for left in claimed["waiting"]])
        self.heard_once()

    def test_an_orchestrator_that_read_between_hears_it_once_too(self) -> None:
        self.person(COMMENT, id=self.g2, body=SAID)
        self.assertIsNone(self.hook(E), "nobody of E works under G2 yet")
        self.agent("claim_work_item", AS_E1, id=self.t4)
        self.heard_once()

    def test_a_first_read_after_the_claim_hears_it(self) -> None:
        """A session whose hook never ran before its subagent took the words."""

        self.person(COMMENT, id=self.g2, body=SAID)
        self.agent("claim_work_item", AS_A1, id=self.t4)
        told = self.hook(A)
        assert told is not None
        self.assertIn(self.left_line(), told)
        self.assertEqual(1, told.count(SAID), told)
        self.assertIsNone(self.hook(A), "once")

    def test_an_orchestrator_that_took_the_words_itself_hears_them_no_more(self) -> None:
        self.person(COMMENT, id=self.g2, body=SAID)
        claimed = self.agent("claim_work_item", AS_E, id=self.t4)
        self.assertEqual([self.g2], [left["reference"] for left in claimed["waiting"]])
        self.assertEqual((0, ""), self.watch(E, alive=1.0), "its answer was enough")
        self.assertIsNone(self.hook(E))

    def test_words_after_the_claim_are_the_trees_news(self) -> None:
        self.person(COMMENT, id=self.g2, body=SAID)
        self.agent("claim_work_item", AS_E1, id=self.t4)
        self.hook(E)
        self.person(COMMENT, id=self.g2, body="Later words, marker W-2")
        status, text = self.watch(E)
        self.assertEqual(notify.WAKE_STATUS, status, "a person on a goal worked on wakes")
        self.assertIn("marker W-2", text)
        self.assertNotIn(LEFT, text)
        self.assertNotIn(SAID, text)


if __name__ == "__main__":
    unittest.main()
