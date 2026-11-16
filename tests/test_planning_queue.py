"""What the take-next queue gives, and why a record says it gives no other.

Each case is one condition of the queue's rule, worked by hand from the rule, not
from the code: a task in a ready state is given when nobody holds it or a step of
it, nothing unfinished blocks it, no question to the owner waits on it, its
workflow leads from its state into work, and no goal or stage over it stands in
triage or deferred, waits on a blocker or is closed. A record names every
condition that fails in `withheld`, in one fixed order, and reads `workable`
exactly when it names none.

Every case is read three ways that must agree — a list of its space, which loads
the space's tree once, one item's record, which loads only what is over the item,
and the queue itself — and each case stands in a space of its own, so the queue
answering nothing there says the case is not given. The trees are placed in SQL
(`tests.planning_tree`): the writes that accept, start and move work have rules
of their own.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.planning import chain, requests, service, views
from tests.planning_tree import Tree

#: The one field of a question to the owner.
FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}


class QueueCase(unittest.TestCase):
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
        self.spaces = 0

    def space(self) -> Tree:
        """A space of its own for one case, so the queue sees that case alone."""

        self.spaces += 1
        return Tree(self.conn, f"Q{self.spaces}")

    def withheld(self, tree: Tree, name: str) -> list[str]:
        """What the space's list and the item's own record say, which must agree."""

        listed = {
            item["reference"]: item
            for item in service.list_work_items(self.conn, space=tree.key, limit=None)
        }[tree.refs[name]]
        alone = service.get_work_item(self.conn, tree.refs[name])
        brief = service.get_work_item_brief(self.conn, tree.refs[name])
        for record in (listed, alone, brief):
            self.assertEqual(record["withheld"] == [], record["workable"], name)
        self.assertEqual(listed["withheld"], alone["withheld"], name)
        self.assertEqual(listed["withheld"], brief["withheld"], name)
        return list(listed["withheld"])

    def given(self, tree: Tree) -> str | None:
        """The item the queue of that space gives next, by name, claimed as the queue does."""

        taken = service.claim_ready_work_item(self.conn, space=tree.key, author="agent")
        if taken is None:
            return None
        by_reference = {reference: name for name, reference in tree.refs.items()}
        return by_reference[str(taken["reference"])]

    def ask(self, tree: Tree, name: str) -> dict:
        return requests.create(
            self.conn, tree.refs[name], kind="question", prompt="Which way?", fields=[FIELD]
        )


class ConditionTests(QueueCase):
    """One condition each."""

    def test_a_ready_task_nothing_holds_up_is_given(self) -> None:
        tree = self.space()
        tree.add("t0", state="ready")
        self.assertEqual([], self.withheld(tree, "t0"))
        self.assertEqual("t0", self.given(tree))
        self.assertIsNone(self.given(tree))

    def test_a_goal_or_a_stage_is_withheld_for_its_kind_alone(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("S", kind="stage", state="container", parent="G")
        tree.add("T", kind="goal")
        for name in ("G", "S", "T"):
            with self.subTest(item=name):
                self.assertEqual(["goal_or_stage"], self.withheld(tree, name))
        self.assertIsNone(self.given(tree))

    def test_work_in_triage_or_deferred_is_not_ready(self) -> None:
        for state in ("triage", "deferred"):
            with self.subTest(state=state):
                tree = self.space()
                tree.add("t", state=state)
                self.assertEqual(["not_ready"], self.withheld(tree, "t"))
                self.assertIsNone(self.given(tree))
                self.assertEqual(state, self.state(tree, "t"))

    def test_a_task_at_work_is_held_by_its_claim_or_by_a_step(self) -> None:
        for how, holders in (
            ("its claim", {"holder": "codex (session another)"}),
            ("a step alone", {"step_holder": "codex (session another)"}),
        ):
            with self.subTest(held_by=how):
                tree = self.space()
                tree.add("t", state="dev", started=True, **holders)
                self.assertEqual(["not_ready", "held"], self.withheld(tree, "t"))
                self.assertIsNone(self.given(tree))

    def test_an_open_blocker_holds_a_task_until_it_is_done(self) -> None:
        tree = self.space()
        tree.add("t", state="ready")
        tree.add("B")
        tree.block("B", "t")
        self.assertEqual(["waits"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))
        tree.move("B", "done")
        self.assertEqual([], self.withheld(tree, "t"))
        self.assertEqual("t", self.given(tree))

    def test_an_open_question_to_the_owner_holds_a_task_until_it_is_answered(self) -> None:
        tree = self.space()
        tree.add("t", state="ready")
        asked = self.ask(tree, "t")
        self.assertEqual(["question"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))
        requests.resolve(
            self.conn,
            asked["request_id"],
            status="answered",
            expected_revision=asked["revision"],
            answers={"answer": "this one"},
        )
        self.assertEqual([], self.withheld(tree, "t"))
        self.assertEqual("t", self.given(tree))

    def test_a_question_past_its_deadline_holds_nothing(self) -> None:
        tree = self.space()
        tree.add("t", state="ready")
        asked = requests.create(
            self.conn,
            tree.refs["t"],
            kind="question",
            prompt="Which way?",
            fields=[FIELD],
            expires_at="2999-01-01T00:00:00Z",
        )
        self.assertEqual(["question"], self.withheld(tree, "t"))
        # Nothing writes the lapse down: the deadline alone ends the wait.
        self.conn.execute(
            "UPDATE work_item_requests SET expires_at = '2026-01-01T00:00:00Z'"
            " WHERE request_id = ?",
            (asked["request_id"],),
        )
        stored = self.conn.execute(
            "SELECT status FROM work_item_requests WHERE request_id = ?", (asked["request_id"],)
        ).fetchone()[0]
        self.assertEqual(
            ("pending", "expired"), (stored, requests.get(self.conn, asked["request_id"])["status"])
        )
        self.assertEqual([], self.withheld(tree, "t"))
        self.assertEqual("t", self.given(tree))

    def test_a_ready_task_its_workflow_cannot_start_is_not_given(self) -> None:
        tree = self.space()
        tree.add("t", state="ready")
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE workflow_id = ? AND from_state_id = ?"
            " AND to_state_id IN (SELECT state_id FROM workflow_states WHERE category = 'active')",
            (tree.workflow_id, tree.states["ready"]),
        )
        self.assertEqual(["no_start"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))
        self.assertEqual("ready", self.state(tree, "t"))

    def test_an_owner_accepted_task_under_a_goal_in_triage_is_not_given(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal")
        tree.add("t", state="ready", parent="G", basis="owner")
        self.assertEqual(["ancestor_triage"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))

    def test_a_task_under_a_deferred_stage_of_an_accepted_goal_is_not_given(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("F", kind="stage", state="deferred", parent="G")
        tree.add("t", state="ready", parent="F")
        self.assertEqual(["ancestor_deferred"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))

    def test_a_task_under_a_stage_that_waits_is_given_once_the_blocker_is_done(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("S", kind="stage", state="container", parent="G")
        tree.add("t", state="ready", parent="S")
        tree.add("B")
        tree.block("B", "S")
        self.assertEqual(["ancestor_waits"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))
        tree.move("B", "done")
        self.assertEqual([], self.withheld(tree, "t"))
        self.assertEqual("t", self.given(tree))

    def test_a_blocker_over_the_goal_holds_every_task_at_any_depth(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("S", kind="stage", state="container", parent="G")
        tree.add("S2", kind="stage", state="container", parent="S")
        tree.add("t", state="ready", parent="S2")
        tree.add("B")
        tree.block("B", "G")
        self.assertEqual(["ancestor_waits"], self.withheld(tree, "t"))
        self.assertIsNone(self.given(tree))

    def test_an_open_task_under_a_closed_stage_is_not_given(self) -> None:
        # Placed in SQL: no write closes a stage with open work under it.
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("D", kind="stage", state="done", parent="G")
        tree.add("t", state="ready", parent="D")
        tree.add("d", state="done", parent="D", started=True)
        self.assertEqual(["ancestor_closed"], self.withheld(tree, "t"))
        # Closed work under it is not given for its own state, not for the stage's.
        self.assertEqual(["not_ready"], self.withheld(tree, "d"))
        self.assertIsNone(self.given(tree))

    def test_every_reason_that_holds_is_named_in_the_one_order(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal")
        tree.add("F", kind="stage", state="deferred", parent="G")
        tree.add("t", parent="F", step_holder="codex (session another)")
        tree.add("B")
        tree.block("B", "t")
        tree.block("B", "F")
        self.ask(tree, "t")
        self.assertEqual(
            [
                "not_ready",
                "held",
                "waits",
                "question",
                "ancestor_triage",
                "ancestor_deferred",
                "ancestor_waits",
            ],
            self.withheld(tree, "t"),
        )

    def test_the_tool_answer_carries_withheld_beside_workable(self) -> None:
        tree = self.space()
        tree.add("t", state="ready")
        tree.add("B")
        tree.block("B", "t")
        answer = mcp_surface.call_tool(self.conn, "get_work_item", {"id": tree.refs["t"]})
        self.assertEqual((False, ["waits"]), (answer["workable"], answer["withheld"]))

    def state(self, tree: Tree, name: str) -> str:
        return str(service.get_work_item(self.conn, tree.refs[name])["state"]["key"])


class OneSpaceTests(QueueCase):
    """Every case in one space: the queue gives what reads workable, and only that."""

    def test_each_call_gives_a_task_with_nothing_withheld_until_none_is_left(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("S", kind="stage", state="container", parent="G")
        tree.add("F", kind="stage", state="deferred", parent="G")
        tree.add("D", kind="stage", state="done", parent="G")
        tree.add("T", kind="goal")
        tree.add("free", state="ready")
        tree.add("under_goal", state="ready", parent="G")
        tree.add("under_stage", state="ready", parent="S")
        tree.add("another", state="ready")
        tree.add("triaged")
        tree.add("deferred", state="deferred")
        tree.add("claimed", state="dev", started=True, holder="codex (session another)")
        tree.add("stepped", state="dev", started=True, step_holder="codex (session another)")
        tree.add("blocked", state="ready")
        tree.add("asked", state="ready")
        tree.add("in_deferred", state="ready", parent="F")
        tree.add("in_triage", state="ready", parent="T", basis="owner")
        tree.add("in_closed", state="ready", parent="D")
        tree.add("B")
        tree.block("B", "blocked")
        self.ask(tree, "asked")
        workable = {"free", "under_goal", "under_stage", "another"}

        given: list[str] = []
        while True:
            listed = service.list_work_items(self.conn, space=tree.key, limit=None)
            open_now = {
                item["reference"] for item in listed if item["withheld"] == [] and item["workable"]
            }
            name = self.given(tree)
            if name is None:
                self.assertEqual(set(), open_now, "the queue answered nothing while work was left")
                break
            self.assertIn(tree.refs[name], open_now, f"{name} was given with something withheld")
            given.append(name)
            self.assertLessEqual(len(given), len(workable), given)
        self.assertEqual(sorted(workable), sorted(given))
        # What the queue did not give still says why.
        listed = {
            item["reference"]: item["withheld"]
            for item in service.list_work_items(self.conn, space=tree.key, limit=None)
        }
        self.assertEqual(
            {
                "triaged": ["not_ready"],
                "deferred": ["not_ready"],
                "claimed": ["not_ready", "held"],
                "stepped": ["not_ready", "held"],
                "blocked": ["waits"],
                "asked": ["question"],
                "in_deferred": ["ancestor_deferred"],
                "in_triage": ["ancestor_triage"],
                "in_closed": ["ancestor_closed"],
                "B": ["not_ready"],
            },
            {
                name: listed[tree.refs[name]]
                for name in tree.refs
                if name not in workable and name not in ("G", "S", "F", "D", "T")
            },
        )
        for name in ("G", "S", "F", "D", "T"):
            self.assertEqual(["goal_or_stage"], listed[tree.refs[name]], name)


class OrderCase(QueueCase):
    def shape(self, tree: Tree, name: str, *, created: str, priority: str = "medium") -> None:
        """Give an item its age and priority, placed in SQL as the tree places the rest."""

        self.conn.execute(
            "UPDATE work_items SET created_at = ?, priority = ? WHERE work_item_id = ?",
            (created, priority, tree.ids[name]),
        )

    def names(self, tree: Tree, items: list[dict]) -> list[str]:
        by_reference = {reference: name for name, reference in tree.refs.items()}
        return [by_reference[str(item["reference"])] for item in items]

    def listed(self, tree: Tree) -> list[dict]:
        return service.list_work_items(self.conn, space=tree.key, limit=None)

    def queue_orders(self, tree: Tree) -> dict[str, int | None]:
        listed = self.listed(tree)
        return {
            name: item["queue_order"]
            for name, item in zip(self.names(tree, listed), listed, strict=True)
        }

    def walk(self, tree: Tree, between: object = None) -> list[list[dict]]:
        """Every page of three, by next_offset; `between` runs after the first page."""

        pages: list[list[dict]] = []
        offset: int | None = 0
        while offset is not None:
            page = service.list_work_items_page(self.conn, space=tree.key, limit=3, offset=offset)
            pages.append(page["work_items"])
            offset = page["next_offset"]
            if len(pages) == 1 and callable(between):
                between()
        return pages


class WorkOrderTests(OrderCase):
    """The key of work, and the number on a tie."""

    def six(self) -> Tree:
        """U urgent and newest; S low and started; T low under a stage at work; P high;
        O1 medium and oldest; O2 medium and younger. All but T under no parent."""

        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("St", kind="stage", state="container", parent="G")
        tree.add("W", state="dev", parent="St", started=True)
        tree.add("T", state="ready", parent="St")
        for name in ("U", "S", "P", "O1", "O2"):
            tree.add(name, state="ready")
        for name, created, priority in (
            ("O1", "2026-11-01T00:00:00Z", "medium"),
            ("O2", "2026-11-02T00:00:00Z", "medium"),
            ("P", "2026-11-03T00:00:00Z", "high"),
            ("S", "2026-11-04T00:00:00Z", "low"),
            ("T", "2026-11-05T00:00:00Z", "low"),
            ("U", "2026-11-06T00:00:00Z", "urgent"),
        ):
            self.shape(tree, name, created=created, priority=priority)
        # Taken and handed back: it stands in ready again, started.
        service.claim_work_item(self.conn, tree.refs["S"], author="agent")
        service.claim_work_item(self.conn, tree.refs["S"], author="agent", release=True)
        return tree

    def test_the_queue_gives_urgent_started_under_way_then_priority_then_age(self) -> None:
        tree = self.six()
        expected = ["U", "S", "T", "P", "O1", "O2"]
        self.assertEqual(
            "ready", str(service.get_work_item(self.conn, tree.refs["S"])["state"]["key"])
        )
        orders = self.queue_orders(tree)
        self.assertEqual(
            {name: place for place, name in enumerate(expected, 1)},
            {name: orders[name] for name in expected},
        )
        self.assertEqual({None}, {orders[name] for name in ("G", "St", "W")})
        # The list stands on the same key: the ready rows come in the queue's order.
        ready = [name for name in self.names(tree, self.listed(tree)) if name in expected]
        self.assertEqual(expected, ready)
        # An agent's compact row says its place, or why the queue does not give it.
        rows = {
            row["reference"]: row
            for row in mcp_surface.call_tool(self.conn, "list_work_items", {"space": tree.key})[
                "work_items"
            ]
        }
        self.assertEqual(1, rows[tree.refs["U"]]["queue_order"])
        self.assertNotIn("withheld", rows[tree.refs["U"]])
        self.assertEqual(["not_ready", "held"], rows[tree.refs["W"]]["withheld"])
        self.assertNotIn("queue_order", rows[tree.refs["W"]])
        self.assertEqual(expected, [self.given(tree) for _ in expected])
        self.assertIsNone(self.given(tree))

    def test_two_tasks_equal_on_the_whole_key_go_by_number(self) -> None:
        tree = self.space()
        tree.add("a", state="ready")
        tree.add("b", state="ready")
        for name in ("a", "b"):
            self.shape(tree, name, created="2026-11-01T00:00:00Z")
        self.assertEqual(["a", "b"], self.names(tree, self.listed(tree)))
        self.assertEqual({"a": 1, "b": 2}, self.queue_orders(tree))
        self.assertEqual(["a", "b"], [self.given(tree), self.given(tree)])

    def test_a_lowered_priority_moves_the_item_at_the_next_read_with_nothing_stored(
        self,
    ) -> None:
        tree = self.six()
        service.update_work_item(self.conn, tree.refs["P"], priority="low")
        orders = self.queue_orders(tree)
        self.assertEqual(
            {"U": 1, "S": 2, "T": 3, "O1": 4, "O2": 5, "P": 6},
            {name: orders[name] for name in ("U", "S", "T", "P", "O1", "O2")},
        )
        ready = [name for name in self.names(tree, self.listed(tree)) if orders[name]]
        self.assertEqual(["U", "S", "T", "O1", "O2", "P"], ready)
        # The order is computed: an item has no stored place to write.
        columns = {str(row[1]) for row in self.conn.execute("PRAGMA table_info(work_items)")}
        self.assertNotIn("position", columns)


class ListOrderTests(OrderCase):
    """One total order for every read of many items, and its pages."""

    #: The whole list, in the total order: ready by the key of work, then work at
    #: work, then the accepted goal, whose state comes last in the workflow.
    ORDER = ("t1", "t2", "t3", "t4", "t5", "t6", "t7", "a1", "a2", "G")

    def ten(self) -> Tree:
        """Seven ready tasks of different keys, two at work and an accepted goal.

        a1, at work, blocks t3, and t5 has an open question to the owner with a
        deadline. The rows are placed in an order the key reverses.
        """

        tree = self.space()
        tree.add("G", kind="goal", state="container")
        for name in ("a2", "a1"):
            tree.add(name, state="dev", started=True)
        for name in reversed(self.ORDER[:7]):
            tree.add(name, state="ready")
        for name, priority, created in (
            ("t1", "urgent", "2026-11-09T00:00:00Z"),
            ("t2", "high", "2026-11-01T00:00:00Z"),
            ("t3", "high", "2026-11-02T00:00:00Z"),
            ("t4", "medium", "2026-11-03T00:00:00Z"),
            ("t5", "medium", "2026-11-04T00:00:00Z"),
            ("t6", "low", "2026-11-05T00:00:00Z"),
            ("t7", "low", "2026-11-06T00:00:00Z"),
            ("a1", "medium", "2026-11-07T00:00:00Z"),
            ("a2", "medium", "2026-11-08T00:00:00Z"),
        ):
            self.shape(tree, name, created=created, priority=priority)
        tree.block("a1", "t3")
        self.asked = requests.create(
            self.conn,
            tree.refs["t5"],
            kind="question",
            prompt="Which way?",
            fields=[FIELD],
            expires_at="2999-01-01T00:00:00Z",
        )
        return tree

    def test_the_pages_of_one_walk_are_the_whole_list_in_the_total_order(self) -> None:
        tree = self.ten()
        pages = self.walk(tree)
        self.assertEqual([3, 3, 3, 1], [len(page) for page in pages])
        walked = [item for page in pages for item in page]
        self.assertEqual(list(self.ORDER), self.names(tree, walked))
        self.assertEqual(list(self.ORDER), self.names(tree, self.listed(tree)))
        orders = [item["queue_order"] for item in walked]
        # t3 waits and t5 is asked: each stands by its key among the given, unplaced.
        self.assertEqual([1, 2, None, 3, None, 4, 5, None, None, None], orders)
        placed = [order for order in orders if order is not None]
        self.assertEqual(sorted(placed), placed)

        # The deadline passes and nothing is written: only the places change.
        self.conn.execute(
            "UPDATE work_item_requests SET expires_at = '2026-01-01T00:00:00Z'"
            " WHERE request_id = ?",
            (self.asked["request_id"],),
        )
        again = [item for page in self.walk(tree) for item in page]
        self.assertEqual(list(self.ORDER), self.names(tree, again))
        self.assertEqual(
            [1, 2, None, 3, 4, 5, 6, None, None, None], [item["queue_order"] for item in again]
        )

    def test_a_write_between_pages_can_carry_a_row_over_the_cut(self) -> None:
        tree = self.ten()

        def raise_t6() -> None:
            service.update_work_item(self.conn, tree.refs["t6"], priority="urgent")

        pages = self.walk(tree, raise_t6)
        walked = self.names(tree, [item for page in pages for item in page])
        # t6 rose to the first page, already read, ahead of t1 as the older urgent
        # task: the walk never meets it.
        self.assertNotIn("t6", walked)
        self.assertEqual(
            ["t6", "t1", "t2"],
            self.names(
                tree, service.list_work_items_page(self.conn, space=tree.key, limit=3)["work_items"]
            ),
        )

    def test_without_a_space_rows_interleave_by_key_then_space_then_number(self) -> None:
        first, second = Tree(self.conn, "MAIN"), Tree(self.conn, "OPS")
        # OPS's task takes number 1 there, smaller than MAIN's second task.
        second.add("o1", state="ready")
        second.add("GO", kind="goal", state="container")
        for name in ("m1", "m2"):
            first.add(name, state="ready")
        first.add("GM", kind="goal", state="container")
        self.conn.execute("UPDATE work_items SET created_at = '2026-11-01T00:00:00Z'")
        listed = service.list_work_items(self.conn, limit=None)
        by_reference = {
            reference: name for tree in (first, second) for name, reference in tree.refs.items()
        }
        self.assertEqual(
            ["m1", "m2", "o1", "GM", "GO"],
            [by_reference[str(item["reference"])] for item in listed],
        )
        # Each row's place is in its own space's queue.
        self.assertEqual([1, 2, 1, None, None], [item["queue_order"] for item in listed])


class OneReadTests(OrderCase):
    """The list, the board's feed and the chain say the place the queue gives work in."""

    def test_every_read_names_first_the_task_the_queue_gives_next(self) -> None:
        tree = self.space()
        tree.add("G", kind="goal", state="container")
        tree.add("a", state="dev", parent="G", started=True)
        tree.add("b", state="ready", parent="G")
        tree.add("c", state="ready", parent="G")
        tree.add("d", state="ready")
        tree.add("e", state="ready", parent="G")
        self.shape(tree, "c", created="2026-11-01T00:00:00Z", priority="urgent")
        self.shape(tree, "d", created="2026-11-01T00:00:00Z", priority="high")
        given: list[str] = []
        while True:
            listed = {item["reference"]: item["queue_order"] for item in self.listed(tree)}
            board = {
                item["reference"]: item["queue_order"]
                for item in views.planning_payload(self.conn, space=tree.key)["work_items"]
            }
            members = {
                member["reference"]: member["queue_order"]
                for member in chain.chain(self.conn, tree.refs["G"], "tree")["members"]
            }
            self.assertEqual(listed, board)
            self.assertEqual({reference: listed[reference] for reference in members}, members)
            name = self.given(tree)
            if name is None:
                self.assertEqual(set(), {order for order in listed.values() if order})
                break
            self.assertEqual(1, listed[tree.refs[name]], name)
            given.append(name)
        self.assertEqual(["c", "b", "e", "d"], given)


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
