from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli, launcher


class LauncherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "checkout" / "valkama.py"
        self.source.parent.mkdir()
        self.source.write_text(
            "import json, sys\nprint(json.dumps(sys.argv[1:]))\n",
            encoding="utf-8",
            newline="\n",
        )
        self.directory = self.root / "bin"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def install(self, *, platform_name: str | None = None):
        return launcher.install(
            self.directory,
            platform_name=platform_name or os.name,
            python=sys.executable,
            script=self.source,
        )

    def listener_owner(
        self,
        installed: dict[str, object],
        *,
        pid: int = 4321,
        command_line: str | None = None,
        executable_path: str | None = None,
        identity_token: str | None = None,
    ) -> dict[str, object]:
        python = str(installed["python"])
        shim = str(installed["shim"])
        return {
            "pid": pid,
            "command_line": command_line
            or subprocess.list2cmdline([python, shim, "serve", "--port", "8642"]),
            "executable_path": executable_path or python,
            "identity_token": identity_token or "creation-a",
        }

    def test_install_execute_status_and_uninstall_on_this_platform(self) -> None:
        installed = self.install()
        self.assertEqual(installed["state"], "installed")
        command = Path(str(installed["command"]))
        if os.name == "nt":
            argv = ["cmd.exe", "/d", "/c", str(command), "one", "два"]
        else:
            argv = [str(command), "one", "два"]
        result = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
        )
        output = result.stdout.decode("utf-8", errors="strict")
        self.assertEqual(result.returncode, 0, output)
        self.assertEqual(json.loads(output), ["one", "два"])
        self.assertEqual(launcher.status(self.directory)["state"], "installed")
        self.assertEqual(launcher.uninstall(self.directory)["state"], "missing")

    def test_command_wrapper_contains_no_checkout_path(self) -> None:
        for platform_name in ("nt", "posix"):
            with self.subTest(platform_name=platform_name):
                directory = self.root / platform_name
                launcher.install(
                    directory,
                    platform_name=platform_name,
                    python=sys.executable,
                    script=self.source,
                )
                command = directory / launcher.command_name(platform_name)
                shim = directory / launcher.SHIM_NAME
                self.assertNotIn(str(self.source), command.read_text(encoding="utf-8"))
                encoded_source = json.dumps(str(self.source), ensure_ascii=False)
                self.assertIn(encoded_source, shim.read_text(encoding="utf-8"))
                if platform_name == "posix" and os.name != "nt":
                    self.assertTrue(command.stat().st_mode & stat.S_IXUSR)

    def test_unmanaged_launcher_is_not_overwritten(self) -> None:
        self.directory.mkdir()
        command = self.directory / launcher.command_name()
        command.write_text("foreign\n", encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(launcher.LauncherError, "unmanaged"):
            self.install()
        self.assertEqual(command.read_text(encoding="utf-8"), "foreign\n")

    def test_drift_requires_force_for_install_and_uninstall(self) -> None:
        installed = self.install()
        command = Path(str(installed["command"]))
        command.write_text("changed\n", encoding="utf-8", newline="\n")
        self.assertEqual(launcher.status(self.directory)["state"], "drifted")
        with self.assertRaisesRegex(launcher.LauncherError, "drifted"):
            self.install()
        with self.assertRaisesRegex(launcher.LauncherError, "drifted"):
            launcher.uninstall(self.directory)
        self.assertEqual(
            launcher.install(
                self.directory,
                force=True,
                python=sys.executable,
                script=self.source,
            )["state"],
            "installed",
        )

    def test_missing_source_keeps_managed_ownership_but_reports_unavailable(self) -> None:
        self.install()
        self.source.unlink()
        state = launcher.status(self.directory)
        self.assertEqual(state["state"], "installed")
        self.assertFalse(state["source_available"])
        self.assertIn("source entry point is missing", str(state["detail"]))

    def test_checkout_move_keeps_the_stable_shim_as_listener_owner(self) -> None:
        installed = self.install(platform_name="nt")
        command = installed["command"]
        shim = str(installed["shim"])
        command_line = subprocess.list2cmdline([sys.executable, shim, "serve", "--port", "8642"])
        owner = self.listener_owner(installed, command_line=command_line)

        def reader(_port):
            return [owner]

        self.source.unlink()
        ownership_while_moved = launcher.listener_status(
            self.directory,
            platform_name="nt",
            process_reader=reader,
        )
        self.assertEqual("managed", ownership_while_moved["state"])
        self.assertEqual(owner["identity_token"], ownership_while_moved["process_identity"])
        self.assertEqual(owner["executable_path"], ownership_while_moved["executable_path"])

        moved = self.root / "moved-checkout" / "valkama.py"
        moved.parent.mkdir()
        moved.write_text("print('moved')\n", encoding="utf-8", newline="\n")

        reinstalled = launcher.install(
            self.directory,
            platform_name="nt",
            python=sys.executable,
            script=moved,
        )
        self.assertEqual(command, reinstalled["command"])
        self.assertEqual(shim, reinstalled["shim"])
        self.assertEqual(str(moved), reinstalled["source_script"])

        ownership = launcher.listener_status(
            self.directory,
            platform_name="nt",
            process_reader=reader,
        )
        self.assertEqual("managed", ownership["state"])
        stopped: list[int] = []
        result = launcher.stop_listener(
            self.directory,
            platform_name="nt",
            process_reader=reader,
            stopper=stopped.append,
        )
        self.assertEqual("stopped", result["state"])
        self.assertEqual([4321], stopped)

    def test_foreign_listener_is_refused_and_left_untouched(self) -> None:
        installed = self.install(platform_name="nt")
        direct_source = subprocess.list2cmdline(
            [sys.executable, str(self.source), "serve", "--port", "8642"]
        )
        impersonating_suffix = subprocess.list2cmdline(
            [sys.executable, f"{installed['shim']}.backup", "serve", "--port", "8642"]
        )
        mentioned_as_data = subprocess.list2cmdline([sys.executable, "-c", str(installed["shim"])])
        for command_line in (direct_source, impersonating_suffix, mentioned_as_data):
            with self.subTest(command_line=command_line):

                def reader(_port, line=command_line):
                    return [self.listener_owner(installed, pid=9876, command_line=line)]

                stopped: list[int] = []
                ownership = launcher.listener_status(
                    self.directory,
                    platform_name="nt",
                    process_reader=reader,
                )
                self.assertEqual("foreign", ownership["state"])
                result = launcher.stop_listener(
                    self.directory,
                    platform_name="nt",
                    process_reader=reader,
                    stopper=stopped.append,
                )
                self.assertEqual("refused", result["state"])
                self.assertEqual([], stopped)
                self.assertIn("left it untouched", str(result["detail"]))

    def test_foreign_executable_cannot_spoof_the_exact_managed_shim(self) -> None:
        installed = self.install(platform_name="nt")
        owner = self.listener_owner(
            installed,
            executable_path=str(self.root / "foreign-python.exe"),
        )

        def reader(_port):
            return [owner]

        ownership = launcher.listener_status(
            self.directory,
            platform_name="nt",
            process_reader=reader,
        )
        self.assertEqual("foreign", ownership["state"])
        stopped: list[int] = []
        result = launcher.stop_listener(
            self.directory,
            platform_name="nt",
            process_reader=reader,
            stopper=stopped.append,
        )
        self.assertEqual("refused", result["state"])
        self.assertEqual([], stopped)

    def test_windows_paths_use_ordinal_case_insensitive_semantics(self) -> None:
        self.assertTrue(
            launcher._same_windows_path(
                r"C:\Python\PYTHON.EXE",
                r"c:\python\python.exe",
            )
        )
        self.assertFalse(
            launcher._same_windows_path(
                r"C:\Straße\python.exe",
                r"C:\Strasse\python.exe",
            )
        )

    def test_windows_listener_inventory_uses_ascii_json_around_utf8_command_lines(self) -> None:
        command_line = 'python "C:\\Путь\\valkama-launcher.py" serve --port 8642'
        executable_path = "C:\\Путь\\python.exe"
        encoded_command = base64.b64encode(command_line.encode("utf-8")).decode("ascii")
        encoded_executable = base64.b64encode(executable_path.encode("utf-8")).decode("ascii")

        def runner(argv):
            self.assertEqual("powershell.exe", argv[0])
            self.assertEqual("8642", argv[-1])
            return mock.Mock(
                returncode=0,
                stdout=json.dumps(
                    [
                        {
                            "pid": 2468,
                            "command_line_utf8": encoded_command,
                            "executable_path_utf8": encoded_executable,
                            "identity_token": "creation-a",
                        }
                    ]
                ),
                stderr="",
            )

        self.assertEqual(
            [
                {
                    "pid": 2468,
                    "command_line": command_line,
                    "executable_path": executable_path,
                    "identity_token": "creation-a",
                }
            ],
            launcher._windows_listener_processes(8642, runner=runner),
        )

    def test_windows_listener_inventory_refuses_failed_or_malformed_queries(self) -> None:
        cases = (
            (mock.Mock(returncode=1, stdout="", stderr="failure"), "could not inspect"),
            (mock.Mock(returncode=0, stdout="not json", stderr=""), "malformed"),
            (mock.Mock(returncode=0, stdout='[{"pid": 1}]', stderr=""), "malformed"),
            (
                mock.Mock(
                    returncode=0,
                    stdout='[{"pid": true, "command_line_utf8": ""}]',
                    stderr="",
                ),
                "malformed",
            ),
        )
        for result, message in cases:
            with self.subTest(message=message):

                def runner(_argv, reading=result):
                    return reading

                with self.assertRaisesRegex(launcher.LauncherError, message):
                    launcher._windows_listener_processes(8642, runner=runner)

    def test_listener_lifecycle_validates_platform_port_and_exit_races(self) -> None:
        self.install(platform_name="nt")

        def no_processes(_port):
            return []

        with self.assertRaisesRegex(launcher.LauncherError, "invalid listener port"):
            launcher.listener_status(
                self.directory,
                port=0,
                platform_name="nt",
                process_reader=no_processes,
            )
        with self.assertRaisesRegex(launcher.LauncherError, "only on Windows"):
            launcher.listener_status(self.directory, platform_name="posix")

        free = launcher.stop_listener(
            self.directory,
            platform_name="nt",
            process_reader=no_processes,
        )
        self.assertEqual("free", free["state"])

        command_line = subprocess.list2cmdline(
            [sys.executable, str(self.directory / launcher.SHIM_NAME), "serve"]
        )
        installed = launcher.status(self.directory, platform_name="nt")
        owner = self.listener_owner(installed, command_line=command_line)

        def reader(_port):
            return [owner]

        def exited(_pid):
            raise ProcessLookupError

        self.assertEqual(
            "free",
            launcher.stop_listener(
                self.directory,
                platform_name="nt",
                process_reader=reader,
                stopper=exited,
            )["state"],
        )

        unsafe = launcher._classify_listener_processes(
            8642,
            sys.executable,
            self.directory / launcher.SHIM_NAME,
            [
                {
                    **owner,
                    "pid": 0,
                }
            ],
        )
        self.assertEqual("foreign", unsafe["state"])
        self.assertIn("left it untouched", str(unsafe["detail"]))

    def test_stop_rechecks_pid_executable_shim_and_creation_identity_under_a_handle(
        self,
    ) -> None:
        installed = self.install(platform_name="nt")
        original = self.listener_owner(installed)
        replacements = (
            (
                "pid reuse",
                {**original, "identity_token": "2026-08-27T20:01:00.0000000Z"},
                "refused",
            ),
            (
                "executable substitution",
                {**original, "executable_path": str(self.root / "foreign.exe")},
                "refused",
            ),
            (
                "shim substitution",
                {
                    **original,
                    "command_line": subprocess.list2cmdline(
                        [sys.executable, f"{installed['shim']}.backup", "serve"]
                    ),
                },
                "refused",
            ),
            ("malformed identity", {**original, "identity_token": ""}, "refused"),
            ("disappeared", None, "free"),
        )
        for label, replacement, expected in replacements:
            with self.subTest(label=label):
                readings = iter(([original], [] if replacement is None else [replacement]))

                def reader(_port, source=readings):
                    return next(source)

                held: list[int] = []

                @contextlib.contextmanager
                def guard(pid, seen=held):
                    seen.append(pid)
                    yield pid

                stopped: list[int] = []
                result = launcher.stop_listener(
                    self.directory,
                    platform_name="nt",
                    process_reader=reader,
                    process_guard=guard,
                    stopper=stopped.append,
                )
                self.assertEqual(expected, result["state"])
                self.assertEqual([4321], held)
                self.assertEqual([], stopped)

    def test_stop_terminates_only_through_the_held_verified_process_handle(self) -> None:
        installed = self.install(platform_name="nt")
        owner = self.listener_owner(installed)

        def reader(_port):
            return [owner]

        @contextlib.contextmanager
        def guard(pid):
            self.assertEqual(4321, pid)
            yield 7654

        stopped: list[int] = []
        result = launcher.stop_listener(
            self.directory,
            platform_name="nt",
            process_reader=reader,
            process_guard=guard,
            stopper=stopped.append,
        )
        self.assertEqual("stopped", result["state"])
        self.assertEqual([7654], stopped)

    def test_capabilities_and_status_are_json_and_status_does_not_create_store(self) -> None:
        home = self.root / "home"
        local = self.root / "local"
        home.mkdir()
        local.mkdir()
        environment = {
            "HOME": str(home),
            "USERPROFILE": str(home),
            "LOCALAPPDATA": str(local),
            # This test is often run after a suite that intentionally sets the
            # store override. Pinning it here makes the isolated status probe
            # independent of that caller's process environment.
            "VALKAMA_DB": str(self.root / "status.sqlite3"),
        }
        with mock.patch.dict(os.environ, environment, clear=False):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                cli.main(["capabilities"])
            capabilities = json.loads(output.getvalue())
            self.assertEqual(capabilities["component"], "valkama")
            self.assertGreater(capabilities["interfaces"]["mcp"]["tools"], 0)

            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                cli.main(["status", "--launcher-directory", str(self.directory)])
            status = json.loads(output.getvalue())
            self.assertEqual(status["component"], "valkama")
            self.assertFalse(status["database"]["exists"])
            self.assertEqual(status["launcher"]["state"], "missing")
            self.assertFalse((home / ".valkama").exists())

    def test_cli_launcher_round_trip(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(["launcher", "install", "--directory", str(self.directory)])
        installed = json.loads(output.getvalue())
        self.assertEqual(installed["state"], "installed")

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(["launcher", "status", "--directory", str(self.directory)])
        self.assertEqual(json.loads(output.getvalue())["state"], "installed")

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(["launcher", "uninstall", "--directory", str(self.directory)])
        self.assertEqual(json.loads(output.getvalue())["state"], "missing")

    def test_cli_launcher_listener_status_and_stop(self) -> None:
        results = (
            ("status", "managed", "listener_status"),
            ("stop", "stopped", "stop_listener"),
        )
        for action, state, function in results:
            with self.subTest(action=action):
                output = io.StringIO()
                with (
                    mock.patch.object(
                        launcher,
                        function,
                        return_value={"state": state, "port": 8765},
                    ) as called,
                    contextlib.redirect_stdout(output),
                ):
                    cli.main(
                        [
                            "launcher",
                            "listener",
                            action,
                            "--directory",
                            str(self.directory),
                            "--port",
                            "8765",
                        ]
                    )
                self.assertEqual(state, json.loads(output.getvalue())["state"])
                called.assert_called_once_with(str(self.directory), port=8765)


if __name__ == "__main__":
    unittest.main()
