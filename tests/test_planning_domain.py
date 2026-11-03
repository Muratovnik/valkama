from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import store
from server.planning import calls, model, service, views
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
            self.conn, project_id="example-workspace", name="Quality Assurance"
        )

    def item(self, title: str, **kwargs) -> dict:
        return service.create_work_item(
            self.conn, space=self.space["key"], title=title, author="tester", **kwargs
        )

    # -- vocabulary ----------------------------------------------------------

    def test_a_space_key_is_derived_and_never_shared(self) -> None:
        self.assertEqual("QA", self.space["key"])
        second = service.create_planning_space(
            self.conn, project_id="other", name="Quality Assurance Two"
        )
        third = service.create_planning_space(self.conn, project_id="third", name="Valkama")
        self.assertEqual("QAT", second["key"])
        self.assertEqual("VAL", third["key"])
        keys = {row[0] for row in self.conn.execute("SELECT key FROM planning_spaces")}
        self.assertEqual(3, len(keys))

    def test_a_derived_key_that_collides_is_numbered(self) -> None:
        service.create_planning_space(self.conn, project_id="p2", name="Quick Analysis")
        keys = sorted(row[0] for row in self.conn.execute("SELECT key FROM planning_spaces"))
        self.assertEqual(["QA", "QA2"], keys)

    def test_a_human_reference_round_trips(self) -> None:
        created = self.item("Land the planning domain")
        self.assertEqual("QA-1", created["reference"])
        self.assertEqual(
            created["work_item_id"], service.get_work_item(self.conn, "QA-1")["work_item_id"]
        )
        self.assertEqual(("QA", 1), model.parse_human_id("QA-1"))
        with self.assertRaisesRegex(model.PlanningError, "KEY-NUMBER"):
            model.parse_human_id("qa-1")

    def test_a_number_is_never_handed_out_twice(self) -> None:
        first = self.item("First")
        service.delete_work_item(self.conn, first["reference"])
        second = self.item("Second")
        self.assertEqual("QA-2", second["reference"])

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
                ("cancelled", "cancelled"),
            ],
            [(state["key"], state["category"]) for state in workflow["states"]],
        )
        terminal = [state["key"] for state in workflow["states"] if state["is_terminal"]]
        self.assertEqual(["done", "cancelled"], terminal)
        # Every ordered pair except a state to itself, as explicit rows.
        self.assertEqual(7 * 6, len(workflow["transitions"]))

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

    def test_cancelling_needs_a_summary_and_leaves_undone_steps_open(self) -> None:
        created = self.item("Land the planning domain")
        service.set_checklist(self.conn, created["reference"], ["write it", "test it"])
        with self.assertRaises(model.WorkflowGuardError) as refusal:
            service.transition_work_item(self.conn, created["reference"], "cancelled")
        self.assertIn("[summary]", str(refusal.exception))
        self.assertNotIn("[checklist]", str(refusal.exception))
        service.set_summary(
            self.conn,
            created["reference"],
            {"done": "Not needed: the surfaces already cover it", "next": "nothing"},
        )
        cancelled = service.transition_work_item(self.conn, created["reference"], "cancelled")
        self.assertEqual("cancelled", cancelled["state"]["category"])
        self.assertTrue(cancelled["state"]["is_terminal"])
        self.assertEqual([False, False], [step["done"] for step in cancelled["checklist"]])
        self.assertEqual([], cancelled.get("overridden", []))
        # Done still refuses the same open steps: only cancelling may leave them.
        reopened = service.transition_work_item(self.conn, created["reference"], "backlog")
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[checklist\]"):
            service.transition_work_item(self.conn, reopened["reference"], "done")

    def test_a_workflow_shaped_like_the_old_default_gains_cancelled_once(self) -> None:
        workflow_id = self.space["workflow"]["workflow_id"]
        cancelled = self.conn.execute(
            "SELECT state_id FROM workflow_states WHERE workflow_id = ? AND key = 'cancelled'",
            (workflow_id,),
        ).fetchone()["state_id"]
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE from_state_id = ? OR to_state_id = ?",
            (cancelled, cancelled),
        )
        self.conn.execute("DELETE FROM workflow_states WHERE state_id = ?", (cancelled,))
        held = self.item("Already here")
        custom = service.create_planning_space(self.conn, project_id="custom", name="Custom")
        self.conn.execute(
            "UPDATE workflow_states SET key = 'shipped' WHERE workflow_id = ? AND key = 'done'",
            (custom["workflow"]["workflow_id"],),
        )
        custom_cancelled = self.conn.execute(
            "SELECT state_id FROM workflow_states WHERE workflow_id = ? AND key = 'cancelled'",
            (custom["workflow"]["workflow_id"],),
        ).fetchone()["state_id"]
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE from_state_id = ? OR to_state_id = ?",
            (custom_cancelled, custom_cancelled),
        )
        self.conn.execute("DELETE FROM workflow_states WHERE state_id = ?", (custom_cancelled,))
        self.conn.commit()
        self.conn.close()

        for _ in range(2):
            reopened = store.connect()
            space = service.get_planning_space(reopened, self.space["key"])
            states = space["workflow"]["states"]
            self.assertEqual("cancelled", states[-1]["key"])
            self.assertEqual(6, states[-1]["position"])
            self.assertEqual(7 * 6, len(space["workflow"]["transitions"]))
            other = service.get_planning_space(reopened, custom["key"])
            self.assertNotIn("cancelled", [state["key"] for state in other["workflow"]["states"]])
            item = service.get_work_item(reopened, held["reference"])
            self.assertEqual("backlog", item["state"]["key"])
            reopened.close()

    def test_blocking_needs_a_blocker_or_a_reason(self) -> None:
        created = self.item("Land the planning domain")
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[blocker\]"):
            service.transition_work_item(self.conn, created["reference"], "blocked")
        with_reason = service.transition_work_item(
            self.conn, created["reference"], "blocked", reason="waiting on the owner"
        )
        self.assertEqual("blocked", with_reason["state"]["key"])

    def test_a_reason_at_the_event_limit_is_stored_whole(self) -> None:
        created = self.item("Land the planning domain")
        # The event reads "<state key>: <reason>" within 512 characters, so the
        # reason may use what the state key leaves: 512 - len("blocked: ") = 503.
        reason = ("0123456789" * 60)[: 512 - len("blocked: ")]
        moved = service.transition_work_item(
            self.conn, created["reference"], "blocked", reason=reason
        )
        self.assertEqual("blocked", moved["state"]["key"])
        (detail,) = self.conn.execute(
            "SELECT detail FROM work_item_events WHERE work_item_id = ?"
            " AND action = 'transitioned' ORDER BY rowid DESC LIMIT 1",
            (created["work_item_id"],),
        ).fetchone()
        self.assertEqual(f"blocked: {reason}", detail)

    def test_a_reason_one_character_over_the_event_limit_is_refused_and_writes_nothing(
        self,
    ) -> None:
        created = self.item("Land the planning domain")
        before = service.get_work_item(self.conn, created["reference"])
        events_before = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ?",
            (created["work_item_id"],),
        ).fetchone()[0]
        with self.assertRaisesRegex(
            model.PlanningError, r"^reason must be at most 503 characters$"
        ):
            service.transition_work_item(
                self.conn, created["reference"], "blocked", reason="x" * (503 + 1)
            )
        after = service.get_work_item(self.conn, created["reference"])
        self.assertEqual(before["state"]["key"], after["state"]["key"])
        self.assertEqual(before["revision"], after["revision"])
        events_after = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_events WHERE work_item_id = ?",
            (created["work_item_id"],),
        ).fetchone()[0]
        self.assertEqual(events_before, events_after)

    def test_review_warns_without_evidence_instead_of_refusing(self) -> None:
        created = self.item("Land the planning domain")
        moved = service.transition_work_item(self.conn, created["reference"], "review")
        self.assertEqual(["QA-1 enters Review with no session or commit ref"], moved["warnings"])
        service.attach_ref(self.conn, created["reference"], "commit", "abc1234", author="tester")
        again = service.transition_work_item(self.conn, created["reference"], "todo")
        self.assertEqual([], again["warnings"])

    def test_review_takes_a_confirmed_write_as_evidence_of_its_session(self) -> None:
        unconfirmed = self.item("Written by a call nobody can vouch for")
        with calls.bind(calls.Identity("unconfirmed", "mcp", session_id="s-1"), "comment"):
            service.comment_work_item(
                self.conn, unconfirmed["reference"], "started", author="tester"
            )
        warned = service.transition_work_item(self.conn, unconfirmed["reference"], "review")
        self.assertEqual(1, len(warned["warnings"]))

        confirmed = self.item("Written by a confirmed session")
        with calls.bind(calls.Identity("confirmed", "claude-hook", session_id="s-2"), "comment"):
            service.comment_work_item(self.conn, confirmed["reference"], "started", author="tester")
        moved = service.transition_work_item(self.conn, confirmed["reference"], "review")
        self.assertEqual([], moved["warnings"])

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

    def test_claim_ready_skips_a_blocked_item_and_follows_the_planned_order(self) -> None:
        # Priority no longer jumps the order: the urgent item was created last,
        # so it is last in its state and waits until somebody places it first.
        blocked = self.item("Blocked work")
        blocker = self.item("The blocker")
        service.link_work_items(self.conn, blocker["reference"], blocked["reference"], "blocks")
        urgent = self.item("Urgent work", priority="urgent")
        picked = service.claim_ready_work_item(self.conn, space=self.space["key"], author="tester")
        self.assertEqual(blocker["reference"], picked["reference"])
        second = service.claim_ready_work_item(self.conn, space=self.space["key"], author="tester")
        self.assertEqual(urgent["reference"], second["reference"])
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
        self.assertEqual("QA", payload["planning_space"]["key"])
        self.assertEqual(7, len(payload["workflow"]["states"]))
        self.assertEqual(2, len(payload["work_items"]))
        self.assertEqual(
            [
                {
                    "from": first["work_item_id"],
                    "to": second["work_item_id"],
                    "kind": "relates-to",
                    "reference": first["reference"],
                    "state_name": "Backlog",
                    "state_category": "backlog",
                    "is_terminal": False,
                    "state_unavailable": None,
                }
            ],
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

    def test_search_puts_the_item_a_reference_names_ahead_of_newer_mentions(self) -> None:
        exact = self.item("Asked for by number")
        for number in range(2, 13):
            self.item(f"Filler {number}", description=f"Mentions {exact['reference']}")
        self.conn.execute(
            "UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z' WHERE work_item_id = ?",
            (exact["work_item_id"],),
        )
        # QA-10..QA-12 also carry "QA-1" in their reference, and every filler
        # mentions it, so each of them matches and is newer than the item.
        newest_first = [item["reference"] for item in service.search_work_items(self.conn, "QA")]
        for query in ("QA-1", "qa-1", "  Qa-1  "):
            with self.subTest(query=query):
                found = [item["reference"] for item in service.search_work_items(self.conn, query)]
                self.assertEqual(["QA-1", *[ref for ref in newest_first if ref != "QA-1"]], found)
                self.assertEqual(
                    ["QA-1"],
                    [
                        item["reference"]
                        for item in service.search_work_items(self.conn, query, limit=1)
                    ],
                )

    def test_search_puts_the_item_a_number_alone_names_ahead_of_newer_matches(self) -> None:
        """`1` in a space is the item numbered 1 there, however much else matches.

        An editor's `#1` asks the space's search for `1`: QA-10 and up carry it
        in their reference and are newer, so newest-first put the item past
        them, and a page of one cut it off.
        """

        other = service.create_planning_space(
            self.conn, project_id="second", name="Release", key="REL"
        )
        exact = self.item("Asked for by number")
        for number in range(2, 13):
            self.item(f"Filler {number}")
        service.create_work_item(self.conn, space="REL", title="The other space's first")
        self.conn.execute(
            "UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z' WHERE number = 1",
        )
        newest_first = [
            item["reference"]
            for item in service.search_work_items(self.conn, "QA-1", space=self.space["key"])
            if item["reference"] != exact["reference"]
        ]
        for query in ("1", "  1 "):
            with self.subTest(query=query):
                scoped = service.search_work_items(self.conn, query, space=self.space["key"])
                self.assertEqual(
                    [exact["reference"], *newest_first], [item["reference"] for item in scoped]
                )
                page = service.search_work_items(self.conn, query, space=self.space["key"], limit=1)
                self.assertEqual([exact["reference"]], [item["reference"] for item in page])
                # Without a space the number names each space's item of it.
                both = service.search_work_items(self.conn, query, limit=2)
                self.assertEqual(
                    {exact["reference"], f"{other['key']}-1"},
                    {item["reference"] for item in both},
                )
        # Only the number by itself names an item; anything else is a phrase.
        for phrase in ("01", "1a", "#1", "0"):
            with self.subTest(phrase=phrase):
                self.assertIsNone(model.exact_number(phrase))

    def test_activity_reads_newest_first_across_spaces(self) -> None:
        created = self.item("First")
        service.claim_work_item(self.conn, created["reference"], author="tester")
        feed = views.activity_feed(self.conn, limit=10)
        # The claim started the item, so its transition is the newest entry.
        self.assertEqual(
            ["transitioned", "claimed", "created"], [entry["action"] for entry in feed]
        )
        self.assertEqual("QA-1", feed[0]["reference"])

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

    def test_an_item_cannot_be_its_own_parent(self) -> None:
        item = self.item("Self")
        with self.assertRaisesRegex(model.PlanningError, "its own parent"):
            service.update_work_item(self.conn, item["reference"], parent=item["reference"])
        self.assertIsNone(service.get_work_item(self.conn, item["reference"])["parent_id"])

    def test_reparenting_refuses_a_parent_in_another_planning_space(self) -> None:
        other = service.create_planning_space(self.conn, project_id="other", name="Other Work")
        foreign = service.create_work_item(
            self.conn, space=other["key"], title="Elsewhere", kind="epic", author="tester"
        )
        item = self.item("Local")
        with self.assertRaisesRegex(model.PlanningError, "another planning space"):
            service.update_work_item(self.conn, item["reference"], parent=foreign["reference"])
        self.assertIsNone(service.get_work_item(self.conn, item["reference"])["parent_id"])

    def test_reparenting_refuses_a_parent_that_is_itself_a_child(self) -> None:
        epic = self.item("The epic", kind="epic")
        child = self.item("The child", parent=epic["reference"])
        item = self.item("Loose")
        with self.assertRaisesRegex(model.PlanningError, "one level deep"):
            service.update_work_item(self.conn, item["reference"], parent=child["reference"])

    def test_reparenting_refuses_an_item_that_already_has_children(self) -> None:
        epic = self.item("The epic", kind="epic")
        middle = self.item("The middle", kind="epic")
        self.item("The grandchild", parent=middle["reference"])
        with self.assertRaisesRegex(model.PlanningError, "with children"):
            service.update_work_item(self.conn, middle["reference"], parent=epic["reference"])
        self.assertIsNone(service.get_work_item(self.conn, middle["reference"])["parent_id"])

    def test_a_parent_cycle_is_refused_in_either_direction(self) -> None:
        first = self.item("First")
        second = self.item("Second")
        service.update_work_item(self.conn, first["reference"], parent=second["reference"])
        with self.assertRaisesRegex(model.PlanningError, "one level deep"):
            service.update_work_item(self.conn, second["reference"], parent=first["reference"])
        self.assertIsNone(service.get_work_item(self.conn, second["reference"])["parent_id"])

    def test_a_reparent_and_a_detach_are_allowed(self) -> None:
        first_epic = self.item("First epic", kind="epic")
        second_epic = self.item("Second epic", kind="epic")
        child = self.item("The child", parent=first_epic["reference"])
        moved = service.update_work_item(
            self.conn, child["reference"], parent=second_epic["reference"]
        )
        self.assertEqual(second_epic["work_item_id"], moved["parent_id"])
        detached = service.update_work_item(self.conn, child["reference"], parent="")
        self.assertIsNone(detached["parent_id"])

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

    def close(self, reference: str, state: str) -> None:
        service.set_summary(self.conn, reference, {"done": "d", "next": "n"})
        service.transition_work_item(self.conn, reference, state)

    @staticmethod
    def other_end(links: list[dict]) -> dict[str, tuple]:
        return {
            link["reference"]: (
                link["direction"],
                link["state_name"],
                link["state_category"],
                link["is_terminal"],
                link["state_unavailable"],
            )
            for link in links
        }

    def test_a_link_says_whether_its_other_end_is_still_open(self) -> None:
        """A reader judges a blocker by the state of the item at the link's other end.

        Without it a card listed a finished blocker as blocking, because the
        only state it could see was its own item's.
        """

        blocked = self.item("Blocked work")
        open_blocker = self.item("Still open")
        done_blocker = self.item("Finished")
        cancelled_blocker = self.item("Not needed")
        other_space = service.create_planning_space(
            self.conn, project_id="other-project", name="Other Space", key="OTH"
        )
        foreign = service.create_work_item(
            self.conn, space=other_space["key"], title="Elsewhere", state="review"
        )
        for blocker in (open_blocker, done_blocker, cancelled_blocker, foreign):
            service.link_work_items(self.conn, blocker["reference"], blocked["reference"], "blocks")
        self.close(done_blocker["reference"], "done")
        self.close(cancelled_blocker["reference"], "cancelled")

        self.assertEqual(
            {
                open_blocker["reference"]: ("incoming", "Backlog", "backlog", False, None),
                done_blocker["reference"]: ("incoming", "Done", "completed", True, None),
                cancelled_blocker["reference"]: (
                    "incoming",
                    "Cancelled",
                    "cancelled",
                    True,
                    None,
                ),
                foreign["reference"]: ("incoming", "Review", "review", False, None),
            },
            self.other_end(service.get_work_item(self.conn, blocked["reference"])["links"]),
        )
        # The other direction names the blocked item's state, not the blocker's own.
        self.close(blocked["reference"], "done")
        for blocker in (open_blocker, foreign):
            with self.subTest(blocker=blocker["reference"]):
                self.assertEqual(
                    {blocked["reference"]: ("outgoing", "Done", "completed", True, None)},
                    self.other_end(service.get_work_item(self.conn, blocker["reference"])["links"]),
                )

    def test_a_link_whose_other_end_has_no_readable_state_says_so(self) -> None:
        """A state the store cannot resolve is reported as unknown, never as open."""

        blocked = self.item("Blocked work")
        blocker = self.item("Damaged")
        service.link_work_items(self.conn, blocker["reference"], blocked["reference"], "blocks")
        # The pragma is ignored inside a transaction.
        self.conn.commit()
        self.conn.execute("PRAGMA foreign_keys=OFF")
        self.conn.execute(
            "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
            ("00000000-0000-4000-8000-000000000000", blocker["work_item_id"]),
        )
        (link,) = service.get_work_item(self.conn, blocked["reference"])["links"]
        self.assertEqual(
            (blocker["reference"], "Damaged", None, None, None, "state_missing"),
            (
                link["reference"],
                link["title"],
                link["state_name"],
                link["state_category"],
                link["is_terminal"],
                link["state_unavailable"],
            ),
        )

    @staticmethod
    def source_of(payload: dict, target: str) -> list[tuple]:
        return [
            (
                link["reference"],
                link["kind"],
                link["state_name"],
                link["state_category"],
                link["is_terminal"],
                link["state_unavailable"],
            )
            for link in payload["links"]
            if link["to"] == target
        ]

    def test_a_view_carries_a_blocker_from_another_space_with_its_state(self) -> None:
        """A space's view holds the links into it too, each naming its source's state.

        It used to read only the links leaving the space, so an item blocked
        from another space was shown with nothing to say why it could not be
        taken, and the graph could not name what it waited on.
        """

        blocked = self.item("Blocked from elsewhere")
        other_space = service.create_planning_space(
            self.conn, project_id="other-project", name="Other Space", key="OTH"
        )
        foreign = service.create_work_item(
            self.conn, space=other_space["key"], title="Elsewhere", state="review"
        )
        service.link_work_items(self.conn, foreign["reference"], blocked["reference"], "blocks")
        # Another kind of link from there stays that space's to show.
        service.link_work_items(self.conn, foreign["reference"], blocked["reference"], "relates-to")

        here = views.planning_payload(self.conn, space=self.space["key"])
        self.assertEqual(
            [(foreign["reference"], "blocks", "Review", "review", False, None)],
            self.source_of(here, blocked["work_item_id"]),
        )
        # The other space's view still carries the same link, leaving it.
        there = views.planning_payload(self.conn, space=other_space["key"])
        self.assertEqual(["blocks", "relates-to"], sorted(link["kind"] for link in there["links"]))
        graph = {
            node["reference"]: node
            for node in views.graph_payload(self.conn, space=self.space["key"])["nodes"]
        }
        self.assertEqual(
            (False, 1), (graph[blocked["reference"]]["ready"], graph[blocked["reference"]]["depth"])
        )

        # Finished, the foreign blocker blocks nothing: the item is workable again.
        self.close(foreign["reference"], "done")
        here = views.planning_payload(self.conn, space=self.space["key"])
        self.assertEqual(
            [(foreign["reference"], "blocks", "Done", "completed", True, None)],
            self.source_of(here, blocked["work_item_id"]),
        )
        graph = {
            node["reference"]: node
            for node in views.graph_payload(self.conn, space=self.space["key"])["nodes"]
        }
        self.assertEqual(
            (True, 0), (graph[blocked["reference"]]["ready"], graph[blocked["reference"]]["depth"])
        )

    def test_a_view_link_whose_source_has_no_readable_state_blocks_nothing(self) -> None:
        """Unknown is said as unknown, and an unknown blocker is not an open one."""

        blocked = self.item("Blocked work")
        blocker = self.item("Damaged")
        service.link_work_items(self.conn, blocker["reference"], blocked["reference"], "blocks")
        self.conn.commit()
        self.conn.execute("PRAGMA foreign_keys=OFF")
        self.conn.execute(
            "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
            ("00000000-0000-4000-8000-000000000000", blocker["work_item_id"]),
        )
        self.assertEqual(
            [(blocker["reference"], "blocks", None, None, None, "state_missing")],
            self.source_of(views.planning_payload(self.conn), blocked["work_item_id"]),
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


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
