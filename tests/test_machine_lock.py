"""What `tests/machine_lock.py` owes: one heavy run at a time, and a waiter that says for whom.

Every lock here is a file in a directory this test made, never the machine's:
the suite itself runs under that lock when `tests/isolated.py gates` starts it.
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
from collections.abc import Iterator
from pathlib import Path
from unittest import mock

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

    def test_the_machine_lock_is_outside_the_checkout_and_the_store(self) -> None:
        # A release coordinator runs the checks with a TEMP inside the checkout; the lock
        # must not follow it there, or it would hold only the runs given that TEMP.
        given = str(ROOT / ".git" / "relkit" / "tmp" / "candidate")
        # The isolated gates runner redirects LOCALAPPDATA into its result directory, which
        # may sit inside the checkout; the lock's place is pinned here so the check holds
        # whatever the caller's redirection is. Not under the TEMP this run was given either:
        # the release coordinator runs this very check with that TEMP inside the checkout.
        profile = str(Path(ROOT.anchor) / "valkama-lock-profile")
        with mock.patch.dict(os.environ, {"LOCALAPPDATA": profile}):
            reference = machine_lock.lock_path().resolve()
        with mock.patch.dict(
            os.environ, {"LOCALAPPDATA": profile, "TMP": given, "TEMP": given, "TMPDIR": given}
        ):
            with mock.patch.object(tempfile, "tempdir", given):
                path = machine_lock.lock_path().resolve()
        self.assertFalse(path.is_relative_to(ROOT))
        self.assertFalse(path.is_relative_to(Path.home() / ".valkama"))
        self.assertEqual(reference, path)


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
