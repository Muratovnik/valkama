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
            for name, key in (("Example Space", "EXA"), ("Other Space", "OTH"), ("Bare", "BARE")):
                planning_service.create_planning_space(conn, name=name, key=key)
            conn.commit()
            scope = read_store_metadata(conn)["data_scope_id"]
            self.space_ref = {"data_scope_id": scope, "space_key": "EXA"}
            self.other_ref = {"data_scope_id": scope, "space_key": "OTH"}
            self.bare_ref = {"data_scope_id": scope, "space_key": "BARE"}
        finally:
            conn.close()

        def bound(project_id: str, space_ref: dict, *, default: bool) -> dict:
            entry = project_entry(
                project_id,
                self.root / project_id,
                bindings=[project_binding(project_id, planning_space_entity(space_ref))],
            )
            entry["planning_binding"] = {**entry["planning_binding"], "default": default}
            return entry

        self.registry_path.write_bytes(
            registry_bytes(
                [
                    bound("example-project", self.space_ref, default=True),
                    bound("example-tool", self.space_ref, default=False),
                    bound("other-project", self.other_ref, default=True),
                    project_entry("loose-project", self.root / "loose"),
                ]
            )
        )
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space_scope = {"kind": "space", "space_ref": self.space_ref}

    def context(self, **parameters: str) -> dict:
        routing = PlanningRouting(self.conn, self.db, registry_reader=self.registry_path.read_bytes)
        return app_shell.context_payload(
            routing, {key: [value] for key, value in parameters.items()}
        )

    def save(self, **prefs) -> dict:
        return app_shell.save_ui_prefs(
            self.conn, {"interface_version": "valkama-ui-prefs", **prefs}
        )

    def space_parameters(self, space_ref: dict, **extra: str) -> dict:
        return {
            "scope_kind": "space",
            "data_scope_id": space_ref["data_scope_id"],
            "space_key": space_ref["space_key"],
            **extra,
        }

    def test_context_names_the_primary_store_and_every_space_with_its_projects(self) -> None:
        item = planning_service.create_work_item(self.conn, space="EXA", title="Crosses over")
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source)"
            " VALUES (?, 'other-project', 'named'), (?, 'loose-project', 'named'),"
            " (?, 'gone-project', 'named'), (?, 'example-tool', 'named')",
            (item["work_item_id"],) * 4,
        )
        self.conn.commit()
        context = self.context(**self.space_parameters(self.space_ref))
        self.assertEqual("valkama-context", context["interface_version"])
        self.assertEqual(self.space_scope, context["scope"])
        payload = context["state"]["payload"]
        self.assertEqual(
            {"data_scope_id": self.space_ref["data_scope_id"], "is_writable": True},
            payload["primary"],
        )
        self.assertNotIn("projects", payload)
        scope = self.space_ref["data_scope_id"]
        self.assertEqual(
            [
                {
                    "data_scope_id": scope,
                    "space_key": "BARE",
                    "name": "Bare",
                    "default_project": None,
                    "projects": [],
                    "other_space_projects": [],
                },
                {
                    "data_scope_id": scope,
                    "space_key": "EXA",
                    "name": "Example Space",
                    "default_project": "example-project",
                    # The default project first, then the others by id.
                    "projects": [
                        {"project_id": "example-project", "display_name": "example-project"},
                        {"project_id": "example-tool", "display_name": "example-tool"},
                    ],
                    # What its items name of other spaces, each with the space it lives
                    # in; a project the registry no longer holds has no name to show.
                    "other_space_projects": [
                        {
                            "project_id": "loose-project",
                            "display_name": "loose-project",
                            "space_key": None,
                        },
                        {
                            "project_id": "other-project",
                            "display_name": "other-project",
                            "space_key": "OTH",
                        },
                    ],
                },
                {
                    "data_scope_id": scope,
                    "space_key": "OTH",
                    "name": "Other Space",
                    "default_project": "other-project",
                    "projects": [{"project_id": "other-project", "display_name": "other-project"}],
                    "other_space_projects": [],
                },
            ],
            payload["spaces"],
        )
        self.assertNotIn("canonical_root", json.dumps(context))

    def test_a_space_scope_names_a_readable_space_and_a_project_that_narrows_it(self) -> None:
        item = planning_service.create_work_item(self.conn, space="EXA", title="Crosses over")
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source)"
            " VALUES (?, 'other-project', 'named')",
            (item["work_item_id"],),
        )
        self.conn.commit()
        # A space without projects is read: it has no binding, but it has items.
        self.assertEqual(
            {"kind": "space", "space_ref": self.bare_ref},
            self.context(**self.space_parameters(self.bare_ref))["scope"],
        )
        for project_id in ("example-project", "example-tool", "other-project"):
            with self.subTest(project=project_id):
                scope = self.context(
                    **self.space_parameters(self.space_ref, project_id=project_id)
                )["scope"]
                self.assertEqual(
                    {**self.space_scope, "project_ref": {"project_id": project_id}}, scope
                )
        for parameters, status in (
            (self.space_parameters(self.space_ref, project_id="not-registered"), 404),
            # Registered, but neither the space's nor named by any of its items.
            (self.space_parameters(self.space_ref, project_id="loose-project"), 409),
            (self.space_parameters({**self.space_ref, "space_key": "NONE"}), 409),
            ({"scope_kind": "project", "project_id": "example-project"}, 400),
            ({"scope_kind": "space", "space_key": "EXA"}, 400),
            ({"scope_kind": "global", "directory_only": "true"}, 400),
        ):
            with self.subTest(parameters=parameters):
                with self.assertRaises(ui_state.PlatformHttpError) as refusal:
                    self.context(**parameters)
                self.assertEqual(status, refusal.exception.status)

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
        result = self.save(module_id="planning", scope=self.space_scope, resource_ref=resource)
        self.assertEqual("valkama-ui-prefs", result["interface_version"])
        self.assertEqual("planning", result["prefs"]["module_id"])
        prefs = self.context(scope_kind="global")["state"]["payload"]["ui_prefs"]
        self.assertEqual(self.space_scope, prefs["scope"])
        self.assertEqual(resource, prefs["resource_ref"])

    def test_a_remembered_route_a_project_scoped_reads_as_none(self) -> None:
        """The shell starts where it starts rather than at an address that no longer opens."""

        self.conn.execute(
            "INSERT INTO platform_ui_prefs(key, record_json, updated_at) VALUES"
            " ('last-route', ?, '2026-01-02T03:04:05Z')",
            (
                json.dumps(
                    {
                        "module_id": "analytics",
                        "scope": {"kind": "project", "project_ref": {"project_id": "x"}},
                    }
                ),
            ),
        )
        self.conn.commit()
        self.assertIsNone(self.context(scope_kind="global")["state"]["payload"]["ui_prefs"])
        with self.assertRaises(ContractError):
            self.save(
                module_id="planning",
                scope={"kind": "project", "project_ref": {"project_id": "example-project"}},
            )

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
            self.save(module_id="planning", scope=self.space_scope, space_ref=self.space_ref)
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
            ["analytics", "decisions", "memory", "planning", "settings", "volumes"],
            [item["manifest"]["module_id"] for item in modules["modules"]],
        )
        with self.assertRaises(ui_state.PlatformHttpError):
            app_shell.handle_get(self.conn, self.db, app_shell.MODULES_PATH, {"extra": ["1"]})
        self.assertIsNone(app_shell.handle_get(self.conn, self.db, "/api/platform/registry", {}))


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
