"""A claim starts the work it takes, and a release puts work under way back in the queue.

Eleven items were worked while they sat in Triage, because a claim moved
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
from server.planning import api, model, service
from tests.planning_fixtures import basis_for


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
        self.space = service.create_planning_space(self.conn, name="Moves")
        self.key = self.space["key"]
        self.workflow_id = str(self.space["workflow"]["workflow_id"])

    def item(self, state: str | None = None, **kwargs: object) -> str:
        kwargs = {**basis_for(state), **kwargs}
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
        for state in ("triage", "ready"):
            with self.subTest(state):
                reference = self.item(state)
                filed = len(self.events(reference))
                answer = self.claim(reference)
                self.assertEqual({"from": state, "to": "dev"}, answer["started"])
                self.assertEqual("dev", answer["state"]["key"])
                self.assertEqual("agent", answer["claim_ref"])
                # Work taken out of triage is accepted by the claim, as assigned.
                accepted = [("accepted", "assignment", "agent")] if state == "triage" else []
                self.assertEqual(
                    [
                        ("claimed", "", "agent"),
                        *accepted,
                        ("transitioned", "dev: claimed", "agent"),
                    ],
                    self.events(reference)[filed:],
                )

    def test_a_claim_leaves_blocked_work_where_it_is(self) -> None:
        reference = self.item("ready")
        self.claim(reference)
        service.transition_work_item(
            self.conn, reference, "blocked", reason="waits", acceptance="assignment"
        )
        self.claim(reference, release=True)
        answer = service.claim_work_item(self.conn, reference, author="next")
        self.assertNotIn("started", answer)
        self.assertNotIn("warnings", answer)
        self.assertEqual(("blocked", "next"), (answer["state"]["key"], answer["claim_ref"]))

    def test_a_claim_of_work_in_review_or_closed_is_refused_and_writes_nothing(self) -> None:
        for state, guard in (
            ("review", "[review]"),
            ("done", "[closed]"),
            ("cancelled", "[closed]"),
        ):
            with self.subTest(state):
                reference = self.item(state)
                before = self.events(reference)
                with self.assertRaises(model.WorkflowGuardError) as refused:
                    self.claim(reference)
                self.assertIn(guard, str(refused.exception))
                self.assertEqual((state, before), (self.state(reference), self.events(reference)))

    def test_a_takeover_keeps_the_work_where_its_holder_had_it(self) -> None:
        held = self.item("ready")
        service.claim_work_item(self.conn, held, author="first")
        taken = service.claim_work_item(self.conn, held, author="second", force=True)
        self.assertNotIn("started", taken)
        self.assertEqual(("dev", "second"), (taken["state"]["key"], taken["claim_ref"]))

    def test_the_take_next_queue_starts_what_it_takes(self) -> None:
        queued = self.item("ready")
        picked = service.claim_ready_work_item(self.conn, space=self.key, author="agent")
        assert picked is not None
        self.assertEqual(queued, picked["reference"])
        self.assertEqual({"from": "ready", "to": "dev"}, picked["started"])

    def test_a_forced_takeover_records_the_override_beside_the_takeover(self) -> None:
        held = self.item()
        service.claim_work_item(self.conn, held, author="first")
        taken = service.claim_work_item(
            self.conn, held, author="second", force=True, move_state=False
        )
        self.assertEqual(["claim"], taken["overridden"])
        self.assertEqual(["taken_over", "overridden"], [a for a, _, _ in self.events(held)][-2:])

    def test_a_forced_release_of_a_claim_held_by_another_records_the_override(self) -> None:
        held = self.item()
        service.claim_work_item(self.conn, held, author="first")
        released = service.claim_work_item(
            self.conn, held, author="second", release=True, force=True, move_state=False
        )
        self.assertEqual(["claim"], released["overridden"])
        # The release puts the work nobody holds now back in the queue.
        self.assertEqual(
            ["released", "overridden", "transitioned"], [a for a, _, _ in self.events(held)][-3:]
        )

    def test_a_forced_claim_of_an_unheld_item_records_no_override(self) -> None:
        free = self.item()
        claimed = service.claim_work_item(self.conn, free, author="first", force=True)
        self.assertNotIn("overridden", claimed)
        self.assertNotIn("overridden", [a for a, _, _ in self.events(free)])

    def test_the_first_active_state_the_workflow_lets_it_reach_is_the_one(self) -> None:
        # `pairing` comes before `dev` in the workflow, so it is the first active state.
        self.add_state("pairing", "active", 2)
        first = self.item()
        self.assertEqual({"from": "triage", "to": "pairing"}, self.claim(first)["started"])
        # Where the workflow forbids that move, the next active state is taken.
        self.forbid("triage", "pairing")
        second = self.item()
        self.assertEqual({"from": "triage", "to": "dev"}, self.claim(second)["started"])

    def test_with_no_active_state_to_reach_the_claim_is_refused_and_says_why(self) -> None:
        self.forbid("triage", "dev")
        reference = self.item()
        before = self.events(reference)
        with self.assertRaisesRegex(
            model.WorkflowGuardError,
            f"{reference} stays in Triage: its workflow has no active state it can move to",
        ):
            self.claim(reference)
        self.assertEqual(("triage", before), (self.state(reference), self.events(reference)))
        self.assertEqual("", service.get_work_item(self.conn, reference)["claim_ref"])

    def test_a_batch_transition_runs_after_the_claim_started_the_item(self) -> None:
        reference = self.item()
        status, answer = api.handle_post(  # type: ignore[misc]
            self.conn,
            "/api/planning/work-item/apply",
            {"id": reference, "author": "agent", "claim": True, "transition": {"state": "review"}},
        )
        self.assertEqual(200, status)
        self.assertEqual({"from": "triage", "to": "dev"}, answer["started"])
        self.assertEqual("review", answer["state"]["key"])
        # Review takes the holder away in the move that puts the task there.
        self.assertEqual(
            ["created", "claimed", "accepted", "transitioned", "transitioned", "released"],
            [e[0] for e in self.events(reference)],
        )


class ReleaseRequeuesWorkTests(ClaimMoveTestCase):
    def test_a_release_puts_work_under_way_back_in_the_queued_state(self) -> None:
        reference = self.item()
        self.claim(reference)
        answer = self.claim(reference, release=True)
        self.assertEqual({"from": "dev", "to": "ready"}, answer["requeued"])
        self.assertEqual(("ready", ""), (answer["state"]["key"], answer["claim_ref"]))
        self.assertTrue(answer["workable"])
        self.assertEqual(
            [("released", "agent", "agent"), ("transitioned", "ready: released", "agent")],
            self.events(reference)[-2:],
        )
        picked = service.claim_ready_work_item(self.conn, space=self.key, author="next")
        assert picked is not None
        self.assertEqual(reference, picked["reference"])

    def test_without_a_queued_state_the_release_is_refused_rather_than_left_unheld(
        self,
    ) -> None:
        # Never to triage, which would take the acceptance away unseen.
        self.forbid("dev", "ready")
        reference = self.item()
        self.claim(reference)
        before = self.events(reference)
        with self.assertRaisesRegex(model.WorkflowGuardError, "reach no ready state"):
            self.claim(reference, release=True)
        self.assertEqual(("dev", before), (self.state(reference), self.events(reference)))
        self.assertEqual("agent", service.get_work_item(self.conn, reference)["claim_ref"])

    def test_a_release_of_blocked_work_moves_nothing(self) -> None:
        other = self.item("ready")
        self.claim(other)
        service.transition_work_item(
            self.conn, other, "blocked", reason="waits", acceptance="assignment"
        )
        answer = self.claim(other, release=True)
        self.assertNotIn("requeued", answer)
        self.assertEqual(("blocked", ""), (answer["state"]["key"], answer["claim_ref"]))

    def test_a_claimed_checklist_step_keeps_the_item_under_way(self) -> None:
        reference = self.item()
        self.claim(reference)
        steps = service.set_checklist(self.conn, reference, ["mine", "theirs"])["checklist"]
        service.claim_checklist_item(self.conn, reference, steps[1]["id"], author="helper")
        answer = self.claim(reference, release=True)
        self.assertNotIn("requeued", answer)
        self.assertEqual("dev", answer["state"]["key"])

    def test_move_state_false_starts_nothing_and_holds_only_work_under_way(self) -> None:
        reference = self.item()
        with self.assertRaisesRegex(model.WorkflowGuardError, "holds only work under way"):
            self.claim(reference, move_state=False)
        self.assertEqual("triage", self.state(reference))
        self.claim(reference)
        held = self.claim(reference, move_state=False)
        self.assertEqual(("dev", "agent"), (held["state"]["key"], held["claim_ref"]))
        self.assertNotIn("started", held)
        # A release still keeps the holder rule: nothing at work stands unheld.
        released = self.claim(reference, release=True, move_state=False)
        self.assertEqual({"from": "dev", "to": "ready"}, released["requeued"])


if __name__ == "__main__":
    unittest.main()
