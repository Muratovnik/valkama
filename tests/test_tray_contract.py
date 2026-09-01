"""What the tray owes: a visible answer to every click, and a real path to open.

The tray is the only always-visible entry point to Valkama, and until this file
it had no test at all. It has now failed twice by doing nothing whatsoever --
once when `ELECTRON_RUN_AS_NODE` made the app start as plain Node and exit
without a window, once when a rebuilt front end left the running server on its
startup snapshot and the runtime identity check refused it. Both times the only
trace was a line in `%TEMP%\\valkama-tray.log`, so the icon looked frozen.

These tests hold the shape that makes that impossible. The decision is a pure
function with five named actions, driven here through `-PrintPlan`, which
touches no network and starts no process. The open path carries its outcome
back as a value instead of logging it, so a refusal cannot end in silence. And
the installed path the tray reaches for is derived from the same
`desktop/package.json` the installer reads, because "the strings were renamed
and the runtime was not" is how this product has broken three times.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from server import launcher as launcher_contract

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRAY = os.path.join(ROOT, "windows", "tray.ps1")
DESKTOP_PACKAGE = os.path.join(ROOT, "desktop", "package.json")
MAIN_JS = os.path.join(ROOT, "desktop", "main.js")

EXPECTED = json.dumps(
    {
        "interface_version": "runtime",
        "identity": "a" * 64,
        "static": {"sha256": "s1"},
        "backend": {"sha256": "b1"},
    }
)


def listener(*, identity: str = "a" * 64, static: str = "s1", backend: str = "b1") -> str:
    """A listener's answer to /api/runtime, drifted in whichever half is asked."""
    return json.dumps(
        {
            "interface_version": "runtime",
            "identity": identity,
            "static": {"sha256": static},
            "backend": {"sha256": backend},
        }
    )


def tray_source() -> str:
    with open(TRAY, encoding="utf-8") as handle:
        return handle.read()


def function_body(source: str, name: str) -> str:
    """One PowerShell function, from its keyword to its matching closing brace."""
    start = source.index(f"function {name}")
    depth = 0
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise AssertionError(f"{name} is never closed")


class DecisionTableTests(unittest.TestCase):
    """The five actions, driven through the script's own pure entry point."""

    pwsh = ""

    @classmethod
    def setUpClass(cls) -> None:
        found = shutil.which("pwsh")
        if found is None:
            raise unittest.SkipTest("pwsh is not installed")
        cls.pwsh = found

    def plan(
        self,
        running: str | None,
        app_exists: bool,
        *,
        listener_owner: str | None = None,
    ) -> dict:
        argv = [
            self.pwsh,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            TRAY,
            "-PrintPlan",
            "-ExpectedJson",
            EXPECTED,
            "-ListenerOwner",
            listener_owner or ("managed" if running is not None else "free"),
        ]
        if running is not None:
            argv += ["-ListenerJson", running]
        if app_exists:
            argv.append("-AppExists")
        done = subprocess.run(argv, capture_output=True, check=False)
        self.assertEqual(0, done.returncode, done.stderr)
        # Captured as bytes and decoded deliberately: PowerShell writes stdout in
        # the console code page, and every string this script produces is ASCII,
        # so a reason that is not must fail here rather than arrive as mojibake.
        return json.loads(done.stdout.decode("utf-8"))

    def test_nothing_listening_opens_the_app_which_starts_the_server_itself(self) -> None:
        self.assertEqual("open-app", self.plan(None, app_exists=True)["action"])

    def test_nothing_listening_and_no_app_starts_the_server_here(self) -> None:
        self.assertEqual("start-server", self.plan(None, app_exists=False)["action"])

    def test_a_matching_listener_opens_the_installed_app(self) -> None:
        self.assertEqual("open-app", self.plan(EXPECTED, app_exists=True)["action"])

    def test_a_matching_listener_without_an_app_opens_a_browser(self) -> None:
        self.assertEqual("open-browser", self.plan(EXPECTED, app_exists=False)["action"])

    def test_a_rebuilt_front_end_asks_for_a_restart_and_says_which_half_drifted(self) -> None:
        # The exact case the owner hit: the server serves its startup snapshot of
        # web/dist, so a rebuild leaves it stale while the backend still matches.
        plan = self.plan(listener(identity="b" * 64, static="s2"), app_exists=True)
        self.assertEqual("restart-required", plan["action"])
        self.assertIn("front end", plan["reason"])

    def test_changed_server_code_asks_for_a_restart_and_says_so(self) -> None:
        plan = self.plan(listener(identity="c" * 64, backend="b2"), app_exists=True)
        self.assertEqual("restart-required", plan["action"])
        self.assertIn("server code", plan["reason"])

    def test_a_listener_that_is_not_ours_is_refused_rather_than_restarted(self) -> None:
        # Holding the port is not proof of whose server it is, so this half of
        # the table must never reach the branch that stops a process.
        stranger = json.dumps({"interface_version": "", "identity": ""})
        plan = self.plan(stranger, app_exists=True, listener_owner="foreign")
        self.assertEqual("refuse", plan["action"])
        self.assertNotIn("estart", plan["reason"], "a stranger's process is not ours to restart")

    def test_even_a_matching_runtime_is_refused_when_the_managed_launcher_is_not_owner(
        self,
    ) -> None:
        plan = self.plan(EXPECTED, app_exists=True, listener_owner="foreign")
        self.assertEqual("refuse", plan["action"])
        self.assertIn("left it untouched", plan["reason"])

    def test_missing_ownership_data_cannot_turn_an_unused_probe_into_start_authority(
        self,
    ) -> None:
        plan = self.plan(None, app_exists=False, listener_owner="unavailable")
        self.assertEqual("refuse", plan["action"])
        self.assertIn("could not verify", plan["reason"])

    def test_the_table_above_covers_every_action_the_script_can_return(self) -> None:
        actions = set(re.findall(r'action = "([a-z-]+)"', tray_source()))
        self.assertEqual(
            {"open-app", "open-browser", "start-server", "restart-required", "refuse"},
            actions,
            "a new action must arrive with the row of this table that exercises it",
        )


class InstalledPathTests(unittest.TestCase):
    """The path the tray opens must be the path the installer writes.

    electron-builder's per-user NSIS target is
    `%LOCALAPPDATA%\\Programs\\<package name>\\<productName>.exe`. Renaming the
    product twice left this default naming a directory that had never existed,
    so the tray quietly opened a browser instead of the app the owner installed.
    """

    def test_the_default_app_path_is_the_one_electron_builder_installs(self) -> None:
        with open(DESKTOP_PACKAGE, encoding="utf-8") as handle:
            package = json.load(handle)
        name = package["name"]
        product = package["build"]["productName"]
        expected = f"$env:LOCALAPPDATA\\Programs\\{name}\\{product}.exe"
        [default] = re.findall(r'\$AppPath = "([^"]+)"', tray_source())
        self.assertEqual(
            expected, default, "the tray and the installer disagree on where the app is"
        )


class ManagedLauncherTests(unittest.TestCase):
    """Checkout paths never decide how a server starts or whether it may stop."""

    def test_tray_invokes_the_verified_stable_shim_and_has_no_checkout_fallback(self) -> None:
        source = tray_source()
        self.assertIn("Get-ManagedLauncher", source)
        self.assertIn("$Launcher.Shim", source)
        for obsolete in (
            "$EntryPoint",
            "Get-OwnedListenerProcess",
            "VALKAMA_SCRIPT",
            "VALKAMA_PYTHON",
            "this checkout does not own",
        ):
            self.assertNotIn(obsolete, source)

    def test_restart_delegates_the_ownership_proof_to_the_launcher(self) -> None:
        body = function_body(tray_source(), "Restart-Server")
        self.assertIn("Stop-ManagedListener", body)
        self.assertNotIn("Stop-Process", body)

    def test_launcher_failure_preserves_stderr_and_names_a_safe_next_action(self) -> None:
        body = function_body(tray_source(), "Invoke-ManagedLauncherJson")
        self.assertIn("2>&1", body)
        self.assertIn("$detail", body)
        self.assertIn("No process was stopped", body)
        self.assertIn("choose another port", body)

    def test_launcher_failure_surfaces_the_specific_native_stderr(self) -> None:
        pwsh = shutil.which("pwsh")
        if pwsh is None:
            self.skipTest("pwsh is not installed")
        with tempfile.TemporaryDirectory() as temporary:
            failing_shim = Path(temporary) / "refuse.py"
            failing_shim.write_text(
                "import sys\nprint('specific ownership refusal', file=sys.stderr)\nraise SystemExit(2)\n",
                encoding="utf-8",
                newline="\n",
            )
            escaped_tray = TRAY.replace("'", "''")
            escaped_python = sys.executable.replace("'", "''")
            escaped_shim = str(failing_shim).replace("'", "''")
            command = f"""
. '{escaped_tray}' -PrintPlan | Out-Null
$launcher = [pscustomobject]@{{ Python = '{escaped_python}'; Shim = '{escaped_shim}' }}
$message = try {{
    Invoke-ManagedLauncherJson $launcher @('launcher', 'listener', 'status')
    'unexpected success'
}} catch {{
    $_.Exception.Message
}}
[Console]::Out.Write($message)
"""
            done = subprocess.run(
                [pwsh, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True,
                check=False,
            )
            stderr = done.stderr.decode("utf-8", errors="strict")
            self.assertEqual(0, done.returncode, stderr)
            message = done.stdout.decode("utf-8", errors="strict")
            self.assertIn("specific ownership refusal", message)
            self.assertIn("No process was stopped", message)
            self.assertIn("choose another port", message)

    def test_powershell_verifies_and_reports_the_installed_stable_shim(self) -> None:
        pwsh = shutil.which("pwsh")
        if pwsh is None:
            self.skipTest("pwsh is not installed")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "managed launcher"
            installed = launcher_contract.install(
                directory,
                platform_name="nt",
                python=sys.executable,
                script=os.path.join(ROOT, "valkama.py"),
            )
            done = subprocess.run(
                [
                    pwsh,
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-File",
                    TRAY,
                    "-PrintLauncher",
                    "-LauncherDirectory",
                    str(directory),
                ],
                capture_output=True,
                check=False,
            )
            self.assertEqual(0, done.returncode, done.stderr.decode("utf-8", errors="strict"))
            reading = json.loads(done.stdout.decode("utf-8", errors="strict"))
            self.assertEqual(str(installed["shim"]), reading["Shim"])


class VisibleFailureTests(unittest.TestCase):
    """A click ends in a window or in a sentence, never in a log line alone."""

    def test_the_open_path_carries_failures_back_instead_of_logging_them(self) -> None:
        body = function_body(tray_source(), "Open-Valkama")
        self.assertNotIn(
            "Write-TrayLog",
            body,
            "a refusal that only writes the log is a click that did nothing",
        )

    def test_every_outcome_the_open_path_mints_is_one_the_click_handler_answers(self) -> None:
        source = tray_source()
        minted = set(re.findall(r'New-TrayResult "(\w+)"', source))
        self.assertIn("opened", minted)
        handler = function_body(source, "Invoke-Open")
        for outcome in sorted(minted - {"failed"}):
            self.assertIn(
                f'"{outcome}"',
                handler,
                f"the click handler has no branch for the {outcome} outcome",
            )
        # `failed` needs no branch of its own; it is what the fallback is for.
        self.assertIn("Show-TrayProblem", handler, "the fallback must still speak")


BOARD = re.compile(r"\bboards?\b", re.IGNORECASE)
# Planning really does have boards, and a card toast carries one across IPC.
# That is the wire, not the product's name.
WIRE = (re.compile(r"toast\.board"), re.compile(r"valkama:navigate-card"))


class ProductVoiceTests(unittest.TestCase):
    """The desktop surface calls the product Valkama.

    Planning is one of seven modules, so a tray item, a window title or a failure
    message that calls the whole product "the board" names the whole after one
    of its parts. The domain keeps the word where it means a board.
    """

    def test_no_desktop_surface_string_calls_the_product_a_board(self) -> None:
        offenders = []
        for path in (TRAY, MAIN_JS, DESKTOP_PACKAGE):
            with open(path, encoding="utf-8") as handle:
                for number, line in enumerate(handle, start=1):
                    if not BOARD.search(line) or any(rule.search(line) for rule in WIRE):
                        continue
                    offenders.append(f"{os.path.relpath(path, ROOT)}:{number}: {line.strip()}")
        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
