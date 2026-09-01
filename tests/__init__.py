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
