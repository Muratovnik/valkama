import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server.improvements import contract, improvements, sanitization, sidecar_schema
from server.platform import modules as platform_modules


def iso(days=0, hours=0):
    return (
        (datetime.now(UTC) + timedelta(days=days, hours=hours)).isoformat().replace("+00:00", "Z")
    )


class ImprovementsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "valkama.sqlite3"
        self.store = improvements.ImprovementStore(self.db, "personal")

    def tearDown(self):
        self.tmp.cleanup()

    def enable(self, **changes):
        values = improvements.default_profile("personal")
        values.update(
            {
                "enabled": True,
                "purpose": "Improve agent reliability",
                "expected_behavior": "Repeated workflow failures stop recurring",
                "planning_space": "AW",
            }
        )
        values.update(changes)
        return self.store.put_profile(values, 0)

    def signal(
        self,
        session,
        number,
        severity="high",
        text="Validator omitted required rollback check",
        **extra,
    ):
        raw = {
            "pointer": f"session:{session}/event:{number}",
            "at": iso(),
            "client": "codex",
            "session_id": session,
            "event_type": "validation_failed",
            "severity": severity,
            "excerpt": text,
        } | extra
        return self.store.record_signal("validator-eval", raw)

    def open_case(self):
        self.enable()
        self.signal("a", 1)
        self.signal("b", 2)
        return self.signal("a", 3)

    @staticmethod
    def eval_pack(assertion_name="required"):
        return {
            "scenarios": [],
            "assertions": [
                {
                    "name": assertion_name,
                    "type": "command_exit",
                    "command": ["python", "-c", "raise SystemExit(0)"],
                    "expected": 0,
                    "required": True,
                }
            ],
            "provenance": {},
            "failure_examples": [],
            "negative_control": None,
        }

    def eval_result(self, job_id, phase, *, patch_hash="c" * 64):
        request = self.store.load_job_request(job_id)["request"]
        assertions = [
            {
                "scenario": "scenario",
                "name": "required",
                "type": "command_exit",
                "required": True,
                "passed": True,
                "expected": 0,
                "observed": 0,
            }
        ]
        if phase == "baseline":
            assertions = [
                {
                    "scenario": "scenario",
                    "name": "required",
                    "type": "command_exit",
                    "required": True,
                    "baseline_failure": True,
                    "passed": False,
                    "expected": 1,
                    "observed": 0,
                }
            ]
        return {
            "interface_version": "improvements-api",
            "job_id": str(job_id),
            "phase": phase,
            "pack_version": request["pack_version"],
            "pack_hash": request["pack_hash"],
            "git_ref": request["git_ref"],
            "patch_hash": patch_hash,
            "assertions": assertions,
            "passed": phase == "candidate",
            "baseline_failure_designated": phase == "baseline",
            "infrastructure_failure": False,
            "reproduced_failure": phase == "baseline",
            "safety_regressions": [],
            "guard_regressions": [],
            "error_code": "",
            "cleanup_verified": True,
            "source_unchanged": True,
            "registrations_unchanged": True,
            "refs_unchanged": True,
        }

    def test_registry_is_exact_static_and_fresh(self):
        one = platform_modules.modules_payload()
        self.assertEqual("valkama-modules", one["interface_version"])
        self.assertEqual(
            ["planning", "sessions", "analytics", "improvements", "skills", "memory", "settings"],
            [item["module_id"] for item in one["modules"]],
        )
        self.assertTrue(
            all(item["interface_version"] == "valkama-modules" for item in one["modules"])
        )
        self.assertTrue(
            all(item["operating_levels"] == ["global", "project"] for item in one["modules"])
        )
        one["modules"].clear()
        self.assertEqual(7, len(platform_modules.modules_payload()["modules"]))

    def test_registry_declares_project_improvements_as_typed_unsupported(self):
        manifest = next(
            item
            for item in platform_modules.module_manifests()
            if item["module_id"] == "improvements"
        )
        self.assertEqual([], manifest["semantics"]["project"]["read_models"])
        self.assertEqual([], manifest["semantics"]["project"]["action_semantics"])
        self.assertEqual("unavailable", manifest["secondary_context"]["project"]["behavior"])
        self.assertEqual(["unavailable"], manifest["states"]["project"]["supported"])
        self.assertEqual(
            "improvements_project_scope_unsupported",
            manifest["states"]["project"]["unsupported_reason"],
        )

    def test_disabled_reads_and_disabled_noop_write_create_nothing(self):
        expected = improvements.sidecar_path(self.db)
        self.assertFalse(self.store.profile()["enabled"])
        self.assertEqual([], self.store.cases())
        values = improvements.default_profile("personal")
        self.assertFalse(self.store.put_profile(values, 0)["enabled"])
        self.assertFalse(expected.parent.exists())
        self.assertFalse(Path(str(expected) + ".maintenance.lock").exists())

    def test_enable_validation_revision_and_fixed_targets(self):
        with self.assertRaisesRegex(improvements.ImprovementError, "requires purpose"):
            self.store.put_profile({"enabled": True}, 0)
        profile = self.enable()
        self.assertEqual(1, profile["revision"])
        self.assertEqual("improvements-api", profile["interface_version"])
        with self.assertRaisesRegex(improvements.ImprovementError, "stale") as conflict:
            self.store.put_profile(profile, 0)
        self.assertEqual(409, conflict.exception.status)
        profile["allowed_targets"] = ["product-code"]
        with self.assertRaisesRegex(improvements.ImprovementError, "product-code"):
            self.store.put_profile(profile, 1)

    def test_profile_persists_bounded_analyzer_model_and_reasoning_effort(self):
        profile = self.enable(
            analyzer_model="gpt-5.6-sol",
            reasoning_effort="high",
        )
        self.assertEqual("gpt-5.6-sol", profile["analyzer_model"])
        self.assertEqual("high", profile["reasoning_effort"])
        self.assertEqual(
            ("gpt-5.6-sol", "high"),
            (self.store.profile()["analyzer_model"], self.store.profile()["reasoning_effort"]),
        )

        for field, value in (
            ("analyzer_model", "x" * (improvements.MAX_ANALYZER_MODEL + 1)),
            ("reasoning_effort", "turbo"),
        ):
            candidate = dict(profile)
            candidate[field] = value
            with self.subTest(field=field), self.assertRaises(improvements.ImprovementError):
                self.store.put_profile(candidate, profile["revision"])

    def test_profile_numeric_limits_are_integer_and_finitely_bounded(self):
        profile = self.enable()
        changes = (
            ("schedule", "interval_hours", improvements.MAX_INTERVAL_HOURS + 1),
            ("limits", "lookback_days", improvements.MAX_LOOKBACK_DAYS + 1),
            ("limits", "max_sessions", improvements.MAX_SESSIONS + 1),
            ("limits", "max_chars", improvements.MAX_CHARS + 1),
            ("limits", "max_sessions", 1.5),
        )
        for section, field, value in changes:
            candidate = json.loads(json.dumps(profile))
            candidate[section][field] = value
            with (
                self.subTest(field=field, value=value),
                self.assertRaises(improvements.ImprovementError),
            ):
                self.store.put_profile(candidate, profile["revision"])
        self.assertEqual(profile["revision"], self.store.profile()["revision"])

    def test_profile_prompt_text_and_space_are_finitely_bounded(self):
        profile = self.enable()
        for field, value in (
            ("purpose", "p" * (improvements.MAX_PROFILE_TEXT + 1)),
            ("expected_behavior", "e" * (improvements.MAX_PROFILE_TEXT + 1)),
            ("planning_space", "b" * (improvements.MAX_PLANNING_SPACE + 1)),
        ):
            candidate = dict(profile)
            candidate[field] = value
            with (
                self.subTest(field=field),
                self.assertRaises(improvements.ImprovementError) as caught,
            ):
                self.store.put_profile(candidate, profile["revision"])
            self.assertEqual("invalid_profile", caught.exception.code)
        self.assertEqual(profile["revision"], self.store.profile()["revision"])

    def test_the_store_imports_on_its_own_in_a_fresh_interpreter(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from server.improvements import improvements; print(improvements.API_VERSION)",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(
            (0, "improvements-api"), (result.returncode, result.stdout.strip()), result.stderr
        )

    def test_sidecars_are_isolated_by_same_directory_database_stem_and_scope(self):
        self.enable()
        other = improvements.ImprovementStore(Path(self.tmp.name) / "work.sqlite3", "work")
        values = improvements.default_profile("work") | {
            "enabled": True,
            "purpose": "p",
            "expected_behavior": "e",
            "planning_space": "B",
        }
        other.put_profile(values, 0)
        self.assertNotEqual(self.store.path, other.path)
        self.assertTrue(self.store.path.exists() and other.path.exists())
        wrong = improvements.ImprovementStore(self.db, "work")
        with self.assertRaisesRegex(improvements.ImprovementError, "another scope") as mismatch:
            wrong.profile()
        self.assertEqual(404, mismatch.exception.status)

    def test_fresh_migration_is_idempotent_and_has_acknowledgement(self):
        self.enable()
        self.assertIsNone(sidecar_schema.migrate_sidecar(self.store.path))
        conn = sqlite3.connect(self.store.path)
        self.assertEqual(
            sidecar_schema.SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(profile)")}
        self.assertTrue({"analyzer_model", "reasoning_effort"} <= columns)
        self.assertEqual(
            {"improvements-api", "improvements-store", "improvements-events"},
            {contract.API_VERSION, contract.STORE_VERSION, contract.EVENTS_VERSION},
        )
        conn.close()

    def test_populated_store_upgrade_snapshots_and_rollback_restores_data(self):
        path = improvements.sidecar_path(self.db)
        path.parent.mkdir(parents=True)
        conn = sqlite3.connect(path)
        conn.executescript(sidecar_schema.BASE_SQL + "PRAGMA user_version=1;")
        conn.execute(
            "INSERT INTO profile VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("personal", 1, 1, "p", "e", "codex", "B", "manual", 24, 30, 20, 60000, iso(), iso()),
        )
        conn.commit()
        conn.close()
        backup = sidecar_schema.migrate_sidecar(path)
        self.assertTrue(backup and backup.exists())
        check = sqlite3.connect(path)
        self.assertTrue(check.execute("SELECT 1 FROM negative_examples").fetchone() is None)
        check.close()
        sidecar_schema.restore_sidecar_backup(path, backup)
        restored = sqlite3.connect(path)
        self.assertEqual(1, restored.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual("p", restored.execute("SELECT purpose FROM profile").fetchone()[0])
        with self.assertRaises(sqlite3.OperationalError):
            restored.execute("SELECT * FROM negative_examples")
        restored.close()

    def test_upgrade_fault_rolls_back_and_keeps_snapshot(self):
        path = improvements.sidecar_path(self.db)
        path.parent.mkdir(parents=True)
        conn = sqlite3.connect(path)
        conn.executescript(sidecar_schema.BASE_SQL + "PRAGMA user_version=1;")
        conn.close()

        def fail(phase):
            if phase == "during_evaluation_ledger":
                raise RuntimeError("injected migration crash")

        with self.assertRaisesRegex(RuntimeError, "injected"):
            sidecar_schema.migrate_sidecar(path, fail)
        check = sqlite3.connect(path)
        self.assertEqual(1, check.execute("PRAGMA user_version").fetchone()[0])
        self.assertFalse(
            check.execute("SELECT 1 FROM sqlite_master WHERE name='negative_examples'").fetchone()
        )
        self.assertFalse(
            check.execute(
                "SELECT 1 FROM sqlite_master WHERE name='analyzer_applications'"
            ).fetchone()
        )
        check.close()
        self.assertEqual(1, len(list((path.parent / "backups").glob("*.sqlite3"))))

    def test_evidence_is_redacted_bounded_hashed_and_whitelisted(self):
        secret = "sk-abcdefghijk password=hunter2\x00 Bearer abcdefghijklmnopqrstuvwxyz " + (
            "x" * 1300
        )
        item = sanitization.evidence_record(
            {
                "pointer": "session:s/event:e",
                "severity": "medium",
                "excerpt": secret,
                "transcript": "must-not-store",
                "prompt": "must-not-store",
                "command": "rm something",
                "tool_result": "private",
            }
        )
        self.assertLessEqual(len(item["excerpt"]), 1200)
        self.assertNotIn("hunter2", item["excerpt"])
        self.assertNotIn("sk-abcdefghijk", item["excerpt"])
        self.assertNotIn("\x00", item["excerpt"])
        self.assertEqual(hashlib.sha256(item["excerpt"].encode()).hexdigest(), item["source_hash"])
        self.assertFalse({"transcript", "prompt", "command", "tool_result"} & set(item))

    def test_fingerprint_is_deterministic_and_category_bound(self):
        a = {
            "event_type": "tool_end",
            "excerpt": "Failed request 123 at 550e8400-e29b-41d4-a716-446655440000",
        }
        b = {
            "event_type": "tool_end",
            "excerpt": "Failed request 999 at 550e8400-e29b-41d4-a716-446655440001",
        }
        self.assertEqual(
            sanitization.deterministic_fingerprint("tool-contract", a),
            sanitization.deterministic_fingerprint("tool-contract", b),
        )
        self.assertNotEqual(
            sanitization.deterministic_fingerprint("skill", a),
            sanitization.deterministic_fingerprint("tool-contract", a),
        )
        with self.assertRaisesRegex(improvements.ImprovementError, "product-code"):
            sanitization.deterministic_fingerprint("product-code", a)

    def test_promotion_requires_all_frozen_thresholds(self):
        self.enable()
        first = self.signal("a", 1, "medium")
        self.assertEqual("collecting", first["state"])
        second = self.signal("b", 2, "medium")
        self.assertEqual("collecting", second["state"])
        promoted = self.signal("a", 3, "high")
        self.assertEqual("open", promoted["state"])
        self.assertEqual(3, promoted["signal_count"])
        self.assertEqual(2, promoted["session_count"])
        stale_db = Path(self.tmp.name) / "stale.sqlite3"
        stale = improvements.ImprovementStore(stale_db, "stale")
        vals = improvements.default_profile("stale") | {
            "enabled": True,
            "purpose": "p",
            "expected_behavior": "e",
            "planning_space": "B",
        }
        stale.put_profile(vals, 0)
        for i, session in enumerate(("a", "b", "a")):
            stale.record_signal(
                "validator-eval",
                {
                    "pointer": f"session:{session}/event:{i}",
                    "at": iso(-15),
                    "client": "codex",
                    "session_id": session,
                    "event_type": "x",
                    "severity": "high",
                    "excerpt": "same",
                },
            )
        self.assertEqual("collecting", stale.cases()[0]["state"])

        blocked_db = Path(self.tmp.name) / "blocked.sqlite3"
        blocked = improvements.ImprovementStore(blocked_db, "blocked")
        vals = improvements.default_profile("blocked") | {
            "enabled": True,
            "purpose": "p",
            "expected_behavior": "e",
            "planning_space": "B",
        }
        blocked.put_profile(vals, 0)
        for i, session in enumerate(("a", "b")):
            held = blocked.record_signal(
                "validator-eval",
                {
                    "pointer": f"session:{session}/event:{i}",
                    "at": iso(),
                    "client": "codex",
                    "session_id": session,
                    "event_type": "x",
                    "severity": "medium",
                    "excerpt": "blocked duplicate",
                },
            )
        conn = sqlite3.connect(blocked.path)
        conn.execute("UPDATE cases SET planning_work_item='EX-99' WHERE id=?", (held["id"],))
        conn.commit()
        conn.close()
        held = blocked.record_signal(
            "validator-eval",
            {
                "pointer": "session:a/event:3",
                "at": iso(),
                "client": "codex",
                "session_id": "a",
                "event_type": "x",
                "severity": "high",
                "excerpt": "blocked duplicate",
            },
        )
        self.assertEqual("collecting", held["state"])

    def test_state_machine_monitoring_effective_and_regressed(self):
        case = self.open_case()
        case = self.store.approve(
            case["id"],
            case["revision"],
            lambda _: {"epic_work_item": 1, "work_item": 2, "created": True},
        )["case"]
        for state in ("implementing", "validating", "resolved"):
            case = self.store.transition(case["id"], state)
        start = iso(-31)
        self.store.start_monitoring(case["id"], 0.4, start)
        case = self.store.observe(case["id"], matched=False, at=iso())
        self.assertEqual("effective", case["state"])
        case = self.store.observe(case["id"], matched=True, severity="critical", at=iso(hours=1))
        self.assertEqual("regressed", case["state"])
        case = self.store.action(case["id"], "reopen", case["revision"])
        self.assertEqual("open", case["state"])
        with self.assertRaisesRegex(improvements.ImprovementError, "cannot transition"):
            self.store.transition(case["id"], "effective")

    def test_ten_session_effectiveness_and_two_match_regression(self):
        case = self.open_case()
        case = self.store.transition(case["id"], "watching")
        case = self.store.transition(case["id"], "open")
        case = self.store.approve(
            case["id"], case["revision"], lambda _: {"epic_work_item": 1, "work_item": 3}
        )["case"]
        for state in ("implementing", "validating", "resolved"):
            case = self.store.transition(case["id"], state)
        self.store.start_monitoring(case["id"], 0.4)
        for n in range(10):
            case = self.store.observe(
                case["id"], matched=(n == 0), severity="low" if n == 0 else None, at=iso(hours=n)
            )
        self.assertEqual("effective", case["state"])

        other_db = Path(self.tmp.name) / "regress.sqlite3"
        other = improvements.ImprovementStore(other_db, "regress")
        vals = improvements.default_profile("regress") | {
            "enabled": True,
            "purpose": "p",
            "expected_behavior": "e",
            "planning_space": "B",
        }
        other.put_profile(vals, 0)
        case = None
        for i, s in enumerate(("a", "b", "a")):
            case = other.record_signal(
                "skill",
                {
                    "pointer": f"session:{s}/event:{i}",
                    "at": iso(),
                    "client": "codex",
                    "session_id": s,
                    "event_type": "x",
                    "severity": "high",
                    "excerpt": "repeat",
                },
            )
        case = other.transition(case["id"], "watching")
        case = other.transition(case["id"], "open")
        case = other.approve(
            case["id"], case["revision"], lambda _: {"epic_work_item": 1, "work_item": 4}
        )["case"]
        for state in ("implementing", "validating", "resolved"):
            case = other.transition(case["id"], state)
        other.start_monitoring(case["id"], 0.5)
        case = other.observe(case["id"], matched=True, severity="low", at=iso())
        self.assertEqual("resolved", case["state"])
        case = other.observe(case["id"], matched=True, severity="low", at=iso(hours=1))
        self.assertEqual("regressed", case["state"])

    def test_manual_split_merge_and_false_positive_negative_example_persist(self):
        case = self.open_case()
        split_signal = case["evidence"][0]["id"]
        case = self.store.action(case["id"], "split", case["revision"], signal_ids=[split_signal])
        self.assertEqual(2, len(self.store.cases()))
        new_case = next(c for c in self.store.cases() if c["id"] != case["id"])
        merged = self.store.action(
            new_case["id"], "merge", new_case["revision"], target_case_id=case["id"]
        )
        self.assertEqual("false_positive", merged["state"])
        case = self.store.case(case["id"])
        case = self.store.action(
            case["id"], "false_positive", case["revision"], reason="expected correction"
        )
        reopened = improvements.ImprovementStore(self.db, "personal")
        self.assertEqual("false_positive", reopened.case(case["id"])["state"])
        conn = sqlite3.connect(self.store.path)
        self.assertEqual(
            "expected correction",
            conn.execute(
                "SELECT reason FROM negative_examples WHERE case_id=?", (case["id"],)
            ).fetchone()[0],
        )
        self.assertEqual(
            {"merge", "split"}, {r[0] for r in conn.execute("SELECT kind FROM manual_groups")}
        )
        conn.close()

    def test_proposal_pack_eval_persistence_and_product_code_rejection(self):
        case = self.open_case()
        with self.assertRaisesRegex(improvements.ImprovementError, "workflow surfaces"):
            self.store.save_proposal(
                case["id"], {"targets": ["product-code"]}, {}, case["revision"]
            )
        case = self.store.save_proposal(
            case["id"],
            {"targets": ["instructions"], "recommended_change": "Clarify"},
            self.eval_pack(),
            case["revision"],
        )
        job = self.store.create_job(
            "eval", case_id=case["id"], phase="baseline", repo="repo", git_ref="a" * 40
        )
        self.store.update_job(job["id"], "running")
        self.store.update_job(job["id"], "succeeded")
        run = self.store.record_eval_run(
            case["id"],
            "baseline",
            "repo",
            "a" * 40,
            self.eval_result(job["id"], "baseline"),
            job_id=job["id"],
        )
        self.assertEqual("a" * 40, run["git_ref"])
        persisted = improvements.ImprovementStore(self.db, "personal").case(case["id"])
        self.assertEqual(
            (1, "1"),
            (
                persisted["evaluation_pack"]["pack_revision"],
                persisted["evaluation_pack"]["version"],
            ),
        )
        self.assertEqual(1, len(persisted["eval_runs"]))

    def test_approval_is_normal_exactly_once_no_launch_and_marker_has_no_evidence(self):
        case = self.open_case()
        calls = []

        def ensure(request):
            calls.append(request)
            return {"epic_work_item": "EX-7", "work_item": "EX-8", "created": True}

        result = self.store.approve(case["id"], case["revision"], ensure)
        again = self.store.approve(case["id"], 0, ensure)
        self.assertEqual(1, len(calls))
        self.assertTrue(result["created"])
        self.assertFalse(result["launched"])
        self.assertFalse(again["created"])
        self.assertEqual("EX-8", again["work_item"])
        serialized = json.dumps(calls[0])
        self.assertIn("improvement://planning/", calls[0]["epic_source"])
        self.assertEqual(f"improvement://personal/{case['case_key']}", calls[0]["work_source"])
        for forbidden in ("evidence", "fingerprint", "excerpt", "launch"):
            self.assertNotIn(forbidden, serialized.lower())

    def test_approval_crash_retry_reconciles_by_exact_source(self):
        case = self.open_case()
        items = {}
        creations = 0
        calls = 0

        def ensure(request):
            nonlocal creations, calls
            calls += 1
            if request["work_source"] not in items:
                items[request["work_source"]] = ("EX-11", "EX-12")
                creations += 1
                created = True
            else:
                created = False
            epic, work = items[request["work_source"]]
            return {"epic_work_item": epic, "work_item": work, "created": created}

        def crash(phase):
            if phase == "after_ensure":
                raise RuntimeError("injected approval crash")

        with self.assertRaisesRegex(RuntimeError, "injected"):
            self.store.approve(case["id"], case["revision"], ensure, crash)
        recovered = self.store.approve(case["id"], case["revision"], ensure)
        self.assertEqual((2, 1), (calls, creations))
        self.assertEqual("EX-12", recovered["work_item"])
        self.assertFalse(recovered["created"])

    def test_eval_guard_matrix(self):
        case = self.open_case()
        case = self.store.save_proposal(
            case["id"], {"targets": ["validator-eval"]}, self.eval_pack(), case["revision"]
        )
        case = self.store.approve(
            case["id"], case["revision"], lambda _: {"epic_work_item": "EX-1", "work_item": "EX-2"}
        )["case"]

        def finished_eval_job(phase, git_ref):
            job = self.store.create_job(
                "eval", case_id=case["id"], phase=phase, repo="repo", git_ref=git_ref
            )
            self.store.update_job(job["id"], "running")
            self.store.update_job(job["id"], "succeeded")
            return job["id"]

        baseline_job = finished_eval_job("baseline", "a" * 40)
        baseline = self.store.record_eval_run(
            case["id"],
            "baseline",
            "repo",
            "a" * 40,
            self.eval_result(baseline_job, "baseline"),
            job_id=baseline_job,
        )
        same_ref_job = finished_eval_job("candidate", "a" * 40)
        self.store.record_eval_run(
            case["id"],
            "candidate",
            "repo",
            "a" * 40,
            self.eval_result(same_ref_job, "candidate", patch_hash="b" * 64),
            job_id=same_ref_job,
        )
        self.assertFalse(self.store.eval_guard(case["id"], "high")["allowed"])
        same_patch_job = finished_eval_job("candidate", "b" * 40)
        self.store.record_eval_run(
            case["id"],
            "candidate",
            "repo",
            "b" * 40,
            self.eval_result(same_patch_job, "candidate", patch_hash="c" * 64),
            job_id=same_patch_job,
        )
        self.assertFalse(self.store.eval_guard(case["id"], "high")["allowed"])
        candidate_job = finished_eval_job("candidate", "b" * 40)
        candidate = self.store.record_eval_run(
            case["id"],
            "candidate",
            "repo",
            "b" * 40,
            self.eval_result(candidate_job, "candidate", patch_hash="b" * 64),
            patch_hash="b" * 64,
            job_id=candidate_job,
        )
        for severity in ("medium", "high"):
            self.assertTrue(self.store.eval_guard(case["id"], severity)["allowed"])
        pack = self.store.case(case["id"])["evaluation_pack"]
        self.assertFalse(
            improvements.improvement_eval_guard(
                "high",
                [baseline, candidate],
                case_id=999,
                evaluation_pack_version=pack["pack_revision"],
                evaluation_pack_hash=pack["pack_hash"],
            )["allowed"]
        )
        self.assertFalse(
            improvements.improvement_eval_guard("low", [], monitoring_started=True)["allowed"]
        )
        self.assertTrue(
            improvements.improvement_eval_guard(
                "low", [], monitoring_started=True, closing_summary="done and monitored"
            )["allowed"]
        )
        forced = improvements.improvement_eval_guard("high", [], force=True)
        self.assertTrue(forced["allowed"] and forced["overridden"])

    def test_schedule_opt_in_jobs_conflict_and_restart_recovery(self):
        self.enable()
        with self.assertRaisesRegex(improvements.ImprovementError, "opt-in"):
            self.store.create_job(trigger="scheduled")
        first = self.store.create_job()
        with self.assertRaises(improvements.ImprovementError) as conflict:
            self.store.create_job()
        self.assertEqual(409, conflict.exception.status)
        self.store.update_job(first["id"], "running")
        self.assertEqual(1, self.store.recover_jobs())
        conn = sqlite3.connect(self.store.path)
        self.assertEqual(
            "platform_restarted",
            conn.execute("SELECT error_code FROM jobs WHERE id=?", (first["id"],)).fetchone()[0],
        )
        conn.close()
        scheduled_db = Path(self.tmp.name) / "scheduled.sqlite3"
        scheduled = improvements.ImprovementStore(scheduled_db, "scheduled")
        vals = improvements.default_profile("scheduled") | {
            "enabled": True,
            "purpose": "p",
            "expected_behavior": "e",
            "planning_space": "B",
            "schedule": {"mode": "scheduled", "interval_hours": 12},
        }
        scheduled.put_profile(vals, 0)
        self.assertEqual("queued", scheduled.create_job(trigger="scheduled")["state"])

    def test_profile_get_does_not_migrate_but_explicit_write_does_with_backup(self):
        path = improvements.sidecar_path(self.db)
        path.parent.mkdir(parents=True)
        conn = sqlite3.connect(path)
        conn.executescript(sidecar_schema.BASE_SQL + "PRAGMA user_version=1;")
        conn.execute(
            "INSERT INTO profile VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "personal",
                1,
                1,
                "old",
                "behavior",
                "codex",
                "Board",
                "manual",
                24,
                30,
                20,
                60000,
                iso(),
                iso(),
            ),
        )
        conn.commit()
        conn.close()
        # A read brings a behind-version sidecar forward, and this is a changed
        # decision: it used not to, on the argument that a GET should not mutate
        # a store. What that left was a store this build cannot read correctly —
        # step 7 renamed the case columns, and a read of an older store raised
        # `IndexError` looking for a column it has never had. The old version of
        # this test missed it by reading a store with no cases, where the
        # comprehension never touches a column.
        profile = self.store.profile()
        self.assertEqual("old", profile["purpose"])
        self.assertEqual([], self.store.cases())
        self.assertEqual("improvements-api", self.store.read_model()["interface_version"])
        check = sqlite3.connect(path)
        self.assertEqual(
            sidecar_schema.SCHEMA_VERSION, check.execute("PRAGMA user_version").fetchone()[0]
        )
        check.close()
        # And it snapshotted first, the way every migration here does.
        self.assertEqual(
            1, len(list((path.parent / "backups").glob("improvements-preupgrade-*.sqlite3")))
        )
        profile["purpose"] = "written"
        updated = self.store.put_profile(profile, 1)
        check = sqlite3.connect(path)
        self.assertEqual(
            sidecar_schema.SCHEMA_VERSION, check.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertTrue(
            check.execute(
                "SELECT 1 FROM sqlite_master WHERE name='analyzer_applications'"
            ).fetchone()
        )
        self.assertIn("recipe_id", {row[1] for row in check.execute("PRAGMA table_info(jobs)")})
        check.close()
        self.assertEqual(2, updated["revision"])
        # Still one: the store was already current by the time the write ran, so
        # nothing migrated again. A read of a current store writes nothing.
        self.assertEqual(
            1, len(list((path.parent / "backups").glob("improvements-preupgrade-*.sqlite3")))
        )

    def test_a_read_of_an_old_store_with_cases_answers_them(self):
        """The failure the version-1 case above could not see.

        That one reads a store with no cases, so the comprehension never touches
        a renamed column and the bug hides. The owner's store had six, and its
        case list answered `invalid_request: No item with that key` instead.

        Built as a real old store rather than a current one with its version
        rewritten: the columns are what make it old, and a version number that
        disagrees with its own schema is a state no installation is ever in.
        """

        path = improvements.sidecar_path(self.db)
        path.parent.mkdir(parents=True)
        # Closed explicitly: `with` on a connection is a transaction context and
        # not a resource one, and one left open holds the file on Windows.
        conn = sqlite3.connect(path)
        try:
            conn.executescript(sidecar_schema.BASE_SQL + "PRAGMA user_version=1;")
            conn.execute(
                "INSERT INTO cases(case_key,fingerprint,title,state,severity,category,"
                "first_seen,last_seen,trend,planning_card_id,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "case-1",
                    "f" * 64,
                    "An old case",
                    "open",
                    "medium",
                    "workflow",
                    iso(),
                    iso(),
                    "steady",
                    None,
                    iso(),
                    iso(),
                ),
            )
            conn.commit()
        finally:
            conn.close()

        answered = improvements.ImprovementStore(self.db, "personal").cases()
        self.assertEqual(["An old case"], [item["title"] for item in answered])
        self.assertIsNone(answered[0]["planning_work_item"])

    def test_pending_approval_gates_actions_and_retry_preserves_revision(self):
        case = self.open_case()
        calls = 0
        items = {}

        def ensure(request):
            nonlocal calls
            calls += 1
            items.setdefault(request["work_source"], ("EX-21", "EX-22"))
            return {
                "epic_work_item": items[request["work_source"]][0],
                "work_item": items[request["work_source"]][1],
            }

        def crash(phase):
            if phase == "after_ensure":
                raise RuntimeError("crash")

        with self.assertRaises(RuntimeError):
            self.store.approve(case["id"], case["revision"], ensure, crash)
        pending = self.store.case(case["id"])
        pending_revision = pending["revision"]
        self.assertEqual("approved", pending["state"])
        with self.assertRaises(improvements.ImprovementError) as ingestion:
            self.signal("c", 4)
        self.assertEqual("approval_pending", ingestion.exception.code)
        with self.assertRaises(improvements.ImprovementError) as proposal:
            self.store.save_proposal(
                case["id"],
                {"targets": ["instructions"]},
                {"assertions": [{"id": "a"}]},
                pending_revision,
            )
        self.assertEqual("approval_pending", proposal.exception.code)
        unchanged = self.store.case(case["id"])
        self.assertEqual(
            (pending_revision, len(pending["evidence"]), None),
            (unchanged["revision"], len(unchanged["evidence"]), unchanged["proposal"]),
        )
        for action, kwargs in (
            ("merge", {}),
            ("split", {"signal_ids": [pending["evidence"][0]["id"]]}),
            ("false_positive", {"reason": "no"}),
            ("snooze", {"reason": "later", "snooze_until": iso(1)}),
            ("watch", {}),
            ("reopen", {}),
        ):
            with self.assertRaises(improvements.ImprovementError) as blocked:
                self.store.action(case["id"], action, pending_revision, **kwargs)
            self.assertEqual("approval_pending", blocked.exception.code)
        with self.assertRaises(improvements.ImprovementError) as transition:
            self.store.transition(case["id"], "implementing")
        self.assertEqual("approval_pending", transition.exception.code)
        recovered = self.store.approve(case["id"], case["revision"], ensure)
        self.assertEqual(pending_revision, recovered["case"]["revision"])
        self.assertEqual(2, calls)
        self.store.approve(case["id"], 0, ensure)
        self.assertEqual(2, calls)
        linked = recovered["case"]
        for action, kwargs in (
            ("merge", {}),
            ("split", {"signal_ids": [linked["evidence"][0]["id"]]}),
            ("false_positive", {"reason": "hide"}),
            ("snooze", {"reason": "hide", "snooze_until": iso(1)}),
        ):
            with self.assertRaises(improvements.ImprovementError) as blocked:
                self.store.action(case["id"], action, linked["revision"], **kwargs)
            self.assertEqual("planning_linked", blocked.exception.code)

    def test_split_and_merge_recompute_aggregates_and_revisions(self):
        self.enable()
        moments = (iso(-3), iso(-2), iso(-1))
        severities = ("critical", "low", "medium")
        case = None
        for n, (at, severity) in enumerate(zip(moments, severities, strict=False)):
            case = self.store.record_signal(
                "skill",
                {
                    "pointer": f"session:{'a' if n != 1 else 'b'}/event:{n}",
                    "at": at,
                    "client": "codex",
                    "session_id": "a" if n != 1 else "b",
                    "event_type": "failure",
                    "severity": severity,
                    "excerpt": "same failure",
                },
            )
        before_revision = case["revision"]
        critical_id = next(
            item["id"] for item in case["evidence"] if item["severity"] == "critical"
        )
        source = self.store.action(case["id"], "split", before_revision, signal_ids=[critical_id])
        split = next(item for item in self.store.cases() if item["id"] != source["id"])
        self.assertGreater(source["revision"], before_revision)
        self.assertEqual(
            (moments[1], moments[2], "medium"),
            (source["first_seen"], source["last_seen"], source["severity"]),
        )
        self.assertEqual(
            (moments[0], moments[0], "critical"),
            (split["first_seen"], split["last_seen"], split["severity"]),
        )
        split_before = split["revision"]
        target_before = source["revision"]
        self.store.action(split["id"], "merge", split_before, target_case_id=source["id"])
        merged_source, target = self.store.case(split["id"]), self.store.case(source["id"])
        self.assertGreater(merged_source["revision"], split_before)
        self.assertGreater(target["revision"], target_before)
        self.assertEqual(
            (moments[0], moments[2], "critical"),
            (target["first_seen"], target["last_seen"], target["severity"]),
        )

    def test_recursive_privacy_schemas_and_bounded_planning_title(self):
        self.enable()
        title = "api_key=supersecret " + "T" * 400
        case = None
        for n, session in enumerate(("a", "b", "a")):
            case = self.store.record_signal(
                "instructions",
                {
                    "pointer": f"session:{session}/event:{n}",
                    "at": iso(),
                    "client": "codex",
                    "session_id": session,
                    "event_type": "failure",
                    "severity": "high",
                    "excerpt": "same",
                },
                title,
            )
        self.assertLessEqual(len(case["title"]), 200)
        self.assertNotIn("supersecret", case["title"])
        with self.assertRaises(improvements.ImprovementError) as private:
            self.store.save_proposal(
                case["id"],
                {"targets": ["instructions"], "risk": {"prompt": "raw"}},
                {},
                case["revision"],
            )
        self.assertEqual("private_payload", private.exception.code)
        with self.assertRaises(improvements.ImprovementError):
            self.store.save_proposal(
                case["id"],
                {"targets": ["instructions"]},
                {"command": "python unsafe.py"},
                case["revision"],
            )
        case = self.store.save_proposal(
            case["id"],
            {"targets": ["instructions"], "root_cause": "token=verysecret"},
            self.eval_pack(),
            case["revision"],
        )
        encoded = json.dumps(case["evaluation_pack"])
        self.assertNotIn("verysecret", encoded)
        captured = []
        self.store.approve(
            case["id"],
            case["revision"],
            lambda request: captured.append(request) or {"epic_work_item": 1, "work_item": 2},
        )
        self.assertLessEqual(len(captured[0]["title"]), 200)
        self.assertNotIn("supersecret", captured[0]["title"])
        with self.assertRaises(improvements.ImprovementError) as result_private:
            self.store.record_eval_run(
                case["id"], "baseline", "repo", "a" * 40, {"tool_output": "raw"}, job_id=1
            )
        self.assertEqual("invalid_eval", result_private.exception.code)

    def test_eval_guard_rejects_stale_cross_case_pack_and_identity(self):
        case = self.open_case()
        case = self.store.save_proposal(
            case["id"], {"targets": ["validator-eval"]}, self.eval_pack(), case["revision"]
        )
        case = self.store.approve(
            case["id"], case["revision"], lambda _: {"epic_work_item": "EX-1", "work_item": "EX-2"}
        )["case"]

        def job(phase, git_ref):
            item = self.store.create_job(
                "eval", case_id=case["id"], phase=phase, repo="repo", git_ref=git_ref
            )
            self.store.update_job(item["id"], "running")
            self.store.update_job(item["id"], "succeeded")
            return item["id"]

        baseline_job = job("baseline", "a" * 40)
        self.store.record_eval_run(
            case["id"],
            "baseline",
            "repo",
            "a" * 40,
            self.eval_result(baseline_job, "baseline"),
            job_id=baseline_job,
        )
        candidate_job = job("candidate", "b" * 40)
        self.store.record_eval_run(
            case["id"],
            "candidate",
            "repo",
            "b" * 40,
            self.eval_result(candidate_job, "candidate", patch_hash="b" * 64),
            patch_hash="b" * 64,
            job_id=candidate_job,
        )
        detail = self.store.case(case["id"])
        pack = detail["evaluation_pack"]
        runs = detail["eval_runs"]
        kwargs = {
            "case_id": case["id"],
            "evaluation_pack_version": pack["pack_revision"],
            "evaluation_pack_hash": pack["pack_hash"],
        }
        self.assertTrue(self.store.eval_guard(case["id"], "high")["allowed"])
        self.assertFalse(improvements.improvement_eval_guard("high", runs, **kwargs)["allowed"])
        verified = kwargs | {"_persisted_run_ids": frozenset(run["id"] for run in runs)}
        self.assertTrue(improvements.improvement_eval_guard("high", runs, **verified)["allowed"])
        tampered = [dict(run) for run in runs]
        tampered[0]["run_identity"] = "0" * 64
        self.assertFalse(
            improvements.improvement_eval_guard("high", tampered, **verified)["allowed"]
        )
        self.assertFalse(
            improvements.improvement_eval_guard(
                "high", runs, **(verified | {"case_id": case["id"] + 1})
            )["allowed"]
        )
        self.assertFalse(
            improvements.improvement_eval_guard(
                "high", runs, **(verified | {"evaluation_pack_hash": "f" * 64})
            )["allowed"]
        )
        refreshed = self.store.save_proposal(
            case["id"], {"targets": ["validator-eval"]}, self.eval_pack("new"), detail["revision"]
        )
        self.assertFalse(self.store.eval_guard(case["id"], "high")["allowed"])
        self.assertEqual(
            (2, "2"),
            (
                refreshed["evaluation_pack"]["pack_revision"],
                refreshed["evaluation_pack"]["version"],
            ),
        )

    def test_eval_job_snapshots_pack_and_unsafe_or_stale_result_mutates_nothing(self):
        case = self.open_case()
        case = self.store.save_proposal(
            case["id"], {"targets": ["validator-eval"]}, self.eval_pack(), case["revision"]
        )
        job = self.store.create_job(
            "eval", case_id=case["id"], phase="baseline", repo="repo", git_ref="a" * 40
        )
        loaded = improvements.ImprovementStore(self.db, "personal").load_job_request(job["id"])[
            "request"
        ]
        self.assertEqual(
            {"case_id", "phase", "repo", "git_ref", "pack_revision", "pack_version", "pack_hash"},
            set(loaded),
        )
        self.assertEqual((1, "1"), (loaded["pack_revision"], loaded["pack_version"]))
        self.store.update_job(job["id"], "running")
        self.store.update_job(job["id"], "succeeded")
        safe = self.eval_result(job["id"], "baseline")
        for change in (
            {"pack_hash": "f" * 64},
            {"git_ref": "b" * 40},
            {"cleanup_verified": False},
            {"source_unchanged": False},
            {"registrations_unchanged": False},
        ):
            with self.subTest(change=change), self.assertRaises(improvements.ImprovementError):
                self.store.record_eval_run(
                    case["id"], "baseline", "repo", "a" * 40, safe | change, job_id=job["id"]
                )
        self.assertEqual([], self.store.case(case["id"])["eval_runs"])
        current = self.store.case(case["id"])
        self.store.save_proposal(
            case["id"],
            {"targets": ["validator-eval"]},
            self.eval_pack("changed"),
            current["revision"],
        )
        with self.assertRaises(improvements.ImprovementError):
            self.store.record_eval_run(
                case["id"], "baseline", "repo", "a" * 40, safe, job_id=job["id"]
            )
        self.assertEqual([], self.store.case(case["id"])["eval_runs"])

    def test_eval_completion_is_atomic_idempotent_and_supervisor_terminal_is_compatible(self):
        case = self.open_case()
        case = self.store.save_proposal(
            case["id"], {"targets": ["validator-eval"]}, self.eval_pack(), case["revision"]
        )
        job = self.store.create_job(
            "eval", case_id=case["id"], phase="candidate", repo="repo", git_ref="a" * 40
        )
        self.store.update_job(job["id"], "running")
        result = self.eval_result(job["id"], "candidate", patch_hash="b" * 64)
        conn = sqlite3.connect(self.store.path)
        conn.execute(f"""CREATE TRIGGER fail_eval_finish BEFORE UPDATE OF state ON jobs
            WHEN NEW.id={job["id"]} AND NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'injected transition fault'); END""")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected transition fault"):
            self.store.record_eval_run(
                case["id"], "candidate", "repo", "a" * 40, result, job_id=job["id"]
            )
        self.assertEqual([], self.store.case(case["id"])["eval_runs"])
        self.assertEqual("running", self.store.jobs()[0]["state"])
        conn = sqlite3.connect(self.store.path)
        conn.execute("DROP TRIGGER fail_eval_finish")
        conn.commit()
        conn.close()
        first = self.store.record_eval_run(
            case["id"], "candidate", "repo", "a" * 40, result, job_id=job["id"]
        )
        again = self.store.record_eval_run(
            case["id"], "candidate", "repo", "a" * 40, result, job_id=job["id"]
        )
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(
            ("succeeded", 1),
            (self.store.jobs()[0]["state"], len(self.store.case(case["id"])["eval_runs"])),
        )
        self.store.update_job(job["id"], "succeeded")
        replay = self.store.record_eval_run(
            case["id"], "candidate", "repo", "a" * 40, result, job_id=job["id"]
        )
        self.assertEqual(first["id"], replay["id"])
        conflict = self.eval_result(job["id"], "candidate", patch_hash="d" * 64)
        with self.assertRaises(improvements.ImprovementError) as caught:
            self.store.record_eval_run(
                case["id"], "candidate", "repo", "a" * 40, conflict, job_id=job["id"]
            )
        self.assertEqual(
            ("eval_result_conflict", 409), (caught.exception.code, caught.exception.status)
        )

    def test_eval_storage_rejects_forged_summaries_and_discards_ansi_output(self):
        case = self.open_case()
        case = self.store.save_proposal(
            case["id"], {"targets": ["validator-eval"]}, self.eval_pack(), case["revision"]
        )
        job = self.store.create_job(
            "eval", case_id=case["id"], phase="candidate", repo="repo", git_ref="a" * 40
        )
        self.store.update_job(job["id"], "running")
        assertion = {
            "scenario": "scenario",
            "name": "safe",
            "type": "file_not_contains",
            "required": True,
            "safety": True,
            "passed": False,
            "error": "private failure",
            "output": "\x1b[31mprivate output\x1b[0m",
            "exit_code": 1,
        }
        base = self.eval_result(job["id"], "candidate", patch_hash="b" * 64)
        forged_pass = base | {"assertions": [assertion]}
        forged_regressions = base | {
            "passed": False,
            "error_code": "assertion_failed",
            "assertions": [assertion],
            "safety_regressions": [],
        }
        for forged in (forged_pass, forged_regressions):
            with (
                self.subTest(forged=forged["passed"]),
                self.assertRaises(improvements.ImprovementError),
            ):
                self.store.record_eval_run(
                    case["id"], "candidate", "repo", "a" * 40, forged, job_id=job["id"]
                )
        self.assertEqual([], self.store.case(case["id"])["eval_runs"])
        durable = forged_regressions | {"safety_regressions": ["safe"]}
        stored = self.store.record_eval_run(
            case["id"], "candidate", "repo", "a" * 40, durable, job_id=job["id"]
        )
        normalized = json.loads(stored["result_json"])
        self.assertEqual("assertion_failed", normalized["error_code"])
        self.assertEqual(["safe"], normalized["safety_regressions"])
        self.assertNotIn("output", normalized["assertions"][0])
        self.assertNotIn("error", normalized["assertions"][0])
        self.assertNotIn("\x1b", stored["result_json"])

    def test_restore_fails_closed_for_writer_and_wal_and_keeps_reverse_snapshot(self):
        self.enable()
        conn = sqlite3.connect(self.store.path)
        backup = sidecar_schema._snapshot(conn, self.store.path)
        conn.close()
        profile = self.store.profile()
        profile["purpose"] = "new purpose"
        self.store.put_profile(profile, profile["revision"])
        wrong = backup.parent / "wrong-scope.sqlite3"
        shutil.copy2(backup, wrong)
        wrong_conn = sqlite3.connect(wrong)
        wrong_conn.execute("UPDATE profile SET scope='other'")
        wrong_conn.commit()
        wrong_conn.close()
        with self.assertRaises(improvements.ImprovementError) as mismatch:
            sidecar_schema.restore_sidecar_backup(self.store.path, wrong)
        self.assertEqual("backup_mismatch", mismatch.exception.code)
        writer = sqlite3.connect(self.store.path)
        writer.execute("BEGIN IMMEDIATE")
        writer.execute("UPDATE profile SET purpose='uncommitted'")
        with self.assertRaises(improvements.ImprovementError) as busy:
            sidecar_schema.restore_sidecar_backup(self.store.path, backup)
        self.assertEqual("store_busy", busy.exception.code)
        writer.rollback()
        writer.close()
        wal, shm = Path(str(self.store.path) + "-wal"), Path(str(self.store.path) + "-shm")
        wal.write_bytes(b"stale")
        shm.write_bytes(b"stale")
        with self.assertRaises(improvements.ImprovementError) as stale:
            sidecar_schema.restore_sidecar_backup(self.store.path, backup)
        self.assertEqual("store_busy", stale.exception.code)
        wal.unlink()
        shm.unlink()
        reverse = sidecar_schema.restore_sidecar_backup(self.store.path, backup)
        self.assertEqual("Improve agent reliability", self.store.profile()["purpose"])
        self.assertTrue(reverse.exists())
        sidecar_schema.restore_sidecar_backup(self.store.path, reverse)
        self.assertEqual("new purpose", self.store.profile()["purpose"])

    def test_matched_noncomparable_monitoring_is_rejected_and_not_counted(self):
        case = self.open_case()
        self.store.start_monitoring(case["id"], 0.5)
        with self.assertRaises(improvements.ImprovementError) as invalid:
            self.store.observe(case["id"], matched=True, comparable=False, severity="low")
        self.assertEqual("invalid_monitoring", invalid.exception.code)
        self.store.observe(case["id"], matched=False, comparable=False)
        monitor = self.store.case(case["id"])["monitoring"]
        self.assertEqual((0, 0), (monitor["comparable_sessions"], monitor["recurrence_count"]))

    def test_job_recipe_is_bounded_whitelisted_loadable_and_survives_restart(self):
        self.enable()
        job = self.store.create_job(recipe_id="improvements.analysis", trigger="manual")
        loaded = improvements.ImprovementStore(self.db, "personal").load_job_request(job["id"])
        self.assertEqual({"scope": "personal", "trigger": "manual"}, loaded["request"])
        self.assertEqual(
            ("improvements.analysis", "codex", "analysis"),
            (loaded["recipe_id"], loaded["client"], loaded["kind"]),
        )
        self.assertEqual(
            "queued", improvements.ImprovementStore(self.db, "personal").jobs()[0]["state"]
        )
        encoded = json.dumps(loaded).lower()
        for forbidden in ("command", "output", "prompt", "transcript", "reasoning"):
            self.assertNotIn(forbidden, encoded)
        with self.assertRaises(improvements.ImprovementError):
            self.store.create_job(recipe_id="untrusted.recipe")
        conn = sqlite3.connect(self.store.path)
        self.assertEqual(
            {"scope", "trigger"},
            set(
                json.loads(
                    conn.execute(
                        "SELECT request_json FROM jobs WHERE id=?", (job["id"],)
                    ).fetchone()[0]
                )
            ),
        )
        conn.close()

    def test_analyzer_result_is_atomic_hash_verified_and_idempotently_ledgered(self):
        self.enable()
        case = self.signal("a", 1, "high", "same analyzer failure")
        job = self.store.create_job()
        self.store.update_job(job["id"], "running")
        result = {
            "signals": [
                {
                    "category": "validator-eval",
                    "title": "Analyzer case",
                    "evidence": {
                        "pointer": "session:b/event:2",
                        "at": iso(),
                        "client": "codex",
                        "session_id": "b",
                        "event_type": "validation_failed",
                        "severity": "high",
                        "excerpt": "same analyzer failure",
                    },
                },
                {
                    "category": "validator-eval",
                    "title": "Analyzer case",
                    "evidence": {
                        "pointer": "session:a/event:3",
                        "at": iso(),
                        "client": "codex",
                        "session_id": "a",
                        "event_type": "validation_failed",
                        "severity": "high",
                        "excerpt": "same analyzer failure",
                    },
                },
            ],
            "case_mutations": [
                {
                    "case_id": case["id"],
                    "title": "token=secret analyzed",
                    "trend": "rising",
                    "proposal": {
                        "targets": ["validator-eval"],
                        "recommended_change": "tighten validation",
                    },
                    "evaluation_pack": self.eval_pack(),
                }
            ],
        }
        digest = sanitization.validated_result_hash(result)
        first = self.store.apply_analyzer_result(job["id"], digest, result)
        second = improvements.ImprovementStore(self.db, "personal").apply_analyzer_result(
            job["id"], digest, result
        )
        self.assertEqual(first, second)
        self.assertEqual("succeeded", self.store.jobs()[0]["state"])
        detail = self.store.case(case["id"])
        self.assertEqual(
            (3, "open", "rising"), (detail["signal_count"], detail["state"], detail["trend"])
        )
        self.assertNotIn("secret", detail["title"])
        self.assertEqual(1, detail["proposal"]["version"])
        other = {"signals": [], "case_mutations": []}
        with self.assertRaises(improvements.ImprovementError) as conflict:
            self.store.apply_analyzer_result(
                job["id"], sanitization.validated_result_hash(other), other
            )
        self.assertEqual("result_conflict", conflict.exception.code)
        self.store.update_job(job["id"], "succeeded")

        retry = self.store.create_job()
        self.store.update_job(retry["id"], "running")
        with self.assertRaises(improvements.ImprovementError) as mismatch:
            self.store.apply_analyzer_result(
                retry["id"], "0" * 64, {"signals": [], "case_mutations": []}
            )
        self.assertEqual("result_hash_mismatch", mismatch.exception.code)
        bad = {
            "signals": [
                {
                    "category": "skill",
                    "evidence": {
                        "pointer": "session:z/event:9",
                        "at": iso(),
                        "client": "codex",
                        "session_id": "z",
                        "event_type": "failure",
                        "severity": "high",
                        "excerpt": "new failure",
                    },
                }
            ],
            "case_mutations": [{"case_id": 999999, "trend": "rising"}],
        }
        with self.assertRaises(improvements.ImprovementError):
            self.store.apply_analyzer_result(
                retry["id"], sanitization.validated_result_hash(bad), bad
            )
        self.assertEqual(3, self.store.case(case["id"])["signal_count"])
        conn = sqlite3.connect(self.store.path)
        self.assertFalse(
            conn.execute("SELECT 1 FROM signals WHERE pointer='session:z/event:9'").fetchone()
        )
        self.assertFalse(
            conn.execute(
                "SELECT 1 FROM analyzer_applications WHERE job_id=?", (retry["id"],)
            ).fetchone()
        )
        conn.close()
        with self.assertRaises(improvements.ImprovementError):
            self.store.apply_analyzer_result(
                retry["id"], "0" * 64, {"signals": [], "case_mutations": [], "prompt": "raw"}
            )
        empty = {"signals": [], "case_mutations": []}
        empty_hash = sanitization.validated_result_hash(empty)
        self.assertEqual(
            empty_hash,
            self.store.apply_analyzer_result(retry["id"], empty_hash, empty)["result_hash"],
        )

    def test_analyzer_completion_rolls_back_domain_ledger_and_terminal_state_on_fault(self):
        self.enable()
        job = self.store.create_job()
        self.store.update_job(job["id"], "running")
        result = {
            "signals": [
                {
                    "category": "skill",
                    "evidence": {
                        "pointer": "session:fault/event:1",
                        "at": iso(),
                        "client": "codex",
                        "session_id": "fault",
                        "event_type": "failure",
                        "severity": "high",
                        "excerpt": "atomic analyzer completion",
                    },
                }
            ],
            "case_mutations": [],
        }
        digest = sanitization.validated_result_hash(result)
        conn = sqlite3.connect(self.store.path)
        conn.execute(f"""CREATE TRIGGER fail_analysis_finish BEFORE UPDATE OF state ON jobs
            WHEN NEW.id={job["id"]} AND NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'injected analyzer terminal fault'); END""")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "injected analyzer terminal fault"):
            self.store.apply_analyzer_result(job["id"], digest, result)
        conn = sqlite3.connect(self.store.path)
        self.assertFalse(
            conn.execute("SELECT 1 FROM signals WHERE pointer='session:fault/event:1'").fetchone()
        )
        self.assertFalse(
            conn.execute(
                "SELECT 1 FROM analyzer_applications WHERE job_id=?", (job["id"],)
            ).fetchone()
        )
        self.assertEqual(
            "running", conn.execute("SELECT state FROM jobs WHERE id=?", (job["id"],)).fetchone()[0]
        )
        conn.execute("DROP TRIGGER fail_analysis_finish")
        conn.commit()
        conn.close()
        first = self.store.apply_analyzer_result(job["id"], digest, result)
        replay = self.store.apply_analyzer_result(job["id"], digest, result)
        self.assertEqual(first, replay)
        self.assertEqual("succeeded", self.store.jobs()[0]["state"])

    def test_analyzer_rejects_two_semantic_clusters_resolving_to_one_exact_case(self):
        self.enable()
        job = self.store.create_job()
        self.store.update_job(job["id"], "running")

        def evidence(pointer, session):
            return {
                "pointer": pointer,
                "at": iso(),
                "client": "codex",
                "session_id": session,
                "event_type": "failure",
                "severity": "high",
                "excerpt": "identical normalized failure 42",
            }

        result = {
            "signals": [
                {
                    "id": "one",
                    "category": "skill",
                    "evidence": evidence("session:one/event:1", "one"),
                },
                {
                    "id": "two",
                    "category": "skill",
                    "evidence": evidence("session:two/event:2", "two"),
                },
            ],
            "cases": [
                {
                    "cluster_key": "cluster-one",
                    "category": "skill",
                    "signal_ids": ["one"],
                    "proposal": {"targets": ["skill"], "recommended_change": "first"},
                    "evaluation_pack": self.eval_pack("first"),
                },
                {
                    "cluster_key": "cluster-two",
                    "category": "skill",
                    "signal_ids": ["two"],
                    "proposal": {"targets": ["skill"], "recommended_change": "second"},
                    "evaluation_pack": self.eval_pack("second"),
                },
            ],
            "case_mutations": [],
        }
        digest = sanitization.validated_result_hash(result)
        with self.assertRaises(improvements.ImprovementError) as collision:
            self.store.apply_analyzer_result(job["id"], digest, result)
        self.assertEqual("semantic_cluster_collision", collision.exception.code)
        conn = sqlite3.connect(self.store.path)
        self.assertEqual(0, conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0])
        self.assertEqual(0, conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0])
        self.assertFalse(
            conn.execute(
                "SELECT 1 FROM analyzer_applications WHERE job_id=?", (job["id"],)
            ).fetchone()
        )
        self.assertEqual(
            "running", conn.execute("SELECT state FROM jobs WHERE id=?", (job["id"],)).fetchone()[0]
        )
        conn.close()

    def test_maintenance_lease_excludes_writers_migration_and_restore(self):
        self.enable()
        case = self.signal("a", 1)
        conn = sqlite3.connect(self.store.path)
        backup = sidecar_schema._snapshot(conn, self.store.path)
        conn.close()
        before = self.store.case(case["id"])
        helper = (
            "import sys;sys.path.insert(0,sys.argv[2]);"
            "from server.improvements import sidecar_locks\n"
            "with sidecar_locks.maintenance_lease(sys.argv[1]):\n"
            " print('locked',flush=True);sys.stdin.readline()"
        )
        process = subprocess.Popen(
            [sys.executable, "-c", helper, str(self.store.path), ROOT],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        self.assertEqual("locked", process.stdout.readline().strip())
        try:
            with self.assertRaises(improvements.ImprovementError) as writer:
                self.signal("b", 2)
            self.assertEqual("store_busy", writer.exception.code)
            with self.assertRaises(improvements.ImprovementError) as migration:
                sidecar_schema.migrate_sidecar(self.store.path)
            self.assertEqual("store_busy", migration.exception.code)
            with self.assertRaises(improvements.ImprovementError) as restore:
                sidecar_schema.restore_sidecar_backup(self.store.path, backup)
            self.assertEqual("store_busy", restore.exception.code)
        finally:
            process.communicate("\n", timeout=5)
        after = self.store.case(case["id"])
        self.assertEqual(
            (before["revision"], before["signal_count"]), (after["revision"], after["signal_count"])
        )

    def test_semantic_cluster_identity_groups_dissimilar_signals_and_rejects_bad_mapping(self):
        self.enable()

        def evidence(pointer, session, text):
            return {
                "pointer": pointer,
                "at": iso(),
                "client": "codex",
                "session_id": session,
                "event_type": "failure",
                "severity": "high",
                "excerpt": text,
            }

        first = {
            "signals": [
                {
                    "id": "s1",
                    "category": "skill",
                    "evidence": evidence("session:a/event:1", "a", "parser chose the wrong branch"),
                },
                {
                    "id": "s2",
                    "category": "skill",
                    "evidence": evidence(
                        "session:b/event:2", "b", "handoff omitted a required owner"
                    ),
                },
            ],
            "cases": [
                {
                    "cluster_key": "handoff-contract",
                    "case_key": "semantic-handoff",
                    "category": "skill",
                    "title": "Handoff contract failures",
                    "signal_ids": ["s1", "s2"],
                    "proposal": {"targets": ["skill"], "recommended_change": "tighten handoff"},
                    "evaluation_pack": self.eval_pack(),
                }
            ],
            "case_mutations": [],
        }
        job = self.store.create_job()
        result_hash = sanitization.validated_result_hash(first)
        outcome = self.store.apply_analyzer_result(job["id"], result_hash, first)
        replay = self.store.apply_analyzer_result(job["id"], result_hash, first)
        self.assertEqual(outcome, replay)
        self.assertEqual(1, len(outcome["case_ids"]))
        case = self.store.case(outcome["case_ids"][0])
        self.assertEqual(("semantic-handoff", 2), (case["case_key"], case["signal_count"]))
        self.assertEqual(
            ("tighten handoff", "1"),
            (case["proposal"]["recommended_change"], case["evaluation_pack"]["version"]),
        )
        self.store.update_job(job["id"], "succeeded")

        future = {
            "signals": [
                {
                    "id": "s3",
                    "category": "skill",
                    "evidence": evidence("session:c/event:3", "c", "completely different wording"),
                }
            ],
            "cases": [
                {
                    "cluster_key": "handoff-contract",
                    "case_key": "semantic-handoff",
                    "category": "skill",
                    "signal_ids": ["s3"],
                }
            ],
            "case_mutations": [],
        }
        job = self.store.create_job()
        joined = self.store.apply_analyzer_result(
            job["id"], sanitization.validated_result_hash(future), future
        )
        self.assertEqual(outcome["case_ids"], joined["case_ids"])
        self.assertEqual(3, self.store.case(case["id"])["signal_count"])
        self.store.update_job(job["id"], "succeeded")

        changed_cluster = {
            "signals": [
                {
                    "id": "s5",
                    "category": "skill",
                    "evidence": evidence("session:e/event:5", "e", "completely different wording"),
                }
            ],
            "cases": [
                {
                    "cluster_key": "changed-cluster",
                    "case_key": "must-not-split",
                    "category": "skill",
                    "signal_ids": ["s5"],
                }
            ],
            "case_mutations": [],
        }
        job = self.store.create_job()
        exact_join = self.store.apply_analyzer_result(
            job["id"], sanitization.validated_result_hash(changed_cluster), changed_cluster
        )
        self.assertEqual(outcome["case_ids"], exact_join["case_ids"])
        self.assertEqual(4, self.store.case(case["id"])["signal_count"])

        separate = {
            "signals": [
                {
                    "id": "s4",
                    "category": "skill",
                    "evidence": evidence(
                        "session:d/event:4", "d", "another genuinely distinct failure"
                    ),
                }
            ],
            "cases": [{"cluster_key": "other-cluster", "category": "skill", "signal_ids": ["s4"]}],
            "case_mutations": [],
        }
        job = self.store.create_job()
        distinct = self.store.apply_analyzer_result(
            job["id"], sanitization.validated_result_hash(separate), separate
        )
        self.assertNotEqual(outcome["case_ids"], distinct["case_ids"])
        self.store.update_job(job["id"], "succeeded")
        forbidden = {
            "signals": [
                {
                    "id": "p",
                    "category": "skill",
                    "evidence": evidence("session:p/event:1", "p", "forbidden proposal"),
                }
            ],
            "cases": [
                {
                    "cluster_key": "product",
                    "category": "skill",
                    "signal_ids": ["p"],
                    "proposal": {"targets": ["product-code"]},
                    "evaluation_pack": self.eval_pack(),
                }
            ],
            "case_mutations": [],
        }
        with self.assertRaises(improvements.ImprovementError) as rejected:
            sanitization.validated_result_hash(forbidden)
        self.assertEqual("invalid_target", rejected.exception.code)
        count = len(self.store.cases())
        for bad_cases in (
            [{"cluster_key": "bad", "category": "skill", "signal_ids": ["missing"]}],
            [
                {"cluster_key": "one", "category": "skill", "signal_ids": ["x"]},
                {"cluster_key": "two", "category": "skill", "signal_ids": ["x"]},
            ],
        ):
            bad = {
                "signals": [
                    {
                        "id": "x",
                        "category": "skill",
                        "evidence": evidence("session:z/event:9", "z", "not applied"),
                    }
                ],
                "cases": bad_cases,
                "case_mutations": [],
            }
            with self.assertRaises(improvements.ImprovementError):
                sanitization.validated_result_hash(bad)
            self.assertEqual(count, len(self.store.cases()))


if __name__ == "__main__":
    unittest.main()
