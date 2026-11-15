"""The work model's write rules, one behaviour at a time, through each way in.

Each test is one case of the write rules, named by what it shows, with its
expectation worked by hand. G is a goal, S and S2 stages, a, b and c tasks
and X an item outside the tree; a tree is placed in SQL (`tests.planning_tree`)
and the write under test goes through a surface: the MCP tools as an agent calls
them, and the Planning HTTP routes as the owner's interface writes them, bound as
the interface binds them. Every test runs through both. A refusal is read whole
and the store is compared before and after it: a refused write writes nothing.

The two ways in differ in who writes. An agent's write is accepted by an accepted
goal above it, by the assignment it names, or by the claim it takes; the owner's
own write is the owner's acceptance. So a case an agent is refused in reads, through
HTTP, as the owner accepting the work, and the test says which way in it ran.
"""

from __future__ import annotations

import json
import os
import random
import sqlite3
import sys
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock

from server import mcp_surface, runner, store
from server.executions import lifecycle
from server.planning import api, calls, model, service
from tests.planning_tree import Tree, oracle

#: The tables a write changes: a refusal leaves each as it was.
WRITTEN = ("planning_spaces", "work_items", "work_item_events", "work_item_links")
AGENT = "agent-one"

#: Each write by the MCP tool and the HTTP route that make it.
MCP_TOOLS = {
    "claim": "claim_work_item",
    "claim_step": "claim_work_item_checklist_item",
    "apply": "apply_work_item_changes",
    "create": "create_work_item",
    "merge": "merge_work_items",
    "claim_ready": "claim_ready_work_item",
}
HTTP_PATHS = {
    "claim": "/api/planning/work-item/claim",
    "claim_step": "/api/planning/work-item/checklist/claim",
    "apply": "/api/planning/work-item/apply",
    "create": "/api/planning/work-items",
    "merge": "/api/planning/work-item/merge",
    "claim_ready": "/api/planning/work-item/claim-ready",
    "transition": "/api/planning/work-item/transition",
    "update": "/api/planning/work-item/update",
    "tick": "/api/planning/work-item/checklist/tick",
}


class WriteCase(unittest.TestCase):
    """A fresh store with a space, and the writes of one way in."""

    via = "mcp"

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.root / "valkama.sqlite3"),
                "VALKAMA_CLAUDE_BIN": sys.executable,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.tree = Tree(self.conn)
        self.conn.commit()

    @property
    def agent(self) -> bool:
        return self.via == "mcp"

    # -- the ways in ------------------------------------------------------------

    def call(self, op: str, arguments: dict) -> object:
        """One write through this way in: an agent's tool call, or the owner's route."""

        if self.via == "mcp":
            if op in ("transition", "update", "tick"):
                arguments = self._batched(op, arguments)
                op = "apply"
            answer = mcp_surface.call_tool(self.conn, MCP_TOOLS[op], {"author": AGENT, **arguments})
        else:
            path = HTTP_PATHS[op]
            with calls.bind(calls.browser(), path):
                found = api.handle_post(self.conn, path, arguments)
            assert found is not None
            answer = found[1]
        self.conn.commit()
        return answer

    @staticmethod
    def _batched(op: str, arguments: dict) -> dict:
        reference = arguments.pop("id")
        if op == "transition":
            return {"id": reference, "transition": arguments}
        if op == "update":
            return {"id": reference, "update": arguments}
        return {"id": reference, "checklist_ticks": [arguments]}

    def ref(self, name: str) -> str:
        return self.tree.refs[name]

    def claim(self, name: str, **extra: object) -> object:
        return self.call("claim", {"id": self.ref(name), **extra})

    def claim_step(self, name: str, **extra: object) -> object:
        return self.call("claim_step", {"id": self.ref(name), "item_id": self.step(name), **extra})

    def tick(self, name: str) -> object:
        return self.call("tick", {"id": self.ref(name), "item_id": self.step(name)})

    def transition(self, name: str, state: str, **extra: object) -> object:
        return self.call("transition", {"id": self.ref(name), "state": state, **extra})

    def update(self, name: str, **fields: object) -> object:
        return self.call("update", {"id": self.ref(name), **fields})

    def create(self, **fields: object) -> object:
        return self.call("create", {"space": self.tree.key, **fields})

    # -- what the store holds -----------------------------------------------------

    def snapshot(self) -> list[list[tuple[object, ...]]]:
        return [
            [tuple(row) for row in self.conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
            for table in WRITTEN
        ]

    def refused(self, write: Callable[[], object], *said: str) -> str:
        """Make `write` and expect its refusal, naming each of `said`, with nothing written."""

        self.conn.commit()
        before = self.snapshot()
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            write()
        message = str(caught.exception)
        for words in said:
            self.assertIn(words, message)
        self.assertEqual(before, self.snapshot(), f"the refusal wrote: {message}")
        self.conn.rollback()
        return message

    def record(self, name: str) -> dict:
        return service.get_work_item(self.conn, self.ref(name))

    def category(self, name: str) -> str | None:
        state = self.record(name)["state"]
        return None if state is None else str(state["category"])

    def stored(self, name: str, column: str) -> object:
        return self.conn.execute(
            f"SELECT {column} FROM work_items WHERE work_item_id = ?",
            (self.tree.ids[name],),
        ).fetchone()[0]

    def basis(self, name: str) -> object:
        return self.stored(name, "acceptance")

    def mark(self) -> int:
        return int(
            self.conn.execute("SELECT COALESCE(MAX(id), 0) FROM work_item_events").fetchone()[0]
        )

    def actions(self, name: str, after: int = 0) -> list[tuple[str, str]]:
        return [
            (str(row[0]), str(row[1]))
            for row in self.conn.execute(
                "SELECT action, detail FROM work_item_events WHERE work_item_id = ? AND id > ?"
                " ORDER BY id",
                (self.tree.ids[name], after),
            )
        ]

    def holders(self, name: str) -> tuple[str, list[str]]:
        steps = model.checklist(self.stored(name, "checklist"))
        return str(self.stored(name, "claim_ref")), [step["claimed_by"] for step in steps]

    def step(self, name: str) -> str:
        return str(model.checklist(self.stored(name, "checklist"))[0]["id"])

    def give_step(self, name: str) -> None:
        service.set_checklist(self.conn, self.ref(name), [{"text": f"The step of {name}"}])
        self.conn.commit()

    # -- trees ------------------------------------------------------------------

    def accepted_goal(self, stage: bool = True) -> None:
        self.tree.add("G", kind="goal", state="container")
        if stage:
            self.tree.add("S", kind="stage", state="container", parent="G")

    def entry_basis(self) -> str:
        """The basis the write's own way in gives: an agent's assignment, or the owner's."""

        return model.NAMED_BASIS if self.agent else "owner"


class ThroughMcpTests(WriteCase):
    """Every case through the MCP tools; `ThroughHttpTests` runs them through HTTP."""

    # -- claims -------------------------------------------------------------------

    def test_a_goal_or_a_stage_is_refused_a_claim_by_every_way_in(self) -> None:
        self.accepted_goal()
        self.tree.add("T", kind="goal")  # not accepted: refused all the same
        self.conn.commit()
        for name in ("G", "S", "T"):
            with self.subTest(item=name, by="claim"):
                self.refused(lambda name=name: self.claim(name), model.CONTAINER_UNHELD)
            with self.subTest(item=name, by="a batch"):
                self.refused(
                    lambda name=name: self.call("apply", {"id": self.ref(name), "claim": True}),
                    model.CONTAINER_UNHELD,
                )

    def test_a_step_of_a_goal_is_refused_a_claim(self) -> None:
        self.accepted_goal(stage=False)
        self.give_step("G")
        self.refused(lambda: self.claim_step("G"), model.CONTAINER_UNHELD)

    def test_the_queue_hands_out_a_task_and_leaves_the_goals_before_it(self) -> None:
        self.tree.add("T", kind="goal")
        self.accepted_goal()
        # In triage like T, so that only the kind keeps the goal before it out of the queue.
        self.tree.add("a")
        self.conn.execute(
            "UPDATE work_items SET position = -1 WHERE kind = ?", (model.CONTAINER_KIND,)
        )
        self.conn.commit()
        untouched = {name: self.stored(name, "revision") for name in ("G", "S", "T")}
        self.call("claim_ready", {"space": self.tree.key})
        self.assertEqual("active", self.category("a"))
        self.assertTrue(self.holders("a")[0])
        for name, revision in untouched.items():
            with self.subTest(item=name):
                self.assertEqual(revision, self.stored(name, "revision"))
                self.assertEqual(("", []), self.holders(name))

    def test_a_goal_created_with_a_claim_is_refused_and_nothing_is_created(self) -> None:
        self.refused(lambda: self.create(title="Goal", kind="goal", claim=True), "[container]")

    def test_a_task_in_review_or_done_is_refused_a_claim(self) -> None:
        self.tree.add("a", state="review", started=True)
        self.tree.add("b", state="done", started=True)
        self.give_step("a")
        self.give_step("b")
        self.refused(lambda: self.claim("a"), "[review]", "the owner's answer decides")
        self.refused(lambda: self.claim_step("a"), "[review]")
        self.refused(lambda: self.claim("b"), "[closed]", "reopen it first")
        self.refused(lambda: self.claim_step("b"), "[closed]")

    def test_a_task_claimed_from_triage_outside_an_accepted_goal_is_assigned(self) -> None:
        self.tree.add("G", kind="goal")
        self.tree.add("S", kind="stage", parent="G")
        self.tree.add("a", parent="S")
        self.conn.commit()
        self.claim("a")
        self.assertEqual("dev", self.record("a")["state"]["key"])
        self.assertEqual(self.entry_basis(), self.basis("a"))
        self.assertIsNotNone(self.stored("a", "started_at"))
        self.assertIsNotNone(self.stored("a", "accepted_at"))

    def test_a_task_moved_to_review_is_released_by_the_move(self) -> None:
        self.tree.add("a", state="ready")
        self.give_step("a")
        self.claim("a")
        self.claim_step("a")
        holder, steps = self.holders("a")
        mark = self.mark()
        self.transition("a", "review")
        self.assertEqual(("review", ("", [""])), (self.category("a"), self.holders("a")))
        self.assertEqual(
            [
                ("transitioned", "review"),
                ("released", holder),
                ("checklist_released", "The step of a"),
            ],
            self.actions("a", mark),
        )
        self.assertEqual([holder], steps)

    def test_releasing_the_item_while_a_step_is_held_keeps_it_at_work(self) -> None:
        self.tree.add("a", state="ready")
        self.give_step("a")
        self.claim("a")
        self.claim_step("a")
        self.claim("a", release=True)
        self.assertEqual("active", self.category("a"))
        holder, steps = self.holders("a")
        self.assertEqual("", holder)
        self.assertNotEqual([""], steps)

    def test_a_task_out_of_any_goal_is_accepted_only_by_whoever_writes(
        self,
    ) -> None:
        self.tree.add("a")
        self.conn.commit()
        if self.agent:
            for force in (False, True):
                with self.subTest(force=force):
                    self.refused(
                        lambda force=force: self.transition("a", "ready", force=force),
                        "[acceptance]",
                    )
            self.assertEqual(("triage", None), (self.category("a"), self.basis("a")))
        else:
            self.transition("a", "ready")
            self.assertEqual(("ready", "owner"), (self.category("a"), self.basis("a")))

    def test_a_task_under_an_accepted_goal_inherits_its_acceptance(self) -> None:
        self.accepted_goal(stage=False)
        self.tree.add("a", parent="G")
        self.conn.commit()
        mark = self.mark()
        self.transition("a", "ready")
        self.assertEqual(("ready", "inherited"), (self.category("a"), self.basis("a")))
        self.assertEqual(
            [("accepted", "inherited"), ("transitioned", "ready")], self.actions("a", mark)
        )

    def test_accepting_a_goal_accepts_the_work_waiting_under_it(self) -> None:
        self.tree.add("G", kind="goal")
        self.tree.add("S", kind="stage", parent="G")
        self.tree.add("a", parent="S")
        self.tree.add("b", state="deferred", parent="S")
        self.conn.commit()
        mark = self.mark()
        self.transition("G", "ready", acceptance=model.NAMED_BASIS)
        goal = self.record("G")
        self.assertEqual((None, "not_started"), (goal["state"], goal["container_state"]))
        self.assertEqual(self.entry_basis(), self.basis("G"))
        stage = self.record("S")
        self.assertEqual((None, "not_started"), (stage["state"], stage["container_state"]))
        self.assertEqual(("ready", "inherited"), (self.category("a"), self.basis("a")))
        self.assertEqual("inherited", self.basis("S"))
        self.assertEqual(("deferred", None), (self.category("b"), self.basis("b")))
        self.assertEqual(
            [("accepted", self.entry_basis()), ("opened", "")], self.actions("G", mark)
        )
        self.assertEqual([("accepted", "inherited"), ("opened", "")], self.actions("S", mark))
        self.assertEqual(
            [("accepted", "inherited"), ("transitioned", f"ready: accepted with {self.ref('G')}")],
            self.actions("a", mark),
        )
        self.assertEqual([], self.actions("b", mark))

    def test_a_goal_is_refused_work_review_and_blocked_even_with_force(self) -> None:
        self.accepted_goal(stage=False)
        self.conn.commit()
        for state in ("dev", "review", "blocked"):
            with self.subTest(state=state):
                self.refused(
                    lambda state=state: self.transition("G", state, force=True, reason="r"),
                    "[container]",
                )

    def test_a_move_to_deferred_is_refused_even_with_force(self) -> None:
        self.tree.add("a", state="ready")
        self.tree.add("T", kind="goal")
        self.conn.commit()
        for name in ("a", "T"):
            for force in (False, True):
                with self.subTest(item=name, force=force):
                    self.refused(
                        lambda name=name, force=force: self.transition(
                            name, "deferred", force=force
                        ),
                        "[deferred]",
                    )

    # -- parents --------------------------------------------------------------------

    def test_a_task_is_no_parent(self) -> None:
        self.accepted_goal()
        self.tree.add("a", state="ready", parent="S")
        self.conn.commit()
        self.refused(
            lambda: self.update("S", parent=self.ref("a")),
            "a task holds no children; convert it to a stage first",
        )
        self.refused(
            lambda: self.create(title="Under a task", parent=self.ref("a")),
            "a task holds no children",
        )

    def test_a_parent_that_would_close_a_cycle_is_refused(self) -> None:
        self.accepted_goal()
        self.tree.add("S2", kind="stage", state="container", parent="S")
        self.conn.commit()
        for name, parent in (("G", "S"), ("S", "S2"), ("G", "S2"), ("S", "S")):
            with self.subTest(item=name, parent=parent):
                self.refused(
                    lambda name=name, parent=parent: self.update(name, parent=self.ref(parent)),
                    "would close a cycle",
                )

    def test_a_parent_in_another_space_is_refused(self) -> None:
        other = Tree(self.conn, "OX")
        other.add("H", kind="goal", state="container")
        self.tree.add("a")
        self.conn.commit()
        self.refused(
            lambda: self.update("a", parent=other.refs["H"]), "lives in another planning space"
        )

    def test_a_task_moved_out_of_a_stage_is_recorded_as_having_left_it(self) -> None:
        self.accepted_goal()
        self.tree.add("a", state="ready", parent="S")
        self.conn.commit()
        self.assertEqual("not_started", self.record("S")["container_state"])
        mark = self.mark()
        self.update("a", parent=self.ref("G"))
        self.assertEqual(self.tree.ids["G"], self.record("a")["parent_id"])
        self.assertEqual([("child_left", self.ref("a"))], self.actions("S", mark))
        self.assertEqual("awaiting_confirmation", self.record("S")["container_state"])

    def test_a_stage_takes_a_stage_and_a_task_at_any_depth(self) -> None:
        self.accepted_goal()
        self.tree.add("S2", kind="stage", state="container", parent="S")
        self.conn.commit()
        self.create(title="Deep", kind="stage", parent=self.ref("S2"))
        found = self.conn.execute(
            "SELECT kind FROM work_items WHERE title = 'Deep' AND parent_id = ?",
            (self.tree.ids["S2"],),
        ).fetchone()
        self.assertEqual(model.CONTAINER_KIND, found[0])

    # -- kinds and merges -------------------------------------------------------------

    def test_a_stage_without_a_parent_is_refused(self) -> None:
        self.refused(
            lambda: self.create(title="Loose", kind="stage"),
            "a stage is a container under a parent; without one it is a goal",
        )

    def test_a_task_does_not_become_a_goal_by_an_edit(self) -> None:
        self.tree.add("a")
        self.accepted_goal()
        self.conn.commit()
        for name, kind in (("a", "goal"), ("a", "stage"), ("G", "task"), ("G", "stage")):
            with self.subTest(item=name, kind=kind):
                self.refused(
                    lambda name=name, kind=kind: self.update(name, kind=kind), "conversion"
                )
        self.update("a", kind="bug")
        self.assertEqual("bug", self.record("a")["kind"])

    def test_a_goal_and_a_task_do_not_merge(self) -> None:
        self.accepted_goal(stage=False)
        self.tree.add("H", kind="goal")
        self.tree.add("a")
        self.tree.add("b")
        self.conn.commit()
        for survivor, merged in (("G", "a"), ("a", "H")):
            with self.subTest(survivor=survivor, merged=merged):
                self.refused(
                    lambda survivor=survivor, merged=merged: self.call(
                        "merge", {"id": self.ref(survivor), "items": [self.ref(merged)]}
                    ),
                    "not of one sort",
                )
        self.call("merge", {"id": self.ref("a"), "items": [self.ref("b")]})
        self.assertEqual("cancelled", self.category("b"))

    # -- steps and the holder -----------------------------------------------------------

    def test_claiming_a_step_starts_its_task(self) -> None:
        self.tree.add("G", kind="goal")
        self.tree.add("S", kind="stage", parent="G")
        self.tree.add("a", state="ready", parent="S")
        self.tree.add("b", parent="S")
        for name in ("a", "b"):
            self.give_step(name)
        mark = self.mark()
        self.claim_step("a")
        self.assertEqual(
            ("dev", model.NAMED_BASIS), (self.record("a")["state"]["key"], self.basis("a"))
        )
        self.assertIsNotNone(self.stored("a", "started_at"))
        self.assertEqual(
            ["checklist_claimed", "transitioned"], [action for action, _ in self.actions("a", mark)]
        )
        self.claim_step("b")
        self.assertEqual(
            ("dev", self.entry_basis()), (self.record("b")["state"]["key"], self.basis("b"))
        )
        self.assertIsNotNone(self.stored("b", "started_at"))

    def test_a_task_whose_last_held_step_ends_goes_back_to_ready_started(self) -> None:
        for way in ("release", "tick"):
            with self.subTest(way=way):
                name = f"a{way}"
                self.tree.add(name, state="ready")
                self.give_step(name)
                self.claim_step(name)
                self.assertEqual("active", self.category(name))
                started = self.stored(name, "started_at")
                mark = self.mark()
                if way == "release":
                    self.claim_step(name, release=True)
                else:
                    self.tick(name)
                self.assertEqual(("ready", ("", [""])), (self.category(name), self.holders(name)))
                self.assertEqual(started, self.stored(name, "started_at"))
                self.assertIn(
                    (
                        "transitioned",
                        f"ready: {'released' if way == 'release' else 'step completed'}",
                    ),
                    self.actions(name, mark),
                )
                self.assertTrue(self.record(name)["workable"])

    def test_a_move_to_work_without_a_holder_is_refused_even_with_force(self) -> None:
        self.tree.add("a", state="ready")
        self.conn.commit()
        self.refused(lambda: self.transition("a", "dev", force=True), "[executor]")

    def test_a_blocked_task_released_stays_blocked_with_nobody_holding_it(self) -> None:
        self.tree.add("a", state="ready")
        self.claim("a")
        self.transition("a", "blocked", reason="waits on the vendor")
        self.assertTrue(self.holders("a")[0], "blocking from work keeps the holder")
        self.claim("a", release=True)
        self.assertEqual(("blocked", ("", [])), (self.category("a"), self.holders("a")))

    def test_a_blocked_task_goes_back_to_work_only_with_its_holder(self) -> None:
        self.tree.add("a", state="ready")
        self.tree.add("b", state="blocked")
        self.claim("a")
        self.transition("a", "blocked", reason="waits on the vendor")
        self.transition("a", "dev")
        self.assertEqual("active", self.category("a"))
        self.refused(lambda: self.transition("b", "dev"), "[executor]")

    # -- containers ---------------------------------------------------------------------

    def test_an_accepted_goal_is_refused_triage_even_with_force(self) -> None:
        self.accepted_goal(stage=False)
        self.conn.commit()
        for force in (False, True):
            with self.subTest(force=force):
                self.refused(
                    lambda force=force: self.transition("G", "triage", force=force),
                    "[container_state]",
                )

    def test_a_goal_never_accepted_is_cancelled_not_completed(self) -> None:
        self.tree.add("G", kind="goal")
        self.tree.add("H", kind="goal", state="deferred")
        self.conn.commit()
        for name in ("G", "H"):
            with self.subTest(item=name):
                self.refused(
                    lambda name=name: self.transition(name, "done", force=True), "[container_state]"
                )

    def test_review_without_acceptance_is_refused_to_an_agent_even_with_force(
        self,
    ) -> None:
        self.tree.add("a")
        self.conn.commit()
        if self.agent:
            for force in (False, True):
                with self.subTest(force=force):
                    self.refused(
                        lambda force=force: self.transition("a", "review", force=force),
                        "[acceptance]",
                    )
        else:
            self.transition("a", "review")
            self.assertEqual(("review", "owner"), (self.category("a"), self.basis("a")))

    def test_a_goal_cancelled_unaccepted_is_opened_again_with_a_basis(self) -> None:
        self.tree.add("G", kind="goal", state="cancelled")
        self.conn.commit()
        if self.agent:
            self.refused(lambda: self.transition("G", "ready"), "[acceptance]")
        mark = self.mark()
        self.transition("G", "ready", acceptance=model.NAMED_BASIS)
        goal = self.record("G")
        self.assertEqual((None, True), (goal["state"], goal["open"]))
        self.assertEqual(self.entry_basis(), goal["acceptance"]["basis"])
        self.assertEqual(
            [("accepted", self.entry_basis()), ("opened", "")], self.actions("G", mark)
        )

    def test_accepting_a_goal_stops_at_a_deferred_stage(self) -> None:
        self.tree.add("G", kind="goal")
        self.tree.add("S", kind="stage", state="deferred", parent="G")
        self.tree.add("a", parent="S")
        self.tree.add("c", parent="G")
        self.conn.commit()
        self.transition("G", "ready", acceptance=model.NAMED_BASIS)
        self.assertEqual(("ready", "inherited"), (self.category("c"), self.basis("c")))
        self.assertEqual(("deferred", None), (self.category("S"), self.basis("S")))
        self.assertEqual(("triage", None), (self.category("a"), self.basis("a")))

    def test_a_claim_under_an_accepted_goal_inherits_rather_than_assigns(self) -> None:
        self.accepted_goal(stage=False)
        self.conn.commit()
        self.create(title="Under the goal", parent=self.ref("G"), state="triage")
        identity = self.conn.execute(
            "SELECT work_item_id, number FROM work_items WHERE title = 'Under the goal'"
        ).fetchone()
        self.tree.ids["c"] = str(identity[0])
        self.tree.refs["c"] = model.human_id(self.tree.key, int(identity[1]))
        self.assertEqual(("triage", None), (self.category("c"), self.basis("c")))
        self.claim("c")
        self.assertEqual(("active", "inherited"), (self.category("c"), self.basis("c")))

    def test_the_queue_hands_out_no_deferred_task(self) -> None:
        self.tree.add("a", state="deferred")
        self.tree.add("b", state="deferred")
        self.conn.commit()
        self.call("claim_ready", {"space": self.tree.key})
        for name in ("a", "b"):
            with self.subTest(item=name):
                self.assertEqual(("deferred", ("", [])), (self.category(name), self.holders(name)))
                self.assertFalse(self.record(name)["workable"])

    def test_a_task_moved_back_to_triage_loses_its_basis(self) -> None:
        self.tree.add("a", state="ready")
        self.conn.commit()
        self.assertEqual(model.NAMED_BASIS, self.basis("a"))
        self.transition("a", "triage")
        self.assertEqual(
            ("triage", None, None),
            (self.category("a"), self.basis("a"), self.stored("a", "accepted_at")),
        )

    def test_a_stage_accepted_under_a_goal_not_accepted_gives_its_tasks_no_basis(self) -> None:
        # The chain is climbed past the parent: S stands accepted, G above it does not.
        self.tree.add("G", kind="goal")
        self.tree.add("S", kind="stage", state="container", parent="G")
        self.tree.add("a", parent="S")
        self.tree.add("b", parent="S")
        self.conn.commit()
        if self.agent:
            self.refused(lambda: self.transition("b", "ready"), "[acceptance]")
        self.claim("a")
        named = {"acceptance": model.NAMED_BASIS} if self.agent else {}
        self.transition("b", "ready", **named)
        self.assertEqual(
            (self.entry_basis(), self.entry_basis()), (self.basis("a"), self.basis("b"))
        )

    def test_a_batch_that_ticks_the_last_held_step_and_asks_review_never_passes_ready(
        self,
    ) -> None:
        self.tree.add("a", state="ready")
        self.conn.commit()
        self.give_step("a")
        self.claim_step("a")
        self.assertEqual(("active", ""), (self.category("a"), self.holders("a")[0]))
        mark = self.mark()
        self.call(
            "apply",
            {
                "id": self.ref("a"),
                "checklist_ticks": [{"item_id": self.step("a")}],
                "transition": {"state": "review"},
            },
        )
        # The batch is one write: work went to review, not to ready and on from there.
        moves = [detail for action, detail in self.actions("a", mark) if action == "transitioned"]
        self.assertEqual((["review"], "review"), (moves, self.category("a")))

    def test_the_first_claim_of_a_blocked_task_never_started_records_its_start(self) -> None:
        self.tree.add("w", state="blocked")
        self.conn.commit()
        self.assertIsNone(self.stored("w", "started_at"))
        self.claim("w")
        self.assertEqual("blocked", self.category("w"))
        self.assertIsNotNone(self.stored("w", "started_at"))

    def test_a_closed_goal_opened_again_keeps_its_basis(self) -> None:
        self.accepted_goal(stage=False)
        service.set_summary(self.conn, self.ref("G"), {"done": "Done", "next": "Nothing"})
        self.conn.commit()
        self.transition("G", "done")
        accepted = (self.basis("G"), self.stored("G", "accepted_at"))
        mark = self.mark()
        self.transition("G", "ready")
        goal = self.record("G")
        self.assertEqual((None, "not_started"), (goal["state"], goal["container_state"]))
        self.assertEqual(accepted, (self.basis("G"), self.stored("G", "accepted_at")))
        self.assertEqual([("opened", "")], self.actions("G", mark))


class ThroughHttpTests(ThroughMcpTests):
    """The same cases through the Planning HTTP routes, as the owner's interface writes."""

    via = "http"


class CreationTests(WriteCase):
    """Where the work model places new work, by who files it."""

    def created(self, title: str) -> str:
        identity, number = self.conn.execute(
            "SELECT work_item_id, number FROM work_items WHERE title = ?", (title,)
        ).fetchone()
        self.tree.ids[title] = str(identity)
        self.tree.refs[title] = model.human_id(self.tree.key, int(number))
        return title

    def test_the_owner_files_accepted_work_and_an_agent_files_triage(self) -> None:
        self.tree.add("G", kind="goal")
        self.conn.commit()
        self.via = "http"
        self.create(title="By the owner", parent=self.ref("G"))
        self.via = "mcp"
        self.create(title="By an agent", parent=self.ref("G"))
        owner, agent = self.created("By the owner"), self.created("By an agent")
        self.assertEqual(("ready", "owner"), (self.category(owner), self.basis(owner)))
        self.assertEqual(("triage", None), (self.category(agent), self.basis(agent)))
        self.create(title="Asked of an agent", parent=self.ref("G"), acceptance=model.NAMED_BASIS)
        asked = self.created("Asked of an agent")
        self.assertEqual(("ready", model.NAMED_BASIS), (self.category(asked), self.basis(asked)))

    def test_a_goal_the_owner_creates_stands_accepted_at_once(self) -> None:
        self.via = "http"
        self.create(title="The owner's goal", kind="goal")
        goal = self.created("The owner's goal")
        record = self.record(goal)
        self.assertEqual(
            (None, "not_started", "goal"),
            (record["state"], record["container_state"], record["kind"]),
        )
        self.assertEqual("owner", self.basis(goal))
        self.assertEqual(
            [("created", ""), ("accepted", "owner"), ("opened", "")], self.actions(goal)
        )

    def test_work_filed_under_an_accepted_goal_is_accepted_with_it_by_anyone(self) -> None:
        self.accepted_goal()
        self.conn.commit()
        for via in ("mcp", "http"):
            with self.subTest(via=via):
                self.via = via
                self.create(title=f"Task by {via}", parent=self.ref("S"))
                self.create(title=f"Stage by {via}", kind="stage", parent=self.ref("S"))
                task, stage = self.created(f"Task by {via}"), self.created(f"Stage by {via}")
                self.assertEqual(("ready", "inherited"), (self.category(task), self.basis(task)))
                self.assertEqual((None, "inherited"), (self.category(stage), self.basis(stage)))
                self.assertEqual(
                    [("created", ""), ("accepted", "inherited"), ("opened", "")],
                    self.actions(stage),
                )

    def test_a_named_state_meets_the_refusals_a_move_there_does(self) -> None:
        for fields, said in (
            ({"state": "dev"}, "[executor]"),
            ({"state": "deferred"}, "[deferred]"),
            ({"state": "review"}, "[acceptance]"),
            ({"kind": "goal", "state": "done"}, "[container_state]"),
            ({"kind": "goal", "state": "review"}, "[container]"),
        ):
            with self.subTest(fields=fields):
                self.refused(lambda fields=fields: self.create(title="Placed", **fields), said)


class LaunchTests(WriteCase):
    """A goal or stage refused by the last way in: a launch, before anything starts."""

    def test_a_goal_or_a_stage_is_refused_a_launch(self) -> None:
        self.accepted_goal()
        self.conn.commit()
        repository = self.root / "repo"
        repository.mkdir()
        spawned: list[object] = []
        launcher = runner.Runner(spawn=lambda *found: spawned.append(found))
        with mock.patch.object(runner, "RUNNER", launcher):
            for name in ("G", "S"):
                with self.subTest(item=name):
                    self.refused(
                        lambda name=name: lifecycle.launch_work_item(
                            self.conn,
                            {
                                "work_item": self.ref(name),
                                "client": "claude",
                                "repo": str(repository),
                            },
                        ),
                        model.CONTAINER_UNHELD,
                    )
        self.assertEqual([], spawned)


class HolderRuleTests(WriteCase):
    """The holder rule both ways, kept by every write the oracle tree can meet.

    A holder, of the item or of a step of it, stands only where work is under way
    or blocked, and work under way always has one. The server chooses the state
    that keeps it so: a claim starts the work; a release, a tick or a lapsed lease
    that leaves work unheld hands it back to ready; a move out of work lets the
    holders go. So no write may leave the rule broken. Each write is made once from
    the oracle tree itself, then a seeded walk makes them one after another, and a
    refused write must have written nothing.
    """

    #: The writes of one item the walk makes besides its moves, with their arguments.
    WRITES: tuple[tuple[str, dict], ...] = (
        ("claim", {}),
        ("claim", {"author": "agent-two"}),
        ("claim", {"force": True}),
        ("claim", {"release": True}),
        ("claim", {"release": True, "force": True}),
        ("claim_step", {}),
        ("claim_step", {"force": True}),
        ("claim_step", {"release": True}),
        ("claim_step", {"release": True, "force": True}),
        ("tick", {}),
        ("replace_steps", {}),
        ("replace_steps", {"force": True}),
        ("lease", {}),
    )
    SEEDS = (1, 2)
    STEPS = 120

    def setUp(self) -> None:
        super().setUp()
        self.tree = oracle(self.conn, "WK")
        # Each item gets a step and a summary, so that ticks, step claims and the
        # closing moves all have something to meet; the steps of a, w and t are held,
        # and t, at work, by its step alone.
        holders = {"a": "worker of a", "w": "worker of w", "t": "worker of t"}
        for name, identity in self.tree.ids.items():
            closed = self.conn.execute(
                "SELECT s.is_terminal FROM work_items i JOIN workflow_states s"
                " ON s.state_id = i.state_id WHERE i.work_item_id = ?",
                (identity,),
            ).fetchone()[0]
            step: dict[str, object] = {"text": f"The step of {name}", "done": bool(closed)}
            if name in holders:
                step["claimed_by"] = holders[name]
            self.conn.execute(
                "UPDATE work_items SET checklist = ? WHERE work_item_id = ?",
                (json.dumps(model.checklist([step])), identity),
            )
            service.set_summary(self.conn, self.ref(name), {"done": "Done", "next": "Nothing"})
        self.conn.commit()
        self.sessions = 0
        self.made: dict[str, list[int]] = {}

    def writes(self) -> list[tuple[str, dict]]:
        moves = [
            ("transition", {"state": key, "force": force})
            for key in sorted(self.tree.states)
            for force in (False, True)
        ]
        return [*self.WRITES, *moves]

    def make(self, name: str, write: str, arguments: dict) -> None:
        """Make one write and count it; a refusal must leave the store as it was."""

        self.conn.commit()
        before = self.snapshot()
        try:
            self._write(name, write, dict(arguments))
        except (model.PlanningError, api.PlanningHttpError) as refusal:
            self.conn.rollback()
            self.assertEqual(before, self.snapshot(), f"{write} {arguments} of {name}: {refusal}")
            self.made.setdefault(write, [0, 0])[1] += 1
            return
        self.conn.commit()
        self.made.setdefault(write, [0, 0])[0] += 1

    def _write(self, name: str, write: str, arguments: dict) -> None:
        if write == "claim":
            self.claim(name, **arguments)
        elif write == "claim_step":
            self.claim_step(name, **arguments)
        elif write == "tick":
            self.tick(name)
        elif write == "replace_steps":
            # Another step for the old one, which a held step does not allow unforced.
            service.set_checklist(
                self.conn, self.ref(name), [{"text": f"Another step of {name}"}], **arguments
            )
        elif write == "lease":
            self.lapse(name)
        elif write == "claim_ready":
            self.call("claim_ready", {"space": self.tree.key})
        else:
            if self.agent:
                arguments["acceptance"] = model.NAMED_BASIS
            self.transition(name, arguments.pop("state"), reason="the walk", **arguments)

    def lapse(self, name: str) -> None:
        """Claim the item as a session that then ends, and clean the leases up."""

        self.sessions += 1
        session = f"019a3c2e-{self.sessions:04x}-7c11-9e0f-2f4b6d8a1c3e"
        meta = {"sessionId": session, "threadId": session, "callId": f"call_{self.sessions:04x}"}
        mcp_surface.call_tool(
            self.conn, "claim_work_item", {"id": self.ref(name), "author": "codex"}, meta=meta
        )
        self.conn.commit()
        self.conn.execute("UPDATE sessions SET status = 'ended' WHERE id = ?", (session,))
        self.assertGreaterEqual(service.expire_leases(self.conn), 1)

    def assert_held_where_work_is(self, after: str) -> None:
        for row in self.conn.execute(
            "SELECT i.number, i.kind, i.claim_ref, i.checklist, s.category FROM work_items i"
            " JOIN workflow_states s ON s.state_id = i.state_id"
        ):
            held = bool(row[2]) or any(step["claimed_by"] for step in model.checklist(row[3]))
            where = f"after {after}: #{row[0]} {row[1]} in {row[4]}, held: {held}"
            if held:
                self.assertIn(row[4], ("active", "blocked"), where)
                self.assertNotEqual(model.CONTAINER_KIND, row[1], where)
            if row[4] == "active":
                self.assertTrue(held, where)

    def pristine(self) -> sqlite3.Connection:
        copy = sqlite3.connect(":memory:")
        self.addCleanup(copy.close)
        self.conn.backup(copy)
        return copy

    def test_each_write_from_the_oracle_tree_keeps_the_holder_rule(self) -> None:
        self.assert_held_where_work_is("placing the tree")
        pristine = self.pristine()
        for name in self.tree.ids:
            for write, arguments in self.writes():
                with self.subTest(item=name, write=write, arguments=arguments):
                    self.make(name, write, arguments)
                    self.assert_held_where_work_is(f"{write} {arguments} of {name}")
                pristine.backup(self.conn)
        self.make("", "claim_ready", {})
        self.assert_held_where_work_is("claim_ready")
        # Each write was met both applied and refused somewhere in the tree.
        for write, (applied, refused) in self.made.items():
            with self.subTest(write=write):
                self.assertGreater(applied, 0)
                if write != "claim_ready":
                    self.assertGreater(refused, 0)

    def test_a_seeded_walk_of_writes_never_leaves_the_holder_rule(self) -> None:
        pristine = self.pristine()
        names = list(self.tree.ids)
        choices = [*self.writes(), ("claim_ready", {})]
        for seed in self.SEEDS:
            pristine.backup(self.conn)
            chance = random.Random(seed)  # noqa: S311 - a repeatable walk, not a secret
            for number in range(self.STEPS):
                name = chance.choice(names)
                write, arguments = chance.choice(choices)
                self.make(name, write, arguments)
                self.assert_held_where_work_is(f"seed {seed}, write {number}: {write} {name}")
        for write in ("lease", "claim", "claim_step", "tick", "transition"):
            with self.subTest(write=write):
                self.assertGreater(self.made[write][0], 0)


class HolderRuleOverHttpTests(HolderRuleTests):
    """The same walk with the owner's interface making each write but the lease."""

    via = "http"


class OneStatementTests(WriteCase):
    """A write that changes an item's state and its basis changes both in one statement.

    Two statements in one order pass the store's own check of every statement, so
    only the statements themselves show it: each one that sets a state or a basis
    on an item sets both.
    """

    def item_updates(self, write: Callable[[], object]) -> list[tuple[bool, bool]]:
        """Of each `UPDATE work_items` the write issues, whether it sets the state and the basis."""

        seen: list[str] = []
        self.conn.set_trace_callback(seen.append)
        try:
            write()
        finally:
            self.conn.set_trace_callback(None)
        # A statement is traced again for each trigger it fires, with its own text: the
        # text names the item and the revision it expects, so a second write differs.
        updates = [
            text
            for text in dict.fromkeys(seen)
            if text.lstrip().upper().startswith("UPDATE WORK_ITEMS")
        ]
        return [
            ("state_id =" in text, "acceptance =" in text)
            for text in updates
            if "state_id =" in text or "acceptance =" in text
        ]

    def test_state_and_basis_are_one_statement_per_item_in_every_write_that_moves_both(
        self,
    ) -> None:
        named = {"acceptance": model.NAMED_BASIS} if self.agent else {}
        self.tree.add("a")
        self.tree.add("T", kind="goal")
        self.tree.add("c1", parent="T")
        self.tree.add("c2", parent="T")
        self.tree.add("r", state="ready")
        self.tree.add("p")
        self.tree.add("q")
        self.conn.commit()
        self.give_step("q")
        writes: tuple[tuple[str, Callable[[], object], int], ...] = (
            ("acceptance", lambda: self.transition("a", "ready", **named), 1),
            ("cascade", lambda: self.transition("T", "ready", **named), 3),
            ("entry into triage", lambda: self.transition("r", "triage"), 1),
            ("claim", lambda: self.claim("p"), 1),
            ("step claim", lambda: self.claim_step("q"), 1),
        )
        for name, write, items in writes:
            with self.subTest(write=name):
                self.assertEqual([(True, True)] * items, self.item_updates(write))
        # And each write did change both: a basis given, or taken away by triage.
        self.assertEqual(
            {"a": True, "c1": True, "c2": True, "r": False, "p": True, "q": True},
            {name: self.basis(name) is not None for name in ("a", "c1", "c2", "r", "p", "q")},
        )


class OneStatementOverHttpTests(OneStatementTests):
    via = "http"


class QueueTests(WriteCase):
    """The take-next queue and `workable` are one rule: it hands out what reads workable."""

    def handed_out(self, answer: object) -> str | None:
        if isinstance(answer, dict) and "work_item" in answer:
            answer = answer["work_item"]
        return None if answer is None else str(answer["reference"])  # type: ignore[index]

    def test_the_queue_hands_out_exactly_what_reads_workable_and_never_a_container(self) -> None:
        self.tree = oracle(self.conn, "WK")
        # A ready task whose step is held is held: neither workable nor handed out.
        self.tree.add("r", state="ready")
        held = model.checklist([{"text": "Held", "claimed_by": "someone"}])
        self.conn.execute(
            "UPDATE work_items SET checklist = ? WHERE work_item_id = ?",
            (json.dumps(held), self.tree.ids["r"]),
        )
        self.conn.commit()
        workable = {name for name in self.tree.ids if self.record(name)["workable"]}
        # Worked by hand from the tree: the unheld, unblocked tasks in triage or ready.
        self.assertEqual({"b", "e", "k", "u", "X"}, workable)
        by_ref = {ref: name for name, ref in self.tree.refs.items()}
        handed: list[str] = []
        while reference := self.handed_out(self.call("claim_ready", {"space": self.tree.key})):
            handed.append(by_ref[reference])
            self.assertLessEqual(len(handed), len(workable), handed)
        self.assertEqual(sorted(workable), sorted(handed))
        self.assertEqual(set(), {name for name in self.tree.ids if self.record(name)["workable"]})

    def test_a_task_its_workflow_cannot_start_is_not_workable_and_the_queue_passes_it(
        self,
    ) -> None:
        # Ready comes before triage in the order of work, so `a` is first in the queue;
        # with no way from ready into work, only `b` can be started.
        self.tree.add("a", state="ready")
        self.tree.add("b")
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE workflow_id = ? AND from_state_id = ?"
            " AND to_state_id IN (SELECT state_id FROM workflow_states WHERE category = 'active')",
            (self.tree.workflow_id, self.tree.states["ready"]),
        )
        self.conn.commit()
        self.assertEqual(
            (False, True), (self.record("a")["workable"], self.record("b")["workable"])
        )
        # A board reads it with the tree of its space, and reads it the same.
        listed = service.list_work_items(self.conn, space=self.tree.key, limit=None)
        self.assertEqual(
            {self.ref("a"): False, self.ref("b"): True},
            {item["reference"]: item["workable"] for item in listed},
        )
        handed = self.handed_out(self.call("claim_ready", {"space": self.tree.key}))
        self.assertEqual(self.ref("b"), handed)
        self.assertEqual(("ready", ""), (self.record("a")["state"]["key"], self.holders("a")[0]))
        self.assertIsNone(self.handed_out(self.call("claim_ready", {"space": self.tree.key})))


class QueueOverHttpTests(QueueTests):
    via = "http"


if __name__ == "__main__":
    unittest.main()
