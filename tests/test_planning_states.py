"""Naming a workflow state: by key, by id, or by a category only one state has.

The default workflow keys its active state `dev`. An agent that had not read
the workflow asked for `in_progress` and got "this workflow has no state named
in_progress" with nothing to correct itself from; these cases hold the refusal
to listing what the workflow has, and a category word to the one state it names.
"""

from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from unittest import mock

from server import mcp_surface, store
from server.planning import model, service
from tests.planning_fixtures import basis_for


class StateNameTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(self.conn, project_id="states", name="States")
        self.workflow_id = str(self.space["workflow"]["workflow_id"])

    def item(self, **kwargs: object) -> dict:
        kwargs = {**basis_for(kwargs.get("state")), **kwargs}
        return service.create_work_item(
            self.conn, space=self.space["key"], title="Name a state", author="tester", **kwargs
        )

    def add_state(self, key: str, category: str) -> None:
        """A further state, reachable from and to every other one, as the default's are."""

        state_id = str(uuid.uuid4())
        position = self.conn.execute(
            "SELECT MAX(position) + 1 FROM workflow_states WHERE workflow_id = ?",
            (self.workflow_id,),
        ).fetchone()[0]
        self.conn.execute(
            "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position,is_terminal)"
            " VALUES(?,?,?,?,?,?,0)",
            (state_id, self.workflow_id, key, key.title(), category, position),
        )
        for (other,) in self.conn.execute(
            "SELECT state_id FROM workflow_states WHERE workflow_id = ? AND state_id != ?",
            (self.workflow_id, state_id),
        ).fetchall():
            self.conn.executemany(
                "INSERT INTO workflow_transitions(workflow_id,from_state_id,to_state_id)"
                " VALUES(?,?,?)",
                ((self.workflow_id, other, state_id), (self.workflow_id, state_id, other)),
            )

    def test_a_category_that_names_one_state_is_that_state(self) -> None:
        created = self.item(state="ready")
        self.assertEqual("ready", created["state"]["key"])
        service.claim_work_item(self.conn, created["reference"], author="tester")
        moved = service.transition_work_item(
            self.conn, created["reference"], "review", acceptance="assignment"
        )
        self.assertEqual("review", moved["state"]["key"])
        blocked = service.transition_work_item(
            self.conn,
            created["reference"],
            "blocked",
            reason="waiting on a vendor",
            acceptance="assignment",
        )
        self.assertEqual("blocked", blocked["state"]["key"])
        # Review let the holder go; work goes back to the active state held.
        service.claim_work_item(self.conn, created["reference"], author="tester")
        active = service.transition_work_item(self.conn, created["reference"], "active")
        self.assertEqual("dev", active["state"]["key"])

    def test_a_key_is_read_before_a_category(self) -> None:
        # Two review states make `review` an ambiguous category, but it is also
        # a key, and the key is the more specific name.
        self.add_state("qa", "review")
        created = self.item(state="review")
        self.assertEqual("review", created["state"]["key"])

    def test_a_category_two_states_share_is_refused_naming_both(self) -> None:
        self.add_state("pairing", "active")
        created = self.item(state="review")
        with self.assertRaises(model.PlanningError) as refusal:
            service.transition_work_item(
                self.conn, created["reference"], "active", acceptance="assignment"
            )
        message = str(refusal.exception)
        self.assertIn("category active names 2 states in this workflow: dev, pairing", message)
        self.assertIn("name one by its key", message)
        self.assertNotIsInstance(refusal.exception, model.WorkflowGuardError)
        self.assertEqual(
            "review", service.get_work_item(self.conn, created["reference"])["state"]["key"]
        )

    def test_an_unknown_name_is_refused_with_every_key_and_category(self) -> None:
        self.add_state("pairing", "active")
        created = self.item()
        with self.assertRaises(model.PlanningError) as refusal:
            service.transition_work_item(
                self.conn, created["reference"], "in_progress", acceptance="assignment"
            )
        message = str(refusal.exception)
        self.assertTrue(message.startswith("this workflow has no state named in_progress;"))
        for listed in (
            "triage (triage)",
            "deferred (deferred)",
            "ready (ready)",
            "dev (active)",
            "review (review)",
            "done (completed)",
            "blocked (blocked)",
            "cancelled (cancelled)",
            "pairing (active)",
        ):
            self.assertIn(listed, message)
        # Every category but the one two states share names a state alone.
        self.assertIn(
            "exactly one state has it: triage, deferred, ready, review, completed, blocked,"
            " cancelled",
            message,
        )
        self.assertNotIn("has it: active", message)
        # The service state is no state a caller names, so no listing shows it.
        self.assertNotIn("container", message)

    def test_creating_in_an_unknown_state_is_refused_the_same_way(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, r"no state named doing; its states are"):
            self.item(state="doing")

    def test_a_list_filter_names_a_state_as_a_write_does(self) -> None:
        # The key, the state_id and the category one state has name the same items.
        waiting = self.item(state="ready")
        active = self.item(state="ready")
        service.claim_work_item(self.conn, active["reference"], author="tester")
        dev_id = self.conn.execute(
            "SELECT state_id FROM workflow_states WHERE workflow_id = ? AND key = 'dev'",
            (self.workflow_id,),
        ).fetchone()[0]

        def listed(name: str) -> list[str]:
            rows = service.list_work_items(self.conn, space=self.space["key"], state_key=name)
            return [str(row["reference"]) for row in rows]

        by_key = listed("dev")
        self.assertEqual([active["reference"]], by_key)
        self.assertEqual(by_key, listed(str(dev_id)))
        self.assertEqual(by_key, listed("active"))
        self.assertNotIn(waiting["reference"], listed("active"))

        served = mcp_surface.call_tool(
            self.conn, "list_work_items", {"space": self.space["key"], "state": "active"}
        )
        self.assertEqual([active["reference"]], [row["reference"] for row in served["work_items"]])

    def test_a_list_filter_refuses_an_unknown_name_and_a_retired_one(self) -> None:
        self.item(state="ready")
        with self.assertRaisesRegex(model.PlanningError, "no state named doing"):
            service.list_work_items(self.conn, space=self.space["key"], state_key="doing")
        with self.assertRaisesRegex(model.PlanningError, "backlog is now triage"):
            service.list_work_items(self.conn, space=self.space["key"], state_key="backlog")

    def test_a_list_filter_refuses_a_category_two_states_share(self) -> None:
        self.add_state("pairing", "active")
        with self.assertRaisesRegex(model.PlanningError, "category active names 2 states"):
            service.list_work_items(self.conn, space=self.space["key"], state_key="active")


if __name__ == "__main__":
    unittest.main()
