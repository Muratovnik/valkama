"""What windows/install-desktop.ps1 owes: no hardcoded names, a fenced delete.

The script exists because renaming the product changes the NSIS appId, so each
new installer lands beside the previous copy instead of over it. That makes it
the one place that must know every name this product has ever shipped under --
and the one place where forgetting a rename means either leaving a stale copy
installed or, worse, aiming a recursive delete at the wrong directory.

So two things are held here. Every current name is read from
`desktop/package.json` rather than written down a second time, which is the same
ratchet `test_tray_contract.py` puts on the tray's install path. And the only
recursive delete in the file sits inside the one function that first proves the
directory is this product's own.
"""

from __future__ import annotations

import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "windows", "install-desktop.ps1")
DESKTOP_PACKAGE = os.path.join(ROOT, "desktop", "package.json")
DESKTOP_MAIN = os.path.join(ROOT, "desktop", "main.js")
RELEASE = os.path.join(ROOT, "desktop", "release")


def script_source() -> str:
    with open(SCRIPT, encoding="utf-8") as handle:
        return handle.read()


def desktop_package() -> dict:
    with open(DESKTOP_PACKAGE, encoding="utf-8") as handle:
        return json.load(handle)


class DerivedNameTests(unittest.TestCase):
    """The current name is read, never repeated."""

    def test_the_current_product_and_directory_come_from_the_package(self) -> None:
        source = script_source()
        self.assertIn("$CurrentProduct = $package.build.productName", source)
        self.assertIn("$CurrentDirectory = $package.name", source)

    def test_the_current_name_is_not_written_down_a_second_time(self) -> None:
        package = desktop_package()
        product = package["build"]["productName"]
        directory = package["name"]
        # The former-name lists are the deliberate exception: they are history,
        # and history cannot be derived from the package that replaced it.
        body = re.sub(r"^\$Former\w+ = @\([^)]*\)$", "", script_source(), flags=re.MULTILINE)
        # Comments say the product's name for a reader; only code is checked.
        code = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))
        for literal in (f'"{product} Setup', f'"{directory}"', f'"{product}.exe"'):
            self.assertNotIn(
                literal,
                code,
                f"{literal} is hardcoded; derive it from desktop/package.json instead",
            )


class FormerNameTests(unittest.TestCase):
    """Every name that ever shipped is a name this script can still clean up."""

    def test_every_installer_ever_built_names_a_product_the_script_knows(self) -> None:
        if not os.path.isdir(RELEASE):
            raise unittest.SkipTest("desktop/release is untracked and absent here")
        shipped = set()
        for name in os.listdir(RELEASE):
            found = re.fullmatch(r"(.+) Setup \d+\.\d+\.\d+\.exe", name)
            if found:
                shipped.add(found.group(1))
        if not shipped:
            raise unittest.SkipTest("no installer has been built in this checkout")
        source = script_source()
        [former] = re.findall(r"\$FormerProducts = @\(([^)]*)\)", source)
        known = set(re.findall(r'"([^"]+)"', former))
        known.add(desktop_package()["build"]["productName"])
        self.assertEqual(
            set(),
            shipped - known,
            "an installer exists for a name the script would not uninstall;"
            " add it to $FormerProducts",
        )


class FencedDeleteTests(unittest.TestCase):
    """A recursive delete may only run behind the ownership proof."""

    def test_the_only_recursive_delete_is_inside_the_guarded_function(self) -> None:
        lines = script_source().splitlines()
        owner = None
        offenders = []
        for number, line in enumerate(lines, start=1):
            if line.startswith("function "):
                owner = line.split()[1].split("(")[0]
            if "Remove-Item" in line and "-Recurse" in line and owner != "Remove-Residue":
                offenders.append(f"{number}: {line.strip()}")
        self.assertEqual([], offenders, "a recursive delete escaped Remove-Residue")

    def test_the_guarded_function_proves_ownership_before_deleting(self) -> None:
        source = script_source()
        start = source.index("function Remove-Residue")
        body = source[start : source.index("\nfunction ", start + 1)]
        proof = body.index("Test-OwnDirectory")
        delete = body.index("Remove-Item")
        self.assertLess(proof, delete, "Remove-Residue deletes before it checks whose it is")

    def test_ownership_requires_both_the_parent_and_the_folder_name(self) -> None:
        # A display name alone must never authorise a delete: the directory has
        # to sit directly under %LOCALAPPDATA%\Programs and carry one of this
        # product's own folder names.
        source = script_source()
        start = source.index("function Test-OwnDirectory")
        body = source[start : source.index("\nfunction ", start + 1)]
        self.assertIn("$ProgramsRoot", body)
        self.assertIn("$OwnDirectories", body)


class RuntimeAuthorityTests(unittest.TestCase):
    """Desktop installation creates no second source-location authority."""

    def test_installer_and_app_do_not_write_or_read_a_checkout_record(self) -> None:
        with open(DESKTOP_MAIN, encoding="utf-8") as handle:
            main = handle.read()
        for source in (script_source(), main):
            self.assertNotIn("desktop-install.json", source)
            self.assertNotIn("VALKAMA_SCRIPT", source)
            self.assertNotIn("VALKAMA_PYTHON", source)
        self.assertIn("spawn(launcher.python, [launcher.shim, 'serve'", main)
        self.assertIn("'launcher',\n    'listener',\n    'stop'", main)
        self.assertNotIn("path.resolve(__dirname, '..', 'valkama.py')", main)


if __name__ == "__main__":
    unittest.main()
