"""The stdio front: switching releases under one client session.

Every backend here is a real child process -- `fixtures/fake_mcp_release.py`
copied into a release directory with a `fake.json` saying how it behaves --
so pipes, process exit and the process tree are the real ones. What is faked is
the release: it serves just enough MCP to be told apart and logs, one line per
event, when it started, answered and exited. The launcher manifest is replaced
by a pin the test sets, except in the tests of `ManifestPins` itself.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from server import launcher, mcp_front
from server.mcp_front import Front, ManifestPins, Pin

FAKE = Path(__file__).resolve().parent / "fixtures" / "fake_mcp_release.py"
MODERN = {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}
SUBSCRIPTION = "io.modelcontextprotocol/subscriptionId"


def alive(pid: int) -> bool:
    """Whether a process is still running, asked without signalling it."""

    if sys.platform == "win32":
        import _winapi

        try:
            handle = _winapi.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        except OSError:
            return False
        try:
            return _winapi.GetExitCodeProcess(handle) == 259  # STILL_ACTIVE
        finally:
            _winapi.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def wait_until(condition, *, seconds: float = 10.0) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return condition()


class FrontTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="valkama-front-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.log = self.root / "events.jsonl"
        self.log.touch()
        self.pin: Pin | None = None
        self.out = io.BytesIO()
        self.read = 0
        self.stderr: list[bytes] = []
        self.reports: list[str] = []
        self.ids = 0

    def release(self, name: str, **config: object) -> Pin:
        directory = self.root / "releases" / name
        directory.mkdir(parents=True)
        shutil.copyfile(FAKE, directory / "valkama.py")
        settings = {"name": name, "log": str(self.log), **config}
        (directory / "fake.json").write_text(json.dumps(settings), encoding="utf-8")
        return Pin(sys.executable, str(directory / "valkama.py"), name)

    def front(self, pin: Pin) -> Front:
        self.pin = pin
        front = Front(
            self.out,
            read_pin=lambda: self.pin,
            start_timeout=20.0,
            stop_timeout=1.0,
            echo=self.stderr.append,
            report=self.reports.append,
        )
        self.addCleanup(front.close)
        front.start(pin)
        return front

    def events(self, event: str | None = None, release: str | None = None) -> list[dict]:
        records = [json.loads(line) for line in self.log.read_text(encoding="utf-8").splitlines()]
        return [
            record
            for record in records
            if (event is None or record["event"] == event)
            and (release is None or record["release"] == release)
        ]

    def frames(self) -> list[dict]:
        """Every frame written to the client since the last call."""

        data = self.out.getvalue()
        fresh, self.read = data[self.read :], len(data)
        return [json.loads(line) for line in fresh.splitlines()]

    def send(self, front: Front, method: str, params: dict | None = None, **extra: object):
        self.ids += 1
        message = {"jsonrpc": "2.0", "id": self.ids, "method": method, **extra}
        if params is not None:
            message["params"] = params
        self.assertTrue(front.handle(json.dumps(message, ensure_ascii=False).encode() + b"\n"))
        return self.frames()

    def notify(self, front: Front, method: str, params: dict | None = None) -> list[dict]:
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self.assertTrue(front.handle(json.dumps(message).encode() + b"\n"))
        return self.frames()

    def call(self, front: Front, arguments: dict | None = None, *, modern: bool = True) -> dict:
        params: dict = {"name": "ping_tool", "arguments": arguments or {}}
        if modern:
            params.update(MODERN)
        (answer,) = [frame for frame in self.send(front, "tools/call", params) if "id" in frame]
        return answer

    @staticmethod
    def payload(answer: dict) -> dict:
        return json.loads(answer["result"]["content"][0]["text"])

    def switch(self, front: Front, pin: Pin) -> list[dict]:
        """Point the launcher at `pin` and let the front follow it, as the watcher does."""

        self.pin = pin
        with front._lock:
            front.follow_pin()
        return self.frames()


class SwitchTests(FrontTestCase):
    def test_a_switch_happens_between_requests_and_the_old_release_is_gone(self) -> None:
        old, new = self.release("old"), self.release("new")
        front = self.front(old)
        first = self.call(front)
        self.assertEqual("old", self.payload(first)["release"])
        old_pid = self.payload(first)["pid"]

        self.pin = new
        second = self.call(front)

        self.assertEqual("new", self.payload(second)["release"])
        self.assertFalse(alive(old_pid), "the old release still runs beside the new one")
        order = [(record["event"], record["release"]) for record in self.events()]
        self.assertLess(order.index(("exit", "old")), order.index(("start", "new")))

    def test_a_request_in_flight_finishes_on_the_backend_that_received_it(self) -> None:
        old, new = self.release("old"), self.release("new")
        front = self.front(old)
        gate = self.root / "gate"
        answers: list[dict] = []
        caller = threading.Thread(
            target=lambda: answers.append(self.call(front, {"wait_for": str(gate)}))
        )
        caller.start()
        self.assertTrue(wait_until(lambda: self.events("call-start", "old")))

        self.pin = new
        stop = threading.Event()
        watcher = threading.Thread(target=front.watch, args=(stop, 0.05))
        watcher.start()
        self.addCleanup(watcher.join)
        self.addCleanup(stop.set)
        time.sleep(0.5)
        self.assertEqual([], self.events("capabilities", "new"), "a switch began during a call")

        gate.touch()
        caller.join(timeout=20)
        self.assertTrue(wait_until(lambda: self.events("start", "new")))
        later = self.call(front)

        self.assertEqual(1, len(answers))
        self.assertEqual("old", self.payload(answers[0])["release"])
        self.assertEqual("new", self.payload(later)["release"])
        self.assertEqual(1, len(self.events("call-start", "old")), "the call was sent twice")
        order = [(record["event"], record["release"]) for record in self.events()]
        self.assertLess(order.index(("call-end", "old")), order.index(("exit", "old")))
        self.assertLess(order.index(("exit", "old")), order.index(("start", "new")))

    def test_a_legacy_client_is_replayed_to_the_next_release_and_hears_the_change(self) -> None:
        old = self.release("old", tools=["one"])
        new = self.release("new", tools=["one", "two"])
        front = self.front(old)
        handshake = {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "codex", "version": "0.166.0"},
        }
        (opened,) = self.send(front, "initialize", handshake)
        self.notify(front, "notifications/initialized")
        self.send(front, "tools/list")
        (refused,) = self.send(front, "subscriptions/listen", {"notifications": {}})

        frames = self.switch(front, new)

        self.assertTrue(opened["result"]["capabilities"]["tools"]["listChanged"])
        self.assertEqual(-32601, refused["error"]["code"], "the handshake era has no streams")
        self.assertEqual([{"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}], frames)
        (replayed,) = self.events("initialize", "new")
        self.assertEqual(handshake, replayed["params"])
        self.assertEqual(1, len(self.events("initialized", "new")))
        self.assertEqual("new", self.payload(self.call(front, modern=False))["release"])

    def test_the_same_tools_from_the_next_release_announce_nothing(self) -> None:
        front = self.front(self.release("old", tools=["one"]))
        self.send(front, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
        self.notify(front, "notifications/initialized")
        self.send(front, "tools/list")

        self.assertEqual([], self.switch(front, self.release("new", tools=["one"])))

    def test_a_modern_client_hears_a_change_only_on_a_stream_it_opened(self) -> None:
        front = self.front(self.release("a", tools=["one"]))
        (discovered,) = self.send(front, "server/discover")
        self.send(front, "tools/list", MODERN)

        unheard = self.switch(front, self.release("b", tools=["one", "two"]))
        (ack,) = self.send(
            front, "subscriptions/listen", {**MODERN, "notifications": {"toolsListChanged": True}}
        )
        heard = self.switch(front, self.release("c", tools=["one", "three"]))
        self.notify(
            front, "notifications/cancelled", {"requestId": ack["params"]["_meta"][SUBSCRIPTION]}
        )
        after_cancel = self.switch(front, self.release("d", tools=["four"]))

        self.assertTrue(discovered["result"]["capabilities"]["tools"]["listChanged"])
        self.assertEqual([], unheard)
        self.assertEqual("notifications/subscriptions/acknowledged", ack["method"])
        self.assertEqual(self.ids, ack["params"]["_meta"][SUBSCRIPTION])
        self.assertEqual({"toolsListChanged": True}, ack["params"]["notifications"])
        self.assertEqual(
            [
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/tools/list_changed",
                    "params": {"_meta": {SUBSCRIPTION: ack["params"]["_meta"][SUBSCRIPTION]}},
                }
            ],
            heard,
        )
        self.assertEqual([], after_cancel)

    def test_a_stream_that_asks_for_nothing_hears_nothing(self) -> None:
        front = self.front(self.release("a", tools=["one"]))
        self.send(front, "tools/list", MODERN)
        (ack,) = self.send(front, "subscriptions/listen", {**MODERN, "notifications": {}})

        self.assertEqual({}, ack["params"]["notifications"])
        self.assertEqual([], self.switch(front, self.release("b", tools=["two"])))

    def test_a_stream_naming_a_version_not_served_is_refused_with_what_is(self) -> None:
        front = self.front(self.release("a"))
        meta = {"_meta": {"io.modelcontextprotocol/protocolVersion": "1900-01-01"}}

        (refused,) = self.send(front, "subscriptions/listen", {**meta, "notifications": {}})

        self.assertEqual(-32022, refused["error"]["code"])
        self.assertEqual(
            {"supported": ["2026-07-28"], "requested": "1900-01-01"}, refused["error"]["data"]
        )

    def test_closing_answers_each_open_stream_as_complete(self) -> None:
        front = self.front(self.release("a"))
        lines = [
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": "listen:0",
                    "method": "subscriptions/listen",
                    "params": {**MODERN, "notifications": {"toolsListChanged": True}},
                }
            ).encode()
        ]

        self.assertEqual(0, front.serve(lines))

        ack, closed = self.frames()
        self.assertEqual("listen:0", ack["params"]["_meta"][SUBSCRIPTION])
        self.assertEqual(
            {
                "jsonrpc": "2.0",
                "id": "listen:0",
                "result": {"resultType": "complete", "_meta": {SUBSCRIPTION: "listen:0"}},
            },
            closed,
        )


class FailureTests(FrontTestCase):
    def test_a_release_that_will_not_run_leaves_the_old_backend_serving(self) -> None:
        front = self.front(self.release("good"))
        before = self.payload(self.call(front))["pid"]
        broken = self.release("broken", capabilities_exit=1)

        self.pin = broken
        warned = self.call(front)
        quiet = self.call(front)

        self.assertEqual(before, self.payload(warned)["pid"], "the working backend was replaced")
        self.assertEqual(2, len(warned["result"]["content"]))
        warning = warned["result"]["content"][1]["text"]
        self.assertTrue(warning.startswith("WARNING:"))
        self.assertIn("broken", warning)
        self.assertIn("cannot import its surfaces", warning)
        self.assertEqual(1, len(quiet["result"]["content"]), "the warning came twice")
        self.assertEqual([], self.events("start", "broken"))
        self.assertEqual(1, len(self.events("capabilities", "broken")), "retried the same pin")

    def test_the_failed_release_is_tried_again_once_the_launcher_names_another(self) -> None:
        front = self.front(self.release("good"))
        broken = self.release("broken", capabilities_exit=1)
        self.switch(front, broken)
        self.switch(front, self.release("next"))
        self.switch(front, broken)

        self.assertEqual("next", self.payload(self.call(front))["release"])
        self.assertEqual(2, len(self.events("capabilities", "broken")))

    def test_a_release_that_fails_to_start_brings_the_previous_one_back(self) -> None:
        front = self.front(self.release("good"))
        self.switch(front, self.release("crashing", exit_on_start=True))

        answer = self.call(front)

        self.assertEqual("good", self.payload(answer)["release"])
        self.assertIn("refused to start", answer["result"]["content"][1]["text"])
        order = [(record["event"], record["release"]) for record in self.events("start")]
        self.assertEqual([("start", "good"), ("start", "crashing"), ("start", "good")], order)

    def test_a_session_whose_first_release_does_not_start_never_opens(self) -> None:
        with self.assertRaisesRegex(mcp_front.BackendFailedError, "refused to start"):
            self.front(self.release("crashing", exit_on_start=True))

    def test_a_release_that_cannot_be_run_is_named_with_why(self) -> None:
        missing = Pin(str(self.root / "no-python.exe"), str(self.root / "valkama.py"), "gone")

        self.assertIn("could not be run", mcp_front.preflight(missing) or "")

    def test_an_old_release_never_writes_a_store_a_newer_one_migrated(self) -> None:
        store = self.root / "store.json"
        store.write_text(json.dumps({"schema": 1}), encoding="utf-8")
        old = self.release("old", store=str(store), schema=1)
        front = self.front(old)
        self.call(front)
        # Migrates the store as it opens it, and then dies before answering.
        newer = self.release("newer", store=str(store), schema=2, exit_on_start=True)

        self.pin = newer
        self.ids += 1
        lost = front.handle(
            json.dumps({"jsonrpc": "2.0", "id": self.ids, "method": "ping", **MODERN}).encode()
        )

        self.assertFalse(lost, "the session went on without a release that accepts the store")
        (answer,) = self.frames()
        self.assertEqual(self.ids, answer["id"])
        self.assertIn("store is at schema 2", answer["error"]["message"])
        self.assertEqual({"schema": 2}, json.loads(store.read_text(encoding="utf-8")))
        order = [(record["event"], record["release"]) for record in self.events()]
        self.assertIn(("refused", "old"), order)
        self.assertLess(order.index(("exit", "old")), order.index(("start", "newer")))
        self.assertLess(order.index(("crashed", "newer")), order.index(("refused", "old")))

    def test_a_backend_that_dies_mid_call_answers_the_call_and_ends_the_session(self) -> None:
        front = self.front(self.release("a"))
        message = {
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": {**MODERN, "name": "ping_tool", "arguments": {"exit": True}},
        }

        self.assertFalse(front.handle(json.dumps(message).encode()))

        (answer,) = self.frames()
        self.assertEqual(7, answer["id"])
        self.assertEqual(-32603, answer["error"]["code"])
        self.assertEqual(1, len(self.events("call-start")), "the call was sent again")


class TransportTests(FrontTestCase):
    def test_closing_the_session_stops_the_backend_and_everything_it_started(self) -> None:
        front = self.front(self.release("stubborn", ignore_eof=True, child=True))
        self.assertTrue(wait_until(lambda: self.events("child")))
        (spawned,) = self.events("child")
        backend = self.events("start")[0]["pid"]

        front.close()

        self.assertTrue(wait_until(lambda: not alive(backend)), "the backend outlived the front")
        self.assertTrue(
            wait_until(lambda: not alive(spawned["child"])), "the backend's child outlived it"
        )

    def test_stdout_carries_only_protocol_frames(self) -> None:
        front = self.front(self.release("noisy", junk=True))
        self.send(front, "server/discover")
        self.call(front)

        lines = self.out.getvalue().splitlines()
        self.assertEqual(2, len(lines))
        for line in lines:
            self.assertEqual("2.0", json.loads(line)["jsonrpc"])
        self.assertNotIn(b"not a protocol frame", self.out.getvalue())
        self.assertTrue(wait_until(lambda: b"noise on stderr\n" in self.stderr))
        self.assertTrue(any("not MCP" in report for report in self.reports))

    def test_identity_metadata_reaches_the_backend_byte_for_byte(self) -> None:
        front = self.front(self.release("a"))
        raw = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": "call-9",
                "method": "tools/call",
                "params": {
                    "_meta": {
                        **MODERN["_meta"],
                        "claudecode/toolUseId": "toolu_01",
                        "sessionId": "019a-session",
                    },
                    "name": "ping_tool",
                    "arguments": {
                        "title": "Задача → готово",
                        "_identity": {"session_id": "s-1", "tool_use_id": "toolu_01"},
                    },
                },
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        self.assertTrue(front.handle(raw + b"\n"))

        (answer,) = self.frames()
        self.assertEqual("call-9", answer["id"])
        self.assertEqual(raw.decode("utf-8") + "\n", self.payload(answer)["raw"])

    def test_a_client_answer_is_relayed_without_waiting_for_one_back(self) -> None:
        front = self.front(self.release("a"))

        self.assertTrue(front.handle(b'{"jsonrpc":"2.0","id":5,"result":{}}\n'))
        self.assertTrue(front.handle(b"not json\n"))

        self.assertEqual([], self.frames())
        self.assertEqual("a", self.payload(self.call(front))["release"])

    def test_a_backend_loses_the_launcher_and_the_tray(self) -> None:
        environment = mcp_front.backend_environment(
            {launcher.LAUNCHER_ENV: "C:/launcher", "PYTHONUTF8": "1"}
        )

        self.assertEqual({"PYTHONUTF8": "1", "VALKAMA_NO_TRAY": "1"}, environment)


class ManifestPinTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp(prefix="valkama-pins-"))
        self.addCleanup(shutil.rmtree, self.directory, ignore_errors=True)
        self.manifest = self.directory / launcher.MANIFEST_NAME
        self.manifest.write_text("{}", encoding="utf-8")
        self.status = {
            "state": "installed",
            "source_available": True,
            "python": "C:/Python/python.exe",
            "source_script": "C:/releases/abc/valkama.py",
            "revision": "abc",
        }

    def test_the_hashes_are_read_again_only_when_the_manifest_moves(self) -> None:
        pins = ManifestPins(self.directory)
        with mock.patch.object(launcher, "status", return_value=self.status) as status:
            first = pins()
            pins()
            self.manifest.write_text('{"moved": true}', encoding="utf-8")
            pins()

        self.assertEqual(Pin("C:/Python/python.exe", "C:/releases/abc/valkama.py", "abc"), first)
        self.assertEqual(2, status.call_count)

    def test_a_launcher_that_is_not_installed_names_nothing_to_follow(self) -> None:
        for change in ({"state": "drifted"}, {"source_available": False}, {"python": None}):
            with mock.patch.object(launcher, "status", return_value={**self.status, **change}):
                self.assertIsNone(ManifestPins(self.directory)(), change)
        with mock.patch.object(launcher, "status", side_effect=launcher.LauncherError("gone")):
            self.assertIsNone(ManifestPins(self.directory)())

    def test_a_process_the_launcher_did_not_start_serves_in_process(self) -> None:
        with mock.patch.dict(os.environ, {launcher.LAUNCHER_ENV: ""}):
            self.assertIsNone(mcp_front.main())
        with (
            mock.patch.dict(os.environ, {launcher.LAUNCHER_ENV: str(self.directory)}),
            mock.patch.object(launcher, "pinned_source_reader", return_value=None),
        ):
            self.assertIsNone(mcp_front.main(), "a checkout run is not the pinned release")


if __name__ == "__main__":
    unittest.main()
