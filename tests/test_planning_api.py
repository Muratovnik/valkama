from __future__ import annotations

import inspect
import os
import tempfile
import unittest
from unittest import mock

from server import http_surface, store
from server.planning import api as planning_api
from server.planning import exact_api as planning_exact_api
from server.planning import model, service
from tests.planning_fixtures import standing_in


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
        self.space = service.create_planning_space(self.conn, name="Quality Assurance")

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
                "/api/planning/commits/unattached",
                "/api/planning/graph",
                "/api/planning/held",
                "/api/planning/request",
                "/api/planning/requests",
                "/api/planning/search",
                "/api/planning/session/usage",
                "/api/planning/spaces",
                "/api/planning/volumes",
                "/api/planning/work-item",
                "/api/planning/work-item/chain",
                "/api/planning/work-item/usage",
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
        self.assertEqual(8, len(payload["workflow"]["states"]))
        self.assertEqual(2, len(payload["work_items"]))
        self.assertEqual(1, len(payload["links"]))

    def test_reads_filter_by_state_category_kind_and_owner(self) -> None:
        plain = self.post("/api/planning/work-items", space="QA", title="Plain")
        goal = self.post("/api/planning/work-items", space="QA", title="Goal", kind="goal")
        self.post("/api/planning/work-item/claim", id=plain["reference"], author="one")
        self.assertEqual(2, len(self.get("/api/planning/work-items")["work_items"]))
        self.assertEqual(
            [goal["reference"]],
            [
                item["reference"]
                for item in self.get("/api/planning/work-items", kind="goal")["work_items"]
            ],
        )
        self.assertEqual(
            [plain["reference"]],
            [
                item["reference"]
                for item in self.get("/api/planning/work-items", owner="one")["work_items"]
            ],
        )
        # The claim started the plain item, so only the goal is still in triage.
        self.assertEqual(
            [goal["reference"]],
            [
                item["reference"]
                for item in self.get("/api/planning/work-items", category="triage")["work_items"]
            ],
        )
        self.assertEqual(0, len(self.get("/api/planning/work-items", state="done")["work_items"]))

    def test_the_whole_read_model_keeps_queues_and_graph_beyond_the_list_limit(self) -> None:
        for number in range(1000):
            service.create_work_item(self.conn, space="QA", title=f"Triage {number}")
        review = standing_in(self.conn, "review", space="QA", title="Review me")
        blocked = standing_in(self.conn, "blocked", space="QA", title="Blocked")
        assigned = service.create_work_item(
            self.conn, space="QA", title="Assigned", state="ready", acceptance="assignment"
        )
        service.claim_work_item(self.conn, assigned["reference"], author="one")
        service.link_work_items(self.conn, blocked["reference"], review["reference"], "blocks")

        payload = self.get("/api/planning")
        items = {item["reference"]: item for item in payload["work_items"]}
        self.assertEqual(1003, len(items))
        self.assertEqual("review", items[review["reference"]]["state"]["category"])
        self.assertEqual("blocked", items[blocked["reference"]]["state"]["category"])
        self.assertEqual("one", items[assigned["reference"]]["claim_ref"])
        self.assertEqual(1003, payload["planning_spaces"][0]["work_items"])
        graph = self.get("/api/planning/graph")
        self.assertEqual(set(items), {node["reference"] for node in graph["nodes"]})
        self.assertIn(
            (blocked["work_item_id"], review["work_item_id"], "blocks"),
            [(edge["from"], edge["to"], edge["kind"]) for edge in graph["edges"]],
        )
        self.assertEqual(200, len(self.get("/api/planning/work-items")["work_items"]))
        self.assertEqual(
            1000, len(self.get("/api/planning/work-items", limit="5000")["work_items"])
        )

    def test_a_complete_model_refuses_a_partial_list_limit(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "complete read model"):
            planning_api.handle_get(self.conn, "/api/planning", {"limit": ["1"]})

    def test_an_exact_read_answers_by_reference_or_by_id(self) -> None:
        created = self.post("/api/planning/work-items", space="QA", title="First")
        by_reference = self.get("/api/planning/work-item", id=created["reference"])["work_item"]
        by_id = self.get("/api/planning/work-item", id=created["work_item_id"])["work_item"]
        self.assertEqual(by_reference["work_item_id"], by_id["work_item_id"])

    def test_an_exact_read_without_parts_is_the_full_record_it_always_was(self) -> None:
        """What a screen reads: the record before reads by part, field for field."""

        created = self.post("/api/planning/work-items", space="QA", title="Whole")
        answer = self.get("/api/planning/work-item", id=created["reference"])
        self.assertEqual({"interface_version", "work_item"}, set(answer))
        record = answer["work_item"]
        self.assertEqual(
            {
                "acceptance", "checklist", "claim", "claim_ref", "claim_state", "closed_at",
                "comments", "commits", "container_state", "created_at", "description", "events",
                "kind", "labels", "lapsed_claim", "last_claim_ref", "links", "mentions",
                "mentions_total", "number", "open", "parent_id", "planning_space_id",
                "priority", "projects", "reference", "refs", "revision", "source",
                "started_at", "state", "subscribers", "summary", "summary_comment_id",
                "title", "updated_at", "waits_for", "withheld", "work_item_id", "workable",
            },
            set(record),
        )  # fmt: skip
        self.assertEqual(
            {"category", "is_terminal", "key", "name", "state_id"}, set(record["state"])
        )
        self.assertEqual(service.get_work_item(self.conn, created["reference"]), record)
        card = self.get("/api/planning/work-item", id=created["reference"], parts="card")
        self.assertNotIn("work_item_id", card["work_item"])

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
        # Filed without an acceptance, it waits in triage, which the queue does not give.
        self.assertFalse(graph["nodes"][0]["workable"])

    def test_a_project_does_not_choose_the_space_a_read_shows(self) -> None:
        """A space holds no project, so a project only narrows the read of a space named."""

        service.create_work_item(self.conn, space="QA", title="Names no project")
        for path, key in (("/api/planning", "work_items"), ("/api/planning/graph", "nodes")):
            with (
                self.subTest(path=path),
                self.assertRaisesRegex(
                    planning_api.PlanningHttpError, "a project does not choose a planning space"
                ),
            ):
                planning_api.handle_get(self.conn, path, {"project": ["example-workspace"]})
            answer = planning_api.handle_get(self.conn, path, {"space": ["QA"], "project": ["x"]})
            assert answer is not None
            self.assertEqual([], answer[1][key])

    def test_a_read_refuses_a_repeated_parameter_and_a_missing_one(self) -> None:
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "at most once"):
            planning_api.handle_get(self.conn, "/api/planning", {"space": ["QA", "QA"]})
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "id is required"):
            planning_api.handle_get(self.conn, "/api/planning/work-item", {})
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "must be an integer"):
            planning_api.handle_get(self.conn, "/api/planning/work-items", {"limit": ["soon"]})

    def test_a_page_offset_from_a_direct_caller_is_a_count(self) -> None:
        # The typed rule the MCP chain tool applies to its own offset and limit.
        wanted = "^offset must be a non-negative integer$"
        for offset in (-1, True, "2"):
            with self.subTest(offset=offset):
                with self.assertRaisesRegex(model.PlanningError, wanted):
                    service.list_work_items(self.conn, offset=offset)  # type: ignore[arg-type]
                with self.assertRaisesRegex(model.PlanningError, wanted):
                    service.search_work_items(self.conn, "x", offset=offset)  # type: ignore[arg-type]
        self.assertEqual([], service.list_work_items(self.conn, space="QA", offset=5))

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
        claimed = self.post("/api/planning/work-item/claim", id="QA-1", author="one")
        self.assertEqual({"from": "triage", "to": "dev"}, claimed["started"])
        with_steps = self.post("/api/planning/work-item/checklist", id="QA-1", items=["write it"])
        step = with_steps["checklist"][0]["id"]
        self.post("/api/planning/work-item/checklist/claim", id="QA-1", item_id=step, author="one")
        self.post("/api/planning/work-item/checklist/tick", id="QA-1", item_id=step, author="one")
        self.post(
            "/api/planning/work-item/ref", id="QA-1", kind="memory", value="abc1234", author="one"
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
                "accepted",
                "transitioned",
                "checklist_replaced",
                "checklist_claimed",
                "checklist_completed",
                "transitioned",
                "summarized",
                "transitioned",
                "released",
            ],
            [event["action"] for event in closed["events"]],
        )
        self.assertEqual(("", "one"), (closed["claim_ref"], closed["released"]))

    def test_update_accepts_source_without_disturbing_identity_or_attached_records(self) -> None:
        created = self.post(
            "/api/planning/work-items",
            space="QA",
            title="Anchor move",
            source="docs/old.md#kb:old1",
        )
        self.post(
            "/api/planning/work-item/ref", id=created["reference"], kind="memory", value="abc1234"
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
        # Work in triage is not accepted, so the queue gives nobody it unasked.
        self.post("/api/planning/work-items", space="QA", title="In triage")
        self.assertIsNone(self.post("/api/planning/work-item/claim-ready", space="QA")["work_item"])
        created = self.post(
            "/api/planning/work-items",
            space="QA",
            title="Ready",
            state="ready",
            acceptance="assignment",
        )
        picked = self.post("/api/planning/work-item/claim-ready", space="QA", author="one")
        self.assertEqual(created["reference"], picked["work_item"]["reference"])

    def test_a_space_is_created_through_the_boundary(self) -> None:
        made = self.post("/api/planning/spaces", name="Sample Mods Manager")
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

    def test_rank_is_retired_on_the_edit_the_move_and_the_batch_and_writes_nothing(self) -> None:
        created = self.post("/api/planning/work-items", space="QA", title="First")
        self.conn.commit()
        retired = model.RETIRED_FIELDS["rank"]
        for path, payload, says in (
            ("/api/planning/work-item/update", {"rank": "first"}, retired),
            ("/api/planning/work-item/update", {"title": "Renamed", "rank": "last"}, retired),
            ("/api/planning/work-item/transition", {"state": "ready", "rank": "first"}, retired),
            ("/api/planning/work-item/apply", {"update": {"rank": "first"}}, f"update: {retired}"),
            (
                "/api/planning/work-item/apply",
                {"transition": {"state": "ready", "rank": "first"}},
                f"transition: {retired}",
            ),
        ):
            with self.subTest(path=path, payload=payload):
                with self.assertRaises(planning_api.PlanningHttpError) as caught:
                    planning_api.handle_post(self.conn, path, {"id": "QA-1", **payload})
                self.conn.commit()
                status, body = planning_api.error_response(caught.exception)
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
                self.assertEqual(says, body["error"]["message"])
                after = service.get_work_item(self.conn, "QA-1")
                self.assertEqual(
                    (created["revision"], "First", created["state"]["key"]),
                    (after["revision"], after["title"], after["state"]["key"]),
                )
        self.assertTrue(retired.startswith("rank is retired: the order of work is computed"))

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

    # -- the batch write ---------------------------------------------------

    def test_a_refused_batch_leaves_nothing_behind_a_commit(self) -> None:
        item = self.post("/api/planning/work-items", space="QA", title="Atomic")
        steps = self.post("/api/planning/work-item/checklist", id=item["reference"], items=["a"])
        self.conn.commit()
        before = self.get("/api/planning/work-item", id=item["reference"])["work_item"]
        with self.assertRaises(planning_api.PlanningHttpError) as refused:
            planning_api.handle_post(
                self.conn,
                "/api/planning/work-item/apply",
                {
                    "id": item["reference"],
                    "claim": True,
                    "refs": [{"kind": "memory", "value": "abc1234"}],
                    "comment": {"body": "should vanish"},
                    "summary": {"done": "d", "next": "n"},
                    # The step stays open, so the closing transition is refused.
                    "transition": {"state": "done"},
                },
            )
        self.assertEqual("workflow_guard", refused.exception.code)
        # The HTTP surface commits what a handler leaves; the savepoint is what
        # keeps the earlier steps out of that commit.
        self.conn.commit()
        after = self.get("/api/planning/work-item", id=item["reference"])["work_item"]
        self.assertEqual(before, after)
        self.assertEqual(
            (0, 0),
            (
                self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0],
                self.conn.execute("SELECT COUNT(*) FROM work_item_refs").fetchone()[0],
            ),
        )
        self.assertFalse(steps["checklist"][0]["done"])

    def test_a_batch_transition_reason_has_the_event_limit_of_its_state(self) -> None:
        item = self.post("/api/planning/work-items", space="QA", title="Batch reason")
        self.conn.commit()
        before = self.get("/api/planning/work-item", id=item["reference"])["work_item"]
        with self.assertRaises(planning_api.PlanningHttpError) as refused:
            planning_api.handle_post(
                self.conn,
                "/api/planning/work-item/apply",
                {
                    "id": item["reference"],
                    "claim": True,
                    "transition": {"state": "blocked", "reason": "x" * (503 + 1)},
                },
            )
        self.assertEqual("invalid_request", refused.exception.code)
        self.assertIn("reason must be at most 503 characters", str(refused.exception))
        # The claim the batch took before the refused step is rolled back too.
        self.conn.commit()
        after = self.get("/api/planning/work-item", id=item["reference"])["work_item"]
        self.assertEqual(before, after)
        # The same limit, reached exactly, passes and is stored whole.
        moved = self.post(
            "/api/planning/work-item/apply",
            id=item["reference"],
            transition={"state": "blocked", "reason": "y" * 503, "acceptance": "assignment"},
        )
        self.assertEqual("blocked", moved["state"]["key"])
        (detail,) = self.conn.execute(
            "SELECT detail FROM work_item_events WHERE work_item_id = ?"
            " AND action = 'transitioned' ORDER BY rowid DESC LIMIT 1",
            (before["work_item_id"],),
        ).fetchone()
        self.assertEqual("blocked: " + "y" * 503, detail)

    def test_a_create_with_links_and_claim_answers_in_full_with_what_was_applied(self) -> None:
        origin = self.post("/api/planning/work-items", space="QA", title="Origin")
        created = self.post(
            "/api/planning/work-items",
            space="QA",
            title="Found",
            author="one",
            claim=True,
            links=[{"other": origin["reference"], "kind": "discovered-from"}],
        )
        self.assertEqual({"claim": True, "links": 1}, created["applied"])
        self.assertEqual("one", created["claim_ref"])
        self.assertEqual(
            [("discovered-from", origin["reference"])],
            [(link["kind"], link["reference"]) for link in created["links"]],
        )
        self.assertIn("events", created)
        plain = self.post("/api/planning/work-items", space="QA", title="Plain")
        self.assertNotIn("applied", plain)

    def test_a_refused_create_leaves_nothing_behind_a_commit(self) -> None:
        origin = self.post("/api/planning/work-items", space="QA", title="Origin")
        self.conn.commit()
        with self.assertRaises(planning_api.PlanningHttpError) as refused:
            planning_api.handle_post(
                self.conn,
                "/api/planning/work-items",
                {
                    "space": "QA",
                    "title": "Should vanish",
                    "claim": True,
                    "links": [
                        {"other": origin["reference"], "kind": "discovered-from"},
                        {"other": "QA-404", "kind": "relates-to"},
                    ],
                },
            )
        self.assertEqual(
            (404, "not_found", {"group": "links", "index": 1}),
            (
                refused.exception.status,
                refused.exception.code,
                refused.exception.detail["step"],
            ),
        )
        # The HTTP surface commits what a handler leaves; the savepoint is what
        # keeps the item, its claim and its first link out of that commit.
        self.conn.commit()
        self.assertEqual(
            (1, 0),
            (
                self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0],
                self.conn.execute("SELECT COUNT(*) FROM work_item_links").fetchone()[0],
            ),
        )
        origin_after = self.get("/api/planning/work-item", id=origin["reference"])["work_item"]
        self.assertEqual(origin["revision"], origin_after["revision"])
        self.assertEqual(["created"], [event["action"] for event in origin_after["events"]])

    def test_a_batch_runs_inside_a_transaction_the_caller_already_opened(self) -> None:
        item = self.post("/api/planning/work-items", space="QA", title="Nested")
        self.assertTrue(self.conn.in_transaction)
        answer = self.post(
            "/api/planning/work-item/apply", id=item["reference"], comment={"body": "kept"}
        )
        self.assertEqual({"comment"}, set(answer["applied"]))
        self.conn.rollback()
        # Nothing was committed on the caller's behalf: the item is gone too.
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])


class PlanningRouteDispatchTests(unittest.TestCase):
    """Every neutral path the domain declares is one a boundary answers."""

    def test_every_declared_path_is_dispatched(self) -> None:
        for path in planning_api.READ_PATHS:
            self.assertIsNotNone(http_surface._boundary(http_surface._GET_BOUNDARIES, path), path)
        for path in planning_api.WRITE_PATHS:
            self.assertIsNotNone(http_surface._boundary(http_surface._POST_BOUNDARIES, path), path)

    def test_the_exact_work_item_route_is_dispatched_with_plannings_loader(self) -> None:
        """The inspector reads one work item on a path the surface has to recognise.

        The handler behind this path has demanded an ``item_loader`` all along,
        while the surface once dispatched to it only for ``/api/modules``
        exactly or ``/api/platform/``. The path is neither, so it answered a
        bare 404 and the inspector never loaded. A mock backend answered it,
        which is why only a live server showed the gap.
        """

        boundary = http_surface._boundary(
            http_surface._GET_BOUNDARIES, planning_exact_api.WORK_ITEM_PATH
        )
        self.assertIsNotNone(boundary)
        assert boundary is not None
        self.assertIs(http_surface._planning_exact_read, boundary.handler)
        self.assertIn(
            "item_loader=_card_record",
            inspect.getsource(http_surface._planning_exact_read),
        )
        self.assertIn(
            "planning_service.get_work_item(",
            inspect.getsource(http_surface._card_record),
        )
        # And the handler really does demand one, which is what makes passing it
        # the fix rather than a decoration.
        self.assertIn(
            "the work item endpoint requires Planning's own loader",
            inspect.getsource(planning_exact_api.handle_get),
        )


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
