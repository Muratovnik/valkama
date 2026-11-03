"""Planning's exact-scope reads: the portfolio, one work item, and the routing under them."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from server import store, ui_state
from server.memory import service as memory_service
from server.planning import exact_api
from server.planning import service as planning_service
from server.planning.routing import PlanningRouting
from server.projects import scopes
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity, planning_work_item_entity
from tests import schema9
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
        # The item carries a memory ref, which the inspector reads from the
        # work item itself; the payload holds nothing else.
        self.assertEqual(["lsn_example"], [ref["value"] for ref in payload["work_item"]["refs"]])
        self.assertEqual(["work_item"], list(payload))
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

    def test_a_brief_read_answers_the_record_the_space_lists(self) -> None:
        """`brief=true` is the item as its space's list carries it, through the same binding."""

        planning_service.comment_work_item(self.conn, self.item["reference"], "A finding.")
        self.conn.commit()
        brief = exact_api.work_item_payload(
            self.routing(),
            self.exact(reference=self.item["reference"], brief="true"),
            planning_service.get_work_item,
        )
        self.assertEqual("valkama-planning-work-item", brief["interface_version"])
        self.assertEqual(self.item_ref, brief["work_item_ref"])
        self.assertEqual("project", brief["scope"]["kind"])
        (listed,) = planning_service.list_work_items(self.conn, space="EXA")
        self.assertEqual({"work_item": listed}, brief["state"]["payload"])
        self.assertEqual(1, listed["comment_count"])
        # What a preview draws is all there; the history is not.
        for field in ("state", "title", "claim_ref", "claim_state", "last_claim_ref"):
            self.assertIn(field, listed)
        for field in ("checklist", "updated_at", "closed_at", "kind", "priority"):
            self.assertIn(field, listed)
        for field in ("comments", "events", "refs", "links", "description", "agents"):
            self.assertNotIn(field, listed)
        # Without `brief` the read is the card's, as it always was.
        full = exact_api.work_item_payload(
            self.routing(),
            self.exact(reference=self.item["reference"]),
            planning_service.get_work_item,
        )["state"]["payload"]["work_item"]
        self.assertEqual(["A finding."], [comment["body"] for comment in full["comments"]])
        self.assertNotIn("comment_count", full)

    def test_a_brief_read_is_refused_as_the_full_one_is(self) -> None:
        """Only `brief=true`; an unknown item is 404 and a binding that moved is 409."""

        for parameters in (
            self.exact(reference=self.item["reference"], brief="false"),
            {**self.exact(reference=self.item["reference"]), "brief": ["true", "true"]},
            {**self.exact(reference=self.item["reference"]), "brief": []},
            self.query(scope_kind="global", brief="true"),
        ):
            with (
                self.subTest(parameters=parameters),
                self.assertRaises(ui_state.PlatformHttpError) as refusal,
            ):
                exact_api.work_item_payload(
                    self.routing(), parameters, planning_service.get_work_item
                )
            self.assertEqual(400, refusal.exception.status)
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(
                self.routing(),
                self.exact(reference="EXA-999", brief="true"),
                planning_service.get_work_item,
            )
        self.assertEqual(404, refusal.exception.status)
        planning_service.create_planning_space(
            self.conn, project_id="example-project", name="Second Space", key="SEC"
        )
        self.conn.commit()
        self.write_registry(
            [
                project_entry(
                    "example-project",
                    self.root,
                    bindings=[
                        project_binding(
                            "example-project",
                            planning_space_entity({**self.space_ref, "space_key": "SEC"}),
                        )
                    ],
                )
            ]
        )
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(
                self.routing(),
                self.exact(reference=self.item["reference"], brief="true"),
                planning_service.get_work_item,
            )
        self.assertEqual(
            (409, "No owner Project binding"), (refusal.exception.status, refusal.exception.reason)
        )

    def attach_store(self, name: str, build: Callable[[str], str]) -> dict:
        """Attach a store `build` writes at a path of its own; answer its space ref."""

        path = str(self.root / f"{name}.sqlite3")
        space_key = build(path)
        scopes.attach(self.db, name, path)
        conn = sqlite3.connect(path)
        try:
            data_scope_id = str(
                conn.execute("SELECT data_scope_id FROM platform_store_metadata").fetchone()[0]
            )
        finally:
            conn.close()
        space_ref = {"data_scope_id": data_scope_id, "space_key": space_key}
        self.write_registry(
            [
                project_entry(
                    "example-project",
                    self.root,
                    bindings=[project_binding("example-project", planning_space_entity(space_ref))],
                )
            ]
        )
        return space_ref

    def brief_from(self, space_ref: dict, reference: str) -> dict:
        answer = exact_api.work_item_payload(
            self.routing(),
            self.query(
                scope_kind="project",
                project_id="example-project",
                reference=reference,
                brief="true",
                **space_ref,
            ),
            planning_service.get_work_item,
        )
        self.assertEqual({"space_ref": space_ref, "reference": reference}, answer["work_item_ref"])
        return answer["state"]["payload"]["work_item"]

    def test_a_brief_read_reaches_an_attached_store_with_the_same_key(self) -> None:
        def current(path: str) -> str:
            with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
                conn = store.connect()
                try:
                    planning_service.create_planning_space(
                        conn, project_id="example-project", name="Attached", key="EXA"
                    )
                    planning_service.create_work_item(conn, space="EXA", title="Attached item")
                    conn.commit()
                finally:
                    conn.close()
            return "EXA"

        space_ref = self.attach_store("attached", current)
        self.assertNotEqual(self.data_scope_id, space_ref["data_scope_id"])
        brief = self.brief_from(space_ref, "EXA-1")
        self.assertEqual(("Attached item", 0), (brief["title"], brief["comment_count"]))

    def test_a_brief_read_of_a_schema_9_attached_store(self) -> None:
        """A store a schema-9 build wrote, read as it is: the brief needs no later column."""

        for name, fixture, data_scope_id in (
            ("first", schema9.FIXTURE, "00000000-0000-4000-8000-000000000091"),
            ("last", schema9.LAST, "00000000-0000-4000-8000-000000000092"),
        ):
            with self.subTest(fixture=name):

                def old(
                    path: str, fixture: Path = fixture, data_scope_id: str = data_scope_id
                ) -> str:
                    schema9.build(path, fixture=fixture, data_scope_id=data_scope_id)
                    conn = sqlite3.connect(path)
                    try:
                        schema9.populate(conn)
                        conn.commit()
                    finally:
                        conn.close()
                    return "KEEP"

                space_ref = self.attach_store(name, old)
                held = self.brief_from(space_ref, "KEEP-1")
                self.assertEqual(
                    ("Held with its history", "kept-agent", "unconfirmed", 1),
                    (
                        held["title"],
                        held["claim_ref"],
                        held["claim_state"],
                        held["comment_count"],
                    ),
                )
                self.assertEqual("dev", held["state"]["key"])
                self.assertIsNone(held["closed_at"])
                self.assertEqual(schema9.CREATED_AT, held["updated_at"])
                # Blocked by the first, which is open, so not startable.
                blocked = self.brief_from(space_ref, "KEEP-2")
                self.assertEqual(("", False), (blocked["claim_ref"], blocked["ready"]))

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
