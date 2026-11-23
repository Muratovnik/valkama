"""An agent's cancel of work other live sessions do: the sessions are asked, and decide.

The expectations come from the contract of the round of consent: the cancel waits,
nothing is cancelled, and each session working on the goal gets one request, open for
a day; where the owner decides, the owner's question is asked at once beside them and
shows their answers as they come. Where the round decides, every session agreeing or
having moved its work out makes the cancel as Valkama's write and marks it in the
summary of decisions; an objection or a day of silence passes it to the owner, and an
ended session is not counted. A cancel that follows an owner's answer still asks the
sessions. The owner's answer to a shared cancel ends what the sessions were asked.

Every scenario stands on the owner's goal, so its creator follows nothing; under it
`session-b` holds one task, `session-c` another, and a third waits ready. The agent of
`session-a` cancels the goal through its tools, at a clock the test moves.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
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
    read_model,
    request_model,
    requests,
    service,
    split,
    sweep,
    tools,
)


def _agent(session: str) -> calls.Identity:
    return calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id=session, client="claude")


A, B, C = _agent("session-a"), _agent("session-b"), _agent("session-c")
#: A session that neither asked nor is asked.
D = _agent("session-d")
#: How a session is named where the round lists it: as a holder is named.
LABEL_A, LABEL_B, LABEL_C = (
    "claude (session session-a)",
    "claude (session session-b)",
    "claude (session session-c)",
)
REASON = "covered by another goal"
SUMMARY = {"done": "Nothing: another goal covers it.", "next": "Nothing."}
REFUSED = (model.PlanningError, api.PlanningHttpError)
#: The tables a pass of the sweep may write.
TABLES = (
    "work_items",
    "work_item_events",
    "work_item_requests",
    "pending_actions",
    "agent_decisions",
    "execution_events",
)


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
        service.create_planning_space(self.conn, name="Alpha", key="ALPHA")
        self.conn.commit()
        self.space = read_model.space_identity(self.conn, "ALPHA")
        # The requests lapse by the wall clock and the round by the lease clock: the test
        # starts both at the same moment and moves only the lease clock.
        self.clock = datetime.now(UTC).replace(microsecond=0)
        clock = mock.patch.object(leases, "utc_now", lambda: self.clock)
        clock.start()
        self.addCleanup(clock.stop)

    # -- the scenario ---------------------------------------------------------------

    def at(self, name: str) -> None:
        participation.write_set(self.conn, self.space, name)
        self.conn.commit()

    def as_(self, by: calls.Identity, tool: str, write, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
        try:
            with calls.bind(by, tool):
                answer = write(self.conn, *args, **kwargs)
        except BaseException:
            self.conn.rollback()
            raise
        self.conn.commit()
        return answer

    def tree(self, title: str = "The owner's goal") -> tuple[str, str, str, str]:
        """The owner's goal, a task under it `session-b` holds, one `session-c` holds and
        one ready; the agent has had its say on the goal. Their references."""

        goal = self.filed(title, kind="goal")
        held_b, held_c, ready = (self.filed(name, parent=goal) for name in ("B's", "C's", "Ready"))
        self.as_(B, "claim_work_item", service.claim_work_item, held_b, author="claude")
        self.as_(C, "claim_work_item", service.claim_work_item, held_c, author="claude")
        # The agent has its say on the owner's goal before it closes it (`person_spoke`).
        self.tool("apply_work_item_changes", id=goal, comment={"body": "Another goal covers it."})
        return goal, held_b, held_c, ready

    def filed(self, title: str, **fields: object) -> str:
        created = self.as_(
            calls.browser(),
            "/api/planning/work-items",
            service.create_work_item,
            space="ALPHA",
            title=title,
            **fields,
        )
        return str(created["reference"])

    def tool(self, name: str, by: calls.Identity = A, **arguments: object) -> dict:
        answer = self.as_(by, name, lambda conn: tools.OPS[name](conn, arguments))
        assert isinstance(answer, dict)
        return answer

    def cancel(self, goal: str, **transition: object) -> dict:
        """The agent's cancel of the goal, confirmed by the list its first call hands over."""

        sent = {"state": "cancelled", "reason": REASON, **transition}
        with self.assertRaises(REFUSED) as listed:
            self.tool("apply_work_item_changes", id=goal, summary=SUMMARY, transition=sent)
        status, body = api.error_response(listed.exception)
        self.assertEqual((409, "cancel_list"), (status, body["error"]["code"]))
        sent["cancels"] = body["error"]["list_token"]
        return self.tool("apply_work_item_changes", id=goal, summary=SUMMARY, transition=sent)

    def answer(self, question: str, by: calls.Identity, **answers: object) -> dict:
        row = self.request(question)
        tool = "/api/planning/request/resolve" if by.source == calls.BROWSER else "answer"
        return self.as_(
            by,
            tool,
            requests.resolve,
            question,
            status="answered",
            expected_revision=int(row["revision"]),
            answers=answers,
            author="user" if by.source == calls.BROWSER else "claude",
        )

    def consent(self, goal: str, by: calls.Identity, choice: str, **more: object) -> dict:
        return self.answer(self.asked_of(goal, by), by, answer=choice, **more)

    def end_session(self, by: calls.Identity) -> None:
        self.conn.execute(
            "UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?",
            (request_model.stamp(self.clock), by.session_id),
        )
        self.conn.commit()

    def pass_consent(self) -> sweep.Pass:
        step = next(step for step in sweep.STEPS if step.name == sweep.CONSENT)
        return sweep.run_pass(self.conn, steps=(step,))

    # -- reads ----------------------------------------------------------------------

    def item_id(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def card(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def category(self, reference: str) -> str:
        """Where the item stands: its state's category, or `open` for an accepted open goal,
        which stands in no state."""

        state = self.card(reference)["state"]
        return "open" if state is None else str(state["category"])

    def request(self, question: str) -> sqlite3.Row:
        return self.conn.execute(
            "SELECT * FROM work_item_requests WHERE request_id = ?", (question,)
        ).fetchone()

    def asked(self, goal: str) -> list[sqlite3.Row]:
        """The requests on the goal asked of sessions, in the order they were asked."""

        return self.conn.execute(
            "SELECT * FROM work_item_requests WHERE work_item_id = ? AND addressee IS NOT NULL"
            " ORDER BY created_at, rowid",
            (self.item_id(goal),),
        ).fetchall()

    def asked_of(self, goal: str, by: calls.Identity) -> str:
        [row] = [row for row in self.asked(goal) if row["addressee"] == by.session_id]
        return str(row["request_id"])

    def owners_list(self) -> list[str]:
        return [str(row["request_id"]) for row in questions.open_rows(self.conn)]

    def action(self, goal: str) -> pending.Action:
        [found] = self.conn.execute(
            "SELECT * FROM pending_actions WHERE work_item_id = ?", (self.item_id(goal),)
        ).fetchall()
        return pending.Action.of_row(found)

    def decided(self) -> list[tuple[str, str, str]]:
        return [
            (entry["point"], entry["item"]["reference"], entry["what"])
            for entry in decisions.page(self.conn, space=self.space)["items"]
        ]

    def cancelled_by(self, reference: str) -> tuple[str, str, str]:
        """The cancel's event, and the source and tool of the call that made it."""

        found = self.conn.execute(
            "SELECT e.detail, c.identity_source, c.tool FROM work_item_events e"
            " JOIN execution_events c ON c.id = e.call_id"
            " WHERE e.work_item_id = ? AND e.action = 'transitioned' ORDER BY e.id DESC LIMIT 1",
            (self.item_id(reference),),
        ).fetchone()
        return tuple(found)  # type: ignore[return-value]

    def store(self) -> dict[str, list[tuple]]:
        return {
            table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table} ORDER BY 1")]
            for table in TABLES
        }

    def refused(self, write) -> str:  # type: ignore[no-untyped-def]
        before = self.store()
        with self.assertRaises(REFUSED) as refused:
            write()
        self.assertEqual(before, self.store())
        return str(refused.exception)


class AskingTests(Harness):
    def test_a_cancel_of_held_work_asks_the_sessions(self) -> None:
        self.at(participation.MINIMAL)
        goal, held_b, held_c, ready = self.tree()
        answer = self.cancel(goal)
        action = self.action(goal)
        until = request_model.stamp(self.clock + timedelta(days=1))
        self.assertEqual(
            {
                "action": action.id,
                "point": "cancel_shared",
                "sessions": [LABEL_B, LABEL_C],
                "until": until,
            },
            answer["waits_for_sessions"],
        )
        self.assertNotIn("waits_for_owner", answer)
        # Nothing is cancelled: the goal and the work under it stand as they were.
        self.assertEqual(
            ["open", "active", "active", "ready"],
            [self.category(reference) for reference in (goal, held_b, held_c, ready)],
        )
        self.assertEqual(
            [
                ("session-b", "consent", action.id, "pending", until),
                ("session-c", "consent", action.id, "pending", until),
            ],
            [
                (
                    row["addressee"],
                    row["purpose"],
                    row["action_id"],
                    row["status"],
                    row["expires_at"],
                )
                for row in self.asked(goal)
            ],
        )
        [fields, reason] = json.loads(self.asked(goal)[0]["fields_json"])
        self.assertEqual(
            ["agree", "object", "moved_out"], [option["id"] for option in fields["options"]]
        )
        self.assertEqual(("reason", "object"), (reason["id"], reason["under"]["option"]))
        # The owner is asked nothing, and Valkama asked the sessions, not the agent.
        self.assertEqual([], self.owners_list())
        asker = self.conn.execute(
            "SELECT c.identity_source, c.tool FROM work_item_events e"
            " JOIN execution_events c ON c.id = e.call_id"
            " WHERE e.action = 'request_created' AND e.detail = ?",
            (self.asked_of(goal, B),),
        ).fetchone()
        self.assertEqual(("valkama", "consent-round"), tuple(asker))
        # The work under the goal is not handed out while its cancel waits.
        with calls.bind(A, "claim_ready_work_item"):
            self.assertIsNone(service.claim_ready_work_item(self.conn, space="ALPHA"))
        self.conn.rollback()
        self.assertIn("ancestor_cancelling", self.card(ready)["withheld"])
        # The same cancel sent again answers the same wait and asks nobody again.
        before = self.store()["work_item_requests"]
        again = self.cancel(goal)
        self.assertEqual(answer["waits_for_sessions"], again["waits_for_sessions"])
        self.assertEqual(before, self.store()["work_item_requests"])

    def test_the_owner_decides_and_sees_the_sessions(self) -> None:
        self.at(participation.DEFAULT)
        goal, *_work = self.tree()
        waits = self.cancel(goal)["waits_for_owner"]
        action = self.action(goal)
        self.assertEqual(
            ("cancel_shared", action.id, f"cancel {goal}"),
            (waits["point"], waits["action"], waits["what"]),
        )
        self.assertEqual([waits["question"]], self.owners_list())
        question = self.request(waits["question"])
        self.assertEqual(("cancel", action.id), (question["purpose"], question["action_id"]))
        self.assertIn("which other sessions work on", question["prompt"])
        self.assertIn(REASON, question["prompt"])
        # The sessions are asked at once, beside the owner.
        self.assertEqual(["session-b", "session-c"], [row["addressee"] for row in self.asked(goal)])
        shown = requests.get(self.conn, waits["question"])["action"]["consent"]
        self.assertEqual([None, None], [entry["answer"] for entry in shown])
        # An answer shows in the owner's question as it comes, and decides nothing.
        self.consent(goal, B, "agree")
        shown = requests.get(self.conn, waits["question"])["action"]["consent"]
        self.assertEqual(
            [(LABEL_B, "agree"), (LABEL_C, None)],
            [(entry["session"], entry["answer"]) for entry in shown],
        )
        self.assertIsNotNone(shown[0]["at"])
        self.assertEqual("open", self.category(goal))
        self.assertIsNone(self.action(goal).outcome)


class RoundTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.at(participation.MINIMAL)
        self.goal, self.held_b, self.held_c, self.ready = self.tree()
        self.waits = self.cancel(self.goal)["waits_for_sessions"]

    def test_agreement_of_every_busy_session_cancels(self) -> None:
        self.consent(self.goal, B, "agree")
        self.assertEqual("open", self.category(self.goal))
        # C still holds work in the list: it moves that out first.
        said = self.refused(lambda: self.consent(self.goal, C, "moved_out"))
        self.assertEqual(
            f"[consent] {self.held_c} is still in the list: move it out with move_out first",
            said,
        )
        self.as_(
            C,
            "apply_work_item_changes",
            split.move_out,
            self.held_c,
            reason="mine",
            author="claude",
        )
        self.consent(self.goal, C, "moved_out")
        # The cancel is made as Valkama's write, by the list as it stands now.
        self.assertEqual(
            ["cancelled", "cancelled", "cancelled"],
            [self.category(reference) for reference in (self.goal, self.held_b, self.ready)],
        )
        detail, source, tool = self.cancelled_by(self.goal)
        self.assertEqual(("valkama", "consent-cancel"), (source, tool))
        self.assertEqual(f"cancelled: {REASON}; agreed by {LABEL_B}, {LABEL_C}", detail)
        moved = self.card(self.held_c)
        self.assertEqual(
            ("active", None, LABEL_C),
            (moved["state"]["category"], moved["parent_id"], moved["claim_ref"]),
        )
        self.assertEqual("carried_out", self.action(self.goal).outcome)
        self.assertIn(("cancel_shared", self.goal, f"cancel {self.goal}"), self.decided())
        # Valkama made the cancel, and the summary names the session whose agent asked it.
        [marked] = [
            entry
            for entry in decisions.page(self.conn, space=self.space)["items"]
            if entry["point"] == "cancel_shared" and entry["item"]["reference"] == self.goal
        ]
        self.assertEqual(LABEL_A, marked["session"])
        # The agent that asked follows the goal and hears Valkama's write there.
        follows = self.conn.execute(
            "SELECT follows FROM work_item_subscriptions WHERE work_item_id = ? AND session_id = ?",
            (self.item_id(self.goal), "session-a"),
        ).fetchone()
        self.assertEqual(1, follows[0])
        heard = {
            entry["kind"]
            for _call, entry in person_events.valkama_since(self.conn, self.item_id(self.goal), 0)
        }
        self.assertIn("status", heard)

    def withdrawal(self, question: str) -> dict[str, object]:
        row = self.request(question)
        return {"id": question, "expected_revision": int(row["revision"]), "author": "claude"}

    def test_the_agent_that_asked_withdraws_its_cancel_and_no_other_session_does(self) -> None:
        # Valkama's call asked the sessions; the agent whose cancel waits is who asked.
        asked_b = self.asked_of(self.goal, B)
        self.assertEqual(LABEL_A, requests.get(self.conn, asked_b)["action"]["asked_by"])
        for by in (B, D):
            with self.subTest(by=by.session_id):
                with self.assertRaises(REFUSED) as refused:
                    self.tool("expire_work_item_request", by, **self.withdrawal(asked_b))
                status, body = api.error_response(refused.exception)
                self.assertEqual((403, "not_asker"), (status, body["error"]["code"]))
        self.assertEqual(["pending", "pending"], [row["status"] for row in self.asked(self.goal)])
        withdrawn = self.tool("expire_work_item_request", **self.withdrawal(asked_b))
        self.assertEqual(("expired", "withdrawn"), (withdrawn["status"], withdrawn["carried_out"]))
        self.assertEqual("withdrawn", self.action(self.goal).outcome)
        self.assertEqual(
            [("expired", "withdrawn"), ("expired", "withdrawn")],
            [(row["status"], row["expired_reason"]) for row in self.asked(self.goal)],
        )
        self.assertEqual("open", self.category(self.goal))
        self.assertEqual([], self.decided())

    def test_the_agent_that_asked_withdraws_the_cancel_the_round_passed_on(self) -> None:
        self.consent(self.goal, B, "object", reason="the release needs it")
        # Valkama's call asked the owner on the agent's behalf.
        [question] = self.owners_list()
        self.assertEqual(LABEL_A, requests.get(self.conn, question)["action"]["asked_by"])
        with self.assertRaises(REFUSED) as refused:
            self.tool("expire_work_item_request", D, **self.withdrawal(question))
        self.assertEqual("not_asker", api.error_response(refused.exception)[1]["error"]["code"])
        withdrawn = self.tool("expire_work_item_request", **self.withdrawal(question))
        self.assertEqual("withdrawn", withdrawn["carried_out"])
        self.assertEqual("withdrawn", self.action(self.goal).outcome)
        self.assertEqual([], self.owners_list())
        self.assertEqual("open", self.category(self.goal))

    def test_an_objection_passes_the_cancel_to_the_owner(self) -> None:
        said = self.refused(lambda: self.consent(self.goal, B, "object"))
        self.assertEqual(
            "[consent] answer is agree, object or moved_out; object needs a reason", said
        )
        self.consent(self.goal, B, "object", reason="the release needs it")
        [question] = self.owners_list()
        row = self.request(question)
        self.assertEqual(("cancel", self.action(self.goal).id), (row["purpose"], row["action_id"]))
        self.assertIn(f"{LABEL_B} objects: the release needs it.", row["prompt"])
        shown = requests.get(self.conn, question)["action"]["consent"]
        self.assertEqual(
            [(LABEL_B, "object", "the release needs it"), (LABEL_C, None, None)],
            [(entry["session"], entry["answer"], entry["reason"]) for entry in shown],
        )
        self.assertEqual(["open", "active"], [self.category(self.goal), self.category(self.held_c)])
        # C may still answer for the owner to see, and that decides nothing.
        self.assertEqual("pending", self.request(self.asked_of(self.goal, C))["status"])
        self.consent(self.goal, C, "agree")
        self.assertEqual(([question], "open"), (self.owners_list(), self.category(self.goal)))

    def test_a_day_of_silence_passes_the_cancel_to_the_owner(self) -> None:
        # Before the day is out, the step has nothing to do.
        self.assertEqual({}, self.pass_consent().changed)
        self.clock += timedelta(days=1, minutes=1)
        self.assertEqual({sweep.CONSENT: 1}, self.pass_consent().changed)
        [question] = self.owners_list()
        self.assertEqual(self.action(self.goal).id, self.request(question)["action_id"])
        self.assertIn(
            f"Not every session answered within a day: {LABEL_B}, {LABEL_C} did not.",
            self.request(question)["prompt"],
        )
        self.assertEqual(
            [("expired", "deadline"), ("expired", "deadline")],
            [(row["status"], row["expired_reason"]) for row in self.asked(self.goal)],
        )
        self.assertEqual("open", self.category(self.goal))
        # A second pass changes nothing.
        before = self.store()
        self.assertEqual({}, self.pass_consent().changed)
        self.assertEqual(before, self.store())

    def test_an_ended_session_is_not_counted(self) -> None:
        self.end_session(C)
        self.consent(self.goal, B, "agree")
        self.assertEqual("cancelled", self.category(self.goal))
        detail, source, _tool = self.cancelled_by(self.goal)
        self.assertEqual((f"cancelled: {REASON}; agreed by {LABEL_B}", "valkama"), (detail, source))

    def test_the_sweep_settles_a_round_nobody_is_left_to_answer(self) -> None:
        self.end_session(B)
        self.end_session(C)
        self.assertEqual({sweep.CONSENT: 1}, self.pass_consent().changed)
        self.assertEqual("cancelled", self.category(self.goal))
        self.assertEqual(f"cancelled: {REASON}", self.cancelled_by(self.goal)[0])
        before = self.store()
        self.assertEqual({}, self.pass_consent().changed)
        self.assertEqual(before, self.store())

    def test_a_cancel_a_guard_now_refuses_is_dropped_and_the_answer_stands(self) -> None:
        refusal = model.WorkflowGuardError("[transition] refused for the test")
        with mock.patch.object(service, "cancel_agreed", side_effect=refusal):
            self.consent(self.goal, B, "agree")
            self.consent(self.goal, C, "agree")
        action = self.action(self.goal)
        self.assertEqual("dropped", action.outcome)
        self.assertEqual("answered", self.request(self.asked_of(self.goal, C))["status"])
        self.assertEqual("open", self.category(self.goal))
        [dropped] = self.conn.execute(
            "SELECT detail FROM work_item_events WHERE work_item_id = ? AND action = 'action_dropped'",
            (self.item_id(self.goal),),
        ).fetchall()
        self.assertEqual("cancel_shared: [transition] refused for the test", dropped[0])

    def test_a_session_answers_its_request_once(self) -> None:
        question = self.asked_of(self.goal, B)
        self.consent(self.goal, B, "agree")
        row = self.request(question)
        said = self.refused(
            lambda: self.as_(
                B,
                "answer",
                requests.change,
                question,
                expected_revision=int(row["revision"]),
                answers={"answer": "object", "reason": "changed my mind"},
                author="claude",
            )
        )
        self.assertTrue(said.startswith("[purpose]"), said)
        # Nobody but the session it asks answers it, the owner included; nor is it declined.
        other = self.asked_of(self.goal, C)
        with self.assertRaises(model.NotAddressedError):
            self.answer(other, calls.browser(), answer="agree")
        declined = self.refused(
            lambda: self.as_(
                C,
                "answer",
                requests.resolve,
                other,
                status="declined",
                expected_revision=int(self.request(other)["revision"]),
                author="claude",
            )
        )
        self.assertTrue(declined.startswith("[purpose]"), declined)


class FollowingTests(Harness):
    def owners_answer(self, goal: str) -> str:
        """A question on the goal the owner answered; its id."""

        fields = [
            {
                "id": "answer",
                "label": "Answer",
                "type": "choice",
                "required": True,
                "options": [{"id": "drop", "label": "Drop it"}, {"id": "keep", "label": "Keep it"}],
            }
        ]
        asked = self.as_(
            A,
            "create_work_item_request",
            requests.create,
            goal,
            kind="question",
            prompt="Is this goal still needed?",
            fields=fields,
        )
        question = str(asked["request_id"])
        self.answer(question, calls.browser(), answer="drop")
        # The agent reads the owner's answer before it closes the goal (`person_spoke`).
        self.tool("apply_work_item_changes", id=goal, comment={"body": "The owner dropped it."})
        return question

    def test_a_cancel_following_the_owners_answer_still_asks_the_sessions(self) -> None:
        self.at(participation.MAXIMAL)
        goal, *_work = self.tree()
        question = self.owners_answer(goal)
        answer = self.cancel(goal, following=question)
        self.assertNotIn("waits_for_owner", answer)
        self.assertEqual([LABEL_B, LABEL_C], answer["waits_for_sessions"]["sessions"])
        self.assertEqual([], self.owners_list())
        self.assertEqual(["session-b", "session-c"], [row["addressee"] for row in self.asked(goal)])
        self.consent(goal, B, "agree")
        self.consent(goal, C, "agree")
        self.assertEqual("cancelled", self.category(goal))
        self.assertEqual("valkama", self.cancelled_by(goal)[1])
        self.assertIn(
            ("cancel_shared", goal, f"cancel {goal} following question {question}"),
            self.decided(),
        )
        # In another run B objects: the owner decides after all.
        other, *_more = self.tree("Another goal of the owner's")
        asked = self.owners_answer(other)
        self.cancel(other, following=asked)
        self.consent(other, B, "object", reason="still needed")
        [question] = self.owners_list()
        self.assertEqual(self.action(other).id, self.request(question)["action_id"])
        self.assertIn(f"{LABEL_B} objects: still needed.", self.request(question)["prompt"])
        self.assertEqual("open", self.category(other))


class OwnersAnswerTests(Harness):
    def objected(self, title: str) -> tuple[str, str, str, str, str]:
        """At the default set, the agent's cancel of a goal B objected to: the goal, its
        work, and the owner's question."""

        goal, held_b, held_c, ready = self.tree(title)
        question = self.cancel(goal)["waits_for_owner"]["question"]
        self.consent(goal, B, "object", reason="the release needs it")
        return goal, held_b, held_c, ready, question

    def told(self, reference: str) -> set[str]:
        return {
            entry["kind"]
            for entry in person_events.since_last_agent_write(self.conn, self.item_id(reference))
        }

    def test_the_owner_answers_a_shared_cancel(self) -> None:
        self.at(participation.DEFAULT)
        goal, held_b, held_c, ready, question = self.objected("The owner's goal")
        token = requests.get(self.conn, question)["action"]["cancel_list"]["list_token"]
        record = self.answer(question, calls.browser(), answer="cancel", cancels=token)
        self.assertEqual("carried_out", record["carried_out"])
        self.assertEqual(
            ["cancelled"] * 4,
            [self.category(reference) for reference in (goal, held_b, held_c, ready)],
        )
        self.assertEqual(
            ("expired", "withdrawn"),
            tuple(
                self.request(self.asked_of(goal, C))[name] for name in ("status", "expired_reason")
            ),
        )
        self.assertEqual("carried_out", self.action(goal).outcome)
        # B and C hear the owner's cancel of the work they held.
        self.assertIn("status", self.told(held_b))
        self.assertIn("status", self.told(held_c))
        # The owner made it: nothing goes into the summary of agent decisions.
        self.assertNotIn("cancel_shared", [entry[0] for entry in self.decided()])
        # In another run the owner keeps the goal.
        kept, *work, asked = self.objected("Another goal of the owner's")
        record = self.answer(asked, calls.browser(), answer="keep")
        self.assertEqual("declined", record["carried_out"])
        self.assertEqual(
            ["open", "active", "active", "ready"],
            [self.category(reference) for reference in (kept, *work)],
        )
        self.assertEqual(
            ("expired", "withdrawn"),
            tuple(
                self.request(self.asked_of(kept, C))[name] for name in ("status", "expired_reason")
            ),
        )
        self.assertEqual("declined", self.action(kept).outcome)


#: `session-b` proved by the same channel as `B`, whose session row carries the client
#: name its handshake gave instead of the channel's.
PROBE = calls.Identity(
    calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-b", client="probe-client"
)


class SessionNameTests(Harness):
    """A session the round asks is named as it holds, by the channel that proved it, in
    every place the round names it: the write's answer, the question read whole, the
    owner's question and the cancel's history. Its session row's client name is not that."""

    def setUp(self) -> None:
        super().setUp()
        self.at(participation.MINIMAL)

    def round(self, title: str) -> tuple[str, str]:
        """A goal whose two tasks `PROBE` and `C` hold, and the agent's cancel of it, waiting
        for them: the goal's reference and the one `PROBE` holds."""

        goal = self.filed(title, kind="goal")
        held_b, held_c = (self.filed(name, parent=goal) for name in ("B's", "C's"))
        self.as_(PROBE, "claim_work_item", service.claim_work_item, held_b, author="claude")
        self.as_(C, "claim_work_item", service.claim_work_item, held_c, author="claude")
        self.tool("apply_work_item_changes", id=goal, comment={"body": "Another goal covers it."})
        self.assertEqual(
            [LABEL_B, LABEL_C], self.cancel(goal)["waits_for_sessions"]["sessions"], title
        )
        return goal, held_b

    def test_a_session_is_named_by_its_channel_not_its_client(self) -> None:
        goal, held_b = self.round("The owner's goal")
        [client] = self.conn.execute(
            "SELECT client FROM sessions WHERE id = 'session-b'"
        ).fetchone()
        self.assertEqual("probe-client", client)
        held = self.card(held_b)["claim_ref"]
        self.assertEqual((LABEL_B, ("session-b", None)), (held, calls.holder_ids(held)))
        shown = requests.get(self.conn, self.asked_of(goal, PROBE))["action"]["consent"]
        self.assertEqual([held, LABEL_C], [entry["session"] for entry in shown])
        # An objection passes the cancel to the owner, whose question names the session so.
        self.consent(goal, PROBE, "object", reason="the release needs it")
        [question] = self.owners_list()
        self.assertIn(f"{held} objects: the release needs it.", self.request(question)["prompt"])
        # Where both agree, the cancel Valkama makes says who agreed, so too.
        agreed, _held = self.round("Another goal of the owner's")
        self.consent(agreed, PROBE, "agree")
        self.consent(agreed, C, "agree")
        detail, source, tool = self.cancelled_by(agreed)
        self.assertEqual(
            (f"cancelled: {REASON}; agreed by {held}, {LABEL_C}", "valkama", "consent-cancel"),
            (detail, source, tool),
        )


class DescriptionTests(unittest.TestCase):
    def described(self, name: str) -> str:
        [tool] = [entry for entry in tools.TOOLS if entry["name"] == name]
        return str(tool["description"])

    def test_the_tools_say_a_shared_cancel_waits_for_the_sessions(self) -> None:
        self.assertIn(
            "A cancel of work other sessions hold may wait for them instead (waits_for_sessions).",
            self.described("apply_work_item_changes"),
        )
        self.assertIn(
            "A consent request is answered once, by the session it asks.",
            self.described("answer_work_item_request"),
        )


if __name__ == "__main__":
    unittest.main()
