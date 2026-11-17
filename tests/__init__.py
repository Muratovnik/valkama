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
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile

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
