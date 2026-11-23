"""What the tree's news adds to an orchestrator's hook, counted inside the process.

The tree is one goal of 13 stages with 20 tasks each, 274 items; the orchestrator holds
one task in it, so every item is in its tree. The cost is counted in what the machine's
speed and load leave alone: the statements `notify.collect` issues and the plan SQLite
takes for them. A bound in milliseconds measured the machine as much as the hook: on a
machine busy with other work the same code took two to five times as long.

- With nothing new anywhere, the hook answers from its two reads with the tree as
  without it: the tree adds no statement, only three columns to the second, each an
  uncorrelated subquery SQLite answers by a search of its table, never a scan.
- The tree's news is read in as many statements whatever it reads: 13 comments on one
  stage and then one on each of the 13 stages, or 100 comments across the tree and then
  100 more on 100 other tasks, take the same number. What it reads grows with neither
  the rows written since nor the items they name.
- The climb reads each level once: an item and its parent asked about together are
  one statement whichever row comes first, and what is over them the next.
"""

from __future__ import annotations

import os
import re
import sqlite3
import tempfile
import unittest
from collections.abc import Sequence
from typing import Any
from unittest import mock

from server import mcp_surface, store
from server.hooks import marks, notify
from server.planning import calls, service

A = "0a000000-0000-4000-8000-00000000000a"
B = "0b000000-0000-4000-8000-00000000000b"
STAGES = 13
TASKS = 20
#: How SQLite names the plan of a subquery, numbered, and of a read of one table.
_SUBQUERY = re.compile(r"(SCALAR SUBQUERY) \d+")
_READ = re.compile(r"(SEARCH|SCAN) (TABLE )?(\w+)")


class TreeCostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.addClassCleanup(directory.cleanup)
        cls.path = os.path.join(directory.name, "store", "valkama.sqlite3")
        os.makedirs(os.path.dirname(cls.path))
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": cls.path})
        patch.start()
        cls.addClassCleanup(patch.stop)
        conn = store.connect()
        cls.addClassCleanup(conn.close)
        cls.conn = conn
        service.create_planning_space(conn, name="Crew", key="MAIN")
        with calls.bind(calls.browser(), "/api/planning/work-items"):
            goal = cls.made("A goal of 274 items", "goal")
            cls.stages = [cls.made(f"Stage {n}", "stage", goal) for n in range(STAGES)]
            cls.tasks = [
                cls.made(f"Task {n}.{m}", "task", stage)
                for n, stage in enumerate(cls.stages)
                for m in range(TASKS)
            ]
        conn.commit()
        count = conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0]
        assert count == 274, count
        cls.call("claim_work_item", {"sessionId": A}, id=cls.tasks[0])
        cls.state = os.path.join(os.path.dirname(cls.path), marks.STATE_DIRECTORY)
        os.makedirs(cls.state, exist_ok=True)

    @classmethod
    def made(cls, title: str, kind: str, parent: str | None = None) -> str:
        made = service.create_work_item(
            cls.conn, space="MAIN", title=title, kind=kind, parent=parent
        )
        return str(made["reference"])

    @classmethod
    def call(cls, tool: str, meta: object, **arguments: object) -> None:
        answer = mcp_surface.call_tool(cls.conn, tool, arguments, meta=meta)
        cls.conn.commit()
        assert isinstance(answer, dict) and "error" not in answer, answer

    def collect(self, *, take: bool = True) -> notify.News:
        conn = notify._connect(self.path)
        assert conn is not None
        try:
            return notify.collect(conn, self.state, A, None, take=take)
        finally:
            conn.close()

    def comment(self, refs: list[str]) -> None:
        """One comment by session B on each of `refs`."""

        for number, ref in enumerate(refs):
            self.call(
                "apply_work_item_changes",
                {"sessionId": B},
                id=ref,
                comment={"body": f"Note {number} under the goal"},
            )

    def statements(self, name: str | None = None, replacement: object = None) -> list[str]:
        """The statements one `notify.collect` that takes nothing issues, with
        `notify.<name>` replaced when a name is given; the replacement is undone after."""

        conn = notify._connect(self.path)
        assert conn is not None
        self.addCleanup(conn.close)
        original = getattr(notify, name) if name else None
        seen: list[str] = []
        conn.set_trace_callback(seen.append)
        try:
            if name:
                setattr(notify, name, replacement)
            notify.collect(conn, self.state, A, None, take=False)
        finally:
            conn.set_trace_callback(None)
            if name:
                setattr(notify, name, original)
        return seen

    def plan(self, statement: str) -> list[str]:
        """What SQLite does for `statement`, a step a line, subqueries unnumbered."""

        rows = self.conn.execute("EXPLAIN QUERY PLAN " + statement).fetchall()
        return [_SUBQUERY.sub(r"\1", row[3]) for row in rows]

    def marks(self) -> bytes:
        with open(os.path.join(self.state, A + ".marks"), "rb") as handle:
            return handle.read()

    def test_nothing_new_adds_no_statement_and_three_columns_read_by_a_search(self) -> None:
        self.collect()
        self.assertFalse(self.collect(), "everything is read")
        self.assertIn(b"\n@tree ", self.marks())
        with_tree = self.statements()
        without = self.statements("_ENDS_COLUMNS", ", 0, 0, 0")
        self.assertEqual(2, len(without), without)
        self.assertEqual(len(without), len(with_tree), "the tree adds no statement")
        steps = self.plan(with_tree[1])
        for step in self.plan(without[1]):
            steps.remove(step)
        self.assertEqual(3, steps.count("SCALAR SUBQUERY"), steps)
        read = [found.groups() for step in steps if (found := _READ.match(step))]
        self.assertEqual(
            {"work_item_events", "work_item_comments", "execution_events"},
            {table for _way, _word, table in read},
            steps,
        )
        self.assertEqual(
            ["SEARCH"] * 3, [way for way, _word, _table in read], "each by a search, no scan"
        )
        self.assertEqual(6, len(steps), "and nothing else")

    def test_a_hundred_new_comments_are_read_in_statements_that_do_not_grow_with_them(
        self,
    ) -> None:
        self.collect()
        self.assertFalse(self.collect(), "everything is read")
        before = self.marks()
        self.comment([self.stages[1]] * STAGES)
        one = self.statements()
        self.comment(self.stages)
        every = self.statements()
        self.assertEqual(
            len(one),
            len(every),
            f"{STAGES} comments on one stage, then one on each of the {STAGES}: no more statements",
        )
        written = [self.stages[n % STAGES] for n in range(48)] + self.tasks[1::5]
        self.assertEqual(100, len(written))
        self.comment(written)
        self.assertEqual(before, self.marks(), "the hook has not read them yet")
        told = self.collect(take=False)
        self.assertEqual(
            STAGES, len(told), "the comments on its stages, the ones on tasks being no news"
        )
        self.assertEqual(before, self.marks(), "and a read that does not take moves nothing")
        without = self.statements("_tree_moved", lambda *_: False)
        self.assertEqual(2, len(without), "the hook's own two reads")
        first = self.statements()
        self.assertLess(len(without), len(first), "the tree's news is read")

        others = (self.tasks[2::5] + self.tasks[3::5])[:100]
        self.assertFalse(set(others) & set(written), "100 items not written on yet")
        self.comment(others)
        again = self.statements()
        self.assertEqual(
            len(first), len(again), "twice the rows on 100 more items, no more statements"
        )

    def test_the_climb_reads_a_level_once_whatever_order_its_rows_come_in(self) -> None:
        """A task and its stage asked about together are one level, and the goal over
        them the next: the stage is not read again when the task's row came first."""

        identities = {
            f"MAIN-{row[1]}": str(row[0])
            for row in self.conn.execute("SELECT work_item_id, number FROM work_items")
        }
        task, stage = identities[self.tasks[TASKS + 1]], identities[self.stages[1]]
        for children_first in (True, False):
            with self.subTest(children_first=children_first):
                conn = notify._connect(self.path)
                assert conn is not None
                self.addCleanup(conn.close)
                ordered = _Ordered(conn, children_first)
                tree = notify._Tree(ordered, A)  # type: ignore[arg-type]
                self.assertTrue(tree.watches(), "the session works on the goal")
                tree.climb({task, stage})
                self.assertEqual([2, 1], ordered.levels, "the task and its stage, then the goal")
                chain = [item for item, _node in tree.chain(task)]
                self.assertEqual([task, stage], chain[:2])
                self.assertEqual(3, len(chain), "and the goal over them")


class _Ordered:
    """A connection whose reads of items answer children first, or parents first, and
    keep how many items each read asked for; any other statement is the connection's own."""

    def __init__(self, conn: sqlite3.Connection, children_first: bool) -> None:
        self.conn = conn
        self.children_first = children_first
        self.levels: list[int] = []

    def execute(self, statement: str, parameters: Sequence[Any] = ()) -> Any:
        if not statement.startswith(notify._NODES.split("{", 1)[0]):
            return self.conn.execute(statement, parameters)
        self.levels.append(len(parameters))
        rows = self.conn.execute(statement, parameters).fetchall()
        # The third column says whether the item is a goal or a stage.
        rows.sort(key=lambda row: bool(row[2]), reverse=not self.children_first)
        return iter(rows)


if __name__ == "__main__":
    unittest.main()
