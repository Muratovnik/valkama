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
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from datetime import UTC, date, datetime, timedelta
from typing import ClassVar
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import housekeeping, mcp_surface, store, transcripts
from server.hooks import normalize, spool
from server.ops import configuration, tray
from server.planning import api as planning_api
from server.planning import calls as planning_calls
from server.planning import chain as planning_chain
from server.planning import model as planning_model
from server.planning import service as planning_service
from server.planning import tools as planning_tools
from tests.planning_fixtures import bulk_items

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

        The tray is replaced because its machine-wide mutex is unrelated to
        the response contract exercised here.
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
        ):
            mcp_surface.mcp_main()
        written = stdout.buffer.getvalue().decode("utf-8")
        return [json.loads(line) for line in written.splitlines() if line.strip()]

    def test_planning_tools_answer_and_retired_tools_stay_unknown(self) -> None:
        self.assertIn(
            "planning_spaces", mcp_surface.call_tool(self.conn, "list_planning_spaces", {})
        )
        with self.assertRaisesRegex(ValueError, "unknown tool"):
            mcp_surface.call_tool(self.conn, "get_improvements_profile", {})

    def test_stdio_eof_closes_the_owned_connection(self) -> None:
        connection = mock.Mock()
        with (
            mock.patch.object(sys, "stdin", Stdin(b"")),
            mock.patch.object(mcp_surface, "connect", return_value=connection),
            mock.patch.object(housekeeping, "start_up", return_value=[]),
            mock.patch.object(housekeeping, "start_sweep", return_value=None),
            mock.patch.object(tray, "start", return_value=None),
        ):
            mcp_surface.mcp_main()
        connection.close.assert_called_once_with()

    def test_stdio_exception_still_closes_the_owned_connection(self) -> None:
        connection = mock.Mock()
        with (
            mock.patch.object(mcp_surface, "connect", return_value=connection),
            mock.patch.object(housekeeping, "start_up", return_value=[]),
            mock.patch.object(housekeeping, "start_sweep", return_value=None),
            mock.patch.object(mcp_surface, "_mcp_loop", side_effect=RuntimeError("stdin failed")),
            self.assertRaisesRegex(RuntimeError, "stdin failed"),
        ):
            mcp_surface.mcp_main()
        connection.close.assert_called_once_with()


class StartUpMaintenanceTests(McpSurfaceTestCase):
    """What the start-up maintenance may never do: keep a client from its `initialize` answer."""

    INITIALIZE: ClassVar[dict] = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2025-06-18"},
    }

    def spool_directory(self) -> str:
        directory = spool.directory(store.db_path())
        os.makedirs(directory, exist_ok=True)
        return directory

    def start(self) -> tuple[list[dict], str]:
        stderr = io.StringIO()
        with mock.patch.object(sys, "stderr", stderr):
            answers = self.converse(self.INITIALIZE)
        return answers, stderr.getvalue()

    def test_malformed_spool_files_are_set_aside_and_the_server_still_starts(self) -> None:
        record = normalize.lifecycle_event(
            "claude",
            "stop",
            {"session_id": "S"},
            event_uid="00000000-0000-4000-8000-000000000001",
            occurred_at="2026-10-31T10:00:00.000Z",
        )
        assert record is not None
        good = json.loads(
            normalize.spool_line(record, spooled_at="2026-10-31T10:00:01.000Z", reason="busy")
        )
        directory = self.spool_directory()
        bodies = {
            "00000000000000000001-client.jsonl": json.dumps({**good, "client": ["x"]}).encode(),
            "00000000000000000002-hook.jsonl": json.dumps({**good, "hook_event": {}}).encode(),
            "00000000000000000003-garbage.jsonl": b"\x00\xff{not json\n[1, 2]\n",
        }
        for name, body in bodies.items():
            with open(os.path.join(directory, name), "wb") as handle:
                handle.write(body + b"\n")

        answers, _ = self.start()
        [answer] = answers
        self.assertEqual("2025-06-18", answer["result"]["protocolVersion"])
        self.assertEqual(
            sorted(name.removesuffix(".jsonl") + ".rejected" for name in bodies),
            sorted(os.listdir(directory)),
        )
        # And a second start finds nothing pending to trip over.
        self.assertEqual(1, len(self.start()[0]))

    def test_a_store_another_writer_holds_still_answers_initialize_within_seconds(self) -> None:
        """Before: the drain and the lease expiry each waited the full busy timeout."""

        record = normalize.lifecycle_event(
            "claude",
            "stop",
            {"session_id": "S"},
            event_uid="00000000-0000-4000-8000-000000000002",
            occurred_at="2026-10-31T10:00:00.000Z",
        )
        assert record is not None
        spool.write(
            self.spool_directory(),
            record,
            occurred_ns=1,
            spooled_at="2026-10-31T10:00:01.000Z",
            reason="busy",
        )
        holder = sqlite3.connect(store.db_path(), isolation_level=None)
        self.addCleanup(holder.close)
        real_connect = mcp_surface.connect

        def connect_then_lose_the_store() -> sqlite3.Connection:
            conn = real_connect()
            holder.execute("BEGIN EXCLUSIVE")
            return conn

        started = time.monotonic()
        with mock.patch.object(mcp_surface, "connect", side_effect=connect_then_lose_the_store):
            answers, stderr = self.start()
        elapsed = time.monotonic() - started
        holder.execute("ROLLBACK")
        self.assertEqual(1, len(answers))
        self.assertLess(elapsed, housekeeping.START_UP_SECONDS + 1.0)
        self.assertIn("hook spool drain stopped", stderr)
        # Nothing was lost: the event is still pending for the next start.
        self.assertEqual(1, len(spool.pending(self.spool_directory())))

    def test_initialize_does_not_wait_for_a_transcript_copy(self) -> None:
        source = os.path.join(self.home.name, "client-transcript.jsonl")
        with open(source, "wb") as handle:
            handle.write(b'{"type": "synthetic"}\n' * 64)
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, transcript_path) VALUES (?, 'session_end', 'confirmed', 'hook', ?, ?)",
            ("00000000-0000-4000-8000-000000000003", "S", source),
        )
        self.conn.commit()
        entered, release = threading.Event(), threading.Event()
        real_copy = transcripts.copy

        def slow_copy(*args: object, **kwargs: object) -> transcripts.Copy:
            entered.set()
            release.wait(10)
            return real_copy(*args, **kwargs)  # type: ignore[arg-type]

        with mock.patch.object(transcripts, "copy", side_effect=slow_copy):
            started = time.monotonic()
            answers, _ = self.start()
            elapsed = time.monotonic() - started
            release.set()
            for thread in threading.enumerate():
                if thread.name == housekeeping.SWEEP_THREAD:
                    thread.join(10)
        self.assertEqual(1, len(answers))
        self.assertLess(elapsed, 5.0)
        self.assertTrue(entered.is_set())
        self.assertEqual([], transcripts.pending(self.conn))
        [archived] = self.conn.execute(
            "SELECT archive_sha256 FROM execution_events WHERE kind = ?", (transcripts.ARCHIVED,)
        ).fetchall()
        self.assertTrue(archived[0])

    def test_an_unexpected_maintenance_failure_is_reported_and_the_server_still_starts(
        self,
    ) -> None:
        with mock.patch.object(
            housekeeping.ingest, "drain", side_effect=TypeError("unhashable type: 'list'")
        ):
            answers, stderr = self.start()
        self.assertEqual(1, len(answers))
        self.assertIn("unhashable type: 'list'", stderr)


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

    def test_human_request_tools_work_in_both_protocol_eras(self) -> None:
        item = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Need an answer")
        self.conn.commit()
        for legacy in (False, True):
            with self.subTest(legacy=legacy):

                def wire(method: str, body: dict, legacy: bool = legacy) -> dict:
                    message = {
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": method,
                        "params": body if legacy else params(**body),
                    }
                    messages = (
                        [
                            {
                                "jsonrpc": "2.0",
                                "id": 1,
                                "method": "initialize",
                                "params": {"protocolVersion": "2025-11-25"},
                            }
                        ]
                        if legacy
                        else []
                    )
                    return self.converse(*messages, message)[-1]["result"]

                catalogue = wire("tools/list", {})
                names = {tool["name"] for tool in catalogue["tools"]}
                self.assertTrue(
                    {
                        "create_work_item_request",
                        "get_work_item_request",
                        "list_work_item_requests",
                        "answer_work_item_request",
                        "decline_work_item_request",
                        "expire_work_item_request",
                    }
                    <= names
                )
                created = wire(
                    "tools/call",
                    {
                        "name": "create_work_item_request",
                        "arguments": {
                            "id": item["reference"],
                            "kind": "question",
                            "prompt": "Proceed?",
                            "fields": [
                                {
                                    "id": "proceed",
                                    "label": "Proceed",
                                    "type": "boolean",
                                    "required": True,
                                    "options": [],
                                }
                            ],
                        },
                    },
                )
                self.assertFalse(created["isError"], created)
                identity = self.payload(created)["request_id"]
                answered = wire(
                    "tools/call",
                    {
                        "name": "answer_work_item_request",
                        "arguments": {
                            "id": identity,
                            "expected_revision": 0,
                            "answers": {"proceed": False},
                        },
                    },
                )
                self.assertFalse(answered["isError"], answered)
                answer = self.payload(answered)
                self.assertEqual(
                    ("answered", 1, {"proceed": False}),
                    (answer["status"], answer["revision"], answer["answers"]),
                )

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

    def check_compact_json(self, text: str) -> None:
        """One line, no padding after separators, and still the same document."""

        self.assertEqual(
            json.dumps(json.loads(text), ensure_ascii=False, separators=(",", ":")), text
        )
        self.assertNotIn("\n", text)

    def test_every_kind_of_tool_result_is_serialized_without_indentation(self) -> None:
        item = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="кириллица", description="two\nlines"
        )
        bare = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="bare")
        self.conn.commit()
        reference = item["reference"]
        results = [
            self.call("get_work_item", {"id": reference}),
            self.call("list_work_items", {"space": SPACE_KEY}),
            self.call("list_platform_modules"),
            self.call("claim_work_item", {"id": reference, "author": "one"}),
            self.call("claim_work_item", {"id": reference, "author": "one", "verbose": True}),
            self.call("transition_work_item", {"id": bare["reference"], "state": "dev"}),
        ]
        self.assertFalse(any(result["isError"] for result in results[:-1]))
        self.assertTrue(results[-1]["isError"])
        for result in results:
            self.check_compact_json(result["content"][0]["text"])
        self.assertIn("кириллица", results[0]["content"][0]["text"])

    def test_a_write_answers_with_far_less_than_the_item_it_wrote(self) -> None:
        item = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="sized", description="d" * 400
        )
        planning_service.set_checklist(self.conn, item["reference"], ["one", "two", "three"])
        self.conn.commit()
        arguments = {"id": item["reference"], "author": "one"}
        short = self.call("claim_work_item", arguments)["content"][0]["text"]
        full = self.call("claim_work_item", {**arguments, "verbose": True})["content"][0]["text"]
        self.assertLess(len(short) * 2, len(full))

    def test_the_wire_answers_a_wrong_name_with_the_correction_not_a_key_error(self) -> None:
        reference = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Wire")[
            "reference"
        ]
        self.conn.commit()
        wrong = self.call("get_work_item", {"item": reference})
        self.assertTrue(wrong["isError"])
        self.assertIn("unknown argument 'item'", wrong["content"][0]["text"])
        self.assertIn("expected 'id'", wrong["content"][0]["text"])
        missing = self.call("get_planning_space", {})
        self.assertTrue(missing["isError"])
        self.assertNotIn("KeyError", missing["content"][0]["text"])
        self.assertIn("missing argument 'space'", missing["content"][0]["text"])
        synonym = self.call("get_work_item", {"reference": reference})
        self.assertFalse(synonym["isError"])
        self.assertEqual(reference, self.payload(synonym)["reference"])


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
    """A process that outlived its checkout says so, a few times in all.

    The client spawned this process from a working tree and owns its lifetime,
    so it cannot replace itself when that tree moves. What it can do is refuse
    to let the drift pass unmentioned, on the answer it is handing back rather
    than in a log nobody reads -- but not on every answer, because the agent
    keeps each copy in its context and pays for it on every later request.
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
        # The release number is pinned here so that a version bump is not a test change.
        with (
            mock.patch.object(mcp_surface.static_assets, "SourceWatch", return_value=watch),
            mock.patch.object(mcp_surface.static_assets, "release_version", return_value="1.0.2"),
        ):
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

    def test_the_next_answer_of_the_same_process_does_not_repeat_it(self) -> None:
        watch = mock.Mock()
        watch.drifted.return_value = True
        call = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": params(name="list_planning_spaces", arguments={}),
        }
        with mock.patch.object(mcp_surface.static_assets, "SourceWatch", return_value=watch):
            first, second = self.converse({**call, "id": 1}, {**call, "id": 2})
        self.assertEqual(2, len(first["result"]["content"]))
        self.assertEqual(1, len(second["result"]["content"]))

    def test_reminders_need_a_long_gap_and_stop_after_a_few(self) -> None:
        now = [0.0]
        notice = mcp_surface._StaleNotice(clock=lambda: now[0])
        seen = []
        for at in (0, 60, 1799, 1800, 1801, 3600, 7200, 86400):
            now[0] = float(at)
            seen.append(notice.due())
        self.assertEqual([True, False, False, True, False, True, False, False], seen)


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


class ToolArgumentTests(McpSurfaceTestCase):
    """What a caller whose tool schemas are out of view can still get right."""

    def setUp(self) -> None:
        super().setUp()
        self.first = self.call_tool("create_work_item", space=SPACE_KEY, title="First")["reference"]
        self.second = self.call_tool("create_work_item", space=SPACE_KEY, title="Second")[
            "reference"
        ]

    def call_tool(self, name: str, /, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments)
        assert isinstance(answer, dict)
        return answer

    def refusal(self, name: str, /, **arguments: object) -> str:
        with self.assertRaises(planning_api.PlanningHttpError) as caught:
            mcp_surface.call_tool(self.conn, name, arguments)
        self.assertEqual(400, caught.exception.status)
        return caught.exception.message

    def test_an_argument_refusal_reaches_the_client_with_its_code(self) -> None:
        """Through the real loop: the code a caller can branch on, not only text."""

        self.conn.commit()  # the loop opens its own connection
        cases = {
            "unknown argument": ("get_work_item", {"id": self.first, "colour": "red"}),
            "a limit that is not an integer": (
                "list_work_items",
                {"space": SPACE_KEY, "limit": "many"},
            ),
        }
        for name, (tool, arguments) in cases.items():
            with self.subTest(name):
                [answer] = self.converse(
                    {
                        "jsonrpc": "2.0",
                        "id": 7,
                        "method": "tools/call",
                        "params": params(name=tool, arguments=arguments),
                    }
                )
                result = answer["result"]
                self.assertTrue(result["isError"])
                error = result["structuredContent"]["error"]
                self.assertEqual("invalid_request", error["code"])
                self.assertEqual(error, json.loads(result["content"][0]["text"])["error"])

    def test_an_item_is_read_by_reference_or_ref_as_well_as_by_id(self) -> None:
        expected = self.call_tool("get_work_item", id=self.first)
        self.assertEqual(expected, self.call_tool("get_work_item", reference=self.first))
        self.assertEqual(expected, self.call_tool("get_work_item", ref=self.first))

    def test_the_item_synonyms_reach_every_tool_that_takes_an_id(self) -> None:
        claimed = self.call_tool("claim_work_item", reference=self.first, author="one")
        self.assertEqual("one", claimed["claim_ref"])
        commented = self.call_tool("comment_work_item", ref=self.first, body="a note")
        self.assertEqual(1, commented["comment_count"])

    def test_a_link_reads_from_to_target_and_type(self) -> None:
        linked = self.call_tool(
            "link_work_items", **{"from": self.first, "to": self.second, "type": "relates-to"}
        )
        self.assertEqual("relates-to", linked["kind"])
        self.assertFalse(linked["removed"])
        removed = self.call_tool(
            "link_work_items", id=self.first, target=self.second, kind="relates-to", remove=True
        )
        self.assertTrue(removed["removed"])

    def test_a_transition_reads_to_and_to_state(self) -> None:
        for synonym in ("to", "to_state"):
            with self.subTest(synonym):
                moved = self.call_tool("transition_work_item", id=self.first, **{synonym: "todo"})
                self.assertEqual("todo", moved["state"]["key"])
                self.call_tool("transition_work_item", id=self.first, state="backlog")

    def test_a_ref_is_the_value_to_attach_not_the_item(self) -> None:
        self.call_tool("attach_work_item_ref", id=self.first, kind="commit", ref="abc1234")
        refs = self.call_tool("get_work_item", id=self.first)["refs"]
        self.assertEqual(["abc1234"], [ref["value"] for ref in refs])
        # `reference` is still the item here, because `ref` is spoken for.
        self.call_tool("attach_work_item_ref", reference=self.second, kind="commit", value="d5678")
        self.assertEqual(1, len(self.call_tool("get_work_item", id=self.second)["refs"]))

    def test_a_space_is_read_from_planning_space_id(self) -> None:
        created = self.call_tool("create_work_item", planning_space_id=SPACE_KEY, title="Third")
        self.assertTrue(created["reference"].startswith(f"{SPACE_KEY}-"))
        listed = self.call_tool("list_work_items", planning_space_id=SPACE_KEY)["work_items"]
        self.assertEqual(3, len(listed))
        found = self.call_tool("search_work_items", query="Third", planning_space_id=SPACE_KEY)
        self.assertEqual([created["reference"]], [row["reference"] for row in found["work_items"]])
        space = self.call_tool("get_planning_space", planning_space_id=SPACE_KEY)
        self.assertEqual(SPACE_KEY, space["key"])

    def test_a_planning_space_is_also_read_by_id(self) -> None:
        self.assertEqual(SPACE_KEY, self.call_tool("get_planning_space", id=SPACE_KEY)["key"])

    def test_no_published_schema_advertises_a_synonym(self) -> None:
        for tool in mcp_surface.catalogue():
            for synonym in mcp_surface._SYNONYMS.get(tool["name"], {}):
                self.assertNotIn(synonym, tool["inputSchema"]["properties"], tool["name"])

    def test_a_synonym_and_its_canonical_name_with_different_values_are_refused(self) -> None:
        cases = (
            ("get_work_item", {"id": self.first, "reference": self.second}),
            ("get_work_item", {"ref": self.second, "id": self.first}),
            ("transition_work_item", {"id": self.first, "state": "todo", "to": "done"}),
            (
                "link_work_items",
                {"id": self.first, "from": self.second, "other": "x", "kind": "blocks"},
            ),
            (
                "link_work_items",
                {"id": self.first, "other": self.second, "to": "x", "kind": "blocks"},
            ),
            (
                "attach_work_item_ref",
                {"id": self.first, "kind": "commit", "value": "a", "ref": "b"},
            ),
            ("get_planning_space", {"space": SPACE_KEY, "id": "OTHER"}),
            ("create_work_item", {"space": SPACE_KEY, "planning_space_id": "OTHER", "title": "x"}),
        )
        for name, arguments in cases:
            with self.subTest(name, arguments=arguments):
                message = self.refusal(name, **arguments)
                self.assertTrue(message.startswith(f"{name}: "), message)
                self.assertIn("different values", message)
        self.assertEqual(2, len(self.call_tool("list_work_items", space=SPACE_KEY)["work_items"]))

    def test_two_synonyms_for_one_name_that_disagree_are_refused(self) -> None:
        message = self.refusal(
            "link_work_items", id=self.first, to=self.first, target=self.second, kind="blocks"
        )
        self.assertIn("different values", message)

    def test_a_synonym_given_beside_its_canonical_name_with_the_same_value_is_one_answer(
        self,
    ) -> None:
        expected = self.call_tool("get_work_item", id=self.first)
        self.assertEqual(
            expected, self.call_tool("get_work_item", id=self.first, reference=self.first)
        )

    def test_an_unknown_argument_is_named_with_what_the_tool_takes(self) -> None:
        self.assertEqual(
            "delete_work_item: unknown argument 'item'; expected 'id' (required: A work item,"
            " by its reference (MAIN-142) or its work_item_id)",
            self.refusal("delete_work_item", item=self.first),
        )
        message = self.refusal(
            "transition_work_item", id=self.first, state="todo", status="x", nope=1
        )
        self.assertTrue(
            message.startswith("transition_work_item: unknown arguments 'status', 'nope'; ")
        )
        self.assertIn("'id' (required), 'state' (required), 'reason'", message)

    def test_a_synonym_does_not_excuse_an_argument_the_tool_does_not_have(self) -> None:
        message = self.refusal("get_work_item", reference=self.first, bogus=1)
        self.assertIn("unknown argument 'bogus'", message)

    def test_a_tool_without_arguments_says_so(self) -> None:
        self.assertEqual(
            "list_planning_spaces: unknown argument 'space'; expected no arguments",
            self.refusal("list_planning_spaces", space=SPACE_KEY),
        )

    def test_a_missing_argument_is_named_and_is_not_a_key_error(self) -> None:
        message = self.refusal("get_planning_space")
        self.assertTrue(
            message.startswith("get_planning_space: missing argument 'space'; expected")
        )
        message = self.refusal("transition_work_item", id=self.first)
        self.assertTrue(message.startswith("transition_work_item: missing argument 'state'; "))
        self.assertIn(
            "link_work_items: missing arguments 'other', 'kind'",
            self.refusal("link_work_items", id=self.first),
        )

    def test_arguments_that_are_not_an_object_are_refused(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "arguments must be an object"):
            mcp_surface.call_tool(self.conn, "get_work_item", ["QA-1"])  # type: ignore[arg-type]

    def test_every_required_argument_is_checked_before_a_handler_reads_it(self) -> None:
        for tool in mcp_surface.catalogue():
            if tool["name"] not in mcp_surface._SCHEMAS:
                continue
            for required in tool["inputSchema"].get("required", []):
                with self.subTest(tool["name"], required=required):
                    arguments = {
                        name: "x" for name in tool["inputSchema"]["required"] if name != required
                    }
                    self.assertIn(
                        f"missing argument '{required}'", self.refusal(tool["name"], **arguments)
                    )


class CallIdentityTests(McpSurfaceTestCase):
    """Who made a write, as the wire call proved it.

    What clients send was recorded from the clients themselves: Codex puts the
    session in `_meta.sessionId` (and a subagent's own thread in `threadId`) on
    every call; Claude Code repeats the hook's `tool_use_id` as
    `_meta["claudecode/toolUseId"]`, and a `PreToolUse` hook adds `_identity`.
    """

    SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
    THREAD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
    TOOL_USE = "toolu_01ABCdefGHIjklMNOpqrSTU"

    def setUp(self) -> None:
        super().setUp()
        self.reference = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="Who holds it"
        )["reference"]
        self.conn.commit()

    def call(self, name: str, arguments: dict, meta: dict | None = None) -> dict:
        message = {
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": {"_meta": {**META, **(meta or {})}, "name": name, "arguments": arguments},
        }
        [answer] = self.converse(message)
        return answer["result"]

    def claim(self, meta: dict | None = None, **extra: object) -> dict:
        result = self.call("claim_work_item", {"id": self.reference, **extra}, meta)
        self.assertFalse(result["isError"], result)
        return result

    def event(self, action: str) -> dict:
        events = planning_service.get_work_item(self.conn, self.reference)["events"]
        [found] = [event for event in events if event["action"] == action]
        return found

    def calls(self) -> list[dict]:
        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM execution_events WHERE kind='planning_write' ORDER BY id"
            )
        ]

    def hook(self, **fields: str) -> dict:
        return {"session_id": self.SESSION, "tool_use_id": self.TOOL_USE, **fields}

    def test_a_codex_call_confirms_the_session_its_meta_names(self) -> None:
        self.claim({"sessionId": self.SESSION, "threadId": self.SESSION, "callId": "call_7"})
        self.assertEqual(
            {
                "state": "confirmed",
                "source": "codex-meta",
                "session_id": self.SESSION,
                "agent_id": None,
            },
            self.event("claimed")["identity"],
        )
        [row] = self.calls()
        self.assertEqual(
            ("claim_work_item", "call_7", "codex"),
            (row["tool"], row["tool_use_id"], row["client"]),
        )
        self.assertEqual(
            planning_service.get_work_item(self.conn, self.reference)["work_item_id"],
            row["work_item_id"],
        )

    def test_a_codex_subagent_is_named_by_its_own_thread(self) -> None:
        self.claim({"sessionId": self.SESSION, "threadId": self.THREAD})
        identity = self.event("claimed")["identity"]
        self.assertEqual(("confirmed", self.THREAD), (identity["state"], identity["agent_id"]))

    def test_a_codex_call_whose_identity_argument_disagrees_is_unconfirmed(self) -> None:
        self.claim(
            {"sessionId": self.SESSION},
            _identity=self.hook(session_id="someone-else"),
        )
        identity = self.event("claimed")["identity"]
        self.assertEqual(
            ("unconfirmed", "codex-meta-mismatch"), (identity["state"], identity["source"])
        )

    def test_a_claude_call_is_confirmed_when_the_hook_knew_the_tool_use_id(self) -> None:
        self.claim(
            {"claudecode/toolUseId": self.TOOL_USE},
            _identity=self.hook(agent_id="a1b2c3", agent_type="general-purpose"),
        )
        self.assertEqual(
            {
                "state": "confirmed",
                "source": "claude-hook",
                "session_id": self.SESSION,
                "agent_id": "a1b2c3",
            },
            self.event("claimed")["identity"],
        )
        [row] = self.calls()
        self.assertEqual(
            ("claude", self.TOOL_USE, "general-purpose"),
            (row["client"], row["tool_use_id"], row["agent_type"]),
        )

    def test_an_identity_with_another_tool_use_id_is_not_confirmed(self) -> None:
        # A model can type an `_identity`; it cannot know the id of the call it
        # is about to make. That is the whole of what separates the two.
        self.claim(
            {"claudecode/toolUseId": "toolu_the_real_one"},
            _identity=self.hook(),
        )
        identity = self.event("claimed")["identity"]
        self.assertEqual(
            ("unconfirmed", "claude-hook-mismatch"), (identity["state"], identity["source"])
        )

    def test_without_the_meta_key_the_hook_session_is_kept_but_not_confirmed(self) -> None:
        self.claim(_identity=self.hook())
        self.assertEqual(
            {
                "state": "unconfirmed",
                "source": "claude-hook-unverified",
                "session_id": self.SESSION,
                "agent_id": None,
            },
            self.event("claimed")["identity"],
        )

    def test_a_call_that_carries_nothing_is_unconfirmed_and_names_nobody(self) -> None:
        self.claim()
        self.assertEqual(
            {"state": "unconfirmed", "source": "mcp", "session_id": None, "agent_id": None},
            self.event("claimed")["identity"],
        )

    def test_the_author_text_and_the_server_environment_are_not_identity(self) -> None:
        with mock.patch.dict(os.environ, {"CLAUDE_CODE_SESSION_ID": self.SESSION}):
            self.claim(author=self.SESSION)
        self.assertEqual("unconfirmed", self.event("claimed")["identity"]["state"])

    def test_a_malformed_identity_is_dropped_and_the_call_still_runs(self) -> None:
        for malformed in (
            "session",
            {"session_id": self.SESSION},
            {"session_id": self.SESSION, "tool_use_id": 7},
            {**self.hook(), "agent_id": ["not", "text"]},
            {**self.hook(), "session_id": "s" * 201},
        ):
            with self.subTest(malformed=malformed):
                result = self.call(
                    "update_work_item",
                    {"id": self.reference, "title": "Still runs", "_identity": malformed},
                    {"claudecode/toolUseId": self.TOOL_USE},
                )
                self.assertFalse(result["isError"], result)
                self.assertEqual(("unconfirmed", "mcp", None), self.last_call())

    def last_call(self) -> tuple:
        row = self.calls()[-1]
        return row["identity_state"], row["identity_source"], row["session_id"]

    def test_the_identity_argument_is_taken_out_of_every_tool_before_its_schema(self) -> None:
        # The hook adds it to every call of this server, reads included; a
        # schema that refused it would fail them all.
        for name, arguments in (
            ("get_work_item", {"id": self.reference}),
            ("list_work_items", {"space": SPACE_KEY}),
            ("list_platform_modules", {}),
            ("comment_work_item", {"id": self.reference, "body": "Seen"}),
        ):
            with self.subTest(name):
                result = self.call(
                    name,
                    {**arguments, "_identity": self.hook()},
                    {"claudecode/toolUseId": self.TOOL_USE},
                )
                self.assertFalse(result["isError"], result)
                self.assertNotIn("_identity", result["content"][0]["text"])
        # Only the write is a call in the execution tree.
        self.assertEqual(["comment_work_item"], [row["tool"] for row in self.calls()])

    def test_no_published_schema_names_the_identity_argument(self) -> None:
        self.assertNotIn("_identity", json.dumps(mcp_surface.catalogue()))

    def test_a_refused_call_leaves_no_row(self) -> None:
        planning_service.claim_work_item(self.conn, self.reference, author="holder")
        self.conn.commit()
        result = self.call(
            "claim_work_item", {"id": self.reference, "author": "other"}, {"sessionId": "s"}
        )
        self.assertTrue(result["isError"])
        self.assertEqual([], self.calls())

    def test_every_row_a_call_writes_points_at_its_one_call(self) -> None:
        other = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Other")
        self.conn.commit()
        meta = {"sessionId": self.SESSION}
        for name, arguments in (
            ("update_work_item", {"id": self.reference, "title": "Edited"}),
            ("comment_work_item", {"id": self.reference, "body": "A note"}),
            ("attach_work_item_ref", {"id": self.reference, "kind": "url", "value": "https://x"}),
            (
                "link_work_items",
                {"id": self.reference, "other": other["reference"], "kind": "blocks"},
            ),
        ):
            self.assertFalse(self.call(name, arguments, meta)["isError"])
        rows = self.calls()
        self.assertEqual(
            ["update_work_item", "comment_work_item", "attach_work_item_ref", "link_work_items"],
            [row["tool"] for row in rows],
        )
        # An edit logs no event and is still a call, on the item it edited.
        item_id = planning_service.get_work_item(self.conn, self.reference)["work_item_id"]
        self.assertEqual(item_id, rows[0]["work_item_id"])
        pointers = {
            table: [row[0] for row in self.conn.execute(f"SELECT call_id FROM {table}")]
            for table in ("work_item_comments", "work_item_refs")
        }
        self.assertEqual(
            {"work_item_comments": [rows[1]["id"]], "work_item_refs": [rows[2]["id"]]}, pointers
        )
        # One link writes an event on each item, both of the one call.
        linked = self.conn.execute(
            "SELECT DISTINCT call_id FROM work_item_events WHERE action='linked'"
        ).fetchall()
        self.assertEqual([(rows[3]["id"],)], [tuple(row) for row in linked])

    def test_a_delete_is_a_call_that_outlives_its_item(self) -> None:
        item_id = planning_service.get_work_item(self.conn, self.reference)["work_item_id"]
        result = self.call("delete_work_item", {"id": self.reference}, {"sessionId": self.SESSION})
        self.assertFalse(result["isError"], result)
        [row] = self.calls()
        self.assertEqual(
            ("delete_work_item", item_id, "confirmed"),
            (row["tool"], row["work_item_id"], row["identity_state"]),
        )

    def test_an_event_written_before_identity_reads_as_unconfirmed(self) -> None:
        self.conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author)"
            " SELECT work_item_id,'released','','old-build' FROM work_items"
        )
        self.conn.commit()
        self.assertEqual(
            {"state": "unconfirmed", "source": None, "session_id": None, "agent_id": None},
            self.event("released")["identity"],
        )

    def test_a_handshake_client_names_the_client_of_its_calls(self) -> None:
        self.converse(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "clientInfo": {"name": "claude-code", "version": "2.1.304"},
                },
            },
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "_meta": {"claudecode/toolUseId": self.TOOL_USE},
                    "name": "claim_work_item",
                    "arguments": {"id": self.reference, "_identity": self.hook()},
                },
            },
        )
        [row] = self.calls()
        self.assertEqual(
            ("claude-code", "2.1.304", "confirmed"),
            (row["client"], row["client_version"], row["identity_state"]),
        )


class ListPagingTests(McpSurfaceTestCase):
    """A space larger than one page, read through the JSON-RPC loop an agent talks to."""

    def setUp(self) -> None:
        super().setUp()
        bulk_items(self.conn, SPACE_KEY, planning_service.MAX_LIST_PAGE + 1)

    def read(self, name: str, msg_id: int = 7, **arguments: object) -> dict:
        [answer] = self.converse(
            {
                "jsonrpc": "2.0",
                "id": msg_id,
                "method": "tools/call",
                "params": params(name=name, arguments=arguments),
            }
        )
        return answer["result"]

    def page(self, name: str, **arguments: object) -> dict:
        result = self.read(name, **arguments)
        self.assertFalse(result["isError"], result)
        return json.loads(result["content"][0]["text"])

    def every_reference(self, name: str, limit: int, **arguments: object) -> list[str]:
        seen: list[str] = []
        offset: int | None = 0
        while offset is not None:
            answer = self.page(name, limit=limit, offset=offset, **arguments)
            seen.extend(row["reference"] for row in answer["work_items"])
            offset = answer["next_offset"]
        return seen

    def stored_references(self) -> set[str]:
        return {
            f"{SPACE_KEY}-{row[0]}" for row in self.conn.execute("SELECT number FROM work_items")
        }

    def test_a_full_page_says_it_was_cut_and_where_the_rest_starts(self) -> None:
        cap = planning_service.MAX_LIST_PAGE
        first = self.page("list_work_items", space=SPACE_KEY, limit=cap)
        self.assertEqual(
            (cap, True, cap), (len(first["work_items"]), first["truncated"], first["next_offset"])
        )
        rest = self.page("list_work_items", space=SPACE_KEY, limit=cap, offset=cap)
        self.assertEqual(
            (1, False, None), (len(rest["work_items"]), rest["truncated"], rest["next_offset"])
        )
        # A limit above the page size is answered with one page, and says so.
        larger = self.page("list_work_items", space=SPACE_KEY, limit=cap * 5)
        self.assertEqual(
            (cap, True, cap),
            (len(larger["work_items"]), larger["truncated"], larger["next_offset"]),
        )

    def test_a_complete_page_is_not_reported_cut(self) -> None:
        self.conn.execute("DELETE FROM work_items WHERE number = 1")
        self.conn.commit()
        cap = planning_service.MAX_LIST_PAGE
        whole = self.page("list_work_items", space=SPACE_KEY, limit=cap)
        self.assertEqual(
            (cap, False, None), (len(whole["work_items"]), whole["truncated"], whole["next_offset"])
        )

    def test_paging_a_list_reads_every_item_exactly_once(self) -> None:
        for limit in (planning_service.MAX_LIST_PAGE, 333):
            with self.subTest(limit=limit):
                seen = self.every_reference("list_work_items", limit, space=SPACE_KEY)
                self.assertEqual(len(seen), len(set(seen)))
                self.assertEqual(self.stored_references(), set(seen))

    def test_paging_a_search_reads_every_match_exactly_once(self) -> None:
        cap = planning_service.MAX_SEARCH_PAGE
        first = self.page("search_work_items", query="Bulk", limit=cap)
        self.assertEqual(
            (cap, True, cap), (len(first["work_items"]), first["truncated"], first["next_offset"])
        )
        seen = self.every_reference("search_work_items", cap, query="Bulk")
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(self.stored_references(), set(seen))

    def test_an_offset_that_is_not_a_count_is_refused_as_invalid(self) -> None:
        for name, arguments in (
            ("list_work_items", {"space": SPACE_KEY}),
            ("search_work_items", {"query": "Bulk"}),
        ):
            for offset in (-1, "two", 1.5, True):
                with self.subTest(tool=name, offset=offset):
                    result = self.read(name, offset=offset, **arguments)
                    self.assertTrue(result["isError"])
                    error = result["structuredContent"]["error"]
                    self.assertEqual("invalid_request", error["code"])
                    self.assertIn("offset", error["message"])

    def test_a_call_without_offset_answers_the_first_compact_page(self) -> None:
        answer = self.page("list_work_items", space=SPACE_KEY)
        self.assertEqual(planning_tools.COMPACT_LIMIT, len(answer["work_items"]))
        self.assertTrue(answer["truncated"])
        self.assertEqual(planning_tools.COMPACT_LIMIT, answer["next_offset"])


class WireCallTestCase(McpSurfaceTestCase):
    """One tool call on the wire, with the `_meta` a client sends beside it."""

    SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"

    def call(self, name: str, arguments: dict, meta: dict | None = None) -> dict:
        message = {
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": {"_meta": {**META, **(meta or {})}, "name": name, "arguments": arguments},
        }
        [answer] = self.converse(message)
        return answer["result"]

    def answer(self, name: str, arguments: dict, meta: dict | None = None) -> dict:
        result = self.call(name, arguments, meta)
        self.assertFalse(result["isError"], result)
        payload = json.loads(result["content"][0]["text"])
        assert isinstance(payload, dict)
        return payload

    def refusal(self, name: str, arguments: dict, meta: dict | None = None) -> dict:
        result = self.call(name, arguments, meta)
        self.assertTrue(result["isError"], result)
        error = result["structuredContent"]["error"]
        assert isinstance(error, dict)
        return error

    def calls(self) -> list[dict]:
        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM execution_events WHERE kind='planning_write' ORDER BY id"
            )
        ]


class ApplyWorkItemChangesTests(WireCallTestCase):
    """Several writes to one item in one call: in a fixed order, and all or nothing."""

    def setUp(self) -> None:
        super().setUp()
        item = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Batched")
        self.reference = item["reference"]
        self.other = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Related")[
            "reference"
        ]
        steps = planning_service.set_checklist(self.conn, self.reference, ["one", "two"])
        self.steps = [step["id"] for step in steps["checklist"]]
        self.conn.commit()
        self.before = planning_service.get_work_item(self.conn, self.reference)

    def closing(self, **extra: object) -> dict:
        """Every group, ending in a transition the guards allow only after the rest."""

        return {
            "id": self.reference,
            "author": "one",
            "claim": True,
            "checklist_ticks": [{"item_id": self.steps[0]}, {"item_id": self.steps[1]}],
            "refs": [{"kind": "commit", "value": "abc1234", "label": "the change"}],
            "links": [{"other": self.other, "kind": "relates-to"}],
            "comment": {"body": "closing note", "checklist_item_id": self.steps[1]},
            "summary": {"done": "both steps", "next": "nothing"},
            "transition": {"state": "done"},
            **extra,
        }

    def assert_untouched(self) -> None:
        item = planning_service.get_work_item(self.conn, self.reference)
        self.assertEqual(self.before["revision"], item["revision"])
        self.assertEqual(self.before["events"], item["events"])
        self.assertEqual([], item["comments"])
        self.assertEqual([], item["refs"])
        self.assertEqual([], item["links"])
        self.assertEqual("", item["claim_ref"])
        self.assertEqual([False, False], [step["done"] for step in item["checklist"]])
        self.assertIsNone(item["summary"])
        self.assertEqual("backlog", item["state"]["key"])
        self.assertEqual([], self.calls())

    def test_a_closing_transition_lands_because_its_ticks_and_summary_come_first(self) -> None:
        # The same transition on its own is refused: the guards are live.
        alone = self.refusal("transition_work_item", {"id": self.reference, "state": "done"})
        self.assertEqual("workflow_guard", alone["code"])

        answer = self.answer("apply_work_item_changes", self.closing())

        self.assertEqual("done", answer["state"]["key"])
        # The claim started the item before the transition closed it.
        self.assertEqual({"from": "backlog", "to": "dev"}, answer["started"])
        # The close ended the claim the batch took, in the same call.
        self.assertEqual(("", None), (answer["claim_ref"], answer["claim_state"]))
        self.assertNotIn("events", answer)
        item = planning_service.get_work_item(self.conn, self.reference)
        self.assertEqual(item["revision"], answer["revision"])
        comment = next(entry for entry in item["comments"] if entry["kind"] == "comment")
        self.assertEqual(
            {
                "claim": True,
                "checklist_ticks": [
                    {"item_id": self.steps[0], "done": True},
                    {"item_id": self.steps[1], "done": True},
                ],
                "refs": 1,
                "links": 1,
                "comment": {
                    "comment_id": comment["id"],
                    "reply_to": None,
                    "reply_to_request": None,
                },
                "summary": {"summary_comment_id": item["summary_comment_id"]},
                "transition": {"state": "done", "released": "one"},
            },
            answer["applied"],
        )
        self.assertEqual([True, True], [step["done"] for step in item["checklist"]])
        self.assertEqual(["one", "one"], [step["done_by"] for step in item["checklist"]])
        self.assertEqual(
            [("commit", "abc1234", "the change")],
            [(ref["kind"], ref["value"], ref["label"]) for ref in item["refs"]],
        )
        self.assertEqual(
            [("relates-to", self.other)],
            [(link["kind"], link["reference"]) for link in item["links"]],
        )
        self.assertEqual(("closing note", "two"), (comment["body"], comment["checklist_item_text"]))
        self.assertEqual({"done": "both steps", "next": "nothing"}, item["summary"])
        # The history is the single tools' history, in the order the groups apply.
        self.assertEqual(
            [
                "claimed",
                "transitioned",
                "checklist_completed",
                "checklist_completed",
                "linked",
                "summarized",
                "transitioned",
                "released",
            ],
            [event["action"] for event in item["events"]][-8:],
        )

    def test_one_batch_is_one_call_and_every_row_points_at_it(self) -> None:
        self.answer("apply_work_item_changes", self.closing(), {"sessionId": self.SESSION})
        [row] = self.calls()
        item = planning_service.get_work_item(self.conn, self.reference)
        self.assertEqual(
            ("apply_work_item_changes", "confirmed", self.SESSION, item["work_item_id"]),
            (row["tool"], row["identity_state"], row["session_id"], row["work_item_id"]),
        )
        pointers = {
            found[0]
            for table in ("work_item_comments", "work_item_refs")
            for found in self.conn.execute(f"SELECT call_id FROM {table}")
        }
        # The setup's own writes ran outside any call.
        pointers |= {
            found[0]
            for found in self.conn.execute(
                "SELECT call_id FROM work_item_events"
                " WHERE action NOT IN ('created', 'checklist_replaced')"
            )
        }
        self.assertEqual({row["id"]}, pointers)
        self.assertEqual(
            {"confirmed"}, {event["identity"]["state"] for event in item["events"][-6:]}
        )

    def test_a_refused_step_writes_nothing_and_names_the_step_and_its_code(self) -> None:
        # The second step is left open, so the transition is the step refused,
        # after every other group already wrote inside the batch.
        arguments = self.closing(checklist_ticks=[{"item_id": self.steps[0]}])
        error = self.refusal("apply_work_item_changes", arguments, {"sessionId": self.SESSION})
        self.assertEqual("workflow_guard", error["code"])
        self.assertEqual({"group": "transition", "index": 0}, error["step"])
        self.assertTrue(error["message"].startswith("transition: [checklist]"), error["message"])
        self.assert_untouched()

    def test_a_refused_entry_of_a_list_is_named_by_its_index(self) -> None:
        unknown = self.steps[0][:-4] + ("beef" if not self.steps[0].endswith("beef") else "cafe")
        arguments = self.closing(checklist_ticks=[{"item_id": self.steps[0]}, {"item_id": unknown}])
        error = self.refusal("apply_work_item_changes", arguments)
        self.assertEqual("invalid_request", error["code"])
        self.assertEqual({"group": "checklist_ticks", "index": 1}, error["step"])
        self.assertTrue(error["message"].startswith("checklist_ticks[1]: "), error["message"])
        self.assert_untouched()

    def test_a_claim_somebody_else_holds_refuses_the_whole_batch(self) -> None:
        planning_service.claim_work_item(self.conn, self.reference, author="holder")
        self.conn.commit()
        held = planning_service.get_work_item(self.conn, self.reference)
        error = self.refusal(
            "apply_work_item_changes",
            {"id": self.reference, "author": "other", "claim": True, "comment": {"body": "x"}},
        )
        self.assertEqual(
            ({"group": "claim", "index": 0}, "invalid_request"), (error["step"], error["code"])
        )
        self.assertIn("already held by holder", error["message"])
        item = planning_service.get_work_item(self.conn, self.reference)
        self.assertEqual((held["revision"], []), (item["revision"], item["comments"]))

    def test_a_stale_expected_revision_refuses_before_any_step(self) -> None:
        stale = self.before["revision"] - 1
        error = self.refusal("apply_work_item_changes", self.closing(expected_revision=stale))
        self.assertEqual(("revision_conflict", stale), (error["code"], error["expected"]))
        self.assert_untouched()
        answer = self.answer(
            "apply_work_item_changes", self.closing(expected_revision=self.before["revision"])
        )
        self.assertEqual("done", answer["state"]["key"])

    def test_a_batch_that_changes_nothing_or_is_malformed_is_refused(self) -> None:
        for arguments, wanted in (
            ({"id": self.reference}, "at least one change"),
            ({"id": self.reference, "claim": False}, "at least one change"),
            ({"id": self.reference, "checklist_ticks": []}, "at least one change"),
            ({"id": self.reference, "claim": "yes"}, "claim must be a boolean"),
            ({"id": self.reference, "refs": {"kind": "url"}}, "refs must be a list"),
            ({"id": self.reference, "comment": "text"}, "comment must be an object"),
            (
                {"id": self.reference, "refs": [{"kind": "url", "value": "x", "id": "QA-9"}]},
                "refs[0]: unknown field(s) id",
            ),
        ):
            with self.subTest(arguments=arguments):
                error = self.refusal("apply_work_item_changes", arguments)
                self.assertEqual("invalid_request", error["code"])
                self.assertIn(wanted, error["message"])
        self.assert_untouched()

    def test_verbose_answers_with_the_full_item_and_what_was_applied(self) -> None:
        answer = self.answer(
            "apply_work_item_changes",
            {"id": self.reference, "comment": {"body": "only this"}, "verbose": True},
        )
        self.assertEqual(["only this"], [entry["body"] for entry in answer["comments"]])
        self.assertIn("events", answer)
        self.assertEqual(["comment"], list(answer["applied"]))

    def test_the_batch_is_published_with_every_group_and_the_single_tools_stay(self) -> None:
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": params()}
        )
        tools = {tool["name"]: tool for tool in answer["result"]["tools"]}
        schema = tools["apply_work_item_changes"]["inputSchema"]
        self.assertEqual(["id"], schema["required"])
        self.assertEqual(
            {
                "id",
                "claim",
                "update",
                "checklist",
                "checklist_ticks",
                "refs",
                "links",
                "comment",
                "comments",
                "resolutions",
                "questions",
                "summary",
                "transition",
                "expected_revision",
                "author",
                "verbose",
            },
            set(schema["properties"]),
        )
        for single in (
            "claim_work_item",
            "update_work_item",
            "tick_work_item_checklist_item",
            "attach_work_item_ref",
            "link_work_items",
            "comment_work_item",
            "create_work_item_request",
            "set_work_item_summary",
            "transition_work_item",
        ):
            self.assertIn(single, tools)


class CreateWorkItemWithLinksTests(WireCallTestCase):
    """create_work_item takes its claim and its links: one call, all or nothing."""

    def setUp(self) -> None:
        super().setUp()
        self.found_from = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="Where it was found"
        )
        self.related = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="Related"
        )
        self.conn.commit()
        self.before = {
            reference: planning_service.get_work_item(self.conn, reference)
            for reference in (self.found_from["reference"], self.related["reference"])
        }

    def discovered(self, **extra: object) -> dict:
        return {
            "space": SPACE_KEY,
            "title": "Found en route",
            "author": "one",
            "claim": True,
            "links": [
                {"other": self.found_from["reference"], "kind": "discovered-from"},
                {"other": self.related["reference"], "kind": "relates-to"},
            ],
            **extra,
        }

    def items(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])

    def assert_nothing_created(self) -> None:
        self.assertEqual(2, self.items())
        self.assertEqual([], self.calls())
        for reference, before in self.before.items():
            item = planning_service.get_work_item(self.conn, reference)
            self.assertEqual(
                (before["revision"], before["events"]), (item["revision"], item["events"])
            )
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM work_item_links").fetchone()[0])
        # The refused item's number was not spent: the next one takes it.
        number = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Next")
        self.assertEqual(f"{SPACE_KEY}-3", number["reference"])

    def test_the_item_is_created_claimed_and_linked_in_one_call(self) -> None:
        answer = self.answer("create_work_item", self.discovered(), {"sessionId": self.SESSION})

        self.assertEqual({"claim": True, "links": 2}, answer["applied"])
        # The claim started the new item, and the acknowledgement says so.
        self.assertEqual({"from": "backlog", "to": "dev"}, answer["started"])
        self.assertEqual("dev", answer["state"]["key"])
        # The session the client proved holds it, not the author the call signed.
        self.assertEqual(f"codex (session {self.SESSION})", answer["claim_ref"])
        self.assertEqual("Found en route", answer["title"])
        self.assertNotIn("events", answer)
        item = planning_service.get_work_item(self.conn, answer["reference"])
        self.assertEqual(item["revision"], answer["revision"])
        self.assertEqual(
            [
                ("discovered-from", self.found_from["reference"]),
                ("relates-to", self.related["reference"]),
            ],
            sorted((link["kind"], link["reference"]) for link in item["links"]),
        )
        # The history is the single tools' history, in the order they apply.
        self.assertEqual(
            ["created", "claimed", "transitioned", "linked", "linked"],
            [event["action"] for event in item["events"]],
        )
        # One call, recorded once, and every row it wrote points at it: the new
        # item's events and the event each link logs on its other end.
        [row] = self.calls()
        self.assertEqual(
            ("create_work_item", "confirmed", self.SESSION, item["work_item_id"]),
            (row["tool"], row["identity_state"], row["session_id"], row["work_item_id"]),
        )
        pointers = {
            found[0]
            for found in self.conn.execute(
                "SELECT call_id FROM work_item_events WHERE work_item_id = ? OR action = 'linked'",
                (item["work_item_id"],),
            )
        }
        self.assertEqual({row["id"]}, pointers)
        claimed = self.conn.execute(
            "SELECT claim_call_id FROM work_items WHERE work_item_id = ?", (item["work_item_id"],)
        ).fetchone()[0]
        self.assertEqual(row["id"], claimed)
        self.assertEqual("live", answer["claim_state"])
        for other in (self.found_from["reference"], self.related["reference"]):
            events = planning_service.get_work_item(self.conn, other)["events"]
            self.assertEqual("linked", events[-1]["action"])
            self.assertEqual("confirmed", events[-1]["identity"]["state"])

    def test_verbose_answers_with_the_full_item_and_what_was_applied(self) -> None:
        answer = self.answer(
            "create_work_item",
            {
                "space": SPACE_KEY,
                "title": "Verbose",
                "links": [{"other": self.related["reference"], "kind": "blocks"}],
                "verbose": True,
            },
        )
        self.assertIn("events", answer)
        self.assertEqual({"links": 1}, answer["applied"])
        self.assertEqual("", answer["claim_ref"])

    def test_a_link_to_an_unknown_item_creates_nothing(self) -> None:
        arguments = self.discovered(
            links=[
                {"other": self.related["reference"], "kind": "relates-to"},
                {"other": f"{SPACE_KEY}-99", "kind": "discovered-from"},
            ]
        )
        error = self.refusal("create_work_item", arguments, {"sessionId": self.SESSION})
        self.assertEqual("not_found", error["code"])
        self.assertEqual({"group": "links", "index": 1}, error["step"])
        self.assertTrue(error["message"].startswith("links[1]: "), error["message"])
        self.assertIn(f"{SPACE_KEY}-99", error["message"])
        self.assert_nothing_created()

    def test_a_refused_claim_creates_nothing(self) -> None:
        # A fresh item has no holder, so nothing in the domain refuses its claim
        # today; the refusal is injected to prove the creation goes with it.
        refused = planning_model.PlanningError("the claim was refused")
        with mock.patch.object(planning_service, "claim_work_item", side_effect=refused):
            error = self.refusal("create_work_item", self.discovered(), {"sessionId": self.SESSION})
        self.assertEqual(
            ("invalid_request", {"group": "claim", "index": 0}), (error["code"], error["step"])
        )
        self.assertEqual("claim: the claim was refused", error["message"])
        self.assert_nothing_created()

    def test_malformed_links_or_claim_are_refused_before_anything_is_written(self) -> None:
        other = self.related["reference"]
        for extra, wanted in (
            ({"claim": "yes"}, "claim must be a boolean"),
            ({"links": {"other": other, "kind": "blocks"}}, "links must be a list"),
            ({"links": ["QA-1"]}, "links[0] must be an object"),
            (
                {"links": [{"other": other, "kind": "blocks", "remove": True}]},
                "links[0]: unknown field(s) remove",
            ),
            ({"links": [{"other": other, "kind": "parent-of"}]}, "links[0]: "),
        ):
            with self.subTest(extra=extra):
                error = self.refusal("create_work_item", self.discovered(**extra))
                self.assertEqual("invalid_request", error["code"])
                self.assertIn(wanted, error["message"])
        self.assert_nothing_created()

    def test_the_call_without_claim_or_links_answers_as_before(self) -> None:
        for extra in ({}, {"claim": False, "links": []}):
            with self.subTest(extra=extra):
                answer = self.answer(
                    "create_work_item", {"space": SPACE_KEY, "title": "Plain", **extra}
                )
                self.assertEqual(
                    {
                        "reference",
                        "url",
                        "work_item_id",
                        "revision",
                        "state",
                        "claim_ref",
                        "claim_state",
                        "title",
                        "kind",
                        "priority",
                    },
                    set(answer),
                )
                item = planning_service.get_work_item(self.conn, answer["reference"])
                self.assertEqual(["created"], [event["action"] for event in item["events"]])
                self.assertEqual(("", []), (item["claim_ref"], item["links"]))

    def test_the_schema_publishes_claim_and_links(self) -> None:
        [answer] = self.converse(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": params()}
        )
        tools = {tool["name"]: tool for tool in answer["result"]["tools"]}
        self.assertEqual(len(mcp_surface.catalogue()), len(tools))
        schema = tools["create_work_item"]["inputSchema"]
        self.assertEqual(["space", "title"], schema["required"])
        self.assertEqual("boolean", schema["properties"]["claim"]["type"])
        links = schema["properties"]["links"]
        self.assertEqual(planning_api.MAX_APPLY_ENTRIES, links["maxItems"])
        self.assertEqual({"other", "kind"}, set(links["items"]["properties"]))
        self.assertEqual(["other", "kind"], links["items"]["required"])
        self.assertEqual(
            sorted(planning_model.LINK_KINDS), links["items"]["properties"]["kind"]["enum"]
        )
        self.assertIn("create_work_item", mcp_surface.PLANNING_INSTRUCTIONS)


class ServerInstructionTests(unittest.TestCase):
    def test_a_client_keeps_the_whole_text(self) -> None:
        # Claude Code 2.1.314 cuts server instructions at 4096 characters. The
        # text once ran 301 past it and lost its closing rules without a word.
        self.assertLessEqual(len(mcp_surface.PLANNING_INSTRUCTIONS), 4096)
        self.assertTrue(
            mcp_surface.PLANNING_INSTRUCTIONS.endswith(
                "only for an item that should never have existed."
            )
        )

    def test_the_address_rule_names_a_link_for_the_owner_and_none_for_valkama(self) -> None:
        text = mcp_surface.PLANNING_INSTRUCTIONS
        self.assertIn(
            f"[MAIN-12](http://127.0.0.1:{configuration.listener_port()}/open/MAIN-12)", text
        )
        self.assertIn("never in a Valkama comment or description", text)


class RankToolTests(WireCallTestCase):
    """`rank` on the writes an agent already has: where an item goes in its state."""

    def setUp(self) -> None:
        super().setUp()
        self.items = [
            planning_service.create_work_item(self.conn, space=SPACE_KEY, title=title)["reference"]
            for title in ("First", "Second", "Third")
        ]
        self.queued = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="Queued", state="todo"
        )["reference"]
        self.conn.commit()

    def order(self, state: str = "backlog") -> list[str]:
        return [
            item["reference"]
            for item in planning_service.list_work_items(
                self.conn, space=SPACE_KEY, state_key=state
            )
        ]

    def test_the_writes_that_place_an_item_publish_rank_and_no_new_tool_does(self) -> None:
        schemas = {tool["name"]: tool["inputSchema"] for tool in planning_tools.TOOLS}
        self.assertEqual("string", schemas["update_work_item"]["properties"]["rank"]["type"])
        self.assertEqual("string", schemas["transition_work_item"]["properties"]["rank"]["type"])
        transition = schemas["apply_work_item_changes"]["properties"]["transition"]
        self.assertIn("rank", transition["properties"])
        self.assertFalse({"rank_work_item", "place_work_item", "reorder_work_item"} & set(schemas))

    def test_an_update_places_the_item_and_says_so(self) -> None:
        answer = self.answer(
            "update_work_item", {"id": self.items[2], "rank": f"before:{self.items[0]}"}
        )
        self.assertEqual(["rank"], answer["updated"])
        self.assertEqual([self.items[2], *self.items[:2]], self.order())
        [call] = self.calls()
        self.assertEqual("update_work_item", call["tool"])

    def test_a_transition_and_a_batch_place_the_item_in_its_new_state(self) -> None:
        self.answer("transition_work_item", {"id": self.items[0], "state": "todo", "rank": "first"})
        self.assertEqual([self.items[0], self.queued], self.order("todo"))
        answer = self.answer(
            "apply_work_item_changes",
            {
                "id": self.items[1],
                "transition": {"state": "todo", "rank": f"after:{self.items[0]}"},
            },
        )
        self.assertEqual({"transition": {"state": "todo"}}, answer["applied"])
        self.assertEqual([self.items[0], self.items[1], self.queued], self.order("todo"))

    def test_a_placement_the_store_cannot_follow_is_refused_and_writes_nothing(self) -> None:
        for rank, message in (
            ("top", "rank must be first, last, before:<work item> or after:<work item>"),
            (f"after:{self.queued}", f"{self.queued} is in Todo, not Backlog"),
        ):
            with self.subTest(rank=rank):
                error = self.refusal("update_work_item", {"id": self.items[0], "rank": rank})
                self.assertEqual("invalid_request", error["code"])
                self.assertIn(message, error["message"])
        self.assertEqual(self.items, self.order())
        self.assertEqual([], self.calls())


class CompactWorkItemReadTests(WireCallTestCase):
    """get_work_item: the newest history by default, all of it on request."""

    def setUp(self) -> None:
        super().setUp()
        self.reference = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="Long history"
        )["reference"]
        for number in range(7):
            planning_service.comment_work_item(self.conn, self.reference, f"note {number}")
        # Each claim starts the item and each release requeues it: four events a round.
        for _ in range(6):
            planning_service.claim_work_item(self.conn, self.reference, author="one")
            planning_service.claim_work_item(self.conn, self.reference, author="one", release=True)
        self.conn.commit()
        self.complete = planning_service.get_work_item(self.conn, self.reference)

    def test_the_default_answer_carries_the_newest_history_and_its_totals(self) -> None:
        answer = self.answer("get_work_item", {"id": self.reference})
        # Seven threads with no replies: the newest five roots, each saying so.
        self.assertEqual(
            [
                {**comment, "replies": 0, "last_reply": None}
                for comment in self.complete["comments"][-5:]
            ],
            answer["comments"],
        )
        self.assertEqual(self.complete["events"][-10:], answer["events"])
        self.assertEqual(
            (7, 7, 25, True),
            (
                answer["comments_total"],
                answer["threads_total"],
                answer["events_total"],
                answer["history_truncated"],
            ),
        )
        for key, value in self.complete.items():
            if key not in ("comments", "events"):
                self.assertEqual(value, answer[key], key)

    def test_full_answers_with_the_complete_record(self) -> None:
        answer = self.answer("get_work_item", {"id": self.reference, "full": True})
        self.assertEqual(
            self.complete,
            {k: v for k, v in answer.items() if k not in ("sessions", "url", "questions")},
        )
        self.assertNotIn("history_truncated", answer)
        self.assertEqual([], answer["sessions"])

    def test_comments_after_answers_with_all_that_came_since_and_nothing_before(self) -> None:
        """More than the newest five, because a reader catching up must not lose the rest."""

        comments = self.complete["comments"]
        answer = self.answer(
            "get_work_item", {"id": self.reference, "comments_after": comments[0]["id"]}
        )
        self.assertEqual(comments[1:], answer["comments"])
        self.assertLess(5, len(answer["comments"]))
        self.assertEqual(self.complete["events"][-10:], answer["events"])
        self.assertEqual(
            (len(comments), 25, True),
            (answer["comments_total"], answer["events_total"], answer["history_truncated"]),
        )

    def test_comments_after_the_last_one_read_is_empty_and_keeps_the_totals(self) -> None:
        comments = self.complete["comments"]
        answer = self.answer(
            "get_work_item", {"id": self.reference, "comments_after": comments[-1]["id"]}
        )
        self.assertEqual(
            ([], len(comments), True),
            (answer["comments"], answer["comments_total"], answer["history_truncated"]),
        )

    def test_comments_after_zero_is_every_comment(self) -> None:
        answer = self.answer("get_work_item", {"id": self.reference, "comments_after": 0})
        self.assertEqual(self.complete["comments"], answer["comments"])
        self.assertEqual(self.complete["events"][-10:], answer["events"])

    def test_comments_after_an_id_of_another_item_is_a_point_in_the_same_sequence(self) -> None:
        """Comment ids run across items, so the point need not belong to this one."""

        other = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Other")
        planning_service.comment_work_item(self.conn, other["reference"], "elsewhere")
        planning_service.comment_work_item(self.conn, self.reference, "later")
        self.conn.commit()
        (noted,) = planning_service.get_work_item(self.conn, other["reference"])["comments"]
        answer = self.answer("get_work_item", {"id": self.reference, "comments_after": noted["id"]})
        self.assertEqual(["later"], [comment["body"] for comment in answer["comments"]])

    def test_comments_after_is_refused_with_full_and_when_it_is_no_id(self) -> None:
        for extra, wanted in (
            ({"comments_after": 1, "full": True}, "full and comments_after exclude each other"),
            ({"comments_after": -1}, "comments_after must be a non-negative integer"),
            ({"comments_after": "12"}, "comments_after must be a non-negative integer"),
            ({"comments_after": True}, "comments_after must be a non-negative integer"),
            ({"comments_after": 2**70}, "comments_after must be a non-negative integer"),
        ):
            with self.subTest(extra=extra):
                error = self.refusal("get_work_item", {"id": self.reference, **extra})
                self.assertEqual(("invalid_request", wanted), (error["code"], error["message"]))

    def test_a_short_history_is_whole_and_says_so(self) -> None:
        reference = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Short")[
            "reference"
        ]
        self.conn.commit()
        answer = self.answer("get_work_item", {"id": reference})
        self.assertEqual(
            (0, 1, False, 1),
            (
                answer["comments_total"],
                answer["events_total"],
                answer["history_truncated"],
                len(answer["events"]),
            ),
        )

    def test_a_link_names_its_other_ends_state_and_the_tool_schema_is_unchanged(self) -> None:
        """The read gained fields on its links; what an agent sends is pinned here."""

        blocker = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="Blocker")
        planning_service.link_work_items(self.conn, blocker["reference"], self.reference, "blocks")
        planning_service.set_summary(self.conn, blocker["reference"], {"done": "d", "next": "n"})
        planning_service.transition_work_item(self.conn, blocker["reference"], "done")
        self.conn.commit()
        (link,) = self.answer("get_work_item", {"id": self.reference})["links"]
        self.assertEqual(
            {
                "kind": "blocks",
                "direction": "incoming",
                "work_item_id": blocker["work_item_id"],
                "reference": blocker["reference"],
                "title": "Blocker",
                "state_name": "Done",
                "state_category": "completed",
                "is_terminal": True,
                "state_unavailable": None,
            },
            link,
        )
        [listed] = self.converse(
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": params()}
        )
        tool = next(t for t in listed["result"]["tools"] if t["name"] == "get_work_item")
        self.assertEqual({"name", "title", "annotations", "description", "inputSchema"}, set(tool))
        self.assertEqual(
            {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "A work item, by its reference (MAIN-142) or its"
                        " work_item_id.",
                    },
                    "full": {
                        "type": "boolean",
                        "description": "Answer with every comment and history event instead"
                        " of the newest ones.",
                    },
                    "comments_after": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "A comment id: answer with every comment after it,"
                        " oldest first, instead of the newest ones. Not together with full.",
                    },
                    "thread": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "A comment id: answer with its thread, the root and"
                        " every reply oldest first; a reply's id reads its root's thread. Not"
                        " together with full or comments_after.",
                    },
                    "unresolved": {
                        "type": "boolean",
                        "description": "Answer with the roots without the resolved mark, each"
                        " with replies and last_reply. Not together with full or thread;"
                        " comments_after is where the next page starts.",
                    },
                },
                "required": ["id"],
            },
            tool["inputSchema"],
        )

    def test_full_must_be_a_boolean(self) -> None:
        error = self.refusal("get_work_item", {"id": self.reference, "full": "yes"})
        self.assertEqual(
            ("invalid_request", "full must be a boolean"), (error["code"], error["message"])
        )

    def test_sessions_name_only_the_confirmed_sessions_that_wrote(self) -> None:
        tool_use = "toolu_01ABCdefGHIjklMNOpqrSTU"
        hook = {"session_id": "unverified-session", "tool_use_id": tool_use}
        comment = {"id": self.reference, "body": "x"}
        self.answer("comment_work_item", comment, {"sessionId": self.SESSION})
        self.answer("comment_work_item", comment, {"sessionId": self.SESSION})
        # Unconfirmed: a hook identity the client did not vouch for, and nothing at all.
        self.answer("comment_work_item", {**comment, "_identity": hook})
        self.answer("comment_work_item", comment)
        # Confirmed but sessionless: the owner's browser.
        with planning_calls.bind(planning_calls.browser(), "/api/planning/work-item/comment"):
            planning_service.comment_work_item(self.conn, self.reference, "by hand")
        self.conn.commit()
        self.assertEqual(5, len(self.calls()))

        for full in (False, True):
            with self.subTest(full=full):
                [session] = self.answer("get_work_item", {"id": self.reference, "full": full})[
                    "sessions"
                ]
                self.assertEqual(
                    (self.SESSION, "codex", "codex-meta", 2),
                    (
                        session["session_id"],
                        session["client"],
                        session["identity_source"],
                        session["writes"],
                    ),
                )
                self.assertLessEqual(session["first_at"], session["last_at"])

    def test_the_http_reads_answer_exactly_what_they_did(self) -> None:
        # The browser inspector reads the item through the module route, whose
        # loader is service.get_work_item with no options; the neutral read
        # without parameters is the same record. Neither gains a field.
        self.answer(
            "comment_work_item", {"id": self.reference, "body": "x"}, {"sessionId": self.SESSION}
        )
        complete = planning_service.get_work_item(self.conn, self.reference)
        handled = planning_api.handle_get(
            self.conn, "/api/planning/work-item", {"id": [self.reference]}
        )
        assert handled is not None
        self.assertEqual(complete, handled[1]["work_item"])
        self.assertEqual(8, len(complete["comments"]))
        self.assertEqual(25, len(complete["events"]))
        for added in ("sessions", "comments_total", "events_total", "history_truncated"):
            self.assertNotIn(added, complete)

    def test_the_http_read_takes_the_same_cut_as_opt_in_parameters(self) -> None:
        handled = planning_api.handle_get(
            self.conn,
            "/api/planning/work-item",
            {"id": [self.reference], "comments": ["2"], "events": ["0"], "sessions": ["true"]},
        )
        assert handled is not None
        item = handled[1]["work_item"]
        self.assertEqual(self.complete["comments"][-2:], item["comments"])
        self.assertEqual(
            ([], [], True), (item["events"], item["sessions"], item["history_truncated"])
        )
        for parameters, wanted in (
            ({"comments": ["-1"]}, "comments must be a non-negative integer"),
            ({"comments_after": ["many"]}, "comments_after must be a non-negative integer"),
            ({"comments_after": [str(2**70)]}, "comments_after must be a non-negative integer"),
            ({"comments": [str(2**70)]}, "comments must be a non-negative integer"),
            ({"events": ["many"]}, "events must be a non-negative integer"),
            ({"sessions": ["yes"]}, "sessions must be true or false"),
        ):
            with self.subTest(parameters=parameters):
                with self.assertRaisesRegex(Exception, wanted):
                    planning_api.handle_get(
                        self.conn,
                        "/api/planning/work-item",
                        {"id": [self.reference], **parameters},
                    )

    def test_the_http_read_takes_comments_after_alone_and_within_a_count(self) -> None:
        comments = self.complete["comments"]
        for parameters, wanted in (
            ({"comments_after": [str(comments[1]["id"])]}, comments[2:]),
            ({"comments_after": [str(comments[1]["id"])], "comments": ["2"]}, comments[-2:]),
        ):
            with self.subTest(parameters=parameters):
                handled = planning_api.handle_get(
                    self.conn, "/api/planning/work-item", {"id": [self.reference], **parameters}
                )
                assert handled is not None
                item = handled[1]["work_item"]
                self.assertEqual(wanted, item["comments"])
                self.assertEqual(
                    (len(comments), True), (item["comments_total"], item["history_truncated"])
                )
        handled = planning_api.handle_get(
            self.conn, "/api/planning/work-item", {"id": [self.reference], "comments_after": ["0"]}
        )
        assert handled is not None
        self.assertEqual(self.complete, handled[1]["work_item"])


class ChainToolTests(WireCallTestCase):
    """get_work_item_chain: the shared chain read, cut down for a model, open members paged."""

    def setUp(self) -> None:
        super().setUp()
        self.root = planning_service.create_work_item(
            self.conn, space=SPACE_KEY, title="Root", kind="epic"
        )["reference"]
        self.children: dict[str, str] = {}
        for name, state in (
            ("ready", None),
            ("held", "blocked"),
            ("active", "dev"),
            ("review", "review"),
            ("claimed", "todo"),
        ):
            self.children[name] = planning_service.create_work_item(
                self.conn, space=SPACE_KEY, title=name, state=state, parent=self.root
            )["reference"]
        # Held in Todo, as a claim an earlier build took left it: a claim now
        # starts its item, and this one stands for work held but not started.
        planning_service.claim_work_item(
            self.conn, self.children["claimed"], author="one", move_state=False
        )
        # Enough closed children on distinct days for the series to be cut.
        for day in range(1, 33):
            done = planning_service.create_work_item(
                self.conn, space=SPACE_KEY, title=f"done {day}", state="done", parent=self.root
            )
            stamp = f"{date(2026, 7, 31) + timedelta(days=day)}T08:00:00Z"
            self.conn.execute(
                "UPDATE work_items SET created_at = ?, updated_at = ? WHERE work_item_id = ?",
                (stamp, stamp, done["work_item_id"]),
            )
        self.found = planning_service.create_work_item(self.conn, space=SPACE_KEY, title="found")[
            "reference"
        ]
        planning_service.link_work_items(
            self.conn, self.found, self.children["ready"], "discovered-from"
        )
        # The open members are written on one fixed day too, and the chain's own
        # clock is held still, so the series and the recent window read the same
        # on both sides of a UTC midnight.
        for reference in (*self.children.values(), self.found):
            self.conn.execute(
                "UPDATE work_items SET created_at = ?, updated_at = ? WHERE work_item_id = ?",
                (
                    "2026-09-10T08:00:00Z",
                    "2026-09-10T08:00:00Z",
                    planning_service.get_work_item(self.conn, reference)["work_item_id"],
                ),
            )
        self.conn.commit()
        clock = mock.patch.object(
            planning_chain, "utc_now", return_value=datetime(2026, 9, 12, 23, 59, tzinfo=UTC)
        )
        clock.start()
        self.addCleanup(clock.stop)

    def whole(self, scope: str = "chain") -> dict:
        handled = planning_api.handle_get(
            self.conn, "/api/planning/work-item/chain", {"id": [self.root], "scope": [scope]}
        )
        assert handled is not None
        return handled[1]["chain"]

    def test_the_answer_is_the_shared_chain_without_members_and_edges(self) -> None:
        answer = self.answer("get_work_item_chain", {"id": self.root})
        whole = self.whole()
        self.assertNotIn("members", answer)
        self.assertNotIn("edges", answer)
        for key in ("root", "scope", "total", "closed", "open", "ready", "by_category"):
            self.assertEqual(whole[key], answer[key], key)
        self.assertEqual((38, 32, 6), (answer["total"], answer["closed"], answer["open"]))
        self.assertEqual(whole["origins"], answer["origins"])
        self.assertEqual(whole["recent"], answer["recent"])
        self.assertEqual(33, len(whole["series"]))
        self.assertEqual(whole["series"][-30:], answer["series"])

    def test_the_epic_scope_leaves_the_discovered_item_out(self) -> None:
        answer = self.answer("get_work_item_chain", {"reference": self.root, "scope": "epic"})
        self.assertEqual(("epic", 37, 5), (answer["scope"], answer["total"], answer["open"]))

    def test_open_members_run_active_review_ready_then_the_rest(self) -> None:
        answer = self.answer("get_work_item_chain", {"id": self.root})
        # The rest in the order of work: the claimed Todo item before the
        # blocked one, whatever their numbers.
        self.assertEqual(
            [
                self.children["active"],
                self.children["review"],
                self.children["ready"],
                self.found,
                self.children["claimed"],
                self.children["held"],
            ],
            [row["reference"] for row in answer["open_members"]],
        )
        self.assertEqual((False, None), (answer["truncated"], answer["next_offset"]))
        claimed = answer["open_members"][-2]
        # A row's rank is the one the whole chain gives that member.
        ranks = {member["reference"]: member["rank"] for member in self.whole()["members"]}
        self.assertEqual(
            {
                "reference": self.children["claimed"],
                "title": "claimed",
                "state": "todo",
                "claim_ref": "one",
                "ready": False,
                "parent_reference": self.root,
                "rank": ranks[self.children["claimed"]],
            },
            claimed,
        )
        self.assertIsNone(answer["open_members"][3]["parent_reference"])
        # Inside a group the rows follow the rank: the two ready ones, the rest.
        rows = answer["open_members"]
        for group in (rows[2:4], rows[4:]):
            self.assertLess(group[0]["rank"], group[1]["rank"])

    def test_open_members_page_until_next_offset_is_null(self) -> None:
        seen: list[str] = []
        pages: list[tuple[int, bool, int | None]] = []
        offset: int | None = 0
        while offset is not None:
            answer = self.answer(
                "get_work_item_chain", {"id": self.root, "limit": 4, "offset": offset}
            )
            seen.extend(row["reference"] for row in answer["open_members"])
            pages.append((len(answer["open_members"]), answer["truncated"], answer["next_offset"]))
            offset = answer["next_offset"]
        self.assertEqual([(4, True, 4), (2, False, None)], pages)
        self.assertEqual(6, len(set(seen)))
        # A limit above the page is one page of at most the cap.
        self.assertEqual(
            6,
            len(
                self.answer("get_work_item_chain", {"id": self.root, "limit": 5000})["open_members"]
            ),
        )

    def test_refusals_carry_the_boundary_codes(self) -> None:
        for arguments, wanted in (
            ({"id": self.root, "offset": -1}, "offset must be a non-negative integer"),
            ({"id": self.root, "limit": True}, "limit must be a non-negative integer"),
            ({"id": self.root, "scope": "related"}, "scope must be chain or epic"),
            (
                {"id": "not a reference"},
                "a work item reference reads as KEY-NUMBER, such as MAIN-142",
            ),
        ):
            with self.subTest(arguments=arguments):
                error = self.refusal("get_work_item_chain", arguments)
                self.assertEqual(("invalid_request", wanted), (error["code"], error["message"]))
        # An item that is not there is not a malformed argument: it says so by its code.
        error = self.refusal("get_work_item_chain", {"id": f"{SPACE_KEY}-999"})
        self.assertEqual(
            ("not_found", f"no work item {SPACE_KEY}-999"), (error["code"], error["message"])
        )

    def test_list_work_items_keeps_only_the_named_parents_children(self) -> None:
        listed = self.answer("list_work_items", {"parent": self.root, "limit": 100})["work_items"]
        self.assertEqual(37, len(listed))
        self.assertEqual({self.root}, {row["parent"] for row in listed})
        self.assertEqual([], self.answer("list_work_items", {"parent": self.found})["work_items"])
        error = self.refusal("list_work_items", {"parent": f"{SPACE_KEY}-999"})
        self.assertEqual("not_found", error["code"])
        # Without it the list is unchanged: every item in the space.
        self.assertEqual(
            39,
            len(self.answer("list_work_items", {"space": SPACE_KEY, "limit": 100})["work_items"]),
        )


if __name__ == "__main__":
    unittest.main()
