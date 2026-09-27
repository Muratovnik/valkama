"""The MCP stdio loop: framing, protocol negotiation, dispatch and refusals.

`test_server.py` exercises the operations behind this surface. What was never
exercised is the surface itself -- the loop that reads a JSON-RPC message off
stdin and decides what to answer -- because in production it only ever runs as
a registered MCP server in another process.

That loop is where the byte-level decisions live: stdin is read as bytes so a
Windows console code page cannot mojibake a card title on its way into the
store, and stdout is written as bytes so a newline stays one character in a
newline-framed protocol. Both are invisible to every test that calls the
operations directly.

Every case runs against a throwaway store in a temporary home.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import mcp_surface, store
from server.ops import tray
from server.planning import service as planning_service
from server.platform import core as platform_core

SPACE_NAME = "Wire Surface"
SPACE_KEY = "WIR"

# Revision 2026-07-28 has no handshake: every request declares its own version
# here, so a helper is the difference between stating that once and repeating a
# reserved key in thirty places.
META = {"io.modelcontextprotocol/protocolVersion": mcp_surface.MODERN_PROTOCOL}


def params(**fields: object) -> dict:
    return {"_meta": META, **fields}


class Stdin:
    """Just enough of `sys.stdin` for the loop: a byte stream it iterates."""

    def __init__(self, payload: bytes) -> None:
        self.buffer = io.BytesIO(payload)


class Stdout:
    def __init__(self) -> None:
        self.buffer = io.BytesIO()


class McpSurfaceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(self.home.name, "valkama.sqlite3"),
                "USERPROFILE": self.home.name,
                "HOME": self.home.name,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning_service.create_planning_space(
            self.conn, project_id="mcp", name=SPACE_NAME, key=SPACE_KEY
        )
        self.conn.commit()

    def converse(self, *messages: dict | bytes) -> list[dict]:
        """Drive the loop over these messages and read back what it wrote.

        The tray and the improvements runtime are replaced: one competes for a
        machine-wide mutex and the other starts a thread, and neither has
        anything to do with what a request is answered with.
        """
        lines = [
            message if isinstance(message, bytes) else json.dumps(message).encode("utf-8")
            for message in messages
        ]
        stdout = Stdout()
        with (
            mock.patch.object(sys, "stdin", Stdin(b"\n".join(lines) + b"\n")),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.object(tray, "start", return_value=None),
            mock.patch.object(mcp_surface.watchers, "IMPROVEMENTS_RUNTIME"),
        ):
            mcp_surface.mcp_main()
        written = stdout.buffer.getvalue().decode("utf-8")
        return [json.loads(line) for line in written.splitlines() if line.strip()]

    def test_disabled_planning_and_improvements_tools_refuse_at_dispatch(self) -> None:
        platform = platform_core.Platform(self.conn, os.environ["VALKAMA_DB"])
        platform.module_state_command(
            {"module_id": "planning", "state": "disabled", "expected_revision": 1}
        )
        platform.module_state_command(
            {"module_id": "improvements", "state": "disabled", "expected_revision": 1}
        )
        for tool, arguments in (
            ("list_planning_spaces", {}),
            ("get_improvements_profile", {"scope": "personal"}),
        ):
            with self.subTest(tool=tool), self.assertRaises(platform_core.PlatformHttpError):
                mcp_surface.call_tool(self.conn, tool, arguments)

    def test_stdio_eof_stops_joins_and_closes_owned_runtime(self) -> None:
        runtime = mock.Mock()
        connection = mock.Mock()
        thread = mock.Mock()

        def start() -> None:
            thread._target(*thread._args)

        thread.start.side_effect = start

        def make_thread(*, target, args, daemon):
            self.assertTrue(daemon)
            thread._target = target
            thread._args = args
            return thread

        with (
            mock.patch.object(sys, "stdin", Stdin(b"")),
            mock.patch.object(mcp_surface, "connect", return_value=connection),
            mock.patch.object(tray, "start", return_value=None),
            mock.patch.object(mcp_surface.watchers, "IMPROVEMENTS_RUNTIME", runtime),
            mock.patch.object(mcp_surface.threading, "Thread", side_effect=make_thread),
        ):
            mcp_surface.mcp_main()

        runtime.run.assert_called_once_with(mcp_surface.db_path())
        runtime.stop.assert_called_once_with()
        thread.join.assert_called_once_with(timeout=2)
        connection.close.assert_called_once_with()

    def test_stdio_exception_still_tears_down_owned_runtime(self) -> None:
        class BrokenBuffer:
            def __iter__(self):
                return self

            def __next__(self):
                raise RuntimeError("stdin failed")

        runtime = mock.Mock()
        connection = mock.Mock()
        thread = mock.Mock()
        thread.start.side_effect = lambda: None
        broken_stdin = mock.Mock(buffer=BrokenBuffer())
        with (
            mock.patch.object(sys, "stdin", broken_stdin),
            mock.patch.object(mcp_surface, "connect", return_value=connection),
            mock.patch.object(tray, "start", return_value=None),
            mock.patch.object(mcp_surface.watchers, "IMPROVEMENTS_RUNTIME", runtime),
            mock.patch.object(mcp_surface.threading, "Thread", return_value=thread),
            self.assertRaisesRegex(RuntimeError, "stdin failed"),
        ):
            mcp_surface.mcp_main()

        runtime.stop.assert_called_once_with()
        thread.join.assert_called_once_with(timeout=2)
        connection.close.assert_called_once_with()


class DiscoveryTests(McpSurfaceTestCase):
    """`server/discover` is what replaced the handshake: one request, no session."""

    def discover(self, meta: dict | None = None) -> dict:
        body = {} if meta is None else {"_meta": meta}
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": body}
        )
        return answer

    def test_it_reports_the_versions_capabilities_and_identity(self) -> None:
        result = self.discover(META)["result"]
        self.assertEqual([mcp_surface.MODERN_PROTOCOL], result["supportedVersions"])
        self.assertEqual({"tools": {}}, result["capabilities"])
        info = result["_meta"]["io.modelcontextprotocol/serverInfo"]
        self.assertEqual("valkama", info["name"])

    def test_running_process_keeps_its_release_label(self) -> None:
        request = {"jsonrpc": "2.0", "method": "server/discover", "params": {"_meta": META}}
        with mock.patch.object(
            mcp_surface.static_assets,
            "release_version",
            side_effect=["1.0.2", "9.9.9"],
        ) as read_version:
            answers = self.converse({**request, "id": 1}, {**request, "id": 2})
        read_version.assert_called_once_with()
        labels = [
            answer["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["version"]
            for answer in answers
        ]
        self.assertEqual(labels[0], labels[1])
        self.assertTrue(labels[0].startswith("1.0.2+"))

    def test_the_instructions_tell_the_next_agent_how_the_board_is_used(self) -> None:
        result = self.discover(META)["result"]
        self.assertIn("claim_work_item before starting", result["instructions"])

    def test_it_answers_a_version_this_build_has_never_heard_of(self) -> None:
        # The one request that must not be refused over its version: discovery
        # is how a client finds out which versions exist, so refusing it for
        # asking would close the loop it exists to open.
        answer = self.discover({"io.modelcontextprotocol/protocolVersion": "1999-01-01"})
        self.assertEqual([mcp_surface.MODERN_PROTOCOL], answer["result"]["supportedVersions"])

    def test_it_answers_a_request_that_declares_no_version_at_all(self) -> None:
        self.assertIn("result", self.discover())


class ProtocolVersionTests(McpSurfaceTestCase):
    """Each request is accepted or refused on its own declared version."""

    def send(self, method: str = "tools/list", body: dict | None = None) -> dict:
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": body or {}}
        )
        return answer

    def test_the_current_version_is_served(self) -> None:
        self.assertIn("result", self.send(body=params()))

    def test_a_superseded_version_is_refused_with_what_this_build_speaks(self) -> None:
        error = self.send(
            body={"_meta": {"io.modelcontextprotocol/protocolVersion": "2025-11-25"}}
        )["error"]
        self.assertEqual(mcp_surface.UNSUPPORTED_PROTOCOL_VERSION, error["code"])
        self.assertEqual([mcp_surface.MODERN_PROTOCOL], error["data"]["supported"])
        self.assertEqual("2025-11-25", error["data"]["requested"])

    def test_a_request_that_declares_nothing_is_refused_rather_than_assumed(self) -> None:
        error = self.send()["error"]
        self.assertEqual(mcp_surface.UNSUPPORTED_PROTOCOL_VERSION, error["code"])
        self.assertIsNone(error["data"]["requested"])

    def test_a_wrong_version_notification_is_dropped_rather_than_answered(self) -> None:
        # There is no id to answer, and inventing one would be a reply to
        # something that was never a request.
        self.assertEqual([], self.converse({"jsonrpc": "2.0", "method": "tools/list"}))


class DualEraTests(McpSurfaceTestCase):
    """One process, two protocols, and the client picks which by how it opens.

    The specification provides for exactly this: one dual-era server answering
    both revisions, choosing by how the client opened. Claude Code turned out
    not to be the reason -- it opens with `server/discover` at the modern
    revision -- but no other client here has been measured, and a legacy one
    cannot fall forward. These cases hold both doors open until one is.
    """

    def handshake(self, wanted: str = "2025-06-18") -> dict:
        return {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": wanted},
        }

    def test_a_legacy_client_is_answered_in_the_version_it_asked_for(self) -> None:
        [answer] = self.converse(self.handshake())
        self.assertEqual("2025-06-18", answer["result"]["protocolVersion"])
        self.assertEqual("valkama", answer["result"]["serverInfo"]["name"])
        self.assertIn("claim_work_item before starting", answer["result"]["instructions"])

    def test_an_unknown_legacy_version_gets_the_newest_one_offered(self) -> None:
        [answer] = self.converse(self.handshake("1999-01-01"))
        self.assertEqual(mcp_surface.LEGACY_PROTOCOLS[0], answer["result"]["protocolVersion"])

    def test_after_the_handshake_requests_need_no_version_of_their_own(self) -> None:
        # The whole point of the era being a property of the process: a legacy
        # client never learned to put `_meta` on anything.
        answers = self.converse(
            self.handshake(),
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "list_planning_spaces", "arguments": {}},
            },
        )
        self.assertEqual([1, 2, 3], [answer["id"] for answer in answers])
        self.assertEqual(len(mcp_surface.catalogue()), len(answers[1]["result"]["tools"]))
        self.assertFalse(answers[2]["result"]["isError"])

    def test_without_a_handshake_the_same_request_is_refused(self) -> None:
        # Proves the previous case passes because of the handshake rather than
        # because the version is never really checked.
        [answer] = self.converse({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        self.assertEqual(mcp_surface.UNSUPPORTED_PROTOCOL_VERSION, answer["error"]["code"])

    def test_discovery_offers_only_the_version_a_request_may_declare(self) -> None:
        # The handshake revisions are reachable through `initialize`, not by
        # naming them in a modern request's `_meta`, so offering them here would
        # invite a client into a door that is not open.
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": params()}
        )
        self.assertEqual([mcp_surface.MODERN_PROTOCOL], answer["result"]["supportedVersions"])


class ResultEnvelopeTests(McpSurfaceTestCase):
    """The era decides the envelope, not just which requests are answered.

    This is the gap that made the board vanish from Claude Code a second time:
    the version check was right, the dispatch was right, and every answer was
    still refused because revision 2026-07-28 requires `resultType` on the base
    result. The connection stayed green while the tool list was thrown away, so
    only an assertion on the envelope itself can catch it.
    """

    def answer(self, method: str, body: dict | None = None) -> dict:
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params(**(body or {}))}
        )
        return answer["result"]

    def test_a_modern_tool_list_says_it_is_complete(self) -> None:
        self.assertEqual("complete", self.answer("tools/list")["resultType"])

    def test_a_modern_tool_call_says_it_is_complete(self) -> None:
        result = self.answer("tools/call", {"name": "list_planning_spaces", "arguments": {}})
        self.assertEqual("complete", result["resultType"])
        self.assertFalse(result["isError"])

    def test_the_two_results_a_client_may_keep_say_for_how_long(self) -> None:
        # Required on exactly these operations, and the client refuses the
        # answer without them. Both are the same constant of the build.
        for result in (self.answer("tools/list"), self.answer("server/discover")):
            self.assertGreater(result["ttlMs"], 0)
            self.assertEqual("public", result["cacheScope"])

    def test_a_tool_call_carries_no_caching_hints(self) -> None:
        # A call is not a cacheable operation, and hinting otherwise would
        # invite a client to serve a stale board back to itself.
        result = self.answer("tools/call", {"name": "list_planning_spaces", "arguments": {}})
        self.assertNotIn("ttlMs", result)
        self.assertNotIn("cacheScope", result)

    def test_a_modern_ping_says_it_is_complete(self) -> None:
        # An empty result is still a result, and the field is on the base type.
        self.assertEqual({"resultType": "complete"}, self.answer("ping"))

    def test_a_legacy_answer_carries_no_such_field(self) -> None:
        # Those revisions never defined it, and their clients are instructed to
        # read its absence as complete. Sending it would promise a vocabulary
        # the legacy client has no way to check.
        answers = self.converse(
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        )
        self.assertNotIn("resultType", answers[1]["result"])
        self.assertNotIn("ttlMs", answers[1]["result"])
        self.assertNotIn("cacheScope", answers[1]["result"])
        self.assertEqual({}, answers[2]["result"])


class DispatchTests(McpSurfaceTestCase):
    def call(self, name: str, arguments: dict | None = None, msg_id: int = 7) -> dict:
        message = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": "tools/call",
            "params": params(name=name),
        }
        if arguments is not None:
            message["params"]["arguments"] = arguments
        [answer] = self.converse(message)
        return answer["result"]

    def payload(self, result: dict) -> object:
        return json.loads(result["content"][0]["text"])

    def test_tools_list_answers_with_the_registered_tools(self) -> None:
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": params()}
        )
        names = {tool["name"] for tool in answer["result"]["tools"]}
        self.assertIn("create_work_item", names)
        self.assertEqual(len(mcp_surface.catalogue()), len(names))

    def test_a_tool_runs_and_returns_its_result_as_text(self) -> None:
        result = self.call("create_work_item", {"title": "through the wire", "space": SPACE_KEY})
        self.assertFalse(result["isError"])
        self.assertEqual("through the wire", self.payload(result)["title"])

    def test_a_missing_arguments_object_is_read_as_an_empty_one(self) -> None:
        # The client is allowed to omit it, and a None would reach the operation.
        result = self.call("list_planning_spaces")
        self.assertFalse(result["isError"])
        self.assertEqual(
            [SPACE_NAME],
            [entry["name"] for entry in self.payload(result)["planning_spaces"]],
        )

    def test_an_unknown_tool_is_an_error_result_rather_than_a_crash(self) -> None:
        result = self.call("no_such_tool")
        self.assertTrue(result["isError"])
        self.assertIn("unknown tool", result["content"][0]["text"])

    def test_a_refused_transition_answers_with_its_guard(self) -> None:
        # The one error shape a client is expected to read rather than display.
        item = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="not started")
        self.conn.commit()
        result = self.call("transition_work_item", {"id": item["reference"], "state": "dev"})
        self.assertTrue(result["isError"])
        self.assertEqual("workflow_guard", result["structuredContent"]["error"]["code"])
        self.assertIn("executor", result["structuredContent"]["error"]["message"])


class FramingTests(McpSurfaceTestCase):
    def test_a_blank_line_and_unparseable_bytes_are_skipped_not_answered(self) -> None:
        # A framing error is not a request, so there is no id to answer it with.
        answers = self.converse(
            b"",
            b"   ",
            b"{not json",
            b'{"jsonrpc":"2.0","id":3,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}',
        )
        self.assertEqual(
            [{"jsonrpc": "2.0", "id": 3, "result": {"resultType": "complete"}}], answers
        )

    def test_bytes_that_are_not_utf8_are_skipped_rather_than_decoded_wrongly(self) -> None:
        # Reading stdin as text on Windows would decode these by the console
        # code page and write the result into the store as a card title.
        answers = self.converse(
            b'{"jsonrpc":"2.0","id":4,"method":"ping","params":{"x":"\x8e\xe8"}}',
            b'{"jsonrpc":"2.0","id":5,"method":"ping","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}',
        )
        self.assertEqual([5], [answer["id"] for answer in answers])

    def test_a_parseable_frame_that_is_not_a_request_object_is_skipped(self) -> None:
        # These parse, so the JSON guard lets them through, and reaching `.get`
        # on a list ended the session for every request that would have
        # followed. The next request proves the loop is still serving.
        answers = self.converse(
            b"[]",
            b'"text"',
            b"42",
            b"null",
            {"jsonrpc": "2.0", "id": 9, "method": "ping", "params": params()},
        )
        self.assertEqual(
            [{"jsonrpc": "2.0", "id": 9, "result": {"resultType": "complete"}}], answers
        )

    def test_params_that_are_not_an_object_are_read_as_none_rather_than_crashing(self) -> None:
        # A request, unlike the frames above, so it is answered: with no version
        # to read there is nothing to accept it on, and the same holds one level
        # down when `_meta` itself is not an object.
        for body in ([], "text", 42, {"_meta": []}, {"_meta": "text"}):
            with self.subTest(params=body):
                answers = self.converse(
                    {"jsonrpc": "2.0", "id": 10, "method": "tools/list", "params": body},
                    {"jsonrpc": "2.0", "id": 11, "method": "ping", "params": params()},
                )
                self.assertEqual([10, 11], [answer["id"] for answer in answers])
                self.assertEqual(
                    mcp_surface.UNSUPPORTED_PROTOCOL_VERSION, answers[0]["error"]["code"]
                )
                self.assertEqual({"resultType": "complete"}, answers[1]["result"])

    def test_a_notification_gets_no_answer_but_a_request_does(self) -> None:
        answers = self.converse(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 6, "method": "resources/list", "params": params()},
        )
        self.assertEqual(1, len(answers))
        self.assertEqual(-32601, answers[0]["error"]["code"])

    def test_a_non_ascii_title_survives_the_round_trip(self) -> None:
        title = "карточка на кириллице"
        [answer] = self.converse(
            {
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": params(
                    name="create_work_item",
                    arguments={"title": title, "space": SPACE_KEY},
                ),
            }
        )
        written = json.loads(answer["result"]["content"][0]["text"])
        self.assertEqual(title, written["title"])
        # The item was written by the spawned process, so it is read back on a
        # connection opened after that commit rather than on this test's own.
        fresh = store.connect()
        try:
            self.assertEqual(
                title, planning_service.get_work_item(fresh, written["reference"])["title"]
            )
        finally:
            fresh.close()


class StaleBuildWarningTests(McpSurfaceTestCase):
    """A process that outlived its checkout says so on every answer it gives.

    The client spawned this process from a working tree and owns its lifetime,
    so it cannot replace itself when that tree moves. What it can do is refuse
    to let the drift pass unmentioned, on the answer it is handing back rather
    than in a log nobody reads.
    """

    def answer(
        self, drifted: bool, name: str = "list_planning_spaces", arguments: dict | None = None
    ):
        watch = mock.Mock()
        watch.drifted.return_value = drifted
        with mock.patch.object(mcp_surface.static_assets, "SourceWatch", return_value=watch):
            [answer] = self.converse(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": params(name=name, arguments=arguments or {}),
                }
            )
        return answer["result"]

    def test_discovery_names_the_build_so_two_servers_can_be_told_apart(self) -> None:
        watch = mock.Mock()
        watch.build_id = "abc123def456"
        with mock.patch.object(mcp_surface.static_assets, "SourceWatch", return_value=watch):
            [answer] = self.converse(
                {"jsonrpc": "2.0", "id": 1, "method": "server/discover", "params": params()}
            )
        info = answer["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]
        self.assertEqual("1.0.2+abc123def456", info["version"])

    def test_a_current_build_appends_nothing(self) -> None:
        result = self.answer(False)
        self.assertEqual(1, len(result["content"]))
        self.assertFalse(result["isError"])

    def test_a_stale_build_warns_and_still_puts_the_payload_first(self) -> None:
        result = self.answer(True)
        self.assertEqual(2, len(result["content"]))
        # content[0] stays the answer: callers parse it as the payload, and a
        # warning prepended there would break every one of them.
        json.loads(result["content"][0]["text"])
        self.assertIn("Restart", result["content"][1]["text"])
        self.assertFalse(result["isError"])

    def test_a_refused_call_carries_the_warning_too(self) -> None:
        # A guard refusal of a served tool, not an unknown name: the warning has
        # to survive the error path a working client actually reaches, and the
        # structured body it reads has to stay readable underneath it.
        item = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="not started")
        self.conn.commit()
        result = self.answer(
            True, "transition_work_item", {"id": item["reference"], "state": "dev"}
        )
        self.assertTrue(result["isError"])
        self.assertIn("Restart", result["content"][-1]["text"])
        self.assertEqual("workflow_guard", result["structuredContent"]["error"]["code"])


class TrayAssetTests(unittest.TestCase):
    """The two files the tray needs must exist where the surface looks for them.

    `tray.start` treats a missing script or icon as "this machine has no tray"
    and returns quietly, which is right for a machine without pwsh and wrong for
    a checkout that moved them. Nothing noticed for a day when a refactor left
    the paths pointing into `server/`, because every other test replaces
    `tray.start` outright. This one asserts the paths against the real files.
    """

    def test_the_tray_script_and_icon_resolve_to_files_that_exist(self) -> None:
        for path in tray.assets():
            self.assertTrue(os.path.isfile(path), f"tray asset is missing: {path}")


if __name__ == "__main__":
    unittest.main()
