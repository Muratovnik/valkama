"""What `tests/machine_lock.py` owes: one heavy run at a time, and a waiter that says for whom.

Every lock here is a file in a directory this test made, never the machine's:
the suite itself runs under that lock, which it takes as it loads, and the tests of
that loading stand in for the hold it takes.
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


class Waiter:
    """A run that waits for the lock in a thread and records what it said and when it got in."""

    def __init__(self, path: Path, *, report_every: float = machine_lock.REPORT_SECONDS) -> None:
        self.said: list[str] = []
        self.inside = threading.Event()
        self.leave = threading.Event()
        self.thread = threading.Thread(
            target=self._hold, args=(path, report_every), daemon=True, name="lock-waiter"
        )

    def _hold(self, path: Path, report_every: float) -> None:
        with machine_lock.held(
            "the second run", path=path, say=self.said.append, report_every=report_every
        ):
            self.inside.set()
            self.leave.wait(DEADLINE_SECONDS)

    def start(self) -> Waiter:
        self.thread.start()
        return self

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


class LockCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-lock-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "heavy.lock"


class LockTests(LockCase):
    def test_a_second_run_waits_until_the_first_gives_the_lock_back(self) -> None:
        with held_elsewhere(self.path) as release:
            waiter = Waiter(self.path).start()
            self.addCleanup(waiter.finish)
            self.assertFalse(waiter.inside.wait(HELD_SECONDS), "it ran beside the holder")
            release.set()
            self.assertTrue(waiter.inside.wait(DEADLINE_SECONDS), "it never got the lock")
        self.assertTrue(waiter.said[-1].startswith("took the heavy-test lock after"))

    def test_a_run_that_finds_the_lock_free_takes_it_without_a_word(self) -> None:
        said: list[str] = []
        with machine_lock.held("alone", path=self.path, say=said.append):
            pass
        with machine_lock.held("again", path=self.path, say=said.append):
            pass
        self.assertEqual([], said)

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
        said, pid = holder.stdout.readline().split()
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
        with (
            mock.patch.object(machine_lock, "logon_local_app_data", return_value=logon),
            mock.patch.object(tests, "CALLER_LOCAL_APP_DATA", moved),
        ):
            reference = machine_lock.lock_path().resolve()
            with mock.patch.dict(
                os.environ, {"LOCALAPPDATA": moved, "TMP": moved, "TEMP": moved, "TMPDIR": moved}
            ):
                with mock.patch.object(tempfile, "tempdir", moved):
                    path = machine_lock.lock_path().resolve()
        self.assertFalse(path.is_relative_to(ROOT))
        self.assertFalse(path.is_relative_to(Path.home() / ".valkama"))
        self.assertEqual(reference, path)

    @unittest.skipUnless(sys.platform == "win32", "only on Windows is the lock under LOCALAPPDATA")
    def test_with_no_logon_value_the_lock_stays_with_what_the_caller_gave(self) -> None:
        # Importing the `tests` package moved LOCALAPPDATA into the suite's directory, and
        # the gates import this file through it: a lock there would hold no other run.
        caller = Path(tempfile.gettempdir()) / "valkama-caller-profile"
        with (
            mock.patch.object(machine_lock, "logon_local_app_data", return_value=None),
            mock.patch.object(tests, "CALLER_LOCAL_APP_DATA", str(caller)),
        ):
            self.assertEqual(caller / "Temp", machine_lock.lock_path().parent)
        self.assertFalse(machine_lock.lock_path().is_relative_to(tests.SUITE_LOCAL_APP_DATA))
        # The browser runner runs the file as a script, which imports no package and must
        # leave the variable alone for the browsers found under it.
        probe = (
            "import os, sys; sys.path.insert(0, sys.argv[1]); import machine_lock;"
            " print('tests' in sys.modules, os.environ['LOCALAPPDATA'])"
        )
        found = subprocess.run(
            [sys.executable, "-c", probe, str(ROOT / "tests")],
            env={**os.environ, "LOCALAPPDATA": str(caller)},
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(f"False {caller}", found.stdout.strip())


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
        with (
            mock.patch.dict(os.environ),
            mock.patch.object(machine_lock.atexit, "register") as register,
        ):
            machine_lock.hold_until_exit("the whole suite", path=self.path, say=self.fail)
            ((release,), _options) = register.call_args
            self.addCleanup(release)
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
        with machine_lock.held("after", path=self.path, say=self.fail):
            pass


def loaded_ids(suite: unittest.TestSuite) -> set[str]:
    """Every test a loaded suite holds, by id."""

    found: set[str] = set()
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            found |= loaded_ids(test)
        else:
            # unittest's own id: a test class may define an `id` helper of its own.
            found.add(unittest.TestCase.id(test))
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

        reader = unittest.TestLoader()
        for name, value in loader.items():
            setattr(reader, name, value)
        with mock.patch.object(machine_lock, "hold_until_exit") as hold:
            suite = how(reader)
        return loaded_ids(suite), hold.call_count

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
        with machine_lock.held("after", path=self.path, say=self.fail):
            pass

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
        with machine_lock.held("after", path=self.path, say=self.fail):
            pass


if __name__ == "__main__":
    unittest.main()
