"""The planning sweep: its pass, its step contract, and its thread in both surfaces.

The holds and the clock come from the lease tests' sweep fixture, so a row of the
contract reads the same here as there; what differs is that the release runs
through `sweep.run_pass`, as the start-up pass and the background thread run it,
and not through a tool call. The thread tests run on the fixture's throwaway
store with a pass interval of a tenth of a second: nothing here starts a thread
against another store or opens a listening socket.
"""

from __future__ import annotations

import io
import sqlite3
import sys
import threading
import time
import unittest
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from unittest import mock

from server import housekeeping, http_surface, mcp_surface, store
from server.ops import tray
from server.planning import calls, closing, leases, service, sweep
from tests import test_planning_closing as closing_tests
from tests.test_planning_leases import (
    ONE,
    ONE_UNCONFIRMED,
    SUMMARY,
    THREE,
    TWO,
    SweepTestCase,
    codex,
    held,
)

#: How long a thread test waits for the passes it needs before it fails.
PATIENCE_SECONDS = 15.0


class PassTestCase(SweepTestCase):
    """The lease fixture with the release run as a pass of the sweep."""

    def run_pass(
        self, *, steps: Sequence[sweep.Step] | None = None, deadline: float | None = None
    ) -> sweep.Pass:
        with self.at_now():
            return sweep.run_pass(self.conn, steps=steps, deadline=deadline)

    def calls_of(self, action: str) -> list[tuple[str, str]]:
        """The source and tool of the call behind each event of `action` on the item."""

        return [
            (str(row[0]), str(row[1]))
            for row in self.conn.execute(
                "SELECT c.identity_source, c.tool FROM work_item_events e"
                " JOIN execution_events c ON c.id = e.call_id"
                " JOIN work_items i ON i.work_item_id = e.work_item_id"
                " WHERE i.number = 1 AND e.action = ? ORDER BY e.id",
                (action,),
            )
        ]

    def event_count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0])


class LeaseStepTests(PassTestCase):
    """A lapsed holder's ticks through a pass, and the pass's own promises."""

    def lapse_after_ticks(self) -> None:
        """The item: B ticked step 2 earlier, A holds the item and ticked step 1, then ended."""

        self.tick(codex(TWO), 1)
        self.take(codex(ONE))
        self.tick(codex(ONE), 0)
        self.ended(ONE, timedelta(hours=12, minutes=1))

    def test_a_pass_hands_back_a_lapsed_holders_task_and_its_ticks_wait_for_a_confirmation(
        self,
    ) -> None:
        self.lapse_after_ticks()
        self.assertEqual({sweep.LEASES: 1}, self.run_pass().changed)
        item = self.read()
        self.assertEqual(("", "ready"), (item["claim_ref"], item["state"]["key"]))
        self.assertIsNotNone(item["started_at"])
        [release] = [e for e in item["events"] if e["action"] == "released"]
        self.assertEqual(
            (f"session-ended: {held(ONE)}", "valkama", "valkama"),
            (release["detail"], release["author"], release["identity"]["source"]),
        )
        self.assertEqual([("valkama", leases.EXPIRY_TOOL)], self.calls_of("released"))
        self.assertEqual([True, False, False], self.flags())

        self.take(codex(THREE))
        self.tick(codex(THREE), 2)
        close = {"summary": SUMMARY, "transition": {"state": "completed"}}
        refused = self.write(codex(THREE), **close)
        self.assertIn(ONE_UNCONFIRMED, refused["error"])
        self.assertEqual("dev", self.read()["state"]["key"])
        self.tick(codex(THREE), 0)
        step = self.read()["checklist"][0]
        self.assertEqual((False, held(THREE)), (step["by_previous_holder"], step["done_by"]))
        self.assertNotIn("error", self.write(codex(THREE), **close))
        self.assertEqual("completed", self.read()["state"]["category"])

    def test_a_second_pass_in_a_row_changes_nothing(self) -> None:
        self.lapse_after_ticks()
        self.assertEqual({sweep.LEASES: 1}, self.run_pass().changed)
        written, revision = self.event_count(), self.read()["revision"]
        again = self.run_pass()
        self.assertEqual(({}, [], {}), (again.changed, again.busy, again.failures))
        self.assertEqual((written, revision), (self.event_count(), self.read()["revision"]))

    def test_a_busy_store_skips_the_step_until_the_next_pass(self) -> None:
        self.lapse_after_ticks()
        self.conn.execute("PRAGMA busy_timeout = 50")
        other = sqlite3.connect(store.db_path(), isolation_level=None)
        self.addCleanup(other.close)
        other.execute("BEGIN IMMEDIATE")
        try:
            skipped = self.run_pass()
        finally:
            other.execute("ROLLBACK")
        # Only the step with work asked for the lock; the one without did not.
        self.assertEqual(
            ({}, [sweep.LEASES], {}), (skipped.changed, skipped.busy, skipped.failures)
        )
        self.assertEqual(held(ONE), self.read()["claim_ref"])
        self.assertEqual({sweep.LEASES: 1}, self.run_pass().changed)
        self.assertEqual("", self.read()["claim_ref"])

    def test_a_failing_step_is_rolled_back_and_the_next_step_still_runs(self) -> None:
        self.lapse_after_ticks()

        def broken(conn: sqlite3.Connection) -> int:
            service.set_checklist(conn, self.reference, ["one", "two", "three", "four"])
            raise RuntimeError("broken step")

        done = self.run_pass(steps=(sweep.Step("broken", lambda _conn: True, broken), *sweep.STEPS))
        self.assertEqual(["broken step"], [str(error) for error in done.failures.values()])
        self.assertEqual({sweep.LEASES: 1}, done.changed)
        self.assertEqual(3, len(self.read()["checklist"]))

    def test_a_step_writes_as_valkamas_own_call_under_its_name(self) -> None:
        def retitle(conn: sqlite3.Connection) -> int:
            service.set_checklist(conn, self.reference, ["one", "two", "three", "four"])
            return 1

        done = self.run_pass(steps=(sweep.Step("probe", lambda _conn: True, retitle),))
        self.assertEqual({"probe": 1}, done.changed)
        [event] = [e for e in self.read()["events"] if e["identity"]["source"] == "valkama"]
        self.assertEqual(calls.CONFIRMED, event["identity"]["state"])
        self.assertEqual([("valkama", "probe")], self.calls_of(event["action"]))

    def test_a_step_past_the_deadline_is_left_for_the_next_pass(self) -> None:
        self.lapse_after_ticks()
        done = self.run_pass(deadline=time.monotonic() - 1)
        self.assertEqual(
            ([sweep.LEASES, sweep.WAITING, sweep.SUBSCRIPTIONS, sweep.CONFIRMATIONS], {}),
            (done.left, done.changed),
        )
        self.assertEqual(held(ONE), self.read()["claim_ref"])


class LimitTests(PassTestCase):
    """At most `LIMIT` items a pass, and the time only from `leases.utc_now`."""

    COUNT = sweep.LIMIT + 1

    def setUp(self) -> None:
        super().setUp()
        # A year past the real clock: a step that read it would see every session as
        # last seen in the future, and release nothing.
        self.now = datetime.now(UTC).replace(microsecond=0) + timedelta(days=365)
        self.references = []
        for index in range(self.COUNT):
            reference = service.create_work_item(self.conn, space="LSE", title=f"Held {index}")[
                "reference"
            ]
            session = f"019a3c2e-{index:04x}-7c11-9e0f-2f4b6d8a1c3e"
            identity = calls.Identity(
                state=calls.CONFIRMED, source=calls.CODEX_META, session_id=session, client="codex"
            )
            with calls.bind(identity, "claim_work_item"):
                service.claim_work_item(self.conn, reference, author="codex")
            self.references.append(str(reference))
        self.conn.execute(
            "UPDATE sessions SET last_seen = ?",
            ((self.now - timedelta(days=4)).strftime("%Y-%m-%dT%H:%M:%SZ"),),
        )
        self.conn.commit()

    def held(self) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT number FROM work_items WHERE claim_ref != '' ORDER BY number"
            )
        ]

    def test_two_hundred_a_pass_by_number_then_the_rest_then_nothing(self) -> None:
        # The real clock: nothing has lapsed yet.
        self.assertEqual({}, sweep.run_pass(self.conn).changed)
        self.assertEqual(self.COUNT, len(self.held()))

        self.assertEqual({sweep.LEASES: sweep.LIMIT}, self.run_pass().changed)
        last = self.references[-1].rsplit("-", 1)[1]
        self.assertEqual([last], self.held())
        self.assertEqual({sweep.LEASES: 1}, self.run_pass().changed)
        self.assertEqual([], self.held())
        self.assertEqual({}, self.run_pass().changed)


class ConfirmationsStepTests(closing_tests.Tree):
    """The `confirmations` step held to the step contract, on goals nobody works on."""

    def awaiting_goals(self, count: int) -> list[str]:
        """Goals that each came to wait when a person closed the one task under it."""

        goals = []
        for index in range(count):
            goal = self.made(f"Goal {index}", "goal")
            task = self.made(f"Task {index}", parent=goal)
            self.person(
                closing_tests.APPLY,
                id=task,
                summary=closing_tests.DONE,
                transition={"state": "done"},
            )
            goals.append(goal)
        return goals

    def asked(self) -> list[int]:
        return [
            int(row[0])
            for row in self.conn.execute(
                "SELECT i.number FROM work_item_requests r"
                " JOIN work_items i ON i.work_item_id = r.work_item_id"
                " WHERE r.purpose = 'confirm' ORDER BY i.number"
            )
        ]

    def test_at_most_limit_items_a_pass_then_the_rest_then_nothing(self) -> None:
        goals = self.awaiting_goals(3)
        # Two of them came to wait in a write that went around the marks.
        self.conn.execute(
            "DELETE FROM work_item_confirmations WHERE work_item_id IN (?, ?)",
            (self.identity(goals[0]), self.identity(goals[2])),
        )
        self.conn.commit()
        numbers = [int(goal.rsplit("-", 1)[1]) for goal in goals]
        with mock.patch.object(sweep, "LIMIT", 2):
            self.assertEqual({sweep.CONFIRMATIONS: 2}, sweep.run_pass(self.conn).changed)
            self.assertEqual([numbers[0], numbers[2]], self.asked(), "recorded, then asked")
            self.assertEqual({sweep.CONFIRMATIONS: 1}, sweep.run_pass(self.conn).changed)
            self.assertEqual(numbers, self.asked())
            written = self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
            self.assertEqual({}, sweep.run_pass(self.conn).changed)
            self.assertEqual(
                written, self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
            )
        self.holds()

    def test_its_writes_are_valkamas_own_calls_under_their_names(self) -> None:
        [goal] = self.awaiting_goals(1)
        self.conn.execute("DELETE FROM work_item_confirmations")
        self.conn.commit()
        sweep.run_pass(self.conn)
        [*_before, recorded] = self.events(goal, "awaiting_confirmation")
        [asked] = self.events(goal, "request_created")
        self.assertEqual(
            ("valkama", "valkama", sweep.CONFIRMATIONS), (recorded[1], recorded[3], recorded[4])
        )
        self.assertEqual(
            ("valkama", "valkama", closing.QUESTION_TOOL), (asked[1], asked[3], asked[4])
        )


class _Serving:
    """A stdin with no request that holds the MCP loop open while `wait` runs."""

    def __init__(self, wait: Callable[[], None]) -> None:
        self.buffer = self
        self._wait = wait

    def __iter__(self) -> object:
        self._wait()
        return iter(())


class ThreadTests(PassTestCase):
    """The pass repeats in the MCP loop and in the listener."""

    BROKEN = "planning sweep broken: RuntimeError: broken step"

    def setUp(self) -> None:
        super().setUp()
        self.take(codex(ONE))
        self.attempts = 0
        self.running: list[str] = []
        broken = sweep.Step("broken", lambda _conn: True, self.broken)
        for patch in (
            mock.patch.object(sweep, "STEPS", (broken, *sweep.STEPS)),
            mock.patch.object(housekeeping, "PLANNING_SWEEP_SECONDS", 0.1),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def broken(self, _conn: sqlite3.Connection) -> int:
        self.attempts += 1
        raise RuntimeError("broken step")

    def while_serving(self) -> None:
        """Let the lease lapse under a running process, and wait for its passes to see it."""

        started = self.attempts
        self.ended(ONE, timedelta(hours=12, minutes=1))
        deadline = time.monotonic() + PATIENCE_SECONDS
        while time.monotonic() < deadline:
            claim = self.conn.execute("SELECT claim_ref FROM work_items WHERE number = 1")
            if claim.fetchone()[0] == "" and self.attempts >= started + 3:
                break
            time.sleep(0.05)
        self.running = [thread.name for thread in threading.enumerate() if thread.is_alive()]

    def assert_swept(self, said: str, prefix: str = "") -> None:
        self.assertIn(housekeeping.PLANNING_SWEEP_THREAD, self.running)
        self.assertEqual("", self.read()["claim_ref"])
        self.assertEqual(("released", f"session-ended: {held(ONE)}"), self.by_valkama()[0])
        self.assertEqual([("valkama", leases.EXPIRY_TOOL)], self.calls_of("released"))
        # The start-up pass and the thread's each say it, the thread only once.
        lines = said.splitlines()
        self.assertEqual(1, lines.count(prefix + self.BROKEN), said)
        self.assertEqual(1, lines.count(f"{prefix}start-up maintenance: {self.BROKEN}"), said)
        self.assertNotIn(
            housekeeping.PLANNING_SWEEP_THREAD,
            [thread.name for thread in threading.enumerate() if thread.is_alive()],
        )

    def test_the_mcp_loop_repeats_the_pass(self) -> None:
        stderr = io.StringIO()
        with (
            mock.patch.object(sys, "stdin", _Serving(self.while_serving)),
            mock.patch.object(sys, "stdout", io.StringIO()),
            mock.patch.object(sys, "stderr", stderr),
            mock.patch.object(tray, "start", return_value=None),
        ):
            mcp_surface.mcp_main()
        self.assert_swept(stderr.getvalue(), prefix="valkama: ")

    def test_the_listener_repeats_the_pass(self) -> None:
        # A server that binds nothing: the listener's start-up and loops, with no socket.
        server = mock.Mock(server_port=0)
        server.serve_forever.side_effect = self.while_serving
        stderr = io.StringIO()
        with (
            mock.patch.object(http_surface, "PlatformHTTPServer", return_value=server),
            mock.patch.object(http_surface.watchers, "WATCHERS"),
            mock.patch.object(http_surface.housekeeping, "start_usage"),
            mock.patch.object(http_surface.quota_poll, "Supervisor"),
            mock.patch.object(sys, "stderr", stderr),
        ):
            http_surface.serve_main(0)
        self.assert_swept(stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
