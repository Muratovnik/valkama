"""Tests for server, mirroring its packages.

Importing this package points `VALKAMA_DB` at a throwaway file. It is not a
convenience: with it absent, a test that forgets to set its own reached the
owner's real store, and once the Planning cutover ran inside `connect()` that
reach became a one-way conversion of 350 real cards — performed again by every
MCP session the client respawned afterwards. The store now refuses to convert
without explicit permission, and this is the other half of that answer: a suite
run must not be able to touch the canonical path at all.

A module that sets `VALKAMA_DB` itself still wins, which is what nineteen of
them already do. This only covers the ones that do not.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile
import unittest

#: The suite's own directory, removed when the interpreter exits. One per run,
#: so a leftover file from a previous run cannot be read as state.
_SUITE_ROOT = tempfile.mkdtemp(prefix="valkama-tests-")
atexit.register(shutil.rmtree, _SUITE_ROOT, ignore_errors=True)

#: The store a test falls back to. Exported because a test that points
#: `VALKAMA_DB` at its own temporary file must hand this back afterwards rather
#: than clearing the variable: a cleared variable resolves to the owner's real
#: path, which the guard below then has to refuse, and a suite whose later
#: modules all refuse proves nothing.
SUITE_STORE = os.path.join(_SUITE_ROOT, "suite.sqlite3")

os.environ.setdefault("VALKAMA_DB", SUITE_STORE)
# The half `SUITE_STORE` cannot cover. A cleanup can still be written to clear
# the variable, a module can set it from elsewhere, and the adoption tests
# deliberately go through the default; this is what makes the one path that must
# never be opened refuse rather than convert. Recorded here, before any test can
# redirect the home directory, so the path named is the real one.
os.environ["VALKAMA_PROTECTED_STORE"] = os.path.join(
    os.path.expanduser("~"), ".valkama", "valkama.sqlite3"
)
# A test must never put an icon in the tray or reach a real user runtime root.
os.environ.setdefault("VALKAMA_NO_TRAY", "1")
# Nor a toast on the desktop of whoever runs the suite: every process a test starts
# inherits this, and the tests of the executor take it off with the process start
# replaced.
os.environ.setdefault("VALKAMA_NO_ALERTS", "1")


class RunKeyDouble:
    """Stands where the owner's Run key would, for the whole suite.

    No redirected home directory isolates a registry value, and `launcher install`
    and `uninstall` read and rewrite this one. A test that means to exercise the real
    key's calls gives `WindowsRunKey` a stand-in `winreg` instead.
    """

    def __init__(self) -> None:
        self.command: str | None = None

    def read(self) -> str | None:
        return self.command

    def write(self, command: str) -> None:
        self.command = command

    def delete(self) -> None:
        self.command = None


# Imported here, after the variables above, so nothing can reach the real key first.
from server import launcher

launcher.AUTOSTART_STORE = RunKeyDouble()


class LoadNoting(unittest.TextTestResult):
    """The result of every unittest run: one that fails says who holds the heavy-test lock.

    A targeted run takes no lock, so it may fail beside another checkout's heavy run
    for that load alone; the line after the failures names that run, or is absent
    when the lock is free or held by this run's own holder.
    """

    def printErrors(self) -> None:  # noqa: N802 -- the name unittest's runner calls
        super().printErrors()
        if not self.wasSuccessful():
            from tests import machine_lock

            note = machine_lock.load_note()
            if note is not None:
                self.stream.writeln(note)


# typeshed types the stream of a subclass as the decorator the runner wraps every stream in,
# which is what the runner passes, but declares the attribute to take any stream.
unittest.TextTestRunner.resultclass = LoadNoting  # type: ignore[assignment]

#: The patterns that select every test module: unittest's own default and the one the
#: gates and CI name. A narrower one makes a targeted run.
_WHOLE_SUITE_PATTERNS = (None, "test*.py", "test_*.py")


def load_tests(
    loader: unittest.TestLoader, standard_tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    """A run of the whole suite holds the machine's heavy-test lock until it ends.

    unittest calls this for each run that reaches the package itself, such as
    `discover -s . -p "test_*.py"` as the gates and CI spell it, `discover -s tests -t .`
    and `-m unittest tests`, and never for a module or a subpackage named on its own,
    so those targeted runs take no lock; nor does one narrowed by `-p` or `-k`. The
    lock is taken while the suite loads, so a run that waited starts its clock once it
    is in. `tests/machine_lock.py` says why the lock exists and why a run under a
    holder goes in at once.

    Discovery does not walk a package that has this hook, so the hook walks it, from
    the directory that holds the package, so that its modules keep their `tests.` names.
    """

    from tests import machine_lock

    if pattern in _WHOLE_SUITE_PATTERNS and not loader.testNamePatterns:
        machine_lock.hold_until_exit("the whole unittest suite")
    here = os.path.dirname(os.path.abspath(__file__))
    standard_tests.addTests(
        loader.discover(here, pattern or "test_*.py", top_level_dir=os.path.dirname(here))
    )
    return standard_tests
