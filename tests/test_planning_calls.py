"""Who made a Planning write: the verification rules, and the browser's channel.

The MCP wire half lives with the stdio loop in `test_mcp_surface.py`. Here are
the rules on their own, where every combination a client can send is one line,
and the HTTP surface, where the authorized browser is the one writer the server
verifies without any client's help.
"""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, store
from server.planning import calls, service

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
THREAD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
TOOL_USE = "toolu_01ABCdefGHIjklMNOpqrSTU"
HOOK = {"session_id": SESSION, "tool_use_id": TOOL_USE}


class VerificationTests(unittest.TestCase):
    def verdict(self, meta: object, argument: object = None) -> tuple:
        identity = calls.verify_mcp(meta, argument)
        return identity.state, identity.source, identity.session_id, identity.agent_id

    def test_each_combination_a_client_can_send(self) -> None:
        cases = [
            ("codex main thread", {"sessionId": SESSION, "threadId": SESSION}, None,
             ("confirmed", "codex-meta", SESSION, None)),
            ("codex subagent", {"sessionId": SESSION, "threadId": THREAD}, None,
             ("confirmed", "codex-meta", SESSION, THREAD)),
            ("codex with an agreeing hook", {"sessionId": SESSION, "callId": TOOL_USE}, HOOK,
             ("confirmed", "codex-meta", SESSION, None)),
            ("codex subagent with its hook",
             {"sessionId": SESSION, "threadId": THREAD, "callId": TOOL_USE},
             {**HOOK, "agent_id": THREAD},
             ("confirmed", "codex-meta", SESSION, THREAD)),
            ("codex, hook names another session", {"sessionId": SESSION},
             {**HOOK, "session_id": "other"},
             ("unconfirmed", "codex-meta-mismatch", SESSION, None)),
            ("codex, hook names another call", {"sessionId": SESSION, "callId": "call_1"}, HOOK,
             ("unconfirmed", "codex-meta-mismatch", SESSION, None)),
            ("claude, toolUseId matches", {"claudecode/toolUseId": TOOL_USE}, HOOK,
             ("confirmed", "claude-hook", SESSION, None)),
            ("claude subagent", {"claudecode/toolUseId": TOOL_USE}, {**HOOK, "agent_id": "a1"},
             ("confirmed", "claude-hook", SESSION, "a1")),
            ("claude, toolUseId differs", {"claudecode/toolUseId": "toolu_other"}, HOOK,
             ("unconfirmed", "claude-hook-mismatch", SESSION, None)),
            ("claude, no toolUseId to check", {}, HOOK,
             ("unconfirmed", "claude-hook-unverified", SESSION, None)),
            ("nothing", {}, None, ("unconfirmed", "mcp", None, None)),
            ("meta that is not an object", "junk", None, ("unconfirmed", "mcp", None, None)),
            ("an empty sessionId", {"sessionId": ""}, None, ("unconfirmed", "mcp", None, None)),
            ("a malformed hook", {"claudecode/toolUseId": TOOL_USE}, {"session_id": SESSION},
             ("unconfirmed", "mcp", None, None)),
        ]  # fmt: skip
        for label, meta, argument, expected in cases:
            with self.subTest(label):
                self.assertEqual(expected, self.verdict(meta, argument))

    def test_the_identity_argument_contract(self) -> None:
        self.assertEqual(HOOK, calls.identity_argument(HOOK))
        self.assertEqual(
            {**HOOK, "agent_id": "a1", "agent_type": "Explore"},
            calls.identity_argument({**HOOK, "agent_id": "a1", "agent_type": "Explore"}),
        )
        # A field the contract does not name is left behind, not refused.
        self.assertEqual(HOOK, calls.identity_argument({**HOOK, "prompt_id": "p"}))
        for malformed in (
            None,
            "session",
            [SESSION],
            {"session_id": SESSION},
            {"tool_use_id": TOOL_USE},
            {**HOOK, "session_id": ""},
            {**HOOK, "tool_use_id": 7},
            {**HOOK, "agent_id": 7},
            {**HOOK, "session_id": "s" * 201},
            {**HOOK, "session_id": "a\x00b"},
        ):
            with self.subTest(malformed=malformed):
                self.assertIsNone(calls.identity_argument(malformed))

    def test_every_value_written_is_one_the_code_declares(self) -> None:
        produced = {
            calls.verify_mcp(meta, argument)
            for meta, argument in (
                ({"sessionId": SESSION}, None),
                ({"sessionId": SESSION}, {**HOOK, "session_id": "x"}),
                ({"claudecode/toolUseId": TOOL_USE}, HOOK),
                ({"claudecode/toolUseId": "x"}, HOOK),
                ({}, HOOK),
                ({}, None),
            )
        } | {calls.browser()}
        self.assertLessEqual({identity.state for identity in produced}, set(calls.STATES))
        self.assertLessEqual({identity.source for identity in produced}, set(calls.SOURCES))

    def test_a_write_outside_any_call_points_at_nothing(self) -> None:
        conn = mock.Mock()
        self.assertIsNone(calls.call_id(conn, "item"))
        conn.execute.assert_not_called()


class BrowserWriteTests(unittest.TestCase):
    """A write through the authorized browser channel is the owner's."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        environment = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.root / "valkama.sqlite3"),
                "HOME": str(self.root),
                "USERPROFILE": str(self.root),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="owner", name="Owner", key="OWN")
        item = service.create_work_item(self.conn, space="OWN", title="By hand")
        self.reference = item["reference"]
        self.step = service.set_checklist(self.conn, self.reference, ["one"])["checklist"][0]["id"]
        self.conn.commit()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, path: str, payload: dict) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            client.request(
                "POST",
                path,
                body=json.dumps(payload),
                headers={
                    "Content-Type": "application/json",
                    "Origin": f"http://127.0.0.1:{self.server.server_port}",
                    "X-Valkama-Session": self.server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def rows(self) -> list[dict]:
        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM execution_events WHERE kind='planning_write' ORDER BY id"
            )
        ]

    def test_a_claim_and_a_tick_by_hand_are_signed_by_the_owner(self) -> None:
        status, claimed = self.post("/api/planning/work-item/claim", {"id": self.reference})
        self.assertEqual(200, status, claimed)
        self.assertEqual("user", claimed["claim_ref"])
        status, ticked = self.post(
            "/api/planning/work-item/checklist/tick", {"id": self.reference, "item_id": self.step}
        )
        self.assertEqual(200, status, ticked)
        self.assertEqual("user", ticked["checklist"][0]["done_by"])
        events = {event["action"]: event for event in ticked["events"]}
        for action in ("claimed", "checklist_completed"):
            with self.subTest(action):
                self.assertEqual("user", events[action]["author"])
                self.assertEqual(
                    {
                        "state": "confirmed",
                        "source": "browser",
                        "session_id": None,
                        "agent_id": None,
                    },
                    events[action]["identity"],
                )
        self.assertEqual(
            [
                ("/api/planning/work-item/claim", "browser", "confirmed"),
                ("/api/planning/work-item/checklist/tick", "browser", "confirmed"),
            ],
            [(row["tool"], row["client"], row["identity_state"]) for row in self.rows()],
        )

    def test_an_author_the_payload_names_is_kept(self) -> None:
        status, claimed = self.post(
            "/api/planning/work-item/claim", {"id": self.reference, "author": "nikolai"}
        )
        self.assertEqual((200, "nikolai"), (status, claimed["claim_ref"]))

    def test_a_refused_browser_write_leaves_no_row(self) -> None:
        status, answer = self.post(
            "/api/planning/work-item/transition", {"id": self.reference, "state": "dev"}
        )
        self.assertEqual(409, status, answer)
        self.assertEqual([], self.rows())

    def test_an_edit_that_logs_no_event_is_still_a_call(self) -> None:
        status, answer = self.post(
            "/api/planning/work-item/update", {"id": self.reference, "title": "Renamed"}
        )
        self.assertEqual(200, status, answer)
        [row] = self.rows()
        self.assertEqual(answer["work_item_id"], row["work_item_id"])


if __name__ == "__main__":
    unittest.main()
