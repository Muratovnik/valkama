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

from server import store
from server.planning import model, service


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
        created = self.item(state="queued")
        self.assertEqual("todo", created["state"]["key"])
        service.claim_work_item(self.conn, created["reference"], author="tester")
        moved = service.transition_work_item(self.conn, created["reference"], "review")
        self.assertEqual("review", moved["state"]["key"])
        blocked = service.transition_work_item(
            self.conn, created["reference"], "blocked", reason="waiting on a vendor"
        )
        self.assertEqual("blocked", blocked["state"]["key"])
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
            service.transition_work_item(self.conn, created["reference"], "active")
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
            service.transition_work_item(self.conn, created["reference"], "in_progress")
        message = str(refusal.exception)
        self.assertTrue(message.startswith("this workflow has no state named in_progress;"))
        for listed in (
            "backlog (backlog)",
            "todo (queued)",
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
            "exactly one state has it: backlog, queued, review, completed, blocked, cancelled",
            message,
        )
        self.assertNotIn("has it: active", message)

    def test_creating_in_an_unknown_state_is_refused_the_same_way(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, r"no state named doing; its states are"):
            self.item(state="doing")


if __name__ == "__main__":
    unittest.main()
