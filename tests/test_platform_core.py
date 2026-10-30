from __future__ import annotations

import http.client
import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, store, watchers
from server.planning import service as planning_service
from server.platform import core as platform_core
from server.platform import migrations as platform_migrations
from server.platform import modules as platform_modules
from tests import SUITE_STORE, schema8


def _tables(conn: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    ]


class InitializeTests(unittest.TestCase):
    """What bringing a store up writes in the platform tables, and what it no longer does."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.db})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_fresh_store_gets_its_identity_and_none_of_the_retired_tables(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        tables = _tables(conn)
        self.assertEqual(
            ["platform_store_metadata", "platform_ui_prefs"],
            [name for name in tables if name.startswith("platform_")],
        )
        self.assertNotIn("integration_settings", tables)
        self.assertEqual(
            1, conn.execute("SELECT COUNT(*) FROM platform_store_metadata").fetchone()[0]
        )

    def test_reopening_a_store_writes_nothing(self) -> None:
        store.connect().close()
        observer = sqlite3.connect(self.db)
        self.addCleanup(observer.close)
        before = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(before, observer.execute("PRAGMA data_version").fetchone()[0])

    def test_a_current_store_holding_a_retired_table_is_refused_and_left_alone(self) -> None:
        # Schema 9 never holds these tables. One that does was not migrated by
        # this product, and repairing it silently would hide that.
        store.connect().close()
        raw = sqlite3.connect(self.db)
        schema8.restore_catalog(raw)
        raw.commit()
        held = _tables(raw)
        raw.close()
        with self.assertRaisesRegex(
            platform_migrations.CatalogMigrationError, "undeclared platform tables"
        ):
            store.connect()
        raw = sqlite3.connect(self.db)
        self.addCleanup(raw.close)
        self.assertEqual(held, _tables(raw))
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, raw.execute("PRAGMA user_version").fetchone()[0]
        )

    def test_a_current_store_holding_the_integration_switches_is_refused(self) -> None:
        # The one retired table without the `platform_` prefix.
        store.connect().close()
        raw = sqlite3.connect(self.db)
        raw.execute("CREATE TABLE integration_settings(key TEXT PRIMARY KEY, value TEXT)")
        raw.commit()
        raw.close()
        with self.assertRaisesRegex(
            platform_migrations.CatalogMigrationError, "integration_settings"
        ):
            store.connect()

    def test_initialize_needs_an_explicit_connection(self) -> None:
        with self.assertRaises(TypeError):
            platform_core.initialize(None, self.db)


class PlatformHttpBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.directory.name, "http.sqlite3")
        self.registry = os.path.join(self.directory.name, "projects.json")
        self.previous_db = os.environ.get("VALKAMA_DB")
        os.environ["VALKAMA_DB"] = self.db
        with open(self.registry, "w", encoding="utf-8") as handle:
            json.dump({"projects": []}, handle)
        self.registry_reader_patch = mock.patch.object(
            store.project_registry,
            "_read_registry_bytes",
            new=Path(self.registry).read_bytes,
        )
        self.registry_reader_patch.start()
        store.connect().close()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=Path(self.directory.name) / "installation-token",
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.write_headers = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{self.server.server_port}",
            "X-Valkama-Session": self.server.security_context.browser_session_token,
        }

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.registry_reader_patch.stop()
        if self.previous_db is None:
            os.environ["VALKAMA_DB"] = SUITE_STORE
        else:
            os.environ["VALKAMA_DB"] = self.previous_db
        self.directory.cleanup()

    def _get(self, path):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request("GET", path)
            response = client.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            client.close()

    def _send(self, method, path, payload):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request(
                method,
                path,
                body=json.dumps(payload).encode("utf-8"),
                headers=self.write_headers,
            )
            response = client.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            client.close()

    def _post(self, path, payload):
        return self._send("POST", path, payload)

    def _put(self, path, payload):
        return self._send("PUT", path, payload)

    def test_replacement_module_endpoint_and_legacy_integration_404(self) -> None:
        status, content_type, body = self._get("/api/modules")
        self.assertEqual(200, status)
        self.assertEqual("application/json", content_type)
        self.assertEqual("valkama-modules", json.loads(body)["interface_version"])
        self.assertEqual(404, self._get("/api/integrations")[0])
        self.assertEqual(404, self._post("/api/integrations/agentmemory", {})[0])

    def test_platform_reads_that_remain_answer_and_the_registry_routes_are_gone(self) -> None:
        for path, version in (
            ("/api/platform/context?scope_kind=global", "valkama-context"),
            ("/api/platform/planning?scope_kind=global", "valkama-planning"),
        ):
            with self.subTest(path=path):
                status, content_type, body = self._get(path)
                self.assertEqual(200, status)
                self.assertEqual("application/json", content_type)
                self.assertEqual(version, json.loads(body)["interface_version"])
        for path in ("/api/platform/registry", "/api/platform/registry?scope_kind=global"):
            with self.subTest(path=path):
                self.assertEqual(404, self._get(path)[0])
        for path in (
            "/api/platform/relations",
            "/api/platform/actions/invoke",
            "/api/platform/assignments/activation",
            "/api/platform/assignments/selection",
            "/api/platform/grants/revoke",
        ):
            with self.subTest(path=path):
                status, content_type, body = self._post(path, {})
                self.assertEqual(404, status)
                self.assertEqual("not_found", json.loads(body)["error"]["code"])

    def test_the_module_list_is_the_builds_and_nothing_changes_it(self) -> None:
        status, _, body = self._get("/api/modules")
        self.assertEqual(200, status)
        self.assertEqual(platform_modules.modules_payload(), json.loads(body))
        status, content_type, body = self._post(
            "/api/modules/state",
            {"module_id": "memory", "state": "disabled", "expected_revision": 1},
        )
        self.assertEqual(404, status)
        self.assertEqual("application/json", content_type)
        self.assertEqual("not_found", json.loads(body)["error"]["code"])
        self.assertEqual(
            platform_modules.modules_payload(), json.loads(self._get("/api/modules")[2])
        )

    def test_retired_routes_and_event_views_stay_retired(self) -> None:
        for path in (
            "/api/dashboard",
            "/api/sessions",
            "/api/modules/skills",
            "/api/modules/improvements",
        ):
            with self.subTest(path=path):
                self.assertEqual(404, self._get(path)[0])
        for view in ("sessions", "analytics", "dashboard", "improvements", ""):
            with self.subTest(view=view):
                status, _, body = self._get(f"/api/events?view={view}")
                self.assertEqual(400, status)
                self.assertEqual("error", json.loads(body)["status"])
        self.assertEqual(
            404, self._put("/api/modules/improvements/profile", {"scope": "personal"})[0]
        )

    def test_unknown_sse_view_is_rejected(self) -> None:
        self.assertEqual(400, self._get("/api/events?view=not-registered")[0])

    def test_an_open_stream_pushes_a_write_another_connection_commits(self) -> None:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        response = None
        try:
            client.request("GET", "/api/events?view=spaces")
            response = client.getresponse()
            self.assertEqual(200, response.status)
            first = response.readline()
            self.assertTrue(first.startswith(b"data: "))
            self.assertNotIn(b"Streamed", first)
            self.assertEqual(b"\n", response.readline())
            writer = store.connect()
            try:
                planning_service.create_planning_space(
                    writer, project_id="streamed", name="Streamed", key="STR"
                )
                writer.commit()
            finally:
                writer.close()
            line = response.readline()
            while line.startswith(b":") or line == b"\n":
                line = response.readline()
            self.assertTrue(line.startswith(b"data: "))
            self.assertIn(b"Streamed", line)
        finally:
            # The response holds the socket open as long as the connection does.
            if response is not None:
                response.close()
            client.close()
        # The handler notices the closed socket on its next keep-alive and lets
        # go of the store; the directory cannot be removed while it holds it.
        deadline = time.monotonic() + 3
        while watchers.WATCHERS._queues and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual([], watchers.WATCHERS._queues)

    def test_only_canonical_extensionless_platform_routes_receive_spa_fallback(self) -> None:
        status, content_type, _ = self._get("/modules/planning/global")
        self.assertEqual(200, status)
        self.assertEqual("text/html; charset=utf-8", content_type)
        unknown_status, unknown_type, _ = self._get("/modules/not-a-module/global")
        self.assertEqual(200, unknown_status)
        self.assertEqual("text/html; charset=utf-8", unknown_type)
        self.assertEqual(404, self._get("/modules/not_a_module/global")[0])
        self.assertEqual(404, self._get("/modules/planning/global.js")[0])
        self.assertEqual(404, self._get("/modules/adapter.notes/global")[0])
        self.assertEqual(404, self._get("/modules/../planning/global")[0])
        self.assertEqual(404, self._get("/assets/not-present.js")[0])


if __name__ == "__main__":
    unittest.main()
