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

from server.planning import leases, participation, service
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
        settings = participation.load(self.conn)
        found = (
            leases.of_step(self.conn, row, holder, settings=settings)
            if holder
            else leases.lease(self.conn, row, settings=settings)
        )
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
            refs=[{"kind": "url", "value": "https://example.invalid/t"}],
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
            [f"bug -> stage; leftover {left}: 0 steps"],
            [d for d, *_ in self.events(t, "converted")],
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


class ChangedConditionsTests(ConvertingTree):
    """What an edit of the steps took off or reworded stays named on the item."""

    def test_a_step_left_out_and_one_reworded_by_its_id_are_recorded_with_their_text(
        self,
    ) -> None:
        """The reworded step keeps its id and tick, and both texts that went are named."""

        t = self.made("t", parent=self.goal, steps=["X", "Y"])
        self.agent("claim_work_item", AS_A, id=t)
        y = self.steps(t)["Y"]
        self.agent("apply_work_item_changes", AS_A, id=t, checklist_ticks=[{"item_id": y["id"]}])
        ticked = self.steps(t)["Y"]

        self.agent("apply_work_item_changes", AS_A, id=t, checklist=[{"id": y["id"], "text": "Y2"}])

        [step] = self.record(t)["checklist"]
        self.assertEqual(
            (y["id"], "Y2", True, ticked["done_by"]),
            (step["id"], step["text"], step["done"], step["done_by"]),
        )
        self.assertEqual(["X", "Y"], [d for d, *_ in self.events(t, "checklist_removed")])
        self.assertEqual(["1"], [d for d, *_ in self.events(t, "checklist_replaced")][-1:])

    def test_a_step_kept_by_its_text_or_id_unchanged_records_nothing_removed(self) -> None:
        t = self.made("t", parent=self.goal, steps=["X", "Y"])
        x = self.steps(t)["X"]
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            checklist=[{"id": x["id"], "text": "X"}, "Y", "Z"],
        )
        self.assertEqual([], self.events(t, "checklist_removed"))

    def test_the_recorded_text_is_cut_to_what_an_event_holds(self) -> None:
        """A step runs to 1 000 characters and an event's detail to 512: the first 120 go."""

        long = "w" * 1000
        t = self.made("t", parent=self.goal, steps=[long])
        self.agent("apply_work_item_changes", AS_A, id=t, checklist=["short"])
        self.assertEqual([long[:120]], [d for d, *_ in self.events(t, "checklist_removed")])

    def test_the_close_names_the_steps_taken_off_and_reworded(self) -> None:
        """The answer names both texts that went; without them, no field."""

        t = self.made("t", parent=self.goal, steps=["X", "Y"])
        self.agent("claim_work_item", AS_A, id=t)
        y = self.steps(t)["Y"]
        self.agent("apply_work_item_changes", AS_A, id=t, checklist_ticks=[{"item_id": y["id"]}])
        self.agent("apply_work_item_changes", AS_A, id=t, checklist=[{"id": y["id"], "text": "Y2"}])

        answer = self.agent(
            "apply_work_item_changes", AS_A, id=t, summary=DONE, transition={"state": "done"}
        )

        self.assertEqual(
            {"removed": ["X", "Y"], "moved": []},
            answer["applied"]["transition"]["conditions_changed"],
        )
        plain = self.made("plain", parent=self.goal)
        closed = self.close(AS_A, plain)
        self.assertNotIn("conditions_changed", closed["applied"]["transition"])

    def test_entering_review_names_them_and_a_cancel_does_not(self) -> None:
        t = self.made("t", parent=self.goal, steps=["X", "Y"])
        self.agent("claim_work_item", AS_A, id=t)
        self.agent("apply_work_item_changes", AS_A, id=t, checklist=[{"text": "Y", "done": True}])
        answer = self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            summary=DONE,
            transition={"state": "review", "to_check": "That Y holds"},
        )
        self.assertEqual(
            {"removed": ["X"], "moved": []}, answer["applied"]["transition"]["conditions_changed"]
        )
        s = self.made("s", parent=self.goal, steps=["X", "Y"])
        self.agent("apply_work_item_changes", AS_A, id=s, checklist=["Y"])
        cancelled = self.agent(
            "apply_work_item_changes",
            AS_A,
            id=s,
            summary={"done": "Not needed", "next": "Nothing"},
            transition={"state": "cancelled"},
        )
        self.assertNotIn("conditions_changed", cancelled["applied"]["transition"])


class SplittingTests(ConvertingTree):
    """A part split off a task is the same work: it stands beside it, accepted as it is."""

    def split(self, meta: object, source: str, steps: list[str], **fields: object) -> dict:
        return self.agent(
            "create_work_item", meta, split_from=source, steps=steps, title="part", **fields
        )

    def stored_projects(self, reference: str) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT project_id, source FROM work_item_projects WHERE work_item_id = ?",
                (self.identity(reference),),
            )
        ]

    def test_a_part_takes_its_steps_beside_the_task_accepted_with_it(self) -> None:
        t = self.made("t", parent=self.goal, steps=["s1", "s2", "s3"])
        steps = self.steps(t)
        self.person(APPLY, id=t, checklist_ticks=[{"item_id": steps["s1"]["id"]}])
        self.conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source) VALUES(?,?,?)",
            (self.identity(t), "alpha", "commits"),
        )
        self.conn.commit()

        answer = self.split(AS_A, t, [steps["s2"]["id"]])

        p = str(answer["reference"])
        part = self.record(p)
        self.assertEqual(self.identity(self.goal), part["parent_id"])
        ready = self.conn.execute(
            "SELECT key FROM workflow_states WHERE category = 'ready' ORDER BY position LIMIT 1"
        ).fetchone()[0]
        self.assertEqual((ready, "inherited"), (part["state"]["key"], self.basis(p)))
        self.assertEqual(
            [(steps["s2"]["id"], "s2")], [(s["id"], s["text"]) for s in part["checklist"]]
        )
        self.assertEqual(["s1", "s3"], [s["text"] for s in self.record(t)["checklist"]])
        self.assertEqual([f"{p}: 1 steps"], [d for d, *_ in self.events(t, "split_off")])
        self.assertEqual([t], [d for d, *_ in self.events(p, "split_from")])
        self.assertEqual([], self.events(t, "checklist_removed"), "moved, not taken off")
        self.assertEqual([("alpha", "named")], self.stored_projects(p))
        self.assertEqual([("alpha", "commits")], self.stored_projects(t))
        self.assertEqual((t, [steps["s2"]["id"]]), (answer["split_from"], answer["moved_steps"]))
        # One call wrote it all.
        [(_, _, call, _, _)] = self.events(p, "split_from")
        self.assertEqual([call], [c for _, _, c, *_ in self.events(t, "split_off")])
        self.holds()

    def test_steps_go_with_their_ticks_and_marks_and_without_their_claims(self) -> None:
        """Acceptance 2: the ids, ticks and `done_by` move; a claim ends on the task."""

        t = self.made("t", parent=self.goal, steps=["u1", "u2", "u3"])
        steps = self.steps(t)
        self.agent("claim_work_item_checklist_item", AS_B, id=t, item_id=steps["u1"]["id"])
        self.agent("claim_work_item", AS_A, id=t)
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            checklist_ticks=[{"item_id": steps["u2"]["id"]}],
        )
        ticked = self.steps(t)["u2"]

        answer = self.split(AS_A, t, [steps["u2"]["id"], steps["u1"]["id"]], claim=True)

        p = str(answer["reference"])
        moved = {s["text"]: s for s in self.record(p)["checklist"]}
        self.assertEqual(["u1", "u2"], list(moved))
        u2 = moved["u2"]
        self.assertEqual(
            (ticked["id"], True, ticked["done_by"], False),
            (u2["id"], u2["done"], u2["done_by"], u2["by_previous_holder"]),
        )
        self.assertEqual((steps["u1"]["id"], ""), (moved["u1"]["id"], moved["u1"]["claimed_by"]))
        self.assertEqual(["u1"], [d for d, *_ in self.events(t, "checklist_released")])
        self.assertEqual("active", self.category(p), "claim: true takes the part at once")
        self.assertEqual(["u3"], [s["text"] for s in self.record(t)["checklist"]])

    def test_a_task_held_by_a_step_alone_goes_back_to_the_queue_when_that_step_leaves(
        self,
    ) -> None:
        t = self.made("t", parent=self.goal, steps=["u1", "u2"])
        steps = self.steps(t)
        self.agent("claim_work_item_checklist_item", AS_A, id=t, item_id=steps["u1"]["id"])
        self.assertEqual("active", self.category(t))
        self.split(AS_A, t, [steps["u1"]["id"]])
        self.assertEqual("ready", self.category(t))

    def test_a_part_of_triage_work_stays_in_triage_and_review_is_refused(self) -> None:
        t = self.agents_item(AS_B, "t")
        self.agent("apply_work_item_changes", AS_B, id=t, checklist=["u1", "u2"])
        p = str(self.split(AS_B, t, [self.steps(t)["u2"]["id"]])["reference"])
        self.assertEqual(("triage", None), (self.category(p), self.basis(p)))
        self.assertIsNone(self.record(p)["parent_id"])

        r = self.made("r", parent=self.goal, steps=["u1"])
        self.agent("claim_work_item", AS_A, id=r)
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=r,
            checklist_ticks=[{"item_id": self.steps(r)["u1"]["id"]}],
            summary=DONE,
            transition={"state": "review", "to_check": "That it holds"},
        )
        said = self.refused(AS_A, "create_work_item", split_from=r, steps=[], title="part")
        self.assertIn("[split]", said)
        self.assertIn("review", said)

    def test_another_sessions_task_splits_only_with_force(self) -> None:
        t = self.made("t", parent=self.goal, steps=["u1", "u2"])
        self.agent("claim_work_item", AS_A, id=t)
        holder = str(self.record(t)["claim_ref"])
        u2 = self.steps(t)["u2"]["id"]
        said = self.refused(AS_B, "create_work_item", split_from=t, steps=[u2], title="part")
        self.assertIn(f"{t} is held by {holder}", said)
        self.assertIn("force", said)

        answer = self.split(AS_B, t, [u2], force=True)

        self.assertEqual(["claim"], answer["overridden"])
        self.assertEqual(["claim"], [d for d, *_ in self.events(t, "overridden")])
        self.assertEqual(holder, self.record(t)["claim_ref"], "the task stays with its holder")

    def test_a_part_of_put_off_work_is_put_off_on_the_same_condition(self) -> None:
        t = self.made("t", parent=self.goal, steps=["u1"])
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            defer={"until": "2099-01-01", "reason": "after the freeze"},
        )
        p = str(self.split(AS_A, t, [])["reference"])
        self.assertEqual(("deferred", None), (self.category(p), self.basis(p)))
        names = ("until", "until_item", "until_comments", "reason", "since")
        self.assertEqual(
            {name: self.record(t)["deferred"][name] for name in names},
            {name: self.record(p)["deferred"][name] for name in names},
        )

    def test_a_part_of_work_put_off_until_comments_counts_its_own_from_none(self) -> None:
        t = self.made("t", parent=self.goal, steps=["u1"])
        self.agent("apply_work_item_changes", AS_A, id=t, comment={"body": "before"})
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            defer={"until": "2 comments", "reason": "after word"},
        )
        p = str(self.split(AS_A, t, [])["reference"])

        def counted(reference: str) -> tuple:
            return tuple(
                self.conn.execute(
                    "SELECT until_comments, comments_after, reached_at"
                    " FROM work_item_deferrals WHERE work_item_id = ?",
                    (self.identity(reference),),
                ).fetchone()
            )

        # The task's baseline is its own newest comment; the part has none, so it counts
        # from none.
        self.assertEqual(2, counted(t)[0])
        self.assertGreater(counted(t)[1], 0)
        self.assertEqual((2, 0, None), counted(p))
        self.agent("apply_work_item_changes", AS_A, id=p, comment={"body": "one"})
        self.assertEqual((2, 0, None), counted(p))
        self.agent("apply_work_item_changes", AS_A, id=p, comment={"body": "two"})
        came = self.record(p)["deferred"]
        self.assertTrue(came is None or came["reached_at"] is not None, came)
        self.assertIsNone(counted(t)[2], "the task's own count is its own")

    def test_a_part_of_an_accepted_task_outside_an_accepted_chain_takes_its_basis(
        self,
    ) -> None:
        t = self.agents_item(AS_A, "t")
        self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            transition={"state": "ready", "acceptance": "assignment"},
        )
        p = str(self.split(AS_A, t, [])["reference"])
        self.assertEqual(("ready", "assignment"), (self.category(p), self.basis(p)))

    def test_what_the_task_sets_and_what_it_lacks_are_refused(self) -> None:
        t = self.made("t", parent=self.goal, steps=["u1"])
        u1 = self.steps(t)["u1"]["id"]
        sent = (("parent", self.goal), ("state", "ready"), ("acceptance", "assignment"))
        for field, value in sent:
            with self.subTest(field=field):
                said = self.refused(
                    AS_A, "create_work_item", split_from=t, steps=[u1], title="p", **{field: value}
                )
                self.assertIn("[split]", said)
                self.assertIn(field, said)
        said = self.refused(AS_A, "create_work_item", split_from=t, steps=["nope"], title="p")
        self.assertIn(f"{t} has no step nope", said)
        said = self.refused(AS_A, "create_work_item", space="MAIN", steps=[u1], title="p")
        self.assertIn("split_from", said)
        said = self.refused(AS_A, "create_work_item", split_from=self.goal, steps=[], title="p")
        self.assertIn("goal or stage", said)
        done = self.made("done", parent=self.goal)
        self.close(AS_A, done)
        said = self.refused(AS_A, "create_work_item", split_from=done, steps=[], title="p")
        self.assertIn("closed", said)

    def test_the_task_names_where_its_steps_went_when_it_closes(self) -> None:
        """The task a part left names it on completing and in its full record."""

        t = self.made("t", parent=self.goal, steps=["u1", "u2", "u3"])
        steps = self.steps(t)
        p = str(self.split(AS_A, t, [steps["u2"]["id"], steps["u3"]["id"]])["reference"])
        self.agent("claim_work_item", AS_A, id=t)
        answer = self.agent(
            "apply_work_item_changes",
            AS_A,
            id=t,
            checklist_ticks=[{"item_id": steps["u1"]["id"]}],
            summary=DONE,
            transition={"state": "done"},
        )
        changed = {"removed": [], "moved": [{"to": p, "count": 2}]}
        self.assertEqual(changed, answer["applied"]["transition"]["conditions_changed"])
        self.assertEqual(changed, self.record(t)["conditions_changed"])

    def test_a_conversion_that_left_work_names_the_task_it_left(self) -> None:
        """How many steps went is what the conversion moved, whatever that task holds later."""

        t = self.made("t", parent=self.goal, steps=["u1", "u2"])
        self.agent("claim_work_item", AS_A, id=t)
        self.convert(AS_A, t, to="stage", leftover={"steps": [self.steps(t)["u2"]["id"]]})
        [left] = self.under(t)
        moved = {"removed": [], "moved": [{"to": left, "count": 1}]}
        self.assertEqual(moved, self.record(t)["conditions_changed"])
        self.person(APPLY, id=left, checklist=["u2", "v1", "v2"])
        self.assertEqual(3, len(self.steps(left)))
        self.assertEqual(moved, self.record(t)["conditions_changed"], "as it was converted")
        self.assertEqual(
            [f"task -> stage; leftover {left}: 1 steps"],
            [detail for detail, *_ in self.events(t, "converted")],
        )
