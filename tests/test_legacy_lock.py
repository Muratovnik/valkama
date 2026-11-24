"""What `tests/legacy_lock.py` owes: a run under the gate keeps earlier branches' heavy runs out.

An earlier branch's run is stood in for by what its version of the lock does at the
file: a run that takes the whole machine, or any run of the first version, holds the
first byte exclusively through `server.store_lock`; a run that shares the machine
reads `<file>.runs/` and adds up the CPUs of the runs going, which `entries` reads
the way that version reads them. Every lock is a file in a directory this test made,
never the machine's.
"""

from __future__ import annotations

import contextlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from unittest import mock

from server import store_lock
from tests import legacy_lock

ROOT = Path(__file__).resolve().parents[1]
#: Long enough for a waiter that should not get in to have got in by mistake.
HELD_SECONDS = 0.6
DEADLINE_SECONDS = 15.0

#: Holds a place at the lock at argv[1] for a run of 6 CPUs under lease argv[2], says
#: its own process id, which is not the one `Popen` knows when a virtual
#: environment's launcher starts it, then "held", and sleeps until killed.
SHARED_HOLDER = """\
import os, sys, time
sys.path.insert(0, sys.argv[3])
from pathlib import Path
from tests import legacy_lock
print("pid", os.getpid(), flush=True)
with legacy_lock.shared("a killed run", 6, lease=sys.argv[2], path=Path(sys.argv[1]), say=lambda _l: None):
    print("held", flush=True)
    time.sleep(120)
"""


@contextlib.contextmanager
def earlier_whole_machine_run(
    path: Path, run: str = "an earlier whole-suite run"
) -> Iterator[None]:
    """The lock at `path` held as an earlier branch's whole-machine run holds it, with its record."""

    with path.open("a+b") as handle:
        if not store_lock.try_lock(handle):
            raise AssertionError("the byte was not free for the earlier run")
        try:
            since = datetime.now().astimezone().isoformat(timespec="seconds")
            record = {"checkout": "C:/earlier-branch", "pid": 4242, "run": run, "since": since}
            handle.truncate(1)
            handle.write(json.dumps(record).encode())
            handle.flush()
            yield
        finally:
            handle.truncate(1)
            store_lock.unlock(handle)


def byte_free_for_an_exclusive_run(path: Path) -> bool:
    """Whether an earlier whole-machine run would go in now: the exclusive lock, tried and given back."""

    with path.open("a+b") as handle:
        if store_lock.try_lock(handle):
            store_lock.unlock(handle)
            return True
        return False


class LegacyCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-lock-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "heavy.lock"
        # The suite itself runs under the machine's lock; these runs are not its children.
        environment = mock.patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop(legacy_lock.HELD_BY_ANCESTOR, None)

    def shared(self, run: str = "valkama:browser-suite", cpus: int = 14, **options: object):
        options.setdefault("lease", "lease-1")
        options.setdefault("say", lambda _line: None)
        return legacy_lock.shared(run, cpus, path=self.path, **options)  # type: ignore[arg-type]


class SharedPlaceTests(LegacyCase):
    def test_a_run_under_the_gate_keeps_an_earlier_whole_machine_run_out(self) -> None:
        with self.shared():
            self.assertFalse(byte_free_for_an_exclusive_run(self.path))
            # The record an earlier version's waiter names its holder by.
            self.assertIn("valkama:browser-suite in ", legacy_lock.holder(self.path))
        self.assertTrue(byte_free_for_an_exclusive_run(self.path))

    def test_an_earlier_sharing_run_counts_its_cpus_and_its_lease_while_it_runs(self) -> None:
        with self.shared(cpus=14, lease="lease-7"):
            going, waiting = legacy_lock.entries(self.path)
            self.assertEqual([], waiting)
            self.assertEqual(1, len(going))
            self.assertEqual(14, going[0].cpus)
            self.assertEqual("lease-7", going[0].lease)
            self.assertEqual(os.getpid(), going[0].pid)
        self.assertEqual(([], []), legacy_lock.entries(self.path))

    def test_two_runs_under_the_gate_share_the_lock_and_neither_waits(self) -> None:
        said: list[str] = []
        with self.shared(lease="a", say=said.append), self.shared(lease="b", say=said.append):
            going, _waiting = legacy_lock.entries(self.path)
            self.assertEqual({"a", "b"}, {entry.lease for entry in going})
            self.assertIn("2 heavy runs sharing the machine", legacy_lock.holder(self.path))
        self.assertEqual(2, len(said))
        self.assertTrue(all(" after 0 s: shared, counting 14 CPUs" in line for line in said), said)

    def test_with_no_wait_a_run_beside_an_earlier_whole_machine_run_holds_nothing(self) -> None:
        with earlier_whole_machine_run(self.path):
            with self.assertRaises(legacy_lock.BusyError) as refused:
                with self.shared(wait=False):
                    self.fail("went in beside an exclusive holder")
            self.assertIn("an earlier whole-suite run in C:/earlier-branch", str(refused.exception))
            self.assertEqual(([], []), legacy_lock.entries(self.path))

    def test_a_waiting_run_says_why_at_once_and_again_and_goes_in_once_the_earlier_run_ends(
        self,
    ) -> None:
        said: list[str] = []
        inside, leave = threading.Event(), threading.Event()

        def run() -> None:
            with self.shared(say=said.append, report_every=0.2):
                inside.set()
                leave.wait(DEADLINE_SECONDS)

        with earlier_whole_machine_run(self.path):
            thread = threading.Thread(target=run, daemon=True)
            thread.start()
            self.addCleanup(thread.join, DEADLINE_SECONDS)
            self.addCleanup(leave.set)
            self.assertFalse(inside.wait(HELD_SECONDS))
        self.assertTrue(inside.wait(DEADLINE_SECONDS), "it never went in")
        leave.set()
        thread.join(DEADLINE_SECONDS)
        self.assertTrue(said[0].startswith("waiting for the earlier branches' heavy-test lock"))
        self.assertIn("it is held by an earlier whole-suite run in C:/earlier-branch", said[0])
        self.assertTrue(any(line.startswith("still waiting after ") for line in said), said)
        self.assertIn(": shared, counting 14 CPUs", said[-1])

    def test_a_run_marked_as_under_a_holder_of_this_lock_holds_nothing(self) -> None:
        with mock.patch.dict(os.environ, legacy_lock.marker(self.path)):
            with earlier_whole_machine_run(self.path), self.shared(wait=False):
                self.assertEqual(([], []), legacy_lock.entries(self.path))
        # A mark for another lock does not count as this one.
        other = self.path.with_name("other.lock")
        with mock.patch.dict(os.environ, legacy_lock.marker(other)):
            self.assertFalse(legacy_lock.under_holder(self.path))

    def test_a_killed_holder_gives_the_byte_and_its_entry_back_at_once(self) -> None:
        holder = subprocess.Popen(
            [sys.executable, "-c", SHARED_HOLDER, str(self.path), "lease-9", str(ROOT)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
        )
        self.addCleanup(holder.wait, DEADLINE_SECONDS)
        self.addCleanup(holder.kill)
        assert holder.stdout is not None
        self.addCleanup(holder.stdout.close)
        lines = [holder.stdout.readline(), holder.stdout.readline()]
        self.assertEqual(b"held", lines[1].strip(), lines)
        pid = int(lines[0].split()[1])
        self.assertFalse(byte_free_for_an_exclusive_run(self.path))
        self.assertEqual(["lease-9"], [entry.lease for entry in legacy_lock.entries(self.path)[0]])
        os.kill(pid, signal.SIGTERM)
        holder.wait(DEADLINE_SECONDS)
        deadline = time.monotonic() + DEADLINE_SECONDS
        while not byte_free_for_an_exclusive_run(self.path) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertTrue(byte_free_for_an_exclusive_run(self.path))
        self.assertEqual(([], []), legacy_lock.entries(self.path, reclaim=True))


class EarlierRunsTests(LegacyCase):
    def test_the_run_of_an_earlier_branch_is_named_and_a_run_of_this_tree_is_not(self) -> None:
        directory = self.path.with_name(f"{self.path.name}.runs")
        record = {
            "run": "an earlier Vitest run",
            "checkout": "C:/b",
            "pid": 7,
            "since": time.time(),
        }
        handle, _file = legacy_lock._place(directory, "run", {**record, "cpus": 8})
        self.addCleanup(legacy_lock._leave, handle, _file)
        with self.shared():
            named = legacy_lock.earlier_runs(self.path)
        self.assertEqual(1, len(named), named)
        self.assertTrue(named[0].startswith("an earlier Vitest run in C:/b, process 7,"), named)
        self.assertTrue(named[0].endswith("with 8 CPUs"), named)

    def test_an_earlier_whole_machine_run_is_named_by_its_record(self) -> None:
        with earlier_whole_machine_run(self.path):
            named = legacy_lock.earlier_runs(self.path)
        self.assertEqual(1, len(named), named)
        self.assertIn("an earlier whole-suite run in C:/earlier-branch, process 4242", named[0])

    def test_a_free_lock_or_none_at_all_names_nothing_and_asking_makes_no_file(self) -> None:
        self.assertEqual([], legacy_lock.earlier_runs(self.path))
        self.assertFalse(self.path.exists(), "asking made a lock file")
        with self.shared():
            pass
        self.assertEqual([], legacy_lock.earlier_runs(self.path))

    def test_a_record_not_written_yet_is_said_as_such(self) -> None:
        with self.path.open("a+b") as handle:
            self.assertTrue(store_lock.try_lock(handle))
            try:
                self.assertEqual(
                    "a run that has not recorded itself yet", legacy_lock.holder(self.path)
                )
            finally:
                store_lock.unlock(handle)


class LockPathTests(unittest.TestCase):
    def test_the_machine_lock_stays_put_however_a_run_moves_its_profile_or_temp(self) -> None:
        # A release coordinator runs the checks with a TEMP inside the checkout, and the
        # gates runner and the release check move LOCALAPPDATA into a throwaway profile
        # that may sit there too. A lock that followed either would hold only the runs
        # given that place, and earlier branches would not find this tree's runs there.
        logon = str(Path(ROOT.anchor) / "valkama-lock-logon")
        moved = str(ROOT / ".git" / "relkit" / "tmp" / "candidate")
        with mock.patch.object(legacy_lock, "logon_local_app_data", return_value=logon):
            reference = legacy_lock.lock_path().resolve()
            with mock.patch.dict(
                os.environ, {"LOCALAPPDATA": moved, "TMP": moved, "TEMP": moved, "TMPDIR": moved}
            ):
                with mock.patch.object(tempfile, "tempdir", moved):
                    path = legacy_lock.lock_path().resolve()
        self.assertFalse(path.is_relative_to(ROOT))
        self.assertFalse(path.is_relative_to(Path.home() / ".valkama"))
        self.assertEqual(reference, path)

    @unittest.skipUnless(sys.platform == "win32", "only Windows reads a logon profile")
    def test_with_no_logon_value_the_lock_is_under_the_variable(self) -> None:
        profile = Path(ROOT.anchor) / "valkama-lock-profile"
        with (
            mock.patch.object(legacy_lock, "logon_local_app_data", return_value=None),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(profile)}),
        ):
            path = legacy_lock.lock_path()
        self.assertEqual(profile / "Temp", path.parent)

    def test_the_file_name_is_the_one_earlier_branches_use(self) -> None:
        # They meet only if both look for the same file.
        self.assertRegex(legacy_lock.lock_path().name, r"^valkama-heavy-tests-.+\.lock$")
