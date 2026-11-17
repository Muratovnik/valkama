"""A question asked of agent sessions instead of the owner: who answers it, and who never sees it.

Goal G holds stage S1 with T1 and stage S2 with T2. Session A, a coordinator with
the subagents a1 and a2, asks; B holds T2 and E holds T1, so both work under G. Every
agent call is bound as the MCP surface binds one whose session a channel proved,
and the person acts through the interface's own routes.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from unittest import mock

from server import sessions, store
from server.planning import api, calls, held, model, questions, requests, service, tools

A = "a0000000-0000-4000-8000-00000000000a"
B = "b0000000-0000-4000-8000-00000000000b"
E = "e0000000-0000-4000-8000-00000000000e"
A1, A2, B1 = "a1", "a2", "b1"
CHOICE = {
    "id": "choice",
    "label": "Cancel the goal?",
    "type": "choice",
    "required": True,
    "options": [{"id": "agree", "label": "Agree"}, {"id": "object", "label": "Object"}],
}
TEXT = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = str(service.create_planning_space(self.conn, name="Crew")["key"])
        self.conn.commit()
        self.goal = self.item("G", "goal")
        self.s1 = self.item("S1", "stage", self.goal)
        s2 = self.item("S2", "stage", self.goal)
        self.t1 = self.item("T1", parent=self.s1)
        self.t2 = self.item("T2", parent=s2)
        self.claim(self.t1, E)
        self.claim(self.t2, B)
        self.claim(self.item("Elsewhere"), A, A1)

    @contextmanager
    def acting(self, session: str | None, agent: str | None = None) -> Iterator[None]:
        """One call: of that session's agent, of that session, or of the person."""

        identity = (
            calls.browser()
            if session is None
            else calls.Identity(
                state=calls.CONFIRMED,
                source=calls.CLAUDE_PAIR,
                session_id=session,
                agent_id=agent,
                client="claude-code",
            )
        )
        with calls.bind(identity, "test"):
            yield
        self.conn.commit()

    def item(self, title: str, kind: str = "task", parent: str | None = None) -> str:
        with self.acting(None):
            return str(
                service.create_work_item(
                    self.conn, space=self.space, title=title, kind=kind, parent=parent
                )["reference"]
            )

    def claim(self, ref: str, session: str, agent: str | None = None) -> None:
        with self.acting(session, agent):
            service.claim_work_item(self.conn, ref)

    def ask(self, ref: str, *asked: str, by: str = A, agent: str | None = A1) -> list[dict]:
        with self.acting(by, agent):
            return requests.ask_sessions(
                self.conn, ref, sessions=list(asked), prompt="May G be cancelled?", fields=[CHOICE]
            )

    def post(self, path: str, body: dict, session: str | None, agent: str | None = None) -> dict:
        """A write through the route both surfaces share, as that caller."""

        try:
            with self.acting(session, agent):
                answer = api.handle_post(self.conn, path, body)
        except model.PlanningError as error:
            self.conn.rollback()
            status, refusal = api.error_response(error)
            return {"http": status, **refusal["error"]}
        assert answer is not None
        return {"http": answer[0], **answer[1]}

    def answer(self, record: dict, session: str | None, agent: str | None = None) -> dict:
        return self.post(
            "/api/planning/request/answer",
            {
                "id": record["request_id"],
                "expected_revision": record["revision"],
                "answers": {"choice": "agree"},
            },
            session,
            agent,
        )

    def read(self, record: dict) -> dict:
        return requests.get(self.conn, record["request_id"])

    def end(self, session: str) -> None:
        sessions.op_ingest_session_event(
            self.conn, {"event": "session_end", "session_id": session, "client": "claude-code"}
        )
        self.conn.commit()

    def resume(self, session: str) -> None:
        sessions.op_ingest_session_event(
            self.conn, {"event": "session_start", "session_id": session, "client": "claude-code"}
        )
        self.conn.commit()


class AnsweringTests(Harness):
    def test_each_session_asked_gets_its_own_request_on_the_item(self) -> None:
        asked = self.ask(self.goal, B, E)
        self.assertEqual([B, E], [record["addressee"] for record in asked])
        for record in asked:
            self.assertEqual(
                ("pending", None, self.goal, [CHOICE]),
                (
                    record["status"],
                    record["expired_reason"],
                    record["reference"],
                    record["fields"],
                ),
            )

    def test_only_the_session_asked_answers_from_any_of_its_agents(self) -> None:
        [to_b] = self.ask(self.goal, B)
        for session, agent, who in (
            (A, None, "the session that asked"),
            (A, A2, "a subagent of the session that asked"),
            (E, None, "another session under the goal"),
            (None, None, "the person in the interface"),
        ):
            with self.subTest(caller=who):
                refused = self.answer(to_b, session, agent)
                self.assertEqual((403, "not_addressed"), (refused["http"], refused["code"]))
                self.assertIn(B, refused["message"])
                self.assertEqual("pending", self.read(to_b)["status"])
        answered = self.answer(to_b, B, B1)
        self.assertEqual(
            (200, "answered", {"choice": "agree"}),
            (answered["http"], answered["status"], answered["answers"]),
            "a subagent of the session asked answers for it",
        )

    def test_a_change_and_a_decline_are_held_to_the_same_rule(self) -> None:
        [to_b, to_e] = self.ask(self.goal, B, E)
        first = self.answer(to_b, B)
        self.assertEqual(200, first["http"])
        change = {
            "id": to_b["request_id"],
            "expected_revision": self.read(to_b)["revision"],
            "answers": {"choice": "object"},
        }
        refused = self.post("/api/planning/request/change", change, A, A1)
        self.assertEqual((403, "not_addressed"), (refused["http"], refused["code"]))
        changed = self.post("/api/planning/request/change", change, B, B1)
        self.assertEqual((200, {"choice": "object"}), (changed["http"], self.read(to_b)["answers"]))
        decline = {"id": to_e["request_id"], "expected_revision": to_e["revision"]}
        refused = self.post("/api/planning/request/decline", decline, None)
        self.assertEqual((403, "not_addressed"), (refused["http"], refused["code"]))
        self.assertEqual(200, self.post("/api/planning/request/decline", decline, E)["http"])
        self.assertEqual("declined", self.read(to_e)["status"])

    def test_only_the_session_that_asked_or_valkama_withdraws_it(self) -> None:
        [to_b, to_e] = self.ask(self.goal, B, E)
        withdraw = {"id": to_b["request_id"], "expected_revision": to_b["revision"]}
        for session, agent, who in (
            (B, None, "the session asked"),
            (E, None, "another session"),
            (None, None, "the person in the interface"),
        ):
            with self.subTest(caller=who):
                refused = self.post("/api/planning/request/expire", withdraw, session, agent)
                self.assertEqual((403, "not_asker"), (refused["http"], refused["code"]))
        self.assertEqual(
            200,
            self.post("/api/planning/request/expire", withdraw, A, A2)["http"],
            "any agent of the session that asked",
        )
        self.assertEqual(
            ("expired", "withdrawn"),
            (
                self.read(to_b)["status"],
                self.read(to_b)["expired_reason"],
            ),
        )
        with calls.bind(calls.valkama(), "test"):
            requests.resolve(
                self.conn,
                to_e["request_id"],
                status="expired",
                expected_revision=to_e["revision"],
            )
        self.assertEqual("withdrawn", self.read(to_e)["expired_reason"])

    def test_a_question_to_the_owner_is_answered_as_before(self) -> None:
        with self.acting(A, A1):
            asked = requests.create(
                self.conn, self.goal, kind="question", prompt="Which way?", fields=[TEXT]
            )
        self.assertIsNone(asked["addressee"])
        answered = self.post(
            "/api/planning/request/answer",
            {
                "id": asked["request_id"],
                "expected_revision": asked["revision"],
                "answers": {"answer": "this way"},
            },
            None,
        )
        self.assertEqual(200, answered["http"])


class GoneTests(Harness):
    def test_a_request_to_an_ended_session_reads_gone_at_once_and_waits_again_on_its_resume(
        self,
    ) -> None:
        [to_b, to_e] = self.ask(self.goal, B, E)
        self.end(E)
        self.assertEqual(
            ("expired", "session_gone"),
            (self.read(to_e)["status"], self.read(to_e)["expired_reason"]),
            "no grace: an ended session answers nothing",
        )
        self.assertEqual(
            ("pending", None),
            (
                self.read(to_b)["status"],
                self.read(to_b)["expired_reason"],
            ),
        )
        refused = self.answer(to_e, E)
        self.assertEqual((409, "workflow_guard"), (refused["http"], refused["code"]))
        self.assertIsNone(self.read(to_e)["answers"])
        self.resume(E)
        self.assertEqual(
            ("pending", None),
            (
                self.read(to_e)["status"],
                self.read(to_e)["expired_reason"],
            ),
        )
        self.assertEqual(200, self.answer(to_e, E)["http"])

    def test_a_request_to_a_session_quiet_past_its_lease_reads_gone(self) -> None:
        [to_b] = self.ask(self.goal, B)
        self.conn.execute(
            "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days')"
            " WHERE id = ?",
            (B,),
        )
        self.conn.commit()
        self.assertEqual("session_gone", self.read(to_b)["expired_reason"])
        self.assertEqual([], questions.open_rows(self.conn))


class AskRefusalTests(Harness):
    def test_each_session_that_cannot_be_asked_is_refused_by_name_and_nothing_is_written(
        self,
    ) -> None:
        self.end(E)
        quiet = "c0000000-0000-4000-8000-00000000000c"
        self.conn.execute(
            "INSERT INTO sessions(id, client, last_seen) VALUES(?, 'claude-code',"
            " strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days'))",
            (quiet,),
        )
        subagent = sessions.subagent_session_id(B, B1)
        self.conn.execute(
            "INSERT INTO sessions(id, client, parent_session_id, agent_id)"
            " VALUES(?, 'claude-code', ?, ?)",
            (subagent, B, B1),
        )
        self.conn.commit()
        nobody = "d0000000-0000-4000-8000-00000000000d"
        for asked, says in (
            ([nobody], f"no session {nobody}"),
            ([E], f"session {E} has ended or gone quiet"),
            ([quiet], f"session {quiet} has ended or gone quiet"),
            ([A], f"session {A} is your own"),
            ([subagent], f"session {subagent} is a subagent's; ask the session it works for, {B}"),
            ([B, B], f"session {B} is named twice"),
            ([B, nobody], f"no session {nobody}"),
            ([], "at least one agent session"),
        ):
            with self.subTest(asked=asked):
                with self.assertRaises(model.PlanningError) as raised:
                    self.ask(self.goal, *asked)
                self.conn.rollback()
                self.assertNotIsInstance(raised.exception, model.WorkflowGuardError)
                self.assertEqual(400, api.error_response(raised.exception)[0])
                self.assertIn(says, str(raised.exception))
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0]
        )


ASK = "/api/planning/work-item/request"
C = "c0000000-0000-4000-8000-00000000000c"
D = "d0000000-0000-4000-8000-00000000000d"


class AgentAskTests(Harness):
    """An agent asks another session through `create_work_item_request` with `addressees`.

    The tool and the interface write through one route; the expectations come from the
    contract of that tool: one request for each session named, refusals that name the
    session, and at most three requests from one session to one other within the hour.
    """

    def setUp(self) -> None:
        super().setUp()
        self.t3 = self.item("T3", parent=self.s1)
        self.claim(self.t3, A, A2)
        self.claim(self.item("U"), C)

    def asking(self, *asked: str, **extra: object) -> dict:
        return {
            "id": self.t3,
            "kind": "question",
            "prompt": "Which parser does T2 keep?",
            "fields": [CHOICE],
            "addressees": list(asked),
            **extra,
        }

    def test_an_agent_asks_another_session(self) -> None:
        """O18, the server's part: a1 asks B on T3, which A holds."""

        made = self.post(ASK, self.asking(B), A, A1)
        self.assertEqual(200, made["http"], made)
        [entry] = made["requests"]
        self.assertEqual({"request_id", "addressee"}, set(entry))
        self.assertEqual(B, entry["addressee"])
        record = requests.get(self.conn, entry["request_id"])
        self.assertEqual(
            (B, "pending", self.t3, A),
            (
                record["addressee"],
                record["status"],
                record["reference"],
                requests._asker(self.conn, entry["request_id"]),
            ),
            "asked of B, and A, the session of the agent that called, asked it",
        )
        refused = self.answer(record, C)
        self.assertEqual((403, "not_addressed"), (refused["http"], refused["code"]))
        answered = self.answer(record, B, B1)
        self.assertEqual(
            (200, "answered", {"choice": "agree"}),
            (answered["http"], answered["status"], answered["answers"]),
            "B's subagent answers for B",
        )
        self.assertEqual([], questions.open_rows(self.conn), "nothing waits for the owner")
        self.assertEqual([], requests.list_page(self.conn, reference=self.t3)["requests"])

    def test_a_decision_asks_as_a_question_does(self) -> None:
        made = self.post(ASK, self.asking(B, E, kind="decision"), A, A1)
        self.assertEqual([B, E], [entry["addressee"] for entry in made["requests"]])
        for entry in made["requests"]:
            self.assertEqual("decision", requests.get(self.conn, entry["request_id"])["kind"])

    def test_an_agent_ask_refused_names_why(self) -> None:
        """O19: A and B live, D ended, C quiet past its lease."""

        self.claim(self.item("V"), D)
        self.end(D)
        self.conn.execute(
            "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days')"
            " WHERE id = ?",
            (C,),
        )
        own_agent = sessions.subagent_session_id(A, A1)
        self.conn.execute(
            "INSERT INTO sessions(id, client, parent_session_id, agent_id)"
            " VALUES(?, 'claude-code', ?, ?)",
            (own_agent, A, A1),
        )
        self.conn.commit()
        nobody = "f0000000-0000-4000-8000-00000000000f"
        six = [f"{index}0000000-0000-4000-8000-000000000000" for index in range(1, 7)]
        unproved = calls.Identity(state=calls.UNCONFIRMED, source=calls.MCP, session_id=A)
        for body, caller, says in (
            (self.asking(B), None, "this call proved none"),
            (self.asking(B), unproved, "this call proved none"),
            (self.asking(A), A, f"session {A} is your own"),
            (self.asking(own_agent), A, f"session {own_agent} is a subagent's"),
            (self.asking(D), A, f"session {D} has ended or gone quiet"),
            (self.asking(C), A, f"session {C} has ended or gone quiet"),
            (self.asking(nobody), A, f"no session {nobody}"),
            (self.asking(B, B), A, f"session {B} is named twice"),
            (self.asking(*six), A, "at most 5 sessions"),
            (self.asking(), A, "at least one agent session"),
            (self.asking(B, session_id=A), A, "execution_id and session_id"),
        ):
            with self.subTest(says=says):
                refused = self.post_as(body, caller)
                self.assertEqual((400, "invalid_request"), (refused["http"], refused["code"]))
                self.assertIn(says, refused["message"])
        self.assertEqual(
            0,
            self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0],
            "no refusal wrote a request",
        )
        for turn in range(3):
            with self.subTest(ask=turn + 1):
                self.assertEqual(200, self.post(ASK, self.asking(B), A, A1)["http"])
        limited = self.post(ASK, self.asking(B), A, A2)
        self.assertEqual((429, "ask_limit"), (limited["http"], limited["code"]))
        self.assertIn(f"session {B} was asked 3 times in the last hour", limited["message"])
        self.assertEqual(
            200,
            self.post(ASK, self.asking(E), A, A1)["http"],
            "the limit is of one session asking one other",
        )
        self.assertEqual(
            200,
            self.post(ASK, self.asking(B), E)["http"],
            "and another session asks B as before",
        )

    def post_as(self, body: dict, caller: calls.Identity | str | None) -> dict:
        """The route as a session, the person (None) or a call that proved nothing."""

        if not isinstance(caller, calls.Identity):
            return self.post(ASK, body, caller)
        try:
            with calls.bind(caller, "test"):
                answer = api.handle_post(self.conn, ASK, body)
        except model.PlanningError as error:
            self.conn.rollback()
            status, refusal = api.error_response(error)
            return {"http": status, **refusal["error"]}
        self.conn.commit()
        assert answer is not None
        return {"http": answer[0], **answer[1]}


class OwnerTests(Harness):
    """A request asked of a session is no question to the owner, wherever one is read."""

    def setUp(self) -> None:
        super().setUp()
        self.asked = self.ask(self.t2, B, E)

    def test_no_reader_of_the_owners_questions_sees_it(self) -> None:
        self.assertEqual([], questions.open_rows(self.conn))
        self.assertEqual([], questions.open_rows(self.conn, self.work_item_id(self.t2)))
        for lists in (True, False):
            with self.subTest(lists=lists):
                page = requests.list_page(self.conn, reference=self.t2, lists=lists)
                self.assertEqual([], page["requests"])
        self.assertEqual(
            [0],
            [entry["pending_questions"] for entry in held.held_by_session(self.conn, B)["items"]],
        )

    def test_the_items_questions_leave_it_out_and_count_the_open_ones(self) -> None:
        with self.acting(A, A1):
            mine = requests.create(
                self.conn, self.t2, kind="question", prompt="Which way?", fields=[TEXT]
            )
        self.end(E)
        found = requests.item_questions(self.conn, self.work_item_id(self.t2))
        self.assertEqual(
            (1, 1, [mine["request_id"]], 1),
            (
                found["total"],
                found["open"],
                [entry["id"] for entry in found["items"]],
                found["addressed_open"],
            ),
            "E has ended, so only B's request is still open",
        )
        self.assertEqual(
            {"count": 1, "open": 1, "addressed_open": 1},
            requests.question_counts(self.conn, self.work_item_id(self.t2)),
            "the card counts what the questions part reads",
        )

    def test_a_card_with_only_a_request_asked_of_a_session_names_its_questions(self) -> None:
        card = tools.OPS["get_work_item"](self.conn, {"id": self.t2})
        assert isinstance(card, dict)
        self.assertEqual({"count": 0, "open": 0, "addressed_open": 2}, card["parts"]["questions"])

    def test_a_session_lists_the_open_requests_asked_of_it(self) -> None:
        [to_b, _to_e] = self.asked
        with self.acting(B, B1):
            page = requests.list_page(self.conn, addressed=True)
        self.assertEqual([to_b["request_id"]], [entry["request_id"] for entry in page["requests"]])
        self.answer(to_b, B)
        with self.acting(B):
            self.assertEqual([], requests.list_page(self.conn, addressed=True)["requests"])
        with self.acting(None), self.assertRaises(model.PlanningError) as raised:
            requests.list_page(self.conn, addressed=True)
        self.assertIn("proved no agent session", str(raised.exception))

    def work_item_id(self, ref: str) -> str:
        return str(service.get_work_item(self.conn, ref)["work_item_id"])


if __name__ == "__main__":
    unittest.main()
