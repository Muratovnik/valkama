"""What the tray owes: a visible answer to every click, and a real path to open.

The tray is the only always-visible entry point to Valkama, and until this file
it had no test at all. It has now failed twice by doing nothing whatsoever --
once when `ELECTRON_RUN_AS_NODE` made the app start as plain Node and exit
without a window, once when a rebuilt front end left the running server on its
startup snapshot and the runtime identity check refused it. Both times the only
trace was a line in `%TEMP%\\valkama-tray.log`, so the icon looked frozen.

These tests hold the shape that makes that impossible. The decision is a pure
function with six named actions, driven here through `-PrintPlan`, which
touches no network and starts no process. The open path carries its outcome
back as a value instead of logging it, so a refusal cannot end in silence; with
the app installed it starts the app and consults nothing, because the app owns
the startup decision. And
the installed path the tray reaches for is derived from the same
`desktop/package.json` the installer reads, because "the strings were renamed
and the runtime was not" is how this product has broken three times.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
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
    found = re.search(rf"function {re.escape(name)}\b(?!-)", source)
    if found is None:
        raise AssertionError(f"{name} is not defined")
    start = found.start()
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
    """The six actions, driven through the script's own pure entry point."""

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

    def test_with_the_app_installed_every_reading_opens_the_app(self) -> None:
        # One owner for the startup decision: the app reads the port itself, at
        # the moment it acts, and offers the restart in its own window. A tray
        # deciding first is how a click during startup was offered a restart of
        # the server the app had just started.
        stranger = json.dumps({"interface_version": "", "identity": ""})
        stale = listener(identity="b" * 64, static="s2")
        for running, owner in (
            (None, "free"),
            (EXPECTED, "managed"),
            (stale, "managed"),
            (None, "managed"),
            (EXPECTED, "free"),
            (stranger, "foreign"),
            (None, "unavailable"),
        ):
            with self.subTest(running=running, owner=owner):
                plan = self.plan(running, app_exists=True, listener_owner=owner)
                self.assertEqual("open-app", plan["action"])

    def test_nothing_listening_and_no_app_starts_the_server_here(self) -> None:
        self.assertEqual("start-server", self.plan(None, app_exists=False)["action"])

    def test_a_matching_listener_without_an_app_opens_a_browser(self) -> None:
        self.assertEqual("open-browser", self.plan(EXPECTED, app_exists=False)["action"])

    def test_a_rebuilt_front_end_asks_for_a_restart_and_says_which_half_drifted(self) -> None:
        # The exact case the owner hit: the server serves its startup snapshot of
        # web/dist, so a rebuild leaves it stale while the backend still matches.
        plan = self.plan(listener(identity="b" * 64, static="s2"), app_exists=False)
        self.assertEqual("restart-required", plan["action"])
        self.assertIn("front end", plan["reason"])

    def test_changed_server_code_asks_for_a_restart_and_says_so(self) -> None:
        plan = self.plan(listener(identity="c" * 64, backend="b2"), app_exists=False)
        self.assertEqual("restart-required", plan["action"])
        self.assertIn("server code", plan["reason"])

    def test_readings_that_disagree_are_a_transition_never_a_refusal_or_a_restart(self) -> None:
        # Two reads a moment apart while a server starts or stops: it answered
        # but the table already shows the port free, or the table shows it held
        # but it has not answered yet. Neither is evidence of a stranger or of
        # a stale server.
        for running, owner in ((EXPECTED, "free"), (None, "managed")):
            with self.subTest(running=running, owner=owner):
                plan = self.plan(running, app_exists=False, listener_owner=owner)
                self.assertEqual("in-transition", plan["action"])

    def test_a_listener_that_is_not_ours_is_refused_rather_than_restarted(self) -> None:
        # Holding the port is not proof of whose server it is, so this half of
        # the table must never reach the branch that stops a process.
        stranger = json.dumps({"interface_version": "", "identity": ""})
        plan = self.plan(stranger, app_exists=False, listener_owner="foreign")
        self.assertEqual("refuse", plan["action"])
        self.assertNotIn("estart", plan["reason"], "a stranger's process is not ours to restart")

    def test_even_a_matching_runtime_is_refused_when_the_managed_launcher_is_not_owner(
        self,
    ) -> None:
        plan = self.plan(EXPECTED, app_exists=False, listener_owner="foreign")
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
            {
                "open-app",
                "open-browser",
                "start-server",
                "in-transition",
                "restart-required",
                "refuse",
            },
            actions,
            "a new action must arrive with the row of this table that exercises it",
        )


def run_tray_functions(body: str, *, app_path: str, launcher_directory: str) -> dict:
    """Load every function of the tray script, then run `body`; its JSON answer.

    The functions are parsed out of the file rather than dot-sourced, so the
    icon-only half (the click handler and its helpers) is reachable too, and
    nothing at the script's top level -- the icon, its message loop -- runs.
    `body` may redefine a function first: a function shadows a cmdlet of the
    same name, which is how these tests keep Start-Process from starting
    anything.
    """
    pwsh = shutil.which("pwsh")
    if pwsh is None:
        raise unittest.SkipTest("pwsh is not installed")
    escaped = TRAY.replace("'", "''")
    script = f"""
$ErrorActionPreference = 'Stop'
$ast = [System.Management.Automation.Language.Parser]::ParseFile('{escaped}', [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({{ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }}, $false)) {{
    . ([scriptblock]::Create($definition.Extent.Text))
}}
$AppPath = '{app_path.replace("'", "''")}'
$LauncherDirectory = '{launcher_directory.replace("'", "''")}'
$Port = 8642
$LogPath = Join-Path ([IO.Path]::GetTempPath()) "valkama-tray-test-$PID.log"
$ClickQuietMilliseconds = 1500
$ConnectTimeoutMilliseconds = 300
$script:Busy = $false
$script:LastClickAt = [DateTime]::MinValue
$script:Log = [System.Collections.Generic.List[string]]::new()
$script:Started = [System.Collections.Generic.List[string]]::new()
function Write-TrayLog([string]$Message) {{ $script:Log.Add($Message) }}
function Start-Process {{ param($FilePath, $ArgumentList, $WindowStyle) $script:Started.Add([string]$FilePath) }}
function Start-Sleep {{ param($Milliseconds) }}
{body}
"""
    done = subprocess.run(
        [pwsh, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        check=False,
        timeout=120,
    )
    stderr = done.stderr.decode("utf-8", errors="replace")  # diagnostics for a human only
    if done.returncode != 0:
        raise AssertionError(stderr)
    return json.loads(done.stdout.decode("utf-8", errors="strict").strip().splitlines()[-1])


class OpenPathTests(unittest.TestCase):
    """What a click does, run against the script's own functions with no network."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.app = root / "Valkama.exe"
        self.app.write_bytes(b"")
        self.missing_app = str(root / "no-app" / "Valkama.exe")
        self.no_launcher = str(root / "no-launcher")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_with_the_app_installed_a_click_starts_it_and_consults_nothing(self) -> None:
        # The launcher directory does not even exist: had any check run, the
        # outcome would be a failure naming the missing launcher.
        answer = run_tray_functions(
            """
function Get-ManagedLauncher { throw 'the launcher was consulted' }
function Get-ListenerRuntime { throw 'the port was probed' }
$result = Open-Valkama
[pscustomobject]@{ outcome = $result.outcome; steps = $result.steps; started = @($script:Started) } | ConvertTo-Json -Compress
""",
            app_path=str(self.app),
            launcher_directory=self.no_launcher,
        )
        self.assertEqual("opened", answer["outcome"])
        self.assertEqual([str(self.app)], answer["started"])
        self.assertRegex(answer["steps"], r"^start-app=\d+ms$")

    def test_a_second_click_during_an_open_is_ignored_and_says_why(self) -> None:
        answer = run_tray_functions(
            """
function Open-App { New-TrayResult 'opened' 'opened the app' 'start-app=1ms' }
Invoke-Open
Invoke-Open
$script:Busy = $true
$script:LastClickAt = [DateTime]::MinValue
Invoke-Open
[pscustomobject]@{ log = @($script:Log); busy = $script:Busy } | ConvertTo-Json -Compress
""",
            app_path=str(self.app),
            launcher_directory=self.no_launcher,
        )
        log = answer["log"]
        self.assertEqual("click", log[0])
        self.assertRegex(log[1], r"^opened after \d+ ms: opened the app \(start-app=1ms\)$")
        self.assertRegex(log[2], r"^click ignored: \d+ ms after the last one$")
        self.assertEqual("click ignored: an open is in flight", log[3])
        self.assertEqual(4, len(log))

    def test_without_the_app_a_transition_is_read_again_and_then_opened(self) -> None:
        answer = run_tray_functions(
            f"""
$expected = '{EXPECTED}' | ConvertFrom-Json
$script:Http = 0
$script:Owner = 0
function Get-ManagedLauncher {{ [pscustomobject]@{{ Python = 'python'; Shim = 'shim' }} }}
function Get-ExpectedRuntime {{ $expected }}
function Get-ListenerRuntime {{ $script:Http++; $expected }}
function Get-ListenerOwnership {{ $script:Owner++; [pscustomobject]@{{ state = $(if ($script:Owner -eq 1) {{ 'free' }} else {{ 'managed' }}) }} }}
function Stop-ManagedListener {{ throw 'a stop was attempted' }}
$result = Open-ValkamaWithoutApp
[pscustomobject]@{{ outcome = $result.outcome; steps = $result.steps; started = @($script:Started) }} | ConvertTo-Json -Compress
""",
            app_path=self.missing_app,
            launcher_directory=self.no_launcher,
        )
        self.assertEqual("opened", answer["outcome"])
        self.assertEqual(["http://127.0.0.1:8642/"], answer["started"])
        self.assertIn("owner-again=", answer["steps"])
        self.assertIn("plan=open-browser", answer["steps"])

    def test_without_the_app_a_transition_that_persists_is_said_not_acted_on(self) -> None:
        for owner, http in (("free", "$expected"), ("managed", "$null")):
            with self.subTest(owner=owner):
                answer = run_tray_functions(
                    f"""
$expected = '{EXPECTED}' | ConvertFrom-Json
function Get-ManagedLauncher {{ [pscustomobject]@{{ Python = 'python'; Shim = 'shim' }} }}
function Get-ExpectedRuntime {{ $expected }}
function Get-ListenerRuntime {{ {http} }}
function Get-ListenerOwnership {{ [pscustomobject]@{{ state = '{owner}' }} }}
function Stop-ManagedListener {{ throw 'a stop was attempted' }}
$result = Open-ValkamaWithoutApp
[pscustomobject]@{{ outcome = $result.outcome; message = $result.message; started = @($script:Started) }} | ConvertTo-Json -Compress
""",
                    app_path=self.missing_app,
                    launcher_directory=self.no_launcher,
                )
                self.assertEqual("starting", answer["outcome"])
                self.assertEqual([], answer["started"])
                self.assertNotIn("Restart it now", answer["message"])

    def test_the_http_probe_gives_up_on_a_refused_connect_quickly(self) -> None:
        # Nothing listens on a port this test just released. Windows reports a
        # refused loopback connect only after about two seconds of retries,
        # which the old two-second probe waited out on every click.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        answer = run_tray_functions(
            f"""
$Port = {port}
$watch = [Diagnostics.Stopwatch]::StartNew()
$reading = Get-ListenerRuntime
[pscustomobject]@{{ none = ($null -eq $reading); ms = $watch.ElapsedMilliseconds }} | ConvertTo-Json -Compress
""",
            app_path=self.missing_app,
            launcher_directory=self.no_launcher,
        )
        self.assertTrue(answer["none"])
        self.assertLess(answer["ms"], 1500)

    def test_an_http_error_still_proves_that_something_holds_the_port(self) -> None:
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            port = server.getsockname()[1]

            def answer_once() -> None:
                connection, _ = server.accept()
                with connection:
                    connection.recv(4096)
                    connection.sendall(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    )

            thread = threading.Thread(target=answer_once, daemon=True)
            thread.start()
            answer = run_tray_functions(
                f"""
$Port = {port}
$reading = Get-ListenerRuntime
[pscustomobject]@{{ none = ($null -eq $reading); version = [string]$reading.interface_version }} | ConvertTo-Json -Compress
""",
                app_path=self.missing_app,
                launcher_directory=self.no_launcher,
            )
            thread.join(timeout=10)
        self.assertEqual({"none": False, "version": ""}, answer)


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
                checkout=ROOT,
                releases=Path(temporary) / "releases",
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
        for name in ("Open-Valkama", "Open-App", "Open-ValkamaWithoutApp"):
            with self.subTest(function=name):
                self.assertNotIn(
                    "Write-TrayLog",
                    function_body(tray_source(), name),
                    "a refusal that only writes the log is a click that did nothing",
                )

    def test_every_outcome_the_open_path_mints_is_one_the_click_handler_answers(self) -> None:
        source = tray_source()
        minted = set(re.findall(r'New-TrayResult "(\w+)"', source))
        self.assertIn("opened", minted)
        handler = function_body(source, "Complete-Open")
        for outcome in sorted(minted - {"failed"}):
            self.assertIn(
                f'"{outcome}"',
                handler,
                f"the click handler has no branch for the {outcome} outcome",
            )
        # `failed` needs no branch of its own; it is what the fallback is for.
        self.assertIn("Show-TrayProblem", handler, "the fallback must still speak")


class TrayIconTests(unittest.TestCase):
    """The tray shows the icon frame drawn for its slot, not a shrunken large one."""

    def test_the_tray_takes_the_frame_drawn_at_the_small_icon_size(self) -> None:
        # `Width` is the size of the frame the constructor chose, not a scaled
        # copy: given the former single 256px icon this answers 256, so the
        # assertion fails both when the tray asks for the large size and when
        # the icon has no small frame to give.
        icon = os.path.join(ROOT, "windows", "valkama.ico").replace("'", "''")
        reading = run_tray_functions(
            f"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = New-TrayIcon '{icon}'
@{{ chosen = $icon.Width; slot = [System.Windows.Forms.SystemInformation]::SmallIconSize.Width }} | ConvertTo-Json -Compress
""",
            app_path=os.path.join(tempfile.gettempdir(), "absent-valkama.exe"),
            launcher_directory=tempfile.gettempdir(),
        )
        self.assertEqual(reading["slot"], reading["chosen"])


BOARD = re.compile(r"\bboards?\b", re.IGNORECASE)


class ProductVoiceTests(unittest.TestCase):
    """The desktop surface calls the product Valkama.

    A tray item, window title or failure message names the workspace, while a
    board is one view of its work. The domain keeps the word for that view.
    """

    def test_no_desktop_surface_string_calls_the_product_a_board(self) -> None:
        offenders = []
        for path in (TRAY, MAIN_JS, DESKTOP_PACKAGE):
            with open(path, encoding="utf-8") as handle:
                for number, line in enumerate(handle, start=1):
                    if not BOARD.search(line):
                        continue
                    offenders.append(f"{os.path.relpath(path, ROOT)}:{number}: {line.strip()}")
        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
