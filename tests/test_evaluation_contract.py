import math
import unittest

from server.improvements.evaluation_contract import (
    API_VERSION,
    EVAL_PACK_INTERFACE_VERSION,
    EvaluationContractError,
    canonical_evaluation_pack,
    evaluation_pack_hash,
    normalize_eval_run,
)


class EvaluationContractTests(unittest.TestCase):
    def pack(self):
        return {
            "version": "1",
            "provenance": {"owner": "test", "revision": 1},
            "failure_examples": ["reproduces"],
            "negative_control": ["python", "-c", "print('ok')"],
            "scenarios": [
                {
                    "name": "same-pack",
                    "command": ["python", "-m", "unittest"],
                    "timeout": 30,
                    "assertions": [
                        {
                            "name": "reproduces",
                            "type": "command_exit",
                            "expected": 1,
                            "required": True,
                            "baseline_failure": True,
                        },
                        {
                            "name": "safe",
                            "type": "file_not_contains",
                            "path": "result.txt",
                            "text": "secret",
                            "required": True,
                            "safety": True,
                        },
                        {
                            "name": "guard",
                            "type": "file_contains",
                            "path": "result.txt",
                            "text": "ok",
                            "required": True,
                            "guard": True,
                        },
                    ],
                }
            ],
            "assertions": [],
        }

    def eval_run(self, phase="candidate"):
        assertions = [
            {
                "scenario": "same-pack",
                "name": "safe",
                "type": "file_not_contains",
                "required": True,
                "safety": True,
                "passed": True,
                "output": "private output",
            }
        ]
        if phase == "baseline":
            assertions = [
                {
                    "scenario": "same-pack",
                    "name": "reproduces",
                    "type": "command_exit",
                    "required": True,
                    "baseline_failure": True,
                    "passed": False,
                    "expected": 1,
                    "observed": 0,
                }
            ]
        return {
            "interface_version": API_VERSION,
            "job_id": "personal:eval:1",
            "phase": phase,
            "pack_version": "1",
            "pack_hash": evaluation_pack_hash(self.pack()),
            "git_ref": "a" * 40,
            "patch_hash": "b" * 64,
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

    def test_pack_is_canonical_and_hash_is_order_independent(self):
        pack = self.pack()
        reversed_pack = dict(reversed(list(pack.items())))
        canonical = canonical_evaluation_pack(pack)
        self.assertEqual(canonical["interface_version"], EVAL_PACK_INTERFACE_VERSION)
        self.assertEqual(canonical["scenarios"][0]["assertions"][1]["safety"], True)
        self.assertEqual(evaluation_pack_hash(pack), evaluation_pack_hash(reversed_pack))

    def test_pack_rejects_wrong_unknown_sensitive_nonfinite_and_oversized_values(self):
        for change in (
            {"interface_version": "wrong"},
            {"prompt": "secret"},
            {"provenance": {"tool_result": "secret"}},
            {"provenance": {"raw-output": "secret"}},
            {"provenance": {"last_error": "secret"}},
            {"scenarios": [{"name": "bad", "timeout": math.nan, "assertions": []}]},
            {"scenarios": [{"name": "bad", "command": ["x" * 1025], "assertions": []}]},
        ):
            pack = self.pack() | change
            with self.subTest(change=change):
                with self.assertRaises(EvaluationContractError):
                    canonical_evaluation_pack(pack)

    def test_safety_and_guard_assertions_cannot_be_optional(self):
        pack = self.pack()
        pack["scenarios"][0]["assertions"][1]["required"] = False
        with self.assertRaises(EvaluationContractError):
            canonical_evaluation_pack(pack)

    def test_safe_candidate_and_baseline_runs_normalize(self):
        candidate = normalize_eval_run(
            self.eval_run(),
            expected_phase="candidate",
            expected_pack_version="1",
            expected_pack_hash=evaluation_pack_hash(self.pack()),
            expected_git_ref="a" * 40,
        )
        baseline = normalize_eval_run(self.eval_run("baseline"), expected_phase="baseline")
        self.assertTrue(candidate["passed"])
        self.assertTrue(baseline["reproduced_failure"])
        self.assertNotIn("output", candidate["assertions"][0])
        self.assertNotIn("output_redacted", candidate["assertions"][0])
        self.assertRegex(candidate["result_hash"], r"^[0-9a-f]{64}$")

    def test_assertion_failure_is_persistable_without_raw_error_or_output(self):
        failed = self.eval_run() | {
            "passed": False,
            "error_code": "assertion_failed",
            "assertions": [
                {
                    "scenario": "same-pack",
                    "name": "safe",
                    "type": "file_not_contains",
                    "required": True,
                    "safety": True,
                    "passed": False,
                    "error": "secret=must-not-persist",
                    "output": "private tool output",
                    "exit_code": 1,
                }
            ],
            "safety_regressions": ["safe"],
        }
        normalized = normalize_eval_run(failed)
        self.assertEqual("assertion_failed", normalized["error_code"])
        self.assertNotIn("error", normalized["assertions"][0])
        self.assertNotIn("output", normalized["assertions"][0])
        self.assertEqual(1, normalized["assertions"][0]["exit_code"])

    def test_result_cannot_forge_pass_or_regression_summaries(self):
        failed_assertion = {
            "scenario": "same-pack",
            "name": "safe",
            "type": "file_not_contains",
            "required": True,
            "safety": True,
            "passed": False,
        }
        for change in (
            {"assertions": [failed_assertion]},
            {
                "passed": False,
                "error_code": "assertion_failed",
                "assertions": [failed_assertion],
                "safety_regressions": [],
            },
            {
                "assertions": [
                    {
                        "name": "safe",
                        "type": "file_not_contains",
                        "safety": True,
                        "passed": True,
                    }
                ],
            },
        ):
            with self.subTest(change=change):
                with self.assertRaises(EvaluationContractError):
                    normalize_eval_run(self.eval_run() | change)

    def test_scenario_without_assertions_keeps_pack_fallback_semantics(self):
        pack = self.pack()
        pack["scenarios"] = [{"name": "fallback", "command": ["python", "-V"]}]
        pack["assertions"] = [{"name": "ok", "type": "command_exit", "expected": 0}]
        canonical = canonical_evaluation_pack(pack)
        self.assertNotIn("assertions", canonical["scenarios"][0])

    def test_pack_result_budget_and_result_name_limits_match(self):
        assertion = {"name": "x", "type": "command_exit", "expected": 0}
        pack = self.pack()
        pack["scenarios"] = [
            {"name": f"scenario-{index}", "assertions": [assertion] * 200} for index in range(3)
        ]
        with self.assertRaises(EvaluationContractError):
            canonical_evaluation_pack(pack)
        pack = self.pack()
        pack["scenarios"][0]["name"] = "x" * 1025
        with self.assertRaises(EvaluationContractError):
            canonical_evaluation_pack(pack)

    def test_baseline_reproduction_is_derived_from_designated_failure(self):
        forged = self.eval_run("baseline")
        forged["assertions"][0]["baseline_failure"] = False
        with self.assertRaises(EvaluationContractError):
            normalize_eval_run(forged)
        forged = self.eval_run("baseline")
        forged["reproduced_failure"] = False
        with self.assertRaises(EvaluationContractError):
            normalize_eval_run(forged)

    def test_run_rejects_mismatches_and_unsafe_integrity_facts(self):
        cases = [
            (
                "pack",
                {"pack_hash": "c" * 64},
                {"expected_pack_hash": evaluation_pack_hash(self.pack())},
            ),
            ("ref", {"git_ref": "c" * 40}, {"expected_git_ref": "a" * 40}),
            ("cleanup", {"cleanup_verified": False}, {}),
            ("source", {"source_unchanged": False}, {}),
            ("registrations", {"registrations_unchanged": False}, {}),
            ("refs", {"refs_unchanged": False}, {}),
            ("infra", {"infrastructure_failure": True}, {}),
            ("error", {"error_code": "evaluation_error"}, {}),
        ]
        for name, change, expected in cases:
            with self.subTest(name=name), self.assertRaises(EvaluationContractError):
                normalize_eval_run(self.eval_run() | change, **expected)

    def test_result_unknown_and_sensitive_fields_are_rejected(self):
        with self.assertRaises(EvaluationContractError):
            normalize_eval_run(self.eval_run() | {"transcript": "secret"})
        run = self.eval_run()
        run["assertions"][0]["tool_result"] = "secret"
        with self.assertRaises(EvaluationContractError):
            normalize_eval_run(run)

    def test_transient_runner_text_accepts_ansi_but_is_not_persisted(self):
        run = self.eval_run()
        run["assertions"][0]["output"] = "\x1b[31mprivate\x1b[0m"
        normalized = normalize_eval_run(run)
        self.assertNotIn("output", normalized["assertions"][0])


if __name__ == "__main__":
    unittest.main()
