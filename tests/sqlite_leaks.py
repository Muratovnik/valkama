"""A test that leaves an SQLite connection open fails.

Python 3.13 and later warn, with a `ResourceWarning`, when an `sqlite3.Connection`
is collected without `close()`. `with conn:` does not prevent it: it ends a
transaction and leaves the connection open. On Windows an open connection holds
its file, so a backup, a restore, a rename or the removal of a test's directory
can fail with the file in use, and the service runs on such a Python.

The warning does not come from the line that dropped the connection. A
connection sits in a reference cycle, so the cycle collector finds it, during
whatever test is running when it next runs. There the warning is raised as an
error, which the interpreter can only hand to `sys.unraisablehook`; the hook
keeps it, and the test running at the time fails with it, at the end of the run
if no test is left. That test is where the connection was collected, which is
not always where it was opened: run the module with `-X tracemalloc=20 -W
always::ResourceWarning`, and the guard stands aside so that the warning prints
the place each connection was opened.

Only this warning becomes an error. The filter matches its message, and every
other warning keeps the action the run gave it.
"""

from __future__ import annotations

import gc
import sys
import tracemalloc
import unittest
import warnings
from collections.abc import Callable
from typing import Any

#: The start of the text `sqlite3` gives the warning; the filter matches it.
MESSAGE = "unclosed database"
#: How to find where the connections a failure names were opened.
HOW_TO_FIND = (
    "run the module again with -X tracemalloc=20 -W always::ResourceWarning"
    " to see where each was opened"
)

_collected: list[str] = []


def _is_unclosed(exc: BaseException | None) -> bool:
    return isinstance(exc, ResourceWarning) and str(exc).startswith(MESSAGE)


def _keeping(previous: Callable[[Any], object]) -> Callable[[Any], None]:
    """An unraisable hook that keeps this warning and hands every other to `previous`."""

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
    return f"{len(found)} sqlite3 connection(s) never closed, collected {where}; {HOW_TO_FIND}:\n{listed}"


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
    """Make every test of this process fail on a connection collected unclosed."""

    sys.unraisablehook = _keeping(sys.unraisablehook)
    run = unittest.TestCase.run
    stop_test_run = unittest.TestResult.stopTestRun

    def guarded_run(self: unittest.TestCase, result: Any = None) -> Any:
        if _guarding():
            # Put back in front at every test: the runner puts its own filter
            # first when the run starts, after this module has been imported.
            warnings.filterwarnings("error", message=MESSAGE, category=ResourceWarning)
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
