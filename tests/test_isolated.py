"""What `tests/isolated.py` owes: a run that cannot reach the real profile or hide a failure.

The "real profile" in every case here is a directory this test made, named by
the environment the tool starts from. The command is never pointed at anything
the owner of the machine uses, and the store it copies is one made here.
"""

from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

from tests import isolated, machine_lock
from tests.test_machine_lock import (
    DEADLINE_SECONDS,
    HELD_SECONDS,
    goes_in_at_once,
    held_elsewhere,
)
from tests.test_mcp_front import alive, wait_until
from tests.test_release import link_directory

ROOT = Path(__file__).resolve().parents[1]
COMMAND = str(ROOT / "tests" / "isolated.py")

#: A server with a child of its own, as one started from a virtual environment
#: has. It reports what it was given, says the line the supervisor waits for, and
#: exits by itself when told to crash, taking the child along.
STUB_SERVER = """\
import json, os, subprocess, sys, time
report, crash, code = sys.argv[1], sys.argv[2], int(sys.argv[3])
child = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(60)"],
    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
with open(report + ".tmp", "w", encoding="utf-8") as handle:
    json.dump({"server": os.getpid(), "child": child.pid, "env": dict(os.environ)}, handle)
os.replace(report + ".tmp", report)
if code:
    child.kill()
    sys.exit(code)
print("Valkama on http://127.0.0.1:1/", file=sys.stderr, flush=True)
for _ in range(600):
    if os.path.exists(crash):
        child.kill()
        sys.exit(7)
    time.sleep(0.1)
"""

#: Asks the product where it would write, and writes there.
PROBE = """\
import json, os, sys
from pathlib import Path
from server import store
from server.projects import project_registry
paths = {
    "home": os.path.expanduser("~"),
    "store": store.db_path(),
    "registry": project_registry.registry_path(),
    "local": os.environ["LOCALAPPDATA"],
    "roaming": os.environ["APPDATA"],
}
for name in ("home", "local", "roaming"):
    Path(paths[name], "marker").write_text("written", encoding="utf-8")
Path(paths["registry"]).parent.mkdir(parents=True, exist_ok=True)
Path(paths["registry"]).write_text("written", encoding="utf-8")
keys = (
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "VALKAMA_DB",
    "VALKAMA_NO_TRAY",
    "TEMP",
    "GIT_CONFIG_GLOBAL",
)
report = {"paths": paths, "env": {key: os.environ.get(key) for key in keys}}
Path(sys.argv[1]).write_text(json.dumps(report), encoding="utf-8")
"""


def files_under(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*") if path.is_file())


def assert_read_only(case: unittest.TestCase, spy: mock.Mock, source: Path) -> None:
    """The spy on `sqlite3.connect` saw `source` opened, and every opening read-only.

    The copy is written by `VACUUM INTO`, which opens no connection of its own, so
    a connection that could write is one to the source.
    """

    targets = [str(call.args[0]) for call in spy.call_args_list]
    case.assertTrue(any(source.name in target for target in targets), targets)
    for call in spy.call_args_list:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(str(call.args[0])).query)
        case.assertTrue(call.kwargs.get("uri"), call)
        case.assertEqual(["ro"], query.get("mode"), call)
    case.assertEqual(
        [], [path.name for path in source.parent.iterdir() if path.name.endswith(("-wal", "-shm"))]
    )


def quietly(function, *arguments) -> tuple[int, str]:
    """A call's result and what it told its reader."""

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = function(*arguments)
    return code, output.getvalue()


class Workspace(unittest.TestCase):
    """A fake real profile the environment names, and an empty result directory."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-iso-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.real = self.root / "real-profile"
        (self.real / "local").mkdir(parents=True)
        (self.real / "roaming").mkdir()
        self.out = self.root / "out"
        self.out.mkdir()
        environment = mock.patch.dict(
            os.environ,
            {
                "HOME": str(self.real),
                "USERPROFILE": str(self.real),
                "LOCALAPPDATA": str(self.real / "local"),
                "APPDATA": str(self.real / "roaming"),
                "GIT_CONFIG_NOSYSTEM": "1",
                "VALKAMA_DB": str(self.real / "not-to-be-used.sqlite3"),
                "VALKAMA_AUTHOR": "from the caller",
                "VALKAMA_CUTOVER": "from the caller",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop("GIT_CONFIG_GLOBAL", None)

    @property
    def home(self) -> Path:
        return self.out / isolated.HOME

    def run_python(self, name: str, source: str) -> isolated.Run:
        return isolated.Run(name, [sys.executable, "-c", source], ROOT)


class EnvironmentTests(Workspace):
    def test_every_location_moves_and_temp_does_not(self) -> None:
        temp = os.environ.get("TEMP")
        environment = isolated.isolated_environment(self.home)

        for name in (
            "HOME",
            "USERPROFILE",
            "LOCALAPPDATA",
            "APPDATA",
            "VALKAMA_DB",
            "GIT_CONFIG_GLOBAL",
        ):
            self.assertTrue(
                Path(environment[name]).is_relative_to(self.home),
                f"{name} stayed at {environment[name]}",
            )
        self.assertEqual("1", environment["VALKAMA_NO_TRAY"])
        self.assertEqual(temp, environment.get("TEMP"))

    def test_nothing_of_the_callers_points_a_child_back(self) -> None:
        environment = isolated.isolated_environment(self.home)

        self.assertNotIn("VALKAMA_CUTOVER", environment)
        self.assertNotIn("VALKAMA_AUTHOR", environment)
        # The guard names the store of the profile it started from.
        self.assertEqual(
            str(self.real / ".valkama" / "valkama.sqlite3"),
            environment["VALKAMA_PROTECTED_STORE"],
        )
        # And the caller's own environment is left as it was.
        self.assertEqual(str(self.real), os.environ["HOME"])

    def test_a_child_writes_only_inside_the_throwaway_profile(self) -> None:
        before = files_under(self.real)
        report_file = self.root / "report.json"
        isolated.prepare_home(self.home)

        run = isolated.Run("probe", [sys.executable, "-c", PROBE, str(report_file)], ROOT)
        code, _ = quietly(
            isolated.run_gates, [run], self.out, isolated.isolated_environment(self.home)
        )

        self.assertEqual(0, code)
        report = json.loads(report_file.read_text(encoding="utf-8"))
        for name, path in report["paths"].items():
            self.assertTrue(Path(path).is_relative_to(self.home), f"{name} resolved to {path}")
        self.assertEqual(str(self.home), report["env"]["HOME"])
        self.assertEqual(str(self.home), report["env"]["USERPROFILE"])
        self.assertEqual(str(self.home / "AppData" / "Local"), report["env"]["LOCALAPPDATA"])
        self.assertEqual(str(isolated.store_path(self.home)), report["env"]["VALKAMA_DB"])
        self.assertEqual("1", report["env"]["VALKAMA_NO_TRAY"])
        self.assertEqual(os.environ.get("TEMP"), report["env"]["TEMP"])
        self.assertEqual(str(self.home / ".gitconfig"), report["env"]["GIT_CONFIG_GLOBAL"])
        self.assertEqual(before, files_under(self.real), "a child wrote into the real profile")
        self.assertTrue((self.home / "marker").is_file())
        self.assertTrue((self.home / "AppData" / "Local" / "marker").is_file())

    def test_git_in_a_child_commits_as_the_caller_although_home_moved(self) -> None:
        (self.real / ".gitconfig").write_text(
            "[user]\n\tname = Somebody Real\n\temail = somebody@example.com\n"
            "[alias]\n\tfrom-the-real-file = status\n",
            encoding="utf-8",
        )
        repository = self.root / "repository"
        repository.mkdir()
        subprocess.run(["git", "init", "--quiet", str(repository)], check=True)
        with mock.patch.object(isolated, "ROOT", repository):
            isolated.prepare_home(self.home)
            environment = isolated.isolated_environment(self.home)

        def git(*arguments: str) -> subprocess.CompletedProcess:
            return subprocess.run(
                ["git", "-C", str(repository), *arguments],
                env=environment,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                check=False,
            )

        committed = git("commit", "--allow-empty", "--quiet", "-m", "from a child")
        self.assertEqual(0, committed.returncode, committed.stderr)
        self.assertEqual(b"Somebody Real\n", git("log", "-1", "--format=%an").stdout)
        # What was seeded is the identity, not the real file with all it carries.
        self.assertNotEqual(0, git("config", "--get", "alias.from-the-real-file").returncode)

    def test_a_config_named_by_the_caller_does_not_reach_the_child(self) -> None:
        with mock.patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": str(self.real / ".gitconfig")}):
            environment = isolated.isolated_environment(self.home)
        self.assertEqual(str(self.home / ".gitconfig"), environment["GIT_CONFIG_GLOBAL"])

    def test_a_child_s_global_git_writes_land_in_the_profile_s_file(self) -> None:
        """`git config --global`, which `git-hook install` runs, writes in a gate's child
        the throwaway profile's file: `GIT_CONFIG_GLOBAL` names it, so no `HOME` Git might
        take instead decides where."""

        caller = self.real / ".gitconfig"
        caller.write_bytes(b"[user]\n\tname = Somebody Real\n")
        isolated.prepare_home(self.home)
        environment = isolated.isolated_environment(self.home)
        self.assertEqual(str(self.home / ".gitconfig"), environment["GIT_CONFIG_GLOBAL"])
        written = subprocess.run(
            ["git", "config", "--global", "hook.valkama-commit.event", "post-commit"],
            env=environment,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, written.returncode, written.stderr)
        self.assertEqual(b"[user]\n\tname = Somebody Real\n", caller.read_bytes())
        self.assertIn(
            b"valkama-commit", (self.home / ".gitconfig").read_bytes(), "the child wrote elsewhere"
        )


class GateTests(Workspace):
    def test_a_failed_step_decides_the_result_whatever_ran_after_it(self) -> None:
        runs = [
            self.run_python("first", "print('one')"),
            self.run_python("broken", "import sys; print('two'); sys.exit(3)"),
            self.run_python("last", "print('three')"),
        ]

        code, said = quietly(isolated.run_gates, runs, self.out, os.environ)

        self.assertNotEqual(0, code)
        self.assertIn("broken         exit=3  two", said)
        self.assertIn("last           exit=0  three", said)
        self.assertIn("failed: broken", said)
        summary = (self.out / isolated.SUMMARY).read_text(encoding="utf-8")
        self.assertIn("failed: broken", summary)
        self.assertEqual(
            b"two", (self.out / isolated.LOGS / "broken.log").read_bytes().strip(), "the log"
        )

    def test_zero_steps_is_a_failure(self) -> None:
        code, said = quietly(isolated.run_gates, [], self.out, os.environ)

        self.assertNotEqual(0, code)
        self.assertIn("no gate step ran", said)

    def test_a_step_that_cannot_start_is_a_failed_step(self) -> None:
        run = isolated.Run("absent", [str(self.root / "no-such-program.exe")], ROOT)

        code, said = quietly(isolated.run_gates, [run], self.out, os.environ)

        self.assertNotEqual(0, code)
        self.assertIn("exit=127", said)
        self.assertIn("could not start", said)

    def test_all_steps_passing_is_success(self) -> None:
        code, said = quietly(
            isolated.run_gates, [self.run_python("only", "print('one')")], self.out, os.environ
        )

        self.assertEqual(0, code)
        self.assertIn("all 1 steps passed", said)

    def test_a_step_reads_no_input_and_writes_to_no_pipe_of_the_caller(self) -> None:
        run = self.run_python(
            "stdio", "import sys; assert sys.stdin.read() == ''; assert not sys.stdout.isatty()"
        )
        real_run = subprocess.run
        with mock.patch.object(subprocess, "run", side_effect=real_run) as spy:
            code, _ = quietly(isolated.run_gates, [run], self.out, os.environ)

        self.assertEqual(0, code)
        keywords = spy.call_args.kwargs
        self.assertEqual(subprocess.DEVNULL, keywords["stdin"])
        self.assertEqual(subprocess.STDOUT, keywords["stderr"])
        self.assertTrue(keywords["stdout"].name.endswith("stdio.log"))

    def test_a_step_runs_with_its_own_programs_directory_first_on_path(self) -> None:
        # semgrep comes from an environment of its own, and its launcher finds
        # pysemgrep through PATH: a copy an older `.venv` holds must not win.
        elsewhere = str(self.root / "elsewhere")
        run = self.run_python("path", "import os; print(os.environ['PATH'])")

        code, _ = quietly(isolated.run_gates, [run], self.out, {**os.environ, "PATH": elsewhere})

        self.assertEqual(0, code)
        printed = (self.out / isolated.LOGS / "path.log").read_text(encoding="utf-8").strip()
        self.assertEqual([str(Path(sys.executable).parent), elsewhere], printed.split(os.pathsep))

    def test_undecodable_output_does_not_lose_the_summary(self) -> None:
        run = self.run_python("bytes", r"import sys; sys.stdout.buffer.write(b'\xff\xfe bytes')")

        code, said = quietly(isolated.run_gates, [run], self.out, os.environ)

        self.assertEqual(0, code)
        self.assertIn("bytes", said)

    def test_the_steps_are_the_list_in_the_repository_instructions(self) -> None:
        text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        block = re.search(r"For Valkama changes run:\s+```powershell\n(.*?)```", text, re.DOTALL)
        assert block is not None
        listed, directory = [], Path(".")
        for line in block.group(1).splitlines():
            if line.startswith("cd "):
                directory = Path(os.path.normpath(directory / line[3:]))
            else:
                listed.append((line, directory.as_posix()))

        self.assertEqual(listed, [(s.command, s.directory) for s in isolated.GATE_STEPS])

    def test_the_subject_step_is_refused_where_there_is_no_history_and_never_passes(self) -> None:
        snapshot = self.root / "snapshot"
        snapshot.mkdir()
        subjects = isolated.Run(
            "subjects",
            [sys.executable, "-c", "open('ran', 'w').close()"],
            snapshot,
            needs_history=True,
        )
        # Whatever holds the temporary directory is not searched for a repository.
        with mock.patch.dict(os.environ, {"GIT_CEILING_DIRECTORIES": str(self.root)}):
            code, said = quietly(
                isolated.run_gates,
                [self.run_python("first", "print(1)"), subjects],
                self.out,
                os.environ,
            )

        self.assertEqual(1, code)
        self.assertFalse((snapshot / "ran").exists())
        self.assertRegex(said, r"subjects +refused +.*snapshot is not a Git repository")
        self.assertIn("not run, because there is no Git history to read: subjects\n", said)
        self.assertNotIn("failed:", said)
        self.assertNotIn("steps passed", said)
        self.assertEqual(
            ["subjects"], [step.name for step in isolated.GATE_STEPS if step.needs_history]
        )

    def test_every_step_resolves_to_a_program(self) -> None:
        tools = {name: (name,) for name in ("typos", "vulture", "mypy", "lint-imports", "semgrep")}
        for step in isolated.GATE_STEPS:
            with self.subTest(step=step.name):
                self.assertTrue(isolated._argv(step.command, tools))
        unittest_step = next(s for s in isolated.GATE_STEPS if s.name == "unittest")
        # The quotes in the instructions are for a shell; the pattern arrives bare.
        self.assertEqual(
            "test_*.py",
            isolated._argv(unittest_step.command, tools)[-1],
        )

    def test_selection_is_by_step_or_group_and_owner_reaches_only_the_audit(self) -> None:
        python = isolated.select_steps(["python"], owner=False)
        self.assertEqual(11, len(python))
        self.assertEqual({"python"}, {step.group for step in python})
        self.assertEqual(
            ["ruff", "mypy"], [s.name for s in isolated.select_steps(["mypy", "ruff"], owner=False)]
        )
        self.assertEqual(len(isolated.GATE_STEPS), len(isolated.select_steps(None, owner=False)))

        owned = [
            s.command for s in isolated.select_steps(None, owner=True) if "--owner" in s.command
        ]
        self.assertEqual(["python .github/relkit.pyz audit --history --owner"], owned)

    def test_a_misspelled_step_is_refused_rather_than_skipped(self) -> None:
        with mock.patch.object(isolated, "gates", return_value=0):
            with self.assertRaises(SystemExit) as refused:
                with contextlib.redirect_stderr(io.StringIO()):
                    isolated.main(["gates", "--out", str(self.out), "--only", "ruff", "mpy"])
        self.assertEqual(2, refused.exception.code)

    def test_the_result_directory_has_no_default(self) -> None:
        # Stand-ins, so a parser that stopped refusing fails here instead of
        # running the whole gate list, this test included, inside this test.
        with (
            mock.patch.object(isolated, "gates", return_value=0),
            mock.patch.object(isolated, "start", return_value=0),
            mock.patch.object(isolated, "stop", return_value=0),
        ):
            for command in ("gates", "serve", "stop"):
                with self.subTest(command=command):
                    with self.assertRaises(SystemExit) as refused:
                        with contextlib.redirect_stderr(io.StringIO()):
                            isolated.main([command])
                    self.assertEqual(2, refused.exception.code)

    def run_command_with_steps(self, *steps: isolated.Step) -> tuple[int, str]:
        with (
            mock.patch.object(isolated, "GATE_STEPS", steps),
            mock.patch.object(isolated.release, "require_toolchain", return_value={}),
        ):
            return quietly(isolated.main, ["gates", "--out", str(self.out)])

    def test_the_command_runs_every_step_in_a_new_profile_and_reports_the_failure(self) -> None:
        self.home.mkdir()
        (self.home / "left-by-an-earlier-run").write_text("stale", encoding="utf-8")

        code, said = self.run_command_with_steps(
            isolated.Step("bad", "python", 'python -c "raise SystemExit(5)"'),
            isolated.Step("good", "python", 'python -c "print(1)"'),
        )

        self.assertEqual(1, code)
        self.assertIn("bad            exit=5", said)
        self.assertIn("good           exit=0", said)
        self.assertFalse((self.home / "left-by-an-earlier-run").exists())

    def test_the_command_with_no_steps_fails(self) -> None:
        code, said = self.run_command_with_steps()

        self.assertEqual(1, code)
        self.assertIn("no gate step ran", said)

    def test_a_wrong_interpreter_is_refused_and_counted_as_nothing_having_run(self) -> None:
        refusal = isolated.release.ToolchainError("this interpreter lacks ruff")
        with mock.patch.object(isolated.release, "require_toolchain", side_effect=refusal):
            code, said = quietly(isolated.main, ["gates", "--out", str(self.out)])

        self.assertEqual(1, code)
        self.assertIn("this interpreter lacks ruff", said)
        self.assertIn("no gate step ran", said)

    def test_gates_do_not_clear_a_profile_a_server_is_using(self) -> None:
        self.home.mkdir()
        (self.out / isolated.STATE).write_text('{"state": "ready"}', encoding="utf-8")

        code, said = quietly(isolated.main, ["gates", "--out", str(self.out)])

        self.assertEqual(1, code)
        self.assertIn("run stop first", said)
        self.assertTrue(self.home.exists())


class HeavyLockTests(Workspace):
    """The unittest step waits for the machine's heavy-test lock; no other step takes it.

    At a count of 1, one run at a time, so no step reads this machine's load.
    """

    def setUp(self) -> None:
        super().setUp()
        self.lock = self.root / "heavy.lock"
        count = mock.patch.dict(os.environ, {machine_lock.CPUS_VARIABLE: "1"})
        count.start()
        self.addCleanup(count.stop)

    def gate_runs(self, *only: str) -> list[isolated.Run]:
        """The runs `gates --only ...` would hand to `run_gates`."""

        tools = {name: (name,) for name in ("typos", "vulture", "mypy", "lint-imports", "semgrep")}
        with (
            mock.patch.object(isolated.release, "require_toolchain", return_value=tools),
            mock.patch.object(isolated, "run_gates", return_value=0) as run_gates,
        ):
            quietly(isolated.main, ["gates", "--out", str(self.out), "--only", *only])
        return run_gates.call_args.args[0]

    def test_of_the_whole_list_only_the_unittest_step_takes_the_lock(self) -> None:
        gated = [run.name for run in self.gate_runs("python", "web", "desktop") if run.gated]
        self.assertEqual(["unittest"], gated)

    def test_a_selection_without_the_unittest_step_takes_no_lock(self) -> None:
        self.assertEqual([], [run.name for run in self.gate_runs("coverage", "web") if run.gated])

    def test_the_gated_step_waits_for_the_holder_and_a_light_one_does_not(self) -> None:
        marker = self.root / "ran"
        heavy = isolated.Run(
            "unittest",
            [sys.executable, "-c", f"open({str(marker)!r}, 'w').close()"],
            ROOT,
            gated=True,
        )
        result: list[tuple[int, str]] = []
        with held_elsewhere(self.lock, "another checkout's suite") as release:
            code, _ = quietly(
                lambda: isolated.run_gates(
                    [self.run_python("light", "print(1)")], self.out, os.environ, lock=self.lock
                )
            )
            self.assertEqual(0, code, "a light step waited for the lock")

            waiting = threading.Thread(
                target=lambda: result.append(
                    quietly(
                        lambda: isolated.run_gates([heavy], self.out, os.environ, lock=self.lock)
                    )
                ),
                daemon=True,
            )
            waiting.start()
            waiting.join(HELD_SECONDS)
            self.assertFalse(marker.exists(), "the unittest step ran beside the holder")
            release.set()
            waiting.join(DEADLINE_SECONDS)

        self.assertTrue(marker.exists())
        self.assertEqual(0, result[0][0])
        summary = (self.out / isolated.SUMMARY).read_text(encoding="utf-8")
        self.assertIn("it is held by another checkout's suite", summary)
        self.assertIn("took the heavy-test lock after", summary)
        # The step's own log opens with what the gate said, which its record reads.
        said = (self.out / isolated.LOGS / "unittest.log").read_text(encoding="utf-8")
        self.assertTrue(said.startswith("waiting for the heavy-test lock "), said)
        self.assertIn("\ntook the heavy-test lock after ", said)
        goes_in_at_once(self, self.lock)

    def test_the_gated_step_declares_what_the_whole_suite_needs(self) -> None:
        heavy = isolated.Run("unittest", [sys.executable, "-c", "0"], ROOT, gated=True)
        with mock.patch.object(machine_lock, "held", wraps=machine_lock.held) as held:
            quietly(lambda: isolated.run_gates([heavy], self.out, os.environ, lock=self.lock))
        self.assertEqual(2, held.call_args.kwargs["cpus"])

    def taking_the_lock(self, name: str, *, gated: bool = False) -> isolated.Run:
        """A step that takes the lock itself, as the suite in the unittest step and `npm test` do."""

        return isolated.Run(
            name,
            [
                *(sys.executable, str(ROOT / "tests" / "machine_lock.py"), "run"),
                *(f"--run=the {name} step's own run", f"--path={self.lock}"),
                *("--", sys.executable, "-c", "print('in')"),
            ],
            ROOT,
            gated=gated,
        )

    def gates_in_a_thread(
        self, runs: list[isolated.Run], environment: dict[str, str]
    ) -> tuple[threading.Thread, list[tuple[int, str]]]:
        result: list[tuple[int, str]] = []
        thread = threading.Thread(
            target=lambda: result.append(
                quietly(lambda: isolated.run_gates(runs, self.out, environment, lock=self.lock))
            ),
            daemon=True,
        )
        thread.start()
        return thread, result

    def unmarked(self) -> dict[str, str]:
        """This environment without a mark, as the gates build each step's."""

        return {
            name: value
            for name, value in os.environ.items()
            if name != machine_lock.HELD_BY_ANCESTOR
        }

    def test_the_suite_inside_the_gated_step_does_not_wait_for_its_own_step(self) -> None:
        thread, result = self.gates_in_a_thread(
            [self.taking_the_lock("unittest", gated=True)], self.unmarked()
        )
        thread.join(DEADLINE_SECONDS)

        self.assertFalse(thread.is_alive(), "the step waited for the lock its own step holds")
        self.assertEqual(0, result[0][0])
        self.assertNotIn(
            "waiting", (self.out / isolated.LOGS / "unittest.log").read_text(encoding="utf-8")
        )

    def test_a_light_step_that_takes_the_lock_itself_waits_for_another_holder(self) -> None:
        log = self.out / isolated.LOGS / "web-test.log"
        with held_elsewhere(self.lock, "another checkout's browser run") as release:
            thread, result = self.gates_in_a_thread(
                [self.taking_the_lock("web-test")], self.unmarked()
            )
            self.assertTrue(
                wait_until(
                    lambda: log.exists() and b"it is held by" in log.read_bytes(),
                    seconds=DEADLINE_SECONDS,
                ),
                "the step never said it was waiting",
            )
            self.assertNotIn("in", log.read_text(encoding="utf-8").splitlines())
            release.set()
            thread.join(DEADLINE_SECONDS)

        self.assertEqual(0, result[0][0])
        said = log.read_text(encoding="utf-8")
        self.assertIn("it is held by another checkout's browser run", said)
        self.assertIn("took the heavy-test lock after", said)
        self.assertIn("in", said.splitlines())

    def test_a_gates_run_under_a_holder_passes_the_hold_on_to_every_step(self) -> None:
        with held_elsewhere(self.lock, "the run that started the gates"):
            with mock.patch.dict(os.environ, machine_lock.marker(self.lock)):
                thread, result = self.gates_in_a_thread(
                    [
                        self.taking_the_lock("web-test"),
                        self.taking_the_lock("unittest", gated=True),
                    ],
                    self.unmarked(),
                )
                thread.join(DEADLINE_SECONDS)

        self.assertFalse(thread.is_alive(), "a step waited for the run that started the gates")
        self.assertEqual(0, result[0][0])


def locked_entry(name: str, version: str, **flags: object) -> dict:
    """An entry as `package-lock.json` holds one, with npm's bookkeeping beside the pins."""

    return {
        "version": version,
        "resolved": f"https://registry.npmjs.org/{name}/-/{name}-{version}.tgz",
        "integrity": f"sha512-{name}-{version}",
        "license": "MIT",
        **flags,
    }


class ModulesCase(Workspace):
    """A package directory holding the two files npm writes, as npm lays them out.

    The shape is taken from real trees after `npm ci` with npm 11 on Windows: the
    hidden lockfile has no root entry and leaves out optional packages this
    platform has no use for, including ones that declare no platform themselves
    because only a skipped binary needs them.
    """

    def setUp(self) -> None:
        super().setUp()
        self.package = self.root / "checkout" / "web"
        self.package.mkdir(parents=True)
        self.locked = {
            "": {"name": "valkama-web", "dependencies": {"github-slugger": "2.0.0"}},
            "node_modules/github-slugger": locked_entry("github-slugger", "2.0.0"),
            "node_modules/vite": locked_entry("vite", "8.3.5", dev=True),
            "node_modules/typescript": locked_entry("typescript", "6.0.3", dev=True),
            "node_modules/@esbuild/linux-x64": locked_entry(
                "linux-x64", "0.25.0", optional=True, os=["linux"], cpu=["x64"]
            ),
            "node_modules/@emnapi/core": locked_entry("core", "1.5.0", optional=True),
        }
        self.installed = {
            name: dict(entry)
            for name, entry in self.locked.items()
            if name and not entry.get("optional")
        }

    def write(self, lockfile: object = None, hidden: object = None) -> None:
        (self.package / "node_modules").mkdir(exist_ok=True)
        (self.package / "package-lock.json").write_text(
            json.dumps(lockfile or {"lockfileVersion": 3, "packages": self.locked}),
            encoding="utf-8",
        )
        (self.package / "node_modules" / ".package-lock.json").write_text(
            json.dumps(hidden or {"lockfileVersion": 3, "packages": self.installed}),
            encoding="utf-8",
        )


class ModulesComparisonTests(ModulesCase):
    def assert_refused_here(self, *naming: str) -> str:
        refusal = isolated.modules_refusal(self.package)
        assert refusal is not None
        self.assertIn(f"npm ci is needed in {self.package}", refusal)
        for text in naming:
            self.assertIn(text, refusal)
        return refusal

    def test_a_tree_npm_installed_from_this_lockfile_matches(self) -> None:
        self.write()

        self.assertIsNone(isolated.modules_refusal(self.package))

    def test_bookkeeping_that_pins_nothing_is_not_a_difference(self) -> None:
        # A release bumps the version at the top and in the root entry, and nothing
        # installed changes; npm may also work out an entry's flags anew.
        self.installed["node_modules/vite"].update(dev=False, peer=True, license="other")
        self.write(hidden={"name": "valkama-web", "version": "0.0.1", "packages": self.installed})

        self.assertIsNone(isolated.modules_refusal(self.package))

    def test_each_pinned_field_decides_on_its_own(self) -> None:
        for field in ("version", "resolved", "integrity"):
            with self.subTest(field=field):
                installed = {name: dict(entry) for name, entry in self.installed.items()}
                installed["node_modules/vite"][field] = "something else"
                self.write(hidden={"packages": installed})

                self.assert_refused_here("vite")

    def test_modules_older_than_the_lockfile_are_refused_naming_both_versions(self) -> None:
        self.installed["node_modules/vite"] = locked_entry("vite", "7.3.6", dev=True)
        self.write()

        self.assert_refused_here("vite is 7.3.6, locked 8.3.5")

    def test_a_package_a_merged_commit_added_is_refused(self) -> None:
        del self.installed["node_modules/github-slugger"]
        self.write()

        self.assert_refused_here("github-slugger is not installed")

    def test_only_an_optional_package_may_be_left_out(self) -> None:
        # `devOptional` is needed by a dev dependency as well, so npm installs it.
        self.locked["node_modules/oxlint"] = locked_entry("oxlint", "1.0.0", devOptional=True)
        self.write()

        self.assert_refused_here("oxlint is not installed")

    def test_a_package_the_lockfile_dropped_is_refused(self) -> None:
        self.installed["node_modules/gone"] = locked_entry("gone", "1.0.0")
        self.write()

        self.assert_refused_here("gone is not in the lockfile")

    def test_a_long_list_of_differences_is_cut_and_counted(self) -> None:
        self.write(hidden={"packages": {"node_modules/other": locked_entry("other", "1.0.0")}})

        self.assert_refused_here("; and 1 more")

    def test_a_checkout_with_no_modules_is_refused(self) -> None:
        self.assert_refused_here("no node_modules")

    def test_an_install_that_did_not_finish_is_refused(self) -> None:
        # `npm ci` empties the directory first and writes this file last.
        (self.package / "node_modules" / "vite").mkdir(parents=True)

        self.assert_refused_here("no .package-lock.json")

    def test_a_comparison_that_cannot_be_made_is_not_a_pass(self) -> None:
        good = json.dumps({"packages": {"node_modules/a": locked_entry("a", "1.0.0")}}).encode()
        unusable = {
            "not JSON": b"{",
            "not UTF-8": b'{"packages": "\xff"}',
            "a list": b"[]",
            "no packages": b'{"lockfileVersion": 1, "dependencies": {}}',
            "empty packages": b'{"packages": {}}',
            "packages of another type": b'{"packages": []}',
            "an entry of another type": b'{"packages": {"node_modules/a": "1.0.0"}}',
            "an entry pinning nothing": b'{"packages": {"node_modules/a": {"dev": true}}}',
        }
        (self.package / "node_modules").mkdir()
        lockfile = self.package / "package-lock.json"
        hidden = self.package / "node_modules" / ".package-lock.json"
        lockfile.write_bytes(good)
        hidden.write_bytes(good)
        self.assertIsNone(isolated.modules_refusal(self.package), "the control must match")

        for name, content in unusable.items():
            for broken, whole in ((lockfile, hidden), (hidden, lockfile)):
                with self.subTest(file=broken.name, content=name):
                    whole.write_bytes(good)
                    broken.write_bytes(content)

                    self.assert_refused_here("could not be compared")

    def test_a_missing_lockfile_is_not_a_pass(self) -> None:
        self.write()
        (self.package / "package-lock.json").unlink()

        self.assert_refused_here("could not be compared")

    def test_a_linked_tree_is_compared_with_this_checkouts_lockfile(self) -> None:
        shared = self.root / "main" / "web" / "node_modules"
        shared.mkdir(parents=True)
        (shared / ".package-lock.json").write_text(
            json.dumps({"packages": self.installed}), encoding="utf-8"
        )
        link_directory(self.package / "node_modules", shared)
        (self.package / "package-lock.json").write_text(
            json.dumps({"packages": self.locked}), encoding="utf-8"
        )

        self.assertIsNone(isolated.modules_refusal(self.package))

        self.locked["node_modules/vite"] = locked_entry("vite", "9.0.0", dev=True)
        (self.package / "package-lock.json").write_text(
            json.dumps({"packages": self.locked}), encoding="utf-8"
        )

        # The plain advice would empty the other checkout's modules.
        self.assert_refused_here("vite is 8.3.5, locked 9.0.0", "remove the link", str(shared))

    def test_a_link_whose_target_went_is_refused_and_named(self) -> None:
        shared = self.root / "main" / "node_modules"
        shared.mkdir(parents=True)
        link_directory(self.package / "node_modules", shared)
        shared.rmdir()

        self.assert_refused_here("no node_modules", "remove the link")


class ModulesStepTests(ModulesCase):
    def run_with_steps(self, *steps: isolated.Step) -> tuple[int, str]:
        """The command, in a checkout of this test's, with `npm` standing for Python."""

        checkout = self.package.parent
        (checkout / "requirements-dev.txt").write_text("", encoding="utf-8")
        with (
            mock.patch.object(isolated, "ROOT", checkout),
            mock.patch.object(isolated, "GATE_STEPS", steps),
            mock.patch.object(isolated.release, "NPM", sys.executable),
            mock.patch.object(isolated.release, "require_toolchain", return_value={}),
        ):
            return quietly(isolated.main, ["gates", "--out", str(self.out)])

    STEPS = (
        isolated.Step("first", "python", 'python -c "print(1)"'),
        isolated.Step("web-test", "web", """npm -c "open('ran', 'w').close()" """, "web"),
        isolated.Step("last", "python", 'python -c "print(2)"'),
    )

    def test_a_refused_step_does_not_start_and_is_not_reported_as_a_red_one(self) -> None:
        self.installed["node_modules/vite"] = locked_entry("vite", "7.3.6", dev=True)
        self.write()

        code, said = self.run_with_steps(*self.STEPS)

        self.assertEqual(1, code)
        self.assertFalse((self.package / "ran").exists())
        self.assertRegex(said, r"web-test +refused +npm ci is needed in .*vite is 7\.3\.6")
        self.assertNotRegex(said, r"web-test +exit=")
        self.assertNotIn("failed:", said)
        self.assertIn("not run, because npm ci is needed first: web-test", said)
        self.assertNotIn("steps passed", said)
        self.assertIn("first          exit=0", said)
        self.assertIn("last           exit=0", said)
        log = (self.out / isolated.LOGS / "web-test.log").read_text(encoding="utf-8")
        self.assertIn("vite is 7.3.6", log)
        summary = (self.out / isolated.SUMMARY).read_text(encoding="utf-8")
        self.assertIn("web-test", summary)
        self.assertIn("refused", summary)

    def test_the_refusal_is_said_before_the_first_step_runs(self) -> None:
        code, said = self.run_with_steps(*self.STEPS)

        self.assertEqual(1, code)
        self.assertLess(said.index("will be refused"), said.index("first          exit=0"))

    def test_a_step_on_modules_that_match_runs(self) -> None:
        self.write()

        code, said = self.run_with_steps(*self.STEPS)

        self.assertEqual(0, code, said)
        self.assertTrue((self.package / "ran").exists())
        self.assertRegex(said, r"web-test +exit=0")
        self.assertNotIn("refused", said)
        self.assertIn("all 3 steps passed", said)

    def test_a_refusal_and_a_failure_are_both_said_and_kept_apart(self) -> None:
        code, said = self.run_with_steps(
            isolated.Step("broken", "python", 'python -c "raise SystemExit(3)"'), self.STEPS[1]
        )

        self.assertEqual(1, code)
        self.assertIn("failed: broken\n", said)
        self.assertIn("not run, because npm ci is needed first: web-test\n", said)

    def test_modules_that_go_while_the_steps_before_ran_refuse_the_step(self) -> None:
        self.write()
        run = isolated.Run(
            "web-test",
            [sys.executable, "-c", "open('ran', 'w').close()"],
            self.package,
            needs_modules=True,
        )
        replaced = self.run_python(
            "other-session",
            f"import os; os.remove({str(self.package / 'node_modules/.package-lock.json')!r})",
        )

        code, said = quietly(isolated.run_gates, [replaced, run], self.out, os.environ)

        self.assertEqual(1, code)
        self.assertFalse((self.package / "ran").exists())
        self.assertIn("refused", said)

    def test_every_npm_step_of_the_list_is_held_to_its_modules_and_no_other_is(self) -> None:
        self.assertEqual(
            {"web-test", "web-typecheck", "web-build", "desktop-test"},
            {step.name for step in isolated.GATE_STEPS if step.needs_modules},
        )

    def test_the_python_half_does_not_read_the_modules(self) -> None:
        run = self.run_python("only", "print(1)")
        with mock.patch.object(isolated, "modules_refusal") as refusal:
            code, _ = quietly(isolated.run_gates, [run], self.out, os.environ)

        self.assertEqual(0, code)
        refusal.assert_not_called()


class StepOutputTests(Workspace):
    #: "Ошибка: файл" in CP866, the code page of `cmd.exe` on a Russian Windows.
    OEM_BYTES = b"\x8e\xe8\xa8\xa1\xaa\xa0: \xe4\xa0\xa9\xab"

    def tail_of(self, content: bytes) -> str:
        log = self.out / "step.log"
        log.write_bytes(content)
        return isolated._tail(log)

    def test_a_line_from_the_console_is_read_in_the_consoles_code_page(self) -> None:
        with mock.patch.object(isolated, "_CONSOLE_CODEC", "cp866"):
            self.assertEqual("Ошибка: файл", self.tail_of(self.OEM_BYTES))

    def test_each_line_of_a_log_is_read_in_its_own_encoding(self) -> None:
        with mock.patch.object(isolated, "_CONSOLE_CODEC", "cp866"):
            tail = self.tail_of("✓ готово\r\n".encode() + self.OEM_BYTES + b"\r\n")

        self.assertEqual("✓ готово | Ошибка: файл", tail)

    def test_a_tail_cut_inside_a_character_is_not_taken_for_the_console(self) -> None:
        # Each line is 1401 bytes, so the 4096-byte window starts inside a character.
        line = "я" * 700 + "\n"
        tail = self.tail_of(line.encode() * 10)

        self.assertEqual({"я", " ", "|"}, set(tail))

    @unittest.skipUnless(sys.platform == "win32", "cmd.exe is what writes in the code page")
    def test_what_cmd_says_about_a_missing_tool_reads_as_text(self) -> None:
        run = isolated.Run("tool", ["cmd.exe", "/d", "/c", "no-such-tool-here"], ROOT)

        code, said = quietly(isolated.run_gates, [run], self.out, os.environ)

        self.assertEqual(1, code)
        self.assertIn("no-such-tool-here", said)
        self.assertNotIn("�", said)


class SupervisorTests(Workspace):
    """The supervisor against a stub, so the tree and the failures are this test's."""

    def setUp(self) -> None:
        super().setUp()
        self.stub = self.root / "stub_server.py"
        self.stub.write_text(STUB_SERVER, encoding="utf-8")
        self.report = self.root / "server.json"
        self.crash = self.root / "crash-now"

    def supervise(self, source: Path | None = None, exit_code: int = 0) -> threading.Thread:
        command = [sys.executable, str(self.stub), str(self.report), str(self.crash)]
        command.append(str(exit_code))
        thread = threading.Thread(target=isolated.supervise, args=(self.out, source, command))
        thread.start()
        self.addCleanup(thread.join, 30)
        self.addCleanup((self.out / isolated.STOP).touch)
        return thread

    def state(self) -> dict:
        return isolated._read_state(self.out) or {"state": "not yet"}

    def wait_for_state(self, *names: str) -> dict:
        self.assertTrue(
            wait_until(lambda: self.state()["state"] in names, seconds=30),
            f"never reached {names}: {self.state()}",
        )
        return self.state()

    def source_store(self) -> Path:
        source = self.root / "source.sqlite3"
        with contextlib.closing(sqlite3.connect(source)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE personal (value TEXT)")
            connection.execute("INSERT INTO personal VALUES ('private')")
            connection.commit()
        return source

    def test_stop_ends_the_whole_tree_and_only_then_reports(self) -> None:
        thread = self.supervise()
        ready = self.wait_for_state("ready")
        pids = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertTrue(alive(pids["server"]) and alive(pids["child"]), "the stub did not start")

        code, said = quietly(isolated.stop, self.out)
        thread.join(30)

        self.assertEqual(0, code, said)
        self.assertFalse(alive(ready["pid"]), "the recorded process survived")
        self.assertFalse(alive(pids["server"]), "the server survived")
        self.assertTrue(
            wait_until(lambda: not alive(pids["child"])), "the server's own child survived"
        )
        self.assertFalse(self.home.exists())
        self.assertFalse((self.out / isolated.STATE).exists())

    def test_the_server_is_given_the_isolated_environment_and_no_pipe(self) -> None:
        self.supervise()
        self.wait_for_state("ready")
        env = json.loads(self.report.read_text(encoding="utf-8"))["env"]
        quietly(isolated.stop, self.out)

        self.assertEqual(str(self.home), env["HOME"])
        self.assertEqual(str(self.home), env["USERPROFILE"])
        self.assertEqual(str(self.home / "AppData" / "Local"), env["LOCALAPPDATA"])
        self.assertEqual(str(isolated.store_path(self.home)), env["VALKAMA_DB"])
        self.assertEqual("1", env["VALKAMA_NO_TRAY"])

    def test_the_copy_is_served_read_from_the_source_and_gone_after_a_stop(self) -> None:
        source = self.source_store()
        before = source.read_bytes()
        self.supervise(source)
        self.wait_for_state("ready")
        copy = isolated.store_path(self.home)

        with contextlib.closing(sqlite3.connect(f"{copy.as_uri()}?mode=ro", uri=True)) as held:
            self.assertEqual([("private",)], held.execute("SELECT value FROM personal").fetchall())
        env = json.loads(self.report.read_text(encoding="utf-8"))["env"]
        self.assertEqual(str(copy), env["VALKAMA_DB"])

        code, said = quietly(isolated.stop, self.out)

        self.assertEqual(0, code, said)
        self.assertEqual([], [p for p in files_under(self.out) if "sqlite3" in p.name])
        self.assertEqual(before, source.read_bytes(), "the source store changed")

    def test_the_copy_goes_when_the_server_crashes_with_nobody_watching(self) -> None:
        self.supervise(self.source_store())
        ready = self.wait_for_state("ready")
        self.assertTrue(isolated.store_path(self.home).is_file())

        self.crash.write_text("now", encoding="utf-8")
        failed = self.wait_for_state("failed")

        self.assertFalse(self.home.exists(), "the copy outlived the server")
        self.assertIn("exited with code 7", failed["error"])
        self.assertTrue(wait_until(lambda: not alive(ready["pid"])))
        # The caller hears about it at the next stop rather than never.
        code, said = quietly(isolated.stop, self.out)
        self.assertEqual(1, code)
        self.assertIn("exited with code 7", said)
        self.assertFalse((self.out / isolated.STATE).exists())

    def test_the_copy_goes_when_the_server_never_comes_up(self) -> None:
        self.supervise(self.source_store(), exit_code=4)
        failed = self.wait_for_state("failed")

        self.assertIn("code 4 before listening", failed["error"])
        self.assertFalse(self.home.exists())

    def test_the_tree_is_stopped_when_the_server_never_says_it_is_listening(self) -> None:
        silent = self.root / "silent.py"
        silent.write_text("import time; time.sleep(60)", encoding="utf-8")
        with mock.patch.object(isolated, "START_SECONDS", 0.5):
            isolated.supervise(self.out, self.source_store(), [sys.executable, str(silent)])

        self.assertIn("did not start listening", self.state()["error"])
        self.assertFalse(self.home.exists())

    def test_a_missing_source_fails_without_creating_one(self) -> None:
        missing = self.root / "missing.sqlite3"

        isolated.supervise(self.out, missing, ["unused"])

        self.assertEqual("failed", self.state()["state"])
        self.assertFalse(missing.exists(), "the source was opened for writing")
        self.assertFalse(self.home.exists())

    def test_a_source_that_is_not_a_store_fails_and_leaves_nothing(self) -> None:
        garbage = self.root / "garbage.sqlite3"
        garbage.write_bytes(b"this is not a database at all" * 100)

        isolated.supervise(self.out, garbage, ["unused"])

        self.assertEqual("failed", self.state()["state"])
        self.assertFalse(self.home.exists())

    def test_the_copy_is_taken_through_a_read_only_connection(self) -> None:
        source = self.source_store()
        real_connect = sqlite3.connect
        with mock.patch.object(sqlite3, "connect", side_effect=real_connect) as spy:
            isolated.copy_store(source, self.home)

        assert_read_only(self, spy, source)
        self.assertTrue(isolated.store_path(self.home).is_file())

    def test_a_residue_is_reported_rather_than_called_clean(self) -> None:
        with mock.patch.object(isolated, "remove_tree", side_effect=[True, False]):
            isolated.supervise(self.out, None, ["no-such-program-anywhere"])

        self.assertEqual("failed", self.state()["state"])
        self.assertIn("still on disk", self.state()["error"])

    def test_a_stop_is_judged_by_what_is_left_and_not_by_the_tools_answer(self) -> None:
        real_stop = isolated.processes.stop_process_tree

        def stopped_but_says_no(process) -> bool:
            real_stop(process)
            return False

        thread = self.supervise()
        self.wait_for_state("ready")
        with mock.patch.object(
            isolated.processes, "stop_process_tree", side_effect=stopped_but_says_no
        ):
            code, said = quietly(isolated.stop, self.out)
            thread.join(30)

        self.assertEqual(0, code, said)

    def test_a_server_that_still_answers_is_reported_rather_than_called_stopped(self) -> None:
        with (
            mock.patch.object(isolated, "_answers", return_value=True),
            mock.patch.object(isolated, "REMOVE_SECONDS", 0.2),
        ):
            thread = self.supervise()
            self.wait_for_state("ready")
            code, said = quietly(isolated.stop, self.out)
            thread.join(30)

        self.assertEqual(1, code)
        self.assertIn("still answers", said)

    def test_stop_with_nothing_recorded_says_so_and_clears_a_leftover_profile(self) -> None:
        self.home.mkdir()

        code, said = quietly(isolated.stop, self.out)

        self.assertEqual(1, code)
        self.assertIn("no server is recorded", said)
        self.assertFalse(self.home.exists())

    def test_a_second_serve_is_refused_while_one_is_recorded(self) -> None:
        (self.out / isolated.STATE).write_text('{"state": "ready"}', encoding="utf-8")

        with mock.patch.object(subprocess, "Popen") as started:
            code, said = quietly(isolated.start, self.out, None)

        self.assertEqual(1, code)
        self.assertIn("run stop first", said)
        started.assert_not_called()


class ThroughTheCommandTests(Workspace):
    """The command as a caller runs it, against the real server."""

    def make_store(self, path: Path) -> Path:
        """A store the product creates at `path`, through its own connection."""

        subprocess.run(
            [sys.executable, "-c", "from server import store; store.connect().close()"],
            cwd=ROOT,
            env={**os.environ, "VALKAMA_DB": str(path)},
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=True,
        )
        return path

    def source_store(self) -> Path:
        return self.make_store(self.root / "source.sqlite3")

    def command(self, *arguments: str) -> tuple[int, str]:
        """Run it with pipes, and wait on them as `execFileSync` and a pipeline do.

        `communicate` returns only when every holder of the pipe has closed it, so
        a server that inherited one would run this into the timeout.
        """

        process = subprocess.Popen(
            [sys.executable, COMMAND, *arguments],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        try:
            output, _ = process.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            process.kill()
            # The holder has to go before the pipe can close and this can return.
            self.stop()
            process.communicate()
            self.fail(f"{arguments[0]} kept the caller's pipe open")
        return process.returncode, output.decode("utf-8", errors="replace")

    def stop(self) -> tuple[int, str]:
        return quietly(isolated.main, ["stop", "--out", str(self.out)])

    def served(self, code: int, said: str) -> dict[str, int]:
        self.addCleanup(self.stop)
        self.assertEqual(0, code, said)
        found = dict(re.findall(r"(\w+)=(\d+)", said))
        return {name: int(value) for name, value in found.items()}

    def serve(self, *arguments: str) -> dict[str, int]:
        return self.served(*quietly(isolated.main, ["serve", "--out", str(self.out), *arguments]))

    def get(self, port: int, path: str) -> int:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            connection.request("GET", path)
            return connection.getresponse().status
        finally:
            connection.close()

    def test_serve_answers_on_a_free_port_and_stop_ends_everything(self) -> None:
        served = self.served(*self.command("serve", "--out", str(self.out)))

        self.assertNotEqual(8642, served["port"])
        self.assertEqual(200, self.get(served["port"], "/api/modules"))
        self.assertTrue(alive(served["pid"]))
        self.assertTrue(alive(served["supervisor"]))
        self.assertTrue((self.out / isolated.LOGS / "serve.log").is_file())
        self.assertEqual([], files_under(self.real), "the server wrote into the real profile")

        code, said = self.stop()

        self.assertEqual(0, code, said)
        self.assertFalse(alive(served["pid"]))
        self.assertTrue(wait_until(lambda: not alive(served["supervisor"])))
        self.assertFalse(self.home.exists())
        with self.assertRaises(OSError):
            self.get(served["port"], "/api/modules")

    def test_the_default_copy_is_the_store_this_user_runs_on_and_goes_at_stop(self) -> None:
        source = self.source_store()
        before = source.read_bytes()
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(source)}):
            served = self.serve("--store-copy")

        self.assertEqual(200, self.get(served["port"], "/api/modules"))
        copy = isolated.store_path(self.home)
        with contextlib.closing(sqlite3.connect(f"{copy.as_uri()}?mode=ro", uri=True)) as held:
            tables = {row[0] for row in held.execute("SELECT name FROM sqlite_master")}
        self.assertIn("planning_spaces", tables)

        code, said = self.stop()

        self.assertEqual(0, code, said)
        self.assertFalse(self.home.exists())
        self.assertEqual([], [p for p in files_under(self.out) if "sqlite3" in p.name])
        self.assertEqual(before, source.read_bytes())

    def test_the_default_copy_serves_the_profile_store_when_valkama_db_is_unset(self) -> None:
        # The command as a caller runs it, with no VALKAMA_DB. In this process the
        # suite has already set one, which is why the in-process test cannot see
        # the default going wrong.
        profile_store = self.real / ".valkama" / "valkama.sqlite3"
        profile_store.parent.mkdir()
        self.make_store(profile_store)
        with contextlib.closing(sqlite3.connect(profile_store)) as writer:
            writer.execute("CREATE TABLE synthetic_marker (note TEXT NOT NULL)")
            writer.execute("INSERT INTO synthetic_marker VALUES ('from the profile')")
            writer.commit()
        before = profile_store.read_bytes()

        with mock.patch.dict(os.environ):
            os.environ.pop("VALKAMA_DB", None)
            self.assertNotIn("VALKAMA_DB", os.environ)
            code, said = self.command("serve", "--out", str(self.out), "--store-copy")
        served = self.served(code, said)

        self.assertEqual(200, self.get(served["port"], "/api/modules"))
        copy = isolated.store_path(self.home)
        with contextlib.closing(sqlite3.connect(f"{copy.as_uri()}?mode=ro", uri=True)) as held:
            notes = [row[0] for row in held.execute("SELECT note FROM synthetic_marker")]
        self.assertEqual(["from the profile"], notes)
        self.assertEqual(before, profile_store.read_bytes())

        code, said = self.stop()

        self.assertEqual(0, code, said)
        self.assertFalse(self.home.exists())
        self.assertEqual(before, profile_store.read_bytes())

    def test_a_store_copy_brings_the_callers_project_registry_and_leaves_it_alone(self) -> None:
        caller = self.root / "caller"
        registry = caller / "Valkama"
        registry.mkdir(parents=True)
        files = {"projects.json": b'{"projects": []}', "project-registry.toml": b"# inventory"}
        for name, content in files.items():
            (registry / name).write_bytes(content)

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": str(caller)}):
            self.serve("--store-copy", str(self.source_store()))

        copied = self.home / "AppData" / "Local" / "Valkama"
        for name, content in files.items():
            self.assertEqual(content, (copied / name).read_bytes(), name)

        code, said = self.stop()

        self.assertEqual(0, code, said)
        self.assertFalse(self.home.exists())
        for name, content in files.items():
            self.assertEqual(content, (registry / name).read_bytes(), name)

    def test_serve_reports_a_store_it_cannot_copy(self) -> None:
        self.addCleanup(self.stop)
        code, said = quietly(
            isolated.main,
            ["serve", "--out", str(self.out), "--store-copy", str(self.root / "missing.sqlite3")],
        )

        self.assertEqual(1, code, said)
        self.assertIn("serve failed", said)
        self.assertFalse(self.home.exists())
        self.assertFalse((self.out / isolated.STATE).exists())

    def test_a_dead_supervisor_still_leaves_stop_able_to_finish_the_job(self) -> None:
        served = self.serve("--store-copy", str(self.source_store()))

        os.kill(served["supervisor"], signal.SIGTERM)
        self.assertTrue(wait_until(lambda: not alive(served["supervisor"])))
        self.assertTrue(alive(served["pid"]), "the supervisor took the server with it")
        self.assertTrue(isolated.store_path(self.home).is_file())

        code, said = self.stop()

        self.assertEqual(0, code, said)
        self.assertIn("had died", said)
        self.assertTrue(wait_until(lambda: not alive(served["pid"])))
        self.assertFalse(self.home.exists())
        with self.assertRaises(OSError):
            self.get(served["port"], "/api/modules")


#: What a rehearsal profile's child must have set.
PROFILE_SETTINGS = (
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "VALKAMA_DB",
    "VALKAMA_PROTECTED_STORE",
    "VALKAMA_NO_TRAY",
    "VALKAMA_NO_ALERTS",
    "GIT_CONFIG_GLOBAL",
    "VALKAMA_PORT",
)


class ProfileTests(Workspace):
    """`profile` against a fake home of the caller's, with a link out of it."""

    def setUp(self) -> None:
        super().setUp()
        self.profile = self.root / "rehearsal's profile"
        self.outside = self.root / "outside"
        self.outside.mkdir()
        (self.outside / "kept.txt").write_text("outside", encoding="utf-8")
        runtime = self.real / ".agent-host-runtime"
        (runtime / "current").mkdir(parents=True)
        (runtime / "current" / "release.txt").write_text("release", encoding="utf-8")
        link_directory(runtime / "linked", self.outside)
        (self.real / ".claude").mkdir()
        (self.real / ".claude" / "settings.json").write_text("{}", encoding="utf-8")
        (self.real / ".gitconfig").write_text("[user]\n\tname = Fixture\n", encoding="utf-8")
        registry = self.real / "local" / "Valkama"
        registry.mkdir()
        (registry / "projects.json").write_text('{"projects": []}', encoding="utf-8")
        (registry / "project-registry.toml").write_text("# inventory", encoding="utf-8")
        self.source = self.root / "source" / "valkama.sqlite3"
        self.source.parent.mkdir()
        with contextlib.closing(sqlite3.connect(self.source)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE personal (value TEXT)")
            connection.execute("INSERT INTO personal VALUES ('private')")
            connection.commit()

    @property
    def profile_home(self) -> Path:
        return self.profile / isolated.HOME

    def make(self, *arguments: str) -> tuple[int, str]:
        command = ["profile", "--out", str(self.profile), "--store-copy", str(self.source)]
        return quietly(isolated.main, [*command, *arguments])

    def made(self, *arguments: str) -> str:
        code, said = self.make(*arguments)
        self.assertEqual(0, code, said)
        self.addCleanup(quietly, isolated.main, ["stop", "--out", str(self.profile)])
        return said

    def environment(self) -> dict:
        return json.loads((self.profile / isolated.PROFILE_ENV).read_text(encoding="utf-8"))

    def test_a_profile_holds_the_store_the_registry_host_runtime_and_each_named_path(
        self,
    ) -> None:
        self.made("--copy", ".claude")

        copy = isolated.store_path(self.profile_home)
        with contextlib.closing(sqlite3.connect(f"{copy.as_uri()}?mode=ro", uri=True)) as held:
            self.assertEqual([("private",)], held.execute("SELECT value FROM personal").fetchall())
        expected = {
            "AppData/Local/Valkama/projects.json": '{"projects": []}',
            "AppData/Local/Valkama/project-registry.toml": "# inventory",
            ".agent-host-runtime/current/release.txt": "release",
            ".claude/settings.json": "{}",
            ".gitconfig": "[user]\n\tname = Fixture\n",
        }
        for relative, content in expected.items():
            self.assertEqual(content, (self.profile_home / relative).read_text("utf-8"), relative)

    def test_a_link_under_a_copied_path_is_neither_entered_nor_copied_but_named(self) -> None:
        said = self.made()

        self.assertFalse(os.path.lexists(self.profile_home / ".agent-host-runtime" / "linked"))
        self.assertEqual([], [p for p in files_under(self.profile) if p.name == "kept.txt"])
        self.assertIn(f"not copied, a link: {self.real / '.agent-host-runtime' / 'linked'}", said)

    def test_a_named_path_that_is_or_passes_a_link_is_refused_and_nothing_is_left(self) -> None:
        for named in (".agent-host-runtime/linked", ".agent-host-runtime/linked/kept.txt"):
            with self.subTest(named):
                code, said = self.make("--copy", named)

                self.assertEqual(1, code, said)
                self.assertIn("is a link", said)
                self.assertFalse(os.path.lexists(self.profile))

    def test_a_named_path_outside_the_home_or_missing_is_refused(self) -> None:
        for named, refusal in (
            ("../outside", "inside the home"),
            (str(self.outside), "inside the home"),
            (".nothing-here", "does not exist"),
        ):
            with self.subTest(named):
                code, said = self.make("--copy", named)

                self.assertEqual(1, code, said)
                self.assertIn(refusal, said)
                self.assertFalse(os.path.lexists(self.profile))

    def test_the_environment_sets_the_rehearsal_variables_and_removes_the_client_homes(
        self,
    ) -> None:
        with mock.patch.dict(
            os.environ, {"CLAUDE_CONFIG_DIR": str(self.real), "CODEX_HOME": str(self.real)}
        ):
            self.made()
        home = self.profile_home

        settings, removed = self.environment()["set"], self.environment()["unset"]
        expected = {
            "HOME": str(home),
            "USERPROFILE": str(home),
            "LOCALAPPDATA": str(home / "AppData" / "Local"),
            "APPDATA": str(home / "AppData" / "Roaming"),
            "VALKAMA_DB": str(home / ".valkama" / "valkama.sqlite3"),
            "VALKAMA_PROTECTED_STORE": str(self.real / ".valkama" / "valkama.sqlite3"),
            "VALKAMA_NO_TRAY": "1",
            "VALKAMA_NO_ALERTS": "1",
            "GIT_CONFIG_GLOBAL": str(home / ".gitconfig"),
        }
        self.assertEqual(expected, {name: settings[name] for name in expected})
        self.assertEqual(sorted(PROFILE_SETTINGS), sorted(set(PROFILE_SETTINGS) & set(settings)))
        port = int(settings["VALKAMA_PORT"])
        self.assertNotEqual(8642, port)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
        for name in ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "VALKAMA_AUTHOR", "VALKAMA_CUTOVER"):
            self.assertIn(name, removed)
        self.assertEqual([], [name for name in removed if name in settings])

    @unittest.skipUnless(shutil.which("pwsh"), "env.ps1 is for pwsh")
    def test_env_ps1_gives_a_pwsh_the_environment_env_json_names(self) -> None:
        self.made()
        settings, removed = self.environment()["set"], self.environment()["unset"]

        def quoted(text: object) -> str:
            return "'" + str(text).replace("'", "''") + "'"

        names = ", ".join(quoted(name) for name in [*settings, *removed])
        script = (
            f". {quoted(self.profile / isolated.PROFILE_SCRIPT)}; $found = @{{}}; "
            f"foreach ($name in @({names})) {{ "
            "$found[$name] = [Environment]::GetEnvironmentVariable($name) }; "
            "$found | ConvertTo-Json -Compress"
        )
        loaded = subprocess.run(
            ["pwsh", "-NoProfile", "-NonInteractive", "-Command", script],
            env={**os.environ, "CLAUDE_CONFIG_DIR": "set", "CODEX_HOME": "set"},
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            timeout=60,
        )

        self.assertEqual(0, loaded.returncode, loaded.stderr.decode("utf-8", "replace"))
        found = json.loads(loaded.stdout.decode("utf-8"))
        self.assertEqual(settings, {name: found[name] for name in settings})
        self.assertEqual(dict.fromkeys(removed), {name: found[name] for name in removed})

    def test_the_source_store_is_opened_only_read_only_and_left_without_a_journal(self) -> None:
        before = self.source.read_bytes()
        real_connect = sqlite3.connect
        with mock.patch.object(sqlite3, "connect", side_effect=real_connect) as spy:
            self.made()

        assert_read_only(self, spy, self.source)
        self.assertEqual(before, self.source.read_bytes())

    def test_an_existing_directory_is_refused_and_left_as_it_was(self) -> None:
        for content in ({}, {"own.txt": "the owner's"}):
            with self.subTest(content=content):
                self.profile.mkdir()
                for name, text in content.items():
                    (self.profile / name).write_text(text, encoding="utf-8")

                code, said = self.make()

                self.assertEqual(1, code, said)
                self.assertIn("already exists", said)
                self.assertEqual(
                    content,
                    {p.name: p.read_text("utf-8") for p in self.profile.iterdir()},
                )
                (self.profile / "own.txt").unlink(missing_ok=True)
                self.profile.rmdir()

    def test_a_store_that_cannot_be_copied_leaves_no_profile(self) -> None:
        self.source = self.root / "missing.sqlite3"

        code, said = self.make()

        self.assertEqual(1, code, said)
        self.assertIn("profile failed", said)
        self.assertFalse(os.path.lexists(self.profile))
        self.assertFalse(self.source.exists())

    def test_stop_removes_the_profile_without_entering_a_link_in_it(self) -> None:
        self.made()
        link_directory(self.profile_home / "into-outside", self.outside)

        code, said = quietly(isolated.main, ["stop", "--out", str(self.profile)])

        self.assertEqual(0, code, said)
        self.assertFalse(os.path.lexists(self.profile))
        self.assertEqual("outside", (self.outside / "kept.txt").read_text("utf-8"))

    def test_gates_and_serve_refuse_a_directory_holding_a_profile(self) -> None:
        self.made()

        with mock.patch.object(subprocess, "Popen") as started:
            code, said = quietly(isolated.start, self.profile, None)
        self.assertEqual((1, True), (code, "a profile is in" in said), said)
        started.assert_not_called()
        code, said = quietly(isolated.gates, [], self.profile)
        self.assertEqual((1, True), (code, "a profile is in" in said), said)
        self.assertTrue(isolated.store_path(self.profile_home).is_file())


class RecordedProcessTests(Workspace):
    def test_a_recorded_number_is_not_stopped_without_its_port(self) -> None:
        sleeper = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(sleeper.wait)
        self.addCleanup(sleeper.kill)

        # Port 1 answers nothing: this number now belongs to somebody else.
        problems = isolated._stop_orphan({"pid": sleeper.pid, "port": 1})

        self.assertEqual([], problems)
        self.assertIsNone(sleeper.poll(), "a process that merely reused the number was stopped")


if __name__ == "__main__":
    unittest.main()
