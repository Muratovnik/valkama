"""The bring-up `store.connect()` runs: a transaction that may change the schema.

A table rebuilt there drops its old copy, and while foreign keys are enforced that
drop deletes its rows and cascades into every table that references them. The
cases lay down a store at this build's schema with a row in such a table, widen
what the event table must hold, and look at the row after the next open.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
import tempfile
import unittest
from collections.abc import Callable, Iterator
from unittest import mock

from server import store
from server.planning import calls, decisions, model, service
from server.planning import store as planning_store

AGENT = calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-a")
#: An event action no build declares: added to `model.EVENT_ACTIONS` inside a case, it
#: is one the stored CHECK of `work_item_events` lacks, so the next open rebuilds it.
WIDENED = "widened_for_test"


class Harness(unittest.TestCase):
    """A store at this build's schema with one decision mark on one event."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        conn = store.connect()
        try:
            service.create_planning_space(conn, name="Alpha", key="ALPHA")
            conn.commit()
            with calls.bind(AGENT, "create_work_item"):
                created = service.create_work_item(conn, space="ALPHA", title="One table")
            conn.commit()
            cursor = conn.execute(
                "INSERT INTO work_item_events(work_item_id, action, detail, author, created_at,"
                " call_id) SELECT work_item_id, 'accepted', '', 'claude', created_at, call_id"
                " FROM work_item_events WHERE work_item_id = ? AND action = 'created'",
                (created["work_item_id"],),
            )
            self.event = int(cursor.lastrowid or 0)
            decisions.mark(conn, self.event, "proposed_goal", "accepted the goal")
            conn.commit()
        finally:
            conn.close()
        self.mark = (self.event, "proposed_goal", "accepted the goal")

    def marks(self, conn: sqlite3.Connection) -> list[tuple]:
        return [tuple(row) for row in conn.execute("SELECT * FROM agent_decisions")]

    def events_definition(self, conn: sqlite3.Connection) -> str:
        return str(
            conn.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'work_item_events'"
            ).fetchone()[0]
        )


def widened() -> contextlib.ExitStack:
    """`model.EVENT_ACTIONS` with one action more, and the CHECK text built from it."""

    actions = (*model.EVENT_ACTIONS, WIDENED)
    stack = contextlib.ExitStack()
    stack.enter_context(mock.patch.object(model, "EVENT_ACTIONS", actions))
    stack.enter_context(
        mock.patch.object(
            planning_store, "_EVENT_ACTION_SQL", ",".join(f"'{action}'" for action in actions)
        )
    )
    return stack


class WidenedEventsTests(Harness):
    def test_rebuilding_the_event_table_keeps_the_marks_on_its_events(self) -> None:
        with widened():
            conn = store.connect()
        self.addCleanup(conn.close)
        # The open did rebuild the table: its CHECK now holds the widened action.
        self.assertIn(f"'{WIDENED}'", self.events_definition(conn))
        self.assertEqual([self.mark], self.marks(conn))


@contextlib.contextmanager
def traced() -> Iterator[list[str]]:
    """Every statement the connections opened inside run, in order."""

    statements: list[str] = []
    real = sqlite3.connect

    def connect(*args: object, **kwargs: object) -> sqlite3.Connection:
        conn = real(*args, **kwargs)  # type: ignore[arg-type]
        conn.set_trace_callback(statements.append)
        return conn

    with mock.patch.object(sqlite3, "connect", connect):
        yield statements


@contextlib.contextmanager
def after_threads(step: Callable[[sqlite3.Connection], None]) -> Iterator[None]:
    """The bring-up with `step` run on its connection right after its thread step."""

    real = planning_store.migrate_threads

    def migrate_threads(conn: sqlite3.Connection) -> None:
        real(conn)
        step(conn)

    with mock.patch.object(planning_store, "migrate_threads", migrate_threads):
        yield


class ProcedureTests(Harness):
    def test_the_bring_up_runs_with_foreign_keys_off_and_returns_them_on(self) -> None:
        for case, widening in (("writes", widened), ("writes nothing", contextlib.ExitStack)):
            with self.subTest(case):
                seen: list[int] = []

                def look(conn: sqlite3.Connection, seen: list[int] = seen) -> None:
                    seen.append(conn.execute("PRAGMA foreign_keys").fetchone()[0])

                with widening(), after_threads(look):
                    conn = store.connect()
                try:
                    self.assertEqual([0], seen)
                    self.assertEqual(1, conn.execute("PRAGMA foreign_keys").fetchone()[0])
                finally:
                    conn.close()

    def test_a_bring_up_that_leaves_a_dangling_reference_is_refused_and_rolled_back(
        self,
    ) -> None:
        missing = self.event + 1000

        def dangle(conn: sqlite3.Connection) -> None:
            conn.execute(
                "INSERT INTO agent_decisions(event_id, point, what) VALUES(?, 'proposed_goal', 'x')",
                (missing,),
            )

        with (
            widened(),
            after_threads(dangle),
            self.assertRaises(store.DanglingReferenceError) as caught,
        ):
            store.connect()
        self.assertEqual(["agent_decisions"], caught.exception.tables)
        self.assertIn("agent_decisions", str(caught.exception))
        # Nothing of the open stands: neither the row nor the rebuilt table.
        conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        try:
            self.assertEqual([self.mark], self.marks(conn))
            self.assertNotIn(f"'{WIDENED}'", self.events_definition(conn))
        finally:
            conn.close()

    def test_only_an_open_that_writes_checks_the_foreign_keys(self) -> None:
        for case, widening, checks in (
            ("writes nothing", contextlib.ExitStack, 0),
            ("writes", widened, 1),
        ):
            with self.subTest(case), widening(), traced() as statements:
                store.connect().close()
            checked = [sql for sql in statements if "foreign_key_check" in sql.lower()]
            self.assertEqual(checks, len(checked), checked)

    def test_a_failed_schema_change_rolls_back_and_turns_foreign_keys_on(self) -> None:
        conn = sqlite3.connect(":memory:", isolation_level=None)
        self.addCleanup(conn.close)
        conn.execute("PRAGMA foreign_keys=ON")
        with self.assertRaisesRegex(RuntimeError, "step failed"), store.schema_change(conn):
            conn.execute("CREATE TABLE written (x)")
            raise RuntimeError("step failed")
        self.assertFalse(conn.in_transaction)
        self.assertEqual(1, conn.execute("PRAGMA foreign_keys").fetchone()[0])
        tables = conn.execute("SELECT name FROM sqlite_master WHERE name = 'written'").fetchall()
        self.assertEqual([], tables)

    def test_widening_on_a_connection_with_foreign_keys_on_is_refused(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        with widened(), self.assertRaises(RuntimeError) as caught:
            planning_store.widen_event_actions(conn)
        self.assertIn("agent_decisions", str(caught.exception))
        conn.rollback()
        self.assertEqual([self.mark], self.marks(conn))
        self.assertNotIn(f"'{WIDENED}'", self.events_definition(conn))


#: A parent whose CHECK the rebuild widens, and a child that cascades from it.
PARENT = "CREATE TABLE parent(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('a')))"
CHILD = "CREATE TABLE child(parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE)"
WIDER_PARENT = (
    f"CREATE TABLE parent{planning_store.REPLACEMENT}"
    "(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('a','b')))"
)


class RebuildGuardTests(unittest.TestCase):
    def store(self, *, keys: bool, child: bool) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:", isolation_level=None)
        self.addCleanup(conn.close)
        conn.execute(f"PRAGMA foreign_keys={'ON' if keys else 'OFF'}")
        conn.execute(PARENT)
        conn.execute("CREATE INDEX parent_kind ON parent(kind)")
        conn.execute("INSERT INTO parent(id, kind) VALUES(1, 'a')")
        if child:
            conn.execute(CHILD)
            conn.execute("INSERT INTO child(parent_id) VALUES(1)")
        return conn

    def rebuild(self, conn: sqlite3.Connection) -> list[str]:
        return planning_store.rebuild_table(conn, "parent", WIDER_PARENT, "SELECT * FROM parent")

    def definition(self, conn: sqlite3.Connection) -> str:
        return str(
            conn.execute("SELECT sql FROM sqlite_master WHERE name = 'parent'").fetchone()[0]
        )

    def test_a_referenced_table_is_refused_while_foreign_keys_are_on(self) -> None:
        conn = self.store(keys=True, child=True)
        catalog = conn.execute("SELECT type, name, sql FROM sqlite_master").fetchall()
        changes = conn.total_changes
        with self.assertRaises(RuntimeError) as caught:
            self.rebuild(conn)
        self.assertIn("rebuilding parent with foreign keys on", str(caught.exception))
        self.assertIn("child", str(caught.exception))
        # Refused before its first statement: the catalog and every row as they were.
        self.assertEqual(
            catalog, conn.execute("SELECT type, name, sql FROM sqlite_master").fetchall()
        )
        self.assertEqual(changes, conn.total_changes)
        self.assertEqual([(1,)], conn.execute("SELECT parent_id FROM child").fetchall())

    def test_a_referenced_table_is_rebuilt_with_foreign_keys_off(self) -> None:
        conn = self.store(keys=False, child=True)
        self.assertEqual(["parent_kind"], self.rebuild(conn))
        self.assertIn("'b'", self.definition(conn))
        self.assertEqual([(1, "a")], conn.execute("SELECT * FROM parent").fetchall())
        self.assertEqual([(1,)], conn.execute("SELECT parent_id FROM child").fetchall())

    def test_a_table_nothing_references_is_rebuilt_with_foreign_keys_on(self) -> None:
        conn = self.store(keys=True, child=False)
        self.assertEqual(["parent_kind"], self.rebuild(conn))
        self.assertIn("'b'", self.definition(conn))
        self.assertEqual([(1, "a")], conn.execute("SELECT * FROM parent").fetchall())


if __name__ == "__main__":
    unittest.main()
