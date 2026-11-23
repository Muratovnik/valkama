"""A test that leaves an SQLite connection, a child process or a file open fails.

Python warns, with a `ResourceWarning`, when one of these is collected while it
is still open: an `sqlite3.Connection` without `close()` (from Python 3.13), a
`subprocess.Popen` whose exit status was never read, and a file object never
closed. `with conn:` does not close a connection: it ends a transaction and
leaves the connection open. A `Popen` warns even when its child has exited, as
long as nothing waited for it. On Windows an open connection or file holds its
file, so a backup, a restore, a rename or the removal of a test's directory can
fail with the file in use, and a child nobody waited for may outlive the test
that started it. The service runs on such a Python.

The warning does not always come from the line that dropped the resource. A
connection sits in a reference cycle, so the cycle collector finds it, during
whatever test is running when it next runs; a process or a file is usually
collected as soon as its last reference goes. There the warning is raised as
an error, which the interpreter can only hand to `sys.unraisablehook`; the hook
keeps it, and the test running at the time fails with it, at the end of the run
if no test is left. That test is where the resource was collected, which is not
always where it was opened: run the module with `-X tracemalloc=20 -W
always::ResourceWarning`, and the guard stands aside so that the warning prints
the place each was opened.

Only these warnings become errors. The filters match their messages, and every
other warning keeps the action the run gave it.
"""

from __future__ import annotations

import gc
import re
import sys
import tracemalloc
import unittest
import warnings
from collections.abc import Callable
from typing import Any

#: The start of the text each guarded warning has, as a pattern the filters match:
#: `sqlite3`'s, `subprocess.Popen`'s and the `io` module's.
MESSAGES = (
    "unclosed database",
    r"subprocess \d+ is still running",
    "unclosed file",
)
#: How to find where the resources a failure names were opened.
HOW_TO_FIND = (
    "run the module again with -X tracemalloc=20 -W always::ResourceWarning"
    " to see where each was opened"
)

_PATTERNS = tuple(re.compile(message) for message in MESSAGES)
_collected: list[str] = []


def _is_unclosed(exc: BaseException | None) -> bool:
    return isinstance(exc, ResourceWarning) and any(
        pattern.match(str(exc)) for pattern in _PATTERNS
    )


def _keeping(previous: Callable[[Any], object]) -> Callable[[Any], None]:
    """An unraisable hook that keeps these warnings and hands every other to `previous`."""

    def hook(unraisable: Any) -> None:
        if _is_unclosed(unraisable.exc_value):
            _collected.append(str(unraisable.exc_value))
            return
        previous(unraisable)

    return hook


def take_collected() -> list[str]:
    """The warnings kept since the last call, which this call forgets."""

    found = list(_collected)
    _collected.clear()
    return found


def _complaint(found: list[str], where: str) -> str:
    listed = "\n".join(found)
    return (
        f"{len(found)} connection(s), process(es) or file(s) never closed, collected {where};"
        f" {HOW_TO_FIND}:\n{listed}"
    )


def fail_if_collected() -> None:
    """Raise the warnings kept since the last call, if there are any."""

    found = take_collected()
    if found:
        raise ResourceWarning(_complaint(found, "during this test or just before it"))


def _end_of_run() -> None:
    """What a failure found after the last test is reported against."""


def _guarding() -> bool:
    # Under tracemalloc the run is looking for the opening sites, which the
    # warning prints only while it stays a warning.
    return not tracemalloc.is_tracing()


def install() -> None:
    """Make every test of this process fail on a resource collected while open."""

    sys.unraisablehook = _keeping(sys.unraisablehook)
    run = unittest.TestCase.run
    stop_test_run = unittest.TestResult.stopTestRun

    def guarded_run(self: unittest.TestCase, result: Any = None) -> Any:
        if _guarding():
            # Put back in front at every test: the runner puts its own filter
            # first when the run starts, after this module has been imported.
            for message in MESSAGES:
                warnings.filterwarnings("error", message=message, category=ResourceWarning)
            # The first cleanup runs last, after the test's own have closed theirs.
            self.addCleanup(fail_if_collected)
        return run(self, result)

    def guarded_stop_test_run(self: unittest.TestResult) -> None:
        if _guarding():
            # One full collection, for what no collection reached during the run.
            gc.collect()
            found = take_collected()
            if found:
                where = unittest.FunctionTestCase(_end_of_run, description="the end of the run")
                self.errors.append((where, _complaint(found, "after the last test")))
        stop_test_run(self)

    unittest.TestCase.run = guarded_run  # type: ignore[method-assign]
    unittest.TestResult.stopTestRun = guarded_stop_test_run  # type: ignore[method-assign]
