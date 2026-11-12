"""`server/mod/valkama-quota`: what the Claude Code mod and Valkama must agree on.

The mod's behaviour is tested by its own suite, `claude plugin test server/mod/valkama-quota`,
which needs the `claude` command this suite does not have. What it cannot see from there is
the Python side it calls, so this module holds the names both sides spell to each other: the
launcher's manifest and shim, the receiver's command and source, the mod's name the doctor
looks for, and the marketplace entry that installs it. Each is read from the mod's files as
the engine reads them, not from a copy kept here.
"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import launcher
from server.hooks import statusline
from server.ops import doctor
from server.quota import samples

MOD = ROOT / "server" / "mod" / "valkama-quota"


def constant(name: str) -> str:
    """The text a top-level `export const <name> =` of the hooks module is bound to."""

    source = (MOD / "hooks" / "register.ts").read_text(encoding="utf-8")
    found = re.search(rf"^export const {name} = (.+?)(?: as const)?$", source, re.MULTILINE)
    assert found is not None, f"register.ts binds no {name}"
    return found.group(1)


class ModContractTests(unittest.TestCase):
    def test_the_manifest_names_the_mod_the_doctor_looks_for_and_its_hooks_module(self) -> None:
        manifest = json.loads((MOD / ".claude-plugin" / "plugin.json").read_text("utf-8"))
        self.assertEqual(doctor.MOD_NAME, manifest["name"])
        hooks = json.loads((MOD / "hooks" / "hooks.json").read_text("utf-8"))
        self.assertEqual(["./register.ts"], hooks["modules"])
        self.assertTrue((MOD / "hooks" / "register.ts").is_file())

    def test_the_mod_finds_the_receiver_by_the_launcher_s_own_file_names(self) -> None:
        self.assertEqual(json.dumps(launcher.MANIFEST_NAME), constant("MANIFEST").replace("'", '"'))
        self.assertEqual(json.dumps(launcher.SHIM_NAME), constant("SHIM").replace("'", '"'))

    def test_the_mod_runs_the_receiver_with_a_source_it_records(self) -> None:
        command = json.loads(constant("RECEIVER").replace("'", '"'))
        self.assertEqual("statusline", command[0])
        self.assertIn("statusline", launcher.EARLY_ENTRIES, "the shim answers it without runpy")
        [option] = command[1:]
        self.assertTrue(option.startswith(statusline.SOURCE_OPTION))
        source = option[len(statusline.SOURCE_OPTION) :]
        self.assertEqual("mod", source)
        self.assertIn(source, statusline.LIVE_SOURCES)
        self.assertIn(source, samples.SOURCE_WINDOWS)

    def test_a_hand_over_is_bounded(self) -> None:
        timeout = int(constant("RECEIVER_TIMEOUT_MS").replace("_", ""))
        self.assertGreater(timeout, 0)
        # The engine's own ceiling for `$.process.run`, ten minutes, is far above it.
        self.assertLessEqual(timeout, 30_000)

    def test_the_repository_s_marketplace_installs_this_folder(self) -> None:
        marketplace = json.loads(
            (ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8")
        )
        [entry] = marketplace["plugins"]
        self.assertEqual(doctor.MOD_NAME, entry["name"])
        self.assertEqual(MOD.resolve(), (ROOT / entry["source"]).resolve())


if __name__ == "__main__":
    unittest.main()
