"""The launcher's side of `serve --on-demand`: ownership, autostart and the release pin."""

from __future__ import annotations

import contextlib
import io
import json
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from server import cli, launcher
from tests import RunKeyDouble
from tests.test_launcher import commit, make_checkout

PORT = 8673
_FOREIGN_COMMAND = r'"C:\Tools\other.exe" --start'


class OnDemandCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.checkout = make_checkout(self.root / "checkout")
        self.directory = self.root / "bin"
        self.releases = self.root / "releases"
        self.python = self.make_interpreter(self.root / "python")
        store = mock.patch.object(launcher, "AUTOSTART_STORE", RunKeyDouble())
        self.run_key = store.start()
        self.addCleanup(store.stop)
        self.owners: list[dict[str, object]] = []
        self.stopped: list[int] = []
        self.spawned: list[list[str]] = []

    @staticmethod
    def make_interpreter(folder: Path) -> Path:
        folder.mkdir(parents=True)
        (folder / "pythonw.exe").write_bytes(b"")
        interpreter = folder / "python.exe"
        interpreter.write_bytes(b"")
        return interpreter

    def effects(self) -> launcher.ListenerEffects:
        def stop(pid: int) -> None:
            self.stopped.append(pid)
            self.owners.clear()

        def spawn(arguments: list[str], _directory: Path) -> int:
            self.spawned.append(arguments)
            return 5555

        return launcher.ListenerEffects(
            process_reader=lambda _port: list(self.owners),
            process_guard=lambda pid: contextlib.nullcontext(pid),
            stopper=stop,
            spawner=spawn,
            release_checks=1,
        )

    def install(self, *, python: Path | None = None) -> dict[str, object]:
        return launcher.install(
            self.directory,
            platform_name="nt",
            python=python or self.python,
            checkout=self.checkout,
            releases=self.releases,
            effects=self.effects(),
        )

    def uninstall(self) -> dict[str, object]:
        return launcher.uninstall(self.directory, platform_name="nt", effects=self.effects())

    def enable(self, **options) -> dict[str, object]:
        return launcher.enable_autostart(
            self.directory, port=PORT, platform_name="nt", effects=self.effects(), **options
        )

    def status(self) -> dict[str, object]:
        return launcher.autostart_status(self.directory, platform_name="nt")

    def listener(self, installed: dict[str, object], *arguments: str) -> None:
        """Something is on the port, started by the windowed Python with `arguments`."""

        windowed = str(Path(str(installed["python"])).parent / launcher.WINDOWED_PYTHON)
        self.owners[:] = [
            {
                "pid": 4321,
                "command_line": subprocess.list2cmdline(
                    [windowed, str(installed["shim"]), "serve", *arguments]
                ),
                "executable_path": windowed,
                "identity_token": "creation-a",
            }
        ]

    def expected_command(self, installed: dict[str, object], port: int = PORT) -> str:
        windowed = str(Path(str(installed["python"])).parent / launcher.WINDOWED_PYTHON)
        return subprocess.list2cmdline(
            [windowed, str(installed["shim"]), "serve", "--on-demand", "--port", str(port)]
        )


class SuiteIsolationTests(unittest.TestCase):
    def test_no_test_can_reach_the_real_run_key_through_the_module_default(self) -> None:
        self.assertIsInstance(launcher.AUTOSTART_STORE, RunKeyDouble)
        self.assertNotIsInstance(launcher.AUTOSTART_STORE, launcher.WindowsRunKey)


class WindowsRunKeyTests(unittest.TestCase):
    """The real key's calls, against a stand-in `winreg`; the machine's key stays unread."""

    def setUp(self) -> None:
        self.values: dict[tuple[str, str], tuple[str, int]] = {}
        opened: list[str] = []
        current_user = object()

        def open_key(hive, path, *_mode):
            self.assertIs(current_user, hive)
            opened.append(path)
            return contextlib.nullcontext()

        def query_value(_key, name):
            if (opened[-1], name) not in self.values:
                raise FileNotFoundError(name)
            return self.values[(opened[-1], name)]

        def set_value(_key, name, _reserved, kind, value):
            self.values[(opened[-1], name)] = (value, kind)

        def delete_value(_key, name):
            if (opened[-1], name) not in self.values:
                raise FileNotFoundError(name)
            del self.values[(opened[-1], name)]

        winreg = types.SimpleNamespace(
            HKEY_CURRENT_USER=current_user,
            KEY_SET_VALUE=2,
            REG_SZ=1,
            OpenKey=open_key,
            CreateKeyEx=open_key,
            QueryValueEx=query_value,
            SetValueEx=set_value,
            DeleteValue=delete_value,
        )
        patched = mock.patch.object(launcher.WindowsRunKey, "_winreg", staticmethod(lambda: winreg))
        patched.start()
        self.addCleanup(patched.stop)

    def test_one_string_value_under_the_current_users_run_key(self) -> None:
        run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
        store = launcher.WindowsRunKey()
        self.assertIsNone(store.read())
        store.write("the command")
        self.assertEqual({(run_key, "Valkama"): ("the command", 1)}, self.values)
        self.assertEqual("the command", store.read())
        store.delete()
        self.assertEqual({}, self.values)
        store.delete()  # already gone is not a failure


class OwnershipTests(OnDemandCase):
    def test_the_windowed_python_beside_the_recorded_one_is_the_same_listener(self) -> None:
        installed = self.install()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        reading = launcher.listener_status(
            self.directory,
            port=PORT,
            platform_name="nt",
            process_reader=lambda _port: list(self.owners),
        )
        self.assertEqual("managed", reading["state"])
        self.assertTrue(reading["on_demand"])

    def test_a_plain_serve_is_managed_but_not_on_demand(self) -> None:
        installed = self.install()
        self.listener(installed, "--port", str(PORT))
        reading = launcher.listener_status(
            self.directory,
            port=PORT,
            platform_name="nt",
            process_reader=lambda _port: list(self.owners),
        )
        self.assertEqual("managed", reading["state"])
        self.assertNotIn("on_demand", reading)

    def test_a_windowed_python_anywhere_else_is_foreign(self) -> None:
        installed = self.install()
        elsewhere = self.make_interpreter(self.root / "elsewhere").parent / "pythonw.exe"
        self.listener(installed, "--on-demand")
        self.owners[0]["executable_path"] = str(elsewhere)
        self.owners[0]["command_line"] = subprocess.list2cmdline(
            [str(elsewhere), str(installed["shim"]), "serve", "--on-demand"]
        )
        reading = launcher.listener_status(
            self.directory,
            port=PORT,
            platform_name="nt",
            process_reader=lambda _port: list(self.owners),
        )
        self.assertEqual("foreign", reading["state"])

    def test_a_flag_that_only_appears_in_the_python_path_does_not_count(self) -> None:
        self.assertFalse(
            launcher._names_on_demand(r'"C:\--on-demand\pythonw.exe" C:\shim.py serve')
        )
        self.assertTrue(launcher._names_on_demand(r"C:\pythonw.exe C:\shim.py serve --on-demand"))


class AutostartTests(OnDemandCase):
    def test_off_by_default_and_install_starts_nothing(self) -> None:
        installed = self.install()
        self.assertEqual("disabled", self.status()["state"])
        self.assertIsNone(self.run_key.command)
        self.assertEqual({"state": "none", "port": mock.ANY}, installed["on_demand_listener"])
        self.assertEqual([], self.spawned)

    def test_enable_writes_the_windowed_python_and_the_stable_shim_and_starts_it(self) -> None:
        installed = self.install()
        result = self.enable()
        self.assertEqual(self.expected_command(installed), self.run_key.command)
        self.assertIn("pythonw.exe", str(self.run_key.command))
        self.assertNotIn(str(self.releases), str(self.run_key.command))
        self.assertEqual("enabled", result["state"])
        self.assertEqual(PORT, result["port"])
        self.assertEqual({"state": "started", "pid": 5555}, result["listener"])
        self.assertEqual(1, len(self.spawned))
        self.assertEqual(self.run_key.command, subprocess.list2cmdline(self.spawned[0]))

    def test_enable_leaves_whatever_already_holds_the_port(self) -> None:
        installed = self.install()
        self.listener(installed, "--port", str(PORT))
        result = self.enable()
        self.assertEqual("enabled", result["state"])
        self.assertEqual("managed", result["listener"]["state"])
        self.assertEqual([], self.spawned)
        self.assertEqual([], self.stopped)

    def test_enable_needs_an_installed_launcher(self) -> None:
        with self.assertRaises(launcher.LauncherError):
            self.enable()
        self.assertIsNone(self.run_key.command)

    def test_enable_needs_the_windowed_python(self) -> None:
        self.install()
        (self.python.parent / "pythonw.exe").unlink()
        with self.assertRaisesRegex(launcher.LauncherError, "pythonw.exe is missing"):
            self.enable()
        self.assertIsNone(self.run_key.command)

    def test_a_value_of_this_launcher_that_drifted_reads_as_stale(self) -> None:
        installed = self.install()
        self.enable()
        self.run_key.command = self.expected_command(installed).replace("--on-demand", "--other")
        self.assertEqual("stale", self.status()["state"])

    def test_a_value_naming_another_program_is_not_this_launchers(self) -> None:
        self.install()
        self.run_key.command = _FOREIGN_COMMAND
        self.assertEqual("foreign", self.status()["state"])
        with self.assertRaisesRegex(launcher.LauncherError, "other.exe"):
            self.enable()
        with self.assertRaisesRegex(launcher.LauncherError, "other.exe"):
            launcher.disable_autostart(self.directory, platform_name="nt")
        self.assertEqual(_FOREIGN_COMMAND, self.run_key.command)
        self.enable(force=True)
        self.assertNotEqual(_FOREIGN_COMMAND, self.run_key.command)

    def test_disable_removes_the_value_and_leaves_a_running_listener(self) -> None:
        installed = self.install()
        self.enable()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        self.assertEqual(
            "disabled", launcher.disable_autostart(self.directory, platform_name="nt")["state"]
        )
        self.assertIsNone(self.run_key.command)
        self.assertEqual([], self.stopped)

    def test_it_is_a_windows_feature(self) -> None:
        self.assertEqual("unsupported", launcher.autostart_status(platform_name="posix")["state"])
        for action in (launcher.enable_autostart, launcher.disable_autostart):
            with self.assertRaisesRegex(launcher.LauncherError, "only on Windows"):
                action(platform_name="posix")

    def test_uninstall_removes_its_own_value(self) -> None:
        self.install()
        self.enable()
        self.uninstall()
        self.assertIsNone(self.run_key.command)

    def test_uninstall_leaves_a_value_naming_another_program(self) -> None:
        self.install()
        self.run_key.command = _FOREIGN_COMMAND
        self.uninstall()
        self.assertEqual(_FOREIGN_COMMAND, self.run_key.command)

    def test_uninstall_stops_the_listener_it_can_still_prove(self) -> None:
        installed = self.install()
        self.enable()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        self.uninstall()
        self.assertEqual([4321], self.stopped)


class InstallTests(OnDemandCase):
    def new_release(self) -> None:
        commit(self.checkout, "print('newer')\n", "newer")

    def test_a_listener_held_on_demand_restarts_from_the_new_release(self) -> None:
        installed = self.install()
        self.enable()
        self.spawned.clear()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        before = installed["source_script"]
        self.new_release()
        pinned_when_stopped: list[object] = []
        effects = self.effects()

        def stop(pid: int) -> None:
            pinned_when_stopped.append(launcher.status(self.directory, platform_name="nt"))
            effects.stopper(pid)

        result = launcher.install(
            self.directory,
            platform_name="nt",
            python=self.python,
            checkout=self.checkout,
            releases=self.releases,
            effects=effects._replace(stopper=stop),
        )
        self.assertEqual([4321], self.stopped)
        self.assertEqual(before, pinned_when_stopped[0]["source_script"])
        self.assertNotEqual(before, result["source_script"])
        self.assertEqual("restarted", result["on_demand_listener"]["state"])
        self.assertEqual(1, len(self.spawned))
        self.assertIn(str(installed["shim"]), self.spawned[0])
        self.assertIn("--on-demand", self.spawned[0])

    def test_a_foreign_listener_is_never_stopped(self) -> None:
        installed = self.install()
        self.enable()
        self.spawned.clear()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        other = self.make_interpreter(self.root / "other").parent / "pythonw.exe"
        self.owners[0] = {
            **self.owners[0],
            "executable_path": str(other),
            "command_line": subprocess.list2cmdline(
                [str(other), "their.py", "serve", "--on-demand"]
            ),
        }
        self.new_release()
        result = self.install()
        self.assertEqual([], self.stopped)
        self.assertEqual([], self.spawned)
        self.assertEqual("none", result["on_demand_listener"]["state"])
        self.assertEqual(1, len(self.owners))

    def test_a_plain_serve_is_left_running(self) -> None:
        installed = self.install()
        self.listener(installed, "--port", str(PORT))
        self.new_release()
        with mock.patch.dict("os.environ", {"VALKAMA_PORT": str(PORT)}):
            result = self.install()
        self.assertEqual([], self.stopped)
        self.assertEqual([], self.spawned)
        self.assertEqual("none", result["on_demand_listener"]["state"])

    def test_nothing_starts_when_autostart_is_off_and_nothing_was_running(self) -> None:
        self.install()
        self.new_release()
        result = self.install()
        self.assertEqual("none", result["on_demand_listener"]["state"])
        self.assertEqual([], self.spawned)

    def test_with_autostart_on_a_free_port_gets_a_listener_and_the_value_follows_python(
        self,
    ) -> None:
        self.install()
        self.enable()
        self.spawned.clear()
        moved = self.make_interpreter(self.root / "moved")
        self.new_release()
        result = self.install(python=moved)
        self.assertEqual("started", result["on_demand_listener"]["state"])
        self.assertIn(str(moved.parent), str(self.run_key.command))
        self.assertEqual("enabled", self.status()["state"])
        self.assertEqual(self.run_key.command, subprocess.list2cmdline(self.spawned[0]))

    def test_a_refused_stop_starts_no_second_listener(self) -> None:
        installed = self.install()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        self.new_release()
        effects = self.effects()

        def refuse(_pid: int) -> None:
            raise OSError("access denied")

        with mock.patch.dict("os.environ", {"VALKAMA_PORT": str(PORT)}):
            result = launcher.install(
                self.directory,
                platform_name="nt",
                python=self.python,
                checkout=self.checkout,
                releases=self.releases,
                effects=effects._replace(stopper=refuse),
            )
        self.assertEqual("installed", result["state"])
        self.assertEqual("refused", result["on_demand_listener"]["state"])
        self.assertEqual([], self.spawned)

    def test_an_install_that_cannot_write_still_brings_the_listener_back(self) -> None:
        """It stopped the listener before the write, and the address has to go on working."""

        installed = self.install()
        self.enable()
        self.spawned.clear()
        self.listener(installed, "--on-demand", "--port", str(PORT))
        self.new_release()
        with mock.patch.object(launcher, "_atomic_write", side_effect=PermissionError("held")):
            with self.assertRaises(PermissionError):
                self.install()
        self.assertEqual(1, len(self.stopped))
        self.assertEqual(1, len(self.spawned))

    def test_a_listener_that_cannot_start_does_not_fail_the_install(self) -> None:
        self.install()
        self.enable()
        (self.python.parent / "pythonw.exe").unlink()
        self.new_release()
        result = self.install()
        self.assertEqual("installed", result["state"])
        self.assertEqual("failed", result["on_demand_listener"]["state"])
        self.assertIn("pythonw.exe is missing", str(result["on_demand_listener"]["detail"]))


class CommandLineTests(unittest.TestCase):
    def run_command(self, function: str, *arguments: str) -> mock.Mock:
        output = io.StringIO()
        with (
            mock.patch.object(launcher, function, return_value={"state": "x"}) as called,
            contextlib.redirect_stdout(output),
        ):
            cli.main(["launcher", "autostart", *arguments])
        self.assertEqual("x", json.loads(output.getvalue())["state"])
        return called

    def test_each_action_reaches_the_launcher_with_its_options(self) -> None:
        self.run_command("autostart_status", "status", "--directory", "d").assert_called_once_with(
            "d"
        )
        self.run_command(
            "enable_autostart", "enable", "--directory", "d", "--port", "8673", "--force"
        ).assert_called_once_with("d", port=8673, force=True)
        self.run_command("disable_autostart", "disable").assert_called_once_with(None, force=False)

    def test_serve_on_demand_runs_the_holder_and_not_the_server(self) -> None:
        with (
            mock.patch.object(cli.on_demand, "run", return_value=0) as run,
            mock.patch.object(cli, "serve_main") as serve,
            self.assertRaises(SystemExit),
        ):
            cli.main(["serve", "--on-demand", "--port", "8673"])
        run.assert_called_once_with(8673, development_origin=None)
        serve.assert_not_called()


if __name__ == "__main__":
    unittest.main()
