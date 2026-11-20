"""What `tests/machine_lock.py` owes: heavy runs admitted by the CPUs they need, and waiters that say why.

Every lock here is a file in a directory this test made, never the machine's:
the suite itself runs under that lock, which it takes as it loads, and the tests of
that loading stand in for the hold it takes. The machine's load and CPU count are
stood in for wherever a rule reads them, so no test depends on what else this
machine runs.
"""

from __future__ import annotations

import contextlib
import io
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from collections.abc import Callable, Iterator
from pathlib import Path
from unittest import mock

import tests
from server import store_lock
from tests import machine_lock

ROOT = Path(__file__).resolve().parents[1]
COMMAND = str(ROOT / "tests" / "machine_lock.py")
#: Long enough for a waiter that should not get the lock to have taken it by mistake.
HELD_SECONDS = 0.6
DEADLINE_SECONDS = 15.0
#: The machine the gate tests stand in for.
MACHINE_CPUS = 32
#: A time the tests set the gate's clock to, in seconds since the epoch.
NOW = 1_800_000_000.0

#: Holds the lock at argv[1] for a run named argv[2], says so with its own process id,
#: which is not the one `Popen` knows when a virtual environment's launcher starts it,
#: and sleeps until killed.
HOLDER = """\
import os, sys, time
sys.path.insert(0, sys.argv[3])
from pathlib import Path
from tests import machine_lock
with machine_lock.held(sys.argv[2], path=Path(sys.argv[1])):
    print("held", os.getpid(), flush=True)
    time.sleep(120)
"""

#: Holds a place at the gate at argv[1] for a run named argv[2] needing argv[3] CPUs
#: ("all" for none declared), on a machine of 32 CPUs that is idle: it says its process
#: id, then each line the gate says, then "held", and holds until its input closes.
GATE_HOLDER = """\
import os, sys
sys.path.insert(0, sys.argv[4])
from pathlib import Path
from tests import machine_lock
cpus = None if sys.argv[3] == "all" else int(sys.argv[3])
print("pid", os.getpid(), flush=True)
with machine_lock.held(
    sys.argv[2], path=Path(sys.argv[1]), cpus=cpus, measure=lambda: 0.0, machine_cpus=32,
    say=lambda line: print("said", line, flush=True),
):
    print("held", flush=True)
    sys.stdin.read()
"""

#: The steps of the version of `tests/machine_lock.py` that let one heavy run in at a
#: time, as a branch that predates the gate still takes them: the exclusive lock of
#: `server.store_lock` on the first byte, its record after that byte, and a waiter that
#: names the holder from that record. It holds the lock at argv[1] for a run named
#: argv[2] until its input closes.
OLD_PROTOCOL_RUN = """\
import json, os, sys, time
sys.path.insert(0, sys.argv[3])
from datetime import datetime
from server import store_lock
path, run = sys.argv[1], sys.argv[2]
print("pid", os.getpid(), flush=True)

def holder():
    try:
        with open(path, "rb") as handle:
            handle.seek(1)
            record = json.loads(handle.read())
        return f"{record['run']} in {record['checkout']}, process {record['pid']}"
    except (OSError, ValueError, KeyError, TypeError):
        return "a run that has not recorded itself yet"

with open(path, "a+b") as handle:
    if not store_lock.try_lock(handle):
        print("said waiting: it is held by", holder(), flush=True)
        while not store_lock.try_lock(handle):
            time.sleep(0.05)
    since = datetime.now().astimezone().isoformat(timespec="seconds")
    record = {"checkout": "C:/old-branch", "pid": os.getpid(), "run": run, "since": since}
    handle.truncate(1)
    handle.write(json.dumps(record).encode())
    handle.flush()
    print("held", flush=True)
    sys.stdin.read()
    handle.truncate(1)
    store_lock.unlock(handle)
"""


class Waiter:
    """A run that waits for a place in a thread and records what it said and when it got in.

    `options` go to `machine_lock.held` as they are: the CPUs the run needs and the
    stand-ins for the machine's load, clock and CPU count.
    """

    def __init__(
        self,
        path: Path,
        *,
        run: str = "the second run",
        report_every: float = machine_lock.REPORT_SECONDS,
        **options: object,
    ) -> None:
        self.said: list[str] = []
        self.inside = threading.Event()
        self.leave = threading.Event()
        self.thread = threading.Thread(
            target=self._hold, args=(path, run, report_every, options), daemon=True
        )

    def _hold(self, path: Path, run: str, report_every: float, options: dict) -> None:
        with machine_lock.held(
            run, path=path, say=self.said.append, report_every=report_every, **options
        ):
            self.inside.set()
            self.leave.wait(DEADLINE_SECONDS)

    def start(self) -> Waiter:
        self.thread.start()
        return self

    def said_something(self) -> bool:
        """Whether it said its first line, which it does once it holds its place in the queue."""

        deadline = time.monotonic() + DEADLINE_SECONDS
        while not self.said and time.monotonic() < deadline:
            time.sleep(0.02)
        return bool(self.said)

    def finish(self) -> None:
        self.leave.set()
        self.thread.join(DEADLINE_SECONDS)


@contextlib.contextmanager
def held_elsewhere(path: Path, run: str = "the first run") -> Iterator[threading.Event]:
    """The lock held by another handle until the event this yields is set."""

    release, inside = threading.Event(), threading.Event()

    def hold() -> None:
        with machine_lock.held(run, path=path, say=lambda _line: None):
            inside.set()
            release.wait(DEADLINE_SECONDS)

    thread = threading.Thread(target=hold, daemon=True, name="lock-holder")
    thread.start()
    if not inside.wait(DEADLINE_SECONDS):
        raise AssertionError("the holder never took the lock")
    try:
        yield release
    finally:
        release.set()
        thread.join(DEADLINE_SECONDS)


def goes_in_at_once(test: unittest.TestCase, path: Path) -> None:
    """A run at `path` goes in without waiting, and says only that it went in."""

    said: list[str] = []
    with machine_lock.held("after", path=path, say=said.append):
        pass
    test.assertEqual(1, len(said), said)
    test.assertTrue(said[0].startswith("took the heavy-test lock after 0 s: "), said)


class LockCase(unittest.TestCase):
    """At a count of 1, one heavy run at a time: what the tool did before the gate, and its rollback."""

    count = "1"

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-lock-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "heavy.lock"
        environment = mock.patch.dict(os.environ, {machine_lock.CPUS_VARIABLE: self.count})
        environment.start()
        self.addCleanup(environment.stop)


class LockTests(LockCase):
    def test_a_second_run_waits_until_the_first_gives_the_lock_back(self) -> None:
        with held_elsewhere(self.path) as release:
            waiter = Waiter(self.path).start()
            self.addCleanup(waiter.finish)
            self.assertFalse(waiter.inside.wait(HELD_SECONDS), "it ran beside the holder")
            release.set()
            self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS), "it never got the lock")
        self.assertTrue(waiter.said[-1].startswith("took the heavy-test lock after"))

    def test_a_run_that_finds_the_lock_free_goes_in_and_says_so_in_one_line(self) -> None:
        said: list[str] = []
        with machine_lock.held("alone", path=self.path, say=said.append):
            pass
        with machine_lock.held("again", path=self.path, say=said.append):
            pass
        line = "took the heavy-test lock after 0 s: 1 of 1 CPU, the load not measured, alone"
        self.assertEqual([line, line], said)

    def test_the_waiter_names_the_holder_and_says_it_again_while_it_waits(self) -> None:
        with held_elsewhere(self.path, "a full unittest run") as release:
            waiter = Waiter(self.path, report_every=0.3).start()
            self.addCleanup(waiter.finish)
            deadline = time.monotonic() + DEADLINE_SECONDS
            while len(waiter.said) < 3 and time.monotonic() < deadline:
                time.sleep(0.05)
            release.set()
            self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS))

        first, again = waiter.said[0], waiter.said[1]
        self.assertIn(str(self.path), first)
        for line in (first, again):
            self.assertIn("a full unittest run", line)
            self.assertIn(ROOT.as_posix(), line)
            self.assertIn(f"process {os.getpid()}", line)
            self.assertRegex(line, r"since \d{4}-\d\d-\d\d \d\d:\d\d:\d\d \(\d+ s ago\)")
            self.assertIn("1 of 1 CPU the gate hands out, and this run needs 1", line)
        self.assertTrue(again.startswith("still waiting after"))

    def test_a_holder_that_dies_is_taken_over_and_was_named_while_alive(self) -> None:
        holder = subprocess.Popen(
            [sys.executable, "-c", HOLDER, str(self.path), "a killed run", str(ROOT)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
        )
        self.addCleanup(holder.wait, DEADLINE_SECONDS)
        self.addCleanup(holder.kill)
        assert holder.stdout is not None
        self.addCleanup(holder.stdout.close)
        lines = iter(holder.stdout.readline, b"")
        said, pid = next(line for line in lines if line.startswith(b"held")).split()
        self.assertEqual(b"held", said)

        waiter = Waiter(self.path).start()
        self.addCleanup(waiter.finish)
        self.assertFalse(waiter.inside.wait(HELD_SECONDS))
        os.kill(int(pid), signal.SIGTERM)
        holder.wait(DEADLINE_SECONDS)

        self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS), "a dead holder kept the lock")
        self.assertIn(f"a killed run in {ROOT.as_posix()}, process {int(pid)}", waiter.said[0])
        self.assertIn(
            f"the second run in {ROOT.as_posix()}, process {os.getpid()}",
            machine_lock.holder(self.path),
        )

    def test_a_record_not_written_yet_is_said_as_such(self) -> None:
        with self.path.open("a+b") as handle:
            self.assertTrue(store_lock.try_lock(handle))
            try:
                self.assertEqual(
                    "a run that has not recorded itself yet", machine_lock.holder(self.path)
                )
            finally:
                store_lock.unlock(handle)

    def test_the_machine_lock_stays_put_however_a_run_moves_its_profile_or_temp(self) -> None:
        # A release coordinator runs the checks with a TEMP inside the checkout, and the
        # gates runner and the release check move LOCALAPPDATA into a throwaway profile
        # that may sit there too. A lock that followed either would hold only the runs
        # given that place. The logon value stands in for the registry's, so the check
        # does not depend on this machine's.
        logon = str(Path(ROOT.anchor) / "valkama-lock-logon")
        moved = str(ROOT / ".git" / "relkit" / "tmp" / "candidate")
        with mock.patch.object(machine_lock, "logon_local_app_data", return_value=logon):
            reference = machine_lock.lock_path().resolve()
            with mock.patch.dict(
                os.environ, {"LOCALAPPDATA": moved, "TMP": moved, "TEMP": moved, "TMPDIR": moved}
            ):
                with mock.patch.object(tempfile, "tempdir", moved):
                    path = machine_lock.lock_path().resolve()
        self.assertFalse(path.is_relative_to(ROOT))
        self.assertFalse(path.is_relative_to(Path.home() / ".valkama"))
        self.assertEqual(reference, path)

    @unittest.skipUnless(sys.platform == "win32", "only Windows reads a logon profile")
    def test_with_no_logon_value_the_lock_is_under_the_variable(self) -> None:
        profile = Path(ROOT.anchor) / "valkama-lock-profile"
        with (
            mock.patch.object(machine_lock, "logon_local_app_data", return_value=None),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(profile)}),
        ):
            path = machine_lock.lock_path()
        self.assertEqual(profile / "Temp", path.parent)


class AncestorTests(LockCase):
    """A run started by a holder of the lock goes in at once; any other run still waits."""

    def test_a_run_marked_as_under_a_holder_of_this_lock_goes_in_and_leaves_its_record(
        self,
    ) -> None:
        with held_elsewhere(self.path, "the run that started it"):
            # Marked once the holder is in, as a child of it would find its environment.
            with mock.patch.dict(os.environ, machine_lock.marker(self.path)):
                with machine_lock.held("a step inside it", path=self.path, say=self.fail):
                    self.assertIn("the run that started it", machine_lock.holder(self.path))
            self.assertIn("the run that started it", machine_lock.holder(self.path))

    def test_a_mark_for_another_lock_does_not_let_a_run_in(self) -> None:
        other = self.path.parent / "other.lock"
        with held_elsewhere(self.path) as release:
            with mock.patch.dict(os.environ, machine_lock.marker(other)):
                waiter = Waiter(self.path).start()
                self.addCleanup(waiter.finish)
                self.assertFalse(waiter.inside.wait(HELD_SECONDS), "it ran beside the holder")
            release.set()
            self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS), "it never got the lock")

    def test_a_command_run_by_the_command_does_not_wait_for_its_own_run(self) -> None:
        # The inner run waits for ever unless the outer one marks what it starts.
        nested = subprocess.run(
            [
                *(sys.executable, COMMAND, "run", "--run=the outer run", f"--path={self.path}"),
                *("--", sys.executable, COMMAND, "run", "--run=the inner run"),
                *(f"--path={self.path}", "--", sys.executable, "-c", "raise SystemExit(7)"),
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=DEADLINE_SECONDS,
            check=False,
        )
        self.assertEqual(7, nested.returncode, nested.stdout + nested.stderr)
        self.assertNotIn(b"waiting", nested.stdout)

    def test_a_hold_until_exit_keeps_the_lock_and_marks_the_process(self) -> None:
        said: list[str] = []
        with (
            mock.patch.dict(os.environ),
            mock.patch.object(machine_lock.atexit, "register") as register,
        ):
            machine_lock.hold_until_exit("the whole suite", path=self.path, say=said.append)
            ((release,), _options) = register.call_args
            self.addCleanup(release)
            self.assertEqual(1, len(said))
            self.assertTrue(said[0].startswith("took the heavy-test lock after 0 s: "))
            mark = machine_lock.marker(self.path)[machine_lock.HELD_BY_ANCESTOR]
            self.assertEqual(mark, os.environ[machine_lock.HELD_BY_ANCESTOR])
            self.assertIn("the whole suite in", machine_lock.holder(self.path))
            waiter = Waiter(self.path).start()
            self.addCleanup(waiter.finish)
            # A thread of the same process: the mark is what lets it in, as a second load would.
            self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS))
            waiter.finish()
        with self.path.open("a+b") as other:
            self.assertFalse(store_lock.try_lock(other), "the hold ended before the process did")
        release()
        goes_in_at_once(self, self.path)


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
    """The `tests` package takes the lock for a run of the whole suite and for no narrower one.

    Through unittest's own loader, the one `python -m unittest` drives, on this very
    package, with the hold it takes stood in for.
    """

    TESTS = ROOT / "tests"

    def load(
        self, how: Callable[[unittest.TestLoader], unittest.TestSuite], **loader: object
    ) -> tuple[set[str], int]:
        """The tests `how` loads and how many times the load took the lock."""

        found, holds = self.load_holding(how, **loader)
        return found, len(holds)

    def load_holding(
        self, how: Callable[[unittest.TestLoader], unittest.TestSuite], **loader: object
    ) -> tuple[set[str], list[mock._Call]]:
        """The tests `how` loads and each hold the load took, with what it declared."""

        reader = unittest.TestLoader()
        for name, value in loader.items():
            setattr(reader, name, value)
        with mock.patch.object(machine_lock, "hold_until_exit") as hold:
            suite = how(reader)
        return loaded_ids(suite), hold.call_args_list

    @classmethod
    def setUpClass(cls) -> None:
        # The walk unittest makes of a package with no hook: what the hook must still find.
        with mock.patch.object(tests, "load_tests", None):
            cls.everything = loaded_ids(unittest.TestLoader().discover(str(ROOT), "test_*.py"))

    def test_the_gate_command_takes_the_lock_and_still_finds_every_test(self) -> None:
        # `-s . -p "test_*.py"`, as the gates and CI spell it.
        found, holds = self.load(lambda reader: reader.discover(str(ROOT), "test_*.py"))
        self.assertEqual(1, holds)
        self.assertEqual(self.everything, found)
        self.assertTrue(any(name.startswith("tests.quota.") for name in found))
        self.assertIn(f"{__name__}.{type(self).__name__}.{self._testMethodName}", found)

    def test_the_whole_suite_declares_the_cpus_it_needs(self) -> None:
        # Two: the suite is one Python process, with the processes some tests start.
        _found, holds = self.load_holding(lambda reader: reader.discover(str(ROOT), "test_*.py"))
        self.assertEqual([mock.call("the whole unittest suite", cpus=2)], holds)

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
                self.assertGreaterEqual(holds, 1)
                self.assertEqual(self.everything, found)

    def test_a_targeted_run_takes_no_lock(self) -> None:
        module = "tests.test_machine_lock"
        targeted = {
            "a module by name": (lambda reader: reader.loadTestsFromName(module), {}),
            "a subpackage": (
                lambda reader: reader.discover(
                    str(self.TESTS / "quota"), "test_*.py", top_level_dir=str(ROOT)
                ),
                {},
            ),
            "a narrower pattern": (
                lambda reader: reader.discover(str(ROOT), "test_machine_lock.py"),
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
                self.assertEqual(0, holds)
                # A present control: each run does load tests, only not all of them.
                self.assertTrue(found)
                self.assertLess(len(found), len(self.everything))


class CommandTests(LockCase):
    def test_the_command_holds_the_lock_while_its_command_runs_and_passes_on_its_code(self) -> None:
        # The command tries the lock from a process of its own: refused is what it must see.
        probe = (
            "import sys; sys.path.insert(0, sys.argv[2]);"
            " from server import store_lock;"
            " handle = open(sys.argv[1], 'a+b');"
            " sys.exit(5 if not store_lock.try_lock(handle) else 1)"
        )
        with contextlib.redirect_stdout(io.StringIO()):
            code = machine_lock.main(
                [
                    "run",
                    "--run",
                    "a probe",
                    "--path",
                    str(self.path),
                    "--",
                    sys.executable,
                    "-c",
                    probe,
                    str(self.path),
                    str(ROOT),
                ]
            )
        self.assertEqual(5, code)
        goes_in_at_once(self, self.path)

    def test_the_command_records_the_process_it_was_told_the_run_belongs_to(self) -> None:
        found = subprocess.run(
            [
                sys.executable,
                COMMAND,
                "run",
                "--run=a browser batch",
                "--pid=4242",
                f"--path={self.path}",
                "--",
                sys.executable,
                "-c",
                "import sys; sys.path.insert(0, sys.argv[2]); from tests import machine_lock;"
                " print(machine_lock.holder(__import__('pathlib').Path(sys.argv[1])))",
                str(self.path),
                str(ROOT),
            ],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, found.returncode, found.stderr)
        self.assertIn(b"a browser batch in", found.stdout)
        self.assertIn(b"process 4242", found.stdout)

    def test_a_command_that_cannot_start_fails_and_gives_the_lock_back(self) -> None:
        missing = str(self.path.parent / "no-such-program")
        with contextlib.redirect_stdout(io.StringIO()):
            code = machine_lock.main(["run", "--run", "x", "--path", str(self.path), "--", missing])
        self.assertEqual(127, code)
        goes_in_at_once(self, self.path)

    def test_the_command_passes_the_cpus_a_run_declares_and_refuses_none(self) -> None:
        with mock.patch.object(machine_lock, "held") as held:
            held.return_value.__enter__.return_value = None
            with contextlib.redirect_stdout(io.StringIO()):
                machine_lock.main(
                    ["run", "--run", "x", "--cpus", "8", "--", sys.executable, "-c", "0"]
                )
                machine_lock.main(["run", "--run", "y", "--", sys.executable, "-c", "0"])
        self.assertEqual([8, None], [call.kwargs["cpus"] for call in held.call_args_list])
        with (
            contextlib.redirect_stderr(io.StringIO()) as said,
            self.assertRaises(SystemExit),
        ):
            machine_lock.main(["run", "--run", "x", "--cpus", "0", "--", sys.executable, "-c", "0"])
        self.assertIn("--cpus is a whole number from 1", said.getvalue())


class LoadNoteTests(LockCase):
    """A failed run that took no lock says who holds it as it ends, and nothing when nobody does."""

    def asked(self) -> bytes:
        """What the command a Vitest run asks prints for this lock."""

        found = subprocess.run(
            [sys.executable, COMMAND, "holder", f"--path={self.path}"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=DEADLINE_SECONDS,
            check=False,
        )
        self.assertEqual(0, found.returncode, found.stderr)
        return found.stdout

    def test_a_held_lock_is_named_with_its_holder_by_the_function_and_the_command(self) -> None:
        with held_elsewhere(self.path, "another checkout's whole suite"):
            note = machine_lock.load_note(self.path)
            said = self.asked()
        assert note is not None
        self.assertIn(f"the heavy-test lock {self.path} was held as this run ended", note)
        self.assertIn(f"by another checkout's whole suite in {ROOT.as_posix()}", note)
        self.assertIn(b"by another checkout's whole suite in ", said)

    def test_a_free_lock_or_none_at_all_is_said_as_nothing_and_left_as_it_was(self) -> None:
        self.assertIsNone(machine_lock.load_note(self.path))
        self.assertFalse(self.path.exists(), "asking made a lock file")
        with machine_lock.held("an earlier run", path=self.path, say=lambda _line: None):
            pass
        self.assertIsNone(machine_lock.load_note(self.path))
        self.assertEqual(b"", self.asked())
        # Asking gave the lock back.
        goes_in_at_once(self, self.path)

    def test_a_run_under_the_holder_names_no_one(self) -> None:
        with held_elsewhere(self.path):
            with mock.patch.dict(os.environ, machine_lock.marker(self.path)):
                self.assertIsNone(machine_lock.load_note(self.path))
            # The present control: the same lock, asked from outside the holder.
            self.assertIsNotNone(machine_lock.load_note(self.path))

    def test_a_failed_unittest_run_prints_the_holder_and_a_passing_or_unloaded_one_does_not(
        self,
    ) -> None:
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

        with mock.patch.object(machine_lock, "lock_path", return_value=self.path):
            with held_elsewhere(self.path, "a browser batch"):
                failed, passed = run("test_fails"), run("test_passes")
            free = run("test_fails")
        self.assertIn("was held as this run ended, by a browser batch in ", failed)
        self.assertTrue(failed.rstrip().endswith("FAILED (failures=1)"), failed)
        self.assertNotIn("heavy-test lock", passed)
        self.assertIn("FAILED", free)
        self.assertNotIn("heavy-test lock", free)


def entry(run: str, cpus: int, *, since: float = NOW) -> machine_lock.Entry:
    """A run going, as a decision reads it from its file."""

    return machine_lock.Entry(run, "C:/a-checkout", 4242, since, cpus, 0, Path(f"{run}.json"))


class RuleTests(unittest.TestCase):
    """The two conditions a run goes in on, with the machine's numbers given."""

    def test_an_undeclared_need_is_every_cpu_the_gate_hands_out(self) -> None:
        self.assertEqual(32, machine_lock.need_of(None, 32))
        self.assertEqual(2, machine_lock.need_of(2, 32))
        # A need beyond the count is the whole count: such a run goes alone, never never.
        self.assertEqual(32, machine_lock.need_of(64, 32))

    def test_small_runs_share_until_the_sum_would_exceed_the_machine(self) -> None:
        refusal = machine_lock.arithmetic_refusal
        self.assertIsNone(refusal(8, [entry("unittest", 2)], 32))
        self.assertIsNone(refusal(8, [entry("unittest", 2), entry("other", 22)], 32))
        refused = refusal(8, [entry("unittest", 2), entry("other", 23)], 32)
        assert refused is not None
        self.assertIn("unittest in C:/a-checkout, process 4242", refused)
        self.assertIn("with 23 CPUs", refused)
        self.assertIn("25 of 32 CPUs the gate hands out, and this run needs 8", refused)

    def test_a_whole_machine_run_goes_alone_and_nothing_joins_it(self) -> None:
        refusal = machine_lock.arithmetic_refusal
        self.assertIsNone(refusal(32, [], 32))
        self.assertIsNotNone(refusal(32, [entry("unittest", 1)], 32))
        self.assertIsNotNone(refusal(1, [entry("browser", 32)], 32))

    def test_at_a_count_of_one_every_run_waits_for_every_other(self) -> None:
        capacity = machine_lock.handed_out(32, {machine_lock.CPUS_VARIABLE: "1"})
        self.assertEqual(1, capacity)
        need = machine_lock.need_of(2, capacity)
        self.assertEqual(1, need)
        self.assertIsNone(machine_lock.arithmetic_refusal(need, [], capacity))
        self.assertIsNotNone(machine_lock.arithmetic_refusal(need, [entry("a", 1)], capacity))

    def test_the_count_is_the_machines_unless_set_and_a_value_that_is_no_count_is_refused(
        self,
    ) -> None:
        self.assertEqual(32, machine_lock.handed_out(32, {}))
        self.assertEqual(32, machine_lock.handed_out(32, {machine_lock.CPUS_VARIABLE: " "}))
        self.assertEqual(12, machine_lock.handed_out(32, {machine_lock.CPUS_VARIABLE: "12"}))
        for value in ("0", "-3", "eight", "2.5"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                machine_lock.handed_out(32, {machine_lock.CPUS_VARIABLE: value})

    def test_a_run_is_refused_for_lack_of_free_cpus(self) -> None:
        refused = machine_lock.room_refusal(8, [], 32, 0.8, NOW)
        self.assertEqual(
            "6.4 of 32 CPUs are free (the machine 80% busy), and this run needs 8", refused
        )
        # 8 free of 32 at three quarters busy: exactly the need.
        self.assertIsNone(machine_lock.room_refusal(8, [], 32, 0.75, NOW))

    def test_a_whole_machine_need_is_held_to_the_fraction_of_the_machine(self) -> None:
        # 0.7 of 32 is 22.4: free at 30 % busy, short at 31 %.
        self.assertIsNone(machine_lock.room_refusal(32, [], 32, 0.3, NOW))
        refused = machine_lock.room_refusal(32, [], 32, 0.31, NOW)
        assert refused is not None
        self.assertTrue(refused.endswith("and this run needs 22.4"), refused)

    def test_the_measured_room_is_skipped_where_the_load_is_unknown(self) -> None:
        self.assertIsNone(machine_lock.room_refusal(32, [], 32, None, NOW))

    def test_a_run_that_went_in_within_the_ramp_counts_by_its_need(self) -> None:
        # 16 free at half busy; a run of 8 that went in 59 s ago has not loaded it yet.
        starting = [entry("vitest", 8, since=NOW - 59)]
        refused = machine_lock.room_refusal(10, starting, 32, 0.5, NOW)
        assert refused is not None
        self.assertIn("less 8 CPUs of runs still starting", refused)
        started = [entry("vitest", 8, since=NOW - 61)]
        self.assertIsNone(machine_lock.room_refusal(10, started, 32, 0.5, NOW))

    def test_the_admission_line_says_the_wait_the_load_and_the_runs_beside(self) -> None:
        line = machine_lock.admission_line(
            63.2, 2, 32, 0.314, [entry("vitest", 8), entry("other", 4)]
        )
        self.assertRegex(
            line,
            r"^took the heavy-test lock after 1 min 3 s: 2 of 32 CPUs, the machine 31% busy,"
            r" beside 2 runs: vitest in C:/a-checkout, process 4242, since .*, with 8 CPUs;"
            r" other in C:/a-checkout, process 4242, since .*, with 4 CPUs$",
        )
        alone = machine_lock.admission_line(0.2, 1, 1, None, [])
        self.assertEqual(
            "took the heavy-test lock after 0 s: 1 of 1 CPU, the load not measured, alone", alone
        )

    def test_the_admission_line_of_a_run_that_went_in_without_its_room_says_so(self) -> None:
        line = machine_lock.admission_line(185.0, 32, 32, 0.66, [], (10.8, 22.4))
        self.assertEqual(
            "took the heavy-test lock after 3 min 5 s without the room it asked for,"
            " 10.8 CPUs free where it needs 22.4: 32 of 32 CPUs, the machine 66% busy, alone",
            line,
        )


class GateCase(LockCase):
    """The gate on a machine of 32 CPUs whose load each test sets."""

    count = ""

    def setUp(self) -> None:
        super().setUp()
        self.waiters: list[Waiter] = []
        self.addCleanup(self.finish_all)

    def finish_all(self) -> None:
        # Every run told to leave first: one still waiting goes in once those ahead have left.
        for waiter in self.waiters:
            waiter.leave.set()
        for waiter in self.waiters:
            waiter.finish()

    def place(self, run: str, cpus: int | None, **options: object) -> Waiter:
        """A run of `cpus` taking its place in a thread, on an idle machine unless `options` say."""

        options.setdefault("measure", lambda: 0.0)
        waiter = Waiter(self.path, run=run, cpus=cpus, machine_cpus=MACHINE_CPUS, **options)
        self.waiters.append(waiter)
        return waiter.start()

    def inside(self, waiter: Waiter) -> None:
        self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS), f"it never went in: {waiter.said}")

    def outside(self, waiter: Waiter) -> None:
        self.assertFalse(waiter.inside.wait(HELD_SECONDS), f"it went in: {waiter.said}")


class GateTests(GateCase):
    def test_small_runs_go_in_together_and_one_that_would_exceed_the_machine_waits(self) -> None:
        unittest_run = self.place("unittest", 2)
        self.inside(unittest_run)
        vitest = self.place("vitest", 8)
        self.inside(vitest)
        big = self.place("big", 24)
        self.outside(big)
        self.assertIn("10 of 32 CPUs the gate hands out, and this run needs 24", big.said[0])
        self.assertIn("unittest in", big.said[0])
        self.assertIn("vitest in", big.said[0])
        vitest.finish()
        self.inside(big)
        self.assertIn("beside 1 run: unittest in", vitest.said[0])
        self.assertIn(": 24 of 32 CPUs, the machine 0% busy, beside 1 run: unittest", big.said[-1])

    def test_a_whole_machine_run_goes_alone_and_nothing_joins_it(self) -> None:
        browser = self.place("browser", None)
        self.inside(browser)
        small = self.place("unittest", 2)
        self.outside(small)
        self.assertIn("browser in", small.said[0])
        self.assertIn("with 32 CPUs", small.said[0])
        browser.finish()
        self.inside(small)
        # And the other way round: it waits for the small run to end.
        after = self.place("browser again", None)
        self.outside(after)
        small.finish()
        self.inside(after)

    def test_at_a_count_of_one_runs_go_one_at_a_time_and_the_load_is_not_read(self) -> None:
        unread = mock.Mock(side_effect=AssertionError("the load was read"))
        with mock.patch.dict(os.environ, {machine_lock.CPUS_VARIABLE: "1"}):
            first = self.place("unittest", 2, measure=unread)
            self.inside(first)
            second = self.place("vitest", 8, measure=unread)
            self.outside(second)
            first.finish()
            self.inside(second)
        self.assertIn(": 1 of 1 CPU, the load not measured, alone", first.said[0])
        unread.assert_not_called()

    def test_a_run_waits_for_free_cpus_and_goes_in_once_the_load_falls(self) -> None:
        load = [0.9]
        waiter = self.place("vitest", 8, measure=lambda: load[0])
        self.outside(waiter)
        self.assertEqual(
            f"waiting for the heavy-test lock {self.path}: 3.2 of 32 CPUs are free"
            " (the machine 90% busy), and this run needs 8",
            waiter.said[0],
        )
        load[0] = 0.1
        self.inside(waiter)
        self.assertIn("8 of 32 CPUs, the machine 10% busy, alone", waiter.said[-1])

    def test_a_whole_machine_run_starts_beside_light_background_work(self) -> None:
        browser = self.place("browser", None, measure=lambda: 0.25)
        self.inside(browser)
        self.assertIn("32 of 32 CPUs, the machine 25% busy, alone", browser.said[0])

    def test_where_the_load_cannot_be_measured_the_arithmetic_alone_decides(self) -> None:
        browser = self.place("browser", None, measure=lambda: None)
        self.inside(browser)
        self.assertIn("the load not measured", browser.said[0])
        small = self.place("unittest", 2, measure=lambda: None)
        self.outside(small)

    def test_a_later_small_run_waits_behind_an_earlier_whole_machine_waiter(self) -> None:
        first = self.place("unittest", 2)
        self.inside(first)
        browser = self.place("browser", None)
        self.assertTrue(browser.said_something())
        # It would fit beside the first run; the earlier waiter is why it waits.
        later = self.place("vitest", 8)
        self.outside(later)
        self.assertIn("it is behind 1 earlier waiter, the first browser in", later.said[0])
        first.finish()
        self.inside(browser)
        self.outside(later)
        browser.finish()
        self.inside(later)

    def test_a_run_that_went_in_a_moment_ago_counts_against_the_room_by_its_need(self) -> None:
        now = [NOW]
        first = self.place("vitest", 8, measure=lambda: 0.5, clock=lambda: now[0])
        self.inside(first)
        now[0] = NOW + 10
        second = self.place("big", 10, measure=lambda: 0.5, clock=lambda: now[0])
        self.outside(second)
        self.assertIn("less 8 CPUs of runs still starting", second.said[0])
        now[0] = NOW + 61
        self.inside(second)

    def test_the_note_of_a_failed_run_names_every_heavy_run_going(self) -> None:
        self.inside(self.place("unittest", 2))
        self.inside(self.place("vitest", 8))
        note = machine_lock.load_note(self.path)
        assert note is not None
        self.assertIn("unittest in", note)
        self.assertIn("vitest in", note)
        self.assertIn("with 2 CPUs", note)
        self.assertIn("with 8 CPUs", note)


class RoomWaitTests(GateCase):
    """A run that only the measured room keeps out waits for it `ROOM_WAIT_SECONDS` at most."""

    def setUp(self) -> None:
        super().setUp()
        self.now = [NOW]

    def short_of_room(self, run: str, cpus: int, load: list[float]) -> Waiter:
        """A run of `cpus` on the test's clock, at the load `load` holds."""

        return self.place(run, cpus, measure=lambda: load[0], clock=lambda: self.now[0])

    def test_a_run_that_gets_its_room_before_the_bound_goes_in_with_it(self) -> None:
        load = [0.9]
        waiter = self.short_of_room("vitest", 8, load)
        self.outside(waiter)
        self.now[0] = NOW + machine_lock.ROOM_WAIT_SECONDS - 1
        self.outside(waiter)
        load[0] = 0.1
        self.inside(waiter)
        self.assertTrue(
            waiter.said[-1].endswith(": 8 of 32 CPUs, the machine 10% busy, alone"), waiter.said
        )

    def test_at_the_bound_a_run_goes_in_without_its_room_and_says_so(self) -> None:
        waiter = self.short_of_room("browser", 32, [0.9])
        self.outside(waiter)
        self.now[0] = NOW + machine_lock.ROOM_WAIT_SECONDS - 1
        self.outside(waiter)
        self.now[0] = NOW + machine_lock.ROOM_WAIT_SECONDS
        self.inside(waiter)
        self.assertRegex(
            waiter.said[-1],
            r"^took the heavy-test lock after \d+ s without the room it asked for,"
            r" 3\.2 CPUs free where it needs 22\.4: 32 of 32 CPUs, the machine 90% busy, alone$",
        )

    def test_a_wait_for_the_runs_going_starts_no_count(self) -> None:
        first = self.place("big", 30)
        self.inside(first)
        waiter = self.short_of_room("vitest", 8, [0.9])
        self.outside(waiter)
        self.assertIn("30 of 32 CPUs the gate hands out", waiter.said[0])
        self.now[0] = NOW + 10 * machine_lock.ROOM_WAIT_SECONDS
        first.finish()
        # Kept out by the room alone only from now: it waits for it the whole bound.
        self.outside(waiter)
        self.now[0] += machine_lock.ROOM_WAIT_SECONDS - 1
        self.outside(waiter)
        self.now[0] += 1
        self.inside(waiter)
        self.assertIn("without the room it asked for", waiter.said[-1])

    def test_a_wait_for_an_earlier_versions_run_starts_no_count(self) -> None:
        with self.path.open("a+b") as old:
            # The lock taken as an earlier version takes it, by another handle.
            self.assertTrue(store_lock.try_lock(old))
            try:
                waiter = self.short_of_room("vitest", 8, [0.9])
                self.outside(waiter)
                self.assertIn("it is held by a run that has not recorded itself", waiter.said[0])
                self.now[0] = NOW + 10 * machine_lock.ROOM_WAIT_SECONDS
            finally:
                store_lock.unlock(old)
        self.outside(waiter)
        self.now[0] += machine_lock.ROOM_WAIT_SECONDS - 1
        self.outside(waiter)
        self.now[0] += 1
        self.inside(waiter)

    def test_a_later_run_does_not_pass_the_head_while_it_waits_for_room(self) -> None:
        # 16 CPUs free at half busy: room for the later run, not for the head's 22.4.
        load = [0.5]
        head = self.short_of_room("big", 24, load)
        self.assertTrue(head.said_something())
        self.assertIn("16.0 of 32 CPUs are free", head.said[0])
        later = self.short_of_room("unittest", 2, load)
        self.outside(later)
        self.assertIn("it is behind 1 earlier waiter, the first big in", later.said[0])
        self.now[0] = NOW + machine_lock.ROOM_WAIT_SECONDS
        self.inside(head)
        self.assertIn("without the room it asked for", head.said[-1])


class Process:
    """A process that holds a place or the lock and says so a line at a time."""

    def __init__(self, test: unittest.TestCase, script: str, *arguments: str) -> None:
        self.lines: list[str] = []
        self.process = subprocess.Popen(
            [sys.executable, "-c", script, *arguments],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        test.addCleanup(self.stop)

    def stop(self) -> None:
        """Ends it: a holder leaves once its input closes, and a waiter is killed.

        By its own process id, since killing the one `Popen` knows may leave it running.
        """

        assert self.process.stdin is not None
        with contextlib.suppress(OSError):
            self.process.stdin.close()
        with contextlib.suppress(subprocess.TimeoutExpired):
            self.process.wait(HELD_SECONDS)
        if self.process.poll() is None and (said := self.says("pid ", 0)) is not None:
            with contextlib.suppress(OSError):
                os.kill(int(said.split()[1]), signal.SIGTERM)
        self.process.wait(DEADLINE_SECONDS)
        self.reader.join(DEADLINE_SECONDS)

    def _read(self) -> None:
        assert self.process.stdout is not None
        with self.process.stdout:
            for line in self.process.stdout:
                self.lines.append(line.decode("utf-8").strip())

    def says(self, start: str, seconds: float = DEADLINE_SECONDS) -> str | None:
        """The first line it said that starts with `start`, waiting up to `seconds`."""

        deadline = time.monotonic() + seconds
        while True:
            found = next((line for line in self.lines if line.startswith(start)), None)
            if found is not None or time.monotonic() >= deadline:
                return found
            time.sleep(0.02)

    def pid(self) -> int:
        """Its own process id, which it says first: `Popen` knows a launcher's."""

        said = self.says("pid ")
        assert said is not None, self.lines
        return int(said.split()[1])

    def holds(self) -> None:
        if self.says("held") is None:
            raise AssertionError(f"it never held: {self.lines}")

    def release(self) -> None:
        assert self.process.stdin is not None
        self.process.stdin.close()
        self.process.wait(DEADLINE_SECONDS)

    def kill(self) -> None:
        os.kill(self.pid(), signal.SIGTERM)
        self.process.wait(DEADLINE_SECONDS)


class ProcessTests(GateCase):
    """The gate between processes, through the operating system's locks on the files."""

    def gate_holder(self, run: str, cpus: str) -> Process:
        return Process(self, GATE_HOLDER, str(self.path), run, cpus, str(ROOT))

    def test_two_small_runs_of_two_processes_overlap(self) -> None:
        first = self.gate_holder("unittest", "2")
        first.holds()
        second = self.gate_holder("vitest", "8")
        second.holds()
        self.assertIsNone(first.process.poll(), "the first run ended before the second began")
        going, waiting = machine_lock.entries(self.path)
        self.assertEqual(["unittest", "vitest"], sorted(entry.run for entry in going))
        self.assertEqual([], waiting)

    def test_a_whole_machine_run_of_another_process_excludes_and_is_excluded(self) -> None:
        browser = self.gate_holder("browser", "all")
        browser.holds()
        small = self.place("unittest", 2)
        self.outside(small)
        browser.release()
        self.inside(small)
        later = self.gate_holder("browser again", "all")
        self.assertIsNone(later.says("held", HELD_SECONDS), "it went in beside a small run")
        small.finish()
        self.assertIsNotNone(later.says("held"))

    def test_a_killed_runner_gives_its_cpus_back_at_once(self) -> None:
        runner = self.gate_holder("a killed run", "30")
        runner.holds()
        pid = runner.pid()
        waiter = self.place("vitest", 8)
        self.outside(waiter)
        runner.kill()
        self.inside(waiter)
        going, _waiting = machine_lock.entries(self.path)
        self.assertEqual(["vitest"], [entry.run for entry in going])
        files = [file.name for file in (self.path.parent / "heavy.lock.runs").iterdir()]
        self.assertFalse([name for name in files if f"-{pid}-" in name], files)

    def test_a_killed_waiter_gives_its_place_in_the_queue_back_at_once(self) -> None:
        first = self.place("unittest", 2)
        self.inside(first)
        browser = self.gate_holder("a killed waiter", "all")
        self.assertIsNotNone(browser.says("said waiting"))
        _going, waiting = machine_lock.entries(self.path)
        self.assertEqual(["a killed waiter"], [entry.run for entry in waiting])
        later = self.place("vitest", 8)
        self.outside(later)
        browser.kill()
        self.inside(later)
        self.assertEqual([], machine_lock.entries(self.path)[1])
        files = [file.name for file in (self.path.parent / "heavy.lock.runs").iterdir()]
        self.assertFalse([name for name in files if name.startswith("wait-")], files)


class OldProtocolTests(GateCase):
    """A run of the version before the gate and a run through it keep each other out."""

    def old_run(self, run: str = "an old run") -> Process:
        return Process(self, OLD_PROTOCOL_RUN, str(self.path), run, str(ROOT))

    def test_an_old_run_waits_for_new_small_runs_and_names_them(self) -> None:
        first = self.place("unittest", 2)
        self.inside(first)
        second = self.place("vitest", 8)
        self.inside(second)
        old = self.old_run()
        waiting = old.says("said waiting")
        self.assertEqual(
            "said waiting: it is held by 2 heavy runs sharing the machine, the earliest"
            f" unittest in {ROOT.as_posix()}, process {os.getpid()}",
            waiting,
        )
        self.assertIsNone(old.says("held", HELD_SECONDS))
        first.finish()
        self.assertIsNone(old.says("held", HELD_SECONDS), "it went in beside a shared run")
        second.finish()
        self.assertIsNotNone(old.says("held"))

    def test_an_old_run_waits_for_a_new_whole_machine_run(self) -> None:
        browser = self.place("browser", None)
        self.inside(browser)
        old = self.old_run()
        self.assertEqual(
            f"said waiting: it is held by browser in {ROOT.as_posix()}, process {os.getpid()}",
            old.says("said waiting"),
        )
        self.assertIsNone(old.says("held", HELD_SECONDS))
        browser.finish()
        self.assertIsNotNone(old.says("held"))

    def test_a_run_that_is_measuring_the_load_holds_nothing_an_old_run_waits_for(self) -> None:
        old: list[Process] = []
        held_while_measuring: list[bool] = []

        def measure() -> float:
            if not old:
                old.append(self.old_run())
                held_while_measuring.append(old[0].says("held", 5.0) is not None)
            return 0.0

        browser = self.place("browser", None, measure=measure)
        self.assertTrue(browser.said_something())
        self.assertEqual([True], held_while_measuring)
        self.assertIn("it is held by an old run in C:/old-branch", browser.said[0])
        old[0].release()
        self.inside(browser)

    def test_a_new_run_of_either_size_waits_for_an_old_holder(self) -> None:
        for run, cpus in (("unittest", 2), ("browser", None)):
            with self.subTest(run=run):
                old = self.old_run()
                old.holds()
                pid = old.pid()
                waiter = self.place(run, cpus)
                self.outside(waiter)
                self.assertIn(
                    f"it is held by an old run in C:/old-branch, process {pid}", waiter.said[0]
                )
                note = machine_lock.load_note(self.path)
                assert note is not None
                self.assertIn("by an old run in C:/old-branch", note)
                old.release()
                self.inside(waiter)
                waiter.finish()


if __name__ == "__main__":
    unittest.main()
