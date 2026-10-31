from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from server import sessions, store
from server.executions import service as executions
from server.planning import api, model, request_model, requests, service, tools


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
        service.create_planning_space(self.conn, project_id="test", name="Requests", key="REQ")
        self.item = service.create_work_item(self.conn, space="REQ", title="Pick a direction")
        self.conn.commit()

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
        state = service.get_planning_space(self.conn, "REQ")["workflow"]["states"]
        terminal = next(entry for entry in state if entry["is_terminal"])
        self.conn.execute(
            "UPDATE work_items SET state_id=? WHERE work_item_id=?",
            (terminal["state_id"], self.item["work_item_id"]),
        )
        self.assertEqual(
            "task_closed", requests.get(self.conn, pending["request_id"])["expired_reason"]
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
        terminal = next(
            state
            for state in service.get_planning_space(self.conn, "REQ")["workflow"]["states"]
            if state["is_terminal"]
        )
        self.conn.execute(
            "UPDATE work_items SET state_id=? WHERE work_item_id=?",
            (terminal["state_id"], self.item["work_item_id"]),
        )
        self.conn.commit()
        for status in ("answered", "declined", "expired"):
            with self.subTest(status=status), self.assertRaises(model.WorkflowGuardError):
                requests.resolve(
                    self.conn,
                    record["request_id"],
                    status=status,
                    expected_revision=0,
                    answers={"reply": "too late"},
                )
        self.assertEqual(
            ("pending", 0, None),
            tuple(
                self.conn.execute(
                    "SELECT status,revision,answers_json FROM work_item_requests"
                ).fetchone()
            ),
        )
        self.assertEqual(
            ["created", "request_created"],
            [
                row[0]
                for row in self.conn.execute("SELECT action FROM work_item_events ORDER BY id")
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
        tools.OPS["comment_work_item"](
            self.conn,
            {"id": self.item["reference"], "body": "About this", "checklist_item_id": step["id"]},
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
