"""Dividing work: moving an item out of its goal or stage, under another, and converting it.

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

Converting a task into a goal or stage keeps everything the item has, and work under
way on it is never stranded: a goal or stage is held by nobody, so a held task leaves
that work in a new task under it, with the same holders, whose claims read live as
they did. The refusals that lead to converting name the word it passes with.
"""

from __future__ import annotations

from server.planning import leases, service
from tests.test_planning_closing import (
    APPLY,
    AS_A,
    AS_B,
    COORDINATOR,
    CREATE,
    DONE,
    UPDATE,
    Tree,
)

MOVE_OUT = "/api/planning/work-item/move-out"
CONVERT = "/api/planning/work-item/convert"
REASON = "it serves the release, not this goal"
B_SESSION = str(AS_B["sessionId"])


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


#: A question with one field, as an agent asks it of the owner or of a session.
ASKED = {
    "kind": "question",
    "prompt": "Which road do we take?",
    "fields": [{"id": "go", "label": "Go on", "type": "boolean", "required": True, "options": []}],
}


class ConvertingTree(SplitTree):
    def convert(self, meta: object, reference: str, **group: object) -> dict:
        return self.agent("apply_work_item_changes", meta, id=reference, convert=group)

    def steps(self, reference: str) -> dict[str, dict]:
        return {str(step["text"]): step for step in self.record(reference)["checklist"]}

    def under(self, reference: str) -> list[str]:
        return [
            f"MAIN-{row[0]}"
            for row in self.conn.execute(
                "SELECT number FROM work_items WHERE parent_id = ? ORDER BY number",
                (self.identity(reference),),
            )
        ]

    def projects(self, reference: str) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT project_id FROM work_item_projects WHERE work_item_id = ?"
                " ORDER BY project_id",
                (self.identity(reference),),
            )
        ]

    def count(self, table: str, column: str, reference: str) -> int:
        return int(
            self.conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE {column} = ?",
                (self.identity(reference),),
            ).fetchone()[0]
        )

    def live(self, reference: str, holder: str = "") -> str:
        """How the claim on the item reads, or one step's claim by `holder`."""

        row = self.conn.execute(
            "SELECT * FROM work_items WHERE work_item_id = ?", (self.identity(reference),)
        ).fetchone()
        found = leases.of_step(self.conn, row, holder) if holder else leases.lease(self.conn, row)
        assert found is not None
        return found.state

    def held_bug(self) -> str:
        """The task: a bug at work under G, held by A, with everything an item can have."""

        t = self.made("t", "bug", parent=self.goal, steps=["u1", "u2", "u3"])
        self.person(UPDATE, id=t, description="What t is for")
        self.person(APPLY, id=t, checklist_ticks=[{"item_id": self.steps(t)["u1"]["id"]}])
        x, related = self.made("x"), self.made("related")
        self.person(
            APPLY,
            id=t,
            comment={"body": "A note on t"},
            links=[{"other": x, "kind": "blocks"}, {"other": related, "kind": "relates-to"}],
            refs=[{"kind": "commit", "value": "abc1234"}],
        )
        self.agent("apply_work_item_changes", AS_B, id=t, subscribe=True)
        self.agent("claim_work_item", AS_A, id=t)
        self.agent("create_work_item_request", AS_A, id=t, addressees=[B_SESSION], **ASKED)
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source) VALUES(?,?,?)",
            (self.identity(t), "alpha", "named"),
        )
        self.conn.commit()
        return t


class ConvertingTests(ConvertingTree):
    def test_a_held_task_becomes_a_stage_and_leaves_its_work_at_hand_under_it(self) -> None:
        """Everything stays on the stage, and the work under way goes on in a task."""

        t = self.held_bug()
        before = self.record(t)
        holder = str(before["claim_ref"])

        answer = self.convert(AS_A, t, to="stage")

        after = self.record(t)
        [left] = self.under(t)
        self.assertEqual(
            {"from": "bug", "to": "stage", "leftover": left, "projects_dropped": []},
            answer["converted"],
        )
        self.assertEqual(
            {"kind": "stage", "state": None, "container_state": "in_progress", "released": holder},
            answer["applied"]["convert"],
        )
        for field in ("work_item_id", "reference", "number", "title", "description"):
            self.assertEqual(before[field], after[field], field)
        self.assertEqual(
            ("stage", None, "in_progress"),
            (after["kind"], after["state"], after["container_state"]),
        )
        self.assertIn("bug", after["labels"])
        self.assertEqual("inherited", self.basis(t))
        self.assertEqual(
            [("u1", True, ""), ("u2", False, ""), ("u3", False, "")],
            [(s["text"], s["done"], s["claimed_by"]) for s in after["checklist"]],
        )
        self.assertEqual("", after["claim_ref"])
        # A goal or stage keeps no start of its own: it reads the start of the work under it.
        stored = self.conn.execute(
            "SELECT started_at FROM work_items WHERE work_item_id = ?", (self.identity(t),)
        ).fetchone()[0]
        self.assertIsNone(stored)
        self.assertEqual(before["started_at"], after["started_at"])
        self.assertEqual(1, self.count("work_item_comments", "work_item_id", t))
        self.assertEqual(2, self.count("work_item_links", "from_id", t))
        self.assertEqual(1, self.count("work_item_refs", "work_item_id", t))
        self.assertEqual(1, self.count("work_item_requests", "work_item_id", t))
        self.assertEqual(
            [f"bug -> stage; leftover {left}"], [d for d, *_ in self.events(t, "converted")]
        )
        self.assertEqual([holder], [d for d, *_ in self.events(t, "released")])
        self.assertEqual({B_SESSION, COORDINATOR}, set(self.followers(t)))
        self.assertEqual([], self.projects(t))
        # The work goes on under it: the same holder, its claim read live, started as it was.
        child = self.record(left)
        self.assertEqual(self.identity(t), child["parent_id"])
        self.assertEqual(("active", holder), (self.category(left), child["claim_ref"]))
        self.assertEqual(leases.LIVE, self.live(left))
        self.assertEqual(before["started_at"], child["started_at"])
        self.assertEqual(("inherited", ["alpha"]), (self.basis(left), self.projects(left)))
        self.assertEqual(1, len(self.events(left, "claimed")))
        self.holds()

    def test_a_leftover_names_its_title_and_the_steps_that_go_with_their_ids(self) -> None:
        t = self.held_bug()
        steps = self.steps(t)

        self.convert(AS_A, t, to="stage", leftover={"title": "rest", "steps": [steps["u2"]["id"]]})

        [left] = self.under(t)
        self.assertEqual("rest", self.record(left)["title"])
        self.assertEqual(
            [("u2", steps["u2"]["id"])],
            [(s["text"], s["id"]) for s in self.record(left)["checklist"]],
        )
        self.assertEqual(
            [("u1", steps["u1"]["id"], True), ("u3", steps["u3"]["id"], False)],
            [(s["text"], s["id"], s["done"]) for s in self.record(t)["checklist"]],
        )

    def test_an_open_question_to_the_owner_stops_an_agents_conversion(self) -> None:
        """`force` does not carry it either."""

        t = self.held_bug()
        self.agent("create_work_item_request", AS_A, id=t, **ASKED)
        for convert in ({"to": "stage"}, {"to": "stage", "force": True}):
            with self.subTest(convert=convert):
                said = self.refused(AS_A, "apply_work_item_changes", id=t, convert=convert)
                self.assertIn("[question]", said)
                self.assertIn("convert", said)
        self.assertEqual("bug", self.record(t)["kind"])

    def test_another_sessions_task_converts_only_with_force(self) -> None:
        """The work stays with the session that held it."""

        t = self.held_bug()
        holder = str(self.record(t)["claim_ref"])
        said = self.refused(AS_B, "apply_work_item_changes", id=t, convert={"to": "stage"})
        self.assertIn(f"{t} is held by {holder}", said)
        self.assertIn("force", said)

        answer = self.convert(AS_B, t, to="stage", force=True)

        self.assertEqual(["claim"], answer["overridden"])
        self.assertEqual(["claim"], [d for d, *_ in self.events(t, "overridden")])
        [left] = self.under(t)
        self.assertEqual(holder, self.record(left)["claim_ref"])
        self.assertEqual(leases.LIVE, self.live(left))

    def test_an_accepted_stage_with_nothing_under_it_becomes_a_task_in_ready(self) -> None:
        """A child that left does not stop it, and its wait for confirmation ends."""

        stage = self.made("S", "stage", parent=self.goal, steps=["The stage holds"])
        gone = self.made("k", parent=stage)
        self.person(MOVE_OUT, id=gone, reason=REASON)
        self.assertEqual("awaiting_confirmation", self.record(stage)["container_state"])
        basis = self.basis(stage)

        answer = self.person(CONVERT, id=stage, to="task")

        task = self.record(stage)
        self.assertEqual(
            ("task", "ready", basis), (task["kind"], self.category(stage), self.basis(stage))
        )
        self.assertEqual(["The stage holds"], [s["text"] for s in task["checklist"]])
        moved = [d for d, *_ in self.events(stage, "transitioned")]
        self.assertEqual(f"{task['state']['key']}: converted from a stage", moved[-1])
        self.assertEqual(["stage -> task"], [d for d, *_ in self.events(stage, "converted")])
        self.assertEqual(
            {"from": "stage", "to": "task", "leftover": None, "projects_dropped": []},
            answer["converted"],
        )
        self.assertNotIn(self.identity(stage), self.rows())
        self.holds()

        full = self.made("S2", "stage", parent=self.goal)
        self.made("s", parent=full)
        said = self.refused(AS_A, "apply_work_item_changes", id=full, convert={"to": "task"})
        self.assertIn("[convert]", said)
        self.assertIn("under it", said)

    def test_the_word_its_place_does_not_give_is_refused_naming_the_one_it_does(self) -> None:
        t = self.made("t", parent=self.goal)
        for word in ("goal", "task", "epic"):
            with self.subTest(word=word):
                said = self.refused(AS_A, "apply_work_item_changes", id=t, convert={"to": word})
                self.assertIn("[convert]", said)
                self.assertIn("convert {to: stage}", said)
        said = self.refused(AS_A, "apply_work_item_changes", id=self.goal, convert={"to": "stage"})
        self.assertIn("convert {to: task}", said)

    def test_the_refusals_that_lead_to_converting_name_the_word_that_passes(self) -> None:
        """An edit refused for a task's kind or a task's children names `to`, and
        converting with that word passes, after which the edit passes too."""

        t = self.made("t", parent=self.goal)
        r = self.made("r")
        z = self.made("z")
        for parent, word in ((t, "stage"), (r, "goal")):
            with self.subTest(parent=parent):
                said = self.refused(
                    AS_A, "apply_work_item_changes", id=z, update={"parent": parent}
                )
                self.assertIn(f"{parent} is a task and holds no children", said)
                self.assertIn(f"convert {{to: {word}}}", said)
                said = self.refused(
                    AS_A, "apply_work_item_changes", id=parent, update={"kind": "goal"}
                )
                self.assertIn(f"convert {{to: {word}}}", said)

                self.convert(AS_A, parent, to=word)
                self.assertEqual(word, self.record(parent)["kind"])
                self.agent("apply_work_item_changes", AS_A, id=z, update={"parent": parent})
                self.assertEqual(self.identity(parent), self.record(z)["parent_id"])
        # A goal or stage is not edited into a task either: the refusal names `to: task`.
        said = self.refused(AS_A, "apply_work_item_changes", id=r, update={"kind": "task"})
        self.assertIn("convert {to: task}", said)

    def test_a_task_held_only_by_its_steps_leaves_them_held_under_the_stage(self) -> None:
        """Each step claim goes on as it was, and each holder's session follows."""

        t = self.made("t", parent=self.goal, steps=["u1", "u2", "u3"])
        steps = self.steps(t)
        self.agent("claim_work_item_checklist_item", AS_A, id=t, item_id=steps["u1"]["id"])
        self.agent("claim_work_item_checklist_item", AS_B, id=t, item_id=steps["u2"]["id"])
        held = {text: str(self.steps(t)[text]["claimed_by"]) for text in ("u1", "u2")}
        self.assertEqual(("active", ""), (self.category(t), self.record(t)["claim_ref"]))

        self.convert(AS_A, t, to="stage", leftover={"steps": [steps["u3"]["id"]]})

        [left] = self.under(t)
        self.assertEqual(("active", ""), (self.category(left), self.record(left)["claim_ref"]))
        self.assertEqual(
            [("u1", held["u1"]), ("u2", held["u2"]), ("u3", "")],
            [(s["text"], s["claimed_by"]) for s in self.record(left)["checklist"]],
        )
        for text in ("u1", "u2"):
            self.assertEqual(leases.LIVE, self.live(left, held[text]))
        self.assertEqual([], self.record(t)["checklist"])
        self.assertEqual(["u1", "u2"], [d for d, *_ in self.events(t, "checklist_released")])
        self.assertEqual(["u1", "u2"], [d for d, *_ in self.events(left, "checklist_claimed")])
        self.assertEqual({COORDINATOR, B_SESSION}, set(self.followers(t)))
        self.holds()

    def test_a_task_nobody_holds_becomes_a_goal_and_drops_its_projects(self) -> None:
        """No leftover asked, none filed: a goal names no projects, so the event names them."""

        r = self.made("r")
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source) VALUES(?,?,?)",
            (self.identity(r), "alpha", "named"),
        )
        self.conn.commit()

        answer = self.convert(AS_A, r, to="goal")

        self.assertEqual(
            {"from": "task", "to": "goal", "leftover": None, "projects_dropped": ["alpha"]},
            answer["converted"],
        )
        self.assertEqual([], self.under(r))
        self.assertEqual([], self.projects(r))
        self.assertEqual(
            ["task -> goal; projects dropped: alpha"], [d for d, *_ in self.events(r, "converted")]
        )
        self.assertEqual("not_started", self.record(r)["container_state"])

    def test_a_blocked_task_leaves_its_work_blocked_for_the_same_reason(self) -> None:
        t = self.made("t", parent=self.goal)
        self.agent("claim_work_item", AS_A, id=t)
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            transition={"state": "blocked", "reason": "waits for the vendor"},
        )

        self.convert(AS_A, t, to="stage")

        [left] = self.under(t)
        self.assertEqual("blocked", self.category(left))
        self.assertEqual(
            ["blocked: waits for the vendor"], [d for d, *_ in self.events(left, "created")]
        )

    def test_a_task_in_triage_stays_in_triage_and_so_does_what_it_leaves(self) -> None:
        t = self.agents_item(AS_B, "t")
        self.convert(AS_B, t, to="goal", leftover={"title": "the rest"})
        [left] = self.under(t)
        self.assertEqual(("triage", "triage"), (self.category(t), self.category(left)))
        self.assertEqual((None, None), (self.basis(t), self.basis(left)))

    def test_closed_review_and_unknown_steps_are_refused(self) -> None:
        done = self.made("done", parent=self.goal)
        self.close(AS_A, done)
        said = self.refused(AS_A, "apply_work_item_changes", id=done, convert={"to": "stage"})
        self.assertIn("closed", said)
        t = self.made("t", parent=self.goal, steps=["u1"])
        said = self.refused(
            AS_A,
            "apply_work_item_changes",
            id=t,
            convert={"to": "stage", "leftover": {"steps": ["nope"]}},
        )
        self.assertIn("has no step nope", said)
        said = self.refused(
            AS_A,
            "apply_work_item_changes",
            id=t,
            convert={"to": "stage"},
            transition={"state": "cancelled"},
        )
        self.assertIn("convert and transition each change the state", said)
        self.agent("claim_work_item", AS_A, id=t)
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            checklist_ticks=[{"item_id": self.steps(t)["u1"]["id"]}],
            summary=DONE,
            transition={"state": "review", "to_check": "That it holds"},
        )
        said = self.refused(AS_A, "apply_work_item_changes", id=t, convert={"to": "stage"})
        self.assertIn("[convert]", said)
        self.assertIn("review", said)
