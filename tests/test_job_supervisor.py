import io
import json
import os
import tempfile
import threading
import unittest

from server.improvements.analyzer_contract import (
    ANALYZER_RESULT_SCHEMA,
    AnalyzerOutputError,
    analyzer_result_parser,
    parse_analyzer_result,
    structured_output_schema,
)
from server.improvements.job_supervisor import (
    JobConflictError,
    JobError,
    JobSupervisor,
    MemoryJobStore,
)


class FakeProcess:
    def __init__(self, output=b"", code=None):
        self.stdout = io.BytesIO(output)
        self._code = code
        self.terminated = False
        self.killed = False
        self.pid = 4321

    def poll(self):
        return self._code

    def finish(self, code=0):
        self._code = code

    def terminate(self):
        self.terminated = True
        self._code = -15

    def kill(self):
        self.killed = True
        self._code = -9

    def wait(self, timeout=None):  # noqa: ARG002
        return self._code


class JobSupervisorTests(unittest.TestCase):
    def test_analysis_result_file_accepts_a_bounded_structured_response_over_legacy_tail_size(self):
        case = {
            "case_key": "bounded-case",
            "title": "Bounded case",
            "severity": "medium",
            "category": "instructions",
            "signal_ids": [],
            "proposal": {
                "targets": ["instructions"],
                "recommended_change": "Tighten the instruction boundary.",
                "acceptance_criteria": "The regression passes.",
            },
            "evaluation_pack": {
                "assertions": [
                    {
                        "name": "regression",
                        "type": "command_exit",
                        "required": True,
                    }
                ],
            },
        }
        payload = {
            "interface_version": "improvements-api",
            "scope": "personal",
            "cases": [case | {"case_key": f"bounded-case-{index}"} for index in range(48)],
        }
        encoded = json.dumps(payload)
        self.assertGreater(len(encoded), 16_000)
        result = tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8")
        try:
            result.write(encoded)
            result.close()
            process = FakeProcess(code=None)
            supervisor = JobSupervisor(spawn=lambda *_: process)
            job = supervisor.queue(
                "personal",
                "analysis",
                "fake",
                ["fake"],
                result_parser=analyzer_result_parser(ANALYZER_RESULT_SCHEMA),
                result_path=result.name,
            )
            supervisor.start(job["id"])
            process.finish(0)
            terminal = supervisor.reap()[0]
            self.assertEqual("succeeded", terminal["state"], terminal)
        finally:
            result.close()
            os.unlink(result.name)

    def test_structured_output_schema_requires_every_declared_object_property(self):
        def assert_strict_object(node, path="$"):
            if not isinstance(node, dict):
                return
            if node.get("type") == "object" and node.get("additionalProperties") is False:
                properties = set(node.get("properties", {}))
                self.assertEqual(properties, set(node.get("required", [])), path)
            for name, child in node.get("properties", {}).items():
                assert_strict_object(child, f"{path}.{name}")
            assert_strict_object(node.get("items"), f"{path}[]")

        strict_schema = structured_output_schema(ANALYZER_RESULT_SCHEMA)
        assert_strict_object(strict_schema)
        proposal = strict_schema["properties"]["cases"]["items"]["properties"]["proposal"]
        self.assertEqual(["string", "null"], proposal["properties"]["root_cause"]["type"])
        category = strict_schema["properties"]["cases"]["items"]["properties"]["category"]
        target = proposal["properties"]["targets"]["items"]
        self.assertEqual(category["enum"], target["enum"])

    def test_analyzer_parser_removes_optional_nulls_from_structured_output(self):
        parsed = parse_analyzer_result(
            {
                "interface_version": "improvements-api",
                "scope": "personal",
                "cases": [
                    {
                        "case_key": "case-one",
                        "title": "Case one",
                        "severity": "medium",
                        "category": "instructions",
                        "summary": None,
                        "signal_ids": [],
                        "session_ids": None,
                        "proposal": {
                            "targets": ["instructions"],
                            "root_cause": None,
                            "recommended_change": "Tighten the instruction.",
                            "risk": None,
                            "rollback": None,
                            "acceptance_criteria": "The regression passes.",
                        },
                        "evaluation_pack": {
                            "assertions": [
                                {
                                    "name": "regression",
                                    "type": "command_exit",
                                    "required": True,
                                    "safety": None,
                                    "guard": None,
                                    "guard_regression": None,
                                    "baseline_failure": None,
                                    "expected_failure": None,
                                    "timeout": None,
                                    "argv": None,
                                    "path": None,
                                    "text": None,
                                    "contains": None,
                                    "needle": None,
                                }
                            ],
                            "failure_examples": None,
                        },
                    }
                ],
            },
            scope="personal",
        )
        case = parsed["cases"][0]
        self.assertNotIn("summary", case)
        self.assertNotIn("session_ids", case)
        self.assertEqual(
            {"targets", "recommended_change", "acceptance_criteria"},
            set(case["proposal"]),
        )
        self.assertNotIn("failure_examples", case["evaluation_pack"])
        self.assertEqual(
            {"name", "type", "required"},
            set(case["evaluation_pack"]["assertions"][0]),
        )

    def test_queue_start_reap_and_exact_event_order(self):
        events = []
        process = FakeProcess(b'{"ok":true}\n')
        supervisor = JobSupervisor(event_callback=events.append, spawn=lambda *_: process)
        queued = supervisor.queue("personal", "eval", "fake", ["fake", "run"])
        self.assertTrue(queued["id"].startswith("job-"))
        supervisor.start(queued["id"])
        process.finish(0)
        result = supervisor.reap()
        self.assertEqual("succeeded", result[0]["state"])
        self.assertEqual(
            [
                "module.improvements.job.queued",
                "module.improvements.job.started",
                "module.improvements.job.succeeded",
            ],
            [event["event"] for event in events],
        )

    def test_store_callback_owns_one_analysis_per_scope(self):
        store = MemoryJobStore()
        supervisor = JobSupervisor(store=store)
        supervisor.queue("personal", "analysis", "fake", ["fake"])
        with self.assertRaises(JobConflictError):
            supervisor.queue("personal", "analysis", "fake", ["fake"])
        # A different scope is independent; eval jobs are not analyzer jobs.
        supervisor.queue("attached", "analysis", "fake", ["fake"])
        supervisor.queue("personal", "eval", "fake", ["fake"])

    def test_cancel_uses_injected_tree_stop(self):
        process = FakeProcess()
        stopped = []
        supervisor = JobSupervisor(spawn=lambda *_: process, stop_tree=stopped.append)
        job = supervisor.queue("personal", "eval", "fake", ["fake"])
        supervisor.start(job["id"])
        cancelled = supervisor.cancel(job["id"])
        self.assertEqual("cancelled", cancelled["state"])
        self.assertIs(stopped[0], process)
        self.assertFalse(process.terminated)

    def test_timeout_marks_failed_and_stops_tree(self):
        process = FakeProcess()
        stopped = []
        supervisor = JobSupervisor(
            spawn=lambda *_: process, stop_tree=stopped.append, monotonic=lambda: 10.0
        )
        job = supervisor.queue("personal", "eval", "fake", ["fake"], timeout=1)
        supervisor.start(job["id"])
        failed = supervisor.check_timeouts(now=11.1)[0]
        self.assertEqual("failed", failed["state"])
        self.assertEqual("timeout", failed["error_code"])
        self.assertEqual([process], stopped)

    def test_terminal_jobs_leave_the_runtime_table_once_the_store_owns_them(self):
        store = MemoryJobStore()
        supervisor = JobSupervisor(store=store)
        for index in range(60):
            process = FakeProcess(b"x" * 4096)
            queued = supervisor.queue("personal", "eval", "fake", ["fake"], job_id=f"job-{index}")
            supervisor.start(queued["id"], process)
            process.finish(0)
            self.assertEqual("succeeded", supervisor.reap()[0]["state"])
            supervisor.join_readers(timeout=2)
            # The table holds the job that just finished until the next reap
            # forgets it, and nothing older than that.
            self.assertLessEqual(len(supervisor.jobs()), 2, supervisor.jobs())
        supervisor.reap()
        self.assertEqual([], supervisor.jobs())
        # The store is the authority and keeps every outcome.
        self.assertEqual(60, len(store.list_jobs("personal")))
        self.assertEqual({"succeeded"}, {job["state"] for job in store.list_jobs("personal")})

    def test_reap_enforces_a_declared_timeout_without_an_injected_clock(self):
        process = FakeProcess()
        stopped = []
        clock = [10.0]
        supervisor = JobSupervisor(
            spawn=lambda *_: process, stop_tree=stopped.append, monotonic=lambda: clock[0]
        )
        job = supervisor.queue("personal", "eval", "fake", ["fake"], timeout=5)
        supervisor.start(job["id"])
        self.assertEqual([], supervisor.reap())
        self.assertEqual("running", supervisor.get(job["id"])["state"])
        clock[0] = 16.0
        supervisor.reap()
        failed = supervisor.get(job["id"])
        self.assertEqual("failed", failed["state"])
        self.assertEqual("timeout", failed["error_code"])
        self.assertEqual([process], stopped)

    def test_bounded_capture(self):
        process = FakeProcess(b"x" * 500)
        supervisor = JobSupervisor(spawn=lambda *_: process, max_output_chars=32)
        job = supervisor.queue("personal", "eval", "fake", ["fake"])
        supervisor.start(job["id"])
        process.finish(1)
        result = supervisor.reap()[0]
        self.assertEqual("failed", result["state"])
        self.assertLessEqual(result["result_summary"]["output_chars"], 32)

    def test_malformed_analysis_does_not_invoke_handler(self):
        process = FakeProcess(b'{"scope":"personal","cases":[]}\n')
        handled = []
        supervisor = JobSupervisor(
            spawn=lambda *_: process,
        )
        # Missing interface_version makes the strict envelope malformed.
        job = supervisor.queue(
            "personal",
            "analysis",
            "fake",
            ["fake"],
            result_parser=analyzer_result_parser(ANALYZER_RESULT_SCHEMA),
            result_handler=lambda result, _job: handled.append(result),
        )
        supervisor.start(job["id"])
        process.finish(0)
        failed = supervisor.reap()[0]
        self.assertEqual("failed", failed["state"])
        self.assertEqual("malformed_output", failed["error_code"])
        self.assertIn("interface_version", failed["result_summary"]["reason"])
        self.assertEqual([], handled)

    def test_valid_analysis_result_is_typed_before_handler(self):
        payload = {
            "interface_version": "improvements-api",
            "scope": "personal",
            "cases": [],
        }
        process = FakeProcess((str(payload).replace("'", '"') + "\n").encode())
        handled = []
        supervisor = JobSupervisor(
            spawn=lambda *_: process,
        )
        job = supervisor.queue(
            "personal",
            "analysis",
            "fake",
            ["fake"],
            result_parser=analyzer_result_parser(ANALYZER_RESULT_SCHEMA),
            result_handler=lambda result, _job: handled.append(result),
        )
        supervisor.start(job["id"])
        process.finish(0)
        self.assertEqual("succeeded", supervisor.reap()[0]["state"])
        self.assertEqual(payload, handled[0])

    def test_restart_recovery_fails_orphans_but_leaves_queued(self):
        store = MemoryJobStore()
        store.create_job(
            {
                "id": "job-running",
                "scope": "personal",
                "kind": "analysis",
                "state": "running",
                "client": "fake",
                "created_at": "t0",
            }
        )
        store.create_job(
            {
                "id": "job-queued",
                "scope": "personal",
                "kind": "eval",
                "state": "queued",
                "client": "fake",
                "created_at": "t0",
            }
        )
        events = []
        supervisor = JobSupervisor(store=store, event_callback=events.append)
        recovered = supervisor.recover_orphans()
        self.assertEqual("platform_restarted", recovered[0]["error_code"])
        self.assertEqual("queued", store.get_job("job-queued")["state"])
        self.assertEqual("failed", store.get_job("job-running")["state"])
        self.assertEqual("module.improvements.job.failed", events[0]["event"])

    def test_queued_jobs_can_be_reconstructed_through_loader(self):
        store = MemoryJobStore()
        store.create_job(
            {
                "id": "job-queued",
                "scope": "personal",
                "kind": "eval",
                "state": "queued",
                "client": "fake",
                "created_at": "t0",
            }
        )
        process = FakeProcess()
        supervisor = JobSupervisor(
            store=store,
            spawn=lambda *_: process,
            job_loader=lambda row: {**row, "command": ["fake"]},
        )
        supervisor.recover_orphans()
        self.assertEqual("running", supervisor.start("job-queued")["state"])

    def test_concurrent_start_spawns_once(self):
        process = FakeProcess()
        calls = []
        supervisor = JobSupervisor(
            spawn=lambda *args: calls.append(args) or process,
        )
        job = supervisor.queue("personal", "eval", "fake", ["fake"])
        outcomes = []

        def start():
            try:
                outcomes.append(supervisor.start(job["id"])["state"])
            except Exception as error:
                outcomes.append(type(error).__name__)

        threads = [threading.Thread(target=start) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(1, len(calls))
        self.assertEqual(["JobError", "running"], sorted(outcomes))

    def test_terminal_persistence_failure_does_not_emit_or_expose_raw_output(self):
        class FailingStore(MemoryJobStore):
            def update_job(self, job_id, **fields):
                if fields.get("state") in ("running", "failed", "succeeded", "cancelled"):
                    raise RuntimeError("store unavailable")
                return super().update_job(job_id, **fields)

        process = FakeProcess(b"SECRET-stdout")
        events = []
        store = FailingStore()
        supervisor = JobSupervisor(
            store=store, event_callback=events.append, spawn=lambda *_: process
        )
        job = supervisor.queue("personal", "eval", "fake", ["fake"])
        with self.assertRaises(JobError):
            supervisor.start(job["id"])
        self.assertEqual("queued", supervisor.get(job["id"])["state"])
        self.assertNotIn("SECRET", repr(events))

    def test_parse_analyzer_result_rejects_unknown_fields(self):
        with self.assertRaises(AnalyzerOutputError):
            parse_analyzer_result(
                {
                    "interface_version": "improvements-api",
                    "scope": "personal",
                    "cases": [],
                    "transcript": "must not be persisted",
                },
                scope="personal",
            )


if __name__ == "__main__":
    unittest.main()
