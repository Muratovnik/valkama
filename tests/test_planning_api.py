from __future__ import annotations

import inspect
import os
import tempfile
import unittest
from unittest import mock

from server import http_surface, store
from server.planning import api as planning_api
from server.planning import model, service
from server.platform import core as platform_core


class PlanningApiTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        # A fresh store holds no Board domain at all: nothing to drop, and the
        # boundary is simply live.
        self.space = service.create_planning_space(
            self.conn, project_id="example-workspace", name="Quality Assurance"
        )

    def get(self, path: str, **parameters: str) -> dict:
        status, body = planning_api.handle_get(
            self.conn, path, {name: [value] for name, value in parameters.items()}
        )
        self.assertEqual(200, status, path)
        return body

    def post(self, path: str, **payload: object) -> dict:
        status, body = planning_api.handle_post(self.conn, path, payload)
        self.assertEqual(200, status, path)
        return body

    # -- shape ---------------------------------------------------------------

    def test_every_declared_path_is_handled(self) -> None:
        self.assertEqual(
            (
                "/api/planning",
                "/api/planning/activity",
                "/api/planning/graph",
                "/api/planning/search",
                "/api/planning/spaces",
                "/api/planning/work-item",
                "/api/planning/work-items",
            ),
            planning_api.READ_PATHS,
        )
        for path in planning_api.READ_PATHS + planning_api.WRITE_PATHS:
            self.assertTrue(path.startswith("/api/planning"), path)

    def test_a_path_that_is_not_ours_returns_nothing_rather_than_a_refusal(self) -> None:
        self.assertIsNone(planning_api.handle_get(self.conn, "/api/boards", {}))
        self.assertIsNone(planning_api.handle_post(self.conn, "/api/card", {}))

    # -- reads ---------------------------------------------------------------

    def test_the_read_model_carries_the_workflow_items_and_links(self) -> None:
        first = self.post("/api/planning/work-items", space="QA", title="First")
        second = self.post("/api/planning/work-items", space="QA", title="Second")
        self.post(
            "/api/planning/work-item/link",
            id=first["reference"],
            other=second["reference"],
            kind="blocks",
        )
        payload = self.get("/api/planning")
        self.assertEqual(6, len(payload["workflow"]["states"]))
        self.assertEqual(2, len(payload["work_items"]))
        self.assertEqual(1, len(payload["links"]))

    def test_reads_filter_by_state_category_kind_and_owner(self) -> None:
        self.post("/api/planning/work-items", space="QA", title="Plain")
        epic = self.post("/api/planning/work-items", space="QA", title="Epic", kind="epic")
        self.post("/api/planning/work-item/claim", id=epic["reference"], author="one")
        self.assertEqual(2, len(self.get("/api/planning/work-items")["work_items"]))
        self.assertEqual(
            [epic["reference"]],
            [
                item["reference"]
                for item in self.get("/api/planning/work-items", kind="epic")["work_items"]
            ],
        )
        self.assertEqual(
            [epic["reference"]],
            [
                item["reference"]
                for item in self.get("/api/planning/work-items", owner="one")["work_items"]
            ],
        )
        self.assertEqual(
            2, len(self.get("/api/planning/work-items", category="backlog")["work_items"])
        )
        self.assertEqual(0, len(self.get("/api/planning/work-items", state="done")["work_items"]))

    def test_an_exact_read_answers_by_reference_or_by_id(self) -> None:
        created = self.post("/api/planning/work-items", space="QA", title="First")
        by_reference = self.get("/api/planning/work-item", id=created["reference"])["work_item"]
        by_id = self.get("/api/planning/work-item", id=created["work_item_id"])["work_item"]
        self.assertEqual(by_reference["work_item_id"], by_id["work_item_id"])

    def test_search_activity_and_graph_answer_from_the_same_store(self) -> None:
        created = self.post("/api/planning/work-items", space="QA", title="Findable")
        self.assertEqual(
            [created["reference"]],
            [
                item["reference"]
                for item in self.get("/api/planning/search", q="Findable")["work_items"]
            ],
        )
        self.assertEqual(
            ["created"],
            [entry["action"] for entry in self.get("/api/planning/activity")["activity"]],
        )
        graph = self.get("/api/planning/graph")
        self.assertEqual([created["reference"]], [node["reference"] for node in graph["nodes"]])
        self.assertTrue(graph["nodes"][0]["ready"])

    def test_a_read_resolves_the_space_from_the_project_that_binds_it(self) -> None:
        """A browser knows its project long before it knows a space id."""

        created = self.post("/api/planning/work-items", space="QA", title="Bound")
        payload = self.get("/api/planning", project="example-workspace")
        self.assertEqual(
            self.space["planning_space_id"], payload["planning_space"]["planning_space_id"]
        )
        self.assertEqual(
            [created["reference"]], [item["reference"] for item in payload["work_items"]]
        )
        graph = self.get("/api/planning/graph", project="example-workspace")
        self.assertEqual([created["reference"]], [node["reference"] for node in graph["nodes"]])

    def test_a_read_refuses_two_answers_to_one_question_and_an_unbound_project(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "two answers to one question"):
            planning_api.handle_get(
                self.conn, "/api/planning", {"space": ["QA"], "project": ["example-workspace"]}
            )
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "no planning space yet"):
            planning_api.handle_get(self.conn, "/api/planning", {"project": ["sample-project"]})

    def test_a_read_refuses_a_repeated_parameter_and_a_missing_one(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "at most once"):
            planning_api.handle_get(self.conn, "/api/planning", {"space": ["QA", "QA"]})
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "id is required"):
            planning_api.handle_get(self.conn, "/api/planning/work-item", {})
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "must be an integer"):
            planning_api.handle_get(self.conn, "/api/planning", {"limit": ["soon"]})

    # -- writes --------------------------------------------------------------

    def test_the_whole_path_of_one_item_goes_through_this_boundary(self) -> None:
        created = self.post(
            "/api/planning/work-items", space="QA", title="Land the boundary", author="one"
        )
        self.assertEqual("QA-1", created["reference"])
        updated = self.post(
            "/api/planning/work-item/update",
            id="QA-1",
            priority="urgent",
            expected_revision=created["revision"],
        )
        self.assertEqual("urgent", updated["priority"])
        self.post("/api/planning/work-item/claim", id="QA-1", author="one")
        with_steps = self.post("/api/planning/work-item/checklist", id="QA-1", items=["write it"])
        step = with_steps["checklist"][0]["id"]
        self.post("/api/planning/work-item/checklist/claim", id="QA-1", item_id=step, author="one")
        self.post("/api/planning/work-item/checklist/tick", id="QA-1", item_id=step, author="one")
        self.post(
            "/api/planning/work-item/ref", id="QA-1", kind="commit", value="abc1234", author="one"
        )
        self.post("/api/planning/work-item/comment", id="QA-1", body="a note", author="one")
        moved = self.post(
            "/api/planning/work-item/transition", id="QA-1", state="dev", author="one"
        )
        self.assertEqual("dev", moved["state"]["key"])
        self.post(
            "/api/planning/work-item/summary",
            id="QA-1",
            summary={"done": "landed", "next": "the frontend"},
        )
        closed = self.post(
            "/api/planning/work-item/transition", id="QA-1", state="done", author="one"
        )
        self.assertTrue(closed["state"]["is_terminal"])
        self.assertEqual(
            [
                "created",
                "claimed",
                "checklist_replaced",
                "checklist_claimed",
                "checklist_completed",
                "transitioned",
                "summarized",
                "transitioned",
            ],
            [event["action"] for event in closed["events"]],
        )

    def test_update_accepts_source_without_disturbing_identity_or_attached_records(self) -> None:
        created = self.post(
            "/api/planning/work-items",
            space="QA",
            title="Anchor move",
            source="docs/old.md#kb:old1",
        )
        self.post(
            "/api/planning/work-item/ref", id=created["reference"], kind="commit", value="abc1234"
        )
        self.post("/api/planning/work-item/comment", id=created["reference"], body="keep this note")
        with_steps = self.post(
            "/api/planning/work-item/checklist", id=created["reference"], items=["write it"]
        )
        before = self.get("/api/planning/work-item", id=created["reference"])["work_item"]

        updated = self.post(
            "/api/planning/work-item/update",
            id=created["reference"],
            source="docs/new.md#kb:new1",
            expected_revision=before["revision"],
        )

        self.assertEqual(created["work_item_id"], updated["work_item_id"])
        self.assertEqual(created["reference"], updated["reference"])
        self.assertEqual("docs/new.md#kb:new1", updated["source"])
        self.assertEqual(before["comments"], updated["comments"])
        self.assertEqual(before["refs"], updated["refs"])
        self.assertEqual(with_steps["checklist"], updated["checklist"])
        self.assertEqual(
            [event["action"] for event in before["events"]],
            [event["action"] for event in updated["events"]],
        )

    def test_claim_ready_answers_with_nothing_when_no_item_is_ready(self) -> None:
        self.assertIsNone(self.post("/api/planning/work-item/claim-ready", space="QA")["work_item"])
        created = self.post("/api/planning/work-items", space="QA", title="Ready")
        picked = self.post("/api/planning/work-item/claim-ready", space="QA", author="one")
        self.assertEqual(created["reference"], picked["work_item"]["reference"])

    def test_a_space_is_created_through_the_boundary(self) -> None:
        made = self.post("/api/planning/spaces", project_id="sims", name="Sample Mods Manager")
        self.assertEqual("SMM", made["key"])
        self.assertEqual(2, len(self.get("/api/planning/spaces")["planning_spaces"]))

    def test_a_write_states_which_field_it_wanted(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "title is required"):
            planning_api.handle_post(self.conn, "/api/planning/work-items", {"space": "QA"})
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "must be a string"):
            planning_api.handle_post(
                self.conn, "/api/planning/work-items", {"space": "QA", "title": 7}
            )
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "must be a boolean"):
            planning_api.handle_post(
                self.conn, "/api/planning/work-item/claim", {"id": "QA-1", "force": "yes"}
            )
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "must be an integer"):
            planning_api.handle_post(
                self.conn,
                "/api/planning/work-item/update",
                {"id": "QA-1", "expected_revision": "3"},
            )

    def test_a_body_that_is_not_an_object_is_refused(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "JSON object"):
            planning_api.handle_post(self.conn, "/api/planning/work-items", ["not", "an", "object"])

    # -- refusals map to statuses -------------------------------------------

    def test_each_refusal_kind_has_its_own_status_and_code(self) -> None:
        created = self.post("/api/planning/work-items", space="QA", title="First")
        self.assertEqual(
            (409, "workflow_guard"),
            self._refusal("/api/planning/work-item/transition", id="QA-1", state="dev"),
        )
        self.assertEqual(
            (409, "revision_conflict"),
            self._refusal(
                "/api/planning/work-item/update",
                id="QA-1",
                title="Renamed",
                expected_revision=created["revision"] + 5,
            ),
        )
        self.assertEqual(
            (400, "invalid_request"),
            self._refusal("/api/planning/work-item/link", id="QA-1", other="QA-1", kind="blocks"),
        )

    def test_a_conflict_names_the_revision_it_found(self) -> None:
        self.post("/api/planning/work-items", space="QA", title="First")
        status, body = planning_api.error_response(model.RevisionConflictError(0, 3))
        self.assertEqual(409, status)
        self.assertEqual(0, body["error"]["expected"])
        self.assertEqual(3, body["error"]["actual"])

    def test_an_error_this_boundary_does_not_own_is_re_raised(self) -> None:
        with self.assertRaises(ZeroDivisionError):
            planning_api.error_response(ZeroDivisionError("not ours"))

    def _refusal(self, path: str, **payload: object) -> tuple[int, str]:
        try:
            planning_api.handle_post(self.conn, path, payload)
        except Exception as error:  # noqa: BLE001 -- the mapping is what is under test
            status, body = planning_api.error_response(error)
            return status, body["error"]["code"]
        raise AssertionError(f"{path} did not refuse")


class PlanningRouteGateTests(unittest.TestCase):
    """The module gate must know every neutral path, or it refuses one silently."""

    def test_every_declared_path_is_owned_by_the_planning_module(self) -> None:
        for path in planning_api.READ_PATHS:
            self.assertEqual("planning", http_surface._HTTP_ROUTE_MODULES[("GET", path)], path)
        for path in planning_api.WRITE_PATHS:
            self.assertEqual("planning", http_surface._HTTP_ROUTE_MODULES[("POST", path)], path)

    def test_the_kernel_work_item_route_is_dispatched_with_plannings_loader(self) -> None:
        """The Kernel reads one work item on a path the surface has to recognise.

        `platform.core.handle_get` has accepted this path and demanded an
        ``item_loader`` all along, while the surface dispatched to that handler
        only for ``/api/modules`` exactly or ``/api/platform/``. The path is
        neither, so it answered a bare 404 and the relations panel never loaded
        its half. A mock backend answered it, which is why only a live server
        showed the gap.
        """

        self.assertEqual(
            "planning",
            http_surface._HTTP_ROUTE_MODULES[("GET", http_surface.PLANNING_WORK_ITEM_PATH)],
        )
        boundary = http_surface._boundary(
            http_surface._GET_BOUNDARIES, http_surface.PLANNING_WORK_ITEM_PATH
        )
        self.assertIsNotNone(boundary)
        assert boundary is not None
        self.assertIs(http_surface._platform_read, boundary.handler)
        self.assertIn(
            "item_loader=planning_service.get_work_item",
            inspect.getsource(http_surface._platform_read),
        )
        # And the handler really does demand one, which is what makes passing it
        # the fix rather than a decoration.
        self.assertIn(
            "the work item endpoint requires Planning's own loader",
            inspect.getsource(platform_core.handle_get),
        )


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
