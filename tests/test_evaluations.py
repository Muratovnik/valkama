import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from server.improvements.evaluation_contract import (
    MAX_ASSERTIONS,
    MAX_SCENARIOS,
    EvaluationContractError,
    canonical_evaluation_pack,
    evaluation_pack_hash,
)
from server.improvements.evaluations import (
    EvaluationError,
    EvaluationPack,
    EvaluationPreflightError,
    EvaluationRunner,
    normalize_evaluation_result,
    preflight_repo,
)


def git(repo, *args):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


class EvaluationRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="eval-test-")
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "eval@example.test")
        git(self.repo, "config", "user.name", "Evaluation Test")
        (self.repo / "marker.txt").write_text("fail\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "baseline")
        self.baseline = git(self.repo, "rev-parse", "HEAD")
        (self.repo / "marker.txt").write_text("ok\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "candidate")
        self.candidate = git(self.repo, "rev-parse", "HEAD")
        # The source checkout is deliberately left at a dirty, unrelated file.
        (self.repo / "local.txt").write_text("untouched\n", encoding="utf-8")
        self.before = (git(self.repo, "rev-parse", "HEAD"), git(self.repo, "status", "--porcelain"))
        self.runner = lambda **kwargs: EvaluationRunner(allow_command={sys.executable}, **kwargs)

    def tearDown(self):
        self.temp.cleanup()

    def pack(self):
        command = [
            sys.executable,
            "-c",
            "import pathlib,sys; sys.exit(0 if pathlib.Path('marker.txt').read_text().strip() == 'ok' else 1)",
        ]
        return EvaluationPack(
            "pack-v1",
            scenarios=[
                {
                    "name": "marker",
                    "command": command,
                    "assertions": [
                        {"type": "command_exit", "expected": 0, "baseline_failure": True},
                        {"type": "file_contains", "path": "marker.txt", "text": "ok"},
                        {"type": "file_not_contains", "path": "marker.txt", "text": "bad"},
                    ],
                }
            ],
            provenance={"source": "unit-test"},
        )

    def test_baseline_and_candidate_use_same_pack_and_cleanup(self):
        runner = self.runner()
        baseline = runner.run(self.pack(), str(self.repo), self.baseline, "baseline")
        candidate = runner.run(self.pack(), str(self.repo), self.candidate, "candidate")
        self.assertFalse(baseline["passed"])
        self.assertTrue(baseline["reproduced_failure"])
        self.assertTrue(candidate["passed"])
        self.assertEqual(baseline["pack_hash"], candidate["pack_hash"])
        self.assertNotEqual(baseline["git_ref"], candidate["git_ref"])
        self.assertNotEqual(baseline["patch_hash"], candidate["patch_hash"])
        self.assertTrue(baseline["cleanup_verified"])
        self.assertTrue(candidate["cleanup_verified"])
        self.assertTrue(baseline["source_unchanged"])
        self.assertEqual(
            self.before,
            (git(self.repo, "rev-parse", "HEAD"), git(self.repo, "status", "--porcelain")),
        )

    def test_pack_hash_matches_shared_canonical_contract(self):
        pack = self.pack()
        canonical = canonical_evaluation_pack(pack.as_dict())
        self.assertEqual(pack.as_dict(), canonical)
        self.assertEqual(pack.digest(), evaluation_pack_hash(canonical))
        self.assertEqual(pack.digest(), evaluation_pack_hash(pack.as_dict()))

    def test_baseline_and_candidate_results_normalize_with_raw_output_redacted(self):
        pack = self.pack()
        runner = self.runner()
        baseline = runner.run(pack, str(self.repo), self.baseline, "baseline", job_id="job-eval")
        candidate = runner.run(pack, str(self.repo), self.candidate, "candidate", job_id="job-eval")
        for phase, result in (("baseline", baseline), ("candidate", candidate)):
            normalized = runner.normalize_result(
                result,
                expected_phase=phase,
                expected_pack_version=pack.version,
                expected_pack_hash=pack.digest(),
                expected_git_ref=result["git_ref"],
            )
            self.assertEqual(phase, normalized["phase"])
            self.assertEqual(
                normalized,
                normalize_evaluation_result(
                    result,
                    expected_phase=phase,
                    expected_pack_version=pack.version,
                    expected_pack_hash=pack.digest(),
                    expected_git_ref=result["git_ref"],
                ),
            )
            self.assertNotIn("error", normalized)
            for assertion in normalized["assertions"]:
                self.assertNotIn("output", assertion)
                self.assertNotIn("error", assertion)

    def test_assertion_failed_result_normalizes_without_raw_error_or_output(self):
        pack = EvaluationPack(
            "pack-assertion-failed",
            assertions=[
                {
                    "name": "must-pass",
                    "type": "command_exit",
                    "command": [sys.executable, "-c", "raise SystemExit(1)"],
                    "expected": 0,
                    # The candidate still fails the assertion designated to
                    # reproduce the baseline; designation belongs only to the
                    # baseline result envelope.
                    "baseline_failure": True,
                }
            ],
        )
        runner = self.runner()
        raw = runner.run(pack, str(self.repo), self.candidate, "candidate", job_id="job-fail")
        self.assertEqual("assertion_failed", raw["error_code"])
        normalized = runner.normalize_result(
            raw,
            expected_phase="candidate",
            expected_pack_version=pack.version,
            expected_pack_hash=evaluation_pack_hash(pack.as_dict()),
            expected_git_ref=raw["git_ref"],
        )
        self.assertFalse(normalized["passed"])
        self.assertEqual("assertion_failed", normalized["error_code"])
        self.assertFalse(normalized["baseline_failure_designated"])
        self.assertNotIn("error", normalized)
        self.assertNotIn("output", normalized["assertions"][0])

    def test_named_failure_example_is_annotated_before_strict_normalization(self):
        pack = EvaluationPack(
            "pack-named-failure",
            assertions=[
                {
                    "name": "marker-regression",
                    "type": "file_contains",
                    "path": "marker.txt",
                    "text": "ok",
                    "required": True,
                }
            ],
            failure_examples=["marker-regression"],
        )
        runner = self.runner()
        raw = runner.run(pack, str(self.repo), self.baseline, "baseline", job_id="job-named")
        self.assertTrue(raw["assertions"][0]["baseline_failure"])
        normalized = runner.normalize_result(
            raw,
            expected_phase="baseline",
            expected_pack_version=pack.version,
            expected_pack_hash=pack.digest(),
            expected_git_ref=raw["git_ref"],
        )
        self.assertTrue(normalized["reproduced_failure"])

    def test_before_after_guard_requires_baseline_failure_and_candidate_pass(self):
        combined = self.runner().run_before_after(
            self.pack(), str(self.repo), self.baseline, self.candidate, job_id="job-eval"
        )
        self.assertTrue(combined["baseline_failed"])
        self.assertTrue(combined["candidate_passed"])
        self.assertTrue(combined["passed"])
        self.assertEqual("job-eval", combined["job_id"])

    def test_caller_owned_temp_root_is_not_recursively_removed(self):
        owned = Path(self.temp.name) / "caller-owned"
        owned.mkdir()
        sentinel = owned / "sentinel.txt"
        sentinel.write_text("keep", encoding="utf-8")
        result = self.runner().run(
            self.pack(), str(self.repo), self.candidate, "candidate", temp_root=str(owned)
        )
        self.assertTrue(result["cleanup_verified"])
        self.assertTrue(owned.exists())
        self.assertEqual("keep", sentinel.read_text(encoding="utf-8"))
        self.assertFalse((owned / "worktree").exists())

    def test_preexisting_factory_root_is_rejected_and_survives(self):
        owned = Path(self.temp.name) / "factory-root"
        owned.mkdir()
        sentinel = owned / "sentinel.txt"
        sentinel.write_text("keep", encoding="utf-8")

        def malicious_factory(_prefix):
            return str(owned)

        with self.assertRaises(EvaluationPreflightError):
            EvaluationRunner(temp_root_factory=malicious_factory).run(
                self.pack(), str(self.repo), self.candidate, "candidate"
            )
        self.assertTrue(sentinel.exists())

    def test_reparse_factory_root_is_rejected(self):
        real = Path(self.temp.name) / "real-root"
        real.mkdir()
        link = Path(self.temp.name) / "link-root"
        try:
            os.symlink(real, link, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")

        def link_factory(_prefix):
            return str(link)

        with self.assertRaises(EvaluationPreflightError):
            EvaluationRunner(temp_root_factory=link_factory).run(
                self.pack(), str(self.repo), self.candidate, "candidate"
            )
        self.assertTrue(real.exists())

    def test_target_preflight_rejects_nonrepo_ref_and_registered_surprise(self):
        with self.assertRaises(EvaluationPreflightError):
            preflight_repo(str(self.repo / "marker.txt"), self.baseline)
        with self.assertRaises(EvaluationPreflightError):
            preflight_repo(str(self.repo), "does-not-exist")
        existing = Path(self.temp.name) / "existing"
        existing.mkdir()
        with self.assertRaises(EvaluationPreflightError):
            preflight_repo(str(self.repo), self.baseline, str(existing))
        registered = Path(self.temp.name) / "registered"
        git(self.repo, "worktree", "add", "-q", "--detach", str(registered), self.baseline)
        try:
            with self.assertRaises(EvaluationPreflightError):
                preflight_repo(str(self.repo), self.baseline, str(registered))
        finally:
            git(self.repo, "worktree", "remove", "--force", str(registered))

    def test_assertion_timeout_and_bounded_output(self):
        pack = EvaluationPack(
            "pack-timeout",
            scenarios=[
                {
                    "name": "timeout",
                    "assertions": [
                        {
                            "type": "command_exit",
                            "command": [sys.executable, "-c", "import time; time.sleep(2)"],
                            "timeout": 0.05,
                        }
                    ],
                },
                {
                    "name": "bounded",
                    "assertions": [
                        {
                            "type": "command_exit",
                            "command": [sys.executable, "-c", "print('x' * 10000)"],
                        }
                    ],
                },
            ],
        )
        result = self.runner(max_output_chars=64).run(
            pack, str(self.repo), self.candidate, "candidate"
        )
        self.assertFalse(result["passed"])
        timeout = next(item for item in result["assertions"] if item["name"] == "command_exit")
        self.assertTrue(timeout["timed_out"])
        bounded = [item for item in result["assertions"] if item.get("output")]
        self.assertTrue(all(len(item["output"]) <= 64 for item in bounded))

    def test_paths_cannot_escape_worktree(self):
        pack = EvaluationPack(
            "pack-path",
            assertions=[{"type": "file_contains", "path": "../marker.txt", "text": "ok"}],
        )
        result = self.runner().run(pack, str(self.repo), self.candidate, "candidate")
        self.assertFalse(result["passed"])
        self.assertIn("escapes", result["assertions"][0]["error"])

    def test_a_file_assertion_reports_an_undecodable_file_instead_of_deciding(self):
        # Cyrillic text in CP1251: not valid UTF-8, and the needle the pack
        # forbids. Decoded leniently every one of those bytes became U+FFFD, so
        # `file_not_contains` reported the forbidden text absent from a file it
        # had not read -- a passing verdict on unreadable bytes.
        (self.repo / "cp1251.txt").write_bytes("запрещено\n".encode("cp1251"))
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "cp1251")
        ref = git(self.repo, "rev-parse", "HEAD")
        pack = EvaluationPack(
            "pack-undecodable",
            assertions=[
                {
                    "name": "forbidden-absent",
                    "type": "file_not_contains",
                    "path": "cp1251.txt",
                    "text": "запрещено",
                    "required": True,
                },
                {
                    "name": "expected-present",
                    "type": "file_contains",
                    "path": "cp1251.txt",
                    "text": "запрещено",
                    "required": True,
                },
            ],
        )
        result = self.runner().run(pack, str(self.repo), ref, "candidate", job_id="job-undecodable")
        results = {item["name"]: item for item in result["assertions"]}
        self.assertFalse(result["passed"])
        for name in ("forbidden-absent", "expected-present"):
            self.assertFalse(results[name]["passed"], results[name])
            self.assertIn("not valid UTF-8", results[name]["error"])
            self.assertNotIn("found", results[name])
        # A file the runner could not read is the same kind of failure as one it
        # could not open: reported, fail-closed, and refused by the persistence
        # boundary rather than stored as a verdict about bytes nobody read.
        self.assertEqual("evaluation_error", result["error_code"])
        self.assertTrue(result["infrastructure_failure"])
        with self.assertRaises(EvaluationContractError):
            self.runner().normalize_result(
                result,
                expected_phase="candidate",
                expected_pack_version=pack.version,
                expected_pack_hash=pack.digest(),
                expected_git_ref=result["git_ref"],
            )

    def test_direct_pack_construction_obeys_the_one_canonical_limit(self):
        # `evaluation_contract` owns these two numbers. This module used to
        # declare a looser pair of its own, so a pack built directly answered to
        # a bound the canonical `from_dict` path would have refused.
        self.assertEqual((64, 256), (MAX_SCENARIOS, MAX_ASSERTIONS))
        scenario = {"name": "s", "command": [sys.executable, "-V"], "assertions": []}
        with self.assertRaises(EvaluationError):
            EvaluationPack("pack-scenarios", scenarios=[scenario] * (MAX_SCENARIOS + 1))
        with self.assertRaises(EvaluationError):
            EvaluationPack(
                "pack-assertions",
                assertions=[{"type": "exit", "name": "a"}] * (MAX_ASSERTIONS + 1),
            )
        EvaluationPack("pack-at-limit", scenarios=[scenario] * MAX_SCENARIOS)

    def test_deterministic_failure_skips_optional_judge(self):
        called = []
        pack = EvaluationPack(
            "pack-judge",
            assertions=[
                {
                    "type": "command_exit",
                    "command": [sys.executable, "-c", "raise SystemExit(1)"],
                    "expected": 0,
                },
                {"type": "judge", "name": "optional"},
            ],
        )
        result = self.runner().run(
            pack,
            str(self.repo),
            self.candidate,
            "candidate",
            judge=lambda *args: called.append(args) or True,
        )
        self.assertFalse(result["passed"])
        self.assertEqual([], called)
        self.assertTrue(
            next(item for item in result["assertions"] if item["name"] == "optional")["skipped"]
        )

    def test_default_command_policy_denies_command_assertions(self):
        pack = EvaluationPack(
            "pack-policy",
            assertions=[{"type": "command_exit", "command": [sys.executable, "-c", "pass"]}],
        )
        result = EvaluationRunner().run(pack, str(self.repo), self.candidate, "candidate")
        self.assertFalse(result["passed"])
        self.assertIn("allow_command", result["assertions"][0]["error"])

    def test_timeout_or_unknown_assertion_never_counts_as_reproduced_failure(self):
        pack = EvaluationPack(
            "pack-infra",
            assertions=[
                {
                    "type": "command_exit",
                    "command": [sys.executable, "-c", "import time; time.sleep(1)"],
                    "timeout": 0.05,
                    "baseline_failure": True,
                },
                {"type": "made_up", "baseline_failure": True},
            ],
        )
        result = self.runner().run(pack, str(self.repo), self.baseline, "baseline")
        self.assertFalse(result["reproduced_failure"])
        self.assertTrue(result["error_code"])

    def test_optional_guard_failure_is_fail_closed(self):
        pack = EvaluationPack(
            "pack-guard",
            assertions=[
                {
                    "type": "file_contains",
                    "path": "marker.txt",
                    "text": "must-not-be-present",
                    "guard": True,
                    "required": False,
                }
            ],
        )
        result = self.runner().run(pack, str(self.repo), self.candidate, "candidate")
        self.assertFalse(result["passed"])
        self.assertTrue(result["assertions"][0]["required"])
        self.assertEqual(["file_contains"], result["guard_regressions"])

    def test_patch_hash_fails_closed_when_the_diff_cannot_be_produced(self):
        # The diff is the thing being hashed, so its failure is the one that has
        # to fail closed. A failing parent lookup is not: that is how a root
        # commit reaches the explicit --root path below it.
        from unittest.mock import patch

        from server.improvements.evaluations import _patch_hash

        class Failed:
            returncode = 1
            stdout = b""

        with patch("server.improvements.evaluations._git_bytes", return_value=Failed()):
            with self.assertRaises(EvaluationPreflightError):
                _patch_hash(str(self.repo), self.baseline)

    def test_before_after_rejects_source_ref_or_file_mutation(self):
        mutate = [
            sys.executable,
            "-c",
            f"import pathlib,subprocess; pathlib.Path(r'{self.repo / 'tamper.txt'}').write_text('bad'); subprocess.run(['git','-C',r'{self.repo}','tag','unexpected'],check=True)",
        ]
        pack = EvaluationPack(
            "pack-mutation",
            scenarios=[
                {
                    "name": "mutation",
                    "assertions": [
                        {
                            "type": "command_exit",
                            "command": mutate,
                            "expected": 0,
                            "baseline_failure": True,
                        }
                    ],
                }
            ],
        )
        result = self.runner().run(pack, str(self.repo), self.candidate, "candidate")
        self.assertFalse(result["refs_unchanged"])
        self.assertFalse(result["source_unchanged"])


if __name__ == "__main__":
    unittest.main()
