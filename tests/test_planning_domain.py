from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import store
from server.planning import model, service, views
from server.planning import store as planning_store


class PlanningDomainTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(
            self.conn, project_id="example-workspace", name="Alpha Workspace"
        )

    def item(self, title: str, **kwargs) -> dict:
        return service.create_work_item(
            self.conn, space=self.space["key"], title=title, author="tester", **kwargs
        )

    # -- vocabulary ----------------------------------------------------------

    def test_a_space_key_is_derived_and_never_shared(self) -> None:
        self.assertEqual("AW", self.space["key"])
        second = service.create_planning_space(
            self.conn, project_id="other", name="Alpha Workspace Two"
        )
        third = service.create_planning_space(self.conn, project_id="third", name="Valkama")
        self.assertEqual("AWT", second["key"])
        self.assertEqual("VAL", third["key"])
        keys = {row[0] for row in self.conn.execute("SELECT key FROM planning_spaces")}
        self.assertEqual(3, len(keys))

    def test_a_derived_key_that_collides_is_numbered(self) -> None:
        service.create_planning_space(self.conn, project_id="p2", name="Agent Workflow")
        keys = sorted(row[0] for row in self.conn.execute("SELECT key FROM planning_spaces"))
        self.assertEqual(["AW", "AW2"], keys)

    def test_a_human_reference_round_trips(self) -> None:
        created = self.item("Land the planning domain")
        self.assertEqual("EX-1", created["reference"])
        self.assertEqual(
            created["work_item_id"], service.get_work_item(self.conn, "EX-1")["work_item_id"]
        )
        self.assertEqual(("AW", 1), model.parse_human_id("EX-1"))
        with self.assertRaisesRegex(model.PlanningError, "KEY-NUMBER"):
            model.parse_human_id("EX-1")

    def test_a_number_is_never_handed_out_twice(self) -> None:
        first = self.item("First")
        service.delete_work_item(self.conn, first["reference"])
        second = self.item("Second")
        self.assertEqual("EX-2", second["reference"])

    # -- workflow is data ----------------------------------------------------

    def test_the_default_workflow_is_rows_and_carries_categories(self) -> None:
        workflow = self.space["workflow"]
        self.assertEqual(
            [
                ("backlog", "backlog"),
                ("todo", "queued"),
                ("dev", "active"),
                ("review", "review"),
                ("done", "completed"),
                ("blocked", "blocked"),
            ],
            [(state["key"], state["category"]) for state in workflow["states"]],
        )
        terminal = [state["key"] for state in workflow["states"] if state["is_terminal"]]
        self.assertEqual(["done"], terminal)
        # Every ordered pair except a state to itself, as explicit rows.
        self.assertEqual(6 * 5, len(workflow["transitions"]))

    def test_a_state_the_workflow_does_not_have_is_refused(self) -> None:
        created = self.item("Land the planning domain")
        with self.assertRaisesRegex(model.PlanningError, "no state named shipped"):
            service.transition_work_item(self.conn, created["reference"], "shipped")

    def test_a_transition_the_workflow_lacks_is_refused_by_its_own_guard(self) -> None:
        created = self.item("Land the planning domain")
        state = {
            row[0]: row[1]
            for row in self.conn.execute(
                "SELECT key, state_id FROM workflow_states WHERE workflow_id = ?",
                (self.space["workflow"]["workflow_id"],),
            )
        }
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE from_state_id = ? AND to_state_id = ?",
            (state["backlog"], state["todo"]),
        )
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[transition\]"):
            service.transition_work_item(self.conn, created["reference"], "todo")

    # -- guards --------------------------------------------------------------

    def test_starting_an_item_needs_an_executor(self) -> None:
        created = self.item("Land the planning domain")
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[executor\]"):
            service.transition_work_item(self.conn, created["reference"], "dev")
        service.claim_work_item(self.conn, created["reference"], author="tester")
        moved = service.transition_work_item(self.conn, created["reference"], "dev")
        self.assertEqual("dev", moved["state"]["key"])

    def test_a_claimed_checklist_step_is_an_executor_too(self) -> None:
        created = self.item("Land the planning domain")
        with_steps = service.set_checklist(self.conn, created["reference"], ["write it", "test it"])
        service.claim_checklist_item(
            self.conn, created["reference"], with_steps["checklist"][0]["id"], author="tester"
        )
        moved = service.transition_work_item(self.conn, created["reference"], "dev")
        self.assertEqual("dev", moved["state"]["key"])

    def test_closing_needs_every_step_ticked_and_a_summary(self) -> None:
        created = self.item("Land the planning domain")
        with_steps = service.set_checklist(self.conn, created["reference"], ["write it"])
        with self.assertRaises(model.WorkflowGuardError) as refusal:
            service.transition_work_item(self.conn, created["reference"], "done")
        self.assertIn("[checklist]", str(refusal.exception))
        self.assertIn("[summary]", str(refusal.exception))
        service.tick_checklist_item(
            self.conn, created["reference"], with_steps["checklist"][0]["id"], author="tester"
        )
        service.set_summary(
            self.conn, created["reference"], {"done": "it is written", "next": "the surfaces"}
        )
        closed = service.transition_work_item(self.conn, created["reference"], "done")
        self.assertTrue(closed["state"]["is_terminal"])

    def test_blocking_needs_a_blocker_or_a_reason(self) -> None:
        created = self.item("Land the planning domain")
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[blocker\]"):
            service.transition_work_item(self.conn, created["reference"], "blocked")
        with_reason = service.transition_work_item(
            self.conn, created["reference"], "blocked", reason="waiting on the owner"
        )
        self.assertEqual("blocked", with_reason["state"]["key"])

    def test_review_warns_without_evidence_instead_of_refusing(self) -> None:
        created = self.item("Land the planning domain")
        moved = service.transition_work_item(self.conn, created["reference"], "review")
        self.assertEqual(["EX-1 enters Review with no session or commit ref"], moved["warnings"])
        service.attach_ref(self.conn, created["reference"], "commit", "abc1234", author="tester")
        again = service.transition_work_item(self.conn, created["reference"], "todo")
        self.assertEqual([], again["warnings"])

    def test_force_carries_a_refusal_through_and_records_the_override(self) -> None:
        created = self.item("Land the planning domain")
        forced = service.transition_work_item(
            self.conn, created["reference"], "dev", force=True, author="tester"
        )
        self.assertEqual(["executor"], forced["overridden"])
        actions = [event["action"] for event in forced["events"]]
        self.assertEqual(["created", "transitioned", "overridden"], actions)

    # -- claims and revisions ------------------------------------------------

    def test_a_held_item_refuses_a_second_claim_and_records_a_takeover(self) -> None:
        created = self.item("Land the planning domain")
        service.claim_work_item(self.conn, created["reference"], author="first")
        with self.assertRaisesRegex(model.PlanningError, "already held by first"):
            service.claim_work_item(self.conn, created["reference"], author="second")
        taken = service.claim_work_item(
            self.conn, created["reference"], author="second", force=True
        )
        self.assertEqual("second", taken["claim_ref"])
        self.assertIn("taken_over", [event["action"] for event in taken["events"]])

    def test_a_stale_revision_is_refused(self) -> None:
        created = self.item("Land the planning domain")
        service.claim_work_item(self.conn, created["reference"], author="tester")
        with self.assertRaises(model.RevisionConflictError):
            service.set_summary(
                self.conn,
                created["reference"],
                {"done": "x", "next": "y"},
                expected_revision=created["revision"],
            )

    def test_updating_source_keeps_identity_trail_and_related_records(self) -> None:
        created = self.item("Land the planning domain", source="docs/old.md#kb:old1")
        with_steps = service.set_checklist(self.conn, created["reference"], ["write it"])
        service.attach_ref(self.conn, created["reference"], "commit", "abc1234", author="tester")
        service.comment_work_item(
            self.conn, created["reference"], "keep this note", author="tester"
        )
        before = service.get_work_item(self.conn, created["reference"])

        updated = service.update_work_item(
            self.conn,
            created["reference"],
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
        self.assertEqual(len(before["events"]), len(updated["events"]))
        self.assertGreater(updated["revision"], before["revision"])

        with self.assertRaises(model.RevisionConflictError):
            service.update_work_item(
                self.conn,
                created["reference"],
                source="docs/stale.md#kb:stale1",
                expected_revision=before["revision"],
            )

    def test_a_revision_only_ever_moves_forward(self) -> None:
        created = self.item("Land the planning domain")
        revisions = [created["revision"]]
        revisions.append(
            service.claim_work_item(self.conn, created["reference"], author="t")["revision"]
        )
        revisions.append(
            service.update_work_item(self.conn, created["reference"], title="Renamed")["revision"]
        )
        revisions.append(
            service.transition_work_item(self.conn, created["reference"], "dev")["revision"]
        )
        self.assertEqual(revisions, sorted(revisions))
        self.assertEqual(len(revisions), len(set(revisions)))

    def test_replacing_an_engaged_checklist_needs_force(self) -> None:
        created = self.item("Land the planning domain")
        steps = service.set_checklist(self.conn, created["reference"], ["write it"])
        service.claim_checklist_item(
            self.conn, created["reference"], steps["checklist"][0]["id"], author="tester"
        )
        with self.assertRaisesRegex(model.PlanningError, "claimed or completed"):
            service.set_checklist(self.conn, created["reference"], ["something else"])
        replaced = service.set_checklist(
            self.conn, created["reference"], ["something else"], force=True
        )
        self.assertEqual(["something else"], [step["text"] for step in replaced["checklist"]])

    # -- ready work ----------------------------------------------------------

    def test_claim_ready_skips_a_blocked_item_and_prefers_urgency(self) -> None:
        blocked = self.item("Blocked work")
        blocker = self.item("The blocker")
        service.link_work_items(self.conn, blocker["reference"], blocked["reference"], "blocks")
        urgent = self.item("Urgent work", priority="urgent")
        picked = service.claim_ready_work_item(self.conn, space=self.space["key"], author="tester")
        self.assertEqual(urgent["reference"], picked["reference"])
        second = service.claim_ready_work_item(self.conn, space=self.space["key"], author="tester")
        self.assertEqual(blocker["reference"], second["reference"])
        third = service.claim_ready_work_item(self.conn, space=self.space["key"], author="tester")
        self.assertIsNone(third)

    def test_a_finished_blocker_stops_blocking(self) -> None:
        blocked = self.item("Blocked work")
        blocker = self.item("The blocker")
        service.link_work_items(self.conn, blocker["reference"], blocked["reference"], "blocks")
        service.set_summary(self.conn, blocker["reference"], {"done": "d", "next": "n"})
        service.transition_work_item(self.conn, blocker["reference"], "done")
        graph = views.graph_payload(self.conn)
        ready = {node["reference"]: node["ready"] for node in graph["nodes"]}
        self.assertTrue(ready[blocked["reference"]])

    # -- read model ----------------------------------------------------------

    def test_the_read_model_is_flat_and_carries_the_workflow(self) -> None:
        first = self.item("First")
        second = self.item("Second")
        service.link_work_items(self.conn, first["reference"], second["reference"], "relates-to")
        payload = views.planning_payload(self.conn)
        self.assertEqual(views.READ_MODEL_INTERFACE, payload["interface_version"])
        self.assertEqual("AW", payload["planning_space"]["key"])
        self.assertEqual(6, len(payload["workflow"]["states"]))
        self.assertEqual(2, len(payload["work_items"]))
        self.assertEqual(
            [{"from": first["work_item_id"], "to": second["work_item_id"], "kind": "relates-to"}],
            payload["links"],
        )
        # Nothing is pre-grouped: a lane-shaped key would make Kanban the model.
        self.assertNotIn("columns", payload)
        self.assertNotIn("lanes", payload)

    def test_an_empty_store_has_a_read_model_rather_than_a_failure(self) -> None:
        self.conn.execute("DELETE FROM planning_spaces")
        payload = views.planning_payload(self.conn)
        self.assertIsNone(payload["planning_space"])
        self.assertEqual([], payload["work_items"])
        self.assertEqual(
            {
                "interface_version": views.READ_MODEL_INTERFACE,
                "planning_space": None,
                "nodes": [],
                "edges": [],
            },
            views.graph_payload(self.conn),
        )

    def test_search_reads_title_description_and_summary(self) -> None:
        first = self.item("Land the planning domain", description="the store and the service")
        second = self.item("Something else")
        service.set_summary(
            self.conn, second["reference"], {"done": "planning domain notes", "next": "n"}
        )
        by_title = service.search_work_items(self.conn, "planning domain")
        self.assertEqual(
            {first["reference"], second["reference"]},
            {item["reference"] for item in by_title},
        )
        by_description = service.search_work_items(self.conn, "the store")
        self.assertEqual([first["reference"]], [item["reference"] for item in by_description])
        self.assertEqual([], service.search_work_items(self.conn, "nothing matches this"))
        scoped = service.search_work_items(self.conn, "planning", space=self.space["key"])
        self.assertEqual(2, len(scoped))

    def test_activity_reads_newest_first_across_spaces(self) -> None:
        created = self.item("First")
        service.claim_work_item(self.conn, created["reference"], author="tester")
        feed = views.activity_feed(self.conn, limit=10)
        self.assertEqual(["claimed", "created"], [entry["action"] for entry in feed])
        self.assertEqual("EX-1", feed[0]["reference"])

    def test_a_project_gets_its_space_on_first_use(self) -> None:
        self.assertIsNone(views.space_for_project(self.conn, "sims"))
        made = views.ensure_space_for_project(self.conn, "sims", name="Sample Mods Manager")
        self.assertEqual("sims", made["project_id"])
        self.assertEqual(
            made["planning_space_id"],
            views.ensure_space_for_project(self.conn, "sims")["planning_space_id"],
        )

    # -- hierarchy and links -------------------------------------------------

    def test_a_hierarchy_is_one_level_deep(self) -> None:
        epic = self.item("The epic", kind="epic")
        child = self.item("The child", parent=epic["reference"])
        self.assertEqual(epic["work_item_id"], child["parent_id"])
        with self.assertRaisesRegex(model.PlanningError, "one level deep"):
            self.item("The grandchild", parent=child["reference"])

    def test_an_epic_with_children_is_not_deleted_by_accident(self) -> None:
        epic = self.item("The epic", kind="epic")
        self.item("The child", parent=epic["reference"])
        with self.assertRaisesRegex(model.PlanningError, "child item"):
            service.delete_work_item(self.conn, epic["reference"])

    def test_a_link_is_visible_from_both_ends(self) -> None:
        first = self.item("First")
        second = self.item("Second")
        service.link_work_items(self.conn, first["reference"], second["reference"], "blocks")
        forward = service.get_work_item(self.conn, first["reference"])["links"]
        backward = service.get_work_item(self.conn, second["reference"])["links"]
        self.assertEqual(
            [("blocks", "outgoing", second["reference"])],
            [(link["kind"], link["direction"], link["reference"]) for link in forward],
        )
        self.assertEqual(
            [("blocks", "incoming", first["reference"])],
            [(link["kind"], link["direction"], link["reference"]) for link in backward],
        )

    def test_an_item_cannot_link_to_itself(self) -> None:
        first = self.item("First")
        with self.assertRaisesRegex(model.PlanningError, "linked to itself"):
            service.link_work_items(self.conn, first["reference"], first["reference"], "blocks")

    # -- storage invariants --------------------------------------------------

    def test_every_declared_table_exists_after_connect(self) -> None:
        present = {
            row[0] for row in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertTrue(set(planning_store.SCHEMA_TABLES) <= present)

    def test_the_event_check_matches_the_declared_actions(self) -> None:
        sql = self.conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'work_item_events'"
        ).fetchone()[0]
        for action in model.EVENT_ACTIONS:
            self.assertIn(f"'{action}'", sql)
        created = self.item("First")
        with self.assertRaises(model.PlanningError):
            service._log(self.conn, created["work_item_id"], "invented", "", "tester")

    def test_deleting_an_item_takes_its_trail_with_it(self) -> None:
        created = self.item("First")
        service.attach_ref(self.conn, created["reference"], "url", "https://example.invalid")
        service.comment_work_item(self.conn, created["reference"], "a note")
        service.delete_work_item(self.conn, created["reference"])
        for table in ("work_item_refs", "work_item_comments", "work_item_events"):
            self.assertEqual(
                0, self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], table
            )

    def test_a_space_cannot_hold_two_items_with_one_number(self) -> None:
        created = self.item("First")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
                "title,position) VALUES(?,?,?,?,?,?,?)",
                (
                    model.new_id(),
                    created["planning_space_id"],
                    created["number"],
                    self.space["workflow"]["workflow_id"],
                    self.space["workflow"]["initial_state_id"],
                    "A clash",
                    1.0,
                ),
            )

    def test_an_improvement_guard_is_asked_only_for_an_improvement_source(self) -> None:
        asked: list[str] = []

        def guard(source: str, _summary: str) -> dict | None:
            asked.append(source)
            return {"allowed": False, "guard": "improvement_eval", "message": "not evaluated"}

        plain = self.item("Plain work")
        service.set_summary(self.conn, plain["reference"], {"done": "d", "next": "n"})
        service.transition_work_item(self.conn, plain["reference"], "done", improvement_guard=guard)
        self.assertEqual([], asked)

        raised = self.item("Raised work", source="improvement://case/7")
        service.set_summary(self.conn, raised["reference"], {"done": "d", "next": "n"})
        with self.assertRaisesRegex(model.WorkflowGuardError, "not evaluated"):
            service.transition_work_item(
                self.conn, raised["reference"], "done", improvement_guard=guard
            )
        self.assertEqual(["improvement://case/7"], asked)


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
