"""What the tree's news adds to an orchestrator's hook, measured inside the process.

The bound is the time the tree's news adds to `notify.collect`, not the time of the
hook's process, whose own spread is wider than what is measured here. The tree is
one goal of 13 stages with 20 tasks each, 274 items; the orchestrator holds one task
in it, so every item is in its tree. Each figure is the median of 200 runs, the run
with the tree's news and the run without it taken in turns, so a slower stretch of
the machine weighs on both alike.

- With nothing new anywhere, the hook still answers from its two reads: the tree adds
  three columns to the second, where each source ends, and at most 0.5 ms.
- With 100 comments another session wrote across the tree since the hook last read
  it, 200 rows in two sources, the tree's news is read, climbed to its roots and
  sorted in at most 2 ms more than the same hook that answers from its two reads.
"""

from __future__ import annotations

import os
import statistics
import tempfile
import time
import unittest
from unittest import mock

from server import mcp_surface, store
from server.hooks import notify
from server.planning import calls, service

A = "0a000000-0000-4000-8000-00000000000a"
B = "0b000000-0000-4000-8000-00000000000b"
RUNS = 200
STAGES = 13
TASKS = 20


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
        service.create_planning_space(conn, project_id="p", name="Crew", key="MAIN")
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
        cls.state = os.path.join(os.path.dirname(cls.path), notify.STATE_DIRECTORY)
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

    def added(self, run, name: str, replacement: object) -> float:
        """What `run` takes with the tree less what it takes with `notify.<name>` replaced,
        median against median, in milliseconds. The replacement is made and undone
        outside the timed part, so neither side pays for it."""

        conn = notify._connect(self.path)
        assert conn is not None
        self.addCleanup(conn.close)
        original = getattr(notify, name)
        with_tree: list[int] = []
        without: list[int] = []
        for _run in range(RUNS):
            for runs, value in ((with_tree, original), (without, replacement)):
                setattr(notify, name, value)
                try:
                    started = time.perf_counter_ns()
                    run(conn, tree=value is original)
                    runs.append(time.perf_counter_ns() - started)
                finally:
                    setattr(notify, name, original)
        return (statistics.median(with_tree) - statistics.median(without)) / 1e6

    def marks(self) -> bytes:
        with open(os.path.join(self.state, A + ".marks"), "rb") as handle:
            return handle.read()

    def test_nothing_new_adds_at_most_half_a_millisecond(self) -> None:
        self.collect()
        self.assertFalse(self.collect(), "everything is read")
        self.assertIn(b"\n@tree ", self.marks())

        def run(conn, *, tree: bool) -> None:
            del tree  # nothing is new with the tree or without it
            assert not notify.collect(conn, self.state, A, None)

        added = self.added(run, "_ENDS_COLUMNS", ", 0, 0, 0")
        self.assertLessEqual(added, 0.5, f"{added:.3f} ms")

    def test_a_hundred_new_comments_add_at_most_two_milliseconds(self) -> None:
        self.collect()
        self.assertFalse(self.collect(), "everything is read")
        before = self.marks()
        written = [self.stages[n % STAGES] for n in range(48)] + self.tasks[1::5]
        self.assertEqual(100, len(written))
        for number, ref in enumerate(written):
            self.call(
                "apply_work_item_changes",
                {"sessionId": B},
                id=ref,
                comment={"body": f"Note {number} under the goal"},
            )
        self.assertEqual(before, self.marks(), "the hook has not read them yet")
        told = self.collect(take=False)
        self.assertEqual(
            STAGES, len(told), "the comments on its stages, the ones on tasks being no news"
        )
        self.assertEqual(before, self.marks(), "and a read that does not take moves nothing")

        def run(conn, *, tree: bool) -> None:
            told = notify.collect(conn, self.state, A, None, take=False)
            assert bool(told) is tree

        added = self.added(run, "_tree_moved", lambda *_: False)
        self.assertLessEqual(added, 2.0, f"{added:.3f} ms")


if __name__ == "__main__":
    unittest.main()
