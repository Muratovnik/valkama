"""The runner must obey the role contract mechanically, not by prompt."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import git_worktrees, runner


class FakeProcess:
    def __init__(self, code: int | None = None, stdout: bytes | None = None) -> None:
        self.pid = 4242
        self._code = code
        self.terminated = False
        self.killed = False
        self.stderr = None
        self.stdout = io.BytesIO(stdout) if stdout is not None else None

    def poll(self) -> int | None:
        return self._code

    def terminate(self) -> None:
        self.terminated = True
        self._code = -15

    def kill(self) -> None:
        self.killed = True
        self._code = -9

    def wait(self, timeout: float | None = None) -> int:  # noqa: ARG002
        return self._code if self._code is not None else 0


class PacketTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.repo = self._dir.name

    def tearDown(self) -> None:
        self._dir.cleanup()

    def packet(self, **overrides) -> dict:
        return {"client": "claude", "repo": self.repo, **overrides}

    def test_defaults_are_the_owner_decided_ones(self) -> None:
        parsed = runner.validate_packet(self.packet())
        self.assertEqual("executor", parsed.role)
        self.assertEqual("workdir", parsed.environment, "the working copy comes first")

    def test_unknown_values_are_refused_by_name(self) -> None:
        for field, value in (
            ("client", "gemini"),
            ("role", "supervisor"),
            ("environment", "docker"),
            ("effort", "turbo"),
            ("expected_effect", "maybe"),
            ("review_mode", "friendly_review"),
        ):
            with self.subTest(field=field):
                with self.assertRaisesRegex(runner.LaunchError, field):
                    runner.validate_packet(self.packet(**{field: value}))

    def test_result_controls_are_typed_and_persisted(self) -> None:
        parsed = runner.validate_packet(
            self.packet(
                expected_effect="read_only_finding",
                review_mode="adversarial_review",
                interface_version="api-v3",
                resume=True,
            )
        )
        self.assertEqual("read_only_finding", parsed.expected_effect)
        self.assertEqual("adversarial_review", parsed.review_mode)
        self.assertEqual("api-v3", parsed.interface_version)
        self.assertTrue(parsed.resume)

    def test_resume_must_be_a_boolean(self) -> None:
        with self.assertRaisesRegex(runner.LaunchError, "resume must be a boolean"):
            runner.validate_packet(self.packet(resume="yes"))

    def test_a_missing_or_absent_repo_is_refused(self) -> None:
        with self.assertRaisesRegex(runner.LaunchError, "repo is required"):
            runner.validate_packet({"client": "claude"})
        with self.assertRaisesRegex(runner.LaunchError, "not a directory"):
            runner.validate_packet(self.packet(repo=os.path.join(self.repo, "absent")))

    def test_orchestrator_on_a_small_model_warns_without_blocking(self) -> None:
        parsed = runner.validate_packet(self.packet(role="orchestrator", model="claude-haiku-4-5"))
        self.assertEqual("orchestrator", parsed.role)
        self.assertEqual(1, len(parsed.warnings))
        self.assertIn("senior model", parsed.warnings[0])
        senior = runner.validate_packet(self.packet(role="orchestrator", model="claude-opus-5"))
        self.assertEqual((), senior.warnings)

    def test_a_worktree_needs_a_git_repository(self) -> None:
        with self.assertRaisesRegex(runner.LaunchError, "Git repository"):
            runner.validate_packet(self.packet(environment="worktree"))

    def test_control_characters_are_stripped_from_a_prompt(self) -> None:
        noisy = "do" + chr(0) + " the thing" + chr(7)
        parsed = runner.validate_packet(self.packet(prompt=noisy))
        self.assertEqual("do the thing", parsed.prompt)


class ArgvTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.repo = self._dir.name
        os.environ["VALKAMA_CLAUDE_BIN"] = sys.executable
        os.environ["VALKAMA_CODEX_BIN"] = sys.executable

    def tearDown(self) -> None:
        os.environ.pop("VALKAMA_CLAUDE_BIN", None)
        os.environ.pop("VALKAMA_CODEX_BIN", None)
        self._dir.cleanup()

    def build(self, **overrides) -> list[str]:
        return runner.client_argv(
            runner.validate_packet({"client": "claude", "repo": self.repo, **overrides})
        )

    def test_an_executor_cannot_spawn_subagents_at_all(self) -> None:
        argv = self.build(role="executor")
        self.assertIn("--disallowedTools", argv)
        self.assertEqual("Agent", argv[argv.index("--disallowedTools") + 1])

    def test_an_orchestrator_keeps_the_tool_it_was_chosen_for(self) -> None:
        self.assertNotIn("--disallowedTools", self.build(role="orchestrator"))

    def test_model_and_effort_reach_the_client_verbatim(self) -> None:
        argv = self.build(model="claude-opus-5", effort="high")
        self.assertEqual("claude-opus-5", argv[argv.index("--model") + 1])
        self.assertEqual("high", argv[argv.index("--effort") + 1])

    def test_claude_receives_exact_session_and_structured_result_contract(self) -> None:
        packet = runner.validate_packet(
            {"client": "claude", "repo": self.repo, "expected_effect": "read_only_finding"}
        )
        argv = runner.client_argv(packet, client_session_id="12345678-1234-1234-1234-123456789abc")
        self.assertEqual("json", argv[argv.index("--output-format") + 1])
        self.assertIn("--json-schema", argv)
        self.assertEqual(
            "12345678-1234-1234-1234-123456789abc",
            argv[argv.index("--session-id") + 1],
        )
        self.assertIn("read_only_finding", argv[2])

    def test_each_review_mode_specializes_the_client_enforced_schema(self) -> None:
        expected = {
            "decision_review": ["proceed", "change", "stop"],
            "acceptance_review": ["ship", "fix-first", "rethink"],
            "adversarial_review": ["risk-found", "no-material-risk-found"],
        }
        for mode, verdicts in expected.items():
            with self.subTest(mode=mode):
                packet = runner.validate_packet(
                    {"client": "claude", "repo": self.repo, "review_mode": mode}
                )
                argv = runner.client_argv(packet)
                schema = json.loads(argv[argv.index("--json-schema") + 1])
                self.assertIn("review_verdict", schema["required"])
                self.assertEqual(
                    verdicts,
                    schema["properties"]["review_verdict"]["enum"],
                )

    def test_codex_resume_uses_the_exact_id_not_last(self) -> None:
        packet = runner.validate_packet({"client": "codex", "repo": self.repo, "resume": True})
        argv = runner.client_argv(
            packet,
            client_session_id="12345678-1234-1234-1234-123456789abc",
            schema_path=os.path.join(self.repo, "schema.json"),
            result_path=os.path.join(self.repo, "result.json"),
        )
        self.assertEqual("resume", argv[2])
        self.assertIn("12345678-1234-1234-1234-123456789abc", argv)
        self.assertNotIn("--last", argv)

    def test_codex_model_and_effort_are_options_before_the_exact_task(self) -> None:
        session_id = "12345678-1234-1234-1234-123456789abc"
        packet = runner.validate_packet(
            {
                "client": "codex",
                "repo": self.repo,
                "resume": True,
                "model": "gpt-5.6-sol",
                "effort": "high",
            }
        )
        argv = runner.client_argv(
            packet,
            client_session_id=session_id,
            schema_path=os.path.join(self.repo, "schema.json"),
            result_path=os.path.join(self.repo, "result.json"),
        )
        self.assertLess(argv.index("--model"), argv.index(session_id))
        self.assertLess(argv.index("-c"), argv.index(session_id))
        self.assertEqual('model_reasoning_effort="high"', argv[argv.index("-c") + 1])

    def test_codex_uses_exec_and_never_the_claude_flags(self) -> None:
        argv = runner.client_argv(runner.validate_packet({"client": "codex", "repo": self.repo}))
        self.assertEqual("exec", argv[1])
        self.assertNotIn("--disallowedTools", argv)

    def test_an_unenforceable_executor_role_says_so_instead_of_pretending(self) -> None:
        # Codex has no switch that removes subagent spawning, so the role is
        # advisory there. Silence would make the packet look enforced.
        codex = runner.validate_packet({"client": "codex", "repo": self.repo})
        self.assertEqual("executor", codex.role)
        self.assertEqual(1, len(codex.warnings))
        self.assertIn("advisory", codex.warnings[0])
        claude = runner.validate_packet({"client": "claude", "repo": self.repo})
        self.assertEqual((), claude.warnings, "claude enforces it, so nothing to say")

    def test_a_missing_client_binary_names_its_override(self) -> None:
        os.environ.pop("VALKAMA_CLAUDE_BIN")
        original = runner.shutil.which
        runner.shutil.which = lambda _name: None
        try:
            with self.assertRaisesRegex(runner.LaunchError, "VALKAMA_CLAUDE_BIN"):
                self.build()
        finally:
            runner.shutil.which = original


class EnvironmentTests(unittest.TestCase):
    def test_the_spawned_session_learns_which_work_item_it_serves(self) -> None:
        environment = runner.launch_environment({"PATH": "x"}, "QA-42", "launch-abc", "QA")
        self.assertEqual("QA-42", environment["VALKAMA_LAUNCH_WORK_ITEM"])
        self.assertEqual("launch-abc", environment["VALKAMA_LAUNCH_ID"])
        self.assertEqual("QA", environment["VALKAMA_LAUNCH_SPACE"])
        self.assertEqual("x", environment["PATH"], "the base environment survives")

    def test_a_worktree_lands_beside_its_repository_never_inside(self) -> None:
        path = runner.worktree_path(os.path.join("C:", "work", "alpha"), 7)
        self.assertTrue(path.endswith("alpha-card7"))
        self.assertNotIn(os.path.join("alpha", "alpha-card7"), path)


class RunnerLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.repo = self._dir.name
        os.environ["VALKAMA_CLAUDE_BIN"] = sys.executable
        self.spawned: list[tuple[list[str], str, dict]] = []
        self.process = FakeProcess()

        def spawn(argv, cwd, environment):
            self.spawned.append((argv, cwd, environment))
            return self.process

        self.runner = runner.Runner(spawn=spawn)

    def tearDown(self) -> None:
        os.environ.pop("VALKAMA_CLAUDE_BIN", None)
        self._dir.cleanup()

    def packet(self, **overrides) -> dict:
        return {"client": "claude", "repo": self.repo, **overrides}

    def test_a_launch_records_its_shape_without_leaking_the_prompt(self) -> None:
        started = self.runner.launch("QA-11", self.packet(prompt="secret plan details"))
        self.assertTrue(started["launch_id"].startswith("launch-"))
        self.assertEqual(self.repo, started["cwd"])
        self.assertNotIn("secret", " ".join(started["argv_shape"]))
        argv, cwd, environment = self.spawned[0]
        self.assertTrue(any("secret plan details" in item for item in argv))
        self.assertEqual("QA-11", environment["VALKAMA_LAUNCH_WORK_ITEM"])
        self.assertEqual(self.repo, cwd)

    def test_one_work_item_cannot_be_launched_twice_while_it_runs(self) -> None:
        self.runner.launch("QA-12", self.packet())
        with self.assertRaisesRegex(runner.LaunchError, "already has a running launch"):
            self.runner.launch("QA-12", self.packet())

    def test_a_finished_launch_can_be_relaunched(self) -> None:
        self.runner.launch("QA-13", self.packet())
        self.process._code = 0
        self.runner.launch("QA-13", self.packet())
        self.assertEqual(2, len(self.spawned))

    def test_stopping_forgets_the_launch_and_reports_it(self) -> None:
        self.runner.launch("QA-14", self.packet())
        stopped = self.runner.stop("QA-14")
        self.assertTrue(stopped["stopped"])
        self.assertEqual([], self.runner.running())
        with self.assertRaisesRegex(runner.LaunchError, "no launch in this platform"):
            self.runner.stop("QA-14")

    def test_stopping_an_already_finished_launch_is_honest_about_it(self) -> None:
        self.runner.launch("QA-15", self.packet())
        self.process._code = 3
        stopped = self.runner.stop("QA-15")
        self.assertFalse(stopped["stopped"])
        self.assertEqual(3, stopped["exit_code"])

    def test_reap_reports_each_ending_once(self) -> None:
        self.runner.launch("QA-16", self.packet())
        self.assertEqual([], self.runner.reap())
        self.process._code = 1
        ended = self.runner.reap()
        self.assertEqual(["QA-16"], [item["reference"] for item in ended])
        self.assertEqual(1, ended[0]["exit_code"])
        self.assertEqual([], self.runner.reap(), "an ending is reported once")

    def test_a_spawn_failure_is_a_launch_error_not_a_crash(self) -> None:
        def refuse(_argv, _cwd, _environment):
            raise OSError("no such executable")

        failing = runner.Runner(spawn=refuse)
        with self.assertRaisesRegex(runner.LaunchError, "cannot start claude"):
            failing.launch(17, self.packet())

    def test_reap_classifies_structured_delivery_and_keeps_exact_identity(self) -> None:
        payload = {
            "session_id": "12345678-1234-1234-1234-123456789abc",
            "structured_output": {
                "outcome": "complete",
                "expected_effect": "change_required",
                "delivery": "changed owned file",
                "oracle": "tests passed",
                "unresolved": "none",
            },
        }
        self.process.stdout = io.BytesIO((json.dumps(payload) + "\n").encode())
        started = self.runner.launch("QA-18", self.packet())
        self.process._code = 0
        ended = self.runner.reap()[0]
        self.assertEqual("complete", ended["result"]["outcome"])
        self.assertTrue(ended["result"]["structured"])
        self.assertEqual(started["client_session_id"], ended["client_session_id"])

    def test_reap_hands_over_what_it_captured_and_keeps_no_verdict_of_its_own(self) -> None:
        # The verdict itself is `executions.results`' answer and is tested
        # against that module; what belongs here is that the runner hands over
        # the output it captured and the exit code it saw.
        self.runner.launch("QA-19", self.packet())
        self.process._code = 0
        ended = self.runner.reap()[0]
        self.assertEqual("unexpected_no_change", ended["result"]["outcome"])
        self.assertFalse(ended["result"]["structured"])
        self.assertEqual(0, ended["exit_code"])

    def test_the_launch_asks_the_capability_never_the_client_name(self) -> None:
        # Both facts are fields on `DriverCapabilities`: Claude Code takes an
        # assigned identity, and Codex needs a file to write its result into. A
        # name test here would be a second answer that can drift from theirs.
        os.environ["VALKAMA_CODEX_BIN"] = sys.executable
        self.addCleanup(os.environ.pop, "VALKAMA_CODEX_BIN", None)

        assigned = self.runner.launch("QA-34", self.packet())
        self.assertTrue(assigned["client_session_id"], "claude assigns its identity up front")
        self.assertEqual("", self.runner._running["QA-34"].result_path)

        self.process = FakeProcess()
        observed = self.runner.launch("QA-35", self.packet(client="codex"))
        self.assertEqual("", observed["client_session_id"], "codex mints and announces its own")
        live = self.runner._running["QA-35"]
        self.assertTrue(live.result_path.endswith("result.json"))
        self.assertTrue(
            os.path.isfile(os.path.join(os.path.dirname(live.result_path), "result.schema.json"))
        )

    def test_a_stop_and_a_reap_cannot_both_claim_one_ending(self) -> None:
        # Two threads share the registry. Before the claim was atomic, a stop
        # arriving while the watcher reaped reported a cancellation over a
        # verdict that had already been observed.
        self.runner.launch("QA-33", self.packet())
        self.process._code = 0
        start = threading.Barrier(2)
        claims: list[str] = []

        def stopper() -> None:
            start.wait(5)
            try:
                self.runner.stop("QA-33")
            except runner.LaunchError:
                return
            claims.append("stop")

        def reaper() -> None:
            start.wait(5)
            claims.extend("reap" for _ in self.runner.reap())

        threads = [threading.Thread(target=stopper), threading.Thread(target=reaper)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual(1, len(claims), f"exactly one path owns the ending, got {claims}")
        self.assertEqual([], self.runner.running())


class WorktreeTests(unittest.TestCase):
    """Real Git, because the point is that the checkout actually appears."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.repo = os.path.join(self._dir.name, "repo")
        os.makedirs(self.repo)
        for command in (
            ["git", "init", "-q"],
            ["git", "config", "user.email", "runner@test"],
            ["git", "config", "user.name", "runner"],
        ):
            subprocess.run(command, cwd=self.repo, check=True, capture_output=True)
        with open(os.path.join(self.repo, "file.txt"), "w", encoding="utf-8") as handle:
            handle.write("seed\n")
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-qm", "seed"], cwd=self.repo, check=True, capture_output=True
        )

    def tearDown(self) -> None:
        subprocess.run(
            ["git", "-C", self.repo, "worktree", "prune"], capture_output=True, check=False
        )
        self._dir.cleanup()

    def test_a_worktree_is_created_once_and_reused(self) -> None:
        first, created = runner.prepare_worktree(self.repo, 21)
        self.assertTrue(os.path.isfile(os.path.join(first, "file.txt")))
        self.assertTrue(created["registered"])
        second, reused = runner.prepare_worktree(self.repo, 21)
        self.assertEqual(first, second)
        self.assertTrue(reused["registered"])
        branches = subprocess.run(
            ["git", "-C", self.repo, "branch", "--list", "card/21"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertIn("card/21", branches.stdout)

    def test_an_unregistered_existing_target_is_refused(self) -> None:
        target = runner.worktree_path(self.repo, 22)
        os.makedirs(target)
        with self.assertRaisesRegex(runner.LaunchError, "not registered"):
            runner.prepare_worktree(self.repo, 22)

    def test_a_nested_directory_cannot_impersonate_the_repository_root(self) -> None:
        nested = os.path.join(self.repo, "nested")
        os.makedirs(nested)
        with self.assertRaisesRegex(runner.LaunchError, "Git top-level"):
            runner.worktree_preflight(nested, 23)

    def test_a_reparse_target_is_refused_before_git_mutation(self) -> None:
        # The check moved to its owner: one answer for the runner and the
        # evaluation sandbox, which used to disagree about junctions.
        with mock.patch.object(git_worktrees, "is_reparse_point", return_value=True):
            with self.assertRaisesRegex(runner.LaunchError, "reparse point"):
                runner.worktree_preflight(self.repo, 24)

    def test_a_submodule_root_is_not_automatically_given_a_worktree(self) -> None:
        source = os.path.join(self._dir.name, "submodule-source")
        os.makedirs(source)
        for command in (
            ["git", "init", "-q"],
            ["git", "config", "user.email", "runner@test"],
            ["git", "config", "user.name", "runner"],
        ):
            subprocess.run(command, cwd=source, check=True, capture_output=True)
        with open(os.path.join(source, "child.txt"), "w", encoding="utf-8") as handle:
            handle.write("child\n")
        subprocess.run(["git", "add", "-A"], cwd=source, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-qm", "child"], cwd=source, check=True, capture_output=True
        )
        target = os.path.join(self.repo, "vendor", "child")
        subprocess.run(
            [
                "git",
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                "-q",
                source,
                os.path.join("vendor", "child"),
            ],
            cwd=self.repo,
            check=True,
            capture_output=True,
        )
        with self.assertRaisesRegex(runner.LaunchError, "submodule"):
            runner.worktree_preflight(target, 25)


if __name__ == "__main__":
    unittest.main()
