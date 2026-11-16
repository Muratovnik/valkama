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
from server.store_identity.refs import planning_space_entity
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
            scope_kind="space",
            data_scope_id=self.data_scope_id,
            space_key="EXA",
            **extra,
        )

    def test_portfolio_and_work_item_answer_for_the_exact_space(self) -> None:
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
        self.assertEqual({"kind": "space", "space_ref": self.space_ref}, brief["scope"])
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
        """Only `brief=true`; an unknown item is 404 and a space that is not there is 409."""

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
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(
                self.routing(),
                {
                    **self.exact(reference="GONE-1", brief="true"),
                    "space_key": ["GONE"],
                },
                planning_service.get_work_item,
            )
        self.assertEqual(
            (409, "Planning space is unavailable"),
            (refusal.exception.status, refusal.exception.reason),
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
                scope_kind="space",
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
                self.assertEqual(("", False), (blocked["claim_ref"], blocked["workable"]))

    def test_global_portfolio_lists_every_space_with_its_projects(self) -> None:
        """Every space of the store, bound or not; a project no space holds is in none."""

        planning_service.create_planning_space(
            self.conn, project_id="example-project", name="Second Space", key="SEC"
        )
        self.conn.commit()
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
                project_entry("unbound-project", unbound_root, board="Unbound Project"),
            ]
        )
        planning = exact_api.planning_payload(self.routing(), self.query(scope_kind="global"))
        state = planning["state"]
        self.assertEqual("ready", state["status"])
        self.assertEqual(
            [
                {
                    "space_ref": self.space_ref,
                    "title": "Example Space",
                    "work_item_count": 1,
                    "default_project": "example-project",
                    "projects": [
                        {"project_id": "example-project", "display_name": "Example Board"}
                    ],
                },
                {
                    "space_ref": {**self.space_ref, "space_key": "SEC"},
                    "title": "Second Space",
                    "work_item_count": 0,
                    "default_project": None,
                    "projects": [],
                },
            ],
            state["payload"]["spaces"],
        )
        self.assertEqual(
            ["EXA", "SEC"],
            [space["space_ref"]["space_key"] for space in state["payload"]["planning_spaces"]],
        )
        # Memory still answers for every registered project, bound or not.
        memory_projects = memory_service.providers(registry_reader=self.registry_path.read_bytes)
        self.assertEqual(
            {"example-project", "unbound-project"},
            {item["project_id"] for item in memory_projects["providers"]},
        )

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
        self.assertEqual(1201, payload["spaces"][0]["work_item_count"])
        self.assertEqual("Example Space", payload["spaces"][0]["title"])
        self.assertEqual("Example Board", payload["spaces"][0]["projects"][0]["display_name"])
        self.assertLess(len(json.dumps(payload).encode("utf-8")), 256 * 1024)

        def value_count(value):
            if isinstance(value, dict):
                return 1 + sum(value_count(child) for child in value.values())
            if isinstance(value, list):
                return 1 + sum(value_count(child) for child in value)
            return 1

        self.assertLess(value_count(payload), 16_384)
        default = exact_api.planning_payload(self.routing(), self.query(scope_kind="global"))
        self.assertEqual(payload["spaces"], default["state"]["payload"]["spaces"])
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

    def test_a_space_is_read_with_or_without_projects_and_says_why_it_cannot_be(self) -> None:
        """The stable reasons a read across spaces names, and the refusals of an exact one."""

        planning_service.create_planning_space(
            self.conn, project_id="example-project", name="Second Space", key="SEC"
        )
        self.conn.commit()
        routing = self.routing()
        self.assertIsNone(routing.unavailable_reason(self.space_ref))
        # No project is bound to it, and it is read all the same.
        second = {**self.space_ref, "space_key": "SEC"}
        self.assertIsNone(routing.unavailable_reason(second))
        routing.require_space(second)
        self.assertEqual(
            "space_missing", routing.unavailable_reason({**self.space_ref, "space_key": "GONE"})
        )
        self.assertEqual(
            "store_not_attached",
            routing.unavailable_reason({"data_scope_id": OTHER_STORE, "space_key": "EXA"}),
        )
        for space_ref, reason in (
            ({**self.space_ref, "space_key": "GONE"}, "Planning space is unavailable"),
            (
                {"data_scope_id": OTHER_STORE, "space_key": "EXA"},
                "Planning space store is unavailable",
            ),
        ):
            with (
                self.subTest(space=space_ref),
                self.assertRaises(ui_state.PlatformHttpError) as refusal,
            ):
                routing.require_space(space_ref)
            self.assertEqual((409, reason), (refusal.exception.status, refusal.exception.reason))

    def test_a_project_narrows_its_space_or_one_whose_items_name_it(self) -> None:
        other_root = self.root / "other"
        other_root.mkdir()
        planning_service.create_planning_space(
            self.conn, project_id="example-project", name="Other Space", key="OTH"
        )
        self.conn.commit()
        self.write_registry(
            [
                project_entry(
                    "example-project",
                    self.root,
                    bindings=[
                        project_binding("example-project", planning_space_entity(self.space_ref))
                    ],
                ),
                project_entry(
                    "other-project",
                    other_root,
                    bindings=[
                        project_binding(
                            "other-project",
                            planning_space_entity({**self.space_ref, "space_key": "OTH"}),
                        )
                    ],
                ),
            ]
        )
        read = self.exact(reference=self.item["reference"], project_id="other-project")
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(self.routing(), read, planning_service.get_work_item)
        self.assertEqual(409, refusal.exception.status)
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source)"
            " VALUES (?, 'other-project', 'named')",
            (self.item["work_item_id"],),
        )
        self.conn.commit()
        detail = exact_api.work_item_payload(self.routing(), read, planning_service.get_work_item)
        self.assertEqual(
            {
                "kind": "space",
                "space_ref": self.space_ref,
                "project_ref": {"project_id": "other-project"},
            },
            detail["scope"],
        )
        own = exact_api.planning_payload(self.routing(), self.exact(project_id="example-project"))
        self.assertEqual("ready", own["state"]["status"])
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.planning_payload(self.routing(), self.exact(project_id="not-registered"))
        self.assertEqual(404, refusal.exception.status)

    def test_an_unreadable_registry_answers_no_space(self) -> None:
        self.registry_path.write_bytes(b"{}")
        routing = self.routing()
        self.assertEqual(
            "platform.planning.registryUnavailable",
            exact_api.planning_payload(routing, self.exact())["state"]["reason"],
        )
        with self.assertRaises(ui_state.PlatformHttpError) as refusal:
            exact_api.work_item_payload(
                routing,
                self.exact(reference=self.item["reference"]),
                planning_service.get_work_item,
            )
        self.assertEqual(
            (409, "Project registry is unavailable"),
            (refusal.exception.status, refusal.exception.reason),
        )

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
