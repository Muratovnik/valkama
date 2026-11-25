"""What `tests/heavy_gate.py` owes: Valkama's heavy runs at the machine's gate, and directly without it.

The gate is stood in for by `tests/heavy_gate_double.py`, which speaks the part of
its contract the runners use; the earlier branches' lock is a file in a directory
this test made. Neither is ever the machine's: the suite itself runs under a lease
of the real gate and at the real lock, which it takes as it loads.
"""

from __future__ import annotations

import io
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

import tests
from tests import heavy_gate, heavy_gate_double, legacy_lock
from tests.test_legacy_lock import DEADLINE_SECONDS, earlier_whole_machine_run

ROOT = Path(__file__).resolve().parents[1]
COMMAND = str(ROOT / "tests" / "heavy_gate.py")

#: Prints, as one JSON line, what a command under a lease sees: its arguments, K, the
#: lease, the earlier branches' lock's mark, and the runs going at the lock at argv[1].
OBSERVER = """\
import json, os, sys
sys.path.insert(0, sys.argv[2])
from pathlib import Path
from tests import legacy_lock
going, _waiting = legacy_lock.entries(Path(sys.argv[1]))
print(json.dumps({
    "args": sys.argv[3:],
    "k": os.environ.get("HEAVY_GATE_K"),
    "lease": os.environ.get("HEAVY_GATE_LEASE"),
    "mark": os.environ.get("VALKAMA_HEAVY_TEST_LOCK_HELD"),
    "going": [[entry.cpus, entry.lease] for entry in going],
}))
sys.exit(int(os.environ.get("OBSERVER_EXIT", "0")))
"""


class GateCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-gate-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        self.lock = self.directory / "heavy.lock"
        self.state = self.directory / "gate"
        self.entry = heavy_gate_double.write_entry_point(self.state)
        # The suite runs under the real gate's lease and the real lock's mark; these runs
        # are not its children, and no agent session decides whether they wait.
        environment = mock.patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        for name in (
            legacy_lock.HELD_BY_ANCESTOR,
            heavy_gate.LEASE_VARIABLE,
            heavy_gate.K_VARIABLE,
            heavy_gate.WAIT_VARIABLE,
            heavy_gate.GATE_VARIABLE,
            *heavy_gate.AGENT_VARIABLES,
        ):
            os.environ.pop(name, None)
        self.said: list[str] = []
        self.stderr = ""
        self.stdout = ""

    def observed(self, kind: str, *words: str, **options: object) -> tuple[int, dict]:
        """`run` of the observer as `kind`, and what the observer saw; `{}` when it never ran."""

        options.setdefault("gate", str(self.entry))
        command = [sys.executable, "-c", OBSERVER, str(self.lock), str(ROOT), *words]
        return self.ran(kind, command, **options)

    def ran(self, kind: str, command: list[str], **options: object) -> tuple[int, dict]:
        """`run` of `command` as `kind`, and the last JSON line it printed; `{}` for none."""

        out = self.directory / "observed.json"
        out.unlink(missing_ok=True)
        options.setdefault("lock", self.lock)
        call = self._call(out)
        with (
            mock.patch.object(subprocess, "call", call),
            # The gate's command, which `run` waits for while its caller is there.
            mock.patch.object(heavy_gate, "_until_gone", lambda argv, *_rest: call(argv)),
        ):
            code = heavy_gate.run(kind, command, say=self.said.append, **options)  # type: ignore[arg-type]
        return code, json.loads(out.read_text()) if out.is_file() else {}

    def _call(self, out: Path) -> Callable[..., int]:
        """`subprocess.call` that keeps the observer's line, which the command prints last."""

        real = subprocess.run

        def call(argv: list[str], **options: object) -> int:
            done = real(argv, capture_output=True, check=False, **options)  # type: ignore[call-overload]
            self.stderr = done.stderr.decode(errors="replace")
            self.stdout = done.stdout.decode(errors="replace")
            lines = [line for line in self.stdout.splitlines() if line.startswith("{")]
            if lines:
                out.write_text(lines[-1])
            return int(done.returncode)

        return call


class FindGateTests(GateCase):
    def test_the_gate_is_found_on_path_before_the_logon_profile(self) -> None:
        profile = self.directory / "profile"
        installed = heavy_gate_double.write_entry_point(profile / ".agent-host-runtime" / "bin")
        environment = {"PATH": os.pathsep.join(["", str(self.state)])}
        with mock.patch.object(heavy_gate, "logon_profile", return_value=str(profile)):
            found = heavy_gate.find_gate(environment)
            self.assertIsNotNone(found)
            assert found is not None
            self.assertEqual(self.state, found.state)
            fallback = heavy_gate.find_gate({"PATH": ""})
        assert fallback is not None
        self.assertEqual(installed.parent, fallback.state)
        self.assertEqual(sys.executable, fallback.argv[0])

    def test_a_moved_userprofile_finds_no_gate(self) -> None:
        # `tests/isolated.py gates` moves USERPROFILE into a throwaway profile; a gate
        # found through it would hold only the runs given that profile.
        profile = self.directory / "moved"
        heavy_gate_double.write_entry_point(profile / ".agent-host-runtime" / "bin")
        with mock.patch.object(heavy_gate, "logon_profile", return_value=None):
            self.assertIsNone(heavy_gate.find_gate({"PATH": "", "USERPROFILE": str(profile)}))

    def test_the_test_variable_names_the_entry_point_and_an_unusable_one_is_said(self) -> None:
        found = heavy_gate.find_gate({heavy_gate.GATE_VARIABLE: str(self.entry)})
        self.assertEqual(self.state, found.state if found else None)
        self.assertIsNone(heavy_gate.find_gate({heavy_gate.GATE_VARIABLE: str(self.lock)}))
        later = self.directory / "later.json"
        later.write_text(json.dumps({"protocol": 2, "argv": ["x"], "state": "s"}))
        with self.assertRaisesRegex(heavy_gate.GateError, "protocol 1"):
            heavy_gate.find_gate({heavy_gate.GATE_VARIABLE: str(later)})
        # Run with it, a command goes without the gate and says so.
        code, seen = self.observed("unittest-suite", gate=str(later))
        self.assertEqual(0, code)
        self.assertIsNone(seen["lease"])
        self.assertIn("the heavy-process gate cannot be used", self.said[0])


class WaitTests(unittest.TestCase):
    def test_an_agent_session_does_not_wait_and_anything_else_does_unless_told(self) -> None:
        self.assertTrue(heavy_gate.waits(None, {}))
        # The variables the gate's contract names as marking an agent's session.
        for name in ("CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "AI_AGENT", "CODEX_THREAD_ID"):
            with self.subTest(name=name):
                self.assertFalse(heavy_gate.waits(None, {name: "1"}))
        self.assertTrue(heavy_gate.waits(None, {"CLAUDECODE": "1", "HEAVY_GATE_WAIT": "1"}))
        self.assertFalse(heavy_gate.waits(None, {"HEAVY_GATE_WAIT": "0"}))
        self.assertTrue(heavy_gate.waits(True, {"HEAVY_GATE_WAIT": "0"}))
        self.assertFalse(heavy_gate.waits(False, {}))


class DirectRunTests(GateCase):
    def test_without_a_gate_the_command_runs_directly_with_k_its_want(self) -> None:
        missing = str(self.directory / "none.json")
        code, seen = self.observed("vitest-suite", "--maxWorkers={k}", want=3, gate=missing)
        self.assertEqual(0, code)
        self.assertEqual(["--maxWorkers=3"], seen["args"])
        self.assertIsNone(seen["lease"])
        self.assertEqual([], seen["going"])
        self.assertEqual([], heavy_gate_double.calls(self.state))

    def test_without_a_gate_or_a_want_k_is_the_want_the_rules_give_the_kind(self) -> None:
        missing = str(self.directory / "none.json")
        _code, seen = self.observed("vitest-suite", "--maxWorkers={k}", gate=missing)
        self.assertEqual([f"--maxWorkers={heavy_gate.rules_want('vitest-suite')}"], seen["args"])
        self.assertIsNotNone(heavy_gate.rules_want("vitest-suite"))
        code, seen = self.observed("unittest-suite", "{k}", gate=missing)
        self.assertEqual(heavy_gate.EXIT_USAGE, code)
        self.assertEqual({}, seen)

    def test_a_program_that_is_not_there_fails_with_127(self) -> None:
        missing = str(self.directory / "none.json")
        code = heavy_gate.run(
            "unittest-suite", ["no-such-program-here"], gate=missing, say=self.said.append
        )
        self.assertEqual(heavy_gate.EXIT_NOT_FOUND, code)


class StartTests(GateCase):
    """A command that cannot start fails before any lease; one found by PATHEXT starts by its path."""

    def test_a_program_that_is_not_there_fails_before_the_run_asks_for_a_lease(self) -> None:
        code = heavy_gate.run(
            "unittest-suite",
            ["no-such-program-here"],
            lock=self.lock,
            gate=str(self.entry),
            say=self.said.append,
        )
        self.assertEqual(heavy_gate.EXIT_NOT_FOUND, code)
        self.assertIn("no such program", self.said[0])
        self.assertEqual([], heavy_gate_double.calls(self.state))

    @unittest.skipUnless(sys.platform == "win32", "only Windows has a timeout of its own")
    def test_the_windows_timeout_is_refused_before_the_run_asks_for_a_lease(self) -> None:
        windows = Path(os.environ["SYSTEMROOT"])
        found = {"timeout": str(windows / "System32" / "TIMEOUT.EXE")}
        with mock.patch.object(heavy_gate.shutil, "which", side_effect=found.get):
            code = heavy_gate.run(
                "browser-targeted",
                ["timeout", "900", "npx", "playwright"],
                lock=self.lock,
                gate=str(self.entry),
                say=self.said.append,
            )
        self.assertEqual(heavy_gate.EXIT_USAGE, code)
        self.assertIn("is the Windows timeout", self.said[0])
        self.assertEqual([], heavy_gate_double.calls(self.state))
        # A `timeout` found elsewhere on the path, as Git's, is the one the command means.
        elsewhere = self.directory / "usr" / "bin" / "timeout.exe"
        self.assertFalse(heavy_gate._windows_timeout(elsewhere))

    @unittest.skipUnless(sys.platform == "win32", "PATHEXT is how Windows names a script")
    def test_a_program_found_by_its_pathext_extension_starts_by_its_path(self) -> None:
        # `npx` is `npx.cmd`: Windows starts only an `.exe` by a bare name.
        folder = self.directory / "bin"
        folder.mkdir()
        (folder / "probe-script.cmd").write_text("@exit /b 7\r\n", encoding="ascii")
        path = os.pathsep.join([str(folder), os.environ.get("PATH", "")])
        with mock.patch.dict(os.environ, {"PATH": path}):
            code = heavy_gate.run(
                "unittest-suite",
                ["probe-script", "a"],
                lock=self.lock,
                gate=str(self.entry),
                say=self.said.append,
            )
        self.assertEqual(7, code)
        [call] = heavy_gate_double.calls(self.state)
        self.assertEqual(["run", "--kind", "unittest-suite"], call[:3])


class GateRunTests(GateCase):
    def test_the_command_runs_under_a_lease_with_k_and_its_exit_code_comes_back(self) -> None:
        with mock.patch.dict(os.environ, {"OBSERVER_EXIT": "3"}):
            code, seen = self.observed(
                "vitest-suite", "--maxWorkers={k}", want=5, wait=True, size=40
            )
        self.assertEqual(3, code)
        self.assertEqual(["--maxWorkers=5"], seen["args"])
        self.assertEqual("5", seen["k"])
        self.assertIn("heavy-gate: admitted valkama:vitest-suite after 0 s: K=5", self.stderr)
        self.assertTrue(seen["lease"].startswith("double-"), seen)
        [call] = heavy_gate_double.calls(self.state)
        self.assertEqual(["run", "--kind", "vitest-suite", "--wait"], call[:4])
        before = call[: call.index("--")]
        self.assertEqual("40", before[before.index("--size") + 1])
        self.assertEqual("5", before[before.index("--want") + 1])

    def test_earlier_branches_see_the_run_at_their_lock_with_its_profiles_cores(self) -> None:
        _code, seen = self.observed("browser-suite", wait=True)
        self.assertEqual([[math.ceil(heavy_gate_double.CORES), seen["lease"]]], seen["going"])
        self.assertEqual(legacy_lock.marker(self.lock)[legacy_lock.HELD_BY_ANCESTOR], seen["mark"])
        # It leaves the lock as it found it.
        self.assertEqual(([], []), legacy_lock.entries(self.lock))

    def test_in_an_agent_session_a_refusal_comes_back_at_once_and_the_command_never_runs(
        self,
    ) -> None:
        (self.state / "refuse").write_text("")
        with mock.patch.dict(os.environ, {"CLAUDECODE": "1"}):
            code, seen = self.observed("browser-suite")
        self.assertEqual(heavy_gate.EXIT_NO_ROOM, code)
        self.assertEqual({}, seen)
        [call] = heavy_gate_double.calls(self.state)
        self.assertIn("--no-wait", call[: call.index("--")])

    def test_without_waiting_an_earlier_whole_machine_run_refuses_before_any_lease(self) -> None:
        with earlier_whole_machine_run(self.lock):
            code, seen = self.observed("browser-suite", wait=False)
        self.assertEqual(heavy_gate.EXIT_NO_ROOM, code)
        self.assertEqual({}, seen)
        self.assertEqual([], heavy_gate_double.calls(self.state))
        self.assertIn("is held by an earlier whole-suite run in C:/earlier-branch", self.said[0])
        self.assertIn("HEAVY_GATE_WAIT=1", self.said[0])

    def test_the_command_line_names_the_gate_and_the_lock_a_test_stands_in(self) -> None:
        command = heavy_gate.gated_command(
            "unittest-suite", ["python", "-m", "unittest"], want=2, lock=self.lock, gate="G"
        )
        self.assertEqual([sys.executable, COMMAND, "run", "--kind", "unittest-suite"], command[:5])
        self.assertEqual(["--want", "2", "--lock", str(self.lock), "--gate", "G"], command[5:11])
        self.assertEqual(["--", "python", "-m", "unittest"], command[11:])


class LeaseCpusTests(GateCase):
    def lease(self, profile: object) -> str:
        leases = self.state / "leases"
        leases.mkdir(parents=True, exist_ok=True)
        (leases / "L-1.json").write_text(json.dumps({"profile": profile}))
        return "L-1"

    def test_a_lease_counts_its_profiles_cores_rounded_up(self) -> None:
        self.assertEqual(7, heavy_gate.lease_cpus(self.state, self.lease({"cores_total": 6.1})))

    def test_a_whole_machine_lease_no_lease_or_an_unreadable_one_counts_the_machine(self) -> None:
        machine = os.cpu_count() or 1
        whole = self.lease({"cores_total": 3.0, "whole_machine": True})
        self.assertEqual(machine, heavy_gate.lease_cpus(self.state, whole))
        self.assertEqual(
            machine, heavy_gate.lease_cpus(self.state, self.lease({"cores_total": None}))
        )
        self.assertEqual(machine, heavy_gate.lease_cpus(self.state, None))
        self.assertEqual(machine, heavy_gate.lease_cpus(self.state, "no-such-lease"))
        self.assertEqual(machine, heavy_gate.lease_cpus(self.state, "../escape"))


#: Takes a lease for the whole suite as `load_tests` does, then prints, as one JSON line,
#: its own process id, the lease and K it set, its mark, and the runs at the lock.
HOLDING_SUITE = """\
import json, os, sys
sys.path.insert(0, sys.argv[3])
from pathlib import Path
from tests import heavy_gate, legacy_lock
lock = Path(sys.argv[1])
heavy_gate.hold_until_exit("unittest-suite", lock=lock, gate=sys.argv[2])
going, _waiting = legacy_lock.entries(lock)
print(json.dumps({
    "pid": os.getpid(),
    "lease": os.environ.get("HEAVY_GATE_LEASE"),
    "marked": legacy_lock.under_holder(lock),
    "going": [[entry.cpus, entry.lease] for entry in going],
}), flush=True)
heavy_gate.hold_until_exit("unittest-suite", lock=lock, gate=sys.argv[2])
"""


class HoldTests(GateCase):
    def hold(self, **environment: str) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [sys.executable, "-c", HOLDING_SUITE, str(self.lock), str(self.entry), str(ROOT)],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            env={**os.environ, **environment},
            timeout=DEADLINE_SECONDS,
            check=False,
        )

    def test_the_suite_holds_a_lease_for_its_own_process_and_its_place_at_the_lock(self) -> None:
        done = self.hold()
        self.assertEqual(0, done.returncode, done.stderr)
        seen = json.loads(done.stdout.splitlines()[-1])
        self.assertTrue(seen["lease"].startswith("double-"), seen)
        self.assertTrue(seen["marked"])
        self.assertEqual([[math.ceil(heavy_gate_double.CORES), seen["lease"]]], seen["going"])
        # One hold, for its own process; the second call found the mark and asked nothing.
        [call] = heavy_gate_double.calls(self.state)
        self.assertEqual(["hold", "--kind", "unittest-suite", "--pid", str(seen["pid"])], call[:5])
        self.assertIn(b"heavy-gate: admitted valkama:unittest-suite after 0 s", done.stderr)
        # Its place went with it.
        self.assertEqual(([], []), legacy_lock.entries(self.lock, reclaim=True))

    def test_with_no_room_in_an_agent_session_the_suite_exits_75_saying_why(self) -> None:
        (self.state / "refuse").write_text("")
        done = self.hold(CLAUDECODE="1")
        self.assertEqual(heavy_gate.EXIT_NO_ROOM, done.returncode)
        self.assertEqual(b"", done.stdout)
        self.assertIn(heavy_gate_double.REFUSAL.encode(), done.stderr)
        [call] = heavy_gate_double.calls(self.state)
        self.assertIn("--no-wait", call)


#: Starts the command in its arguments, says its process id, and sleeps until killed: the
#: caller of a run, such as the shell an agent's tool started it from.
CALLER = """\
import subprocess, sys, time
print(subprocess.Popen(sys.argv[1:]).pid, flush=True)
time.sleep(120)
"""

#: How soon a run whose caller is gone gives up its place, at most.
LEAVE_SECONDS = 10.0


def _running(pid: int) -> bool:
    if sys.platform == "win32":
        import _winapi

        try:
            handle = _winapi.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        except OSError:
            return False
        try:
            return _winapi.WaitForSingleObject(handle, 0) != _winapi.WAIT_OBJECT_0
        finally:
            _winapi.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


@unittest.skipUnless(sys.platform == "win32", "a process is watched through its handle there")
class WatchedTests(unittest.TestCase):
    """A watched process is gone once it exits, or at once when its id now names another."""

    def test_a_process_is_there_until_it_exits(self) -> None:
        child = subprocess.Popen(
            [sys.executable, "-c", "import sys; sys.stdin.read()"], stdin=subprocess.PIPE
        )
        self.addCleanup(child.wait, DEADLINE_SECONDS)
        started = heavy_gate._started(child.pid)
        self.assertTrue(started)
        with heavy_gate.Watched(child.pid, started=started) as watched:
            self.assertFalse(watched.gone())
            assert child.stdin is not None
            child.stdin.close()
            child.wait(DEADLINE_SECONDS)
            self.assertTrue(watched.gone())

    def test_an_id_that_started_at_another_time_or_after_the_run_is_another_process(self) -> None:
        def gone(pid: int, **named: str) -> bool:
            with heavy_gate.Watched(pid, **named) as watched:
                return watched.gone()

        mine = heavy_gate._started(os.getpid())
        self.assertFalse(gone(os.getpid(), started=mine))
        self.assertTrue(gone(os.getpid(), started="2000-01-01T00:00:00.0000000Z"))
        # A caller starts before what it starts: one that started later took its id.
        self.assertTrue(gone(os.getpid(), before=mine))
        self.assertFalse(gone(os.getppid(), before=mine))
        self.assertTrue(gone(0x7FFFFFF0))  # a pid that does not exist


class AbandonedWaitTests(GateCase):
    """A run waiting for room leaves once the process that asked for it is gone.

    Admitted by the gate, it waits for the earlier branches' lock, which an earlier
    whole-machine run holds, keeping the gate's lease all the while. Its caller, or
    the run itself, is then killed alone, as a stop of a part of the tree kills it.
    """

    def started(self, *argv: str) -> tuple[subprocess.Popen[bytes], int]:
        """A caller of `argv`, and the process id of what it started."""

        caller = subprocess.Popen(
            [sys.executable, "-c", CALLER, *argv],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(self._end, caller)
        assert caller.stdout is not None
        return caller, int(caller.stdout.readline())

    def until(self, there: Callable[[], bool], what: str) -> None:
        deadline = time.monotonic() + DEADLINE_SECONDS
        while not there():
            self.assertLess(time.monotonic(), deadline, what)
            time.sleep(0.05)

    def waiting(self) -> tuple[subprocess.Popen[bytes], int, Path]:
        """A caller, the run it started, and the marker the command would leave."""

        marker = self.directory / "ran"
        command = [sys.executable, "-c", f"open({str(marker)!r}, 'w').close()"]
        caller, run = self.started(
            *(sys.executable, COMMAND, "run", "--kind", "browser-targeted", "--wait"),
            *(f"--lock={self.lock}", f"--gate={self.entry}", "--", *command),
        )
        self.until(lambda: any((self.state / "leases").glob("*.json")), "never admitted")
        # Long enough for the bridge under the lease to be waiting at the lock.
        time.sleep(1.0)
        return caller, run, marker

    def holding(self) -> tuple[subprocess.Popen[bytes], int]:
        """A caller and the whole suite it started, as it takes its lease while it loads."""

        caller, suite = self.started(
            sys.executable, "-c", HOLDING_SUITE, str(self.lock), str(self.entry), str(ROOT)
        )
        # Ended here if it never leaves, so that its hold ends too.
        self.addCleanup(lambda: _running(suite) and os.kill(suite, signal.SIGTERM))
        return caller, suite

    def _end(self, caller: subprocess.Popen[bytes]) -> None:
        caller.kill()
        caller.wait(DEADLINE_SECONDS)
        assert caller.stdout is not None
        caller.stdout.close()

    def assert_left(self, run: int, marker: Path | None = None) -> None:
        places = [self.state / "leases", self.state / "queue"]
        deadline = time.monotonic() + LEAVE_SECONDS
        while _running(run) or any(any(place.glob("*.json")) for place in places):
            if time.monotonic() > deadline:
                self.fail(f"still waiting {LEAVE_SECONDS} s after its caller went")
            time.sleep(0.1)
        if marker is not None:
            self.assertFalse(marker.exists(), "the command ran for a caller that is gone")

    def test_a_suite_waiting_for_its_hold_leaves_once_its_caller_is_killed(self) -> None:
        (self.state / "stall").write_text("")
        caller, suite = self.holding()
        self.until(lambda: any((self.state / "queue").glob("*.json")), "never in the queue")
        caller.kill()
        self.assert_left(suite)

    def test_a_suite_waiting_at_the_earlier_lock_leaves_once_its_caller_is_killed(self) -> None:
        with earlier_whole_machine_run(self.lock):
            caller, suite = self.holding()
            self.until(lambda: any((self.state / "leases").glob("*.json")), "never admitted")
            time.sleep(1.0)
            caller.kill()
            self.assert_left(suite)
        self.assertEqual(([], []), legacy_lock.entries(self.lock, reclaim=True))

    def test_a_run_whose_caller_is_killed_leaves_the_queue_and_the_lease(self) -> None:
        with earlier_whole_machine_run(self.lock):
            caller, run, marker = self.waiting()
            caller.kill()
            self.assert_left(run, marker)
        self.assertEqual(([], []), legacy_lock.entries(self.lock, reclaim=True))

    def test_a_waiting_run_that_is_killed_itself_leaves_nothing_waiting(self) -> None:
        with earlier_whole_machine_run(self.lock):
            _caller, run, marker = self.waiting()
            os.kill(run, signal.SIGTERM)
            self.assert_left(run, marker)
        self.assertEqual(([], []), legacy_lock.entries(self.lock, reclaim=True))


def loaded_ids(suite: unittest.TestSuite) -> set[str]:
    """Every test a loaded suite holds, by id."""

    found: set[str] = set()
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            found |= loaded_ids(test)
        else:
            found.add(test.id())
    return found


class WholeSuiteTests(unittest.TestCase):
    """The `tests` package takes a lease for a run of the whole suite and for no narrower one.

    Through unittest's own loader, the one `python -m unittest` drives, on this very
    package, with the hold it takes stood in for.
    """

    TESTS = ROOT / "tests"

    def load(
        self, how: Callable[[unittest.TestLoader], unittest.TestSuite], **loader: object
    ) -> tuple[set[str], list[mock._Call]]:
        """The tests `how` loads and each hold the load took."""

        reader = unittest.TestLoader()
        for name, value in loader.items():
            setattr(reader, name, value)
        with mock.patch.object(heavy_gate, "hold_until_exit") as hold:
            suite = how(reader)
        return loaded_ids(suite), hold.call_args_list

    @classmethod
    def setUpClass(cls) -> None:
        # The walk unittest makes of a package with no hook: what the hook must still find.
        with mock.patch.object(tests, "load_tests", None):
            cls.everything = loaded_ids(unittest.TestLoader().discover(str(ROOT), "test_*.py"))

    def test_the_gate_command_takes_a_lease_of_the_suites_kind_and_finds_every_test(self) -> None:
        # `-s . -p "test_*.py"`, as the gates and CI spell it.
        found, holds = self.load(lambda reader: reader.discover(str(ROOT), "test_*.py"))
        self.assertEqual([mock.call("unittest-suite")], holds)
        self.assertEqual(self.everything, found)
        self.assertTrue(any(name.startswith("tests.quota.") for name in found))
        self.assertIn(f"{__name__}.{type(self).__name__}.{self._testMethodName}", found)

    def test_every_other_start_at_the_package_takes_it_too(self) -> None:
        starts = {
            "discover -s tests -t .": lambda reader: reader.discover(
                str(self.TESTS), "test_*.py", top_level_dir=str(ROOT)
            ),
            "-m unittest tests": lambda reader: reader.loadTestsFromName("tests"),
            "unittest's own pattern": lambda reader: reader.discover(str(ROOT)),
        }
        for start, how in starts.items():
            with self.subTest(start=start):
                found, holds = self.load(how)
                self.assertGreaterEqual(len(holds), 1)
                self.assertEqual(self.everything, found)

    def test_a_targeted_run_takes_no_lease(self) -> None:
        module = "tests.test_heavy_gate"
        targeted = {
            "a module by name": (lambda reader: reader.loadTestsFromName(module), {}),
            "a subpackage": (
                lambda reader: reader.discover(
                    str(self.TESTS / "quota"), "test_*.py", top_level_dir=str(ROOT)
                ),
                {},
            ),
            "a narrower pattern": (
                lambda reader: reader.discover(str(ROOT), "test_heavy_gate.py"),
                {},
            ),
            "-k": (
                lambda reader: reader.discover(str(ROOT), "test_*.py"),
                {"testNamePatterns": ["*targeted*"]},
            ),
        }
        for run, (how, loader) in targeted.items():
            with self.subTest(run=run):
                found, holds = self.load(how, **loader)
                self.assertEqual([], holds)
                # A present control: each run does load tests, only not all of them.
                self.assertTrue(found)
                self.assertLess(len(found), len(self.everything))

    def test_the_kind_is_one_the_rules_file_declares(self) -> None:
        # A kind the rules do not declare is refused by the gate with exit code 64.
        self.assertIsNone(heavy_gate.rules_want(tests.WHOLE_SUITE_KIND))
        self.assertIn(f'name = "{tests.WHOLE_SUITE_KIND}"', heavy_gate.RULES.read_text())


class LoadNoteTests(GateCase):
    """A failed run that took no lease names the heavy runs going as it ends, and nothing else."""

    def asked(self) -> bytes:
        found = subprocess.run(
            [sys.executable, COMMAND, "holder", f"--lock={self.lock}", f"--gate={self.entry}"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=DEADLINE_SECONDS,
            check=False,
        )
        self.assertEqual(0, found.returncode, found.stderr)
        return found.stdout

    def lease(self) -> None:
        leases = self.state / "leases"
        leases.mkdir(parents=True, exist_ok=True)
        record = {"name": "rover:check", "holder_pid": 31, "since": 1_800_000_000.0}
        (leases / "L.json").write_text(json.dumps(record))

    def test_the_gates_leases_and_earlier_branches_runs_are_named(self) -> None:
        self.lease()
        with earlier_whole_machine_run(self.lock):
            note = heavy_gate.load_note(self.lock, str(self.entry))
            said = self.asked()
        assert note is not None
        self.assertTrue(note.startswith("heavy runs were going as this run ended: "), note)
        self.assertIn("rover:check, process 31, since ", note)
        self.assertIn("an earlier whole-suite run in C:/earlier-branch", note)
        self.assertIn(b"rover:check, process 31", said)

    def test_nothing_going_is_said_as_nothing(self) -> None:
        self.assertIsNone(heavy_gate.load_note(self.lock, str(self.entry)))
        self.assertEqual(b"", self.asked())

    def test_a_run_under_a_lease_or_a_holder_names_no_one(self) -> None:
        self.lease()
        self.assertIsNotNone(heavy_gate.load_note(self.lock, str(self.entry)))
        with mock.patch.dict(os.environ, {heavy_gate.LEASE_VARIABLE: "L"}):
            self.assertIsNone(heavy_gate.load_note(self.lock, str(self.entry)))
        with mock.patch.dict(os.environ, legacy_lock.marker(self.lock)):
            self.assertIsNone(heavy_gate.load_note(self.lock, str(self.entry)))

    def test_a_failed_unittest_run_names_the_runs_and_a_passing_one_does_not(self) -> None:
        class Probe(unittest.TestCase):
            def test_fails(self) -> None:
                self.fail("on purpose")

            def test_passes(self) -> None:
                pass

        def run(name: str) -> str:
            # unittest's default runner, as `python -m unittest` builds it.
            stream = io.StringIO()
            unittest.TextTestRunner(stream=stream).run(Probe(name))
            return stream.getvalue()

        self.lease()
        with (
            mock.patch.object(legacy_lock, "lock_path", return_value=self.lock),
            mock.patch.dict(os.environ, {heavy_gate.GATE_VARIABLE: str(self.entry)}),
        ):
            failed, passed = run("test_fails"), run("test_passes")
            (self.state / "leases" / "L.json").unlink()
            free = run("test_fails")
        self.assertIn("heavy runs were going as this run ended: rover:check", failed)
        self.assertTrue(failed.rstrip().endswith("FAILED (failures=1)"), failed)
        self.assertNotIn("heavy runs were going", passed)
        self.assertIn("FAILED", free)
        self.assertNotIn("heavy runs were going", free)


#: Arguments that cmd.exe acts on when a batch file is handed them, one set each: a
#: command started through `npx` or a package's `.bin` entry gets each back as it was.
METACHARACTERS = {
    "pipe": ["--grep=@one|@two"],
    "command separator": ["a&b", "x & echo injected"],
    "redirection": ["a<b", "a>b", "2>&1"],
    "escape": ["a^b", "^"],
    "variables": ["%PATH%", "%~dp0", "50%", "%%"],
    "delayed expansion": ["!PATH!"],
    "quotes": ['"quoted"', 'a"b', 'a " b', '\\"', "dir\\"],
    "groups": ["(x)", ")"],
    "line breaks": ["a\nb", "a\r\nb"],
    "plain": ["two words", "", "--workers=4"],
}

#: Prints, as one JSON line, the arguments a script started by a shim was given.
ECHO_JS = 'console.log(JSON.stringify({ args: process.argv.slice(2), from: "%s" }))\n'

#: A shim as npm's cmd-shim writes it into `node_modules/.bin`, for a script beside it.
CMD_SHIM = """\
@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\{script}" %*
"""

#: `npx.cmd` as npm writes it beside node.exe: its own CLI, or the one under npm's
#: global prefix when one is installed there.
NPX_CMD = """\
:: Created by npm, please don't edit manually.
@ECHO OFF

SETLOCAL

SET "NODE_EXE=%~dp0\\node.exe"
IF NOT EXIST "%NODE_EXE%" (
  SET "NODE_EXE=node"
)

SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"
SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"
FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (
  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"
)
IF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (
  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"
)

"%NODE_EXE%" "%NPX_CLI_JS%" %*
"""


#: Prints its arguments as one JSON line, on one line for a batch file to hand to
#: `python -c`: a newline ends a batch file's command line.
ARGS_ONE_LINE = "import json, sys; print(json.dumps({'args': sys.argv[1:]}))"


@unittest.skipUnless(sys.platform == "win32", "batch files are Windows'")
@unittest.skipUnless(shutil.which("node"), "the shims start node")
class BatchFileTests(GateCase):
    """A command whose program is a batch file never has cmd.exe read its arguments.

    Each shim is a real one, in npm's own words, on `PATH` ahead of every other, and
    each run goes through `run` as a person types it: directly, and under a lease.
    """

    def setUp(self) -> None:
        super().setUp()
        scratch = ROOT / "tmp"
        scratch.mkdir(exist_ok=True)
        directory = tempfile.TemporaryDirectory(
            prefix="gate-cmd-", dir=scratch, ignore_cleanup_errors=True
        )
        self.addCleanup(directory.cleanup)
        self.bin = Path(directory.name)
        # A package's `.bin` entry, and npx as npm installs it beside node.
        (self.bin / "pkg").mkdir()
        (self.bin / "pkg" / "cli.js").write_text(ECHO_JS % "package")
        (self.bin / "vk-probe.cmd").write_text(CMD_SHIM.format(script="pkg\\cli.js"))
        npm = self.bin / "node_modules" / "npm" / "bin"
        npm.mkdir(parents=True)
        (npm / "npx-cli.js").write_text(ECHO_JS % "bundled")
        self.prefix = self.bin / "prefix"
        prefix_js = f"console.log({json.dumps(str(self.prefix))})\n"
        (npm / "npm-prefix.js").write_text(prefix_js)
        (self.bin / "vk-npx.cmd").write_text(NPX_CMD)
        # A batch file of no shim's shape: it runs the observer itself.
        (self.bin / "vk-plain.cmd").write_text(f'@"{sys.executable}" -c "{ARGS_ONE_LINE}" %*\n')
        path = mock.patch.dict(os.environ, {"PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}"})
        path.start()
        self.addCleanup(path.stop)
        self.missing = str(self.directory / "none.json")

    def started(self, program: str, words: list[str], **options: object) -> tuple[int, dict]:
        return self.ran("browser-targeted", [program, *words], **options)

    def test_every_metacharacter_reaches_a_package_shim_as_it_was(self) -> None:
        for how, gate in (("directly", self.missing), ("under a lease", str(self.entry))):
            for name, words in METACHARACTERS.items():
                with self.subTest(how=how, set=name):
                    code, seen = self.started("vk-probe", words, gate=gate, wait=True)
                    self.assertEqual(0, code, (self.said, self.stderr))
                    self.assertEqual({"args": words, "from": "package"}, seen)
                    self.assertNotIn("injected", self.stdout.split())

    def test_npx_reaches_the_cli_under_npms_prefix_and_its_own_without_one(self) -> None:
        words = [word for group in METACHARACTERS.values() for word in group]
        code, seen = self.started("vk-npx", words, gate=self.missing)
        self.assertEqual(0, code, self.said)
        self.assertEqual({"args": words, "from": "bundled"}, seen)
        under = self.prefix / "node_modules" / "npm" / "bin"
        under.mkdir(parents=True)
        (under / "npx-cli.js").write_text(ECHO_JS % "prefix")
        code, seen = self.started("vk-npx", words, gate=str(self.entry), wait=True)
        self.assertEqual(0, code, (self.said, self.stderr))
        self.assertEqual({"args": words, "from": "prefix"}, seen)

    def test_another_batch_file_runs_with_plain_arguments_and_is_refused_any_other(self) -> None:
        code, seen = self.started("vk-plain", ["two words", "--workers=4"], gate=self.missing)
        self.assertEqual(0, code, self.said)
        self.assertEqual(["two words", "--workers=4"], seen["args"])
        for how, gate in (("directly", self.missing), ("under a lease", str(self.entry))):
            for name, words in METACHARACTERS.items():
                if name == "plain":
                    continue
                with self.subTest(how=how, set=name):
                    self.said.clear()
                    code, seen = self.started("vk-plain", words, gate=gate, wait=True)
                    self.assertEqual(heavy_gate.EXIT_USAGE, code)
                    self.assertEqual({}, seen)
                    said = "\n".join([*self.said, self.stderr])
                    self.assertIn("is a batch file", said)
                    self.assertIn(repr(words[0]), said)
        # Refused before the queue: the gate was never asked for a lease.
        self.assertFalse((self.state / "calls.jsonl").exists())

    def test_a_batch_file_whose_path_cmd_would_split_is_refused(self) -> None:
        split = self.bin / "R&D"
        split.mkdir()
        program = split / "vk-plain.cmd"
        program.write_bytes((self.bin / "vk-plain.cmd").read_bytes())
        for how, gate in (("directly", self.missing), ("under a lease", str(self.entry))):
            with self.subTest(how=how):
                self.said.clear()
                code, seen = self.started(str(program), ["plain"], gate=gate, wait=True)
                self.assertEqual(heavy_gate.EXIT_USAGE, code)
                self.assertEqual({}, seen)
                self.assertIn("is a batch file", "\n".join(self.said))
                self.assertIn(str(program), "\n".join(self.said))
        self.assertFalse((self.state / "calls.jsonl").exists())


class CommandLineTests(GateCase):
    def test_a_want_below_one_and_a_missing_command_are_refused(self) -> None:
        for arguments in (["run", "--kind", "x", "--want", "0", "--", "x"], ["run", "--kind", "x"]):
            with self.subTest(arguments=arguments):
                done = subprocess.run(
                    [sys.executable, COMMAND, *arguments],
                    capture_output=True,
                    timeout=DEADLINE_SECONDS,
                    check=False,
                )
                self.assertEqual(2, done.returncode, done.stderr)
