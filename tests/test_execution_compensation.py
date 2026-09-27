"""A failed launch must not undo work done after its claim committed."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest import mock

from server import runner, store
from server.executions import lifecycle
from server.executions import service as execution_service
from server.planning import service as planning


class LaunchCompensationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = os.path.join(directory.name, "test.sqlite3")
        self.repo = os.path.join(directory.name, "repo")
        os.mkdir(self.repo)
        environment = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": self.database,
                "VALKAMA_CLAUDE_BIN": sys.executable,
                "TEMP": directory.name,
                "TMP": directory.name,
                "LOCALAPPDATA": directory.name,
                "APPDATA": directory.name,
                "GIT_CEILING_DIRECTORIES": directory.name,
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        created = planning.create_work_item(
            self.conn, space="TST", title="Contested launch", state="todo"
        )
        self.reference = str(created["reference"])
        self.conn.commit()
        self.other = store.connect()
        self.addCleanup(self.other.close)
        original_runner = runner.RUNNER
        self.addCleanup(setattr, runner, "RUNNER", original_runner)

    def packet(self, **overrides: object) -> dict:
        return {"work_item": self.reference, "client": "claude", "repo": self.repo, **overrides}

    def attempt(self) -> dict:
        item = planning.get_work_item(self.conn, self.reference)
        return execution_service.executions_for_work_item(self.conn, str(item["work_item_id"]))[0]

    def test_human_claim_and_review_survive_later_spawn_failure(self) -> None:
        def fail_after_human_action(_argv: list[str], _cwd: str, _environment: dict) -> None:
            planning.claim_work_item(self.other, self.reference, author="human", force=True)
            planning.transition_work_item(
                self.other, self.reference, "review", author="human", force=True
            )
            self.other.commit()
            raise OSError("client unavailable")

        runner.RUNNER = runner.Runner(spawn=fail_after_human_action)
        with self.assertRaisesRegex(runner.LaunchError, "client unavailable"):
            lifecycle.launch_work_item(self.conn, self.packet())

        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual("review", item["state"]["key"])
        self.assertEqual("human", item["claim_ref"])
        self.assertIn("compensation skipped", item["comments"][-1]["body"])
        attempt = self.attempt()
        self.assertEqual("failed", attempt["status"])
        self.assertEqual("launch_failed", attempt["outcome"])
        self.assertIn("changed after launch", attempt["result"]["unresolved"])

    def test_failed_forced_launch_restores_the_prior_holder(self) -> None:
        planning.claim_work_item(self.other, self.reference, author="prior-holder")
        self.other.commit()
        runner.RUNNER = runner.Runner(
            spawn=lambda *_args: (_ for _ in ()).throw(OSError("no client"))
        )

        with self.assertRaises(runner.LaunchError):
            lifecycle.launch_work_item(self.conn, self.packet(force=True))

        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual("todo", item["state"]["key"])
        self.assertEqual("prior-holder", item["claim_ref"])
        self.assertIn("restored", self.attempt()["result"]["unresolved"])

    def test_compensation_holds_write_lock_through_guard_and_restore(self) -> None:
        runner.RUNNER = runner.Runner(
            spawn=lambda *_args: (_ for _ in ()).throw(OSError("no client"))
        )
        original_read = planning.get_work_item
        competing_write = []
        reads = 0

        def read_during_compensation(conn: sqlite3.Connection, reference: str) -> dict:
            nonlocal reads
            if conn is self.conn:
                reads += 1
            if conn is self.conn and reads == 3:
                self.other.execute("PRAGMA busy_timeout=0")
                with self.assertRaisesRegex(sqlite3.OperationalError, "database is locked"):
                    planning.claim_work_item(self.other, reference, author="human", force=True)
                self.other.rollback()
                competing_write.append(True)
            return original_read(conn, reference)

        # The third read is compensation, after the launch-owned row committed.
        with mock.patch.object(planning, "get_work_item", read_during_compensation):
            with self.assertRaises(runner.LaunchError):
                lifecycle.launch_work_item(self.conn, self.packet())

        self.assertEqual([True], competing_write)
        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual("todo", item["state"]["key"])
        self.assertEqual("", item["claim_ref"])
        self.assertIn("restored", self.attempt()["result"]["unresolved"])

    def test_attempt_insert_failure_rolls_back_claim_and_transition(self) -> None:
        original = planning.get_work_item(self.conn, self.reference)
        with mock.patch.object(
            execution_service,
            "open_execution",
            side_effect=sqlite3.OperationalError("insert failed"),
        ):
            with self.assertRaisesRegex(sqlite3.OperationalError, "insert failed"):
                lifecycle.launch_work_item(self.conn, self.packet())

        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual(original["revision"], item["revision"])
        self.assertEqual("todo", item["state"]["key"])
        self.assertEqual("", item["claim_ref"])
        self.assertEqual(
            [], execution_service.executions_for_work_item(self.other, item["work_item_id"])
        )
        self.assertEqual([], runner.RUNNER.running())

    def test_baseline_observation_failure_closes_attempt_before_spawn(self) -> None:
        spawned: list[bool] = []
        runner.RUNNER = runner.Runner(spawn=lambda *_args: spawned.append(True))
        with mock.patch.object(
            execution_service, "observe_baseline", side_effect=FileNotFoundError("git missing")
        ):
            with self.assertRaisesRegex(FileNotFoundError, "git missing"):
                lifecycle.launch_work_item(self.conn, self.packet())

        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual("todo", item["state"]["key"])
        self.assertEqual("", item["claim_ref"])
        self.assertEqual([], spawned)
        self.assertIn("launch_failed", item["comments"][-1]["body"])
        attempt = self.attempt()
        self.assertEqual("failed", attempt["status"])
        self.assertEqual("launch_failed", attempt["outcome"])
        self.assertIn("git missing", attempt["result"]["oracle"])

    def test_baseline_write_failure_rolls_back_open_transaction_before_compensation(self) -> None:
        spawned: list[bool] = []
        runner.RUNNER = runner.Runner(spawn=lambda *_args: spawned.append(True))
        original_record = execution_service.record_baseline

        def fail_after_write(conn: sqlite3.Connection, execution_id: str, baseline: dict) -> None:
            original_record(conn, execution_id, baseline)
            raise sqlite3.OperationalError("baseline write failed")

        with mock.patch.object(execution_service, "record_baseline", fail_after_write):
            with self.assertRaisesRegex(sqlite3.OperationalError, "baseline write failed"):
                lifecycle.launch_work_item(self.conn, self.packet())

        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual("todo", item["state"]["key"])
        self.assertEqual("", item["claim_ref"])
        self.assertEqual([], spawned)
        attempt = self.attempt()
        self.assertEqual("failed", attempt["status"])
        self.assertEqual("launch_failed", attempt["outcome"])
        self.assertIsNone(attempt["base_artifact"])
        self.assertIn("baseline write failed", attempt["result"]["oracle"])

    def test_runner_schema_setup_failure_cleans_runtime_and_preserves_human_edit(self) -> None:
        spawned: list[bool] = []
        runner.RUNNER = runner.Runner(spawn=lambda *_args: spawned.append(True))
        original_tempdir = tempfile.TemporaryDirectory
        runtime_paths: list[str] = []

        def allocate_runtime(*, prefix: str = "") -> tempfile.TemporaryDirectory[str]:
            runtime = original_tempdir(prefix=prefix, dir=os.path.dirname(self.repo))
            runtime_paths.append(runtime.name)
            return runtime

        def fail_schema(*_args: object, **_kwargs: object) -> None:
            planning.claim_work_item(self.other, self.reference, author="human", force=True)
            planning.transition_work_item(
                self.other, self.reference, "review", author="human", force=True
            )
            self.other.commit()
            raise OSError("schema write failed")

        with mock.patch.dict(os.environ, {"VALKAMA_CODEX_BIN": sys.executable}):
            with mock.patch.object(runner.tempfile, "TemporaryDirectory", allocate_runtime):
                with mock.patch.object(runner.json, "dump", fail_schema):
                    with self.assertRaisesRegex(runner.LaunchError, "schema write failed"):
                        lifecycle.launch_work_item(self.conn, self.packet(client="codex"))

        self.assertEqual([], spawned)
        self.assertEqual(1, len(runtime_paths))
        self.assertFalse(os.path.exists(runtime_paths[0]))
        item = planning.get_work_item(self.other, self.reference)
        self.assertEqual("review", item["state"]["key"])
        self.assertEqual("human", item["claim_ref"])
        self.assertIn("compensation skipped", item["comments"][-1]["body"])
        attempt = self.attempt()
        self.assertEqual("failed", attempt["status"])
        self.assertEqual("launch_failed", attempt["outcome"])
        self.assertIn("schema write failed", attempt["result"]["oracle"])

    def test_second_launch_is_refused_before_claim_when_first_spawn_fails(self) -> None:
        entered_spawn = threading.Event()
        finish_spawn = threading.Event()
        spawn_calls: list[bool] = []
        first_outcome: list[runner.LaunchError] = []

        def failing_spawn(*_args: object) -> None:
            spawn_calls.append(True)
            entered_spawn.set()
            if not finish_spawn.wait(10):
                raise TimeoutError("test did not release spawn")
            raise OSError("first spawn failed")

        runner.RUNNER = runner.Runner(spawn=failing_spawn)

        def first_launch() -> None:
            connection = store.connect()
            try:
                lifecycle.launch_work_item(connection, self.packet())
            except runner.LaunchError as error:
                first_outcome.append(error)
            finally:
                connection.close()

        thread = threading.Thread(target=first_launch)
        thread.start()
        try:
            self.assertTrue(entered_spawn.wait(10), "first launch never reached spawn")
            with self.assertRaisesRegex(runner.LaunchError, "already has a running launch"):
                lifecycle.launch_work_item(self.other, self.packet())
            active = planning.get_work_item(self.conn, self.reference)
            self.assertEqual("dev", active["state"]["key"])
            self.assertEqual("claude:executor", active["claim_ref"])
        finally:
            finish_spawn.set()
            thread.join(10)

        self.assertFalse(thread.is_alive())
        self.assertEqual(1, len(spawn_calls))
        self.assertEqual(1, len(first_outcome))
        self.assertIsInstance(first_outcome[0], runner.LaunchError)
        final = planning.get_work_item(self.conn, self.reference)
        self.assertEqual("todo", final["state"]["key"])
        self.assertEqual("", final["claim_ref"])
        attempts = execution_service.executions_for_work_item(self.conn, final["work_item_id"])
        self.assertEqual(1, len(attempts))
        self.assertEqual("failed", attempts[0]["status"])
        self.assertEqual([], runner.RUNNER.running())

    def test_relaunch_before_reap_preserves_both_attempts_and_sessions(self) -> None:
        class Process:
            pid = 42
            stdout = None

            def __init__(self) -> None:
                self.code: int | None = None

            def poll(self) -> int | None:
                return self.code

        processes: list[Process] = []

        def spawn(*_args: object) -> Process:
            process = Process()
            processes.append(process)
            return process

        runner.RUNNER = runner.Runner(spawn=spawn)

        def deliver(outcome: str) -> str:
            live = runner.RUNNER._running[self.reference]
            assert live.runtime is not None
            with open(live.result_path, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "outcome": outcome,
                        "expected_effect": "change_required",
                        "delivery": f"{outcome} delivery",
                        "oracle": "local check",
                        "unresolved": "none",
                    },
                    handle,
                )
            return live.runtime.name

        with mock.patch.dict(os.environ, {"VALKAMA_CODEX_BIN": sys.executable}):
            with mock.patch.object(tempfile, "tempdir", os.path.dirname(self.repo)):
                first = lifecycle.launch_work_item(self.conn, self.packet(client="codex"))
                first_runtime = deliver("complete")
                processes[0].code = 0
                second = lifecycle.launch_work_item(self.conn, self.packet(client="codex"))
                second_runtime = deliver("partial")
                processes[1].code = 0

        self.assertNotEqual(first["execution_id"], second["execution_id"])
        self.assertNotEqual(first["launch_id"], second["launch_id"])
        ended = lifecycle.reap_launches(self.conn)
        self.assertEqual(
            [first["execution_id"], second["execution_id"]],
            [item["execution_id"] for item in ended],
        )
        self.assertEqual(["complete", "partial"], [item["result"]["outcome"] for item in ended])
        attempts = execution_service.executions_for_work_item(
            self.conn, planning.get_work_item(self.conn, self.reference)["work_item_id"]
        )
        self.assertEqual(
            {first["execution_id"]: "complete", second["execution_id"]: "partial"},
            {attempt["execution_id"]: attempt["outcome"] for attempt in attempts},
        )
        session_rows = self.conn.execute(
            "SELECT id,status FROM sessions WHERE id IN (?,?)",
            (first["launch_id"], second["launch_id"]),
        ).fetchall()
        self.assertEqual(
            {first["launch_id"]: "ended", second["launch_id"]: "ended"},
            {str(row["id"]): str(row["status"]) for row in session_rows},
        )
        self.assertFalse(os.path.exists(first_runtime))
        self.assertFalse(os.path.exists(second_runtime))
        self.assertEqual([], lifecycle.reap_launches(self.conn))

    def test_old_delivery_cannot_move_a_newer_running_attempt_to_review(self) -> None:
        class Process:
            pid = 42
            stdout = None

            def __init__(self) -> None:
                self.code: int | None = None

            def poll(self) -> int | None:
                return self.code

        processes: list[Process] = []

        def spawn(*_args: object) -> Process:
            process = Process()
            processes.append(process)
            return process

        runner.RUNNER = runner.Runner(spawn=spawn)

        def deliver() -> None:
            runner.RUNNER._running[self.reference].capture.append(
                json.dumps(
                    {
                        "outcome": "complete",
                        "expected_effect": "change_required",
                        "delivery": "owned change",
                        "oracle": "local check",
                        "unresolved": "none",
                    }
                )
            )

        first = lifecycle.launch_work_item(self.conn, self.packet())
        deliver()
        processes[0].code = 0
        second = lifecycle.launch_work_item(self.conn, self.packet())
        self.assertEqual(
            [first["execution_id"]],
            [item["execution_id"] for item in lifecycle.reap_launches(self.conn)],
        )

        item = planning.get_work_item(self.conn, self.reference)
        self.assertEqual("dev", item["state"]["key"])
        attempts = execution_service.executions_for_work_item(self.conn, item["work_item_id"])
        self.assertEqual(
            {first["execution_id"]: "complete", second["execution_id"]: "running"},
            {attempt["execution_id"]: attempt["status"] for attempt in attempts},
        )
        sessions = self.conn.execute(
            "SELECT id,status FROM sessions WHERE id IN (?,?)",
            (first["client_session_id"], second["client_session_id"]),
        ).fetchall()
        self.assertEqual(
            {first["client_session_id"]: "ended", second["client_session_id"]: "active"},
            {str(row["id"]): str(row["status"]) for row in sessions},
        )

        deliver()
        processes[1].code = 0
        self.assertEqual(
            [second["execution_id"]],
            [item["execution_id"] for item in lifecycle.reap_launches(self.conn)],
        )
        self.assertEqual(
            "review", planning.get_work_item(self.conn, self.reference)["state"]["key"]
        )
        self.assertEqual([], lifecycle.reap_launches(self.conn))


if __name__ == "__main__":
    unittest.main()
