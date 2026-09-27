"""One attempt at a work item: what it records, and when.

Launching was a store operation before this layer — a claim, a transition and a
comment — and the attempt itself lived only in the process that spawned it. What
these tests hold is the part that is now durable: the row exists before the
process does, it carries the checkout it started from, and it is closed by
whatever ends it, including a restart that can no longer see it.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import http_surface, processes, runner, sessions, store, watchers
from server.executions import api as execution_api
from server.executions import artifacts
from server.executions import lifecycle as executions
from server.executions import results as execution_results
from server.executions import service as execution_service
from server.planning import model as planning_model
from server.planning import service as planning
from server.planning import views as planning_views
from server.platform.contracts import planning_space_entity
from server.platform.scope import read_store_metadata
from server.projects import project_registry
from tests import SUITE_STORE
from tests.registry_fixtures import project_entry, registry_bytes


class LaunchHarness(unittest.TestCase):
    """A store, a space, a repository directory, and a client that never runs.

    Shared by the two cases below rather than inherited by one from the other:
    a TestCase that subclasses another runs the parent's tests a second time,
    which is a slower suite saying the same thing twice.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        os.environ["VALKAMA_CLAUDE_BIN"] = sys.executable
        self.conn = store.connect()
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()
        self.repo = os.path.join(self._dir.name, "repo")
        os.makedirs(self.repo)
        self.spawned = []
        self.processes = []

        class Fake:
            def __init__(self) -> None:
                self.pid = 1
                self.code = None
                self.stderr = None
                self.stdout = None

            def poll(self):
                return self.code

            def terminate(self):
                self.code = -15

            def kill(self):
                self.code = -9

            def wait(self, timeout=None):  # noqa: ARG002
                return self.code or 0

        def spawn(argv, cwd, environment):
            process = Fake()
            self.spawned.append((argv, cwd, environment))
            self.processes.append(process)
            return process

        self._real_runner = runner.RUNNER
        runner.RUNNER = runner.Runner(spawn=spawn)

    def tearDown(self) -> None:
        runner.RUNNER = self._real_runner
        self.conn.close()
        os.environ["VALKAMA_DB"] = SUITE_STORE
        os.environ.pop("VALKAMA_CLAUDE_BIN", None)
        self._dir.cleanup()

    def item(self, title: str, state: str = "todo") -> str:
        record = planning.create_work_item(self.conn, space="TST", title=title, state=state)
        self.conn.commit()
        return str(record["reference"])

    def packet(self, reference: str, **overrides) -> dict:
        return {"work_item": reference, "client": "claude", "repo": self.repo, **overrides}


class LaunchLifecycleTests(LaunchHarness):
    """Launching is a store operation first: nothing may be handed out twice."""

    def test_a_launch_claims_the_item_and_records_everything_it_needs(self) -> None:
        reference = self.item("launch me")
        started = executions.launch_work_item(self.conn, self.packet(reference))

        detail = planning.get_work_item(self.conn, reference)
        self.assertEqual("dev", detail["state"]["key"], "launching a queued item starts it")
        self.assertEqual("claude:executor", detail["claim_ref"])
        self.assertIn(
            started["client_session_id"],
            [ref["value"] for ref in detail["refs"] if ref["kind"] == "session"],
        )
        self.assertIn("launched on claude", detail["comments"][-1]["body"])

        monitor = sessions.sessions_payload(self.conn)["sessions"]
        row = next(item for item in monitor if item["id"] == started["client_session_id"])
        self.assertEqual(reference, row["work_item"], "the monitor row knows its work item")
        self.assertTrue(row["label"].startswith(reference))

    def test_a_launch_cannot_take_an_item_another_agent_holds(self) -> None:
        reference = self.item("taken")
        planning.claim_work_item(self.conn, reference, author="codex-one")
        self.conn.commit()
        with self.assertRaisesRegex(planning_model.PlanningError, "already held by codex-one"):
            executions.launch_work_item(self.conn, self.packet(reference))
        self.assertEqual([], runner.RUNNER.running())

    def test_a_refused_packet_never_claims_the_item(self) -> None:
        reference = self.item("bad packet")
        with self.assertRaises(runner.LaunchError):
            executions.launch_work_item(self.conn, self.packet(reference, client="gemini"))
        self.assertEqual("", planning.get_work_item(self.conn, reference)["claim_ref"])

    def test_a_process_launch_failure_restores_the_prior_state_and_claim(self) -> None:
        reference = self.item("cannot spawn")
        runner.RUNNER = runner.Runner(
            spawn=lambda _argv, _cwd, _environment: (_ for _ in ()).throw(OSError("boom"))
        )
        with self.assertRaisesRegex(runner.LaunchError, "cannot start claude"):
            executions.launch_work_item(self.conn, self.packet(reference))
        detail = planning.get_work_item(self.conn, reference)
        self.assertEqual("todo", detail["state"]["key"])
        self.assertEqual("", detail["claim_ref"])
        self.assertIn("launch_failed", detail["comments"][-1]["body"])

    def test_stopping_records_the_stop_on_the_item_and_the_session(self) -> None:
        reference = self.item("stop me")
        started = executions.launch_work_item(self.conn, self.packet(reference))
        stopped = executions.stop_work_item(self.conn, reference)
        self.assertTrue(stopped["stopped"])
        detail = planning.get_work_item(self.conn, reference)
        self.assertIn("launch stopped from the platform", detail["comments"][-1]["body"])
        row = next(
            item
            for item in sessions.sessions_payload(self.conn)["sessions"]
            if item["id"] == started["client_session_id"]
        )
        self.assertEqual("ended", row["status"])

    def test_a_finished_launch_moves_its_item_to_review(self) -> None:
        reference = self.item("finish me")
        executions.launch_work_item(self.conn, self.packet(reference))
        runner.RUNNER._running[reference].capture.append(
            json.dumps(
                {
                    "structured_output": {
                        "outcome": "complete",
                        "expected_effect": "change_required",
                        "delivery": "owned change",
                        "oracle": "focused tests passed",
                        "unresolved": "none",
                    }
                }
            )
        )
        self.processes[0].code = 0
        ended = executions.reap_launches(self.conn)
        self.assertEqual([reference], [item["reference"] for item in ended])
        detail = planning.get_work_item(self.conn, reference)
        self.assertEqual("review", detail["state"]["key"])
        self.assertIn("outcome=complete", detail["comments"][-1]["body"])

    def test_zero_exit_without_structured_delivery_does_not_advance(self) -> None:
        reference = self.item("empty success")
        executions.launch_work_item(self.conn, self.packet(reference))
        self.processes[0].code = 0
        executions.reap_launches(self.conn)
        detail = planning.get_work_item(self.conn, reference)
        self.assertEqual("dev", detail["state"]["key"])
        self.assertIn("outcome=unexpected_no_change", detail["comments"][-1]["body"])

    def test_resume_requires_and_reuses_the_exact_client_session(self) -> None:
        reference = self.item("resume me")
        first = executions.launch_work_item(self.conn, self.packet(reference))
        self.processes[0].code = 0
        executions.reap_launches(self.conn)
        resumed = executions.launch_work_item(
            self.conn, self.packet(reference, resume=True, prompt="repair delta")
        )
        self.assertEqual(first["client_session_id"], resumed["client_session_id"])
        self.assertEqual(first["client_session_id"], resumed["resumed_from"])
        self.assertIn("--resume", self.spawned[-1][0])

    def test_resume_without_an_exact_client_identity_is_refused_before_claim(self) -> None:
        # No launch has ever run on this item, so no session row carries its
        # attempt. Guessing which session was probably meant stays forbidden.
        reference = self.item("never launched")
        with self.assertRaisesRegex(runner.LaunchError, "no exact resumable"):
            executions.launch_work_item(self.conn, self.packet(reference, resume=True))
        detail = planning.get_work_item(self.conn, reference)
        self.assertEqual("todo", detail["state"]["key"])
        self.assertEqual("", detail["claim_ref"])

    def test_stale_claims_surface_only_when_nothing_has_happened(self) -> None:
        fresh = self.item("busy")
        planning.claim_work_item(self.conn, fresh, author="codex")
        planning.transition_work_item(self.conn, fresh, "dev", author="codex")
        self.conn.commit()
        self.assertEqual([], planning_views.stale_claims(self.conn))

        old = self.item("abandoned")
        planning.claim_work_item(self.conn, old, author="ghost")
        planning.transition_work_item(self.conn, old, "dev", author="ghost")
        self.conn.commit()
        identity = self.conn.execute(
            "SELECT w.work_item_id FROM work_items w"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " WHERE p.key || '-' || w.number = ?",
            (old,),
        ).fetchone()[0]
        self.conn.execute(
            "UPDATE work_item_events SET created_at = '2026-07-01T00:00:00Z'"
            " WHERE work_item_id = ?",
            (identity,),
        )
        self.conn.execute(
            "UPDATE work_items SET updated_at = '2026-07-01T00:00:00Z' WHERE work_item_id = ?",
            (identity,),
        )
        self.conn.commit()
        stale = planning_views.stale_claims(self.conn)
        self.assertEqual([old], [item["reference"] for item in stale])
        self.assertEqual("ghost", stale[0]["claim_ref"])
        self.assertGreaterEqual(stale[0]["quiet_days"], 3)
        self.assertEqual(
            [old],
            [
                item["reference"]
                for item in planning_views.planning_payload(self.conn)["stale_claims"]
            ],
        )

    def test_a_failed_launch_stays_put_and_rings_the_inbox(self) -> None:
        reference = self.item("fail me")
        started = executions.launch_work_item(self.conn, self.packet(reference))
        self.processes[0].code = 2
        executions.reap_launches(self.conn)
        detail = planning.get_work_item(self.conn, reference)
        self.assertEqual("dev", detail["state"]["key"], "a failure is not progress")
        inbox = sessions.sessions_payload(self.conn)["inbox"]
        self.assertEqual(
            [("failed", started["client_session_id"])],
            [(item["attention"], item["id"]) for item in inbox],
        )


class ExecutionRecordTests(LaunchHarness):
    """The row, its lifetime, and the evidence it carries."""

    def attempts(self, reference: str) -> list[dict]:
        item = planning.get_work_item(self.conn, reference)
        return execution_service.executions_for_work_item(self.conn, str(item["work_item_id"]))

    def test_the_attempt_exists_before_the_process_and_carries_its_identity(self) -> None:
        reference = self.item("record me")
        started = executions.launch_work_item(self.conn, self.packet(reference))

        attempt = self.attempts(reference)[0]
        self.assertEqual(started["execution_id"], attempt["execution_id"])
        self.assertEqual("running", attempt["status"])
        self.assertEqual("claude", attempt["client_family"])
        self.assertEqual("claude-code-execution", attempt["adapter_lineage_id"])
        self.assertEqual(started["launch_id"], attempt["launch_id"])
        self.assertEqual(
            [(started["client_session_id"], "launched")],
            [(entry["session_id"], entry["relation"]) for entry in attempt["sessions"]],
        )
        # The child was told which attempt it is, so whatever it exports can
        # name the row rather than be matched to it by time.
        _, _, environment = self.spawned[0]
        self.assertEqual(started["execution_id"], environment["VALKAMA_EXECUTION_ID"])

    def test_a_packet_refused_before_the_row_exists_leaves_no_attempt(self) -> None:
        reference = self.item("cannot start")
        with self.assertRaises(runner.LaunchError):
            executions.launch_work_item(self.conn, self.packet(reference, effort="minimal"))
        self.assertEqual([], self.attempts(reference))

    def test_a_launch_that_never_started_closes_its_attempt_as_failed(self) -> None:
        reference = self.item("cannot spawn")

        def refuse(argv, cwd, environment):  # noqa: ARG001
            raise OSError("no such client")

        runner.RUNNER = runner.Runner(spawn=refuse)
        with self.assertRaises(runner.LaunchError):
            executions.launch_work_item(self.conn, self.packet(reference))
        attempt = self.attempts(reference)[0]
        self.assertEqual("failed", attempt["status"])
        self.assertEqual("launch_failed", attempt["outcome"])
        self.assertEqual("terminal", attempt["presence"])
        self.assertEqual(
            "todo",
            planning.get_work_item(self.conn, reference)["state"]["key"],
            "the item is exactly where it was",
        )

    def test_reaping_closes_the_attempt_with_the_runners_verdict(self) -> None:
        reference = self.item("finish me")
        executions.launch_work_item(self.conn, self.packet(reference))
        self.processes[0].code = 0
        executions.reap_launches(self.conn)

        attempt = self.attempts(reference)[0]
        self.assertEqual(0, attempt["exit_code"])
        self.assertIsNotNone(attempt["ended_at"])
        # A zero exit with no structured delivery is not a delivery, and the
        # attempt records the same verdict the item's history does.
        self.assertEqual("unexpected_no_change", attempt["outcome"])
        self.assertEqual("partial", attempt["status"])

    def test_stopping_cancels_the_attempt_rather_than_leaving_it_running(self) -> None:
        reference = self.item("stop me")
        executions.launch_work_item(self.conn, self.packet(reference))
        executions.stop_work_item(self.conn, reference)
        attempt = self.attempts(reference)[0]
        self.assertEqual("cancelled", attempt["status"])
        self.assertIsNotNone(attempt["ended_at"])

    def test_a_restart_closes_attempts_it_can_no_longer_see(self) -> None:
        reference = self.item("orphan me")
        executions.launch_work_item(self.conn, self.packet(reference))
        # A new process has a new runner and knows nothing of the old one.
        closed = execution_service.close_open_executions(self.conn, "the platform restarted")
        self.conn.commit()
        self.assertEqual(1, closed)
        attempt = self.attempts(reference)[0]
        self.assertEqual("cancelled", attempt["status"])
        self.assertIn("restarted", str(attempt["result"]["oracle"]))
        self.assertEqual(
            0,
            execution_service.close_open_executions(self.conn),
            "a second sweep has nothing left to close",
        )

    def test_waiting_is_derived_from_the_session_rather_than_stored(self) -> None:
        reference = self.item("wait for me")
        started = executions.launch_work_item(self.conn, self.packet(reference))
        self.assertEqual("live", self.attempts(reference)[0]["presence"])

        sessions.op_ingest_session_event(
            self.conn,
            {"session_id": started["client_session_id"], "client": "claude", "event": "turn_end"},
        )
        self.assertEqual("waiting", self.attempts(reference)[0]["presence"])
        # And it stops being true when work resumes, with nothing written to
        # the execution row in either direction.
        sessions.op_ingest_session_event(
            self.conn,
            {"session_id": started["client_session_id"], "client": "claude", "event": "step"},
        )
        self.assertEqual("live", self.attempts(reference)[0]["presence"])

    def test_a_session_can_name_the_attempt_it_belongs_to(self) -> None:
        reference = self.item("look me up")
        started = executions.launch_work_item(self.conn, self.packet(reference))
        found = execution_service.execution_for_session(self.conn, started["client_session_id"])
        self.assertIsNotNone(found)
        assert found is not None
        self.assertEqual(started["execution_id"], found["execution_id"])
        self.assertEqual(reference, found["work_item"])
        self.assertIsNone(execution_service.execution_for_session(self.conn, "not-a-session"))


class ResultClassificationTests(unittest.TestCase):
    """What a finished attempt meant, asked of the module that owns the answer.

    These were runner tests while the runner held the vocabularies and the
    classifier. Nothing about them is process shape: they are about which
    outcome a claim earns, which is why they moved with the code.
    """

    def classify(
        self,
        *,
        delivery: dict | None = None,
        exit_code: int = 0,
        expected_effect: str = "change_required",
        review_mode: str = "",
    ) -> dict:
        lines = [json.dumps({"structured_output": delivery})] if delivery is not None else []
        return execution_results.classify(
            client="claude",
            expected_effect=expected_effect,
            review_mode=review_mode,
            exit_code=exit_code,
            lines=lines,
        )

    def test_zero_exit_without_delivery_is_not_complete(self) -> None:
        result = self.classify()
        self.assertEqual("unexpected_no_change", result["outcome"])
        self.assertFalse(result["structured"])

    def test_nonzero_exit_without_delivery_is_refused(self) -> None:
        result = self.classify(exit_code=2)
        self.assertEqual("refused", result["outcome"])
        self.assertFalse(result["structured"])

    def test_verified_no_change_is_accepted_only_when_the_packet_allows_it(self) -> None:
        delivery = {
            "outcome": "expected_no_change",
            "expected_effect": "no_change_acceptable",
            "delivery": "no owned artifact needed a change",
            "oracle": "the named comparison matched",
            "unresolved": "none",
        }
        self.assertEqual(
            "expected_no_change",
            self.classify(delivery=delivery, expected_effect="no_change_acceptable")["outcome"],
        )

    def test_no_change_claim_is_unexpected_when_a_change_was_required(self) -> None:
        delivery = {
            "outcome": "expected_no_change",
            "expected_effect": "change_required",
            "delivery": "nothing changed",
            "oracle": "no diff",
            "unresolved": "required change is absent",
        }
        self.assertEqual("unexpected_no_change", self.classify(delivery=delivery)["outcome"])

    def test_invalid_or_contradictory_structured_results_are_partial(self) -> None:
        cases = (
            ("unknown outcome", {"outcome": "success", "expected_effect": "change_required"}, 0),
            (
                "wrong expected effect",
                {"outcome": "complete", "expected_effect": "read_only_finding"},
                0,
            ),
            ("nonzero complete", {"outcome": "complete", "expected_effect": "change_required"}, 7),
        )
        for label, fields, exit_code in cases:
            with self.subTest(label=label):
                delivery = {
                    **fields,
                    "delivery": "claimed delivery",
                    "oracle": "claimed oracle",
                    "unresolved": "none",
                }
                self.assertEqual(
                    "partial", self.classify(delivery=delivery, exit_code=exit_code)["outcome"]
                )

    def test_review_delivery_without_typed_verdict_is_partial(self) -> None:
        delivery = {
            "outcome": "complete",
            "expected_effect": "read_only_finding",
            "delivery": "reviewed snapshot",
            "oracle": "diff inspected",
            "unresolved": "none",
        }
        self.assertEqual(
            "partial",
            self.classify(
                delivery=delivery,
                expected_effect="read_only_finding",
                review_mode="acceptance_review",
            )["outcome"],
        )

    def test_review_delivery_keeps_verdict_and_finding_dispositions(self) -> None:
        dispositions = [
            {
                "finding": "F-1",
                "status": "rejected-with-evidence",
                "rationale": "the focused test disproves it",
            }
        ]
        delivery = {
            "outcome": "complete",
            "expected_effect": "read_only_finding",
            "delivery": "reviewed snapshot",
            "oracle": "diff inspected",
            "unresolved": "none",
            "review_verdict": "ship",
            "dispositions": dispositions,
        }
        result = self.classify(
            delivery=delivery,
            expected_effect="read_only_finding",
            review_mode="acceptance_review",
        )
        self.assertEqual("complete", result["outcome"])
        self.assertEqual("ship", result["review_verdict"])
        self.assertEqual(dispositions, result["dispositions"])

    def test_invalid_review_disposition_prevents_acceptance(self) -> None:
        delivery = {
            "outcome": "complete",
            "expected_effect": "read_only_finding",
            "delivery": "reviewed snapshot",
            "oracle": "diff inspected",
            "unresolved": "none",
            "review_verdict": "ship",
            "dispositions": [{"finding": "F-1", "status": "ignored", "rationale": "not allowed"}],
        }
        self.assertEqual(
            "partial",
            self.classify(
                delivery=delivery,
                expected_effect="read_only_finding",
                review_mode="acceptance_review",
            )["outcome"],
        )


class ReapLoopTests(unittest.TestCase):
    """The loop that owes every later cycle must survive one that failed.

    It runs as a bare daemon thread with no supervisor, and it owns three
    things: reaping, the move to review a finished launch earns, and every
    change notification an open stream is waiting on. One uncaught exception
    used to end all three for the life of the process.
    """

    def test_a_raising_reap_is_reported_and_the_loop_keeps_publishing(self) -> None:
        registry = watchers.Watchers()
        stream = registry.subscribe()
        calls: list[int] = []

        def reap(conn: sqlite3.Connection) -> bool:  # noqa: ARG001
            calls.append(1)
            if len(calls) == 1:
                raise sqlite3.OperationalError("database is locked")
            return True

        with (
            mock.patch.object(watchers, "reap_sessions_if_enabled", side_effect=reap),
            contextlib.redirect_stderr(io.StringIO()) as reported,
        ):
            registry.run(interval=0, cycles=10)

        self.assertEqual(2, len(calls), "the second cycle ran, so the loop outlived the first")
        self.assertIn("reaping finished launches failed", reported.getvalue())
        self.assertIn("database is locked", reported.getvalue(), "and it is not swallowed")
        self.assertEqual("changed", stream.get_nowait(), "the cycle after the failure published")


class ReapBatchTests(LaunchHarness):
    """A batch of endings is recorded one attempt at a time, and closed once."""

    def attempts(self, reference: str) -> list[dict]:
        item = planning.get_work_item(self.conn, reference)
        return execution_service.executions_for_work_item(self.conn, str(item["work_item_id"]))

    def test_one_unrecordable_ending_does_not_lose_the_rest_of_the_batch(self) -> None:
        first = self.item("breaks while recording")
        second = self.item("must still be recorded")
        executions.launch_work_item(self.conn, self.packet(first))
        executions.launch_work_item(self.conn, self.packet(second))
        self.processes[0].code = 0
        self.processes[1].code = 0
        ingest = executions.op_ingest_session_event

        def refuse_the_first(conn: sqlite3.Connection, event: dict) -> object:
            if event.get("work_item") == first:
                raise sqlite3.OperationalError("disk I/O error")
            return ingest(conn, event)

        with (
            mock.patch.object(executions, "op_ingest_session_event", side_effect=refuse_the_first),
            contextlib.redirect_stderr(io.StringIO()) as reported,
        ):
            ended = executions.reap_launches(self.conn)

        self.assertEqual([first, second], [item["reference"] for item in ended])
        self.assertIn("could not record the ending", reported.getvalue())
        # The sibling is recorded in full: its verdict, its exit code and the
        # note on its item. Before the isolation it was simply gone.
        sibling = self.attempts(second)[0]
        self.assertEqual("partial", sibling["status"])
        self.assertEqual(0, sibling["exit_code"])
        self.assertIsNotNone(sibling["ended_at"])
        self.assertIn(
            "outcome=unexpected_no_change",
            planning.get_work_item(self.conn, second)["comments"][-1]["body"],
        )
        # And the one that failed is still closed with the verdict the runner
        # reached, because nothing will ever offer that ending again.
        lost = self.attempts(first)[0]
        self.assertEqual("partial", lost["status"])
        self.assertIsNotNone(lost["ended_at"])

    def test_a_recorded_ending_is_never_rewritten_by_a_later_close(self) -> None:
        reference = self.item("closed once")
        started = executions.launch_work_item(self.conn, self.packet(reference))
        self.processes[0].code = 0
        executions.reap_launches(self.conn)
        recorded = self.attempts(reference)[0]

        # Exactly what a stop arriving after the reap would write. The attempt
        # already has the verdict of whoever observed the end, so the guarded
        # close refuses and says so rather than replacing it.
        wrote = execution_service.close_execution(
            self.conn,
            started["execution_id"],
            status="cancelled",
            outcome="cancelled",
            result={"outcome": "cancelled", "structured": False},
        )
        self.conn.commit()
        self.assertFalse(wrote)
        after = self.attempts(reference)[0]
        self.assertEqual(recorded["status"], after["status"])
        self.assertEqual(recorded["outcome"], after["outcome"])
        self.assertEqual(recorded["ended_at"], after["ended_at"])
        self.assertEqual(recorded["revision"], after["revision"])


class WorktreeEvidenceTests(LaunchHarness):
    """A worktree launch is measured from the worktree it actually runs in.

    On a worktree's first launch the two answers agree, which is why this could
    not be seen: a fresh checkout shares the HEAD it was created from. On a
    reused or diverged one they do not, and a baseline taken from the repository
    the packet named reports that other checkout's history as this attempt's
    work.
    """

    def setUp(self) -> None:
        super().setUp()
        self.git(self.repo, "init", "-b", "main")
        self.commit(self.repo, "a.txt", "one\n")
        self.addCleanup(self.prune)

    def prune(self) -> None:
        processes.run_text(["git", "-C", self.repo, "worktree", "prune"])

    def git(self, cwd: str, *args: str) -> None:
        completed = processes.run_text(["git", "-C", cwd, *args])
        if completed.returncode != 0:
            raise unittest.SkipTest(f"git is unavailable here: {completed.stderr.strip()}")

    def write(self, cwd: str, name: str, body: str, mode: str = "w") -> None:
        with open(os.path.join(cwd, name), mode, encoding="utf-8", newline="\n") as handle:
            handle.write(body)

    def commit(self, cwd: str, name: str, body: str) -> None:
        self.write(cwd, name, body)
        self.git(cwd, "add", name)
        self.git(
            cwd,
            "-c",
            "user.email=t@example.invalid",
            "-c",
            "user.name=Test",
            "commit",
            "-m",
            f"add {name}",
        )

    def head(self, cwd: str) -> str:
        completed = processes.run_text(["git", "-C", cwd, "rev-parse", "HEAD"])
        return completed.stdout.strip()

    def attempts(self, reference: str) -> list[dict]:
        item = planning.get_work_item(self.conn, reference)
        return execution_service.executions_for_work_item(self.conn, str(item["work_item_id"]))

    def test_a_diverged_worktree_is_the_baseline_and_bounds_the_outcome(self) -> None:
        reference = self.item("worktree work")
        target, _ = runner.prepare_worktree(self.repo, reference)
        # The worktree moves on before this attempt starts, which is what a
        # reused one does: an earlier launch on the same card committed there.
        self.commit(target, "b.txt", "diverged\n")
        self.assertNotEqual(self.head(self.repo), self.head(target))

        started = executions.launch_work_item(
            self.conn, self.packet(reference, environment="worktree")
        )
        self.assertEqual(target, started["cwd"])
        base = self.attempts(reference)[0]["base_artifact"]
        assert base is not None
        self.assertEqual(self.head(target), base["head"], "the checkout the client edits")

        # This attempt edits one tracked file. Measured from the worktree that
        # is one changed file and no commits; measured from the repository it
        # would also count the commit above and list it as this attempt's.
        self.write(target, "a.txt", "two\n", mode="a")
        self.processes[0].code = 0
        executions.reap_launches(self.conn)
        final = self.attempts(reference)[0]["final_artifact"]
        assert final is not None
        self.assertEqual(1, final["changed_files"])
        self.assertEqual([], final["commits"])


class GitEvidenceTests(unittest.TestCase):
    """A delivery claim is checkable only against the checkout it was made in."""

    def setUp(self) -> None:
        scratch = os.path.join(ROOT, "tmp")
        os.makedirs(scratch, exist_ok=True)
        self._dir = tempfile.TemporaryDirectory(dir=scratch)
        self.repo = os.path.join(self._dir.name, "repo")
        os.makedirs(self.repo)
        self.addCleanup(self._dir.cleanup)

    def git(self, *args: str) -> None:
        completed = processes.run_text(["git", "-C", self.repo, *args])
        if completed.returncode != 0:
            raise unittest.SkipTest(f"git is unavailable here: {completed.stderr.strip()}")

    def commit(self, name: str, body: str) -> None:
        with open(os.path.join(self.repo, name), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(body)
        self.git("add", name)
        self.git(
            "-c",
            "user.email=t@example.invalid",
            "-c",
            "user.name=Test",
            "commit",
            "-m",
            f"add {name}",
        )

    def test_a_directory_that_is_not_a_repository_says_unknown_rather_than_zero(self) -> None:
        with mock.patch.dict(os.environ, {"GIT_CEILING_DIRECTORIES": os.path.join(ROOT, "tmp")}):
            base = artifacts.baseline(self.repo)
            self.assertEqual("unknown", base["quality"])
            self.assertIsNone(base["dirty"])
            after = artifacts.outcome(self.repo, base)
            self.assertEqual("unknown", after["quality"])
            self.assertIsNone(after["changed_files"], "nobody looked, so it is not zero")

    def test_an_uncommitted_edit_still_counts_as_a_change(self) -> None:
        self.git("init", "-b", "main")
        self.commit("a.txt", "one\n")
        base = artifacts.baseline(self.repo)
        self.assertEqual("observed", base["quality"])
        self.assertEqual("main", base["branch"])
        self.assertFalse(base["dirty"])

        with open(os.path.join(self.repo, "a.txt"), "a", encoding="utf-8", newline="\n") as handle:
            handle.write("two\n")
        after = artifacts.outcome(self.repo, base)
        self.assertEqual(1, after["changed_files"])
        self.assertEqual(1, after["insertions"])
        self.assertTrue(after["dirty"])
        self.assertEqual([], after["commits"], "nothing was committed")

    def test_a_commit_is_listed_and_measured_from_the_recorded_base(self) -> None:
        self.git("init", "-b", "main")
        self.commit("a.txt", "one\n")
        base = artifacts.baseline(self.repo)
        self.commit("b.txt", "two\n")
        after = artifacts.outcome(self.repo, base)
        self.assertEqual(1, len(after["commits"]))
        self.assertNotEqual(base["head"], after["head"])
        self.assertEqual(1, after["changed_files"])


class ExecutionApiTests(LaunchHarness):
    """The boundary an interface reads: what can be chosen, what has run, attaching."""

    def test_capabilities_come_from_the_drivers_and_carry_their_health(self) -> None:
        status, payload = execution_api.handle_get(self.conn, "/api/execution/capabilities", {})
        self.assertEqual(200, status)
        by_client = {driver["client"]: driver for driver in payload["drivers"]}
        self.assertEqual({"claude", "codex"}, set(by_client))
        # The harness points VALKAMA_CLAUDE_BIN at a real executable, so this
        # one is installed as far as the launcher is concerned.
        self.assertEqual("ready", by_client["claude"]["health"])
        self.assertEqual("", by_client["claude"]["unavailable_reason"])
        self.assertNotEqual(
            by_client["claude"]["efforts"],
            by_client["codex"]["efforts"],
            "a chooser that offered one list would offer each client the other's values",
        )
        # And Valkama's own vocabulary, so an interface does not restate the
        # validator that would refuse it. The launch half is the runner's and the
        # result half is `results`', each read from the module that owns it.
        self.assertEqual(list(runner.ROLES), payload["roles"])
        self.assertEqual(list(runner.ENVIRONMENTS), payload["environments"])
        self.assertEqual(list(execution_results.EXPECTED_EFFECTS), payload["expected_effects"])
        self.assertEqual(list(execution_results.REVIEW_MODES), payload["review_modes"])

    def test_an_uninstalled_client_says_why_rather_than_disappearing(self) -> None:
        os.environ.pop("VALKAMA_CLAUDE_BIN", None)
        os.environ["VALKAMA_CODEX_BIN"] = ""
        with mock.patch("shutil.which", return_value=None):
            _, payload = execution_api.handle_get(self.conn, "/api/execution/capabilities", {})
        for driver in payload["drivers"]:
            self.assertEqual("unavailable", driver["health"])
            self.assertIn("PATH", driver["unavailable_reason"])

    def test_repository_suggestion_uses_the_exact_space_resource_binding(self) -> None:
        reference = self.item("suggest repository")
        resource_ref = planning_space_entity(
            {
                "data_scope_id": read_store_metadata(self.conn)["data_scope_id"],
                "space_key": "TST",
            }
        )
        source_hash = "a" * 64
        binding = {
            "project_id": "test",
            "resource_ref": resource_ref,
            "registry_revision": 1,
            "source_owner": "test",
            "source_hash": source_hash,
        }
        bound = registry_bytes(
            [
                project_entry(
                    "test",
                    self.repo,
                    board="Unrelated presentation title",
                    bindings=[binding],
                    source_hash=source_hash,
                )
            ]
        )
        with mock.patch.object(project_registry, "_read_registry_bytes", return_value=bound):
            _, payload = execution_api.handle_get(
                self.conn,
                "/api/execution/capabilities",
                {"work_item": [reference]},
            )
        self.assertEqual(self.repo, payload["repository"])
        self.assertEqual("mapped", payload["repository_status"])

        title_only = registry_bytes(
            [project_entry("test", self.repo, board="Test", source_hash=source_hash)]
        )
        with mock.patch.object(project_registry, "_read_registry_bytes", return_value=title_only):
            _, refused = execution_api.handle_get(
                self.conn,
                "/api/execution/capabilities",
                {"work_item": [reference]},
            )
        self.assertEqual("", refused["repository"])
        self.assertEqual("missing", refused["repository_status"])

    def test_history_answers_with_the_attempts_of_one_item(self) -> None:
        reference = self.item("history")
        started = executions.launch_work_item(self.conn, self.packet(reference))
        _, payload = execution_api.handle_get(
            self.conn, "/api/execution/history", {"work_item": [reference]}
        )
        self.assertEqual(reference, payload["work_item"])
        self.assertEqual(
            [started["execution_id"]],
            [attempt["execution_id"] for attempt in payload["executions"]],
        )

    def test_history_refuses_a_request_that_names_no_item(self) -> None:
        with self.assertRaises(execution_api.ExecutionHttpError) as raised:
            execution_api.handle_get(self.conn, "/api/execution/history", {})
        self.assertEqual(400, raised.exception.status)
        status, body = execution_api.error_response(raised.exception)
        self.assertEqual(400, status)
        self.assertEqual("invalid_request", body["error"]["code"])

    def test_attaching_a_session_is_a_person_saying_so(self) -> None:
        reference = self.item("attach to me")
        sessions.op_ingest_session_event(
            self.conn,
            {"session_id": "outside-1", "client": "codex", "event": "session_start", "cwd": "/x"},
        )
        _, payload = execution_api.handle_post(
            self.conn,
            "/api/execution/attach",
            {"work_item": reference, "session_id": "outside-1", "author": "owner"},
        )
        attempts = execution_service.executions_for_work_item(
            self.conn, str(planning.get_work_item(self.conn, reference)["work_item_id"])
        )
        self.assertEqual([payload["execution_id"]], [a["execution_id"] for a in attempts])
        attempt = attempts[0]
        # Its own status, because every other one is a verdict on a delivery and
        # this platform did not run the process to have grounds for one.
        self.assertEqual("attached", attempt["status"])
        self.assertEqual("codex", attempt["client_family"])
        self.assertEqual(
            [("outside-1", "attached")],
            [(entry["session_id"], entry["relation"]) for entry in attempt["sessions"]],
        )
        detail = planning.get_work_item(self.conn, reference)
        self.assertIn("outside-1", [ref["value"] for ref in detail["refs"]])
        # And the monitor row can now name the attempt it belongs to.
        monitor = sessions.sessions_payload(self.conn)["sessions"]
        row = next(item for item in monitor if item["id"] == "outside-1")
        self.assertEqual(payload["execution_id"], row["execution_id"])

    def test_attaching_refuses_a_session_nobody_observed(self) -> None:
        reference = self.item("no such session")
        with self.assertRaises(execution_api.ExecutionHttpError) as raised:
            execution_api.handle_post(
                self.conn,
                "/api/execution/attach",
                {"work_item": reference, "session_id": "never-seen"},
            )
        self.assertEqual(404, raised.exception.status)

    def test_every_execution_path_is_owned_by_the_sessions_module(self) -> None:
        # A module gate that does not know a path refuses it silently, so the
        # declaration and the dispatch have to be checked against each other.
        for path in execution_api.READ_PATHS:
            self.assertEqual("sessions", http_surface._HTTP_ROUTE_MODULES[("GET", path)], path)
        for path in execution_api.WRITE_PATHS:
            self.assertEqual("sessions", http_surface._HTTP_ROUTE_MODULES[("POST", path)], path)


class EndToEndLaunchTests(LaunchHarness):
    """One attempt, start to finish, with a real process on the other end.

    Everything above this fakes the client object. This one spawns Python with
    the exact command line `client_argv` built, reads what it writes back
    through the same pipe a client would use, and lets the reaper classify it —
    so the parts that only exist between processes are actually exercised: the
    argv the driver produced, the correlation the environment carried, the
    structured result on stdout, and the transition the workflow allowed.

    No model is called and no repository is touched. `VALKAMA_CLAUDE_BIN` exists
    for exactly this, and the stub is what stands where the client would.
    """

    STUB = """
import json, os, sys

# What the client saw, written where the test can read it whole. The runner's
# own capture is a bounded tail by design, so asserting against it would be
# asserting against the truncation.
with open(os.path.join(os.getcwd(), "observed.json"), "w", encoding="utf-8") as handle:
    json.dump(
        {
            "argv": sys.argv[1:],
            "execution_id": os.environ.get("VALKAMA_EXECUTION_ID", ""),
            "work_item": os.environ.get("VALKAMA_LAUNCH_WORK_ITEM", ""),
            "otel": os.environ.get("OTEL_RESOURCE_ATTRIBUTES", ""),
        },
        handle,
    )

# And what a client answers with: its own envelope, on stdout.
print(
    json.dumps(
        {
            "session_id": os.environ.get("VALKAMA_LAUNCH_ID", ""),
            "structured_output": {
                "outcome": "complete",
                "expected_effect": "change_required",
                "delivery": "wrote the file the packet asked for",
                "oracle": "the file exists",
                "unresolved": "",
            },
        }
    )
)
with open(os.path.join(os.getcwd(), "delivered.txt"), "w", encoding="utf-8") as handle:
    handle.write("delivered")
"""

    def setUp(self) -> None:
        super().setUp()
        self.stub = os.path.join(self._dir.name, "stub_client.py")
        with open(self.stub, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(self.STUB)

        def spawn(argv, cwd, environment):
            # The real argv, minus the binary the driver resolved: this stub is
            # what that binary would have been.
            self.spawned.append((argv, cwd, environment))
            return subprocess.Popen(
                [sys.executable, "-B", self.stub, *argv[1:]],
                cwd=cwd,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )

        runner.RUNNER = runner.Runner(spawn=spawn)

    def test_a_delivered_attempt_moves_the_item_to_review_with_its_evidence(self) -> None:
        completed = processes.run_text(["git", "-C", self.repo, "init", "-b", "main"])
        if completed.returncode != 0:
            raise unittest.SkipTest("git is unavailable here")
        with open(
            os.path.join(self.repo, "seed.txt"), "w", encoding="utf-8", newline="\n"
        ) as handle:
            handle.write("initial\n")
        added = processes.run_text(["git", "-C", self.repo, "add", "seed.txt"])
        self.assertEqual(0, added.returncode, added.stderr)
        committed = processes.run_text(
            [
                "git",
                "-C",
                self.repo,
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "initial",
            ]
        )
        self.assertEqual(0, committed.returncode, committed.stderr)
        reference = self.item("end to end")
        started = executions.launch_work_item(
            self.conn, self.packet(reference, prompt="write the file", model="opus", effort="high")
        )

        deadline = time.monotonic() + 30
        ended: list[dict] = []
        while not ended and time.monotonic() < deadline:
            ended = executions.reap_launches(self.conn)
        self.assertTrue(ended, "the stub client never ended")

        with open(os.path.join(self.repo, "observed.json"), encoding="utf-8") as handle:
            answer = json.load(handle)
        # The correlation reached the child, which is what makes an attempt
        # attributable to a row that existed before it did.
        self.assertEqual(started["execution_id"], answer["execution_id"])
        self.assertEqual(reference, answer["work_item"])
        self.assertIn(f"valkama.execution.id={started['execution_id']}", answer["otel"])
        # And the driver's own command line, not one this test wrote down.
        self.assertIn("--json-schema", answer["argv"])
        self.assertEqual("opus", answer["argv"][answer["argv"].index("--model") + 1])
        self.assertEqual("high", answer["argv"][answer["argv"].index("--effort") + 1])

        item = planning.get_work_item(self.conn, reference)
        self.assertEqual("review", item["state"]["key"], "a delivery moves the work on")
        attempt = execution_service.executions_for_work_item(self.conn, str(item["work_item_id"]))[
            0
        ]
        self.assertEqual("complete", attempt["status"])
        self.assertEqual("complete", attempt["outcome"])
        self.assertEqual(0, attempt["exit_code"])
        assert attempt["result"] is not None
        self.assertTrue(attempt["result"]["structured"])
        # The evidence half: the client said it wrote a file, and the checkout
        # agrees. A claim and an observation, side by side.
        assert attempt["final_artifact"] is not None
        self.assertEqual("observed", attempt["final_artifact"]["quality"])
        self.assertTrue(attempt["final_artifact"]["dirty"])


if __name__ == "__main__":
    unittest.main()
