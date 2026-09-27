from __future__ import annotations

import http.client
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import http_surface, mcp_surface, watchers
from server.improvements import api as improvements_api
from server.improvements import (
    improvements,
    improvements_eval_worker,
    improvements_integration,
    sidecar_schema,
)
from server.planning import model as planning_model
from server.planning import service as planning_service
from server.projects import scopes
from server.sessions import op_ingest_session_event
from server.store import SCHEMA, connect
from tests import SUITE_STORE


class ImprovementsIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        # Analysis processes are fakes; discovery must not depend on host tools.
        self.enterContext(mock.patch.dict(os.environ, {"VALKAMA_CLAUDE_BIN": sys.executable}))
        self.tmp = tempfile.TemporaryDirectory()
        self.primary = os.path.join(self.tmp.name, "primary.sqlite3")
        os.environ["VALKAMA_DB"] = self.primary
        self.conn = connect()
        planning_service.create_planning_space(self.conn, project_id="planning", name="Planning")
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        os.environ["VALKAMA_DB"] = SUITE_STORE
        self.tmp.cleanup()

    def enable(self, scope_name: str = "personal") -> improvements.ImprovementStore:
        store = improvements_integration.resolve_store(self.primary, scope_name)
        values = improvements.default_profile(scope_name) | {
            "enabled": True,
            "purpose": "Prevent repeated workflow failures",
            "expected_behavior": "The same failure stops recurring",
            "planning_space": "PLA",
        }
        store.put_profile(values, 0)
        return store

    @staticmethod
    def signal(store: improvements.ImprovementStore, session: str, number: int) -> dict:
        return store.record_signal(
            "validator-eval",
            {
                "pointer": f"session:{session}/event:{number}",
                "client": "codex",
                "session_id": session,
                "event_type": "tool_end",
                "severity": "high",
                "excerpt": "validator omitted the required rollback check",
            },
            "Sensitive original case title",
        )

    def open_case(self) -> tuple[improvements.ImprovementStore, dict]:
        store = self.enable()
        self.signal(store, "a", 1)
        self.signal(store, "b", 2)
        return store, self.signal(store, "a", 3)

    @staticmethod
    def analyzer_change(category: str) -> dict:
        return {
            "proposal": {
                "targets": [category],
                "recommended_change": "Tighten the workflow contract",
                "acceptance_criteria": "The recurring failure no longer reproduces",
                "rollback": "Revert the workflow-only change",
                "risk": "low",
            },
            "evaluation_pack": {
                "assertions": [
                    {
                        "name": "workflow-regression",
                        "type": "file_not_contains",
                        "required": True,
                        "path": "README.md",
                        "text": "unsafe-marker",
                    }
                ]
            },
        }

    def test_unknown_scope_is_404_before_any_sidecar_creation(self) -> None:
        with self.assertRaises(improvements.ImprovementError) as raised:
            improvements_api.handle_get(
                self.primary, "/api/modules/improvements/profile", {"scope": ["missing"]}
            )
        status, payload = improvements_api.error_response(raised.exception)
        self.assertEqual(404, status)
        self.assertEqual("unknown_scope", payload["error"]["code"])
        self.assertFalse(Path(self.tmp.name, "primary.modules").exists())

    def test_disable_at_binding_and_final_start_checks_never_launches(self) -> None:
        store = self.enable()
        for disabled_check, expected_queued in ((3, False), (4, True)):
            with self.subTest(disabled_check=disabled_check):
                sidecar = store.create_job("analysis", "manual", recipe_id="improvements.analysis")
                checks = 0

                def enabled(_path: str, limit: int = disabled_check) -> bool:
                    nonlocal checks
                    checks += 1
                    return checks < limit

                runtime = improvements_integration.ImprovementsRuntime(module_enabled=enabled)
                runtime._candidate_signals = mock.Mock(return_value=[])  # type: ignore[method-assign]
                runtime._analysis_prompt = mock.Mock(return_value="prompt")  # type: ignore[method-assign]
                runtime._supervisor.queue = mock.Mock()  # type: ignore[method-assign]
                runtime._supervisor.start = mock.Mock()  # type: ignore[method-assign]
                runtime._supervisor.cancel = mock.Mock()  # type: ignore[method-assign]
                with (
                    mock.patch.object(
                        improvements_integration,
                        "analyzer_client_argv",
                        return_value=["fake-analyzer"],
                    ),
                    self.assertRaises(improvements.ImprovementError) as raised,
                ):
                    runtime._dispatch_analysis(self.primary, store, sidecar, "manual")
                self.assertEqual("module_disabled", raised.exception.code)
                self.assertEqual(expected_queued, runtime._supervisor.queue.called)
                runtime._supervisor.start.assert_not_called()
                self.assertNotIn(f"personal:analysis:{sidecar['id']}", runtime._bindings)
                persisted = next(item for item in store.jobs() if item["id"] == sidecar["id"])
                self.assertEqual("cancelled", persisted["state"])
                self.assertEqual("module_disabled", persisted["error_code"])

    def test_runtime_stop_cancels_reconciles_and_joins_owned_fake_process(self) -> None:
        store = self.enable()

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(b"")
                self.code = None
                self.stop_calls = 0

            def poll(self):
                return self.code

            def stop(self) -> None:
                self.stop_calls += 1
                self.code = 1

        process = Process()
        runtime = improvements_integration.ImprovementsRuntime()
        runtime._candidate_signals = mock.Mock(return_value=[])  # type: ignore[method-assign]
        runtime._analysis_prompt = mock.Mock(return_value="prompt")  # type: ignore[method-assign]
        runtime._supervisor._spawn = lambda *_args: process
        runtime._supervisor._stop_tree = lambda live: live.stop()
        with mock.patch.object(
            improvements_integration,
            "analyzer_client_argv",
            return_value=["fake-analyzer"],
        ):
            queued = runtime.queue_analysis(self.primary, "personal", "manual")
        self.assertEqual("running", queued["state"])
        # Held before the shutdown, because a terminal job is forgotten by the
        # supervisor once its reader has ended; the guarantee under test is that
        # no reader outlives `stop()`, whichever of the two happens first.
        job = runtime._supervisor._jobs[f"personal:analysis:{queued['id']}"]
        runtime.stop()
        runtime.stop()
        persisted = next(item for item in store.jobs() if item["id"] == queued["id"])
        self.assertEqual("cancelled", persisted["state"])
        self.assertEqual(1, process.stop_calls)
        self.assertEqual({}, runtime._bindings)
        self.assertFalse(job.reader and job.reader.is_alive())

        with self.assertRaises(improvements.ImprovementError) as stopped:
            runtime.queue_analysis(self.primary, "personal", "manual")
        self.assertEqual("runtime_stopped", stopped.exception.code)

    def test_concurrent_stop_waits_for_final_admission_and_cancels_fake_process(self) -> None:
        self.enable()

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(b"")
                self.code = None
                self.stop_calls = 0

            def poll(self):
                return self.code

            def stop(self) -> None:
                self.stop_calls += 1
                self.code = 1

        process = Process()
        runtime = improvements_integration.ImprovementsRuntime()
        runtime._candidate_signals = mock.Mock(return_value=[])  # type: ignore[method-assign]
        runtime._analysis_prompt = mock.Mock(return_value="prompt")  # type: ignore[method-assign]
        runtime._supervisor._spawn = lambda *_args: process
        runtime._supervisor._stop_tree = lambda live: live.stop()
        original_start = runtime._supervisor.start
        entered = threading.Event()
        release = threading.Event()
        stopped = threading.Event()
        queued: list[dict] = []

        def gated_start(identifier: str):
            entered.set()
            self.assertTrue(release.wait(2))
            return original_start(identifier)

        runtime._supervisor.start = gated_start  # type: ignore[method-assign]

        def queue() -> None:
            with mock.patch.object(
                improvements_integration,
                "analyzer_client_argv",
                return_value=["fake-analyzer"],
            ):
                queued.append(runtime.queue_analysis(self.primary, "personal", "manual"))

        def stop() -> None:
            runtime.stop()
            stopped.set()

        queue_thread = threading.Thread(target=queue)
        stop_thread = threading.Thread(target=stop)
        queue_thread.start()
        self.assertTrue(entered.wait(2))
        stop_thread.start()
        self.assertFalse(stopped.wait(0.1), "stop crossed an active admission fence")
        release.set()
        queue_thread.join(2)
        stop_thread.join(2)
        self.assertFalse(queue_thread.is_alive())
        self.assertFalse(stop_thread.is_alive())
        self.assertEqual("running", queued[0]["state"])
        self.assertEqual(1, process.stop_calls)
        with self.assertRaises(improvements.ImprovementError) as after_stop:
            runtime.queue_analysis(self.primary, "personal", "manual")
        self.assertEqual("runtime_stopped", after_stop.exception.code)

    def test_disabled_get_is_non_creating_and_module_route_has_one_owner(self) -> None:
        status, profile = improvements_api.handle_get(
            self.primary,
            "/api/modules/improvements/profile",
            {"scope": ["personal"]},
        )
        self.assertEqual(200, status)
        self.assertFalse(profile["enabled"])
        self.assertFalse(Path(self.tmp.name, "primary.modules").exists())
        self.assertIsNone(improvements_api.handle_get(self.primary, "/api/modules", {}))

    def test_snapshot_get_is_the_exact_sse_read_model(self) -> None:
        store, _case = self.open_case()
        status, snapshot = improvements_api.handle_get(
            self.primary,
            "/api/modules/improvements",
            {"scope": ["personal"]},
        )
        self.assertEqual(200, status)
        self.assertEqual(store.read_model(), snapshot)
        self.assertEqual(
            {"interface_version", "scope", "profile", "jobs", "cases", "signal_summary"},
            set(snapshot),
        )

    def test_case_detail_is_the_ui_consumable_root_envelope(self) -> None:
        _store, case = self.open_case()
        status, detail = improvements_api.handle_get(
            self.primary,
            f"/api/modules/improvements/cases/{case['id']}",
            {"scope": ["personal"]},
        )
        self.assertEqual(200, status)
        self.assertEqual("improvements-api", detail["interface_version"])
        self.assertEqual("personal", detail["scope"])
        self.assertEqual(case["id"], detail["id"])
        for field in (
            "evidence",
            "proposal",
            "evaluation_pack",
            "eval_runs",
            "history",
            "monitoring",
        ):
            self.assertIn(field, detail)
        self.assertNotIn("case", detail)

    def test_attached_scope_writes_only_its_sidecar(self) -> None:
        attached = os.path.join(self.tmp.name, "work.sqlite3")
        other = sqlite3.connect(attached)
        other.executescript(SCHEMA)
        other.commit()
        other.close()
        scopes.attach(self.primary, "work", attached, "Work")
        store = self.enable("work")
        self.assertTrue(store.path.exists())
        self.assertEqual(Path(self.tmp.name, "work.modules", "improvements.sqlite3"), store.path)
        self.assertFalse(Path(self.tmp.name, "primary.modules").exists())

    def test_approval_is_idempotent_opaque_and_never_launches(self) -> None:
        store, case = self.open_case()
        result = store.action(
            case["id"],
            "approve",
            case["revision"],
            ensure_planning_card=lambda request: (
                improvements_integration.ensure_planning_work_items(self.primary, request)
            ),
        )
        again = store.action(
            case["id"],
            "approve",
            result["case"]["revision"],
            ensure_planning_card=lambda request: (
                improvements_integration.ensure_planning_work_items(self.primary, request)
            ),
        )
        self.assertTrue(result["created"])
        self.assertFalse(result["launched"])
        self.assertFalse(again["created"])
        self.assertEqual(result["work_item"], again["work_item"])
        rows = self.conn.execute(
            "SELECT title,description,source FROM work_items"
            " WHERE source LIKE 'improvement://%' ORDER BY number"
        ).fetchall()
        self.assertEqual(2, len(rows))
        rendered = json.dumps([dict(row) for row in rows])
        self.assertNotIn("Sensitive original case title", rendered)
        self.assertNotIn("validator omitted", rendered)

    def test_planning_identity_accepts_a_bounded_semantic_case_key(self) -> None:
        result = improvements_integration.ensure_planning_work_items(
            self.primary,
            {
                "planning_space": "PLA",
                "epic_source": f"improvement://planning/{'a' * 64}/epic",
                "work_source": "improvement://personal/handoff-contract.v1",
                "scope": "personal",
                "case_key": "handoff-contract.v1",
            },
        )
        self.assertTrue(result["created"])
        source = self.conn.execute(
            "SELECT w.source FROM work_items w"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " WHERE p.key || '-' || w.number = ?",
            (result["work_item"],),
        ).fetchone()[0]
        self.assertEqual("improvement://personal/handoff-contract.v1", source)

    def test_planning_rejects_a_precreated_done_or_malformed_identity(self) -> None:
        request = {
            "planning_space": "PLA",
            "epic_source": f"improvement://planning/{'a' * 64}/epic",
            "work_source": "improvement://personal/guard-bypass",
            "scope": "personal",
            "case_key": "guard-bypass",
        }
        created = improvements_integration.ensure_planning_work_items(self.primary, request)
        # A case whose item was moved on by hand is still that case's item:
        # the source marker is the identity, so the second call adopts it
        # rather than raising or minting a second one.
        planning_service.transition_work_item(
            self.conn, created["work_item"], "done", force=True, author="test"
        )
        self.conn.commit()
        again = improvements_integration.ensure_planning_work_items(self.primary, request)
        self.assertFalse(again["created"])
        self.assertEqual(created["work_item"], again["work_item"])

    def test_done_guard_refuses_without_eval_and_force_records_override(self) -> None:
        store, case = self.open_case()
        approved = store.action(
            case["id"],
            "approve",
            case["revision"],
            ensure_planning_card=lambda request: (
                improvements_integration.ensure_planning_work_items(self.primary, request)
            ),
        )
        reference = approved["work_item"]
        planning_service.set_summary(
            self.conn, reference, {"done": "implemented", "next": "monitor"}
        )
        guard = lambda source, summary: improvements_integration.improvement_guard_for_work_item(  # noqa: E731
            self.primary, source, summary
        )
        with self.assertRaises(planning_model.WorkflowGuardError) as refused:
            planning_service.transition_work_item(
                self.conn, reference, "done", improvement_guard=guard
            )
        self.assertIn("improvement_eval", str(refused.exception))
        moved = planning_service.transition_work_item(
            self.conn, reference, "done", force=True, improvement_guard=guard
        )
        self.assertIn("improvement_eval", moved["overridden"])
        self.assertIsNone(
            improvements_integration.sync_case_from_work_item(
                self.primary, f"improvement://personal/{case['case_key']}", "completed"
            )
        )
        self.assertEqual("resolved", store.case(case["id"])["state"])

    def test_the_partial_unique_index_comes_back_and_enforces(self) -> None:
        """Dropping it by hand is undone by the schema, and it still refuses.

        The Board era took a `preupgrade` snapshot here, because restoring this
        index meant migrating `cards`. It lives in the Planning schema now, so
        `CREATE UNIQUE INDEX IF NOT EXISTS` restores it additively; a duplicate
        that appeared meanwhile would make that statement refuse, which is a
        failure to open rather than a loss.
        """

        planning_service.create_work_item(self.conn, space="PLA", title="Existing")
        self.conn.execute("DROP INDEX work_items_improvement_source")
        self.conn.commit()
        self.conn.close()
        self.conn = connect()
        self.assertIsNotNone(
            self.conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index'"
                " AND name='work_items_improvement_source'"
            ).fetchone()
        )
        marker = "improvement://personal/case-0123456789abcdef"
        planning_service.create_work_item(self.conn, space="PLA", title="one", source=marker)
        with self.assertRaises(sqlite3.IntegrityError):
            planning_service.create_work_item(self.conn, space="PLA", title="two", source=marker)

    def test_eval_worker_redacts_and_bounds_assertion_output(self) -> None:
        request = {
            "phase": "baseline",
            "pack_version": "1",
            "pack_hash": "a" * 64,
            "git_ref": "b" * 40,
        }
        result = improvements_eval_worker._normalize_result(
            {
                "interface_version": "improvements-api",
                "job_id": "7",
                "phase": "baseline",
                "pack_version": "1",
                "pack_hash": "a" * 64,
                "git_ref": "b" * 40,
                "patch_hash": "c" * 64,
                "assertions": [
                    {
                        "name": "safe",
                        "type": "command_exit",
                        "required": True,
                        "passed": False,
                        "baseline_failure": True,
                        "error": "token=secret-value",
                        "output": "must never persist " + "x" * 5000,
                    }
                ],
                "passed": False,
                "baseline_failure_designated": True,
                "infrastructure_failure": False,
                "reproduced_failure": True,
                "safety_regressions": [],
                "guard_regressions": [],
                "error_code": "",
                "cleanup_verified": True,
                "source_unchanged": True,
                "registrations_unchanged": True,
                "refs_unchanged": True,
            },
            request,
        )
        encoded = json.dumps(result)
        self.assertNotIn("secret-value", encoded)
        self.assertNotIn("must never persist", encoded)
        self.assertNotIn("output", result["assertions"][0])
        self.assertNotIn("error", result["assertions"][0])
        self.assertNotIn("result_hash", result)
        persisted = improvements.sanitize_eval_result(result)
        self.assertRegex(persisted["result_hash"], r"^[0-9a-f]{64}$")

    def test_eval_recipe_policy_is_exact_full_argv(self) -> None:
        old = os.environ.get("VALKAMA_EVAL_RECIPES")
        os.environ["VALKAMA_EVAL_RECIPES"] = json.dumps(
            [["python", "-m", "unittest"], ["npm.cmd", "test"]]
        )
        try:
            recipes = improvements_eval_worker._trusted_recipes()
        finally:
            if old is None:
                os.environ.pop("VALKAMA_EVAL_RECIPES", None)
            else:
                os.environ["VALKAMA_EVAL_RECIPES"] = old
        self.assertIn(("python", "-m", "unittest"), recipes)
        self.assertNotIn(("python", "-c", "danger"), recipes)

    def test_http_registry_profile_put_and_read_contract(self) -> None:
        server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=Path(self.tmp.name) / "http-profile-token",
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            client.request("GET", "/api/modules")
            response = client.getresponse()
            self.assertEqual(200, response.status)
            self.assertEqual("valkama-modules", json.loads(response.read())["interface_version"])

            profile = improvements.default_profile("personal") | {
                "expected_revision": 0,
                "enabled": True,
                "purpose": "Reduce recurring failures",
                "expected_behavior": "No recurrence after an approved fix",
                "planning_space": "PLA",
            }
            client.request(
                "PUT",
                "/api/modules/improvements/profile",
                body=json.dumps(profile).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Origin": f"http://127.0.0.1:{server.server_port}",
                    "X-Valkama-Session": server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            body = response.read()
            self.assertEqual(200, response.status, body)
            updated = json.loads(body)
            self.assertTrue(updated["enabled"])

            client.request("GET", "/api/modules/improvements/profile?scope=personal")
            response = client.getresponse()
            self.assertEqual(200, response.status)
            self.assertEqual(1, json.loads(response.read())["revision"])

            client.request("GET", "/api/modules/improvements/profile?scope=unknown")
            response = client.getresponse()
            self.assertEqual(404, response.status)
            self.assertEqual("unknown_scope", json.loads(response.read())["error"]["code"])
        finally:
            client.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_candidate_collection_is_private_and_hard_bounded(self) -> None:
        self.conn.execute(
            "INSERT INTO sessions(id,client,label,status) VALUES('bounded','codex','bounded','active')"
        )
        rows = []
        for index in range(650):
            detail = (
                json.dumps({"outer": {"tool-result": {"prompt": "never-persist"}}})
                if index == 649
                else "ошибка " * 400
            )
            rows.append(("bounded", "analytics", "tool_end", "failed", detail))
        self.conn.executemany(
            "INSERT INTO session_events(session_id,klass,kind,status,detail) VALUES(?,?,?,?,?)",
            rows,
        )
        self.conn.commit()
        profile = improvements.default_profile("personal")
        profile["limits"] = {
            "lookback_days": 10**9,
            "max_sessions": 10**9,
            "max_chars": 10**9,
        }
        signals = improvements_integration.ImprovementsRuntime._candidate_signals(
            self.primary, "personal", profile
        )
        encoded = json.dumps(signals, ensure_ascii=False).encode("utf-8")
        self.assertLessEqual(len(signals), improvements_integration.MAX_CANDIDATE_SIGNALS)
        self.assertLessEqual(len(encoded), improvements_integration.MAX_CANDIDATE_BYTES)
        self.assertEqual(improvements_integration.PRIVATE_DETAIL_SUMMARY, signals[0]["excerpt"])
        self.assertNotIn(b"never-persist", encoded)
        maximal = dict(profile) | {
            "purpose": "ц" * 2000,
            "expected_behavior": "ж" * 2000,
        }
        prompt = improvements_integration.ImprovementsRuntime._analysis_prompt(
            "personal", maximal, signals
        )
        self.assertLessEqual(len(prompt), improvements_integration.MAX_ANALYSIS_PROMPT_CHARS)
        argv = improvements_integration.analyzer_client_argv("codex", prompt, binary="codex")
        self.assertLess(
            improvements_integration._windows_argv_units(argv),
            improvements_integration.MAX_ANALYZER_ARGV_CHARS,
        )
        self.assertTrue(all(signal["exact_fingerprint"] for signal in signals))

    def test_analyzer_client_argv_reuses_model_and_effort_contract_for_both_clients(self) -> None:
        codex = improvements_integration.analyzer_client_argv(
            "codex",
            "bounded prompt",
            model="gpt-5.6-sol",
            effort="high",
            binary="codex",
        )
        self.assertEqual("gpt-5.6-sol", codex[codex.index("--model") + 1])
        self.assertEqual('model_reasoning_effort="high"', codex[codex.index("-c") + 1])
        self.assertLess(codex.index("--model"), codex.index("bounded prompt"))

        claude = improvements_integration.analyzer_client_argv(
            "claude",
            "bounded prompt",
            model="claude-opus-4-1",
            effort="xhigh",
            binary="claude",
        )
        self.assertEqual("claude-opus-4-1", claude[claude.index("--model") + 1])
        self.assertEqual("xhigh", claude[claude.index("--effort") + 1])

    def test_analysis_preflight_failure_releases_slot_and_argv_counts_utf16(self) -> None:
        store = self.enable()
        runtime = improvements_integration.ImprovementsRuntime()
        too_large = improvements.ImprovementError(
            "analysis_prompt_too_large", "bounded prompt exceeds the safe limit", 422
        )
        with mock.patch.object(runtime, "_analysis_prompt", side_effect=too_large):
            with self.assertRaises(improvements.ImprovementError) as raised:
                runtime.queue_analysis(self.primary, "personal", "manual")
        self.assertEqual("analysis_prompt_too_large", raised.exception.code)
        failed = store.jobs()[0]
        self.assertEqual(
            ("failed", "analysis_prompt_too_large"), (failed["state"], failed["error_code"])
        )
        replacement = store.create_job("analysis", "manual", recipe_id="improvements.analysis")
        self.assertEqual("queued", replacement["state"])
        store.update_job(replacement["id"], "cancelled", error_code="test_cleanup")

        adversarial = ["runner.exe", 'quoted value "' + "😀" * 15_000]
        self.assertLess(len(improvements_integration.subprocess.list2cmdline(adversarial)), 30_000)
        self.assertGreaterEqual(
            improvements_integration._windows_argv_units(adversarial),
            improvements_integration.MAX_ANALYZER_ARGV_CHARS,
        )
        with (
            mock.patch.object(
                improvements_integration,
                "analyzer_client_argv",
                return_value=adversarial,
            ),
            self.assertRaises(improvements.ImprovementError) as argv_error,
        ):
            runtime.queue_analysis(self.primary, "personal", "manual")
        self.assertEqual("analysis_argv_too_large", argv_error.exception.code)
        terminal = store.jobs()[0]
        self.assertEqual("failed", terminal["state"])

    def test_recovery_respects_cross_process_runtime_lease_until_owner_releases(self) -> None:
        store = self.enable()
        owner = improvements_integration.ImprovementsRuntime()
        challenger = improvements_integration.ImprovementsRuntime()
        lease_key = owner._retain_scope_lease(store)
        job = store.create_job("analysis", "manual", recipe_id="improvements.analysis")
        store.update_job(job["id"], "running")
        try:
            held = challenger.recover(self.primary)
            self.assertEqual({"running_failed": 0, "queued_resumed": 0}, held)
            self.assertEqual("running", store.jobs()[0]["state"])
        finally:
            owner._release_scope_lease(lease_key)
        orphaned = challenger.recover(self.primary)
        self.assertEqual(1, orphaned["running_failed"])
        self.assertEqual(
            ("failed", "platform_restarted"),
            (store.jobs()[0]["state"], store.jobs()[0]["error_code"]),
        )

    def test_restore_and_rollback_require_runtime_lease_quiescence(self) -> None:
        store = self.enable()
        source = sqlite3.connect(store.path)
        try:
            backup = sidecar_schema._snapshot(source, store.path)
        finally:
            source.close()
        original = store.profile()
        changed = dict(original)
        changed["purpose"] = "changed after backup"
        store.put_profile(changed, original["revision"])
        owner = improvements_integration.ImprovementsRuntime()
        lease_key = owner._retain_scope_lease(store)
        try:
            for operation in (
                lambda: improvements.migrate_sidecar(store.path),
                lambda: sidecar_schema.restore_sidecar_backup(store.path, backup),
            ):
                with self.subTest(operation=operation):
                    with self.assertRaises(improvements.ImprovementError) as raised:
                        operation()
                    self.assertEqual(
                        ("store_busy", 409), (raised.exception.code, raised.exception.status)
                    )
            self.assertEqual("changed after backup", store.profile()["purpose"])
        finally:
            owner._release_scope_lease(lease_key)

        rollback = sidecar_schema.restore_sidecar_backup(store.path, backup)
        self.assertEqual(original["purpose"], store.profile()["purpose"])
        rollback_lease = owner._retain_scope_lease(store)
        try:
            with self.assertRaises(improvements.ImprovementError) as raised:
                sidecar_schema.restore_sidecar_backup(store.path, rollback)
            self.assertEqual("store_busy", raised.exception.code)
        finally:
            owner._release_scope_lease(rollback_lease)
        sidecar_schema.restore_sidecar_backup(store.path, rollback)
        self.assertEqual("changed after backup", store.profile()["purpose"])

    def test_public_ingress_signals_are_prioritized_analyzed_and_not_duplicated(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])
        runtime = improvements_integration.ImprovementsRuntime()
        packet = {
            "scope": "personal",
            "signals": [
                {
                    "source_kind": "user_feedback",
                    "pointer": "feedback:pilot-feedback",
                    "category": "validator-eval",
                    "severity": "high",
                    "excerpt": "validator skipped the rollback check",
                },
                {
                    "source_kind": "agentmemory_lesson",
                    "pointer": "memory:lesson:pilot-lesson",
                    "category": "validator-eval",
                    "severity": "high",
                    "excerpt": "validator skipped the rollback check",
                },
            ],
        }
        self.assertEqual(
            2,
            improvements_api.handle_post(
                runtime, self.primary, "/api/modules/improvements/signals", packet
            )[1]["recorded"],
        )
        candidates = runtime._candidate_signals(self.primary, "personal", store.profile())
        explicit = candidates[:2]
        self.assertEqual(
            {"user_feedback", "agentmemory_lesson"},
            {item["source_kind"] for item in explicit},
        )
        self.assertTrue(all(item["id"] < 0 for item in explicit))
        self.assertTrue(all(item["category"] == "validator-eval" for item in explicit))
        self.assertEqual(0, store.cases()[0]["session_count"])
        encoded = json.dumps(candidates, ensure_ascii=False).encode("utf-8")
        self.assertLessEqual(len(candidates), improvements_integration.MAX_CANDIDATE_SIGNALS)
        self.assertLessEqual(len(encoded), improvements_integration.MAX_CANDIDATE_BYTES)
        prompt = runtime._analysis_prompt("personal", store.profile(), candidates)
        self.assertIn("agentmemory_lesson", prompt)
        self.assertIn("user_feedback", prompt)
        self.assertNotIn("source_hash", prompt)

        analyzer = {
            "interface_version": "improvements-api",
            "scope": "personal",
            "cases": [
                {
                    "case_key": f"pilot-validator-{index}",
                    "title": "Validator rollback gap",
                    "severity": "high",
                    "category": "validator-eval",
                    "signal_ids": [item["id"]],
                    **self.analyzer_change("validator-eval"),
                }
                for index, item in enumerate(explicit, 1)
            ],
        }

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(json.dumps(analyzer).encode("utf-8"))
                self.code = None

            def poll(self):
                return self.code

        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        job = runtime.queue_analysis(self.primary, "personal", "manual")
        process.code = 0
        runtime.reap()
        cases = store.cases()
        self.assertEqual(2, len(cases))
        self.assertTrue(all(case["signal_count"] == 1 for case in cases))
        self.assertEqual(
            "succeeded",
            next(item for item in store.jobs() if item["id"] == job["id"])["state"],
            store.jobs(),
        )
        for case in cases:
            detail = store.case(case["id"])
            self.assertEqual(["validator-eval"], detail["proposal"]["targets"])
            self.assertEqual("1", detail["evaluation_pack"]["version"])

    def test_persisted_session_pointer_is_deduplicated_and_owns_session_bound(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["limits"]["max_sessions"] = 1
        store.put_profile(profile, profile["revision"])
        first = op_ingest_session_event(
            self.conn,
            {
                "event": "attention",
                "session_id": "explicit-session",
                "client": "codex",
                "status": "failed",
                "detail": {"summary": "bounded"},
            },
        )
        op_ingest_session_event(
            self.conn,
            {
                "event": "attention",
                "session_id": "secondary-session",
                "client": "codex",
                "status": "failed",
                "detail": {"summary": "bounded"},
            },
        )
        pointer = f"session:explicit-session/event:{first['id']}"
        runtime = improvements_integration.ImprovementsRuntime()
        improvements_api.handle_post(
            runtime,
            self.primary,
            "/api/modules/improvements/signals",
            {
                "scope": "personal",
                "signals": [
                    {
                        "source_kind": "session_event",
                        "pointer": pointer,
                        "category": "validator-eval",
                        "severity": "high",
                        "excerpt": "validator skipped rollback",
                        "session_id": "explicit-session",
                        "client": "codex",
                        "event_type": "attention",
                    }
                ],
            },
        )
        candidates = runtime._candidate_signals(self.primary, "personal", store.profile())
        self.assertEqual(1, sum(item["pointer"] == pointer for item in candidates))
        self.assertLess(next(item["id"] for item in candidates if item["pointer"] == pointer), 0)
        sessions = {
            item["session_id"]
            for item in candidates
            if item["source_kind"] == "session_event" and item["session_id"]
        }
        self.assertEqual({"explicit-session"}, sessions)
        self.assertLessEqual(
            len(json.dumps(candidates, ensure_ascii=False).encode("utf-8")),
            improvements_integration.MAX_CANDIDATE_BYTES,
        )
        self.assertEqual(1, store.cases()[0]["session_count"])

    def test_analyzer_handler_clusters_semantically_and_replays_idempotently(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])
        op_ingest_session_event(
            self.conn,
            {"event": "session_start", "session_id": "analysis-a", "client": "codex"},
        )
        event = op_ingest_session_event(
            self.conn,
            {
                "event": "tool_end",
                "session_id": "analysis-a",
                "client": "codex",
                "status": "failed",
                "detail": {"code": "validator_failed"},
            },
        )
        op_ingest_session_event(
            self.conn,
            {"event": "session_start", "session_id": "analysis-b", "client": "codex"},
        )
        related = op_ingest_session_event(
            self.conn,
            {
                "event": "tool_end",
                "session_id": "analysis-b",
                "client": "codex",
                "status": "failed",
                "detail": {"code": "owner_missing", "surface": "handoff"},
            },
        )
        op_ingest_session_event(
            self.conn,
            {"event": "session_start", "session_id": "analysis-c", "client": "codex"},
        )
        distinct = op_ingest_session_event(
            self.conn,
            {
                "event": "tool_end",
                "session_id": "analysis-c",
                "client": "codex",
                "status": "failed",
                "detail": "hook timeout",
            },
        )
        analyzer = {
            "interface_version": "improvements-api",
            "scope": "personal",
            "cases": [
                {
                    "case_key": "cluster-1",
                    "title": "Validator failure",
                    "severity": "high",
                    "category": "validator-eval",
                    "signal_ids": [event["id"], related["id"]],
                    **self.analyzer_change("validator-eval"),
                },
                {
                    "case_key": "cluster-2",
                    "title": "Hook timeout",
                    "severity": "high",
                    "category": "hook-lifecycle",
                    "signal_ids": [distinct["id"]],
                    **self.analyzer_change("hook-lifecycle"),
                },
            ],
        }

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(json.dumps(analyzer).encode("utf-8"))
                self.code = None

            def poll(self):
                return self.code

            def finish(self):
                self.code = 0

        runtime = improvements_integration.ImprovementsRuntime()
        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        job = runtime.queue_analysis(self.primary, "personal", "manual")
        identifier = f"personal:analysis:{job['id']}"
        process.finish()
        runtime.reap()
        detail = {case["case_key"]: case for case in store.cases()}
        self.assertEqual({"cluster-1", "cluster-2"}, set(detail))
        self.assertEqual(2, detail["cluster-1"]["signal_count"])
        self.assertEqual(1, detail["cluster-2"]["signal_count"])
        first_detail = store.case(detail["cluster-1"]["id"])
        self.assertEqual(["validator-eval"], first_detail["proposal"]["targets"])
        self.assertEqual("1", first_detail["evaluation_pack"]["version"])
        handler = runtime._supervisor._jobs[identifier].result_handler
        before = {key: (case["revision"], case["signal_count"]) for key, case in detail.items()}
        handler(analyzer, runtime._supervisor._jobs[identifier])
        after = {
            case["case_key"]: (case["revision"], case["signal_count"]) for case in store.cases()
        }
        self.assertEqual(before, after)
        split = json.loads(json.dumps(analyzer))
        split["cases"][0]["signal_ids"] = [event["id"]]
        split["cases"].append(
            {
                "case_key": "split-exact",
                "title": "Illegally split exact event",
                "severity": "high",
                "category": "validator-eval",
                "signal_ids": [related["id"]],
                **self.analyzer_change("validator-eval"),
            }
        )
        with self.assertRaises(improvements_integration.AnalyzerOutputError):
            handler(split, runtime._supervisor._jobs[identifier])

    def test_reap_retries_analyzer_persistence_before_cleanup(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])
        op_ingest_session_event(
            self.conn,
            {"event": "session_start", "session_id": "retry-a", "client": "codex"},
        )
        event = op_ingest_session_event(
            self.conn,
            {
                "event": "tool_end",
                "session_id": "retry-a",
                "client": "codex",
                "status": "failed",
                "detail": "validator failure",
            },
        )
        analyzer = {
            "interface_version": "improvements-api",
            "scope": "personal",
            "cases": [
                {
                    "case_key": "retry-cluster",
                    "title": "Retry persistence",
                    "severity": "high",
                    "category": "validator-eval",
                    "signal_ids": [event["id"]],
                    **self.analyzer_change("validator-eval"),
                }
            ],
        }

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(json.dumps(analyzer).encode("utf-8"))
                self.code = None

            def poll(self):
                return self.code

        runtime = improvements_integration.ImprovementsRuntime()
        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        job = runtime.queue_analysis(self.primary, "personal", "manual")
        identifier = f"personal:analysis:{job['id']}"
        temp_paths = list(runtime._bindings[identifier]["temp_paths"])
        original = improvements.ImprovementStore.apply_analyzer_result
        attempts = 0

        def flaky(store_self, *args, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise sqlite3.OperationalError("simulated persistence fault")
            return original(store_self, *args, **kwargs)

        process.code = 0
        with mock.patch.object(improvements.ImprovementStore, "apply_analyzer_result", flaky):
            self.assertEqual([], runtime.reap())
            self.assertEqual("running", store.jobs()[0]["state"])
            self.assertTrue(all(os.path.exists(path) for path in temp_paths))
            runtime.reap()
        self.assertEqual(2, attempts)
        self.assertEqual("succeeded", store.jobs()[0]["state"])
        self.assertEqual(1, len(store.cases()))
        self.assertTrue(all(not os.path.exists(path) for path in temp_paths))

    def test_queued_recipe_survives_restart_and_reloads_without_persisted_argv(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])
        queued = store.create_job("analysis", recipe_id="improvements.analysis", trigger="manual")
        loaded = store.load_job_request(queued["id"])
        self.assertEqual({"scope": "personal", "trigger": "manual"}, loaded["request"])
        self.assertNotIn("command", json.dumps(loaded).lower())
        result = {
            "interface_version": "improvements-api",
            "scope": "personal",
            "cases": [],
        }

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(json.dumps(result).encode("utf-8"))
                self.code = None

            def poll(self):
                return self.code

            def finish(self):
                self.code = 0

        restarted = improvements_integration.ImprovementsRuntime()
        process = Process()
        restarted._supervisor._spawn = lambda *_args: process
        self.assertIsNotNone(restarted._supervisor._job_loader)
        recovery = restarted.recover(self.primary)
        self.assertEqual(1, recovery["queued_resumed"])
        self.assertEqual("running", store.jobs()[0]["state"])
        process.finish()
        restarted.reap()
        self.assertEqual("succeeded", store.jobs()[0]["state"])

    def test_cancel_is_scope_bound_tree_stopping_and_http_mcp_idempotent(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(b"")
                self.code = None
                self.terminated = False

            def poll(self):
                return self.code

            def terminate(self):
                self.terminated = True
                self.code = -15

            def wait(self, timeout=None):  # noqa: ARG002
                return self.code

        runtime = improvements_integration.ImprovementsRuntime()
        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        job = runtime.queue_analysis(self.primary, "personal", "manual")
        identifier = f"personal:analysis:{job['id']}"
        temp_paths = list(runtime._bindings[identifier]["temp_paths"])
        old_runtime = watchers.IMPROVEMENTS_RUNTIME
        watchers.IMPROVEMENTS_RUNTIME = runtime
        server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=Path(self.tmp.name) / "http-cancel-token",
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            client.request(
                "POST",
                f"/api/modules/improvements/jobs/{job['id']}/cancel",
                body=json.dumps({"scope": "personal"}).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Origin": f"http://127.0.0.1:{server.server_port}",
                    "X-Valkama-Session": server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            self.assertEqual(200, response.status)
            cancelled = json.loads(response.read())
            self.assertEqual("cancelled", cancelled["state"])
            again = mcp_surface._OPS["improvements_cancel_job"](
                self.conn, {"scope": "personal", "job_id": job["id"]}
            )
            self.assertEqual("cancelled", again["state"])
        finally:
            client.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            watchers.IMPROVEMENTS_RUNTIME = old_runtime
        self.assertTrue(process.terminated)
        self.assertNotIn(identifier, runtime._bindings)
        self.assertTrue(all(not os.path.exists(path) for path in temp_paths))
        session = self.conn.execute(
            "SELECT status,attention FROM sessions WHERE id=?",
            (f"improvements:personal:{identifier}",),
        ).fetchone()
        self.assertEqual(("failed", "cancelled"), tuple(session))

    def test_reap_retries_cancel_persistence_before_cleanup(self) -> None:
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(b"")
                self.code = None

            def poll(self):
                return self.code

            def terminate(self):
                self.code = -15

            def wait(self, timeout=None):  # noqa: ARG002
                return self.code

        runtime = improvements_integration.ImprovementsRuntime()
        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        job = runtime.queue_analysis(self.primary, "personal", "manual")
        identifier = f"personal:analysis:{job['id']}"
        temp_paths = list(runtime._bindings[identifier]["temp_paths"])
        original = improvements.ImprovementStore.update_job
        attempts = 0

        def flaky(store_self, sidecar_id, state, **kwargs):
            nonlocal attempts
            if state == "cancelled":
                attempts += 1
                if attempts <= 2:
                    raise sqlite3.OperationalError("simulated terminal persistence fault")
            return original(store_self, sidecar_id, state, **kwargs)

        with mock.patch.object(improvements.ImprovementStore, "update_job", flaky):
            with self.assertRaises(sqlite3.OperationalError):
                runtime.cancel_job(self.primary, "personal", job["id"])
            self.assertEqual("running", store.jobs()[0]["state"])
            self.assertTrue(all(os.path.exists(path) for path in temp_paths))
            runtime.reap()
        self.assertEqual(3, attempts)
        self.assertEqual("cancelled", store.jobs()[0]["state"])
        self.assertNotIn(identifier, runtime._bindings)
        self.assertTrue(all(not os.path.exists(path) for path in temp_paths))

    def test_a_hung_job_times_out_in_the_loop_the_server_actually_runs(self) -> None:
        """The timeout has to be enforced by `run`, not by a test calling the check.

        `timeout_seconds` is threaded through both analyzer and eval dispatch,
        but the only background loop called `reap()` with no clock and the check
        ran only when one was supplied. A hung analyzer therefore held its
        per-scope job slot and its OS-backed scope lease until the server was
        restarted. Only the clock is faked here; the failure has to come out of
        the loop the HTTP surface starts.
        """
        store = self.enable()
        profile = store.profile()
        profile["analyzer_client"] = "claude"
        store.put_profile(profile, profile["revision"])

        class Process:
            """An analyzer that never exits until its tree is stopped."""

            def __init__(self) -> None:
                self.stdout = io.BytesIO(b"")
                self.code = None
                self.terminated = False

            def poll(self):
                return self.code

            def terminate(self):
                self.terminated = True
                self.code = -15

            def wait(self, timeout=None):  # noqa: ARG002
                return self.code

        runtime = improvements_integration.ImprovementsRuntime()
        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        job = runtime.queue_analysis(self.primary, "personal", "manual")
        identifier = f"personal:analysis:{job['id']}"
        temp_paths = list(runtime._bindings[identifier]["temp_paths"])
        self.assertEqual("running", store.jobs()[0]["state"])
        # Past the 900-second analyzer timeout, and nothing else is stubbed.
        runtime._supervisor._monotonic = lambda: time.monotonic() + 901.0
        loop = threading.Thread(target=runtime.run, args=(self.primary, 0.01), daemon=True)
        loop.start()
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and store.jobs()[0]["state"] == "running":
                time.sleep(0.02)
        finally:
            runtime.stop()
            loop.join(timeout=10)
        persisted = store.jobs()[0]
        self.assertEqual("failed", persisted["state"], persisted)
        self.assertEqual("timeout", persisted["error_code"], persisted)
        self.assertTrue(process.terminated, "the hung process tree was left running")
        self.assertNotIn(identifier, runtime._bindings)
        self.assertEqual({}, runtime._scope_leases, "the scope lease outlived the job")
        self.assertTrue(all(not os.path.exists(path) for path in temp_paths))

    def test_eval_result_handler_completes_atomically_and_replays_without_duplicates(self) -> None:
        store, case = self.open_case()
        case = store.save_proposal(
            case["id"],
            {"targets": ["validator-eval"]},
            {
                "version": "1",
                "assertions": [
                    {
                        "name": "baseline-failure",
                        "type": "command_exit",
                        "required": True,
                        "baseline_failure": True,
                        "argv": ["python", "-m", "unittest"],
                    }
                ],
            },
            case["revision"],
        )
        job = store.create_job(
            "eval",
            recipe_id="improvements.eval.v1",
            case_id=case["id"],
            phase="baseline",
            repo=os.path.abspath(self.tmp.name),
            git_ref="a" * 40,
        )
        request = store.load_job_request(job["id"])["request"]
        result = {
            "interface_version": "improvements-api",
            "job_id": str(job["id"]),
            "phase": "baseline",
            "pack_version": request["pack_version"],
            "pack_hash": request["pack_hash"],
            "git_ref": request["git_ref"],
            "patch_hash": "b" * 64,
            "assertions": [
                {
                    "name": "baseline-failure",
                    "type": "command_exit",
                    "required": True,
                    "baseline_failure": True,
                    "passed": False,
                }
            ],
            "passed": False,
            "baseline_failure_designated": True,
            "infrastructure_failure": False,
            "reproduced_failure": True,
            "safety_regressions": [],
            "guard_regressions": [],
            "error_code": "",
            "cleanup_verified": True,
            "source_unchanged": True,
            "registrations_unchanged": True,
            "refs_unchanged": True,
        }

        class Process:
            def __init__(self) -> None:
                self.stdout = io.BytesIO(json.dumps(result).encode("utf-8"))
                self.code = None

            def poll(self):
                return self.code

            def finish(self):
                self.code = 0

        runtime = improvements_integration.ImprovementsRuntime()
        process = Process()
        runtime._supervisor._spawn = lambda *_args: process
        runtime._dispatch_eval(self.primary, store, job)
        identifier = f"personal:eval:{job['id']}"
        process.finish()
        runtime.reap()
        self.assertEqual("succeeded", store.jobs()[0]["state"])
        self.assertEqual(1, len(store.case(case["id"])["eval_runs"]))
        handler = runtime._supervisor._jobs[identifier].result_handler
        first = handler(result, runtime._supervisor._jobs[identifier])
        second = handler(result, runtime._supervisor._jobs[identifier])
        self.assertEqual(first, second)
        self.assertEqual(1, len(store.case(case["id"])["eval_runs"]))
        with self.assertRaises(improvements.ImprovementError) as conflict:
            handler(result | {"patch_hash": "c" * 64}, runtime._supervisor._jobs[identifier])
        self.assertEqual("eval_result_conflict", conflict.exception.code)


if __name__ == "__main__":
    unittest.main()
