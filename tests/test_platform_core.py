from __future__ import annotations

import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, store
from server.platform import core as platform_core
from server.store_identity.primitives import ContractError
from server.ui_state import PlatformHttpError
from tests import SUITE_STORE, registry_rows

# The registry's tables, which a store still declares and nothing writes.
REGISTRY_TABLES = (
    "platform_services",
    "platform_adapters",
    "platform_connections",
    "platform_packages",
    "platform_actions",
    "platform_action_inputs",
    "platform_assignments",
    "platform_grants",
    "platform_core_ref_bindings",
    "platform_known_stores",
    "platform_registry_meta",
)


def _row_counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in (*REGISTRY_TABLES, "platform_modules", "platform_registry_audit")
    }


class InitializeTests(unittest.TestCase):
    """What bringing a store up writes in the platform tables, and what it no longer does."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.db})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_fresh_store_gets_its_identity_and_modules_and_no_registry_rows(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        counts = _row_counts(conn)
        self.assertEqual(dict.fromkeys(REGISTRY_TABLES, 0), {t: counts[t] for t in REGISTRY_TABLES})
        self.assertEqual(
            ["memory", "planning", "settings"],
            [row[0] for row in conn.execute("SELECT module_id FROM platform_modules ORDER BY 1")],
        )
        # Each registration is remembered, which is what keeps a removed module removed.
        self.assertEqual(
            [
                ("memory", "module.registered"),
                ("planning", "module.registered"),
                ("settings", "module.registered"),
            ],
            [
                tuple(row)
                for row in conn.execute(
                    "SELECT entity_id,event_kind FROM platform_registry_audit ORDER BY entity_id"
                )
            ],
        )
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

    def test_a_store_holding_registry_rows_opens_and_keeps_them_untouched(self) -> None:
        # A store as the last registry build left it: its rows are dead data
        # now, and opening the store neither rewrites, removes nor adds to them.
        conn = store.connect()
        try:
            registry_rows.seed(conn)
            conn.commit()
            held = {
                table: conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
                for table in REGISTRY_TABLES
            }
        finally:
            conn.close()
        # Equal rows could still have been written back with the same values;
        # the data version says whether anything was written at all.
        observer = sqlite3.connect(self.db)
        self.addCleanup(observer.close)
        before = observer.execute("PRAGMA data_version").fetchone()[0]
        reopened = store.connect()
        self.addCleanup(reopened.close)
        self.assertEqual(before, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual(
            held,
            {
                table: reopened.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
                for table in REGISTRY_TABLES
            },
        )
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, reopened.execute("PRAGMA user_version").fetchone()[0]
        )

    def test_initialize_needs_an_explicit_connection(self) -> None:
        with self.assertRaises(TypeError):
            platform_core.initialize(None, self.db)


class ModuleStateCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.db})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def command(self, **payload):
        return platform_core.module_state_command(self.conn, self.db, payload)

    def test_a_state_change_names_the_revision_it_read_and_is_audited(self) -> None:
        answer = self.command(module_id="memory", state="disabled", expected_revision=1)
        self.assertEqual("valkama-modules", answer["interface_version"])
        self.assertEqual(("disabled", 2), (answer["module"]["state"], answer["module"]["revision"]))
        self.assertEqual(
            ("module.state-changed", '{"state":"disabled"}'),
            tuple(
                self.conn.execute(
                    "SELECT event_kind,detail_json FROM platform_registry_audit"
                    " WHERE entity_id='memory' ORDER BY sequence DESC LIMIT 1"
                ).fetchone()
            ),
        )
        with self.assertRaises(PlatformHttpError) as stale:
            self.command(module_id="memory", state="enabled", expected_revision=1)
        self.assertEqual(409, stale.exception.status)

    def test_settings_and_unknown_modules_are_refused_without_a_write(self) -> None:
        before = self.conn.execute("SELECT COUNT(*) FROM platform_registry_audit").fetchone()[0]
        for module_id, status in (("settings", 409), ("skills", 404)):
            with self.subTest(module_id=module_id):
                with self.assertRaises(PlatformHttpError) as refusal:
                    self.command(module_id=module_id, state="disabled", expected_revision=1)
                self.assertEqual(status, refusal.exception.status)
        self.assertEqual(
            before, self.conn.execute("SELECT COUNT(*) FROM platform_registry_audit").fetchone()[0]
        )

    def test_a_malformed_command_is_a_contract_error(self) -> None:
        for payload in (
            {"module_id": "memory", "state": "disabled"},
            {"module_id": "memory", "state": "off", "expected_revision": 1},
            {"module_id": "memory", "state": "disabled", "expected_revision": True},
            {"module_id": "", "state": "disabled", "expected_revision": 1},
            {"module_id": "memory", "state": "disabled", "expected_revision": 1, "extra": 1},
        ):
            with self.subTest(payload=payload), self.assertRaises(ContractError):
                self.command(**payload)


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

    def _disable(self, module_id: str) -> None:
        conn = store.connect()
        try:
            platform_core.module_state_command(
                conn, self.db, {"module_id": module_id, "state": "disabled", "expected_revision": 1}
            )
        finally:
            conn.close()

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

    def test_the_module_state_route_still_changes_a_module_until_the_list_moves_to_code(
        self,
    ) -> None:
        status, _, body = self._post(
            "/api/modules/state",
            {"module_id": "memory", "state": "disabled", "expected_revision": 1},
        )
        self.assertEqual(200, status)
        self.assertEqual("disabled", json.loads(body)["module"]["state"])
        status, _, body = self._post(
            "/api/modules/state",
            {"module_id": "settings", "state": "disabled", "expected_revision": 1},
        )
        self.assertEqual(409, status)
        self.assertEqual("unavailable", json.loads(body)["status"])
        status, _, body = self._post("/api/modules/state", {"module_id": "memory"})
        self.assertEqual(400, status)
        self.assertEqual("error", json.loads(body)["status"])

    def test_owned_http_reads_put_and_sse_refuse_when_modules_are_disabled(self) -> None:
        self._disable("planning")
        for path in (
            "/api/planning",
            "/api/planning/spaces",
            "/api/session?id=missing",
            "/api/scopes",
            "/api/events?view=planning",
        ):
            with self.subTest(path=path):
                self.assertEqual(409, self._get(path)[0])
        for path in (
            "/api/dashboard",
            "/api/sessions",
            "/api/modules/skills",
            "/api/modules/improvements",
        ):
            self.assertEqual(404, self._get(path)[0])
        for view in ("sessions", "analytics", "dashboard", "improvements"):
            self.assertEqual(400, self._get(f"/api/events?view={view}")[0])
        self.assertEqual(
            404, self._put("/api/modules/improvements/profile", {"scope": "personal"})[0]
        )

    def test_unknown_sse_view_is_rejected(self) -> None:
        self.assertEqual(400, self._get("/api/events?view=not-registered")[0])

    def test_open_sse_stream_terminates_after_module_is_disabled(self) -> None:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request("GET", "/api/events?view=planning")
            response = client.getresponse()
            self.assertEqual(200, response.status)
            self.assertTrue(response.readline().startswith(b"data: "))
            self.assertEqual(b"\n", response.readline())
            self._disable("planning")
            self.assertEqual(b"", response.readline())
        finally:
            client.close()

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
