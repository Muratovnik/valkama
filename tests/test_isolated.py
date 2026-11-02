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
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from tests import isolated
from tests.test_mcp_front import alive, wait_until

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
keys = ("HOME", "USERPROFILE", "LOCALAPPDATA", "VALKAMA_DB", "VALKAMA_NO_TRAY", "TEMP")
report = {"paths": paths, "env": {key: os.environ.get(key) for key in keys}}
Path(sys.argv[1]).write_text(json.dumps(report), encoding="utf-8")
"""


def files_under(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*") if path.is_file())


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

        for name in ("HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "VALKAMA_DB"):
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
        self.assertNotIn("GIT_CONFIG_GLOBAL", environment)


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
        self.assertEqual(10, len(python))
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
        target = self.root / "copy.sqlite3"
        real_connect = sqlite3.connect
        with mock.patch.object(sqlite3, "connect", side_effect=real_connect) as spy:
            isolated.copy_store(source, target)

        arguments = spy.call_args_list[0]
        self.assertTrue(arguments.args[0].endswith("?mode=ro"), arguments)
        self.assertTrue(arguments.kwargs["uri"], arguments)

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

    def source_store(self) -> Path:
        source = self.root / "source.sqlite3"
        subprocess.run(
            [sys.executable, "-c", "from server import store; store.connect().close()"],
            cwd=ROOT,
            env={**os.environ, "VALKAMA_DB": str(source)},
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=True,
        )
        return source

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
