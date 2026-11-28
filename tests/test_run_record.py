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
import re
import sys
import tempfile
import unittest
from collections.abc import Mapping
from pathlib import Path
from unittest import mock

from server import git_worktrees, processes, store_lock
from tests import heavy_gate, isolated, legacy_lock, run_record
from windows import release

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

    def checked(self, record: Path, tree: Path, *required: str) -> tuple[int, str]:
        demands = [word for name in required for word in ("--require", name)]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = run_record.main(["check", *demands, str(record), "--tree", str(tree)])
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
        self.assertNotIn("changed the tree itself", said, "it changed after the run, not in it")
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


class RequireTests(TreeCase):
    """`check --require NAME`: a record that does not show the step ran attests nothing about it."""

    def record_with(self, exits: dict[str, int | None]) -> Path:
        """A record made in this tree as it is now, of one step a name, each with its exit code."""

        out = self.repo / "tmp" / "steps"
        out.mkdir(parents=True, exist_ok=True)
        log = out / "step.log"
        log.write_bytes(b"x\n")
        steps = [
            run_record.step(name, [name], self.repo, log, code) for name, code in exits.items()
        ]
        result = 0 if all(code == 0 for code in exits.values()) else 1
        return run_record.write(out, run_record.begin(self.repo, {}), steps, result)

    def test_a_record_without_a_required_step_is_refused_naming_the_step(self) -> None:
        record = self.record_with({"unit": 0, "subjects": 0})

        code, said = self.checked(record, self.repo, "typos")

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn(f"refused: {record} has no step typos, which this check requires", said)
        self.assertIn("ran: unit exit=0, subjects exit=0", said)
        self.assertNotIn("accepted", said)
        # The control: the same record without the requirement passes as it always has.
        code, said = self.checked(record, self.repo)
        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn("; passed: unit exit=0, subjects exit=0", said)

    def test_only_the_required_steps_the_record_lacks_are_named(self) -> None:
        record = self.record_with({"typos": 0, "unit": 0})

        code, said = self.checked(record, self.repo, "typos", "subjects", "ruff")

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("has no step subjects, ruff, which this check requires", said)
        self.assertNotIn("no step typos", said)

    def test_a_required_step_that_ran_and_passed_is_accepted(self) -> None:
        record = self.record_with({"unit": 0, "typos": 0})

        code, said = self.checked(record, self.repo, "typos")

        self.assertEqual(run_record.PASSED, code, said)
        self.assertIn("; passed: unit exit=0, typos exit=0", said)

    def test_a_required_step_that_failed_or_was_refused_fails_the_check_naming_it(self) -> None:
        for exit_code in (2, None):
            with self.subTest(exit=exit_code):
                record = self.record_with({"unit": 0, "typos": exit_code})

                code, said = self.checked(record, self.repo, "typos")

                self.assertEqual(run_record.FAILED, code, said)
                self.assertIn("; failed: typos (required); ran: ", said)

    def test_a_required_step_does_not_turn_a_refusal_of_another_tree_into_an_acceptance(
        self,
    ) -> None:
        record = self.record_with({"typos": 0})

        code, said = self.checked(record, self.other, "typos")

        self.assertEqual(run_record.REFUSED, code, said)
        self.assertIn("does not describe", said)


class RunTests(TreeCase):
    """`run`: the checks no gate step is, a command at a time, into one record of one tree state."""

    def setUp(self) -> None:
        super().setUp()
        self.out = self.repo / "tmp" / "checks"
        versions = mock.patch.object(run_record, "tool_versions", return_value={"python": "3"})
        versions.start()
        self.addCleanup(versions.stop)
        # The machine's gate is another checkout's business; a test asks a stand-in.
        note = mock.patch.object(heavy_gate, "load_note", return_value=None)
        self.load_note = note.start()
        self.addCleanup(note.stop)

    def ran(
        self, *command: str, name: str | None = None, environment: dict[str, str] | None = None
    ) -> tuple[int, str]:
        with contextlib.redirect_stdout(io.StringIO()) as said:
            code = run_record.run(
                self.out,
                command,
                cwd=self.repo,
                name=name,
                environment=os.environ if environment is None else environment,
                root=self.repo,
            )
        return code, said.getvalue()

    def recorded(self) -> dict:
        return json.loads((self.out / run_record.NAME).read_text(encoding="utf-8"))

    def test_each_command_joins_the_record_of_the_tree_as_it_is_and_check_holds_it(self) -> None:
        passing = ("python", "-c", "print('Ran 4 tests in 0.2s')")
        failing = ("python", "-c", "import sys; sys.stderr.write('broke\\n'); raise SystemExit(5)")

        self.assertEqual(0, self.ran(*passing)[0])
        code, said = self.ran(*failing, name="unit")
        self.assertEqual(5, code, "the exit code is the command's")
        self.assertEqual(5, self.ran(*failing, name="unit")[0])

        record = self.recorded()
        names = ["python--c-print-Ran-4-tests-in-0.2s", "unit", "unit-2"]
        self.assertEqual(names, [entry["name"] for entry in record["steps"]])
        self.assertEqual([0, 5, 5], [entry["exit"] for entry in record["steps"]])
        self.assertEqual(4, record["steps"][0]["tests"])
        self.assertNotIn("tests", record["steps"][1], "a log that counts nothing is no test step")
        self.assertEqual(sys.executable, record["steps"][0]["argv"][0])
        self.assertEqual(1, record["result"])
        self.assertIn(b"broke", (self.out / "logs" / "unit.log").read_bytes())
        self.assertRegex(said, r"(?m)^unit +exit=5  broke$")
        code, said = self.checked(self.out / run_record.NAME, self.repo)
        self.assertEqual(run_record.FAILED, code, said)
        self.assertIn("; failed: unit, unit-2; ran: ", said)

    def test_check_takes_the_directory_run_wrote_the_record_in(self) -> None:
        self.ran("python", "-c", "pass", name="reads")

        by_file = self.checked(self.out / run_record.NAME, self.repo)
        by_directory = self.checked(self.out, self.repo)

        self.assertEqual(run_record.PASSED, by_directory[0], by_directory[1])
        self.assertEqual(by_file, by_directory)

    def test_a_tree_that_changed_since_the_record_gets_a_new_one_and_is_told_why(self) -> None:
        self.ran("python", "-c", "pass", name="first")
        self.write("server/app.py", "print('edited')\n")

        code, said = self.ran("python", "-c", "pass", name="second")

        self.assertEqual(0, code)
        self.assertIn("a new record replaces ", said)
        self.assertIn("it was made in a clean tree, and this tree has uncommitted changes", said)
        self.assertEqual(["second"], [entry["name"] for entry in self.recorded()["steps"]])
        self.assertTrue(self.recorded()["tree"]["dirty"])
        self.assertEqual(run_record.PASSED, self.checked(self.out / run_record.NAME, self.repo)[0])

    def test_a_run_that_changes_the_tree_says_so_and_check_names_it_when_it_refuses(self) -> None:
        self.ran("python", "-c", "pass", name="reads")
        self.assertEqual([], self.recorded()["changed_by_run"])
        rewrite = "open('server/app.py', 'w').write('built\\n')"

        self.ran("python", "-c", rewrite, name="builds")

        said = self.checked(self.out / run_record.NAME, self.repo)[1]
        self.assertIn(
            "; the run it records changed the tree itself: it was made in a clean tree,"
            " and this tree has uncommitted changes",
            said,
        )

    def test_a_failed_command_says_which_heavy_runs_were_going_and_a_passing_one_does_not(
        self,
    ) -> None:
        self.load_note.return_value = "heavy runs were going as this run ended: R"

        said = self.ran("python", "-c", "pass")[1]
        self.assertNotIn("heavy runs were going", said)
        self.load_note.assert_not_called()
        said = self.ran("python", "-c", "raise SystemExit(1)")[1]
        self.assertIn("heavy runs were going as this run ended: R\n", said)

    def test_the_command_runs_in_the_environment_given_and_under_no_lease(self) -> None:
        show = "import os; print(os.environ.get('VALKAMA_PROBE'), os.environ.get(sys.argv[1]))"
        given = {
            name: value
            for name, value in os.environ.items()
            if name != legacy_lock.HELD_BY_ANCESTOR
        }
        with (
            mock.patch.object(heavy_gate, "run", side_effect=AssertionError("took a lease")),
            mock.patch.object(heavy_gate, "hold_until_exit", side_effect=AssertionError),
        ):
            code, _ = self.ran(
                "python",
                "-c",
                f"import sys; {show}",
                legacy_lock.HELD_BY_ANCESTOR,
                name="env",
                environment={**given, "VALKAMA_PROBE": "given"},
            )

        self.assertEqual(0, code)
        # No marker of a holder, so a targeted test run in it still names the holder when it fails.
        self.assertEqual(b"given None", (self.out / "logs" / "env.log").read_bytes().strip())

    def during(self, first: str, then: tuple[str, ...]) -> contextlib.AbstractContextManager:
        """`_run_step` with the first run of the step named `first` doing the run `then` meanwhile.

        Two runs into one `out` at once, in the order of the race: the second, named
        `second`, starts and ends while the first one's command is still going.
        """

        real = isolated._run_step
        pending = [then]

        def step(run: isolated.Run, log: Path, environment: Mapping[str, str]) -> int:
            if run.name == first and pending:
                self.ran(*pending.pop(), name="second")
            return real(run, log, environment)

        return mock.patch.object(isolated, "_run_step", side_effect=step)

    def test_a_run_that_ends_while_another_into_the_same_out_goes_keeps_both_steps(self) -> None:
        with self.during("suite", ("python", "-c", "print('typos ran')")):
            self.ran("python", "-c", "print('Ran 4 tests in 0.2s')", name="suite")

        steps = self.recorded()["steps"]
        self.assertEqual(["second", "suite"], [entry["name"] for entry in steps])
        self.assertEqual(4, steps[1]["tests"])
        self.assertEqual(run_record.PASSED, self.checked(self.out, self.repo, "second")[0])

    def test_two_runs_of_the_same_words_at_once_each_keep_a_step_and_a_log_of_their_own(
        self,
    ) -> None:
        with self.during("second", ("python", "-c", "print('inner')")):
            self.ran("python", "-c", "print('outer')", name="second")

        steps = self.recorded()["steps"]
        self.assertEqual(["second", "second-2"], [entry["name"] for entry in steps])
        logs = self.out / isolated.LOGS
        self.assertEqual(b"inner", (logs / "second.log").read_bytes().strip())
        self.assertEqual(b"outer", (logs / "second-2.log").read_bytes().strip())
        self.assertEqual(
            ["second-2.log", "second.log"],
            sorted(path.name for path in logs.iterdir()),
            "a log under its running name is left behind",
        )

    def test_a_run_waits_for_a_live_holder_of_the_lock_and_records_nothing_past_the_wait(
        self,
    ) -> None:
        self.ran("python", "-c", "pass", name="first")
        before = (self.out / run_record.NAME).read_bytes()
        with (
            (self.out / run_record.LOCK).open("a+b") as held,
            mock.patch.object(run_record, "LOCK_WAIT_SECONDS", 0.2),
        ):
            self.assertTrue(store_lock.try_lock(held))
            try:
                code, said = self.ran("python", "-c", "pass", name="blocked")
            finally:
                store_lock.unlock(held)

        self.assertEqual(run_record.REFUSED, code)
        self.assertIn(f"not recorded: {self.out / run_record.LOCK} stayed locked for 0.2 s", said)
        self.assertEqual(before, (self.out / run_record.NAME).read_bytes())

    def test_a_lock_its_holder_died_with_does_not_hold_a_run_up(self) -> None:
        self.out.mkdir(parents=True)
        lock = self.out / run_record.LOCK
        held = (
            "import os, sys; sys.path.insert(0, sys.argv[2]); from server import store_lock;"
            " handle = open(sys.argv[1], 'a+b'); assert store_lock.try_lock(handle); os._exit(0)"
        )
        died = processes.run_text([sys.executable, "-c", held, str(lock), str(ROOT)])
        self.assertEqual(0, died.returncode, died.stderr)

        with mock.patch.object(run_record, "LOCK_WAIT_SECONDS", 5.0):
            code, said = self.ran("python", "-c", "pass", name="after")

        self.assertEqual(0, code, said)
        self.assertEqual(["after"], [entry["name"] for entry in self.recorded()["steps"]])

    def test_the_command_line_runs_a_command_and_refuses_none(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            code = run_record.main(
                [
                    "run",
                    "--out",
                    str(self.root / "cli"),
                    "--cwd",
                    str(self.root),
                    "--",
                    "python",
                    "-c",
                    "raise SystemExit(4)",
                ]
            )
        self.assertEqual(4, code)
        record = json.loads((self.root / "cli" / run_record.NAME).read_text(encoding="utf-8"))
        self.assertEqual([4], [entry["exit"] for entry in record["steps"]])
        self.assertEqual(git_worktrees.canonical(ROOT), record["tree"]["worktree"])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            run_record.main(["run", "--out", str(self.root / "cli"), "--"])


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

    def test_the_closing_line_counts_over_one_the_log_quotes_before_it(self) -> None:
        # A test that runs a nested suite, as the tests of these tools do, logs its count first.
        cases = {
            "unittest": ("Ran 2 tests in 0.010s\n\nOK\n....\nRan 40 tests in 3.100s\n\nOK\n", 40),
            "web-test": ("      Tests  1 passed (1)\n...\n      Tests  12 passed (12)\n", 12),
            "desktop-test": (f"# tests 1\n# pass 1\n{SPEC} tests 30\n{SPEC} pass 30\n", 30),
        }
        for name, (text, expected) in cases.items():
            with self.subTest(step=name):
                self.assertEqual(expected, self.counted(name, text))

    def test_the_counted_steps_are_the_test_steps_of_the_gate_list(self) -> None:
        def test_steps(steps: tuple[isolated.Step, ...]) -> set[str]:
            # A step runs tests when its name says so, or it runs unittest or a package's tests.
            runs = re.compile(r"-m unittest\b|^npm test$")
            return {
                step.name
                for step in steps
                if step.name.endswith("test") or runs.search(step.command)
            }

        self.assertEqual(test_steps(isolated.gate_steps()), set(run_record.TEST_COUNTS))
        # The control: a test step added to the list without a count is one this sees.
        added = isolated.Step("browser-test", "web", "npm run test:browser:allowed", "web")
        self.assertNotEqual(
            test_steps((*isolated.gate_steps(), added)), set(run_record.TEST_COUNTS)
        )


class ToolVersionTests(unittest.TestCase):
    """The versions a record names are those of the environments `gates` runs each tool in."""

    def test_a_tool_with_an_environment_of_its_own_is_read_there(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-tools-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        own = Path(directory.name) / "own-venv"
        windows = sys.platform == "win32"
        site = (
            own / "Lib" / "site-packages" if windows else own / "lib" / "python3" / "site-packages"
        )
        info = site / "semgrep-9.9.9.dist-info"
        info.mkdir(parents=True)
        info.joinpath("METADATA").write_text("Name: semgrep\nVersion: 9.9.9\n", encoding="utf-8")
        environment = release.OwnEnvironment(own, Path(directory.name) / "own.txt", python="3")
        tool = release.Tool("semgrep", script="semgrep", environment=environment)
        # The running interpreter answers for every other tool, and wrongly for this one.
        running = release.Interpreter(Path("python"), Path("."), lambda name: f"running {name}")
        with mock.patch.dict(release.TOOLS, {"semgrep": tool}):
            versions = run_record.tool_versions(running, npm=False)
        self.assertEqual("9.9.9", versions["semgrep"])
        self.assertEqual("running ruff", versions["ruff"])


class AdmissionTests(unittest.TestCase):
    """What the heavy-process gate said as a step's runs went in, read back from the step's log."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-gate-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.log = Path(directory.name) / "web-test.log"

    def test_each_admission_is_recorded_with_its_wait_its_share_its_load_and_its_neighbours(
        self,
    ) -> None:
        # The gate's admission lines as its contract gives them, word for word, and the
        # line of the earlier branches' lock as `tests/legacy_lock.py` writes it.
        lines = [
            "heavy-gate: waiting: 30.1 cores would be busy",
            "heavy-gate: admitted valkama:browser-suite after 2 min 41 s: K=16, profile 13.1"
            " cores 6.2 GB, machine 9.4 of 32 busy, beside 2 leases (rover:check,"
            " valkama:vitest-suite)",
            legacy_lock.admission_line(3.2, 14, Path("C:/T/valkama-heavy-tests-u.lock")),
            "heavy-gate: admitted valkama:unittest-suite after 4 min 0 s: no profile yet,"
            " machine 30.0 of 32 busy, alone, past the CPU limit, serial mode",
        ]
        self.log.write_bytes(("\r\n".join(lines) + "\r\n Tests  3 passed (3)\r\n").encode())

        entry = run_record.step("web-test", ["npm", "test"], ROOT, self.log, 0)

        self.assertEqual(3, entry["tests"])
        admitted = entry["admitted"]
        assert isinstance(admitted, list)
        first, earlier, last = admitted
        self.assertEqual(
            {
                "gate": "heavy-gate",
                "lease": "valkama:browser-suite",
                "waited": 161,
                "k": 16,
                "profile_cores": 13.1,
                "profile_memory_gb": 6.2,
                "busy": round(9.4 / 32, 3),
                "beside": ["rover:check", "valkama:vitest-suite"],
                "past_cpu_limit": False,
                "serial": False,
            },
            first,
        )
        self.assertEqual({"gate": "earlier branches' lock", "waited": 3, "cpus": 14}, earlier)
        self.assertEqual(240, last["waited"])
        self.assertIsNone(last["k"])
        self.assertIsNone(last["profile_cores"])
        self.assertEqual([], last["beside"])
        self.assertTrue(last["past_cpu_limit"])
        self.assertTrue(last["serial"])

    def test_a_step_whose_log_says_no_admission_records_none(self) -> None:
        # The line of the lock before the gate is no admission at the gate.
        self.log.write_bytes(b"took the heavy-test lock after 41 s: 2 of 32 CPUs, alone\n")
        self.assertNotIn("admitted", run_record.step("web-test", ["npm"], ROOT, self.log, 0))
        # Nor a refused step, whose log holds only the refusal.
        self.log.write_bytes(
            b"heavy-gate: admitted valkama:x after 0 s: no profile yet, machine 1.0 of 32 busy,"
            b" alone\n"
        )
        self.assertNotIn("admitted", run_record.step("web-test", ["npm"], ROOT, self.log, None))


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
            mock.patch.object(isolated.release, "STAGES", steps),
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

    def test_gates_says_before_its_first_step_where_a_record_cannot_match(self) -> None:
        steps = (isolated.Step("only", "python", 'python -c "pass"'),)
        warning = "warning: a stand-in for a result directory the tree sees"
        with (
            mock.patch.object(isolated.release, "STAGES", steps),
            mock.patch.object(isolated.release, "require_toolchain", return_value={}),
            mock.patch.object(run_record, "placement_warning", return_value=warning) as placed,
            contextlib.redirect_stdout(io.StringIO()) as said,
        ):
            isolated.main(["gates", "--out", str(self.out)])

        placed.assert_called_once_with(isolated.ROOT, self.out)
        lines = said.getvalue().splitlines()
        self.assertIn(warning, lines)
        self.assertLess(
            lines.index(warning),
            next(i for i, line in enumerate(lines) if line.startswith("only ")),
        )


if __name__ == "__main__":
    unittest.main()
