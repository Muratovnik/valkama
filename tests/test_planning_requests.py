from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from server import mcp_surface, sessions, store
from server.executions import service as executions
from server.planning import (
    api,
    calls,
    model,
    person_events,
    request_model,
    requests,
    service,
    tools,
)


def field(identity: str = "reply", kind: str = "text", required: bool = True) -> dict:
    return {
        "id": identity,
        "label": "Your answer",
        "type": kind,
        "required": required,
        "options": [{"id": "yes", "label": "Proceed"}, {"id": "no", "label": "Stop"}]
        if kind in {"choice", "multi_choice"}
        else [],
    }


class PlanningRequestTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "store.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Requests", key="REQ")
        self.item = service.create_work_item(self.conn, space="REQ", title="Pick a direction")
        self.conn.commit()

    def close(self, state: str = "done") -> None:
        """Close the item the way every close goes: its summary, then the move."""

        service.set_summary(self.conn, self.item["reference"], {"done": "Done", "next": "None"})
        service.transition_work_item(
            self.conn, self.item["reference"], state, acceptance="assignment"
        )

    def create(self, **kwargs) -> dict:
        return requests.create(
            self.conn,
            self.item["reference"],
            kind="question",
            prompt="What next?",
            fields=[field()],
            **kwargs,
        )

    def test_answer_keeps_its_own_revision_and_history_without_changing_workflow(self) -> None:
        request = self.create()
        self.conn.commit()
        before = service.get_work_item(self.conn, self.item["reference"])
        answer = tools.OPS["answer_work_item_request"](
            self.conn,
            {
                "id": request["request_id"],
                "answers": {"reply": "Proceed"},
                "expected_revision": 0,
                "author": "owner",
            },
        )
        self.assertEqual(
            ("answered", 1, {"reply": "Proceed"}, "owner"),
            (answer["status"], answer["revision"], answer["answers"], answer["answered_by"]),
        )
        after = service.get_work_item(self.conn, self.item["reference"])
        self.assertEqual(before["revision"], after["revision"])
        self.assertEqual(before["state"], after["state"])
        self.assertEqual([], after["comments"])
        self.assertEqual(
            ["created", "request_created", "request_answered"],
            [event["action"] for event in after["events"]],
        )
        self.assertEqual(request["request_id"], after["events"][-1]["detail"])
        with self.assertRaises(model.RevisionConflictError):
            requests.resolve(
                self.conn, request["request_id"], status="declined", expected_revision=0
            )

    def test_an_expected_revision_must_be_a_count(self) -> None:
        request = self.create()
        self.conn.commit()
        for revision in (-1, True, "0", 0.0, None):
            with (
                self.subTest(revision=revision),
                self.assertRaisesRegex(
                    model.PlanningError, "expected_revision must be a non-negative integer"
                ),
            ):
                requests.resolve(
                    self.conn, request["request_id"], status="declined", expected_revision=revision
                )
        self.assertEqual(
            "declined",
            requests.resolve(
                self.conn, request["request_id"], status="declined", expected_revision=0
            )["status"],
        )

    def test_two_connections_answer_exactly_once(self) -> None:
        request = self.create()
        self.conn.commit()
        barrier = threading.Barrier(2)
        results: list[str] = []
        failures: list[BaseException] = []

        def answer(text: str) -> None:
            conn = sqlite3.connect(self.path, timeout=5)
            conn.row_factory = sqlite3.Row
            try:
                barrier.wait(5)
                requests.resolve(
                    conn,
                    request["request_id"],
                    status="answered",
                    expected_revision=0,
                    answers={"reply": text},
                )
                conn.commit()
                results.append(text)
            except model.RevisionConflictError:
                conn.rollback()
                results.append("conflict")
            except (sqlite3.Error, model.PlanningError, threading.BrokenBarrierError) as error:
                failures.append(error)
            finally:
                conn.close()

        threads = [threading.Thread(target=answer, args=(text,)) for text in ("one", "two")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual([], failures)
        self.assertEqual(2, len(results))
        self.assertEqual(1, results.count("conflict"))
        self.assertEqual(
            1,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_events WHERE action='request_answered'"
            ).fetchone()[0],
        )

    def test_effective_expiry_reads_never_write_and_late_answers_are_refused(self) -> None:
        request = self.create(expires_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat())
        deadline = request_model.timestamp((datetime.now(UTC) - timedelta(seconds=1)).isoformat())
        self.conn.execute(
            "UPDATE work_item_requests SET expires_at=? WHERE request_id=?",
            (deadline, request["request_id"]),
        )
        self.conn.commit()
        before = self.conn.total_changes
        expired = requests.get(self.conn, request["request_id"])
        self.assertEqual(
            ("expired", "deadline", None, 0),
            (
                expired["status"],
                expired["expired_reason"],
                expired["resolved_at"],
                expired["revision"],
            ),
        )
        self.assertEqual(before, self.conn.total_changes)
        with self.assertRaises(model.WorkflowGuardError):
            requests.resolve(
                self.conn,
                request["request_id"],
                status="answered",
                expected_revision=0,
                answers={"reply": "late"},
            )
        self.assertEqual(
            "pending", self.conn.execute("SELECT status FROM work_item_requests").fetchone()[0]
        )
        # A stale application clock cannot defeat the SQL deadline guard.
        with mock.patch.object(request_model, "now", return_value="1900-01-01T00:00:00.000000Z"):
            with self.assertRaises(model.WorkflowGuardError):
                requests.resolve(
                    self.conn,
                    request["request_id"],
                    status="answered",
                    expected_revision=0,
                    answers={"reply": "stale clock"},
                )

    def test_event_failure_rolls_back_resolution_without_committing_outer_work(self) -> None:
        request = self.create()
        self.conn.commit()
        self.conn.execute(
            "CREATE TRIGGER fail_answer BEFORE INSERT ON work_item_events WHEN NEW.action='request_answered' BEGIN SELECT RAISE(ABORT,'injected event failure'); END"
        )
        self.conn.execute(
            "UPDATE work_items SET title='outer work' WHERE work_item_id=?",
            (self.item["work_item_id"],),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected event failure"):
            requests.resolve(
                self.conn,
                request["request_id"],
                status="answered",
                expected_revision=0,
                answers={"reply": "answer"},
            )
        self.conn.commit()
        self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])
        self.assertEqual(
            "outer work", service.get_work_item(self.conn, self.item["reference"])["title"]
        )

    def test_withdrawal_and_closed_item_expiry_are_retained(self) -> None:
        withdrawn = self.create()
        requests.resolve(self.conn, withdrawn["request_id"], status="expired", expected_revision=0)
        self.assertEqual(
            "withdrawn", requests.get(self.conn, withdrawn["request_id"])["expired_reason"]
        )
        pending = self.create()
        self.close()
        stored = self.conn.execute(
            "SELECT status, expired_reason FROM work_item_requests WHERE request_id=?",
            (pending["request_id"],),
        ).fetchone()
        self.assertEqual(("expired", "item_completed"), tuple(stored))
        self.assertEqual(
            "withdrawn", requests.get(self.conn, withdrawn["request_id"])["expired_reason"]
        )
        with self.assertRaisesRegex(model.PlanningError, "live work item"):
            self.create()

    def test_typed_answers_reject_coercions_and_preserve_false(self) -> None:
        descriptors = request_model.fields(
            [
                field("text"),
                field("choice", "choice"),
                field("multi", "multi_choice"),
                field("flag", "boolean"),
                field("optional", required=False),
            ]
        )
        valid = {"text": "Explain", "choice": "yes", "multi": ["no", "yes"], "flag": False}
        self.assertEqual(valid, request_model.answers(valid, descriptors))
        for replacement in (
            {"flag": 0},
            {"choice": "other"},
            {"multi": ["yes", "yes"]},
            {"text": " "},
            {"unknown": "bad"},
            {"multi": [True]},
            {"text": "x" * 8001},
        ):
            with self.subTest(replacement=replacement), self.assertRaises(model.PlanningError):
                request_model.answers({**valid, **replacement}, descriptors)
        with self.assertRaises(model.PlanningError):
            request_model.answers({}, descriptors)

    def test_pending_filter_reads_past_terminal_history(self) -> None:
        pending = self.create()
        self.conn.execute("UPDATE work_item_requests SET created_at='2000-01-01T00:00:00.000000Z'")
        for _ in range(201):
            record = self.create()
            requests.resolve(
                self.conn, record["request_id"], status="declined", expected_revision=0
            )
        before = self.conn.total_changes
        listed = requests.list_requests(self.conn, space="REQ", status="pending", limit=1)
        self.assertEqual([pending["request_id"]], [row["request_id"] for row in listed])
        self.assertEqual(before, self.conn.total_changes)

    def test_closed_item_rejects_all_resolution_commands_without_history(self) -> None:
        record = self.create()
        self.close()
        self.conn.commit()
        for status in ("answered", "declined", "expired"):
            with self.subTest(status=status), self.assertRaises(model.WorkflowGuardError):
                requests.resolve(
                    self.conn,
                    record["request_id"],
                    status=status,
                    expected_revision=1,
                    answers={"reply": "too late"},
                )
        self.assertEqual(
            ("expired", "item_completed", 1, None),
            tuple(
                self.conn.execute(
                    "SELECT status,expired_reason,revision,answers_json FROM work_item_requests"
                ).fetchone()
            ),
        )
        self.assertEqual(
            ["request_created", "request_expired"],
            [
                row[0]
                for row in self.conn.execute(
                    "SELECT action FROM work_item_events WHERE action LIKE 'request_%' ORDER BY id"
                )
            ],
        )

    def test_field_descriptors_and_unowned_creation_fields_are_rejected(self) -> None:
        for descriptors in (
            [],
            [field()] * 2,
            [{**field(), "id": "UPPER"}],
            [{**field(), "options": [{"id": "yes", "label": "Yes"}]}],
            [field()] * 13,
        ):
            with self.subTest(descriptors=descriptors), self.assertRaises(model.PlanningError):
                request_model.fields(descriptors)
        with self.assertRaises(api.PlanningHttpError):
            api.handle_post(
                self.conn,
                "/api/planning/work-item/request",
                {
                    "id": self.item["reference"],
                    "kind": "question",
                    "prompt": "Pick",
                    "fields": [field()],
                    "status": "answered",
                },
            )

    def test_optional_bindings_require_exact_association_and_closed_execution_expires(self) -> None:
        other = service.create_work_item(self.conn, space="REQ", title="Different work")
        execution_id = executions.new_execution_id()
        executions.open_execution(
            self.conn,
            execution_id=execution_id,
            work_item_id=self.item["work_item_id"],
            project_id="test",
            packet={},
        )
        foreign_id = executions.new_execution_id()
        executions.open_execution(
            self.conn,
            execution_id=foreign_id,
            work_item_id=other["work_item_id"],
            project_id="test",
            packet={},
        )
        self.conn.commit()
        sessions.op_ingest_session_event(
            self.conn,
            {
                "session_id": "exact-session",
                "client": "codex",
                "event": "session_start",
                "work_item": self.item["reference"],
            },
        )
        with self.assertRaisesRegex(model.PlanningError, "belong to the bound execution"):
            self.create(execution_id=execution_id, session_id="exact-session")
        executions.link_session(self.conn, execution_id, "exact-session", "attached")
        request = self.create(execution_id=execution_id, session_id="exact-session")
        for kwargs in (
            {"execution_id": foreign_id},
            {"session_id": "exact"},
            {"session_id": "missing"},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(model.PlanningError):
                self.create(**kwargs)
        self.conn.execute(
            "UPDATE executions SET status='complete',ended_at='2026-01-01' WHERE execution_id=?",
            (execution_id,),
        )
        self.assertEqual(
            "execution_closed", requests.get(self.conn, request["request_id"])["expired_reason"]
        )
        with self.assertRaises(model.WorkflowGuardError):
            requests.resolve(
                self.conn,
                request["request_id"],
                status="answered",
                expected_revision=0,
                answers={"reply": "late execution answer"},
            )
        self.assertEqual(
            ("pending", 0, None),
            tuple(
                self.conn.execute(
                    "SELECT status,revision,answers_json FROM work_item_requests WHERE request_id=?",
                    (request["request_id"],),
                ).fetchone()
            ),
        )
        with self.assertRaises(model.PlanningError):
            self.create(execution_id=execution_id)

    def test_checklist_quote_survives_replacement_and_plain_comments_stay_unanchored(self) -> None:
        item = service.set_checklist(self.conn, self.item["reference"], ["Original step"])
        step = item["checklist"][0]
        tools.OPS["apply_work_item_changes"](
            self.conn,
            {
                "id": self.item["reference"],
                "comment": {"body": "About this", "checklist_item_id": step["id"]},
            },
        )
        service.comment_work_item(self.conn, self.item["reference"], "General note")
        service.set_checklist(self.conn, self.item["reference"], [])
        comments = service.get_work_item(self.conn, self.item["reference"])["comments"]
        self.assertEqual(
            (step["id"], "Original step"),
            (comments[0]["checklist_item_id"], comments[0]["checklist_item_text"]),
        )
        self.assertIsNone(comments[1]["checklist_item_id"])
        self.assertIsNone(comments[1]["checklist_item_text"])
        with self.assertRaises(model.PlanningError):
            service.comment_work_item(
                self.conn, self.item["reference"], "Gone", checklist_item_id=step["id"]
            )
        replacement = service.set_checklist(self.conn, self.item["reference"], ["Original step"])
        self.assertNotEqual(step["id"], replacement["checklist"][0]["id"])
        service.report_work_item(
            self.conn, self.item["reference"], {"done": "Progress report", "next": "Continue"}
        )
        comments = service.get_work_item(self.conn, self.item["reference"])["comments"]
        self.assertEqual(step["id"], comments[0]["checklist_item_id"])
        self.assertIsNone(comments[-1]["checklist_item_id"])
        self.assertIsNone(comments[-1]["checklist_item_text"])


#: Codex proves its session in `_meta`, the shortest door in a test.
ASKER = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"


class ClosingEndsQuestionsTests(unittest.TestCase):
    """A close ends what still waits on its item, saying how the item closed.

    From the connection contract: a move into a closed state writes every request
    still pending on the item `expired`, `item_completed` or `item_cancelled` by the
    category of that state, with a `request_expired` naming the request, in the same
    write; reopening the item brings none of them back.
    """

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "store.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Closing", key="CLO")
        self.ref = str(service.create_work_item(self.conn, space="CLO", title="b")["reference"])
        self.conn.commit()

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def ask(self) -> str:
        """An agent's question to the owner on the item, asked through its proved session."""

        answer = mcp_surface.call_tool(
            self.conn,
            "create_work_item_request",
            {"id": self.ref, "kind": "question", "prompt": "Which way?", "fields": [field()]},
            meta={"sessionId": ASKER},
        )
        self.conn.commit()
        assert isinstance(answer, dict)
        return str(answer["request_id"])

    def move(self, state: str) -> None:
        self.person("/api/planning/work-item/transition", id=self.ref, state=state, force=True)

    def stored(self, request_id: str) -> tuple:
        row = self.conn.execute(
            "SELECT status, expired_reason FROM work_item_requests WHERE request_id=?",
            (request_id,),
        ).fetchone()
        return tuple(row)

    def ended_events(self, request_id: str) -> int:
        return int(
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_events"
                " WHERE action = 'request_expired' AND detail = ?",
                (request_id,),
            ).fetchone()[0]
        )

    def test_a_cancel_ends_the_question_as_cancelled_and_the_asker_hears_it(self) -> None:
        asked = self.ask()
        self.person(
            "/api/planning/work-item/summary",
            id=self.ref,
            summary={"done": "Not needed", "next": "None"},
        )
        self.move("cancelled")
        self.assertEqual(("expired", "item_cancelled"), self.stored(asked))
        self.assertEqual(1, self.ended_events(asked))
        identity = service.get_work_item(self.conn, self.ref)["work_item_id"]
        told = [
            (entry["kind"], entry.get("request_id"))
            for entry in person_events.since_last_agent_write(self.conn, identity)
        ]
        self.assertIn(("question_withdrawn", asked), told)
        read = requests.get(self.conn, asked)
        self.assertEqual(("expired", "item_cancelled"), (read["status"], read["expired_reason"]))

    def test_a_person_completing_ends_the_question_and_reopening_leaves_it_ended(self) -> None:
        asked = self.ask()
        self.person(
            "/api/planning/work-item/summary", id=self.ref, summary={"done": "Done", "next": "None"}
        )
        self.move("done")
        self.assertEqual(("expired", "item_completed"), self.stored(asked))
        self.assertEqual(1, self.ended_events(asked))
        self.move("ready")
        self.assertEqual(("expired", "item_completed"), self.stored(asked))
        read = requests.get(self.conn, asked)
        self.assertEqual(("expired", "item_completed"), (read["status"], read["expired_reason"]))
        self.assertEqual(1, self.ended_events(asked), "reopening writes nothing about it")

    def test_a_close_ends_every_request_waiting_on_the_item_and_no_other(self) -> None:
        asked = self.ask()
        other = str(service.create_work_item(self.conn, space="CLO", title="c")["reference"])
        elsewhere = requests.create(
            self.conn, other, kind="decision", prompt="Keep it?", fields=[field()]
        )["request_id"]
        decided = requests.create(
            self.conn, self.ref, kind="decision", prompt="Ship?", fields=[field()]
        )["request_id"]
        self.conn.commit()
        self.person(
            "/api/planning/work-item/summary", id=self.ref, summary={"done": "Done", "next": "None"}
        )
        self.move("done")
        self.assertEqual(("expired", "item_completed"), self.stored(asked))
        self.assertEqual(("expired", "item_completed"), self.stored(decided))
        self.assertEqual(("pending", None), self.stored(elsewhere))

    def test_a_close_keeps_the_reason_of_a_question_that_had_lapsed_and_tells_nothing_of_it(
        self,
    ) -> None:
        """A question its deadline or its execution had ended says so after the close, with
        no `request_expired`; only the one still waiting ends as the item closed."""

        waiting = self.ask()
        overdue = requests.create(
            self.conn,
            self.ref,
            kind="question",
            prompt="By noon?",
            fields=[field()],
            expires_at="2999-01-01T00:00:00Z",
        )["request_id"]
        identity = service.get_work_item(self.conn, self.ref)["work_item_id"]
        self.conn.execute(
            "INSERT INTO executions(execution_id, work_item_id, client_family, role,"
            " environment, expected_effect, status) VALUES ('run-1',?,'claude','r','e','x','running')",
            (identity,),
        )
        bound = requests.create(
            self.conn,
            self.ref,
            kind="question",
            prompt="During the run?",
            fields=[field()],
            execution_id="run-1",
        )["request_id"]
        # The deadline passes and the run ends before anybody closes the item.
        deadline = "2026-01-01T00:00:00.000000Z"
        ended_at = "2026-01-02T00:00:00.000000Z"
        self.conn.execute(
            "UPDATE work_item_requests SET expires_at=? WHERE request_id=?", (deadline, overdue)
        )
        self.conn.execute(
            "UPDATE executions SET status='complete', ended_at=? WHERE execution_id='run-1'",
            (ended_at,),
        )
        self.conn.commit()
        self.person(
            "/api/planning/work-item/summary", id=self.ref, summary={"done": "Done", "next": "None"}
        )
        self.move("done")
        self.assertEqual(("expired", "item_completed"), self.stored(waiting))
        self.assertEqual(1, self.ended_events(waiting))
        self.assertEqual(("expired", "deadline"), self.stored(overdue))
        self.assertEqual(("expired", "execution_closed"), self.stored(bound))
        self.assertEqual((0, 0), (self.ended_events(overdue), self.ended_events(bound)))
        resolved = dict(
            self.conn.execute(
                "SELECT request_id, resolved_at FROM work_item_requests WHERE request_id IN (?,?)",
                (overdue, bound),
            ).fetchall()
        )
        self.assertEqual({overdue: deadline, bound: ended_at}, resolved, "when each lapsed")
        told = [
            entry.get("request_id")
            for entry in person_events.since_last_agent_write(self.conn, identity)
            if entry["kind"] == "question_withdrawn"
        ]
        self.assertEqual([waiting], told)
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_requests WHERE work_item_id=? AND status='pending'",
                (identity,),
            ).fetchone()[0],
        )
        self.move("ready")
        self.assertEqual(
            [
                ("expired", "item_completed"),
                ("expired", "deadline"),
                ("expired", "execution_closed"),
            ],
            [self.stored(asked) for asked in (waiting, overdue, bound)],
        )
        read = requests.get(self.conn, overdue)
        self.assertEqual(("expired", "deadline"), (read["status"], read["expired_reason"]))
