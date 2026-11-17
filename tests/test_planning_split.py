"""Dividing work: moving an item out of its goal or stage, and under another.

The oracle tree of the closing tests: goal G, filed by the owner and so accepted,
the tasks each case names, session A a subagent of the coordinator C, B another
session, and the person writing through `/api/planning/`.

The expectations come from the work model: an item leaves its goal or stage only with
a reason, for the top level and triage, keeping that it started and losing its
claims and its basis, and the goal or stage it left records why; clearing a parent
by an edit is refused, so that reason is never skipped. Moving under another goal or
stage records `moved under` the same way. Accepted work does not move under a goal or
stage not accepted, and work in triage moved under goals and stages all accepted is
accepted with them, as if it were filed there. Every such write marks the goal or
stage it left and the one it joined, so either comes to await confirmation, or
stops, in that write.
"""

from __future__ import annotations

from server.planning import service
from tests.test_planning_closing import AS_A, AS_B, CREATE, UPDATE, Tree

MOVE_OUT = "/api/planning/work-item/move-out"
REASON = "it serves the release, not this goal"


class SplitTree(Tree):
    def record(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def basis(self, reference: str) -> str | None:
        """The basis the item was accepted on, or None while it has none."""

        found = self.record(reference)["acceptance"]
        return None if found is None else str(found["basis"])

    def category(self, reference: str) -> str:
        return str(self.record(reference)["state"]["category"])

    def refused(self, meta: object, tool: str, **arguments: object) -> str:
        """The refusal's message, after checking the call left the store as it was."""

        before = self.snapshot()
        with self.assertRaises(Exception) as caught:
            self.agent(tool, meta, **arguments)
        self.assertEqual(before, self.snapshot())
        return str(caught.exception)

    def snapshot(self) -> tuple:
        return (
            [tuple(row) for row in self.conn.execute("SELECT * FROM work_items ORDER BY number")],
            self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0],
        )

    def left(self, reference: str) -> list[str]:
        return [detail for detail, *_rest in self.events(reference, "child_left")]

    def agents_item(self, meta: object, title: str, kind: str = "task") -> str:
        """An item an agent filed with no basis: it stands in triage."""

        return str(
            self.agent("create_work_item", meta, space="MAIN", title=title, kind=kind)["reference"]
        )


class MovingOutTests(SplitTree):
    def test_an_item_at_work_moves_out_to_triage_and_its_goal_records_why(self) -> None:
        a = self.made("a", parent=self.goal)
        self.agent("claim_work_item", AS_A, id=a)
        held = self.record(a)
        self.assertEqual(("active", "inherited"), (self.category(a), self.basis(a)))

        answer = self.agent(
            "apply_work_item_changes", AS_A, id=a, move_out={"reason": f"  {REASON}  "}
        )

        moved = self.record(a)
        self.assertIsNone(moved["parent_id"])
        self.assertEqual("goal", self.record(self.goal)["kind"])
        self.assertEqual("task", moved["kind"])
        first_triage = self.conn.execute(
            "SELECT key FROM workflow_states WHERE category = 'triage' ORDER BY position LIMIT 1"
        ).fetchone()[0]
        self.assertEqual(first_triage, moved["state"]["key"])
        self.assertEqual(held["started_at"], moved["started_at"])
        self.assertIsNotNone(moved["started_at"])
        self.assertEqual(("", None), (moved["claim_ref"], moved["acceptance"]))
        self.assertEqual([f"{a}: {REASON}"], self.left(self.goal))
        transitions = [detail for detail, *_rest in self.events(a, "transitioned")]
        self.assertEqual(f"{first_triage}: moved out of {self.goal}: {REASON}", transitions[-1])
        self.assertEqual({"from": self.goal, "reason": REASON}, answer["moved_out"])
        self.assertEqual(
            {"state": first_triage, "released": held["claim_ref"]}, answer["applied"]["move_out"]
        )
        self.assertEqual([held["claim_ref"]], [d for d, *_rest in self.events(a, "released")])

    def test_a_move_out_without_a_reason_and_an_edit_clearing_the_parent_are_refused(
        self,
    ) -> None:
        a = self.made("a", parent=self.goal)
        for move in ({}, {"reason": ""}, {"reason": "   "}):
            with self.subTest(move=move):
                said = self.refused(AS_A, "apply_work_item_changes", id=a, move_out=move)
                self.assertIn("reason", said)
                if move:
                    self.assertIn("[move_out]", said)
        said = self.refused(AS_A, "apply_work_item_changes", id=a, update={"parent": ""})
        self.assertIn("[parent]", said)
        self.assertIn("move_out", said)
        # The HTTP edit is refused alike: it is the same write.
        before = self.snapshot()
        with self.assertRaisesRegex(Exception, "move_out"):
            self.person(UPDATE, id=a, parent="")
        self.conn.rollback()
        self.assertEqual(before, self.snapshot())

    def test_nothing_to_move_out_of_and_a_closed_item_are_refused(self) -> None:
        loose = self.made("loose")
        said = self.refused(AS_A, "apply_work_item_changes", id=loose, move_out={"reason": REASON})
        self.assertIn("[move_out]", said)
        self.assertIn("no goal or stage", said)
        done = self.made("done", parent=self.goal)
        self.close(AS_A, done)
        said = self.refused(AS_A, "apply_work_item_changes", id=done, move_out={"reason": REASON})
        self.assertIn("[move_out]", said)
        self.assertIn("closed", said)

    def test_moving_out_and_moving_the_state_are_two_calls(self) -> None:
        a = self.made("a", parent=self.goal)
        said = self.refused(
            AS_A,
            "apply_work_item_changes",
            id=a,
            move_out={"reason": REASON},
            transition={"state": "cancelled"},
        )
        self.assertIn("transition and move_out each change the state", said)

    def test_an_item_another_session_holds_moves_out_only_with_force(self) -> None:
        a = self.made("a", parent=self.goal)
        self.agent("claim_work_item", AS_A, id=a)
        holder = self.record(a)["claim_ref"]
        said = self.refused(AS_B, "apply_work_item_changes", id=a, move_out={"reason": REASON})
        self.assertIn(f"{a} is held by {holder}", said)
        self.assertIn("force", said)

        answer = self.agent(
            "apply_work_item_changes", AS_B, id=a, move_out={"reason": REASON, "force": True}
        )
        self.assertEqual(["claim"], answer["overridden"])
        self.assertIsNone(self.record(a)["parent_id"])
        self.assertEqual(["claim"], [detail for detail, *_rest in self.events(a, "overridden")])

    def test_the_last_open_item_moved_out_brings_its_goal_to_wait(self) -> None:
        """The goal or stage it left is marked: with nothing open under it, it waits."""

        a = self.made("a", parent=self.goal)
        answer = self.person(MOVE_OUT, id=a, reason=REASON)
        self.assertEqual([self.goal], answer["awaiting_confirmation"])
        self.assertEqual({"from": self.goal, "reason": REASON}, answer["moved_out"])
        self.assertEqual("awaiting_confirmation", self.record(self.goal)["container_state"])
        self.holds()
        part = self.confirmation(self.goal)
        self.assertEqual([{"reference": a, "reason": REASON}], part["moved_out"])

    def test_an_accepted_stage_moves_out_with_its_work_as_a_goal_in_triage(self) -> None:
        stage = self.made("S1", "stage", parent=self.goal)
        under = self.made("b", parent=stage)
        self.assertIsNotNone(self.record(stage)["container_state"])

        answer = self.person(MOVE_OUT, id=stage, reason=REASON)

        moved = self.record(stage)
        self.assertEqual(
            ("goal", None, "triage"),
            (moved["kind"], moved["parent_id"], moved["state"]["category"]),
        )
        self.assertIsNone(moved["acceptance"])
        # The work under it stays as it was: the queue holds it back under a goal in triage.
        self.assertEqual(
            ("ready", self.identity(stage)), (self.category(under), self.record(under)["parent_id"])
        )
        self.assertEqual([self.goal], answer["awaiting_confirmation"])
        self.assertEqual([f"{stage}: {REASON}"], self.left(self.goal))
        self.holds()


class MovingUnderAnotherTests(SplitTree):
    def test_accepted_work_stays_out_of_a_goal_in_triage_and_triage_work_is_accepted_in(
        self,
    ) -> None:
        a = self.made("a", parent=self.goal)
        h = self.agents_item(AS_B, "H", "goal")
        t = self.agents_item(AS_B, "t")
        self.assertEqual(("triage", "triage"), (self.category(h), self.category(t)))

        said = self.refused(AS_A, "apply_work_item_changes", id=a, update={"parent": h})
        self.assertIn("[parent] an accepted item does not move under a goal or stage", said)
        self.assertIn("move the item out", said)

        self.agent("apply_work_item_changes", AS_A, id=t, update={"parent": self.goal})
        accepted = self.record(t)
        self.assertEqual(("ready", "inherited"), (self.category(t), self.basis(t)))
        transitions = [detail for detail, *_rest in self.events(t, "transitioned")]
        self.assertEqual(f"{accepted['state']['key']}: moved under {self.goal}", transitions[-1])

        service.create_planning_space(self.conn, name="Alpha", key="ALPHA")
        self.conn.commit()
        elsewhere = str(self.person(CREATE, space="ALPHA", title="Other", kind="goal")["reference"])
        said = self.refused(AS_A, "apply_work_item_changes", id=a, update={"parent": elsewhere})
        self.assertIn("lives in another planning space", said)

    def test_a_goal_in_triage_moved_under_an_accepted_one_is_accepted_with_its_work(
        self,
    ) -> None:
        x = self.agents_item(AS_B, "X", "goal")
        under = str(
            self.agent("create_work_item", AS_B, space="MAIN", title="x1", parent=x)["reference"]
        )
        self.assertEqual("triage", self.category(under))

        self.person(UPDATE, id=x, parent=self.goal)

        stage = self.record(x)
        self.assertEqual(("stage", None), (stage["kind"], stage["state"]))
        self.assertEqual("inherited", self.basis(x))
        self.assertEqual(("ready", "inherited"), (self.category(under), self.basis(under)))

    def test_a_move_under_another_records_where_and_both_goals_are_marked(self) -> None:
        """And the goal joined leaves its wait in the same write."""

        h = self.made("H", "goal")
        done = self.made("h1", parent=h)
        self.close(AS_A, done)
        self.assertEqual("awaiting_confirmation", self.record(h)["container_state"])
        c = self.made("c", parent=self.goal)

        answer = self.person(UPDATE, id=c, parent=h)

        self.assertEqual([f"{c}: moved under {h}"], self.left(self.goal))
        self.assertEqual([self.goal], answer["awaiting_confirmation"])
        self.assertEqual("awaiting_confirmation", self.record(self.goal)["container_state"])
        self.assertEqual("in_progress", self.record(h)["container_state"])
        self.holds()
        part = self.confirmation(self.goal)
        self.assertEqual([{"reference": c, "reason": f"moved under {h}"}], part["moved_out"])
        # Over MCP the part reads the same, by its name.
        read = self.agent("get_work_item", AS_A, id=self.goal, parts=["confirmation"])
        self.assertEqual(part["moved_out"], read["confirmation"]["moved_out"])
