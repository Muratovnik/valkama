"""Real HTTP reads must distinguish stores with identical Planning references."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, store
from server.planning import service
from server.platform import core
from server.platform.contracts import planning_space_entity
from server.platform.scope import read_store_metadata
from server.projects import scopes
from tests.registry_fixtures import project_entry, registry_bytes


class PlanningScopeHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.primary = self.root / "primary.sqlite3"
        self.attached = self.root / "attached.sqlite3"
        self.registry = self.root / "projects.json"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.primary)})
        environment.start()
        self.addCleanup(environment.stop)
        self.refs = {}
        for name, path in (("primary", self.primary), ("attached", self.attached)):
            with mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}):
                conn = store.connect()
                try:
                    service.create_planning_space(
                        conn, project_id="example-project", name="Shared name", key="SAME"
                    )
                    service.create_work_item(conn, space="SAME", title=f"{name}-only")
                    conn.commit()
                    self.refs[name] = {
                        "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                        "space_key": "SAME",
                    }
                finally:
                    conn.close()
        scopes.attach(str(self.primary), "attached", str(self.attached))
        self.bind("primary")
        registry_patch = mock.patch.object(
            core.project_registry, "_read_registry_bytes", self.registry.read_bytes
        )
        registry_patch.start()
        self.addCleanup(registry_patch.stop)
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def bind(self, source: str) -> None:
        entry = project_entry("example-project", self.root)
        entry["planning_binding"] = planning_space_entity(self.refs[source])
        self.registry.write_bytes(registry_bytes([entry]))

    def request(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            client.request(
                "GET" if payload is None else "POST",
                path,
                body=None if payload is None else json.dumps(payload),
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

    def model_path(self, source: str) -> str:
        return "/api/planning?" + urlencode({"project": "example-project", **self.refs[source]})

    def test_context_directory_matches_the_current_project_contract(self) -> None:
        status, context = self.request("/api/platform/context?scope_kind=global")
        self.assertEqual(200, status)
        project = context["state"]["payload"]["projects"][0]
        self.assertEqual({"project_id", "title", "binding_state", "resources"}, set(project))
        self.assertEqual("mapped", project["binding_state"])
        self.assertEqual(
            planning_space_entity(self.refs["primary"]), project["resources"][0]["resource_ref"]
        )

    def test_exact_model_and_inspector_read_attached_without_changing_it(self) -> None:
        status, primary = self.request(self.model_path("primary"))
        self.assertEqual(200, status)
        self.assertEqual(["primary-only"], [item["title"] for item in primary["work_items"]])
        self.bind("attached")
        before = hashlib.sha256(self.attached.read_bytes()).digest()
        status, attached = self.request(self.model_path("attached"))
        self.assertEqual(200, status)
        self.assertEqual(["attached-only"], [item["title"] for item in attached["work_items"]])
        self.assertEqual("SAME-1", attached["work_items"][0]["reference"])
        inspector = "/api/modules/planning/work-item?" + urlencode(
            {
                "scope_kind": "project",
                "project_id": "example-project",
                **self.refs["attached"],
                "reference": "SAME-1",
            }
        )
        status, item = self.request(inspector)
        self.assertEqual(200, status)
        self.assertEqual("attached-only", item["state"]["payload"]["work_item"]["title"])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).digest())
        self.assertEqual(409, self.request(self.model_path("primary"))[0])

    def test_changed_binding_and_detached_store_refuse_without_primary_fallback(self) -> None:
        self.bind("attached")
        self.assertEqual(200, self.request(self.model_path("attached"))[0])
        self.bind("primary")
        status, refused = self.request(self.model_path("attached"))
        self.assertEqual(409, status)
        self.assertEqual("unavailable", refused["status"])
        self.assertNotIn("work_items", refused)
        self.bind("attached")
        scopes.save(str(self.primary), [])
        self.assertEqual(409, self.request(self.model_path("attached"))[0])

    def test_partial_or_unknown_exact_identity_never_uses_legacy_project_lookup(self) -> None:
        path = self.model_path("primary")
        for suffix in ("&space=OTHER", "&space_key=SAME", "&extra=1"):
            with self.subTest(suffix=suffix):
                self.assertEqual(400, self.request(path + suffix)[0])
        self.assertEqual(
            400, self.request("/api/planning?project=example-project&space_key=SAME")[0]
        )
        self.assertEqual(409, self.request(path.replace("SAME", "NONE"))[0])

    def test_attached_loader_is_readonly_and_primary_mutation_stays_primary(self) -> None:
        self.bind("attached")
        conn = store.connect()
        self.addCleanup(conn.close)
        platform = core.Platform(conn, str(self.primary))

        def attempted_write(selected: sqlite3.Connection, _key: str) -> dict:
            selected.execute("UPDATE work_items SET title='forbidden'")
            return {}

        with self.assertRaisesRegex(sqlite3.OperationalError, "readonly"):
            platform.planning_read_model(
                {
                    key: [value]
                    for key, value in {
                        "project": "example-project",
                        **self.refs["attached"],
                    }.items()
                },
                attempted_write,
            )
        status, _ = self.request(
            "/api/planning/work-item/update", {"id": "SAME-1", "title": "primary-updated"}
        )
        self.assertEqual(200, status)
        self.assertEqual("primary-updated", service.get_work_item(conn, "SAME-1")["title"])
        _, attached = self.request(self.model_path("attached"))
        self.assertEqual("attached-only", attached["work_items"][0]["title"])
