"""What a reader is shown of goals, stages and tasks: the work model's read rules.

Each test is one case of the work model's read rules, named by what it shows, and its
expectations are the work model's, worked by hand, not the code's. G is an accepted
goal, S and S2 stages, a and b tasks under S, c a task straight under G and X an
item outside the tree. The trees are placed in SQL (`tests.planning_tree`): the
writes that accept, start and move work have rules of their own.

An accepted open container shows no state but what it derives, `container_state`:
`not_started` with no children, `awaiting_confirmation` once it had some and none
is open, else `in_progress` once anything under it started and `not_started`
before that. Every read answers it the same way: one item's record, which loads
the tree below the item, and the list a board reads, which loads its spaces once.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.planning import chain, item_tree, model, service, views, words
from tests.planning_tree import Tree


class ReadCase(unittest.TestCase):
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
        self.tree = Tree(self.conn)

    def goal(self) -> None:
        self.tree.add("G", kind="goal", state="container")

    def stage(self, name: str = "S", parent: str = "G") -> None:
        self.tree.add(name, kind="stage", state="container", parent=parent)

    def record(self, name: str) -> dict:
        return service.get_work_item(self.conn, self.tree.refs[name])

    def category(self, name: str) -> str:
        return str(self.record(name)["state"]["category"])

    def derived(self, name: str) -> str | None:
        """What an item derives, read alone and in the space's list, which must agree."""

        alone = self.record(name)
        listed = {
            item["reference"]: item
            for item in service.list_work_items(self.conn, space=self.tree.key, limit=None)
        }[self.tree.refs[name]]
        for read in (alone, listed):
            if read["container_state"] is not None:
                self.assertIsNone(read["state"], "an accepted open container shows no state")
        self.assertEqual(alone["container_state"], listed["container_state"])
        return alone["container_state"]

    def assert_derived(self, **expected: str | None) -> None:
        for name, state in expected.items():
            with self.subTest(item=name):
                self.assertEqual(state, self.derived(name))


class ContainerStateRowTests(ReadCase):
    def test_a_goal_without_children_has_not_started(self) -> None:
        self.goal()
        self.assert_derived(G="not_started")

    def test_a_stage_without_children_and_its_goal_have_not_started(self) -> None:
        self.goal()
        self.stage()
        self.assert_derived(S="not_started", G="not_started")

    def test_a_ready_task_never_started_starts_nothing(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="ready", parent="S")
        self.assert_derived(S="not_started", G="not_started")

    def test_a_task_in_triage_starts_nothing(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", parent="S")
        self.assert_derived(S="not_started", G="not_started")

    def test_a_deferred_task_starts_nothing(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="deferred", parent="S")
        self.assert_derived(S="not_started", G="not_started")

    def test_a_task_at_work_puts_the_stage_and_the_goal_in_progress(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="dev", parent="S", started=True)
        self.assert_derived(S="in_progress", G="in_progress")

    def test_a_released_task_ready_and_started_keeps_them_in_progress(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="ready", parent="S", started=True)
        self.assert_derived(S="in_progress", G="in_progress")

    def test_a_task_in_review_keeps_them_in_progress(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="review", parent="S", started=True)
        self.assert_derived(S="in_progress", G="in_progress")

    def test_a_blocked_task_is_started_only_if_it_was_at_work(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="blocked", parent="S")
        self.assert_derived(S="not_started")
        self.tree.move("a", "blocked", started=True)
        self.assert_derived(S="in_progress")

    def test_a_task_done_after_work_awaits_the_stages_confirmation(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="done", parent="S", started=True)
        self.assert_derived(S="awaiting_confirmation", G="in_progress")

    def test_a_task_closed_unclaimed_was_started_by_its_close(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="ready", parent="S")
        self.assertIsNone(self.record("a")["started_at"])
        self.assert_derived(S="not_started", G="not_started")
        # The close is the write here: entering completed records the start.
        reference = self.tree.refs["a"]
        service.set_summary(self.conn, reference, {"done": "Closed", "next": "Nothing"})
        service.transition_work_item(self.conn, reference, "done")
        self.assertEqual(("", "completed"), (self.record("a")["claim_ref"], self.category("a")))
        self.assertIsNotNone(self.record("a")["started_at"])
        self.assert_derived(S="awaiting_confirmation", G="in_progress")

    def test_a_lone_task_cancelled_unstarted_awaits_the_stage_but_starts_no_goal(
        self,
    ) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="cancelled", parent="S")
        self.assert_derived(S="awaiting_confirmation", G="not_started")

    def test_one_task_done_and_one_ready_is_in_progress(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="done", parent="S", started=True)
        self.tree.add("b", state="ready", parent="S")
        self.assert_derived(S="in_progress", G="in_progress")

    def test_a_cancelled_and_a_ready_task_never_started_have_not_started(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="cancelled", parent="S")
        self.tree.add("b", state="ready", parent="S")
        self.assert_derived(S="not_started", G="not_started")

    def test_a_stage_whose_only_child_left_awaits_its_confirmation(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", parent="S")
        self.tree.leave("a")
        self.assert_derived(S="awaiting_confirmation", G="not_started")

    def test_a_child_that_left_beside_an_unstarted_one_starts_nothing(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="dev", parent="S", started=True)
        self.tree.add("b", state="ready", parent="S")
        self.tree.leave("a")
        self.assert_derived(S="not_started")

    def test_a_closed_stage_started_its_goal_beside_an_open_task(self) -> None:
        self.goal()
        self.tree.add("S", kind="stage", state="done", parent="G")
        self.tree.add("a", state="done", parent="S", started=True)
        self.tree.add("c", state="ready", parent="G")
        self.assert_derived(G="in_progress", S=None)

    def test_a_goal_whose_only_stage_closed_awaits_its_confirmation(self) -> None:
        self.goal()
        self.tree.add("S", kind="stage", state="done", parent="G")
        self.tree.add("a", state="done", parent="S", started=True)
        self.assert_derived(G="awaiting_confirmation")

    def test_a_cancelled_stage_and_a_task_done_await_the_goals_confirmation(self) -> None:
        self.goal()
        self.tree.add("S", kind="stage", state="cancelled", parent="G")
        self.tree.add("a", state="cancelled", parent="S")
        self.tree.add("c", state="done", parent="G", started=True)
        self.assert_derived(G="awaiting_confirmation")

    def test_a_stage_not_accepted_shows_triage_and_derives_nothing(self) -> None:
        self.goal()
        self.tree.add("S", kind="stage", parent="G")
        self.tree.add("a", parent="S")
        self.assert_derived(S=None, G="not_started")
        self.assertEqual("triage", self.record("S")["state"]["category"])

    def test_a_deferred_stage_shows_deferred_and_the_goal_goes_by_its_done_task(
        self,
    ) -> None:
        self.goal()
        self.tree.add("S", kind="stage", state="deferred", parent="G")
        self.tree.add("c", state="done", parent="G", started=True)
        self.assert_derived(S=None, G="in_progress")
        self.assertEqual("deferred", self.record("S")["state"]["category"])

    def test_a_stage_awaiting_confirmation_is_open_work_of_its_goal(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="done", parent="S", started=True)
        self.tree.add("c", state="dev", parent="G", started=True)
        self.assert_derived(S="awaiting_confirmation", G="in_progress")

    def test_a_task_taken_by_number_accepts_no_container_above_it(self) -> None:
        self.tree.add("G", kind="goal")
        self.tree.add("S", kind="stage", parent="G")
        self.tree.add("a", parent="S")
        self.assertIsNone(self.record("a")["acceptance"])
        # The claim is the write here: it takes the task by its number, out of triage.
        service.claim_work_item(self.conn, self.tree.refs["a"], author="agent")
        record = self.record("a")
        self.assertEqual(
            ("active", "assignment"),
            (record["state"]["category"], record["acceptance"]["basis"]),
        )
        self.assertIsNotNone(record["acceptance"]["at"])
        self.assertIsNotNone(record["started_at"])
        self.assert_derived(G=None, S=None)
        for name in ("G", "S"):
            with self.subTest(item=name):
                self.assertEqual("triage", self.record(name)["state"]["category"])
                self.assertIsNone(self.record(name)["acceptance"])

    def test_nothing_is_filed_or_moved_under_a_closed_goal(self) -> None:
        self.tree.add("G", kind="goal", state="done")
        self.tree.add("a")
        self.conn.commit()
        refusal = f"{self.tree.refs['G']} is closed; reopen it first"
        with self.assertRaisesRegex(model.PlanningError, refusal):
            service.create_work_item(
                self.conn, space=self.tree.key, title="Late", parent=self.tree.refs["G"]
            )
        with self.assertRaisesRegex(model.PlanningError, refusal):
            service.update_work_item(self.conn, self.tree.refs["a"], parent=self.tree.refs["G"])
        self.assertIsNone(self.record("a")["parent_id"])
        self.assertEqual(2, len(service.list_work_items(self.conn, space=self.tree.key)))

    def test_work_four_levels_down_puts_every_level_in_progress(self) -> None:
        self.goal()
        self.stage()
        self.stage("S2", parent="S")
        self.tree.add("a", state="dev", parent="S2", started=True)
        self.assert_derived(S2="in_progress", S="in_progress", G="in_progress")


class MarkRowTests(ReadCase):
    def test_an_open_blocker_of_a_goal_is_waited_for_and_derives_nothing(self) -> None:
        self.goal()
        self.tree.add("X")
        self.tree.block("X", "G")
        self.assertEqual([self.tree.refs["X"]], self.record("G")["waits_for"])
        self.assert_derived(G="not_started")
        self.tree.move("X", "done", started=True)
        self.assertEqual([], self.record("G")["waits_for"])
        self.assert_derived(G="not_started")

    def test_a_ready_task_waits_for_its_open_blocker_and_is_not_workable(self) -> None:
        self.tree.add("a", state="ready")
        self.tree.add("X")
        self.tree.block("X", "a")
        record = self.record("a")
        self.assertEqual(([self.tree.refs["X"]], False), (record["waits_for"], record["workable"]))
        self.tree.move("X", "done", started=True)
        record = self.record("a")
        self.assertEqual(([], True), (record["waits_for"], record["workable"]))

    def test_a_start_is_kept_wherever_the_task_goes_back_to(self) -> None:
        self.tree.add("a", state="ready", started=True)
        started = self.record("a")["started_at"]
        self.assertIsNotNone(started)
        for key, category in (("triage", "triage"), ("dev", "active")):
            with self.subTest(state=key):
                self.tree.move("a", key)
                record = self.record("a")
                self.assertEqual(
                    (category, started), (record["state"]["category"], record["started_at"])
                )

    def test_a_goal_starts_when_the_first_thing_under_it_did(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="done", parent="S", started=True)
        self.tree.add("c", state="dev", parent="G", started=True)
        first = self.record("a")["started_at"]
        self.assertLess(first, self.record("c")["started_at"])
        self.assertEqual(
            (first, first), (self.record("S")["started_at"], self.record("G")["started_at"])
        )


class ServiceStateRowTests(ReadCase):
    def test_an_accepted_goal_is_in_no_category_and_shows_what_it_derives(self) -> None:
        self.goal()
        self.tree.add("a", state="ready")
        listed = service.list_work_items(self.conn, space=self.tree.key, category="ready")
        self.assertEqual([self.tree.refs["a"]], [item["reference"] for item in listed])
        record = self.record("G")
        self.assertEqual(
            (None, True, "not_started", "goal"),
            (record["state"], record["open"], record["container_state"], record["kind"]),
        )

    def test_every_reader_of_any_kind_returns_accepted_goals_and_stages(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="ready", parent="S")
        self.conn.commit()
        wanted = {self.tree.refs["G"], self.tree.refs["S"]}
        listed = {item["reference"] for item in service.list_work_items(self.conn, space="OR")}
        board = {item["reference"] for item in views.planning_payload(self.conn)["work_items"]}
        graph = {node["reference"] for node in views.graph_payload(self.conn)["nodes"]}
        members = {
            member["reference"]
            for member in chain.chain(self.conn, self.tree.refs["G"], "tree")["members"]
        }
        found = {
            item["reference"]
            for item in service.search_work_items(self.conn, "item", space=self.tree.key)
        }
        for reader, references in (
            ("list", listed),
            ("board", board),
            ("graph", graph),
            ("search", found),
        ):
            with self.subTest(reader=reader):
                self.assertLessEqual(wanted, references)
        self.assertIn(self.tree.refs["S"], members)
        for name in ("G", "S"):
            with self.subTest(item=name):
                self.assertEqual(self.tree.refs[name], self.record(name)["reference"])

    def test_an_accepted_stage_blocks_like_open_work_until_it_is_confirmed(self) -> None:
        self.goal()
        self.stage()
        self.tree.add("a", state="ready")
        self.tree.add("Z")
        self.conn.execute(
            "UPDATE work_items SET title = 'Stage item words' WHERE work_item_id IN (?, ?)",
            (self.tree.ids["S"], self.tree.ids["Z"]),
        )
        self.tree.move("Z", "done", started=True)
        self.tree.block("S", "a")
        self.conn.commit()
        record = self.record("a")
        self.assertEqual(([self.tree.refs["S"]], False), (record["waits_for"], record["workable"]))
        self.assertIsNone(
            service.claim_ready_work_item(self.conn, space=self.tree.key, author="queue")
        )
        # A new item reading like the stage is offered it among the open items.
        probe = service.create_work_item(self.conn, space=self.tree.key, title="Stage item words")
        similar = [found["reference"] for found in words.similar(self.conn, probe["work_item_id"])]
        self.assertIn(self.tree.refs["S"], similar)
        self.assertNotIn(self.tree.refs["Z"], similar)
        service.delete_work_item(self.conn, probe["reference"])
        self.tree.move("S", "done")
        record = self.record("a")
        self.assertEqual(([], True), (record["waits_for"], record["workable"]))
        taken = service.claim_ready_work_item(self.conn, space=self.tree.key, author="queue")
        assert taken is not None
        self.assertEqual(self.tree.refs["a"], taken["reference"])


class OnePassTests(ReadCase):
    def test_a_board_derives_every_container_at_a_cost_that_does_not_grow_with_them(
        self,
    ) -> None:
        """The list a board reads derives its containers from its spaces in one pass.

        Each item costs the board the statements of its own record; the containers
        cost one read of the space's tree, however many there are and however deep.
        A board with work in triage reads its stack once, so every board measured
        here holds a finding from the start.
        """

        def board_statements(goals: int) -> tuple[int, int]:
            count = 0

            def trace(_statement: str) -> None:
                nonlocal count
                count += 1

            self.conn.set_trace_callback(trace)
            try:
                items = views.planning_payload(self.conn, space=self.tree.key)["work_items"]
            finally:
                self.conn.set_trace_callback(None)
            self.assertEqual(goals, sum(1 for item in items if item["container_state"]))
            return len(items), count

        self.goal()
        self.stage()
        self.tree.add("a", state="dev", parent="S", started=True)
        self.tree.add("f", kind="task")
        self.conn.commit()
        few_items, few = board_statements(2)
        for index in range(20):
            self.tree.add(f"T{index}", kind="task")
        self.conn.commit()
        tasks_items, with_tasks = board_statements(2)
        for index in range(20):
            self.tree.add(f"G{index}", kind="goal", state="container")
            self.tree.add(f"S{index}", kind="stage", state="container", parent=f"G{index}")
        self.conn.commit()
        goals_items, with_goals = board_statements(42)
        per_item = (with_tasks - few) / (tasks_items - few_items)
        # A container costs a reader no more than a task does: its tree is read once.
        self.assertEqual(per_item * (goals_items - tasks_items), with_goals - with_tasks)

    def test_a_search_derives_every_container_of_its_page_from_one_tree(self) -> None:
        """Both ways a search reads, by words and as a phrase, read the page's tree once."""

        self.goal()
        self.stage()
        self.tree.add("a", state="dev", parent="S", started=True)
        self.conn.commit()
        loaded: list[object] = []
        of_spaces = item_tree.of_spaces

        def counted(conn: object, space_ids: object) -> item_tree.Tree:
            loaded.append(space_ids)
            return of_spaces(conn, space_ids)  # type: ignore[arg-type]

        alone = mock.patch.object(item_tree, "of_item", side_effect=AssertionError("per item"))
        # Every item's title holds "item"; a reference alone is read as a phrase.
        for query, containers in (("item", ("G", "S")), (self.tree.refs["S"], ("S",))):
            counting = mock.patch.object(item_tree, "of_spaces", counted)
            with self.subTest(query=query), alone, counting:
                loaded.clear()
                found = {
                    item["reference"]: item["container_state"]
                    for item in service.search_work_items(self.conn, query, space=self.tree.key)
                }
                self.assertEqual(1, len(loaded))
                self.assertEqual(
                    {self.tree.refs[name]: "in_progress" for name in containers},
                    {ref: state for ref, state in found.items() if state is not None},
                )


if __name__ == "__main__":
    unittest.main()
