"""The work model's words and the fresh store that holds them.

The vocabulary is stated here rather than read from the code under test: eight
categories a caller names and the service one only the store holds, the kinds in
and out, the acceptance bases and the events of schema 18. A fresh space's
workflow has a state for each category and one service state, and the store
itself refuses a kind in a state it never stands in.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import api as planning_api
from server.planning import model, service
from server.planning import store as planning_store

CATEGORIES = (
    "triage",
    "deferred",
    "ready",
    "active",
    "review",
    "completed",
    "blocked",
    "cancelled",
)
DEFAULT_KEYS = (
    "triage",
    "deferred",
    "ready",
    "dev",
    "review",
    "done",
    "blocked",
    "cancelled",
    "container",
)
RETIRED_CONTAINER = (
    "container is not a category: an accepted goal or stage shows container_state;"
    " accept one with ready"
)


class VocabularyTests(unittest.TestCase):
    def test_eight_categories_are_named_and_the_store_holds_one_more(self) -> None:
        self.assertEqual(CATEGORIES, model.PUBLIC_CATEGORIES)
        self.assertEqual((*CATEGORIES, "container"), model.STORED_CATEGORIES)
        self.assertEqual("container", model.SERVICE_CATEGORY)
        self.assertEqual(("ready", "active", "review", "blocked"), model.TASK_ONLY_CATEGORIES)

    def test_a_caller_names_five_kinds_and_the_store_holds_four(self) -> None:
        self.assertEqual(("task", "bug", "improvement", "goal", "stage"), model.PUBLIC_KINDS)
        self.assertEqual({"task", "bug", "improvement", "container"}, set(model.WORK_ITEM_KINDS))
        for named, stored in (
            ("task", "task"),
            ("bug", "bug"),
            ("improvement", "improvement"),
            ("goal", "container"),
            ("stage", "container"),
        ):
            with self.subTest(named=named):
                self.assertEqual(stored, model.work_item_kind(named))
        for word in ("epic", "container"):
            with self.subTest(word=word), self.assertRaises(model.PlanningError):
                model.work_item_kind(word)

    def test_the_acceptance_bases_and_the_events_of_schema_18(self) -> None:
        self.assertEqual(
            ("owner", "assignment", "inherited", "label_rule", "migrated"), model.ACCEPTANCE_BASES
        )
        self.assertLessEqual({"accepted", "opened", "child_left"}, set(model.EVENT_ACTIONS))
        self.assertEqual(("created", "transitioned", "opened"), model.STATE_ENTRY_ACTIONS)

    def test_container_is_a_retired_word_and_no_category(self) -> None:
        self.assertEqual({"container": RETIRED_CONTAINER}, model.RETIRED_WORDS)
        with self.assertRaises(model.PlanningError) as refusal:
            model.state_category("container")
        self.assertEqual(RETIRED_CONTAINER, str(refusal.exception))
        for retired in ("backlog", "queued"):
            with self.subTest(retired=retired), self.assertRaises(model.PlanningError):
                model.state_category(retired)
        for category in CATEGORIES:
            with self.subTest(category=category):
                self.assertEqual(category, model.state_category(category))


class FreshStoreCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        space = service.create_planning_space(
            self.conn, project_id="model", name="Model", key="MOD"
        )
        self.workflow_id = str(space["workflow"]["workflow_id"])
        self.conn.commit()

    def state_id(self, key: str) -> str:
        return str(
            self.conn.execute(
                "SELECT state_id FROM workflow_states WHERE workflow_id = ? AND key = ?",
                (self.workflow_id, key),
            ).fetchone()[0]
        )


class DefaultWorkflowTests(FreshStoreCase):
    """What the migration's sixth postcondition holds every workflow to, on a fresh one."""

    def test_a_state_for_each_category_and_one_service_state(self) -> None:
        states = planning_store.states_for_workflow(self.conn, self.workflow_id)
        categories = [str(state["category"]) for state in states]
        self.assertNotIn("backlog", categories)
        self.assertNotIn("queued", categories)
        for category in CATEGORIES:
            with self.subTest(category=category):
                self.assertIn(category, categories)
        service_states = [state for state in states if state["category"] == "container"]
        self.assertEqual(1, len(service_states))
        self.assertEqual(
            ("container", "Accepted", 8, 0),
            tuple(
                service_states[0][column] for column in ("key", "name", "position", "is_terminal")
            ),
        )
        self.assertEqual(DEFAULT_KEYS, tuple(str(state["key"]) for state in states))

    def test_every_move_between_the_nine_states_is_there_and_work_starts_in_triage(self) -> None:
        self.assertEqual(
            9 * 8, len(planning_store.transitions_for_workflow(self.conn, self.workflow_id))
        )
        initial = self.conn.execute(
            "SELECT initial_state_id FROM workflows WHERE workflow_id = ?", (self.workflow_id,)
        ).fetchone()[0]
        self.assertEqual(self.state_id("triage"), initial)
        created = service.create_work_item(self.conn, space="MOD", title="New work")
        self.assertEqual("triage", created["state"]["key"])


#: The default workflow's states of accepted work, where an item stands with a basis.
ACCEPTED_KEYS = ("ready", "dev", "review", "blocked", "done", "container")
NO_BASIS = "accepted work stands only with the basis it was accepted on"


class StateFitsKindTests(FreshStoreCase):
    """`work_items_state_fits_kind`: which states a kind stands in, and with what basis.

    The first stage holds each kind to its states; the second holds accepted work to
    a basis. A row placed here in accepted work is given one unless the case is that
    it has none.
    """

    def insert(self, kind: str, key: str, basis: object = "default") -> str:
        if basis == "default":
            basis = "owner" if key in ACCEPTED_KEYS else None
        identity = model.new_id()
        number = self.conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 FROM work_items"
        ).fetchone()[0]
        self.conn.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "kind,priority,title,description,labels,position,acceptance)"
            " SELECT ?, planning_space_id, ?, ?, ?, ?, 'medium', 'Placed', '', '[]', ?, ?"
            " FROM workflows WHERE workflow_id = ?",
            (
                identity,
                number,
                self.workflow_id,
                self.state_id(key),
                kind,
                number,
                basis,
                self.workflow_id,
            ),
        )
        return identity

    def test_a_task_is_refused_the_service_state(self) -> None:
        for kind in ("task", "bug", "improvement"):
            with (
                self.subTest(kind=kind),
                self.assertRaisesRegex(
                    sqlite3.IntegrityError, "only a container stands in the service state"
                ),
            ):
                self.insert(kind, "container")
        task = self.insert("task", "triage")
        with self.assertRaisesRegex(
            sqlite3.IntegrityError, "only a container stands in the service state"
        ):
            self.conn.execute(
                "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
                (self.state_id("container"), task),
            )

    def test_a_container_is_refused_the_states_work_is_held_in(self) -> None:
        for key in ("ready", "dev", "review", "blocked"):
            with (
                self.subTest(key=key),
                self.assertRaisesRegex(
                    sqlite3.IntegrityError,
                    "a container never stands in ready, active, review or blocked",
                ),
            ):
                self.insert("container", key)
        goal = self.insert("container", "triage")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "a container never stands"):
            self.conn.execute(
                "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
                (self.state_id("ready"), goal),
            )
        # Turning a task held in ready into a container is the same placement.
        task = self.insert("task", "ready")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "a container never stands"):
            self.conn.execute(
                "UPDATE work_items SET kind = 'container' WHERE work_item_id = ?", (task,)
            )

    def test_a_container_stands_in_the_service_state_and_where_work_is_not_held(self) -> None:
        for key in ("container", "triage", "deferred", "done", "cancelled"):
            with self.subTest(key=key):
                self.insert("container", key)
        for key in ("triage", "ready", "dev", "review", "blocked", "done"):
            with self.subTest(key=key):
                self.insert("task", key)

    def test_accepted_work_is_refused_without_a_basis(self) -> None:
        for kind, key in (
            *(("task", key) for key in ACCEPTED_KEYS[:-1]),
            ("container", "container"),
        ):
            with (
                self.subTest(kind=kind, key=key),
                self.assertRaisesRegex(sqlite3.IntegrityError, NO_BASIS),
            ):
                self.insert(kind, key, basis=None)
        refused = self.conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0]
        self.assertEqual(0, refused, "a refused insert leaves no row")

    def test_a_basis_and_the_state_needing_it_change_in_one_statement_or_not_at_all(
        self,
    ) -> None:
        task = self.insert("task", "triage")
        with self.assertRaisesRegex(sqlite3.IntegrityError, NO_BASIS):
            self.conn.execute(
                "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
                (self.state_id("ready"), task),
            )
        self.conn.execute(
            "UPDATE work_items SET state_id = ?, acceptance = 'assignment' WHERE work_item_id = ?",
            (self.state_id("ready"), task),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, NO_BASIS):
            self.conn.execute(
                "UPDATE work_items SET acceptance = NULL WHERE work_item_id = ?", (task,)
            )
        self.conn.execute(
            "UPDATE work_items SET state_id = ?, acceptance = NULL WHERE work_item_id = ?",
            (self.state_id("triage"), task),
        )
        self.assertEqual(
            (self.state_id("triage"), None),
            tuple(
                self.conn.execute(
                    "SELECT state_id, acceptance FROM work_items WHERE work_item_id = ?", (task,)
                ).fetchone()
            ),
        )

    def test_work_not_accepted_stands_without_a_basis(self) -> None:
        for kind, key in (
            ("task", "triage"),
            ("task", "deferred"),
            ("task", "cancelled"),
            ("container", "triage"),
            ("container", "cancelled"),
        ):
            with self.subTest(kind=kind, key=key):
                self.insert(kind, key, basis=None)


class ServiceStateOutOfReachTests(FreshStoreCase):
    """What a caller sees of a workflow and names in it: never the service state."""

    def call(self, name: str, **arguments: object) -> object:
        return mcp_surface.call_tool(self.conn, name, arguments)

    def test_the_space_lists_the_eight_category_states_and_no_move_to_the_service_one(self) -> None:
        workflow = self.call("get_planning_space", space="MOD")["workflow"]  # type: ignore[index]
        self.assertEqual(list(CATEGORIES), [state["category"] for state in workflow["states"]])
        listed = {state["state_id"] for state in workflow["states"]}
        self.assertNotIn(self.state_id("container"), listed)
        self.assertEqual(8 * 7, len(workflow["transitions"]))
        for move in workflow["transitions"]:
            with self.subTest(move=move):
                self.assertLessEqual({move["from"], move["to"]}, listed)

    def test_container_is_refused_as_a_state_and_as_a_category_with_the_word_replacing_it(
        self,
    ) -> None:
        created = self.call("create_work_item", space="MOD", title="Some work")
        reference = created["reference"]  # type: ignore[index]
        for name, arguments in (
            ("apply_work_item_changes", {"id": reference, "transition": {"state": "container"}}),
            ("list_work_items", {"space": "MOD", "category": "container"}),
            ("list_work_items", {"space": "MOD", "state": "container"}),
        ):
            with self.subTest(name=name, arguments=arguments):
                with self.assertRaises(
                    (model.PlanningError, planning_api.PlanningHttpError)
                ) as refusal:
                    self.call(name, **arguments)
                self.assertIn(RETIRED_CONTAINER, str(refusal.exception))
        self.assertEqual("triage", service.get_work_item(self.conn, reference)["state"]["key"])

    def test_a_kind_filter_reads_goal_and_stage_by_where_the_container_stands(self) -> None:
        goal = service.create_work_item(self.conn, space="MOD", title="Goal", kind="goal")
        stage = service.create_work_item(
            self.conn, space="MOD", title="Stage", kind="stage", parent=goal["reference"]
        )
        service.create_work_item(self.conn, space="MOD", title="Task", parent=goal["reference"])
        for kind, expected in (("goal", [goal]), ("stage", [stage])):
            with self.subTest(kind=kind):
                self.assertEqual(
                    [item["reference"] for item in expected],
                    [
                        item["reference"]
                        for item in service.list_work_items(self.conn, space="MOD", kind=kind)
                    ],
                )


if __name__ == "__main__":
    unittest.main()
