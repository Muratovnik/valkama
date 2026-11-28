"""Process trees: the one `contained` starts and ends, and the one a stop ends.

`processes.contained` runs a command in a tree that ends with its block, and on
Windows with its caller however that caller dies: a gate step that outlived its
gate once kept writing into the tree the next run read. The tests here start
every process they look at and stop only those.

`processes.stop_process_tree` kills the child's process group on POSIX. That
group is the child's own tree only when the child was started in a session of
its own; a child left in the caller's group shares it with the caller, and
killing it once took the stdio front and the client that started it down too.
Windows stops a tree with `taskkill /T` by process id, which the stdio front's
tests exercise.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

from server import processes

ROOT = Path(__file__).resolve().parents[1]
SLEEPER = "import time; time.sleep(30)"
PARENT = (
    "import subprocess, sys, time\n"
    f"child = subprocess.Popen([sys.executable, '-c', {SLEEPER!r}])\n"
    "print(child.pid, flush=True)\n"
    "time.sleep(30)\n"
)
#: Starts a sleeper with no pipe of its own, says its number and exits: what a
#: step that leaks a process does.
LEAVER = (
    "import subprocess, sys\n"
    f"child = subprocess.Popen([sys.executable, '-c', {SLEEPER!r}],"
    " stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
    "print(child.pid, flush=True)\n"
)
#: A gate in small: it runs, through `contained`, a step that starts a sleeper
#: and stays, and says both numbers.
GATE = (
    "import subprocess, sys\n"
    f"sys.path.insert(0, {str(ROOT)!r})\n"
    "from server import processes\n"
    f"step = {PARENT!r}\n"
    "with processes.contained([sys.executable, '-c', step], stdout=subprocess.PIPE) as child:\n"
    "    grandchild = child.stdout.readline().decode().strip()\n"
    "    print(child.pid, grandchild, flush=True)\n"
    "    child.wait()\n"
)
#: Inside a job, a step that makes a job of its own for one child, as the
#: heavy-process gate does, and starts another with `CREATE_BREAKAWAY_FROM_JOB`.
NESTING = (
    "import subprocess, sys\n"
    f"sys.path.insert(0, {str(ROOT)!r})\n"
    "from server import processes\n"
    "with processes.contained([sys.executable, '-c', 'print(7)'], stdout=subprocess.PIPE) as inner:\n"
    "    said = inner.stdout.read().strip()\n"
    "    assert inner.wait() == 0 and said == b'7', said\n"
    f"left = subprocess.Popen([sys.executable, '-c', {SLEEPER!r}], creationflags=0x01000000)\n"
    "print(left.pid, flush=True)\n"
)
#: How long a killed tree may take to go.
GONE_SECONDS = 10.0


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)  # signal 0 asks; it delivers nothing
    except OSError:
        return False
    return True


class Held:
    """A process this test started, held by a handle so its number cannot be reused.

    Windows only. Ending it is the cleanup of a test whose tree survived.
    """

    def __init__(self, pid: int) -> None:
        import _winapi

        self._winapi = _winapi
        self.pid = pid
        # SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION
        self.handle = _winapi.OpenProcess(0x00100000 | 0x0001 | 0x1000, False, pid)

    def gone_within(self, seconds: float) -> bool:
        return self._winapi.WaitForSingleObject(self.handle, int(seconds * 1000)) == 0

    def end(self) -> None:
        if not self.gone_within(0):
            self._winapi.TerminateProcess(self.handle, 1)
        self._winapi.CloseHandle(self.handle)


def gone_within(pid: int, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while alive(pid):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.05)
    return True


class ContainedTests(unittest.TestCase):
    def hold(self, pid: int) -> Held:
        held = Held(pid)
        self.addCleanup(held.end)
        return held

    def test_what_the_child_leaves_running_ends_with_the_block(self) -> None:
        with processes.contained([sys.executable, "-c", LEAVER], stdout=subprocess.PIPE) as child:
            assert child.stdout is not None
            left = int(child.stdout.readline())
            child.stdout.close()
            self.assertEqual(0, child.wait())
            if sys.platform == "win32":
                held = self.hold(left)
                self.assertFalse(held.gone_within(0), "the sleeper ended before the block did")
            else:
                self.assertTrue(alive(left), "the sleeper ended before the block did")

        if sys.platform == "win32":
            self.assertTrue(held.gone_within(GONE_SECONDS), "the sleeper outlived the block")
        else:
            self.assertTrue(gone_within(left, GONE_SECONDS), "the sleeper outlived the block")

    def test_the_child_runs_with_what_it_was_given_and_says_its_exit_code(self) -> None:
        with tempfile.TemporaryDirectory(prefix="vk-proc-") as directory:
            log = Path(directory) / "out.log"
            with (
                log.open("wb") as output,
                processes.contained(
                    [sys.executable, "-c", "import os, sys; print(os.getcwd()); sys.exit(3)"],
                    cwd=directory,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                ) as child,
            ):
                code = child.wait()
            said = log.read_text(encoding="utf-8").strip()

        self.assertEqual(3, code)
        self.assertEqual(os.path.normcase(directory), os.path.normcase(said))

    @unittest.skipUnless(sys.platform == "win32", "a Job Object is a Windows object")
    def test_the_tree_ends_when_the_process_holding_it_is_killed_hard(self) -> None:
        gate = subprocess.Popen([sys.executable, "-c", GATE], stdout=subprocess.PIPE)
        self.addCleanup(gate.wait, GONE_SECONDS)
        self.addCleanup(gate.kill)
        assert gate.stdout is not None
        self.addCleanup(gate.stdout.close)
        step, left = (int(number) for number in gate.stdout.readline().split())
        tree = [self.hold(step), self.hold(left)]
        self.assertFalse(tree[1].gone_within(0), "the sleeper ended before the gate did")

        gate.kill()  # TerminateProcess: the gate runs no code of its own after it
        gate.wait(timeout=GONE_SECONDS)
        started = time.monotonic()
        survivors = [held for held in tree if not held.gone_within(GONE_SECONDS)]

        self.assertEqual([], survivors, "the step's tree outlived its gate")
        self.assertLess(time.monotonic() - started, GONE_SECONDS)

    @unittest.skipUnless(sys.platform == "win32", "a Job Object is a Windows object")
    def test_a_job_inside_and_a_child_that_breaks_away_still_start(self) -> None:
        with processes.contained([sys.executable, "-c", NESTING], stdout=subprocess.PIPE) as child:
            assert child.stdout is not None
            line = child.stdout.readline()
            child.stdout.close()
            self.assertEqual(0, child.wait(), "the step could not start its children")
        away = self.hold(int(line))

        # It left the job at its own request, so the job's end does not reach it.
        self.assertFalse(away.gone_within(0.5), "a child that broke away was ended with the job")

    @unittest.skipUnless(sys.platform == "win32", "a Job Object is a Windows object")
    def test_a_child_the_job_cannot_take_never_runs_and_is_not_left(self) -> None:
        real_take = processes._Job.take
        started: list[subprocess.Popen] = []
        real_popen = subprocess.Popen

        def popen(*arguments, **options):
            started.append(real_popen(*arguments, **options))
            return started[-1]

        def refused(job, pid: int) -> None:
            import _winapi

            # A handle that is not a job's, so the assignment is refused for real.
            job_handle, job._handle = job._handle, _winapi.GetCurrentProcess()
            try:
                real_take(job, pid)
            finally:
                job._handle = job_handle

        with tempfile.TemporaryDirectory(prefix="vk-proc-") as directory:
            marker = Path(directory) / "ran"
            source = f"open({str(marker)!r}, 'w').close()"
            with (
                mock.patch.object(processes._Job, "take", refused),
                mock.patch.object(subprocess, "Popen", side_effect=popen),
                self.assertRaises(OSError) as raised,
                processes.contained([sys.executable, "-c", source]),
            ):
                self.fail("the block ran with the child outside the job")

            self.assertIn("AssignProcessToJobObject", str(raised.exception))
            self.assertEqual(1, len(started))
            self.assertIsNotNone(started[0].poll(), "the refused child was left running")
            self.assertFalse(marker.exists(), "the refused child ran")


@unittest.skipUnless(sys.platform == "win32", "the tree is held by handle on Windows")
class StopByOutcomeTests(unittest.TestCase):
    """`stop_process_tree` answers by what is left of the tree, not by what `taskkill` said."""

    def start_tree(self) -> tuple[subprocess.Popen, list[Held]]:
        """A child with a sleeper of its own, both held until the test ends."""

        child = subprocess.Popen([sys.executable, "-c", PARENT], stdout=subprocess.PIPE)
        # Run last, after the ends below: it reaps the child they ended.
        self.addCleanup(child.wait, GONE_SECONDS)
        assert child.stdout is not None
        self.addCleanup(child.stdout.close)
        grandchild = int(child.stdout.readline())
        tree = [Held(child.pid), Held(grandchild)]
        for held in tree:
            self.addCleanup(held.end)
        return child, tree

    def taskkill(self, *, code: int | None = None, kills: bool) -> Any:
        """`taskkill` that kills for real or not at all, then exits `code` or times out."""

        real_run = subprocess.run

        def run(argv, **options):
            self.assertEqual("taskkill", argv[0])
            if kills:
                real_run(argv, **options)
            if code is None:
                raise subprocess.TimeoutExpired(argv, options.get("timeout", 5))
            return subprocess.CompletedProcess(argv, code, b"", b"")

        return mock.patch.object(processes.subprocess, "run", side_effect=run)

    def test_a_tree_that_is_gone_is_true_though_taskkill_exited_non_zero(self) -> None:
        child, tree = self.start_tree()

        with self.taskkill(code=128, kills=True):
            stopped = processes.stop_process_tree(child, wait_timeout=GONE_SECONDS)

        self.assertTrue(stopped)
        self.assertEqual([True, True], [held.gone_within(0) for held in tree])

    def test_what_a_timed_out_taskkill_left_running_is_ended_through_its_handles(self) -> None:
        child, tree = self.start_tree()

        with self.taskkill(kills=False):
            stopped = processes.stop_process_tree(child, wait_timeout=GONE_SECONDS)

        self.assertTrue(stopped)
        self.assertEqual([True, True], [held.gone_within(0) for held in tree])

    def test_a_tree_still_running_after_a_timed_out_taskkill_is_false(self) -> None:
        child, tree = self.start_tree()

        with self.taskkill(kills=False), mock.patch.object(processes._Tree, "end"):
            stopped = processes.stop_process_tree(child, wait_timeout=0.5)

        self.assertFalse(stopped)
        self.assertEqual([False, False], [held.gone_within(0) for held in tree])

    def test_with_no_tree_to_read_a_failed_taskkill_stops_the_child_alone_and_says_so(
        self,
    ) -> None:
        child, (held_child, held_grandchild) = self.start_tree()
        refused = mock.patch.object(processes, "process_table", side_effect=OSError(5, "refused"))

        with refused, self.taskkill(code=1, kills=False):
            stopped = processes.stop_process_tree(child, wait_timeout=GONE_SECONDS)

        self.assertFalse(stopped)
        self.assertTrue(held_child.gone_within(0), "the fallback left the child running")
        self.assertFalse(held_grandchild.gone_within(0), "the fallback reached past the child")

    def test_with_no_tree_to_read_taskkill_s_success_is_the_answer(self) -> None:
        child, tree = self.start_tree()
        refused = mock.patch.object(processes, "process_table", side_effect=OSError(5, "refused"))

        with refused:
            stopped = processes.stop_process_tree(child, wait_timeout=GONE_SECONDS)

        self.assertTrue(stopped)
        self.assertEqual([True, True], [held.gone_within(GONE_SECONDS) for held in tree])

    def test_a_number_no_process_has_is_not_taken_for_its_neighbour_s(self) -> None:
        child, _ = self.start_tree()

        # Windows opens process n for n + 2 as well, so a stop of a made-up number
        # would reach whatever process holds the number next to it.
        self.assertIsNone(processes._Tree.seen(child.pid + 2))
        seen = processes._Tree.seen(child.pid)
        assert seen is not None
        self.addCleanup(seen.close)
        self.assertIn(child.pid, seen.pids)

    def test_a_process_older_than_the_parent_it_names_is_not_taken_into_the_tree(self) -> None:
        child, tree = self.start_tree()
        real_table = processes.process_table
        grandchild = tree[1].pid

        def table() -> dict[int, tuple[int, str]]:
            # This test process, as if its parent's number now named the sleeper.
            return {**real_table(), os.getpid(): (grandchild, "python.exe")}

        with mock.patch.object(processes, "process_table", side_effect=table):
            seen = processes._Tree.seen(child.pid)
        assert seen is not None
        self.addCleanup(seen.close)

        # The tree may hold more, such as the console host Windows gives the child.
        self.assertLessEqual({child.pid, grandchild}, set(seen.pids))
        self.assertNotIn(os.getpid(), seen.pids)
        self.assertFalse(seen.unseen)


@unittest.skipIf(sys.platform == "win32", "a process group is the POSIX tree")
class ProcessGroupTests(unittest.TestCase):
    def test_a_child_with_its_own_session_is_stopped_with_what_it_started(self) -> None:
        parent = subprocess.Popen(
            [sys.executable, "-c", PARENT], stdout=subprocess.PIPE, start_new_session=True
        )
        self.addCleanup(parent.stdout.close)
        grandchild = int(parent.stdout.readline())

        self.assertTrue(processes.stop_process_tree(parent))

        deadline = time.monotonic() + 10
        while alive(grandchild) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(alive(grandchild), "the tree's child outlived it")

    def test_a_child_in_the_callers_group_is_stopped_alone(self) -> None:
        child = subprocess.Popen([sys.executable, "-c", SLEEPER])
        self.assertEqual(os.getpgrp(), os.getpgid(child.pid))

        # Killing the group would end this test process here.
        self.assertFalse(processes.stop_process_tree(child))

        self.assertIsNotNone(child.poll())


if __name__ == "__main__":
    unittest.main()
