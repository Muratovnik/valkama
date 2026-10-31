"""A claim starts the work it takes, and a release puts work under way back in the queue.

Eleven items were worked while they sat in Backlog, because a claim moved
nothing and nobody made the transition. These cases hold the claim to starting
unstarted work, to leaving every other state alone, and the release to the
other half: a claimed item is under way, so without it a released or expired
claim would leave work in Dev that neither the take-next queue nor the list of
abandoned claims shows.
"""

from __future__ import annotations

import os
import tempfile
import unittest
import uuid
from unittest import mock

from server import store
from server.planning import api, service


class ClaimMoveTestCase(unittest.TestCase):
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
        self.space = service.create_planning_space(self.conn, project_id="moves", name="Moves")
        self.key = self.space["key"]
        self.workflow_id = str(self.space["workflow"]["workflow_id"])

    def item(self, state: str | None = None, **kwargs: object) -> str:
        return service.create_work_item(
            self.conn, space=self.key, title="Work", state=state, **kwargs
        )["reference"]

    def claim(self, reference: str, **kwargs: object) -> dict:
        return service.claim_work_item(self.conn, reference, author="agent", **kwargs)

    def events(self, reference: str) -> list[tuple[str, str, str]]:
        return [
            (event["action"], event["detail"], event["author"])
            for event in service.get_work_item(self.conn, reference)["events"]
        ]

    def state(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["state"]["key"])

    def state_ids(self) -> dict[str, str]:
        return {
            str(row[0]): str(row[1])
            for row in self.conn.execute(
                "SELECT key, state_id FROM workflow_states WHERE workflow_id = ?",
                (self.workflow_id,),
            )
        }

    def add_state(self, key: str, category: str, position: int) -> None:
        """A further state at `position`, reachable from and to every other one."""

        self.conn.execute(
            "UPDATE workflow_states SET position = position + 100 WHERE workflow_id = ?"
            " AND position >= ?",
            (self.workflow_id, position),
        )
        state_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position,is_terminal)"
            " VALUES(?,?,?,?,?,?,0)",
            (state_id, self.workflow_id, key, key.title(), category, position),
        )
        for other in self.state_ids().values():
            if other != state_id:
                self.conn.executemany(
                    "INSERT INTO workflow_transitions(workflow_id,from_state_id,to_state_id)"
                    " VALUES(?,?,?)",
                    ((self.workflow_id, other, state_id), (self.workflow_id, state_id, other)),
                )

    def forbid(self, source: str, target: str) -> None:
        ids = self.state_ids()
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE from_state_id = ? AND to_state_id = ?",
            (ids[source], ids[target]),
        )


class ClaimStartsWorkTests(ClaimMoveTestCase):
    def test_a_claim_moves_backlog_and_queued_work_into_the_active_state(self) -> None:
        for state in ("backlog", "todo"):
            with self.subTest(state):
                reference = self.item(state)
                answer = self.claim(reference)
                self.assertEqual({"from": state, "to": "dev"}, answer["started"])
                self.assertEqual("dev", answer["state"]["key"])
                self.assertEqual("agent", answer["claim_ref"])
                self.assertEqual(
                    [("claimed", "", "agent"), ("transitioned", "dev: claimed", "agent")],
                    self.events(reference)[1:],
                )

    def test_a_claim_leaves_every_other_state_where_it_is(self) -> None:
        for state in ("dev", "review", "blocked", "done", "cancelled"):
            with self.subTest(state):
                reference = self.item(state)
                answer = self.claim(reference)
                self.assertNotIn("started", answer)
                self.assertNotIn("warnings", answer)
                self.assertEqual(state, answer["state"]["key"])
                self.assertEqual(["created", "claimed"], [e[0] for e in self.events(reference)])

    def test_a_takeover_and_the_take_next_queue_start_what_they_take(self) -> None:
        held = self.item()
        service.claim_work_item(self.conn, held, author="first", move_state=False)
        taken = service.claim_work_item(self.conn, held, author="second", force=True)
        self.assertEqual({"from": "backlog", "to": "dev"}, taken["started"])
        queued = self.item("todo")
        picked = service.claim_ready_work_item(self.conn, space=self.key, author="agent")
        assert picked is not None
        self.assertEqual(queued, picked["reference"])
        self.assertEqual({"from": "todo", "to": "dev"}, picked["started"])

    def test_the_first_active_state_the_workflow_lets_it_reach_is_the_one(self) -> None:
        # `pairing` comes before `dev` in the workflow, so it is the first active state.
        self.add_state("pairing", "active", 2)
        first = self.item()
        self.assertEqual({"from": "backlog", "to": "pairing"}, self.claim(first)["started"])
        # Where the workflow forbids that move, the next active state is taken.
        self.forbid("backlog", "pairing")
        second = self.item()
        self.assertEqual({"from": "backlog", "to": "dev"}, self.claim(second)["started"])

    def test_with_no_active_state_to_reach_the_claim_holds_and_says_why(self) -> None:
        self.forbid("backlog", "dev")
        reference = self.item()
        answer = self.claim(reference)
        self.assertNotIn("started", answer)
        self.assertEqual("agent", answer["claim_ref"])
        self.assertEqual(
            [f"{reference} stays in Backlog: its workflow has no active state it can move to"],
            answer["warnings"],
        )
        self.assertEqual("backlog", self.state(reference))

    def test_a_batch_transition_runs_after_the_claim_started_the_item(self) -> None:
        reference = self.item()
        status, answer = api.handle_post(  # type: ignore[misc]
            self.conn,
            "/api/planning/work-item/apply",
            {"id": reference, "author": "agent", "claim": True, "transition": {"state": "review"}},
        )
        self.assertEqual(200, status)
        self.assertEqual({"from": "backlog", "to": "dev"}, answer["started"])
        self.assertEqual("review", answer["state"]["key"])
        self.assertEqual(
            ["created", "claimed", "transitioned", "transitioned"],
            [e[0] for e in self.events(reference)],
        )


class ReleaseRequeuesWorkTests(ClaimMoveTestCase):
    def test_a_release_puts_work_under_way_back_in_the_queued_state(self) -> None:
        reference = self.item()
        self.claim(reference)
        answer = self.claim(reference, release=True)
        self.assertEqual({"from": "dev", "to": "todo"}, answer["requeued"])
        self.assertEqual(("todo", ""), (answer["state"]["key"], answer["claim_ref"]))
        self.assertTrue(answer["ready"])
        self.assertEqual(
            [("released", "agent", "agent"), ("transitioned", "todo: released", "agent")],
            self.events(reference)[-2:],
        )
        picked = service.claim_ready_work_item(self.conn, space=self.key, author="next")
        assert picked is not None
        self.assertEqual(reference, picked["reference"])

    def test_without_a_queued_state_the_backlog_takes_it(self) -> None:
        self.forbid("dev", "todo")
        reference = self.item()
        self.claim(reference)
        answer = self.claim(reference, release=True)
        self.assertEqual({"from": "dev", "to": "backlog"}, answer["requeued"])

    def test_a_release_with_nowhere_to_go_or_nothing_under_way_moves_nothing(self) -> None:
        reference = self.item()
        self.claim(reference)
        self.forbid("dev", "todo")
        self.forbid("dev", "backlog")
        stays = self.claim(reference, release=True)
        self.assertNotIn("requeued", stays)
        self.assertEqual("dev", stays["state"]["key"])
        for state in ("review", "blocked", "done"):
            with self.subTest(state):
                other = self.item(state)
                self.claim(other)
                answer = self.claim(other, release=True)
                self.assertNotIn("requeued", answer)
                self.assertEqual(state, answer["state"]["key"])

    def test_a_claimed_checklist_step_keeps_the_item_under_way(self) -> None:
        reference = self.item()
        self.claim(reference)
        steps = service.set_checklist(self.conn, reference, ["mine", "theirs"])["checklist"]
        service.claim_checklist_item(self.conn, reference, steps[1]["id"], author="helper")
        answer = self.claim(reference, release=True)
        self.assertNotIn("requeued", answer)
        self.assertEqual("dev", answer["state"]["key"])

    def test_move_state_false_neither_starts_nor_requeues(self) -> None:
        reference = self.item()
        held = self.claim(reference, move_state=False)
        self.assertEqual("backlog", held["state"]["key"])
        service.transition_work_item(self.conn, reference, "dev")
        released = self.claim(reference, release=True, move_state=False)
        self.assertEqual("dev", released["state"]["key"])
        self.assertNotIn("requeued", released)


if __name__ == "__main__":
    unittest.main()
