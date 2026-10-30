"""What the Planning routes and the app shell load, checked at run time.

The import-linter contract in `pyproject.toml` reads the import graph, and the
graph does not show one edge Python takes: importing any submodule of a
package runs the package's `__init__` first. A package `__init__` that loaded
its siblings once pulled the extension registry's vocabulary into modules that
never named it. This asks the interpreter instead of the graph.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# What answers a request from the module gate alone: exact-scope Planning
# routing, the app shell, store identity and the read envelope.
ROUTING_MODULES = (
    "server.app_shell",
    "server.planning.exact_api",
    "server.planning.interactions",
    "server.planning.routing",
    "server.store_identity",
    "server.ui_state",
)

# The module gate and its manifest are allowed; everything else under
# `server.platform` brings a store up, migrates it or reaches an adapter.
ALLOWED_PLATFORM_MODULES = {
    "server.platform",
    "server.platform.module_gate",
    "server.platform.module_manifest",
    "server.platform.modules",
}


class RoutingLoadsOnlyTheModuleGateTests(unittest.TestCase):
    def test_routing_modules_load_only_the_module_gate(self) -> None:
        script = (
            "import importlib, json, sys\n"
            f"for name in {ROUTING_MODULES!r}:\n"
            "    importlib.import_module(name)\n"
            "print(json.dumps(sorted(m for m in sys.modules if m.startswith('server.platform'))))\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        loaded = set(json.loads(result.stdout))
        self.assertEqual(set(), loaded - ALLOWED_PLATFORM_MODULES)


if __name__ == "__main__":
    unittest.main()
