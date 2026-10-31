"""Stopping a process tree on POSIX, where the tree is a process group.

`processes.stop_process_tree` kills the child's process group. That group is
the child's own tree only when the child was started in a session of its own;
a child left in the caller's group shares it with the caller, and killing it
once took the stdio front and the client that started it down too. Both
tests are POSIX-only: Windows stops a tree with `taskkill /T` by process id,
which the stdio front's tests exercise.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import unittest

from server import processes

SLEEPER = "import time; time.sleep(30)"
PARENT = (
    "import subprocess, sys, time\n"
    f"child = subprocess.Popen([sys.executable, '-c', {SLEEPER!r}])\n"
    "print(child.pid, flush=True)\n"
    "time.sleep(30)\n"
)


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)  # signal 0 asks; it delivers nothing
    except OSError:
        return False
    return True


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
