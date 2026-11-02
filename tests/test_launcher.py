from __future__ import annotations

import contextlib
import io
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli, launcher, listener_owners, static_assets


def _refusal(winerror: int) -> PermissionError:
    """What a rename raises on Windows, on any platform these tests run on."""

    error = PermissionError(13, "Access is denied")
    error.winerror = winerror  # type: ignore[attr-defined]
    return error


ENTRY = "import json, sys\nprint(json.dumps(sys.argv[1:]))\n"


def git(checkout: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", *arguments], cwd=checkout, check=True, capture_output=True, text=True
    )
    return completed.stdout.strip()


def make_checkout(path: Path, body: str = ENTRY) -> Path:
    """A Git checkout with one commit holding a Valkama entry point."""

    path.mkdir(parents=True)
    for arguments in (
        ("init", "-q"),
        ("config", "user.email", "launcher@test"),
        ("config", "user.name", "launcher"),
    ):
        git(path, *arguments)
    commit(path, body, "seed")
    return path


def commit(checkout: Path, body: str, message: str) -> str:
    (checkout / "valkama.py").write_text(body, encoding="utf-8", newline="\n")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-qm", message)
    return git(checkout, "rev-parse", "HEAD")


class LauncherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.checkout = make_checkout(self.root / "checkout")
        self.source = self.checkout / "valkama.py"
        self.directory = self.root / "bin"
        self.releases = self.root / "releases"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def install(self, *, platform_name: str | None = None, **options):
        return launcher.install(
            self.directory,
            platform_name=platform_name or os.name,
            python=sys.executable,
            checkout=options.pop("checkout", self.checkout),
            releases=self.releases,
            **options,
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
                installed = launcher.install(
                    directory,
                    platform_name=platform_name,
                    python=sys.executable,
                    checkout=self.checkout,
                    releases=self.releases,
                )
                command = directory / launcher.command_name(platform_name)
                shim = directory / launcher.SHIM_NAME
                self.assertNotIn(str(self.checkout), command.read_text(encoding="utf-8"))
                self.assertNotIn(str(self.checkout), shim.read_text(encoding="utf-8"))
                encoded_source = json.dumps(str(installed["source_script"]), ensure_ascii=False)
                self.assertIn(encoded_source, shim.read_text(encoding="utf-8"))
                if platform_name == "posix" and os.name != "nt":
                    self.assertTrue(command.stat().st_mode & stat.S_IXUSR)

    def run_command(self, command: Path, *arguments: str) -> subprocess.CompletedProcess:
        if os.name == "nt":
            argv = ["cmd.exe", "/d", "/c", str(command), *arguments]
        else:
            argv = [str(command), *arguments]
        return subprocess.run(
            argv,
            input=b'{"session_id": "S", "hook_event_name": "Stop"}',
            capture_output=True,
            check=False,
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
        )

    def test_a_release_without_hooks_answers_a_hook_with_silence_and_exit_0(self) -> None:
        """Rolling back to a release from before `valkama hook` must not block a client.

        Such a release hands `hook` to its argument parser, which exits 2, and
        Claude Code reads exit 2 from a prompt or tool hook as "block".
        """

        refusing = "import sys\nprint('usage: unknown command', file=sys.stderr)\nsys.exit(2)\n"
        commit(self.checkout, refusing, "a release from before hooks")
        installed = self.install()
        command = Path(str(installed["command"]))
        for event in ("user-prompt-submit", "pre-tool-use", "stop"):
            with self.subTest(event=event):
                result = self.run_command(command, "hook", "claude", event)
                self.assertEqual((0, b""), (result.returncode, result.stdout), result.stderr)
        # Every other command still reaches that release.
        self.assertEqual(2, self.run_command(command, "serve").returncode)

    def test_a_release_with_hooks_still_receives_the_hook(self) -> None:
        hooks = self.checkout / "server" / "hooks"
        hooks.mkdir(parents=True)
        (hooks / "entry.py").write_text("", encoding="utf-8", newline="\n")
        commit(self.checkout, ENTRY, "a release with hooks")
        installed = self.install()
        result = self.run_command(Path(str(installed["command"])), "hook", "claude", "stop")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(["hook", "claude", "stop"], json.loads(result.stdout))

    def test_the_posix_command_hands_every_argument_to_the_shim(self) -> None:
        """The hook guard lives in the shim both commands run; the wrapper only forwards."""

        text, _mode = launcher._command_bytes("posix", Path(sys.executable))
        self.assertIn(f'"$SCRIPT_DIR/{launcher.SHIM_NAME}" "$@"', text.decode("utf-8"))
        shim = launcher._shim_bytes(Path("/releases/abc/valkama.py")).decode("utf-8")
        self.assertIn('sys.argv[1:2] == ["hook"]', shim)

    def test_clients_run_the_committed_tree_not_the_working_tree(self) -> None:
        head = git(self.checkout, "rev-parse", "HEAD")
        self.source.write_text("raise SystemExit('unfinished edit')\n", encoding="utf-8")
        installed = self.install()
        pinned = Path(str(installed["source_script"]))
        self.assertEqual(self.releases / head / "valkama.py", pinned)
        self.assertEqual(ENTRY, pinned.read_text(encoding="utf-8"))
        self.assertEqual(head, installed["revision"])
        self.assertEqual(str(self.checkout), installed["checkout"])

    def test_a_named_revision_is_pinned_and_the_previous_release_is_kept(self) -> None:
        first = git(self.checkout, "rev-parse", "HEAD")
        second = commit(self.checkout, "print('second')\n", "second")
        self.assertEqual(second, self.install()["revision"])
        rolled_back = self.install(revision=first)
        self.assertEqual(first, rolled_back["revision"])
        self.assertEqual(str(self.releases / first / "valkama.py"), rolled_back["source_script"])
        self.assertTrue((self.releases / second / "valkama.py").is_file())

    def test_a_holder_that_lets_go_of_the_unpacked_release_does_not_stop_it(self) -> None:
        """A scanner reading a tree just unpacked refused this rename on a real install."""

        real_rename = os.rename
        refusals = [_refusal(5), _refusal(32)]

        def rename(source: str, target: str) -> None:
            if refusals:
                raise refusals.pop(0)
            real_rename(source, target)

        with mock.patch("os.rename", rename), mock.patch("time.sleep"):
            installed = self.install()
        self.assertTrue(Path(str(installed["source_script"])).is_file())
        self.assertEqual([], refusals)

    def test_a_holder_that_stays_refuses_the_release_and_leaves_no_staging(self) -> None:
        with mock.patch("os.rename", side_effect=_refusal(5)), mock.patch("time.sleep"):
            with self.assertRaises(PermissionError):
                self.install()
        self.assertEqual([], list(self.releases.glob(".*")))

    def test_an_existing_release_is_reused_only_after_it_verifies(self) -> None:
        installed = self.install()
        pinned = Path(str(installed["source_script"]))
        # Running a release writes bytecode into it; that is not an edit.
        (pinned.parent / "__pycache__").mkdir()
        (pinned.parent / "__pycache__" / "valkama.cpython-311.pyc").write_bytes(b"\0")
        self.assertEqual(installed["source_script"], self.install()["source_script"])
        pinned.write_text("print('edited in place')\n", encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(launcher.LauncherError, "refusing to reuse"):
            self.install()
        self.assertEqual("print('edited in place')\n", pinned.read_text(encoding="utf-8"))

    def test_a_commit_without_an_entry_point_leaves_no_release_behind(self) -> None:
        (self.checkout / "README.md").write_text("kept\n", encoding="utf-8", newline="\n")
        git(self.checkout, "add", "README.md")
        git(self.checkout, "rm", "-q", "valkama.py")
        git(self.checkout, "commit", "-qm", "drop the entry point")
        self.source.write_text(ENTRY, encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(launcher.LauncherError, "no valkama.py"):
            self.install()
        self.assertEqual([], list(self.releases.iterdir()))
        self.assertEqual("missing", launcher.status(self.directory)["state"])

    def test_an_empty_commit_is_refused_with_a_reason(self) -> None:
        git(self.checkout, "rm", "-q", "valkama.py")
        git(self.checkout, "commit", "-qm", "empty the tree")
        self.source.write_text(ENTRY, encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(launcher.LauncherError, "could not be unpacked"):
            self.install()
        self.assertEqual([], list(self.releases.iterdir()))

    def test_only_the_root_of_a_git_checkout_can_be_pinned(self) -> None:
        nested = self.checkout / "nested"
        nested.mkdir()
        (nested / "valkama.py").write_text(ENTRY, encoding="utf-8", newline="\n")
        plain = self.root / "plain"
        plain.mkdir()
        (plain / "valkama.py").write_text(ENTRY, encoding="utf-8", newline="\n")
        for checkout, reason in ((nested, "not its root"), (self.root, "not a Valkama")):
            with self.subTest(checkout=checkout):
                with self.assertRaisesRegex(launcher.LauncherError, reason):
                    self.install(checkout=checkout)
        with self.assertRaises(launcher.LauncherError):
            self.install(checkout=plain)
        with self.assertRaisesRegex(launcher.LauncherError, "git could not read"):
            self.install(revision="no-such-revision")
        self.assertEqual("missing", launcher.status(self.directory)["state"])

    def test_a_release_installs_from_the_checkout_it_was_copied_from(self) -> None:
        installed = self.install()
        with mock.patch.object(
            launcher, "source_script", return_value=Path(str(installed["source_script"]))
        ):
            self.assertEqual(self.checkout, launcher.default_checkout())
        self.assertEqual(Path(launcher.__file__).resolve().parents[1], launcher.default_checkout())

    def test_a_pinned_process_learns_that_the_launcher_moved_on(self) -> None:
        first = git(self.checkout, "rev-parse", "HEAD")
        installed = self.install()
        pinned = Path(str(installed["source_script"]))
        environment = {launcher.LAUNCHER_ENV: str(self.directory)}
        with (
            mock.patch.dict(os.environ, environment),
            mock.patch.object(launcher, "source_script", return_value=pinned),
        ):
            reader = launcher.pinned_source_reader()
            self.assertIsNotNone(reader)
            assert reader is not None
            clock = [1000.0]
            watch = static_assets.SourceWatch(
                pinned.parent, interval=5.0, clock=lambda: clock[0], launched_from=reader
            )
            clock[0] += 60
            self.assertFalse(watch.drifted())
            commit(self.checkout, "print('next')\n", "next")
            self.install()
            self.assertNotEqual(str(pinned), reader())
            clock[0] += 60
            self.assertTrue(watch.drifted())
            self.install(revision=first)
            clock[0] += 60
            self.assertTrue(watch.drifted(), "drift is one-way even when the pin returns")
        with (
            mock.patch.dict(os.environ, environment),
            mock.patch.object(launcher, "source_script", return_value=self.source),
        ):
            self.assertIsNone(launcher.pinned_source_reader(), "a checkout run is not the pin")
        with mock.patch.dict(os.environ, {launcher.LAUNCHER_ENV: ""}):
            self.assertIsNone(launcher.pinned_source_reader())

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
        self.assertEqual(self.install(force=True)["state"], "installed")

    def test_missing_source_keeps_managed_ownership_but_reports_unavailable(self) -> None:
        installed = self.install()
        Path(str(installed["source_script"])).unlink()
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

        Path(str(installed["source_script"])).unlink()
        ownership_while_moved = launcher.listener_status(
            self.directory,
            platform_name="nt",
            process_reader=reader,
        )
        self.assertEqual("managed", ownership_while_moved["state"])
        self.assertEqual(owner["identity_token"], ownership_while_moved["process_identity"])
        self.assertEqual(owner["executable_path"], ownership_while_moved["executable_path"])

        moved = make_checkout(self.root / "moved-checkout", "print('moved')\n")

        reinstalled = self.install(platform_name="nt", checkout=moved)
        self.assertEqual(command, reinstalled["command"])
        self.assertEqual(shim, reinstalled["shim"])
        self.assertEqual(str(moved), reinstalled["checkout"])
        self.assertEqual(
            "print('moved')\n",
            Path(str(reinstalled["source_script"])).read_text(encoding="utf-8"),
        )

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

    def test_windows_listener_inventory_passes_each_owner_through_unchanged(self) -> None:
        owner = {
            "pid": 2468,
            "command_line": 'python "C:\\Путь\\valkama-launcher.py" serve --port 8642',
            "executable_path": "C:\\Путь\\python.exe",
            "identity_token": "creation-a",
        }
        # An unreadable owner arrives with blank fields; the inventory keeps the
        # blanks for the classifier, which treats them as unverifiable.
        unreadable = {"pid": 4, "command_line": "", "executable_path": "", "identity_token": ""}

        def query(port):
            self.assertEqual(8642, port)
            return [owner, unreadable]

        self.assertEqual(
            [owner, unreadable],
            launcher._windows_listener_processes(8642, query=query),
        )

    def test_windows_listener_inventory_refuses_failed_or_malformed_queries(self) -> None:
        def failing(_port):
            raise listener_owners.ListenerQueryError("GetExtendedTcpTable failed with error 5")

        with self.assertRaisesRegex(launcher.LauncherError, "could not inspect"):
            launcher._windows_listener_processes(8642, query=failing)
        for rows in (
            [{"pid": 1}],
            [{"pid": True, "command_line": "", "executable_path": "", "identity_token": ""}],
            [{"pid": 0, "command_line": "", "executable_path": "", "identity_token": ""}],
            [{"pid": 7, "command_line": None, "executable_path": "", "identity_token": ""}],
            ["not a row"],
        ):
            with self.subTest(rows=rows):

                def query(_port, reading=rows):
                    return reading

                with self.assertRaisesRegex(launcher.LauncherError, "malformed"):
                    launcher._windows_listener_processes(8642, query=query)

    @unittest.skipUnless(os.name == "nt", "the listener inventory reads Windows' TCP table")
    def test_windows_listener_inventory_finds_a_real_listener(self) -> None:
        # Some Windows builds report a listening socket's State as Closed or as no
        # state at all, so the inventory must not depend on State being Listen.
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            owners = launcher._windows_listener_processes(port)
        self.assertEqual([os.getpid()], [owner["pid"] for owner in owners])

    @unittest.skipUnless(os.name == "nt", "the listener inventory reads Windows' TCP table")
    def test_a_real_shim_listener_is_managed_and_stops_only_through_its_proof(self) -> None:
        # End to end on the live inventory: the managed shim really running, as
        # the desktop app and the tray start it, is proven managed, and the stop
        # that proof authorizes ends exactly that process. A virtual
        # environment's python.exe is a redirector to the base interpreter, so
        # the listener's image is the base one and the launcher must record it.
        interpreter = getattr(sys, "_base_executable", sys.executable)
        listening = (
            "import socket, sys, time\n"
            "s = socket.socket()\n"
            "s.bind(('127.0.0.1', int(sys.argv[-1])))\n"
            "s.listen()\n"
            "print('ready', flush=True)\n"
            "time.sleep(120)\n"
        )
        commit(self.checkout, listening, "listen")
        installed = launcher.install(
            self.directory,
            platform_name="nt",
            python=interpreter,
            checkout=self.checkout,
            releases=self.releases,
        )
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        child = subprocess.Popen(
            [interpreter, str(installed["shim"]), "serve", "--port", str(port)],
            stdout=subprocess.PIPE,
        )
        try:
            assert child.stdout is not None
            self.assertEqual(b"ready", child.stdout.readline().strip())
            ownership = launcher.listener_status(self.directory, port=port, platform_name="nt")
            self.assertEqual(("managed", child.pid), (ownership["state"], ownership["pid"]))
            stopped = launcher.stop_listener(self.directory, port=port, platform_name="nt")
            self.assertEqual(("stopped", child.pid), (stopped["state"], stopped["pid"]))
            self.assertEqual(1, child.wait(timeout=30))
            after = launcher.listener_status(self.directory, port=port, platform_name="nt")
            self.assertEqual("free", after["state"])
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=30)
            if child.stdout is not None:
                child.stdout.close()

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
            cli.main(
                [
                    "launcher",
                    "install",
                    "--directory",
                    str(self.directory),
                    "--checkout",
                    str(self.checkout),
                    "--releases",
                    str(self.releases),
                    "--revision",
                    "HEAD",
                ]
            )
        installed = json.loads(output.getvalue())
        self.assertEqual(installed["state"], "installed")
        self.assertEqual(git(self.checkout, "rev-parse", "HEAD"), installed["revision"])

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
