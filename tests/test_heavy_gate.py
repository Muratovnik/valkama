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
import subprocess
import sys
import tempfile
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

    def observed(self, kind: str, *words: str, **options: object) -> tuple[int, dict]:
        """`run` of the observer as `kind`, and what the observer saw; `{}` when it never ran."""

        out = self.directory / "observed.json"
        out.unlink(missing_ok=True)
        options.setdefault("lock", self.lock)
        options.setdefault("gate", str(self.entry))
        command = [sys.executable, "-c", OBSERVER, str(self.lock), str(ROOT), *words]
        with mock.patch.object(subprocess, "call", self._call(out)):
            code = heavy_gate.run(kind, command, say=self.said.append, **options)  # type: ignore[arg-type]
        return code, json.loads(out.read_text()) if out.is_file() else {}

    def _call(self, out: Path) -> Callable[..., int]:
        """`subprocess.call` that keeps the observer's line, which the command prints last."""

        real = subprocess.run

        def call(argv: list[str], **options: object) -> int:
            done = real(argv, capture_output=True, check=False, **options)  # type: ignore[call-overload]
            self.stderr = done.stderr.decode(errors="replace")
            lines = [line for line in done.stdout.decode().splitlines() if line.startswith("{")]
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
