"""`serve --on-demand`: one process that holds the port and becomes the server on one socket."""

from __future__ import annotations

import ast
import http.client
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from server import launcher, on_demand, processes, store
from server.ops import configuration, doctor
from server.planning import service

ROOT = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _get(port: int, path: str = "/api/runtime", timeout: float = 60.0) -> tuple[int, str, bytes]:
    client = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        client.request("GET", path)
        response = client.getresponse()
        return response.status, response.getheader("Content-Type") or "", response.read()
    finally:
        client.close()


def _log_file(home: Path) -> Path:
    """Where the log of a process with this home and `LOCALAPPDATA` beneath it is."""

    if os.name == "nt":
        return home / "local" / "Valkama" / "on-demand.log"
    return home / ".local" / "share" / "valkama" / "on-demand.log"


def _wait_for_log(home: Path, text: str, *, seconds: float = 30.0) -> str:
    """Until the process has said `text`. A probe of the port would race its bind."""

    log = _log_file(home)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if log.exists():
            written = log.read_text(encoding="utf-8")
            if text in written:
                return written
        time.sleep(0.02)
    raise AssertionError(f"never logged {text!r}: {log.exists() and log.read_text('utf-8')}")


class AgreementTests(unittest.TestCase):
    """What this module spells itself, because importing the owner is what it avoids."""

    def test_its_constants_are_their_owners(self) -> None:
        self.assertEqual(configuration.DEFAULT_LISTENER_PORT, on_demand.DEFAULT_PORT)
        self.assertEqual(launcher.LAUNCHER_ENV, on_demand._LAUNCHER_ENV)
        self.assertEqual(launcher.MANIFEST_NAME, on_demand._MANIFEST_NAME)

    def test_only_its_exact_command_line_is_answered_here(self) -> None:
        with mock.patch.object(on_demand, "run", return_value=0) as run:
            self.assertEqual(0, on_demand.main(["--on-demand"]))
            run.assert_called_with(on_demand.DEFAULT_PORT)
            self.assertEqual(0, on_demand.main(["--on-demand", "--port", "8673"]))
            run.assert_called_with(8673)
            self.assertEqual(0, on_demand.main(["--port=8673", "--on-demand"]))
            run.assert_called_with(8673)
            run.reset_mock()
            for refused in (
                ["--on-demand", "--port"],
                ["--on-demand", "--port", "x"],
                ["--on-demand", "--development-origin", "http://127.0.0.1:5173"],
                ["--on-demand", "--on-demand"],
            ):
                self.assertIsNone(on_demand.main(refused), refused)
            run.assert_not_called()


class LogTests(unittest.TestCase):
    """The file is the only witness at login, so losing a line to tidiness is the worst outcome."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        environment = mock.patch.dict(
            os.environ,
            {
                "USERPROFILE": directory.name,
                "HOME": directory.name,
                "LOCALAPPDATA": str(self.home / "local"),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop("XDG_DATA_HOME", None)

    def test_it_stays_out_of_the_stores_home_and_beside_the_launchers_files(self) -> None:
        on_demand._log("said")
        self.assertIn("said", _log_file(self.home).read_text(encoding="utf-8"))
        self.assertFalse((self.home / ".valkama").exists())
        self.assertEqual(launcher.default_releases().parent, Path(on_demand.log_path()).parent)

    def test_a_long_log_moves_aside(self) -> None:
        log = _log_file(self.home)
        log.parent.mkdir(parents=True)
        log.write_bytes(b"x" * (on_demand._MAX_LOG_BYTES + 1))
        on_demand._log("after")
        self.assertEqual(
            on_demand._MAX_LOG_BYTES + 1, log.with_name(f"{log.name}.1").stat().st_size
        )
        self.assertIn("after", log.read_text(encoding="utf-8"))

    def test_a_log_that_cannot_move_still_takes_the_line(self) -> None:
        """Under `pythonw.exe` the server's stderr holds it open, and Windows refuses the move."""

        log = _log_file(self.home)
        log.parent.mkdir(parents=True)
        log.write_bytes(b"x" * (on_demand._MAX_LOG_BYTES + 1))
        with mock.patch("os.replace", side_effect=PermissionError("held")):
            on_demand._log("kept")
        self.assertIn("kept", log.read_text(encoding="utf-8"))


class RealProcessTests(unittest.TestCase):
    """The entry point as the shim runs it, with a throwaway home and store."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        self.imports = self.home / "imports.log"
        self.port = _free_port()
        self.environment = {
            **os.environ,
            "USERPROFILE": str(self.home),
            "HOME": str(self.home),
            "LOCALAPPDATA": str(self.home / "local"),
            "VALKAMA_DB": str(self.home / "store.sqlite3"),
            "VALKAMA_NO_TRAY": "1",
        }
        self.environment.pop(launcher.LAUNCHER_ENV, None)

    def start(self) -> subprocess.Popen:
        # `-X importtime` writes each module as it is imported, which is the record of
        # what the process has loaded at any moment without connecting to it.
        with self.imports.open("wb") as stream:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-X",
                    "importtime",
                    str(ROOT / "valkama.py"),
                    "serve",
                    "--on-demand",
                    "--port",
                    str(self.port),
                ],
                stdout=subprocess.DEVNULL,
                stderr=stream,
                env=self.environment,
                cwd=self.home,
            )
        self.addCleanup(process.wait)
        self.addCleanup(process.kill)
        return process

    def loaded(self) -> str:
        return self.imports.read_text(encoding="utf-8", errors="replace")

    def test_a_store_under_an_earlier_name_is_adopted_with_this_process_first(self) -> None:
        """A home made for this process would read as a store already adopted: an empty board."""

        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.home / "seed" / "hub.sqlite3")}):
            (self.home / "seed").mkdir()
            conn = store.connect()
            service.create_planning_space(conn, project_id="old", name="Old", key="OLD")
            service.create_work_item(conn, space="OLD", title="A card from before the rename")
            conn.commit()
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn.close()
        (self.home / "seed").rename(self.home / ".agent-hub")
        del self.environment["VALKAMA_DB"]

        process = self.start()
        _wait_for_log(self.home, f"holding port {self.port}")
        self.assertFalse((self.home / ".valkama").exists())
        self.assertEqual(200, _get(self.port)[0])

        self.assertFalse((self.home / ".agent-hub").exists())
        adopted = self.home / ".valkama" / "valkama.sqlite3"
        reader = sqlite3.connect(f"file:{adopted.as_posix()}?mode=ro", uri=True)
        self.addCleanup(reader.close)
        titles = [row[0] for row in reader.execute("SELECT title FROM work_items")]
        self.assertEqual(["A card from before the rename"], titles)
        process.kill()

    def test_nothing_of_the_server_loads_until_the_first_connection(self) -> None:
        self.start()
        _wait_for_log(self.home, f"holding port {self.port}")
        time.sleep(0.2)
        before = self.loaded()
        self.assertIn("server.on_demand", before)
        for module in ("server.http_surface", "server.cli", "server.store", "server.launcher"):
            self.assertNotIn(module, before)

        status, kind, body = _get(self.port)
        self.assertEqual(200, status)
        self.assertIn("application/json", kind)
        self.assertIn("identity", json.loads(body))
        self.assertIn("server.http_surface", self.loaded())
        # It is now an ordinary server on the same socket, and the log says how long that took.
        self.assertEqual(200, _get(self.port)[0])
        _wait_for_log(self.home, "serving after")

    def test_every_connection_that_arrives_while_it_loads_is_answered(self) -> None:
        self.start()
        _wait_for_log(self.home, f"holding port {self.port}")
        answers: list[int] = []

        def ask() -> None:
            answers.append(_get(self.port)[0])

        threads = [threading.Thread(target=ask) for _ in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(90)
        self.assertEqual([200] * 5, answers)

    def test_a_taken_port_is_waited_for_and_its_holder_is_left_alone(self) -> None:
        holder = socket.socket()
        self.addCleanup(holder.close)
        holder.bind(("127.0.0.1", self.port))
        holder.listen(1)
        process = self.start()
        _wait_for_log(self.home, "is taken")
        self.assertIsNone(process.poll())
        client = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        client.close()
        accepted, _address = holder.accept()
        accepted.close()


class LoadFailureTests(unittest.TestCase):
    """The caller of a failed load gets an answer; the log gets the reason."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        environment = mock.patch.dict(
            os.environ,
            {
                "USERPROFILE": directory.name,
                "HOME": directory.name,
                "LOCALAPPDATA": str(self.home / "local"),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop(launcher.LAUNCHER_ENV, None)
        os.environ.pop("XDG_DATA_HOME", None)
        self.port = _free_port()

    def run_with(self, load: on_demand.Load) -> threading.Thread:
        """Hold the port in a thread; `load` ends it by serving one call and closing."""

        thread = threading.Thread(
            target=on_demand.run, args=(self.port,), kwargs={"load": load}, daemon=True
        )
        thread.start()
        self.addCleanup(thread.join, 10)
        _wait_for_log(self.home, f"holding port {self.port}")
        return thread

    def assert_told_it_failed(self) -> None:
        status, kind, body = _get(self.port)
        self.assertEqual(503, status)
        self.assertIn("text/html", kind)
        self.assertIn(b"on-demand.log", body)
        self.assertIn(b"Valkama did not start", body)

    @staticmethod
    def serve_one(listener: socket.socket) -> None:
        connection, _address = listener.accept()
        with connection:
            connection.recv(65536)
            connection.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        listener.close()

    def test_every_way_a_load_can_fail_answers_the_caller_and_logs_the_reason(self) -> None:
        for failure in (
            ImportError("no module named the server"),
            SystemExit("the store is too new"),
            ValueError("store refused"),
        ):
            with self.subTest(failure=failure):
                self.port = _free_port()
                attempts: list[int] = []

                def fails_once(
                    listener: socket.socket,
                    _port: int,
                    _origin: str | None,
                    reason: BaseException = failure,
                    attempts: list[int] = attempts,
                ) -> None:
                    attempts.append(1)
                    if len(attempts) == 1:
                        raise reason
                    self.serve_one(listener)

                with mock.patch.object(on_demand, "RELOAD_AFTER_SECONDS", 0.0):
                    thread = self.run_with(fails_once)
                    self.assert_told_it_failed()
                    self.assertIn(str(failure), _wait_for_log(self.home, str(failure)))
                    self.assertEqual(200, _get(self.port)[0])
                    thread.join(10)
                self.assertFalse(thread.is_alive())

    def test_a_load_is_tried_again_only_after_a_pause(self) -> None:
        attempts: list[int] = []

        def fails_once(listener: socket.socket, _port: int, _origin: str | None) -> None:
            attempts.append(1)
            if len(attempts) == 1:
                raise ValueError("not yet")
            self.serve_one(listener)

        with mock.patch.object(on_demand, "RELOAD_AFTER_SECONDS", 1.5):
            self.run_with(fails_once)
            self.assert_told_it_failed()
            self.assert_told_it_failed()  # within the pause: answered without another load
            self.assertEqual(1, len(attempts))
            time.sleep(1.6)
            self.assertEqual(200, _get(self.port)[0])
        self.assertEqual(2, len(attempts))

    def test_a_server_that_took_the_socket_and_died_ends_the_process(self) -> None:
        def dies(listener: socket.socket, _port: int, _origin: str | None) -> None:
            listener.close()
            raise RuntimeError("the server crashed")

        client: list[socket.socket] = []

        def connect() -> None:
            _wait_for_log(self.home, f"holding port {self.port}")
            client.append(socket.create_connection(("127.0.0.1", self.port), timeout=5))

        thread = threading.Thread(target=connect)
        thread.start()
        stderr = mock.patch.object(sys, "stderr", mock.Mock())
        with stderr:
            self.assertEqual(1, on_demand.run(self.port, load=dies))
        thread.join(10)
        client[0].close()


class FollowReleaseTests(unittest.TestCase):
    """A process of an older release must not go on to serve that release's code."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.directory = Path(directory.name)
        environment = mock.patch.dict(
            os.environ,
            {
                launcher.LAUNCHER_ENV: str(self.directory),
                "USERPROFILE": str(self.directory),
                "HOME": str(self.directory),
                "LOCALAPPDATA": str(self.directory / "local"),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)

    def name_release(self, source: str) -> None:
        (self.directory / on_demand._MANIFEST_NAME).write_text(
            json.dumps({"source_script": source}), encoding="utf-8"
        )

    def test_its_own_release_stays(self) -> None:
        self.name_release(on_demand._OWN_ENTRY)
        with mock.patch.object(launcher, "start_on_demand_listener") as start:
            self.assertFalse(on_demand._follow_release(8673))
        start.assert_not_called()

    def test_no_manifest_means_no_opinion(self) -> None:
        with mock.patch.object(launcher, "start_on_demand_listener") as start:
            self.assertFalse(on_demand._follow_release(8673))
        start.assert_not_called()

    def test_another_release_takes_over_on_the_first_connection(self) -> None:
        self.name_release(str(self.directory / "newer" / "valkama.py"))
        port = _free_port()
        load = mock.Mock()
        waking: list[socket.socket] = []

        def connect() -> None:
            _wait_for_log(self.directory, f"holding port {port}")
            waking.append(socket.create_connection(("127.0.0.1", port), timeout=5))

        thread = threading.Thread(target=connect)
        thread.start()
        with mock.patch.object(launcher, "start_on_demand_listener") as start:
            self.assertEqual(0, on_demand.run(port, load=load))
        thread.join(10)
        waking[0].close()
        load.assert_not_called()
        start.assert_called_once_with(str(self.directory), port)
        # The port is free for the release that took over.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))

    def test_a_process_waiting_for_a_taken_port_follows_too(self) -> None:
        self.name_release(str(self.directory / "newer" / "valkama.py"))
        holder = socket.socket()
        self.addCleanup(holder.close)
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        load = mock.Mock()
        with mock.patch.object(launcher, "start_on_demand_listener") as start:
            # In a thread: a process that never follows would wait for this port forever.
            thread = threading.Thread(
                target=on_demand.run,
                args=(holder.getsockname()[1],),
                kwargs={"load": load, "retry_seconds": 0.01},
                daemon=True,
            )
            thread.start()
            thread.join(10)
        self.assertFalse(thread.is_alive())
        load.assert_not_called()
        start.assert_called_once()


class ChildWindowTests(unittest.TestCase):
    """Under `pythonw.exe` a console child opens a window on the owner's screen unless told."""

    def test_every_child_the_server_starts_is_told_not_to_open_a_window(self) -> None:
        unguarded = []
        for path in sorted((ROOT / "server").rglob("*.py")):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in {"run", "Popen", "check_output", "check_call", "call"}
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "subprocess"
                    and not any(keyword.arg == "creationflags" for keyword in node.keywords)
                ):
                    unguarded.append(f"{path.relative_to(ROOT)}:{node.lineno}")
        self.assertEqual([], unguarded)

    def test_the_flag_is_the_one_windows_reads(self) -> None:
        self.assertEqual(0x08000000 if os.name == "nt" else 0, processes.NO_WINDOW)

    def test_a_captured_command_reaches_windows_with_it(self) -> None:
        with mock.patch.object(processes.subprocess, "run") as run:
            run.return_value = mock.Mock(returncode=0, stdout=b"", stderr=b"")
            processes.run_text(["git", "status"])
        self.assertEqual(processes.NO_WINDOW, run.call_args.kwargs["creationflags"])


class DoctorTests(unittest.TestCase):
    def test_one_line_says_whether_login_starts_the_listener(self) -> None:
        for state, status, code in (
            ("disabled", "ok", "autostart-off"),
            ("enabled", "ok", "autostart-on"),
            ("stale", "warn", "autostart-stale"),
            ("foreign", "warn", "autostart-foreign"),
        ):
            with (
                self.subTest(state=state),
                mock.patch.object(
                    launcher, "autostart_status", return_value={"state": state, "port": 8673}
                ),
            ):
                [check] = doctor._autostart_check()
                self.assertEqual(("autostart", status), (check["id"], check["status"]))
                self.assertEqual(code, check["presentation"]["code"])

    def test_a_platform_without_autostart_has_no_line(self) -> None:
        with mock.patch.object(
            launcher, "autostart_status", return_value={"state": "unsupported", "port": None}
        ):
            self.assertEqual([], doctor._autostart_check())

    def test_a_listener_still_loading_is_waited_for_not_called_absent(self) -> None:
        identity = {"identity": "abc"}
        answers: list[object] = [TimeoutError("still loading"), identity]
        timeouts: list[float] = []

        def read(_port: int, timeout: float) -> object:
            timeouts.append(timeout)
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

        with (
            mock.patch.object(doctor, "_read_listener_identity", read),
            mock.patch.object(
                launcher,
                "listener_status",
                return_value={"state": "managed", "on_demand": True},
            ),
        ):
            check = doctor._listener_check(8673, identity)
        self.assertEqual("ok", check["status"])
        self.assertEqual([doctor.PROBE_TIMEOUT, doctor.ON_DEMAND_LOAD_TIMEOUT], timeouts)

    def test_any_other_silent_port_is_reported_after_one_probe(self) -> None:
        timeouts: list[float] = []

        def read(_port: int, timeout: float) -> object:
            timeouts.append(timeout)
            raise TimeoutError("nothing there")

        with (
            mock.patch.object(doctor, "_read_listener_identity", read),
            mock.patch.object(launcher, "listener_status", return_value={"state": "free"}),
        ):
            check = doctor._listener_check(8673, {"identity": "abc"})
        self.assertEqual("warn", check["status"])
        self.assertEqual([doctor.PROBE_TIMEOUT], timeouts)


if __name__ == "__main__":
    unittest.main()
