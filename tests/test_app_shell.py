"""The app shell's own answers: the module list, the context, and the last route."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import app_shell, store, ui_state
from server.planning import service as planning_service
from server.planning.routing import PlanningRouting
from server.store_identity.metadata import read_store_metadata
from server.store_identity.primitives import ContractError
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

PROJECT_SCOPE = {"kind": "project", "project_ref": {"project_id": "example-project"}}


class AppShellTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.db = str(self.root / "valkama.sqlite3")
        self.registry_path = self.root / "projects.json"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": self.db})
        environment.start()
        self.addCleanup(environment.stop)
        conn = store.connect()
        try:
            planning_service.create_planning_space(
                conn, project_id="example-project", name="Example Space", key="EXA"
            )
            conn.commit()
            self.space_ref = {
                "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                "space_key": "EXA",
            }
        finally:
            conn.close()
        self.registry_path.write_bytes(
            registry_bytes(
                [
                    project_entry(
                        "example-project",
                        self.root,
                        bindings=[
                            project_binding(
                                "example-project", planning_space_entity(self.space_ref)
                            )
                        ],
                    )
                ]
            )
        )
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def context(self, **parameters: str) -> dict:
        routing = PlanningRouting(self.conn, self.db, registry_reader=self.registry_path.read_bytes)
        return app_shell.context_payload(
            routing, {key: [value] for key, value in parameters.items()}
        )

    def save(self, **prefs) -> dict:
        return app_shell.save_ui_prefs(
            self.conn, {"interface_version": "valkama-ui-prefs", **prefs}
        )

    def test_context_names_the_primary_store_and_each_binding_state(self) -> None:
        context = self.context(scope_kind="project", project_id="example-project")
        self.assertEqual("valkama-context", context["interface_version"])
        self.assertEqual(PROJECT_SCOPE, context["scope"])
        payload = context["state"]["payload"]
        self.assertEqual(
            {"data_scope_id": self.space_ref["data_scope_id"], "is_writable": True},
            payload["primary"],
        )
        project = payload["projects"][0]
        self.assertEqual("mapped", project["binding_state"])
        self.assertNotIn("binding_reason", project)
        self.assertNotIn("canonical_root", json.dumps(context))
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            self.context(scope_kind="project", project_id="not-registered")
        self.assertEqual(404, refusal.exception.status)
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            self.context(scope_kind="global", directory_only="true")
        self.assertEqual(400, refusal.exception.status)

    def test_context_reports_an_unreadable_registry_as_unavailable(self) -> None:
        self.registry_path.write_bytes(b"{}")
        state = self.context(scope_kind="global")["state"]
        self.assertEqual(
            {
                "interface_version": "valkama-ui-state",
                "status": "unavailable",
                "reason": "platform.planning.registryUnavailable",
            },
            state,
        )

    def test_context_reports_absent_ui_prefs_as_null(self) -> None:
        self.assertIsNone(self.context(scope_kind="global")["state"]["payload"]["ui_prefs"])

    def test_ui_prefs_round_trip_through_context(self) -> None:
        resource = planning_space_entity(self.space_ref)
        result = self.save(module_id="planning", scope=PROJECT_SCOPE, resource_ref=resource)
        self.assertEqual("valkama-ui-prefs", result["interface_version"])
        self.assertEqual("planning", result["prefs"]["module_id"])
        prefs = self.context(scope_kind="global")["state"]["payload"]["ui_prefs"]
        self.assertEqual(PROJECT_SCOPE, prefs["scope"])
        self.assertEqual(resource, prefs["resource_ref"])

    def test_ui_prefs_persist_for_the_next_connection(self) -> None:
        self.save(module_id="planning", scope={"kind": "global"})
        reopened = store.connect()
        self.addCleanup(reopened.close)
        self.assertEqual(
            {"module_id": "planning", "scope": {"kind": "global"}},
            app_shell.ui_prefs_record(reopened),
        )

    def test_ui_prefs_reject_unknown_module_version_and_fields(self) -> None:
        with self.assertRaises(ui_state.PlatformHttpError):
            self.save(module_id="not-a-module", scope={"kind": "global"})
        with self.assertRaises(ui_state.PlatformHttpError):
            app_shell.save_ui_prefs(
                self.conn,
                {
                    "interface_version": "valkama-ui-prefs-unknown",
                    "module_id": "planning",
                    "scope": {"kind": "global"},
                },
            )
        with self.assertRaises(ContractError):
            self.save(module_id="planning", scope={"kind": "global"}, surprise=True)
        with self.assertRaises(ContractError):
            self.save(module_id="planning", scope=PROJECT_SCOPE, space_ref=self.space_ref)
        self.assertIsNone(app_shell.ui_prefs_record(self.conn))

    def test_corrupt_or_stale_ui_prefs_row_reads_as_null(self) -> None:
        self.conn.execute(
            "INSERT INTO platform_ui_prefs(key,record_json,updated_at)"
            " VALUES('last-route','{not json','2026-01-01T00:00:00Z')"
        )
        self.conn.commit()
        self.assertIsNone(app_shell.ui_prefs_record(self.conn))
        self.conn.execute(
            "UPDATE platform_ui_prefs SET record_json=?",
            (json.dumps({"module_id": "gone-module", "scope": {"kind": "global"}}),),
        )
        self.conn.commit()
        self.assertIsNone(app_shell.ui_prefs_record(self.conn))
        self.assertIsNone(self.context(scope_kind="global")["state"]["payload"]["ui_prefs"])

    def test_the_shell_answers_its_own_paths_and_no_others(self) -> None:
        status, payload = app_shell.handle_post(
            self.conn,
            app_shell.UI_PREFS_PATH,
            {
                "interface_version": "valkama-ui-prefs",
                "module_id": "planning",
                "scope": {"kind": "global"},
            },
        )
        self.assertEqual((200, "planning"), (status, payload["prefs"]["module_id"]))
        self.assertIsNone(app_shell.handle_post(self.conn, "/api/platform/relations", {}))
        self.assertIsNone(app_shell.handle_post(self.conn, "/api/modules/state", {}))
        status, modules = app_shell.handle_get(self.conn, self.db, app_shell.MODULES_PATH, {})
        self.assertEqual(200, status)
        self.assertEqual(
            ["memory", "planning", "settings"],
            [item["manifest"]["module_id"] for item in modules["modules"]],
        )
        with self.assertRaises(ui_state.PlatformHttpError):
            app_shell.handle_get(self.conn, self.db, app_shell.MODULES_PATH, {"extra": ["1"]})
        self.assertIsNone(app_shell.handle_get(self.conn, self.db, "/api/platform/registry", {}))


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
