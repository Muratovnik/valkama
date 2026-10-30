"""Planning's exact-scope reads: the portfolio, one work item, and the routing under them."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store, ui_state
from server.memory import service as memory_service
from server.planning import exact_api
from server.planning import service as planning_service
from server.planning.routing import PlanningRouting
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity, planning_work_item_entity
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

OTHER_STORE = "fedcbafe-dcba-4fed-8cba-fedcbafedcba"


class PlanningExactApiTests(unittest.TestCase):
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
            created = planning_service.create_work_item(conn, space="EXA", title="Phase 1 item")
            planning_service.attach_ref(
                conn, created["reference"], "memory", "lsn_example", label="Decision pointer"
            )
            conn.commit()
            self.item = planning_service.get_work_item(conn, created["reference"])
            self.data_scope_id = read_store_metadata(conn)["data_scope_id"]
        finally:
            conn.close()
        self.space_ref = {"data_scope_id": self.data_scope_id, "space_key": "EXA"}
        self.item_ref = {"space_ref": self.space_ref, "reference": self.item["reference"]}
        self.write_registry(
            [
                project_entry(
                    "example-project",
                    self.root,
                    board="Example Board",
                    bindings=[
                        project_binding("example-project", planning_space_entity(self.space_ref))
                    ],
                )
            ]
        )
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def write_registry(self, projects: list[dict]) -> None:
        self.registry_path.write_bytes(registry_bytes(projects))

    def routing(self) -> PlanningRouting:
        return PlanningRouting(self.conn, self.db, registry_reader=self.registry_path.read_bytes)

    @staticmethod
    def query(**values: str) -> dict[str, list[str]]:
        return {key: [value] for key, value in values.items()}

    def exact(self, **extra: str) -> dict[str, list[str]]:
        return self.query(
            scope_kind="project",
            project_id="example-project",
            data_scope_id=self.data_scope_id,
            space_key="EXA",
            **extra,
        )

    def test_portfolio_and_work_item_answer_through_the_exact_binding(self) -> None:
        planning = exact_api.planning_payload(self.routing(), self.exact())
        self.assertEqual("valkama-planning", planning["interface_version"])
        summary = planning["state"]["payload"]["planning_spaces"][0]["work_items"][0]
        self.assertEqual(self.item_ref, summary["work_item_ref"])

        detail = exact_api.work_item_payload(
            self.routing(),
            self.exact(reference=self.item["reference"]),
            planning_service.get_work_item,
        )
        self.assertEqual("valkama-planning-work-item", detail["interface_version"])
        self.assertEqual(self.item_ref, detail["work_item_ref"])
        payload = detail["state"]["payload"]
        self.assertEqual(self.item["reference"], payload["work_item"]["reference"])
        # The item carries a memory ref, which the registry used to project as a
        # relation. The route still answers the key, and answers it empty.
        self.assertEqual(["lsn_example"], [ref["value"] for ref in payload["work_item"]["refs"]])
        self.assertEqual(
            {"interface_version": "valkama-relations", "relations": []}, payload["relations"]
        )
        self.assertNotIn("memory_body", json.dumps(detail))

    def test_a_missing_work_item_or_loader_is_refused(self) -> None:
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(
                self.routing(), self.exact(reference="EXA-999"), planning_service.get_work_item
            )
        self.assertEqual(404, refusal.exception.status)
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(
                self.routing(),
                self.query(scope_kind="global"),
                planning_service.get_work_item,
            )
        self.assertEqual(400, refusal.exception.status)
        with self.assertRaisesRegex(TypeError, "Planning's own loader"):
            exact_api.handle_get(
                self.conn,
                self.db,
                exact_api.WORK_ITEM_PATH,
                self.exact(reference=self.item["reference"]),
                registry_reader=self.registry_path.read_bytes,
            )
        self.assertIsNone(exact_api.handle_get(self.conn, self.db, "/api/platform/registry", {}))

    def test_global_portfolio_and_memory_share_every_registered_project(self) -> None:
        unbound_root = self.root / "unbound"
        unbound_root.mkdir()
        self.write_registry(
            [
                project_entry(
                    "example-project",
                    self.root,
                    board="Example Board",
                    bindings=[
                        project_binding("example-project", planning_space_entity(self.space_ref))
                    ],
                ),
                project_entry(
                    "unbound-project",
                    unbound_root,
                    board="Unbound Project",
                    bindings=[
                        project_binding("unbound-project", planning_work_item_entity(self.item_ref))
                    ],
                ),
            ]
        )
        planning = exact_api.planning_payload(self.routing(), self.query(scope_kind="global"))
        state = planning["state"]
        self.assertEqual("ready", state["status"])
        projects = state["payload"]["projects"]
        memory_projects = memory_service.providers(registry_reader=self.registry_path.read_bytes)
        self.assertEqual(
            {"example-project", "unbound-project"}, {item["project_id"] for item in projects}
        )
        self.assertEqual(
            {item["project_id"] for item in projects},
            {item["project_id"] for item in memory_projects["providers"]},
        )
        unbound = next(item for item in projects if item["project_id"] == "unbound-project")
        self.assertEqual("unbound", unbound["binding_state"])
        self.assertNotIn("binding_reason", unbound)
        self.assertEqual([], unbound["planning_spaces"])

    def test_global_directory_stays_bounded_without_reading_work_items(self) -> None:
        for number in range(1200):
            planning_service.create_work_item(
                self.conn, space="EXA", title=f"Portfolio work {number}"
            )
        self.conn.commit()
        with mock.patch.object(
            exact_api, "_space_view", side_effect=AssertionError("full item read")
        ) as read_items:
            directory = exact_api.planning_payload(
                self.routing(), self.query(scope_kind="global", directory_only="true")
            )
        read_items.assert_not_called()
        self.assertEqual("ready", directory["state"]["status"])
        payload = directory["state"]["payload"]
        self.assertEqual([], payload["planning_spaces"])
        self.assertEqual(1201, payload["projects"][0]["planning_spaces"][0]["work_item_count"])
        self.assertEqual("Example Board", payload["projects"][0]["title"])
        self.assertEqual("Example Space", payload["projects"][0]["planning_spaces"][0]["title"])
        self.assertLess(len(json.dumps(payload).encode("utf-8")), 256 * 1024)

        def value_count(value):
            if isinstance(value, dict):
                return 1 + sum(value_count(child) for child in value.values())
            if isinstance(value, list):
                return 1 + sum(value_count(child) for child in value)
            return 1

        self.assertLess(value_count(payload), 16_384)
        default = exact_api.planning_payload(self.routing(), self.query(scope_kind="global"))
        self.assertEqual(payload["projects"], default["state"]["payload"]["projects"])
        items = default["state"]["payload"]["planning_spaces"][0]["work_items"]
        self.assertEqual(1201, len(items))
        self.assertIn(self.item_ref, [item["work_item_ref"] for item in items])
        self.assertGreater(value_count(default["state"]["payload"]), 16_384)

    def test_directory_query_is_exact_and_only_global(self) -> None:
        for parameters in (
            {"scope_kind": ["global"], "directory_only": ["false"]},
            {"scope_kind": ["global"], "directory_only": ["true", "true"]},
            {"scope_kind": ["global"], "directory_only": []},
            {"scope_kind": ["global", "global"], "directory_only": ["true"]},
            {"directory_only": ["true"]},
            {"scope_kind": ["global"], "directory_only": ["true"], "unknown": ["x"]},
            self.exact(directory_only="true"),
        ):
            with (
                self.subTest(parameters=parameters),
                self.assertRaises(ui_state.PlatformHttpError) as refusal,
            ):
                exact_api.planning_payload(self.routing(), parameters)
            self.assertEqual(400, refusal.exception.status)

    def test_binding_states_name_why_a_space_is_not_mapped(self) -> None:
        """The reasons the shell shows for a binding that does not resolve.

        Each sentence is the one the browser has always received for that
        cause; only the cause decides which one a project gets.
        """

        planning_service.create_planning_space(
            self.conn, project_id="example-project", name="Second Space", key="SEC"
        )
        self.conn.commit()
        routing = self.routing()
        mapped = planning_space_entity(self.space_ref)
        unbound_space = planning_space_entity({**self.space_ref, "space_key": "SEC"})
        missing_space = planning_space_entity({**self.space_ref, "space_key": "GONE"})
        cases = {
            "mapped": ("example-project", mapped, ("mapped", None)),
            "no binding": (
                "example-project",
                unbound_space,
                ("unbound", "No owner Project binding"),
            ),
            "another project": (
                "other-project",
                mapped,
                ("unbound", "Resource belongs to another Project"),
            ),
        }
        for name, (project_id, resource, expected) in cases.items():
            with self.subTest(case=name):
                self.assertEqual(expected, routing.resolve(project_id, resource))
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            routing.require_mapping("example-project", {**self.space_ref, "space_key": "SEC"})
        self.assertEqual(
            (409, "No owner Project binding"), (refusal.exception.status, refusal.exception.reason)
        )

        for name, resource, expected in (
            (
                "store not present",
                planning_space_entity({"data_scope_id": OTHER_STORE, "space_key": "EXA"}),
                ("unavailable", "Bound store is unavailable"),
            ),
            ("space not in store", missing_space, ("unbound", "Bound resource is unavailable")),
        ):
            with self.subTest(case=name):
                self.write_registry(
                    [
                        project_entry(
                            "example-project",
                            self.root,
                            bindings=[project_binding("example-project", resource)],
                        )
                    ]
                )
                directory = self.routing().directory_item(self.routing().project("example-project"))
                self.assertEqual(expected[0], directory["binding_state"])
                self.assertEqual(
                    [{"resource_ref": resource, "state": expected[0], "reason": expected[1]}],
                    directory["resources"],
                )

    def test_an_unbound_project_is_listed_without_resources(self) -> None:
        self.write_registry([project_entry("example-project", self.root)])
        directory = self.routing().directory_item(self.routing().project("example-project"))
        self.assertEqual(
            {
                "project_id": "example-project",
                "title": "example-project",
                "binding_state": "unbound",
                "resources": [],
            },
            directory,
        )
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            self.routing().project("not-registered")
        self.assertEqual(404, refusal.exception.status)

    def test_routing_reads_and_never_writes(self) -> None:
        """Building a routing and answering through it commits nothing."""

        before = self.conn.total_changes
        routing = self.routing()
        exact_api.planning_payload(routing, self.query(scope_kind="global"))
        exact_api.work_item_payload(
            routing, self.exact(reference=self.item["reference"]), planning_service.get_work_item
        )
        self.assertEqual(before, self.conn.total_changes)
        self.assertFalse(self.conn.in_transaction)


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
