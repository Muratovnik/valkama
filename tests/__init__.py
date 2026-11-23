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

`LOCALAPPDATA` moves into the suite's directory for the same reason, and
unconditionally, because every Windows process has one. The project registry is
read from there, and with it the Git directory of every registered project: a
test that raised an MCP loop or `serve` ran the start-up pass, whose `commits`
step takes the commit records waiting there for an hour into its store and
deletes them on the next pass. `tests/isolated.py gates` moved it for the gates
only, and a fixture that set its own covered its own tests only; a targeted run
of any other module reached the owner's registry. A module that sets
`LOCALAPPDATA` itself still wins, since it does so after this has run. `HOME` and
`USERPROFILE` stay: a test that commits needs the caller's Git identity, and the
registry falls back to them only when `LOCALAPPDATA` is not set at all.

`GIT_CONFIG_GLOBAL` moves too, to a file of the suite's own that holds only the
caller's identity and the directories it marked safe. `valkama git-hook install`
and `launcher install` write the global Git configuration, and Git commits run the
hooks it names: a targeted run of a module whose test forgot its own file would
write Valkama's hooks into the caller's, and a test's commit made inside an agent's
shell would run the hooks installed there. `tests/isolated.py gates` gives its
children a file of the throwaway profile; this covers every other test process.
"""

from __future__ import annotations

import atexit
import os
import shutil
import subprocess
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

#: The `LOCALAPPDATA` the process was started with, read before the move below,
#: and `None` where there was none. Only for what must find the machine's real
#: places, each of which names it where it is used: the heavy-test lock
#: (`tests/machine_lock.py`) and the clients the live commit check starts.
CALLER_LOCAL_APP_DATA = os.environ.get("LOCALAPPDATA")
#: Where the project registry, and everything else kept under `LOCALAPPDATA`, is
#: read and written in a test process: empty, as in a new profile.
SUITE_LOCAL_APP_DATA = os.path.join(_SUITE_ROOT, "local")
os.makedirs(SUITE_LOCAL_APP_DATA)
os.environ["LOCALAPPDATA"] = SUITE_LOCAL_APP_DATA
#: What of the caller's global Git configuration a test process keeps: who commits,
#: and the repositories it marked safe to work in.
CARRIED_GIT_SETTINGS = ("user.name", "user.email", "safe.directory")
#: The global Git file every test process reads and writes in place of the caller's.
SUITE_GIT_CONFIG = os.path.join(_SUITE_ROOT, "gitconfig")


def _quoted(value: str) -> str:
    """A value as the Git configuration file format spells it, quoted whole."""

    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _carried_git_settings() -> str:
    """The caller's settings of `CARRIED_GIT_SETTINGS`, as the text of a configuration file.

    Read with one Git call before the move, includes followed, as a commit reads
    them; nothing, when there is no Git or no such setting.
    """

    pattern = "^(" + "|".join(name.replace(".", r"\.") for name in CARRIED_GIT_SETTINGS) + ")$"
    try:
        found = subprocess.run(
            ["git", "config", "--global", "--includes", "-z", "--get-regexp", pattern],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    sections: dict[str, list[str]] = {}
    for item in found.stdout.decode("utf-8", "replace").split("\0"):
        key, separator, value = item.partition("\n")
        if separator:
            section, _, name = key.rpartition(".")
            sections.setdefault(section, []).append(f"\t{name} = {_quoted(value)}\n")
    return "".join(f"[{section}]\n" + "".join(lines) for section, lines in sections.items())


with open(SUITE_GIT_CONFIG, "w", encoding="utf-8", newline="\n") as _file:
    _file.write(_carried_git_settings())
os.environ["GIT_CONFIG_GLOBAL"] = SUITE_GIT_CONFIG
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

# A test that leaves an SQLite connection, a child process or a file open fails, here
# for every way the suite is run: `tests/parallel.py`, `unittest discover`,
# `tests/affected.py` and one module alone.
from tests import resource_leaks

resource_leaks.install()


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

#: The logical CPUs a run of the whole suite in one process declares to the heavy-test
#: gate. The suite is one Python process, with the processes some tests start; a
#: sampler of whole runs saw it at one to two cores, short of a run from start to end,
#: so this is a first figure to revise against a measured one. `tests/parallel.py`,
#: which runs it in several processes, declares a figure of its own.
WHOLE_SUITE_CPUS = 2


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
        machine_lock.hold_until_exit("the whole unittest suite", cpus=WHOLE_SUITE_CPUS)
    here = os.path.dirname(os.path.abspath(__file__))
    standard_tests.addTests(
        loader.discover(here, pattern or "test_*.py", top_level_dir=os.path.dirname(here))
    )
    return standard_tests
