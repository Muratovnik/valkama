"""What `tests/run_record.py` owes: a record that says where and on what it ran, and a check that holds it to that.

Every working tree here is a repository this test made, and a second worktree of it;
the record of a whole `gates` run is the one exception, made in this checkout with
its steps stood in for.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import git_worktrees, processes
from tests import isolated, run_record

ROOT = Path(__file__).resolve().parents[1]
#: The mark the spec reporter of `node --test` starts its totals with: INFORMATION SOURCE.
SPEC = chr(0x2139)


class TreeCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-record-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        environment = mock.patch.dict(
            os.environ,
            {
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                # Whatever holds the temporary directory is not searched for a repository.
                "GIT_CEILING_DIRECTORIES": str(self.root),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.write("server/app.py", "print('one')\n")
        self.write(".gitignore", "/tmp/\n")
        self.commit("feat: the first commit")
        self.other = self.root / "other"
        self.git("worktree", "add", "-b", "other", str(self.other))

    def git(self, *arguments: str, cwd: Path | None = None) -> str:
        result = processes.run_text(
            [
                "git",
                "-C",
                str(cwd or self.repo),
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                *arguments,
            ]
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout

    def write(self, name: str, text: str) -> None:
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))

    def commit(self, subject: str) -> None:
        self.git("add", "-A")
        self.git("commit", "-m", subject)

    def record_of(self, tree: Path, run: str = "run") -> Path:
        """A record of a one-step run made in `tree` as it is now, kept in its ignored `tmp/run`."""

        out = tree / "tmp" / run
        out.mkdir(parents=True, exist_ok=True)
        log = out / "only.log"
        log.write_bytes(b"one\n")
        started = run_record.begin(tree, {"python": "3.11.0"})
        step = run_record.step("only", [sys.executable, "-c", "print('one')"], tree, log, 0)
        return run_record.write(out, started, [step], 0)

    def checked(self, record: Path, tree: Path) -> tuple[int, str]:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run_record.main(["check", str(record), "--tree", str(tree)])
        return code, output.getvalue()


class CheckTests(TreeCase):
    def test_a_record_of_this_tree_as_it_is_is_accepted(self) -> None:
        record = self.record_of(self.repo)

        code, said = self.checked(record, self.repo)

        self.assertEqual(0, code, said)
        head = self.git("rev-parse", "HEAD").strip()
        self.assertIn(f"accepted: {record} was made in ", said)
        self.assertIn(f" at {head}; passed: only exit=0", said)

    def test_an_accepted_record_of_a_failed_run_exits_apart_from_a_pass_and_a_refusal(
        self,
    ) -> None:
        out = self.repo / "tmp" / "failed"
        out.mkdir(parents=True)
        log = out / "step.log"
        log.write_bytes(b"x\n")
        steps = [
            run_record.step("lint", ["lint"], self.repo, log, 0),
            run_record.step("unit", ["unit"], self.repo, log, 2),
            run_record.step("web", ["web"], self.repo, log, None),
        ]
        failed = run_record.write(out, run_record.begin(self.repo, {}), steps, 1)
        nothing = run_record.write(self.repo / "tmp", run_record.begin(self.repo, {}), [], 1)

        code, said = self.checked(failed, self.repo)

        # The codes `check --help` documents: 0 passed, 1 failed, 3 refused.
        self.assertEqual(1, code, said)
        self.assertIn("; failed: unit, web; ran: lint exit=0, unit exit=2, web exit=None", said)
        self.assertNotIn("passed", said)
        code, said = self.checked(nothing, self.repo)
        self.assertEqual(1, code)
        self.assertIn("; failed: no step ran; ran: \n", said)
        self.assertEqual(0, self.checked(self.record_of(self.repo), self.repo)[0])
        self.assertEqual(3, self.checked(failed, self.other)[0])
        with contextlib.redirect_stdout(io.StringIO()) as helped, self.assertRaises(SystemExit):
            run_record.main(["check", "--help"])
        for line in (
            "0  accepted, and the run it records passed",
            "1  accepted, and the run it records failed",
            "3  refused",
        ):
            self.assertIn(line, helped.getvalue())

    def test_a_record_of_another_worktree_of_the_repository_is_refused(self) -> None:
        # Both trees are at the same commit and clean: only which tree it is differs.
        record = self.record_of(self.other)

        code, said = self.checked(record, self.repo)

        self.assertEqual(run_record.REFUSED, code)
        self.assertIn(
            f"it was made in {git_worktrees.canonical(self.other)},"
            f" not in {git_worktrees.canonical(self.repo)}",
            said,
        )
        self.assertNotIn("commit", said)
        # The present control: that record is accepted where it was made.
        self.assertEqual(0, self.checked(record, self.other)[0])

    def test_a_record_made_at_another_commit_is_refused(self) -> None:
        record = self.record_of(self.repo)
        before = self.git("rev-parse", "HEAD").strip()
        self.write("server/app.py", "print('two')\n")
        self.commit("fix: the second commit")
        after = self.git("rev-parse", "HEAD").strip()

        code, said = self.checked(record, self.repo)

        self.assertEqual(run_record.REFUSED, code)
        self.assertIn(f"it was made at commit {before}, and this tree is at {after}", said)
        self.assertNotIn("it was made in ", said)

    def test_a_clean_record_is_refused_once_the_tree_has_changes_and_accepted_again_without(
        self,
    ) -> None:
        record = self.record_of(self.repo)
        self.write("server/app.py", "print('edited')\n")

        code, said = self.checked(record, self.repo)

        self.assertEqual(run_record.REFUSED, code)
        self.assertIn("it was made in a clean tree, and this tree has uncommitted changes", said)
        self.write("server/app.py", "print('one')\n")
        self.assertEqual(0, self.checked(record, self.repo)[0])

    def test_a_record_of_uncommitted_changes_holds_for_those_changes_only(self) -> None:
        self.write("server/app.py", "print('edited')\n")
        self.write("server/new.py", "print('new')\n")
        record = self.record_of(self.repo)
        self.assertEqual(0, self.checked(record, self.repo)[0])

        for name, text in (("server/app.py", "print('edited again')\n"), ("server/new.py", "x\n")):
            with self.subTest(changed=name):
                kept = (self.repo / name).read_bytes()
                self.write(name, text)
                code, said = self.checked(record, self.repo)
                self.assertEqual(run_record.REFUSED, code)
                self.assertIn("it was made on other uncommitted changes than this tree has", said)
                (self.repo / name).write_bytes(kept)
        self.assertEqual(0, self.checked(record, self.repo)[0])

    def test_staging_what_is_on_disk_leaves_a_record_of_it_accepted(self) -> None:
        self.write("server/app.py", "print('edited')\n")
        self.write("server/new.py", "print('new')\n")
        record = self.record_of(self.repo)

        for staging in (("add", "server/app.py"), ("add", "-N", "server/new.py"), ("add", "-A")):
            with self.subTest(git=staging):
                self.git(*staging)
                code, said = self.checked(record, self.repo)
                self.assertEqual(0, code, said)
        # Staged in a clean tree too: taking a file out of the index leaves it on disk as committed.
        self.git("reset", "-q")
        self.write("server/app.py", "print('one')\n")
        (self.repo / "server" / "new.py").unlink()
        clean = self.record_of(self.repo, "clean")
        self.git("rm", "-q", "--cached", "server/app.py")
        self.assertEqual(0, self.checked(clean, self.repo)[0])
        # The control: what is staged differs from the record once the content on disk does.
        self.git("reset", "-q")
        self.write("server/app.py", "print('edited')\n")
        record = self.record_of(self.repo)
        self.write("server/app.py", "print('edited again')\n")
        self.git("add", "server/app.py")
        code, said = self.checked(record, self.repo)
        self.assertEqual(run_record.REFUSED, code)
        self.assertIn("it was made on other uncommitted changes than this tree has", said)

    def test_an_untracked_file_counts_where_git_status_hides_untracked_files(self) -> None:
        self.git("config", "status.showUntrackedFiles", "no")
        record = self.record_of(self.repo)
        self.write("tests/test_new.py", "print('new')\n")

        code, said = self.checked(record, self.repo)

        self.assertEqual(run_record.REFUSED, code)
        self.assertIn("it was made in a clean tree, and this tree has uncommitted changes", said)
        made = self.record_of(self.repo, "with-file")
        self.write("tests/test_new.py", "print('other')\n")
        self.assertIn("other uncommitted changes", self.checked(made, self.repo)[1])
        # The control: without the file the tree is the clean one the first record was made in.
        (self.repo / "tests" / "test_new.py").unlink()
        self.assertEqual(0, self.checked(record, self.repo)[0])

    def test_a_record_of_another_format_is_refused_with_its_format(self) -> None:
        record = self.record_of(self.repo)
        older = json.loads(record.read_text(encoding="utf-8"))
        record.write_text(json.dumps({**older, "format": 1}), encoding="utf-8")

        code, said = self.checked(record, self.repo)

        self.assertEqual(run_record.REFUSED, code)
        self.assertIn(
            f"is a run record of format 1, and this check compares a tree as format {run_record.FORMAT}",
            said,
        )

    def test_what_is_not_a_record_or_not_a_tree_is_refused(self) -> None:
        broken = self.root / "broken.json"
        broken.write_text('{"tree": {}}', encoding="utf-8")
        code, said = self.checked(broken, self.repo)
        self.assertEqual(run_record.REFUSED, code)
        self.assertIn("is not a readable run record", said)

        plain = self.root / "plain"
        plain.mkdir()
        code, said = self.checked(self.record_of(self.repo), plain)
        self.assertEqual(run_record.REFUSED, code)
        self.assertIn("is not a Git working tree", said)

    def test_a_result_directory_the_tree_sees_is_warned_about_and_an_ignored_one_is_not(
        self,
    ) -> None:
        seen = self.repo / "results"
        seen.mkdir()
        warning = run_record.placement_warning(self.repo, seen)
        assert warning is not None
        self.assertIn("not ignored", warning)
        ignored = self.repo / "tmp" / "run"
        ignored.mkdir(parents=True)
        self.assertIsNone(run_record.placement_warning(self.repo, ignored))
        self.assertIsNone(run_record.placement_warning(self.repo, self.root / "outside"))


class CountTests(unittest.TestCase):
    """The tests a test step ran, read from its log as each runner closes its run."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-count-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.log = Path(directory.name) / "step.log"

    def counted(self, name: str, text: str) -> int | None:
        self.log.write_bytes(text.encode("utf-8"))
        return run_record.tests_run(name, self.log)

    def test_each_runner_closing_line_is_counted(self) -> None:
        cases = {
            "unittest": ("....\n----\nRan 4321 tests in 98.765s\n\nOK (skipped=3)\n", 4321),
            "web-test": (
                " Test Files  2 failed | 140 passed (142)\n"
                "      Tests  3 failed | 2051 passed (2054)\n   Duration  31.2s\n",
                2054,
            ),
            "desktop-test": (f"{SPEC} tests 57\n{SPEC} suites 0\n{SPEC} pass 57\n", 57),
        }
        for name, (text, expected) in cases.items():
            with self.subTest(step=name):
                self.assertEqual(expected, self.counted(name, text))
        self.assertEqual(9, self.counted("desktop-test", "TAP version 13\n# tests 9\n# pass 9\n"))

    def test_a_log_that_does_not_say_is_no_count_rather_than_zero(self) -> None:
        self.assertIsNone(self.counted("unittest", "Traceback (most recent call last):\n"))
        self.assertIsNone(self.counted("web-test", " Test Files  2 passed (2)\n"))

    def test_the_counted_steps_are_the_test_steps_of_the_gate_list(self) -> None:
        names = {step.name for step in isolated.GATE_STEPS}
        self.assertEqual({"unittest", "web-test", "desktop-test"}, set(run_record.TEST_COUNTS))
        self.assertLessEqual(set(run_record.TEST_COUNTS), names)


class GatesRecordTests(unittest.TestCase):
    """The record a `gates` run writes, with its steps stood in for."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-gates-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.out = Path(directory.name).resolve() / "out"

    def test_every_step_is_recorded_with_its_command_exit_and_tests(self) -> None:
        steps = (
            isolated.Step("unittest", "python", "python -c \"print('Ran 12 tests in 0.1s')\""),
            isolated.Step("bad", "python", 'python -c "raise SystemExit(5)"'),
        )
        with (
            mock.patch.object(isolated, "GATE_STEPS", steps),
            mock.patch.object(isolated.release, "require_toolchain", return_value={}),
            contextlib.redirect_stdout(io.StringIO()) as said,
        ):
            code = isolated.main(["gates", "--out", str(self.out)])

        self.assertEqual(1, code)
        path = self.out / run_record.NAME
        self.assertIn(f"record: {path}", said.getvalue())
        record = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(1, record["result"])
        self.assertEqual(git_worktrees.canonical(ROOT), record["tree"]["worktree"])
        self.assertRegex(record["tree"]["head"], r"^[0-9a-f]{40}$")
        self.assertIsInstance(record["tree"]["dirty"], bool)
        self.assertEqual(sys.version.split()[0], record["tools"]["python"])
        self.assertIn("ruff", record["tools"])
        self.assertNotIn("node", record["tools"], "no npm step ran")
        self.assertEqual(
            [
                {
                    "name": "unittest",
                    "argv": [sys.executable, "-c", "print('Ran 12 tests in 0.1s')"],
                    "cwd": str(ROOT),
                    "log": "unittest.log",
                    "exit": 0,
                    "tests": 12,
                },
                {
                    "name": "bad",
                    "argv": [sys.executable, "-c", "raise SystemExit(5)"],
                    "cwd": str(ROOT),
                    "log": "bad.log",
                    "exit": 5,
                },
            ],
            record["steps"],
        )

    def test_a_refused_step_is_recorded_as_not_run(self) -> None:
        run = isolated.Run("web-test", ["npm", "test"], self.out / "web", needs_modules=True)
        (self.out / "web").mkdir(parents=True)

        with contextlib.redirect_stdout(io.StringIO()):
            code = isolated.run_gates([run], self.out, os.environ, record={"format": 1})

        self.assertEqual(1, code)
        record = json.loads((self.out / run_record.NAME).read_text(encoding="utf-8"))
        self.assertEqual([None, None], [record["steps"][0]["exit"], record["steps"][0]["tests"]])
        self.assertEqual(1, record["result"])


if __name__ == "__main__":
    unittest.main()
