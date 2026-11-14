"""The step runner a migration is written in: needed, run, check, then postconditions.

The steps here write one table of an in-memory database, so what a run leaves, and
what a rollback after it leaves, is read straight back.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import store_steps
from server.store_steps import Context, Postcondition, Step, UnmetError


def _add(value: str) -> Step:
    def run(conn: sqlite3.Connection, context: Context) -> dict[str, int]:
        conn.execute("INSERT INTO rows(value) VALUES(?)", (value,))
        context.memo.setdefault("added", []).append(value)
        return {"added": 1}

    def needed(conn: sqlite3.Connection, _context: Context) -> bool:
        return conn.execute("SELECT 1 FROM rows WHERE value = ?", (value,)).fetchone() is None

    def check(conn: sqlite3.Connection, _context: Context) -> None:
        if conn.execute("SELECT 1 FROM rows WHERE value = ?", (value,)).fetchone() is None:
            raise UnmetError(f"{value} is missing")

    return Step(f"add-{value}", f"add {value}", run, needed, check)


def _unmet(_conn: sqlite3.Connection, _context: Context) -> None:
    raise UnmetError("two rows were expected")


def _broken(_conn: sqlite3.Connection, _context: Context) -> None:
    raise KeyError("column")


def _counted(conn: sqlite3.Connection, _context: Context) -> dict[str, int]:
    return {"rows": int(conn.execute("SELECT COUNT(*) FROM rows").fetchone()[0])}


class RunTests(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = sqlite3.connect(":memory:", isolation_level=None)
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE rows(value TEXT)")
        self.conn.execute("INSERT INTO rows(value) VALUES('kept')")
        self.report = store_steps.new_report("trial")
        self.context = Context(now="2026-11-14T00:00:00Z")

    def run_steps(
        self, steps: tuple[Step, ...], postconditions: tuple[Postcondition, ...] = ()
    ) -> None:
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            store_steps.run(
                self.conn,
                steps=steps,
                postconditions=postconditions,
                context=self.context,
                report=self.report,
                schema=5,
            )
        except store_steps.RunFailedError:
            self.conn.execute("ROLLBACK")
            raise
        self.conn.execute("COMMIT")

    def rows(self) -> list[str]:
        return [row[0] for row in self.conn.execute("SELECT value FROM rows ORDER BY rowid")]

    def version(self) -> int:
        return int(self.conn.execute("PRAGMA user_version").fetchone()[0])

    def test_a_run_records_each_step_stamps_the_schema_and_checks_every_postcondition(self) -> None:
        steps = (_add("a"), _add("kept"), _add("b"))
        self.run_steps(steps, (Postcondition("first", "counted", _counted),))
        self.assertEqual(["kept", "a", "b"], self.rows())
        self.assertEqual(5, self.version())
        self.assertEqual(["a", "b"], self.context.memo["added"])
        self.assertEqual(steps, self.context.steps)
        self.assertEqual(5, self.context.schema)
        self.assertEqual(
            [
                ("add-a", True, {"added": 1}),
                ("add-kept", False, None),
                ("add-b", True, {"added": 1}),
            ],
            [(step["name"], step["needed"], step.get("result")) for step in self.report["steps"]],
        )
        self.assertEqual(
            [{"name": "first", "title": "counted", "passed": True, "detail": {"rows": 3}}],
            [
                {key: value for key, value in entry.items() if key != "seconds"}
                for entry in self.report["postconditions"]
            ],
        )
        self.assertNotIn("failed", self.report)
        json.dumps(self.report)

    def test_a_step_that_raises_stops_the_run_and_its_writes_roll_back(self) -> None:
        with self.assertRaises(store_steps.RunFailedError) as raised:
            self.run_steps(
                (_add("a"), Step("broken", "breaks", _broken), _add("b")),
                (Postcondition("first", "counted", _counted),),
            )
        self.assertIs(self.report, raised.exception.report)
        self.assertEqual(["broken"], self.report["failed"])
        self.assertEqual(["add-a", "broken"], [step["name"] for step in self.report["steps"]])
        self.assertEqual("KeyError: 'column'", self.report["steps"][-1]["error"])
        self.assertGreaterEqual(self.report["steps"][-1]["seconds"], 0)
        self.assertEqual([], self.report["postconditions"])
        self.assertEqual((["kept"], 0), (self.rows(), self.version()))

    def test_a_check_that_does_not_hold_fails_its_step(self) -> None:
        def skipped(_conn: sqlite3.Connection, _context: Context) -> bool:
            return False

        step = Step("missing", "never runs", _broken, needed=skipped, check=_unmet)
        with self.assertRaises(store_steps.RunFailedError):
            self.run_steps((step,))
        self.assertEqual(
            {"needed": False, "error": "UnmetError: two rows were expected"},
            {key: self.report["steps"][0][key] for key in ("needed", "error")},
        )

    def test_every_postcondition_is_checked_after_one_fails_and_the_store_rolls_back(self) -> None:
        postconditions = (
            Postcondition("first", "unmet", _unmet),
            Postcondition("second", "counted", _counted),
            Postcondition("third", "broken", _broken),
        )
        with self.assertRaises(store_steps.RunFailedError) as raised:
            self.run_steps((_add("a"),), postconditions)
        self.assertEqual(["first", "third"], self.report["failed"])
        self.assertIn("first, third", str(raised.exception))
        self.assertEqual(
            [
                ("first", False, "two rows were expected"),
                ("second", True, None),
                ("third", False, "KeyError: 'column'"),
            ],
            [
                (entry["name"], entry["passed"], entry.get("error"))
                for entry in self.report["postconditions"]
            ],
        )
        self.assertEqual((["kept"], 0), (self.rows(), self.version()))

    def test_a_phase_is_timed_even_when_it_raises(self) -> None:
        with self.assertRaises(ValueError), store_steps.phase(self.report, "copy"):
            raise ValueError("no room")
        self.assertEqual(["copy"], [entry["name"] for entry in self.report["phases"]])
        self.assertGreaterEqual(self.report["phases"][0]["seconds"], 0)


if __name__ == "__main__":
    unittest.main()
