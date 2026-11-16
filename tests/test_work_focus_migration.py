"""Feature retirement preserves populated agent work and removes admission paths."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from server import http_surface, mcp_surface, sessions, store
from server.executions import service as executions
from server.planning import service as planning
from server.platform import modules
from server.ui_state import PlatformHttpError
from tests.retired_modules import FORMER_MODULES


class WorkFocusMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(lambda: self.conn.close())

    def populated_source(self) -> dict:
        planning.create_planning_space(self.conn, name="Test", key="TST")
        item = planning.create_work_item(
            self.conn,
            space="TST",
            title="Preserve work",
            kind="improvement",
            source="improvement://personal/case/old",
        )
        planning.attach_ref(self.conn, item["reference"], "memory", "memory:old")
        planning.attach_ref(self.conn, item["reference"], "session", "exact-session")
        planning.set_summary(
            self.conn,
            item["reference"],
            {"done": "The recorded result remains usable", "next": "No further work"},
        )
        self.conn.commit()
        sessions.op_ingest_session_event(
            self.conn,
            {
                "session_id": "exact-session",
                "client": "claude",
                "event": "session_start",
                "work_item": item["reference"],
            },
        )
        self.conn.execute(
            "INSERT INTO session_events(session_id,klass,kind,tool) VALUES('exact-session','stream','tool_start','Read')"
        )
        attempt = executions.open_execution(
            self.conn,
            execution_id="exec-preserved",
            work_item_id=item["work_item_id"],
            project_id="test",
            packet={
                "client": "claude",
                "role": "executor",
                "environment": "workdir",
                "expected_effect": "change_required",
            },
        )
        executions.link_session(self.conn, attempt, "exact-session", "launched")
        self.conn.commit()
        return item

    def test_lifecycle_only_ingest_preserves_historical_stream_rows(self) -> None:
        self.populated_source()
        before = self.conn.execute("SELECT COUNT(*) FROM session_events").fetchone()[0]
        for event in ("tool_start", "tool_end", "step"):
            with (
                self.subTest(event=event),
                self.assertRaisesRegex(ValueError, "unknown session event"),
            ):
                sessions.op_ingest_session_event(
                    self.conn,
                    {
                        "session_id": "rejected",
                        "client": "codex",
                        "event": event,
                    },
                )
        self.assertIsNone(
            self.conn.execute("SELECT 1 FROM sessions WHERE id='rejected'").fetchone()
        )
        self.assertEqual(
            before, self.conn.execute("SELECT COUNT(*) FROM session_events").fetchone()[0]
        )
        for event in ("attention", "turn_end", "session_end", "session_start"):
            sessions.op_ingest_session_event(
                self.conn,
                {
                    "session_id": "exact-session",
                    "client": "claude",
                    "event": event,
                },
            )
        self.assertEqual(
            1,
            self.conn.execute(
                "SELECT COUNT(*) FROM session_events WHERE klass='stream'"
            ).fetchone()[0],
        )
        self.assertEqual("active", sessions.session_context(self.conn, "exact-session")["status"])

    def test_retired_surfaces_stay_retired(self) -> None:
        for view in ("sessions", "analytics", "dashboard", "improvements"):
            with self.subTest(view=view), self.assertRaises(PlatformHttpError):
                http_surface._require_sse_view(view)
        for path in (
            "/api/sessions",
            "/api/dashboard",
            "/api/dashboard/portfolio",
            "/api/modules/skills",
            "/api/modules/improvements",
        ):
            self.assertIsNone(http_surface._boundary(http_surface._GET_BOUNDARIES, path))
        self.assertTrue({"sessions", "improvements", "skills"}.isdisjoint(modules.module_ids()))
        self.assertFalse(any("improvement" in tool["name"] for tool in mcp_surface.catalogue()))

    def test_usage_analytics_brings_back_none_of_the_flow_metrics(self) -> None:
        # The id is the retired module's; what it declared is not. Usage and quota
        # analytics may not reopen the flow dashboard's read models, events,
        # actions or capability under the old name.
        retired = FORMER_MODULES["analytics"]
        current = next(m for m in modules.module_manifests() if m["module_id"] == "analytics")

        def declared(manifest: dict) -> set[str]:
            return {
                *manifest["required_read_models"],
                *manifest["sse_subscriptions"],
                *manifest["primary_actions"],
                *manifest["secondary_actions"],
                *manifest["feature_capabilities"],
                *(
                    name
                    for level in manifest["semantics"].values()
                    for name in (*level["read_models"], *level["action_semantics"])
                ),
            }

        self.assertTrue(declared(retired))
        self.assertTrue(declared(retired).isdisjoint(declared(current)))

    def test_session_http_returns_compact_exact_context_without_event_feed(self) -> None:
        self.populated_source()
        handler = object.__new__(http_surface.Handler)
        handler.path = "/api/session?id=exact-sess"
        handler.headers = {}
        handler.server = SimpleNamespace()
        handler._require_validated_host = lambda: True
        handler._send = mock.Mock()
        handler.do_GET()
        payload = json.loads(handler._send.call_args.args[1])
        self.assertEqual("exact-session", payload["session"])
        self.assertTrue(payload["resolved"])
        self.assertNotIn("events", payload)
        sessions.op_ingest_session_event(
            self.conn,
            {"session_id": "exact-session-other", "client": "codex", "event": "session_start"},
        )
        self.assertEqual("ambiguous", sessions.session_context(self.conn, "exact-sess")["status"])
        self.assertTrue(sessions.session_context(self.conn, "exact-session")["resolved"])
