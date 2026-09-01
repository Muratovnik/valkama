"""Checks for the Valkama MCP tool: storage, tool dispatch, and the stdio loop."""

from __future__ import annotations

import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The registered entry point, not the package module behind it.
ENTRY_POINT = os.path.join(ROOT, "valkama.py")
# Revision 2026-07-28 has no handshake, so every request declares its own
# protocol version. These stdio cases drive the real process, which refuses
# anything that does not.
STDIO_META = {"_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}
sys.path.insert(0, ROOT)
from http.server import BaseHTTPRequestHandler

from server import (
    analytics,
    documents,
    federation,
    http_surface,
    mcp_surface,
    refs,
    sessions,
    static_assets,
    store,
)
from server.planning import service as planning
from server.planning import views as planning_views
from server.platform.contracts import planning_space_entity
from server.platform.scope import read_store_metadata
from server.projects import project_registry
from tests import SUITE_STORE
from tests.registry_fixtures import project_entry, registry_bytes


class EventFrameTests(unittest.TestCase):
    """A stream frame is written only when its payload actually changed.

    data_version bumps on every database write, and agents write session events
    continuously; without this discipline a board stream repeated an identical
    frame several times a second and the graph view visibly reloaded forever.
    """

    def test_identical_payloads_write_one_frame(self) -> None:
        frames = http_surface.EventFrames(clock=lambda: 0.0)
        self.assertEqual(b'data: {"a": 1}\n\n', frames.frame('{"a": 1}'))
        self.assertIsNone(frames.frame('{"a": 1}'))
        self.assertIsNone(frames.frame('{"a": 1}'))
        self.assertEqual(b'data: {"a": 2}\n\n', frames.frame('{"a": 2}'))

    def test_a_change_after_dedup_is_still_delivered(self) -> None:
        frames = http_surface.EventFrames(clock=lambda: 0.0)
        frames.frame("same")
        frames.frame("same")
        self.assertEqual(b"data: different\n\n", frames.frame("different"))

    def test_quiet_dedup_still_proves_the_connection_lives(self) -> None:
        now = [0.0]
        frames = http_surface.EventFrames(clock=lambda: now[0], keepalive_seconds=20.0)
        frames.frame("same")
        now[0] = 19.0
        self.assertIsNone(frames.frame("same"), "young silence writes nothing")
        now[0] = 21.0
        self.assertEqual(b": keep-alive\n\n", frames.frame("same"))
        now[0] = 22.0
        self.assertIsNone(frames.frame("same"), "the keep-alive reset the quiet clock")


class HttpContractTests(unittest.TestCase):
    def test_sse_disconnect_errors_include_windows_connection_abort(self) -> None:
        self.assertIn(ConnectionAbortedError, http_surface.CLIENT_DISCONNECT_ERRORS)

    def test_request_lifecycle_swallows_a_windows_client_abort(self) -> None:
        handler = object.__new__(http_surface.Handler)
        with mock.patch.object(
            BaseHTTPRequestHandler,
            "handle",
            side_effect=ConnectionAbortedError,
        ):
            handler.handle()

    def test_runtime_endpoint_is_the_startup_snapshot_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = os.path.join(directory, "dist")
            os.makedirs(dist)
            with open(os.path.join(dist, "index.html"), "wb") as handle:
                handle.write(b"<html>stable</html>")
            snapshot = static_assets.capture_runtime_snapshot(directory, dist)

            handler = object.__new__(http_surface.Handler)
            handler.path = "/api/runtime"
            handler._require_host = mock.Mock(return_value=True)
            handler.headers = {}
            handler.wfile = io.BytesIO()
            captured: dict[str, object] = {"headers": {}}
            handler.send_response = lambda code: captured.update(code=code)
            handler.send_header = lambda name, value: captured["headers"].__setitem__(name, value)
            handler.end_headers = lambda: None
            handler.server = SimpleNamespace(runtime_snapshot=snapshot)
            handler.do_GET()

            self.assertEqual(200, captured["code"])
            self.assertEqual("application/json", captured["headers"]["Content-Type"])
            self.assertEqual(snapshot.identity, json.loads(handler.wfile.getvalue()))
            self.assertEqual(
                static_assets.canonical_json(snapshot.identity).encode("utf-8"),
                handler.wfile.getvalue(),
            )

    def test_runtime_cli_uses_the_same_identity_calculation(self) -> None:
        result = subprocess.run(
            [sys.executable, ENTRY_POINT, "runtime"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            static_assets.runtime_identity(static_assets.SOURCE_ROOT, static_assets.DIST_DIR),
            json.loads(result.stdout),
        )


class StdioTests(unittest.TestCase):
    def test_revision_conflict_has_matching_typed_mcp_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(
                os.environ,
                VALKAMA_DB=os.path.join(tmp, "stdio.sqlite3"),
                VALKAMA_NO_TRAY="1",
            )
            script = ENTRY_POINT
            requests = [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_planning_space",
                        "arguments": {"project_id": "s", "name": "S", "key": "SPC"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_work_item",
                        "arguments": {"space": "SPC", "title": "C"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "transition_work_item",
                        "arguments": {"id": "SPC-1", "state": "todo", "expected_revision": 0},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "transition_work_item",
                        "arguments": {"id": "SPC-1", "state": "dev", "expected_revision": 0},
                    },
                },
            ]
            proc = subprocess.run(
                [sys.executable, script, "mcp"],
                input="".join(json.dumps(request) + "\n" for request in requests).encode("utf-8"),
                capture_output=True,
                timeout=30,
                env=env,
                check=False,
            )
            replies = {
                reply["id"]: reply
                for reply in (json.loads(line) for line in proc.stdout.decode("utf-8").splitlines())
            }
            result = replies[4]["result"]
            self.assertTrue(result["isError"])
            self.assertEqual(result["structuredContent"], json.loads(result["content"][0]["text"]))
            self.assertEqual(
                {
                    "error": {
                        "code": "revision_conflict",
                        "message": "work item is at revision 1, not 0",
                        "expected": 0,
                        "actual": 1,
                    }
                },
                result["structuredContent"],
            )

    def test_stdio_error_rolls_back_before_next_tool_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(
                os.environ,
                VALKAMA_DB=os.path.join(tmp, "stdio.sqlite3"),
                VALKAMA_NO_TRAY="1",
            )
            script = ENTRY_POINT
            requests = [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_planning_space",
                        "arguments": {"project_id": "s", "name": "S", "key": "SPC"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_planning_space",
                        "arguments": {"project_id": "s", "name": "S", "key": "SPC"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_planning_space",
                        "arguments": {"project_id": "t", "name": "T", "key": "SPD"},
                    },
                },
            ]
            proc = subprocess.run(
                [sys.executable, script, "mcp"],
                input="".join(json.dumps(request) + "\n" for request in requests).encode("utf-8"),
                capture_output=True,
                timeout=30,
                env=env,
                check=False,
            )
            replies = {
                reply["id"]: reply
                for reply in (json.loads(line) for line in proc.stdout.decode("utf-8").splitlines())
            }
            self.assertTrue(replies[2]["result"]["isError"])
            self.assertFalse(replies[3]["result"]["isError"])

    def test_non_ascii_survives_stdio_unchanged(self) -> None:
        # The request must carry real UTF-8 bytes: ensure_ascii would escape every
        # non-ASCII character to \uXXXX and put pure ASCII on the wire, which is
        # why the in-process storage tests never caught the locale-decode defect.
        needle = "тире—тире «ёлка»"
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(
                os.environ,
                VALKAMA_DB=os.path.join(tmp, "stdio.sqlite3"),
                VALKAMA_NO_TRAY="1",
            )
            script = ENTRY_POINT
            requests = [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_planning_space",
                        "arguments": {"project_id": "s", "name": "S", "key": "SPC"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_work_item",
                        "arguments": {"space": "SPC", "title": needle},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "comment_work_item",
                        "arguments": {"id": "SPC-1", "body": needle},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {**STDIO_META, "name": "get_work_item", "arguments": {"id": "SPC-1"}},
                },
            ]
            proc = subprocess.run(
                [sys.executable, script, "mcp"],
                input="".join(
                    json.dumps(request, ensure_ascii=False) + "\n" for request in requests
                ).encode("utf-8"),
                capture_output=True,
                timeout=30,
                env=env,
                check=False,
            )
            replies = {
                reply["id"]: reply
                for reply in (json.loads(line) for line in proc.stdout.decode("utf-8").splitlines())
            }
            item = json.loads(replies[4]["result"]["content"][0]["text"])
            self.assertEqual(needle, item["title"])
            self.assertEqual(needle, item["comments"][0]["body"])

    def test_discover_list_and_call_over_stdio(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(
                os.environ,
                VALKAMA_DB=os.path.join(tmp, "stdio.sqlite3"),
                VALKAMA_NO_TRAY="1",  # a test must not put an icon in the tray
            )
            script = ENTRY_POINT
            requests = [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "server/discover",
                    "params": {**STDIO_META},
                },
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {**STDIO_META}},
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_planning_space",
                        "arguments": {"project_id": "stdio", "name": "S"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {
                        **STDIO_META,
                        "name": "create_work_item",
                        "arguments": {"space": "S", "title": "Over stdio"},
                    },
                },
                {
                    "jsonrpc": "2.0",
                    "id": 5,
                    "method": "tools/call",
                    "params": {**STDIO_META, "name": "list_planning_spaces", "arguments": {}},
                },
            ]
            payload = "".join(json.dumps(r) + "\n" for r in requests)
            proc = subprocess.run(
                [sys.executable, script, "mcp"],
                input=payload.encode("utf-8"),
                capture_output=True,
                timeout=30,
                env=env,
                check=False,
            )
            replies = [json.loads(line) for line in proc.stdout.decode("utf-8").splitlines()]
            by_id = {r["id"]: r for r in replies}
            discovered = by_id[1]["result"]
            self.assertEqual(
                "valkama", discovered["_meta"]["io.modelcontextprotocol/serverInfo"]["name"]
            )
            # The instructions must describe the catalogue this process serves.
            # An agent reading about `move_card` while holding `transition_work_item`
            # is a half-finished rename reaching the client.
            self.assertIn("transition_work_item", discovered["instructions"])
            self.assertNotIn("move_card", discovered["instructions"])
            self.assertEqual([mcp_surface.MODERN_PROTOCOL], discovered["supportedVersions"])
            for tool in by_id[2]["result"]["tools"]:
                with self.subTest(tool=tool["name"]):
                    self.assertTrue(tool["description"], "every tool documents itself")
                    self.assertIn("annotations", tool)
                    self.assertIn("readOnlyHint", tool["annotations"])
            # A store with no Board rows is Planning-native: the catalogue is
            # chosen once per process from what the store actually holds, and a
            # fresh install must not start on the domain being retired.
            by_name = {t["name"]: t for t in by_id[2]["result"]["tools"]}
            self.assertTrue(by_name["list_work_items"]["annotations"]["readOnlyHint"])
            self.assertTrue(by_name["delete_work_item"]["annotations"]["destructiveHint"])
            self.assertFalse(by_name["create_work_item"]["annotations"]["destructiveHint"])
            names = {t["name"] for t in by_id[2]["result"]["tools"]}
            self.assertIn("transition_work_item", names)
            self.assertIn("claim_work_item", names)
            self.assertIn("claim_work_item_checklist_item", names)
            self.assertLessEqual(
                {
                    "link_work_items",
                    "set_work_item_checklist",
                    "tick_work_item_checklist_item",
                    "attach_work_item_ref",
                    "delete_work_item",
                },
                names,
            )
            self.assertNotIn("list_cards", names)
            self.assertNotIn("create_board", names)
            self.assertLessEqual(
                {
                    "list_platform_modules",
                    "get_improvements_profile",
                    "list_improvement_cases",
                    "get_improvement_case",
                    "update_improvements_profile",
                    "analyze_improvements",
                    "improvements_cancel_job",
                    "act_on_improvement_case",
                    "run_improvement_eval",
                },
                names,
            )
            # A floor against silent growth. The Planning era offers one tool
            # fewer than the Board era: it replaced `delete_board` and
            # `merge_boards` with nothing and added `claim_ready_work_item`.
            # Space deletion and merge have no neutral equivalent yet.
            self.assertEqual(29, len(names))
            self.assertIn("set_work_item_summary", names)
            for reply in (3, 4, 5):
                self.assertFalse(by_id[reply]["result"]["isError"], by_id[reply]["result"])
            created = json.loads(by_id[4]["result"]["content"][0]["text"])
            self.assertEqual("Over stdio", created["title"])
            # A list read answers with its envelope; an exact read answers with
            # the record. Both spellings are deliberate and this asserts each.
            spaces = json.loads(by_id[5]["result"]["content"][0]["text"])
            self.assertEqual(["S"], [space["name"] for space in spaces["planning_spaces"]])


class SearchAndRefTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        self.conn = store.connect()
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        os.environ["VALKAMA_DB"] = SUITE_STORE
        os.environ.pop(documents.DOC_ROOTS_VAR, None)
        self._dir.cleanup()

    def item(self, title: str) -> str:
        record = planning.create_work_item(self.conn, space="TST", title=title)
        self.conn.commit()
        return str(record["reference"])

    def test_search_covers_titles_comments_and_summaries(self) -> None:
        by_title = self.item("widget parser")
        by_comment = self.item("unrelated")
        planning.comment_work_item(self.conn, by_comment, "the widget broke here")
        by_summary = self.item("also unrelated")
        planning.set_summary(
            self.conn, by_summary, {"done": "rewrote the widget", "next": "nothing"}
        )
        self.item("nothing to do with it")
        self.conn.commit()

        found = planning.search_work_items(self.conn, "widget")
        self.assertEqual({by_title, by_comment, by_summary}, {i["reference"] for i in found})
        hit = next(item for item in found if item["reference"] == by_comment)
        self.assertIn("widget broke", hit["comment_hit"])
        self.assertTrue(
            next(item for item in found if item["reference"] == by_summary)["summary_hit"]
        )

    def test_document_search_reads_configured_roots_only(self) -> None:
        root = os.path.join(self._dir.name, "repo")
        os.makedirs(os.path.join(root, "docs", "specs"))
        os.makedirs(os.path.join(root, "node_modules"))
        with open(os.path.join(root, "docs", "specs", "platform.md"), "w", encoding="utf-8") as f:
            f.write("# Platform\n\nThe agent platform federates spaces.\n")
        with open(os.path.join(root, "node_modules", "junk.md"), "w", encoding="utf-8") as f:
            f.write("federates\n")
        with open(os.path.join(root, "docs", "notes.txt"), "w", encoding="utf-8") as f:
            f.write("federates\n")

        hits = documents.search_documents("federates", [root])
        self.assertEqual(["docs/specs/platform.md"], [hit["path"] for hit in hits])
        self.assertEqual(3, hits[0]["line"])

        os.environ[documents.DOC_ROOTS_VAR] = root
        self.assertEqual(
            ["docs/specs/platform.md"],
            [hit["path"] for hit in federation.federated_search("federates")["documents"]],
        )
        os.environ.pop(documents.DOC_ROOTS_VAR)
        self.assertEqual([], federation.federated_search("federates")["documents"])

    def test_a_memory_ref_stays_a_one_way_pointer(self) -> None:
        resolved = refs.resolve_ref("memory", "mem_123")
        self.assertFalse(resolved["resolved"])
        self.assertIn("one-way pointer", resolved["detail"])

    def test_an_unknown_commit_is_reported_unresolved_not_raised(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self._dir.name
        resolved = refs.resolve_ref("commit", "0" * 40)
        self.assertFalse(resolved["resolved"])

    def test_a_url_ref_resolves_to_itself_and_garbage_is_refused(self) -> None:
        self.assertTrue(refs.resolve_ref("url", "docs/plan.md")["resolved"])
        with self.assertRaises(ValueError):
            refs.resolve_ref("nonsense", "x")
        with self.assertRaises(ValueError):
            refs.resolve_ref("commit", "  ")

    def test_a_session_ref_resolves_from_observed_sessions_even_by_prefix(self) -> None:
        sessions.op_ingest_session_event(
            self.conn,
            {
                "event": "session_start",
                "session_id": "9f1e2d3c-aaaa-bbbb-cccc-000000000001",
                "client": "claude",
                "cwd": "C:/work/repo",
            },
        )
        exact = refs.resolve_ref("session", "9f1e2d3c-aaaa-bbbb-cccc-000000000001")
        self.assertTrue(exact["resolved"])
        self.assertEqual("claude", exact["client"])
        self.assertEqual("claude", exact["client_family"])
        self.assertEqual("C:/work/repo", exact["cwd"])
        prefix = refs.resolve_ref("session", "9f1e2d3c")
        self.assertTrue(prefix["resolved"])
        self.assertEqual("9f1e2d3c-aaaa-bbbb-cccc-000000000001", prefix["session"])

    def test_an_ambiguous_session_prefix_is_reported_not_guessed(self) -> None:
        for suffix in ("01", "02"):
            sessions.op_ingest_session_event(
                self.conn,
                {
                    "event": "session_start",
                    "session_id": f"77aa88bb-{suffix}",
                    "client": "codex",
                },
            )
        resolved = refs.resolve_ref("session", "77aa88bb")
        self.assertFalse(resolved["resolved"])
        self.assertIn("ambiguous", resolved["detail"])

    def test_a_preregistry_transcript_still_yields_directory_and_full_id(self) -> None:
        # Sessions older than the platform's registry exist only as transcripts;
        # the first record still names the directory an opener needs.
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        project = os.path.join(home.name, ".claude", "projects", "c--old-repo")
        os.makedirs(project)
        full = "ab12cd34-9999-8888-7777-666655554444"
        with open(os.path.join(project, f"{full}.jsonl"), "w", encoding="utf-8") as handle:
            # Real transcripts open with summary records that carry no cwd.
            handle.write('{"type": "summary", "summary": "old work"}\n')
            handle.write(f'{{"cwd": "C:\\\\old\\\\repo", "sessionId": "{full}"}}\n')
        variable = "USERPROFILE" if os.name == "nt" else "HOME"
        previous = os.environ.get(variable)
        os.environ[variable] = home.name
        try:
            answer = refs.resolve_ref("session", "ab12cd34")
        finally:
            if previous is None:
                os.environ.pop(variable, None)
            else:
                os.environ[variable] = previous
        self.assertTrue(answer["resolved"])
        self.assertEqual(full, answer["session"])
        self.assertEqual("claude", answer["client"])
        self.assertEqual("C:\\old\\repo", answer["cwd"])

    def test_http_session_ref_keeps_transcript_fallback_and_root_context(self) -> None:
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        project = os.path.join(home.name, ".claude", "projects", "c--old-repo")
        os.makedirs(project)
        full = "cd34ef56-9999-8888-7777-666655554444"
        with open(os.path.join(project, f"{full}.jsonl"), "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"cwd": "C:\\old\\repo", "sessionId": full}) + "\n")
        variable = "USERPROFILE" if os.name == "nt" else "HOME"
        previous = os.environ.get(variable)
        os.environ[variable] = home.name
        captured: dict[str, object] = {}
        handler = object.__new__(http_surface.Handler)
        handler.path = f"/api/ref?kind=session&value={full[:8]}"
        handler._require_host = mock.Mock(return_value=True)
        handler._send = lambda code, body, content_type: captured.update(
            code=code, body=body, content_type=content_type
        )
        try:
            handler.do_GET()
        finally:
            if previous is None:
                os.environ.pop(variable, None)
            else:
                os.environ[variable] = previous
        answer = json.loads(captured["body"])
        self.assertTrue(answer["resolved"])
        self.assertEqual(full, answer["session"])
        self.assertEqual("claude", answer["client"])
        self.assertEqual("C:\\old\\repo", answer["session_cwd"])
        self.assertEqual("missing", answer["space_root"]["status"])
        self.assertIsNone(answer["space_root"]["resource_ref"])
        self.assertEqual("", answer["space_root"]["effective_cwd"])
        self.assertFalse(answer["space_root"]["fallback"])


class WorkItemGraphTests(unittest.TestCase):
    """The graph must make the ready frontier obvious and never hang on a cycle."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        self.conn = store.connect()
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        os.environ["VALKAMA_DB"] = SUITE_STORE
        self._dir.cleanup()

    def item(self, title: str, **fields) -> str:
        record = planning.create_work_item(self.conn, space="TST", title=title, **fields)
        self.conn.commit()
        return str(record["reference"])

    def blocks(self, blocker: str, blocked: str) -> None:
        planning.link_work_items(self.conn, blocker, blocked, "blocks")
        self.conn.commit()

    def nodes(self, key: str = "reference") -> dict:
        return {node[key]: node for node in planning_views.graph_payload(self.conn)["nodes"]}

    def test_depth_counts_open_blockers_and_a_closed_one_frees_the_chain(self) -> None:
        first = self.item("first")
        second = self.item("second")
        third = self.item("third")
        self.blocks(first, second)
        self.blocks(second, third)

        depths = {reference: node["depth"] for reference, node in self.nodes().items()}
        self.assertEqual({first: 0, second: 1, third: 2}, depths)
        ready = {reference for reference, node in self.nodes().items() if node["ready"]}
        self.assertEqual({first}, ready, "only the head of the chain is workable")

        planning.transition_work_item(self.conn, first, "done", force=True)
        self.conn.commit()
        self.assertEqual(0, self.nodes()[second]["depth"], "a closed blocker no longer counts")

    def test_a_container_is_never_offered_as_workable(self) -> None:
        epic = self.item("epic", kind="epic", state="todo")
        child = self.item("child", state="todo", parent=epic)
        nodes = self.nodes()
        self.assertTrue(nodes[epic]["container"])
        self.assertFalse(nodes[epic]["ready"], "a container is not work")
        self.assertTrue(nodes[child]["ready"])

    def test_parents_and_provenance_become_edges(self) -> None:
        epic = self.item("epic", kind="epic")
        child = self.item("child", parent=epic)
        found = self.item("found")
        planning.link_work_items(self.conn, found, child, "discovered-from")
        self.conn.commit()
        by_reference = {
            node["work_item_id"]: node["reference"]
            for node in planning_views.graph_payload(self.conn)["nodes"]
        }
        kinds = {
            (by_reference[edge["from"]], by_reference[edge["to"]], edge["kind"])
            for edge in planning_views.graph_payload(self.conn)["edges"]
        }
        self.assertIn((epic, child, "parent"), kinds)
        self.assertIn((found, child, "discovered-from"), kinds)

    def test_a_blocks_cycle_does_not_hang_the_projection(self) -> None:
        left = self.item("left")
        right = self.item("right")
        self.blocks(left, right)
        self.blocks(right, left)
        payload = planning_views.graph_payload(self.conn)
        self.assertEqual(2, len(payload["nodes"]))
        self.assertTrue(all(node["depth"] >= 0 for node in payload["nodes"]))
        self.assertEqual(
            set(),
            {node["reference"] for node in payload["nodes"] if node["ready"]},
            "items inside a cycle are not offered as workable",
        )

    def test_mermaid_marks_the_frontier_and_survives_quotes(self) -> None:
        speaking = self.item('say "hello"', state="todo")
        blocked = self.item("waiting", state="todo")
        self.blocks(speaking, blocked)
        text = planning_views.graph_mermaid(planning_views.graph_payload(self.conn))
        self.assertTrue(text.startswith("flowchart LR"))
        self.assertIn("say 'hello'", text)
        self.assertIn(f"class {speaking.replace('-', '_')} ready", text)
        self.assertNotIn(f"class {blocked.replace('-', '_')} ready", text)
        self.assertIn(
            f"{speaking.replace('-', '_')} --> {blocked.replace('-', '_')}",
            text,
        )


class SessionMonitorTests(unittest.TestCase):
    """The normalized session ingest and the monitor read model."""

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        os.environ["VALKAMA_DB"] = os.path.join(self._dir.name, "test.sqlite3")
        self.conn = store.connect()
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
        self.conn.commit()

    def tearDown(self) -> None:
        self.conn.close()
        os.environ["VALKAMA_DB"] = SUITE_STORE
        self._dir.cleanup()

    def ingest(self, **payload) -> dict:
        return sessions.op_ingest_session_event(self.conn, payload)

    def item(self, title: str, space: str = "TST") -> str:
        record = planning.create_work_item(self.conn, space=space, title=title)
        self.conn.commit()
        return str(record["reference"])

    def test_session_lifecycle_and_stream_autopurge(self) -> None:
        self.ingest(
            session_id="s1",
            client="claude",
            event="session_start",
            cwd="C:/work",
            label="fix the parser",
        )
        self.ingest(session_id="s1", client="claude", event="tool_start", tool="Bash")
        self.ingest(session_id="s1", client="claude", event="tool_end", tool="Bash", status="ok")
        live = sessions.sessions_payload(self.conn)
        self.assertEqual(1, len(live["sessions"]))
        row = live["sessions"][0]
        self.assertEqual("active", row["status"])
        self.assertEqual("Bash", row["current_step"])
        self.assertEqual("fix the parser", row["label"])
        self.assertEqual([], live["inbox"], "a healthy live session rings nothing")

        self.ingest(session_id="s1", client="claude", event="session_end")
        after = sessions.sessions_payload(self.conn)
        row = after["sessions"][0]
        self.assertEqual("ended", row["status"])
        self.assertEqual("ended", row["attention"])
        self.assertEqual([row["id"]], [item["id"] for item in after["inbox"]])
        kinds = [(e["klass"], e["kind"]) for e in sessions.session_feed(self.conn, "s1")["events"]]
        self.assertNotIn(
            "stream", {klass for klass, _ in kinds}, "an ended session keeps analytics only"
        )
        self.assertIn(("analytics", "tool_end"), kinds)

    def test_session_identity_is_typed_and_a_new_start_repairs_stale_reporter_identity(
        self,
    ) -> None:
        self.ingest(session_id="identity", client="codex", event="tool_start", tool="Read")
        first = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("codex", first["client"])
        self.assertEqual("codex", first["client_family"])
        self.assertEqual("codex-sessions", first["adapter_id"])

        self.ingest(session_id="identity", client="claude-code", event="session_start")
        repaired = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("claude-code", repaired["client"])
        self.assertEqual("claude", repaired["client_family"])
        self.assertEqual("claude-sessions", repaired["adapter_id"])

    def test_a_finished_turn_waits_without_ending_the_session(self) -> None:
        self.ingest(session_id="t1", client="claude", event="session_start")
        self.ingest(session_id="t1", client="claude", event="turn_end")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("active", row["status"], "a turn is not a session")
        self.assertEqual("waiting", row["attention"])
        self.assertIsNone(row["ended_at"])

        # The owner replied and the session went back to work: the inbox must
        # clear itself rather than requiring an acknowledgement per turn.
        self.ingest(session_id="t1", client="claude", event="tool_start", tool="Read")
        after = sessions.sessions_payload(self.conn)
        self.assertEqual("", after["sessions"][0]["attention"])
        self.assertEqual([], after["inbox"])

    def test_a_turn_end_never_downgrades_a_finished_session(self) -> None:
        self.ingest(session_id="t2", client="claude", event="session_end", status="error")
        self.ingest(session_id="t2", client="claude", event="turn_end")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("failed", row["status"])
        self.assertEqual("failed", row["attention"])

    def test_resumed_work_clears_an_active_attention_reason(self) -> None:
        self.ingest(session_id="t3", client="claude", event="attention", status="blocked")
        self.ingest(session_id="t3", client="claude", event="tool_end", tool="Bash")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("", row["attention"])
        self.assertEqual("", row["current_step"])

    def test_durable_boundary_hides_prior_step_until_new_work(self) -> None:
        self.ingest(session_id="boundary", client="claude", event="tool_start", tool="Read")
        self.assertEqual(
            "Read", sessions.sessions_payload(self.conn)["sessions"][0]["current_step"]
        )
        self.ingest(session_id="boundary", client="claude", event="attention", status="blocked")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("blocked", row["attention"])
        self.assertEqual("", row["current_step"])

        self.ingest(session_id="boundary", client="claude", event="step", detail="retrying")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("", row["attention"])
        self.assertEqual("step", row["current_step"])

        self.ingest(session_id="boundary", client="claude", event="turn_end")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("waiting", row["attention"])
        self.assertEqual("", row["current_step"])

        self.ingest(session_id="boundary", client="claude", event="tool_start", tool="Bash")
        self.assertEqual(
            "Bash", sessions.sessions_payload(self.conn)["sessions"][0]["current_step"]
        )
        self.ingest(session_id="boundary", client="claude", event="session_end")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("ended", row["status"])
        self.assertEqual("", row["current_step"])

    def test_failed_terminal_requires_explicit_session_start_to_reopen(self) -> None:
        self.ingest(session_id="terminal", client="claude", event="session_end", status="failed")
        self.ingest(session_id="terminal", client="claude", event="attention", status="blocked")
        self.ingest(session_id="terminal", client="claude", event="tool_start", tool="Read")
        self.ingest(session_id="terminal", client="claude", event="session_end", status="ok")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("failed", row["status"])
        self.assertEqual("failed", row["attention"])
        self.assertEqual("", row["current_step"], "a late step cannot reopen a terminal session")

        self.ingest(session_id="terminal", client="claude", event="session_start")
        self.ingest(session_id="terminal", client="claude", event="step", detail="resumed")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("active", row["status"])
        self.assertEqual("", row["attention"])
        self.assertEqual("step", row["current_step"])

    def test_stale_is_a_controlled_read_model_not_a_status(self) -> None:
        self.ingest(session_id="quiet", client="codex", event="tool_start", tool="Read")
        self.conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = 'quiet'",
            ("2026-01-01T00:00:00Z",),
        )
        self.conn.commit()
        fresh = sessions.sessions_payload(
            self.conn, now=dt.datetime(2026, 1, 1, 0, 4, 59, tzinfo=dt.UTC)
        )["sessions"][0]
        self.assertEqual("active", fresh["status"])
        self.assertEqual("connected", fresh["presence"])
        self.assertNotIn("stale", fresh)
        self.assertEqual("Read", fresh["current_step"])

        stale = sessions.sessions_payload(
            self.conn, now=dt.datetime(2026, 1, 1, 0, 5, 0, tzinfo=dt.UTC)
        )["sessions"][0]
        self.assertEqual("active", stale["status"])
        self.assertEqual("stale", stale["presence"])
        self.assertNotIn("stale", stale)
        self.assertEqual("", stale["current_step"])

    def test_analytics_environment_and_tool_queries_are_forwarded_without_epic(self) -> None:
        calls = []
        original = analytics.project_space
        analytics.project_space = lambda _conn, space, **kwargs: (
            calls.append((space, kwargs)) or {"space": space}
        )
        try:
            result = http_surface.dashboard_projection(
                self.conn,
                {"space": ["TST"], "environment": ["worktree"], "tool": ["Read"], "epic": ["9"]},
            )
        finally:
            analytics.project_space = original
        self.assertEqual({"space": "TST"}, result)
        self.assertEqual("worktree", calls[0][1]["environment"])
        self.assertEqual("Read", calls[0][1]["tool"])
        self.assertNotIn("epic", calls[0][1])
        self.assertEqual(
            {"space": "TST", "environment": "worktree", "tool": "Read"},
            http_surface._dashboard_sse_parameters(
                "TST", {"environment": ["worktree"], "tool": ["Read"], "epic": ["9"]}
            ),
        )

    def test_analytics_records_the_mcp_server_and_tool(self) -> None:
        self.ingest(
            session_id="s2",
            client="claude",
            event="tool_end",
            tool="claim_card",
            server="valkama",
            status="ok",
        )
        events = sessions.session_feed(self.conn, "s2")["events"]
        self.assertEqual("valkama", events[0]["server"])
        self.assertEqual("claim_card", events[0]["tool"])
        self.assertEqual("analytics", events[0]["klass"])

    def test_attention_rings_the_inbox_until_seen(self) -> None:
        self.ingest(
            session_id="s3",
            client="claude",
            event="attention",
            status="blocked",
            detail={"message": "permission needed"},
        )
        inbox = sessions.sessions_payload(self.conn)["inbox"]
        self.assertEqual(["blocked"], [item["attention"] for item in inbox])
        sessions.op_mark_attention_seen(self.conn, "s3")
        self.assertEqual([], sessions.sessions_payload(self.conn)["inbox"])

    def test_a_resumed_session_clears_stale_attention(self) -> None:
        self.ingest(session_id="s4", client="codex", event="session_end")
        self.ingest(session_id="s4", client="codex", event="session_start")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("active", row["status"])
        self.assertEqual("", row["attention"])
        self.assertIsNone(row["ended_at"])

    def test_failed_end_is_distinguished(self) -> None:
        self.ingest(session_id="s5", client="codex", event="session_end", status="error")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual("failed", row["status"])
        self.assertEqual("failed", row["attention"])

    def test_a_launched_session_reports_its_work_item_directly(self) -> None:
        reference = self.item("launched work")
        self.ingest(
            session_id="ls1",
            client="claude",
            event="session_start",
            work_item=reference,
            launch_id="launch-abc",
        )
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual(reference, row["work_item"])

    def test_session_root_uses_only_the_exact_owner_binding_resource_ref(self) -> None:
        reference = self.item("bound work")
        observed = os.path.join(self._dir.name, "observed")
        canonical = os.path.join(self._dir.name, "canonical")
        os.makedirs(observed)
        os.makedirs(canonical)
        self.ingest(
            session_id="exact-binding",
            client="claude",
            event="session_start",
            cwd=observed,
            work_item=reference,
        )
        resource_ref = planning_space_entity(
            {
                "data_scope_id": read_store_metadata(self.conn)["data_scope_id"],
                "space_key": "TST",
            }
        )
        source_hash = "a" * 64
        binding = {
            "project_id": "test",
            "resource_ref": resource_ref,
            "registry_revision": 1,
            "source_owner": "test",
            "source_hash": source_hash,
        }
        bound = registry_bytes(
            [
                project_entry(
                    "test",
                    canonical,
                    board="Unrelated presentation title",
                    bindings=[binding],
                    source_hash=source_hash,
                )
            ]
        )
        with mock.patch.object(project_registry, "_read_registry_bytes", return_value=bound):
            root = sessions.sessions_payload(self.conn)["sessions"][0]["space_root"]
        self.assertEqual("mapped", root["status"])
        self.assertEqual(resource_ref, root["resource_ref"])
        self.assertEqual(canonical, root["effective_cwd"])
        self.assertEqual(observed, root["session_cwd"])
        self.assertNotIn("registry_path", root)

        title_only = registry_bytes(
            [project_entry("test", canonical, board="TST", source_hash=source_hash)]
        )
        with mock.patch.object(project_registry, "_read_registry_bytes", return_value=title_only):
            refused = sessions.sessions_payload(self.conn)["sessions"][0]["space_root"]
        self.assertEqual("missing", refused["status"])
        self.assertEqual("", refused["effective_cwd"])

    def test_a_session_linked_across_spaces_is_not_cross_mapped(self) -> None:
        planning.create_planning_space(self.conn, project_id="other", name="Other", key="OTH")
        self.conn.commit()
        first = self.item("first")
        second = self.item("second", space="OTH")
        self.ingest(
            session_id="cross-space", client="claude", event="session_start", cwd="C:/observed"
        )
        planning.attach_ref(self.conn, first, "session", "cross-space")
        planning.attach_ref(self.conn, second, "session", "cross-space")
        self.conn.commit()

        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertNotIn("planning_space", row)
        self.assertIsNone(row["work_item"])
        self.assertEqual("ambiguous", row["space_root"]["status"])
        self.assertIsNone(row["space_root"]["resource_ref"])
        self.assertEqual("", row["space_root"]["effective_cwd"])
        self.assertEqual("C:/observed", row["space_root"]["session_cwd"])
        self.assertFalse(row["space_root"]["fallback"])
        self.assertNotIn("registry_path", row["space_root"])
        resolved = sessions.session_context(self.conn, "cross-space")
        self.assertFalse(resolved["resolved"])
        self.assertEqual("ambiguous", resolved["status"])
        self.assertEqual("ambiguous", resolved["space_root"]["status"])
        self.assertIsNone(resolved["space_root"]["resource_ref"])
        self.assertEqual("", resolved["space_root"]["effective_cwd"])
        self.assertFalse(resolved["space_root"]["fallback"])

    def test_an_unknown_work_item_is_ignored_rather_than_written(self) -> None:
        self.ingest(session_id="ls2", client="claude", event="session_start", work_item="TST-9999")
        self.assertIsNone(sessions.sessions_payload(self.conn)["sessions"][0]["work_item"])
        with self.assertRaisesRegex(ValueError, "work_item must be a reference"):
            self.ingest(session_id="ls3", client="claude", event="step", work_item=7)

    def test_sessions_link_to_work_items_through_session_refs(self) -> None:
        reference = self.item("watched work")
        planning.attach_ref(self.conn, reference, "session", "s6")
        self.conn.commit()
        self.ingest(session_id="s6", client="claude", event="step", detail="thinking")
        row = sessions.sessions_payload(self.conn)["sessions"][0]
        self.assertEqual(reference, row["work_item"])

    def test_stream_tail_is_bounded_and_analytics_is_not(self) -> None:
        for index in range(sessions.STREAM_TAIL_PER_SESSION + 25):
            self.ingest(session_id="s7", client="claude", event="tool_start", tool=f"Tool{index}")
            self.ingest(
                session_id="s7", client="claude", event="tool_end", tool=f"Tool{index}", status="ok"
            )
        counts = dict(
            self.conn.execute(
                "SELECT klass, COUNT(*) FROM session_events WHERE session_id = 's7' GROUP BY klass"
            ).fetchall()
        )
        self.assertEqual(sessions.STREAM_TAIL_PER_SESSION, counts["stream"])
        self.assertEqual(sessions.STREAM_TAIL_PER_SESSION + 25, counts["analytics"])

    def test_manual_purge_spares_active_sessions_by_default(self) -> None:
        self.ingest(session_id="live", client="claude", event="tool_start", tool="Bash")
        self.ingest(session_id="gone", client="claude", event="tool_start", tool="Bash")
        # End "gone" without the autopurge wiping what this test measures.
        self.conn.execute("UPDATE sessions SET status = 'ended' WHERE id = 'gone'")
        self.conn.commit()
        purged = sessions.purge_stream_events(self.conn)
        self.assertEqual(1, purged["purged_stream_events"])
        remaining = [
            r[0]
            for r in self.conn.execute(
                "SELECT session_id FROM session_events WHERE klass = 'stream'"
            ).fetchall()
        ]
        self.assertEqual(["live"], remaining)
        purged_all = sessions.purge_stream_events(self.conn, include_active=True)
        self.assertEqual(1, purged_all["purged_stream_events"])

    def test_retention_keeps_the_recent_tail_and_never_analytics(self) -> None:
        self.ingest(session_id="r1", client="claude", event="tool_start", tool="Old")
        self.ingest(session_id="r1", client="claude", event="tool_end", tool="Old")
        self.conn.execute(
            "UPDATE session_events SET created_at = '2026-06-01T00:00:00Z' WHERE session_id = 'r1'"
        )
        self.conn.commit()
        self.ingest(session_id="r1", client="claude", event="tool_start", tool="New")

        purged = sessions.purge_stream_events(self.conn, include_active=True, older_than_days=14)
        self.assertEqual(1, purged["purged_stream_events"], "only the old stream row")
        remaining = [
            (event["klass"], event["tool"])
            for event in sessions.session_feed(self.conn, "r1")["events"]
        ]
        self.assertIn(("stream", "New"), remaining)
        self.assertIn(("analytics", "Old"), remaining)
        self.assertNotIn(("stream", "Old"), remaining)

    def test_ingest_rejects_garbage(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown session event"):
            self.ingest(session_id="x", client="claude", event="explode")
        with self.assertRaisesRegex(ValueError, "session_id is required"):
            self.ingest(session_id="", client="claude", event="step")
        with self.assertRaisesRegex(ValueError, "client is required"):
            self.ingest(session_id="x", client="", event="step")
        oversized = {"blob": "x" * (sessions.SESSION_DETAIL_LIMIT + 100)}
        self.ingest(session_id="x", client="claude", event="step", detail=oversized)
        stored = sessions.session_feed(self.conn, "x")["events"][0]["detail"]
        self.assertEqual('{"truncated":true}', stored)


if __name__ == "__main__":
    unittest.main()
