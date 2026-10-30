"""Feature retirement preserves populated agent work and removes admission paths."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from server import http_surface, mcp_surface, sessions, store, store_backups
from server.executions import service as executions
from server.planning import service as planning
from server.platform import migrations, modules
from server.ui_state import PlatformHttpError
from tests import registry_rows
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
        planning.create_planning_space(self.conn, project_id="test", name="Test", key="TST")
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
        # The registry rows a build with the former built-in left behind,
        # including the retired `codex-skills` adapter this migration removes.
        registry_rows.seed(self.conn)
        for module_id, manifest in FORMER_MODULES.items():
            self.conn.execute(
                "INSERT INTO platform_modules VALUES(?,?,'disabled',1,9,'2026-01-01T00:00:00Z')",
                (module_id, json.dumps(manifest)),
            )
        self.conn.execute(
            "INSERT INTO platform_ui_prefs VALUES('last-route',?,'2026-01-01T00:00:00Z')",
            (json.dumps({"module_id": "skills", "scope": {"kind": "global"}}),),
        )
        self.conn.execute(
            "UPDATE platform_modules SET state='disabled',revision=4 WHERE module_id='memory'"
        )
        self.conn.execute("PRAGMA user_version=6")
        self.conn.commit()
        return item

    def test_populated_store_retirement_is_backed_up_idempotent_and_preserves_work(self) -> None:
        item = self.populated_source()
        preserved = (
            "work_items",
            "work_item_events",
            "work_item_refs",
            "sessions",
            "session_events",
            "executions",
            "execution_sessions",
            "platform_adapter_links",
        )
        before = {
            table: [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table}")]
            for table in preserved
        }
        memory = tuple(
            self.conn.execute("SELECT * FROM platform_modules WHERE module_id='memory'").fetchone()
        )
        retained_grants = [
            tuple(row)
            for row in self.conn.execute(
                "SELECT * FROM platform_grants WHERE json_extract(record_json,'$.adapter_lineage_id')!='codex-skills'"
            )
        ]
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, self.conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(
            {"planning", "memory", "settings"},
            {row[0] for row in self.conn.execute("SELECT module_id FROM platform_modules")},
        )
        for table in preserved:
            self.assertEqual(
                before[table],
                [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table}")],
                table,
            )
        self.assertEqual(
            memory,
            tuple(
                self.conn.execute(
                    "SELECT * FROM platform_modules WHERE module_id='memory'"
                ).fetchone()
            ),
        )
        self.assertEqual(
            retained_grants,
            [tuple(row) for row in self.conn.execute("SELECT * FROM platform_grants")],
        )
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM platform_ui_prefs").fetchone()[0]
        )
        self.assertIsNone(
            self.conn.execute(
                "SELECT 1 FROM platform_adapters WHERE adapter_id='codex-skills'"
            ).fetchone()
        )
        self.assertEqual(
            item["reference"], sessions.session_context(self.conn, "exact-sess")["work_item"]
        )
        audit = [
            tuple(row)
            for row in self.conn.execute(
                "SELECT * FROM platform_registry_audit WHERE event_kind='feature.retired'"
            )
        ]
        self.assertEqual(
            migrations.RETIRED_MODULE_IDS, {row[3] for row in audit if row[2] == "module"}
        )
        self.assertFalse(migrations.retire_work_support_modules(self.conn))
        self.conn.commit()
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual(
            audit,
            [
                tuple(row)
                for row in self.conn.execute(
                    "SELECT * FROM platform_registry_audit WHERE event_kind='feature.retired'"
                )
            ],
        )
        snapshots = list((Path(self.path).parent / "backups").glob("*-preproductmodel-*.sqlite3"))
        self.assertEqual(1, len(snapshots))
        backup = sqlite3.connect(snapshots[0])
        self.addCleanup(backup.close)
        self.assertEqual(6, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(7, backup.execute("SELECT COUNT(*) FROM platform_modules").fetchone()[0])
        store_backups.integrity_check(backup, source="retirement recovery point")
        # An old Improvements origin is ordinary Planning provenance after retirement.
        planning.transition_work_item(self.conn, item["reference"], "done")
        self.conn.commit()
        self.assertTrue(
            planning.get_work_item(self.conn, item["reference"])["state"]["is_terminal"]
        )

    def test_retirement_failure_rolls_back_without_stamping_and_reuses_backup(self) -> None:
        self.populated_source()
        self.conn.close()
        with mock.patch.object(
            migrations, "retire_work_support_modules", side_effect=RuntimeError("injected")
        ):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        self.assertEqual(6, raw.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(7, raw.execute("SELECT COUNT(*) FROM platform_modules").fetchone()[0])
        raw.close()
        self.conn = store.connect()
        self.assertEqual(
            3, self.conn.execute("SELECT COUNT(*) FROM platform_modules").fetchone()[0]
        )
        self.assertEqual(
            1, len(list((Path(self.path).parent / "backups").glob("*-preproductmodel-*.sqlite3")))
        )

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
        self.assertEqual({"planning", "memory", "settings"}, modules.module_ids())
        self.assertFalse(any("improvement" in tool["name"] for tool in mcp_surface.catalogue()))

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
