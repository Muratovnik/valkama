"""A person's words on a goal or stage that nobody works on wait for the next session to take work there.

A person acts through the HTTP boundary bound as the browser binds it, and builds
the tree that way, which subscribes nobody. Agents act through
`mcp_surface.call_tool` under a session their client proved, `threadId` naming a
subagent, and each call is committed as the surface commits it. A session goes
quiet by its `last_seen`, as a lease reads it.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from unittest import mock

from server import mcp_surface, sessions, store
from server.planning import api, calls, leases, model, person_events, service, sweep, waiting

B = "b0000000-0000-4000-8000-00000000000b"
E = "e0000000-0000-4000-8000-00000000000e"
F = "f0000000-0000-4000-8000-00000000000f"
N = "90000000-0000-4000-8000-000000000009"
E1 = "e1"
SAID = "Use the other library for the whole goal"


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = str(service.create_planning_space(self.conn, name="Crew")["key"])
        self.conn.commit()

    def person(self, path: str, **payload: object) -> dict:
        """One write as the browser surface binds and commits it."""

        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def item(self, title: str, kind: str = "task", parent: str | None = None) -> str:
        payload: dict[str, object] = {"space": self.space, "title": title, "kind": kind}
        if parent is not None:
            payload["parent"] = parent
        return str(self.person("/api/planning/work-items", **payload)["reference"])

    def says(self, reference: str, body: str = SAID) -> int:
        """A person's comment, and the call it came in."""

        self.person("/api/planning/work-item/comment", id=reference, body=body)
        return int(
            self.conn.execute(
                "SELECT MAX(id) FROM execution_events WHERE identity_source = ?", (calls.BROWSER,)
            ).fetchone()[0]
        )

    def agent(self, tool: str, session: str, agent: str | None = None, **arguments: object) -> dict:
        meta = {"sessionId": session, **({"threadId": agent} if agent else {})}
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def refused(self, tool: str, session: str, **arguments: object) -> None:
        with self.assertRaises((model.PlanningError, api.PlanningHttpError)):
            mcp_surface.call_tool(self.conn, tool, arguments, meta={"sessionId": session})
        self.conn.rollback()

    def rows(self, reference: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT n.* FROM work_item_waiting_notices n JOIN work_items i USING (work_item_id)"
            " WHERE i.number = ? ORDER BY n.notice_id",
            (int(reference.rsplit("-", 1)[1]),),
        ).fetchall()

    def call(self, call_id: int) -> sqlite3.Row:
        return self.conn.execute(
            "SELECT identity_source, tool, session_id, agent_id FROM execution_events WHERE id = ?",
            (call_id,),
        ).fetchone()

    def quiet(self, session: str) -> None:
        """The session last seen past its lease: nobody is behind its work any more."""

        self.conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = ?",
            (
                (leases.utc_now() - leases.QUIET_PERIOD).strftime("%Y-%m-%dT%H:%M:%SZ"),
                session,
            ),
        )
        self.conn.commit()


class LeftByAPersonTests(Harness):
    """G2 with T4 and T5 under it, and nobody working under G2."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.item("goal nobody works on", "goal")
        self.t4 = self.item("T4", parent=self.goal)
        self.t5 = self.item("T5", parent=self.goal)

    def test_a_person_on_a_goal_nobody_works_on_reaches_the_next_claim_under_it(self) -> None:
        """A subagent takes the words in its claim; the next claim under the goal gets none."""

        said = self.says(self.goal)
        [row] = self.rows(self.goal)
        self.assertEqual(
            ("tree", said, said, None),
            (row["scope"], row["from_call"], row["created_call"], row["delivered_call"]),
            "the person's own call left it, and it waits open",
        )
        claimed = self.agent("claim_work_item", E, E1, id=self.t4)
        [left] = claimed["waiting"]
        self.assertEqual(
            {"reference": self.goal, "title": "goal nobody works on"},
            {key: left[key] for key in ("reference", "title")},
        )
        [comment] = left["said"]
        self.assertEqual(
            ("comment", "interface", SAID), (comment["kind"], comment["via"], comment["text"])
        )
        self.assertNotIn("cut", comment, "a whole text carries no cut key")
        self.assertNotIn("from_person", claimed, "nothing was said on the task itself")
        [row] = self.rows(self.goal)
        claim_call = self.call(row["delivered_call"])
        self.assertEqual(
            (E, E1, E, E1),
            (
                row["delivered_session"],
                row["delivered_agent"],
                claim_call["session_id"],
                claim_call["agent_id"],
            ),
            "delivered to the subagent's session in the claim's own call",
        )
        self.assertIsNotNone(row["delivered_at"])
        again = self.agent("claim_work_item", F, id=self.t5)
        self.assertNotIn("waiting", again, "the words were taken once")

    def test_a_person_acting_again_keeps_one_row_read_from_the_first_act(self) -> None:
        first = self.says(self.goal, "First")
        self.person(
            "/api/planning/work-item/update", id=self.goal, description="Second, as an edit"
        )
        [row] = self.rows(self.goal)
        self.assertEqual(first, row["from_call"])
        [left] = self.agent("claim_work_item", E, id=self.t4)["waiting"]
        self.assertEqual(["comment", "edited"], [entry["kind"] for entry in left["said"]])

    def test_an_edit_alone_is_words_too_and_a_new_goal_is_not(self) -> None:
        self.assertEqual([], self.rows(self.goal), "filing a goal tells nobody anything")
        self.person("/api/planning/work-item/update", id=self.goal, title="goal, renamed")
        self.assertEqual(1, len(self.rows(self.goal)))

    def test_a_person_on_a_task_leaves_nothing_here(self) -> None:
        """A task tells its next writer through from_person; no row is needed."""

        self.says(self.t4)
        self.assertEqual(
            [], self.conn.execute("SELECT * FROM work_item_waiting_notices").fetchall()
        )

    def test_a_person_on_a_goal_someone_works_on_leaves_nothing(self) -> None:
        self.agent("claim_work_item", B, id=self.t4)
        self.says(self.goal)
        self.assertEqual([], self.rows(self.goal), "B works under the goal and hears it")

    def test_a_claim_rolled_back_leaves_the_words_open(self) -> None:
        self.says(self.goal)
        revision = int(service.get_work_item(self.conn, self.t4)["revision"])
        self.refused("claim_work_item", E, id=self.t4, expected_revision=revision + 1)
        self.refused(
            "apply_work_item_changes",
            E,
            id=self.t4,
            claim=True,
            transition={"state": "no-such-state"},
        )
        [row] = self.rows(self.goal)
        self.assertIsNone(row["delivered_call"], "a refused claim took nothing")
        self.assertIn("waiting", self.agent("apply_work_item_changes", E, id=self.t4, claim=True))
        [row] = self.rows(self.goal)
        self.assertEqual(E, row["delivered_session"])

    def test_a_step_claim_takes_them_and_the_interface_and_an_unproved_call_do_not(self) -> None:
        self.says(self.goal)
        with calls.bind(calls.browser(), "/api/planning/work-item/claim"):
            api.handle_post(self.conn, "/api/planning/work-item/claim", {"id": self.t4})
        unproved = calls.Identity(state=calls.UNCONFIRMED, source=calls.MCP)
        with calls.bind(unproved, "claim_work_item"):
            service.claim_work_item(self.conn, self.t5, author="someone")
        self.conn.commit()
        self.assertIsNone(self.rows(self.goal)[0]["delivered_call"])
        self.agent("apply_work_item_changes", E, id=self.t4, checklist=["one step"])
        [step] = service.get_work_item(self.conn, self.t4)["checklist"]
        claimed = self.agent(
            "claim_work_item_checklist_item", E, E1, id=self.t4, item_id=step["id"]
        )
        self.assertEqual([self.goal], [left["reference"] for left in claimed["waiting"]])

    def test_the_http_answer_of_a_claim_carries_no_words(self) -> None:
        self.says(self.goal)
        agent = calls.Identity(state=calls.CONFIRMED, source=calls.CODEX_META, session_id=E)
        with calls.bind(agent, "claim_work_item"):
            answer = api.handle_post(self.conn, "/api/planning/work-item/claim", {"id": self.t4})
        self.conn.commit()
        assert answer is not None
        self.assertNotIn("waiting", answer[1])
        self.assertEqual(E, self.rows(self.goal)[0]["delivered_session"])

    def test_words_left_for_the_space_reach_a_claim_anywhere_in_it(self) -> None:
        elsewhere = self.item("a task under no goal")
        with calls.bind(calls.valkama(), "test-writer"):
            self.assertTrue(waiting.leave(self.conn, self.goal_id(), waiting.SPACE))
            with self.assertRaises(model.PlanningError):
                waiting.leave(self.conn, self.goal_id(), "other")
        self.conn.commit()
        [row] = self.rows(self.goal)
        self.assertEqual(("valkama", "test-writer"), tuple(self.call(row["created_call"]))[:2])
        claimed = self.agent("claim_work_item", E, id=elsewhere)
        [left] = claimed["waiting"]
        self.assertEqual((self.goal, []), (left["reference"], left["said"]))

    def test_the_words_go_with_their_goal(self) -> None:
        empty = self.item("a goal with nothing under it", "goal")
        self.says(empty)
        self.assertEqual(1, len(self.rows(empty)))
        self.person("/api/planning/work-item/delete", id=empty)
        self.assertEqual(
            [], self.conn.execute("SELECT * FROM work_item_waiting_notices").fetchall()
        )

    def goal_id(self) -> str:
        return str(service.get_work_item(self.conn, self.goal)["work_item_id"])


class LapsedParticipantTests(Harness):
    """A goal with one task under it, which B holds, and nobody else working under the goal."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.item("G3", "goal")
        self.t7 = self.item("T7", parent=self.goal)
        self.agent("claim_work_item", B, id=self.t7)

    def test_a_participant_gone_unheard_leaves_the_words_waiting(self) -> None:
        said = self.says(self.goal)
        self.assertEqual([], self.rows(self.goal), "B was there to hear it")
        self.quiet(B)
        with self.subTest("the sweep"):
            self.assertEqual(1, service.expire_leases(self.conn))
            self.conn.commit()
            [row] = self.rows(self.goal)
            self.assertEqual(said, row["from_call"], "from the act nobody heard")
            self.assertEqual(
                ("valkama", leases.EXPIRY_TOOL), tuple(self.call(row["created_call"]))[:2]
            )
            [left] = self.agent("claim_work_item", N, id=self.t7)["waiting"]
            self.assertEqual([SAID], [entry["text"] for entry in left["said"]])

    def test_a_claim_by_number_takes_the_words_its_expiry_left_in_one_answer(self) -> None:
        said = self.says(self.goal)
        self.quiet(B)
        claimed = self.agent("claim_work_item", N, id=self.t7)
        [left] = claimed["waiting"]
        self.assertEqual(
            (self.goal, [SAID]), (left["reference"], [e["text"] for e in left["said"]])
        )
        [row] = self.rows(self.goal)
        self.assertEqual(said, row["from_call"])
        self.assertEqual(("valkama", leases.EXPIRY_TOOL), tuple(self.call(row["created_call"]))[:2])
        self.assertEqual(N, self.call(row["delivered_call"])["session_id"])

    def test_what_the_session_heard_before_its_last_call_does_not_wait(self) -> None:
        self.says(self.goal)
        self.agent("apply_work_item_changes", B, id=self.t7, comment={"body": "On it"})
        self.quiet(B)
        self.assertEqual(1, service.expire_leases(self.conn))
        self.conn.commit()
        self.assertEqual([], self.rows(self.goal), "B called after the words, so it heard them")

    def recorded(self) -> int:
        """A record Valkama makes on the goal in a call of its own, as a stage writing for the
        server would, after B's last call; the call it came in."""

        with calls.bind(calls.valkama(), "test-record"):
            service._log(self.conn, self.goal_id(), "opened", "confirm the close", "valkama")
            call = calls.call_id(self.conn, self.goal_id())
        self.conn.commit()
        assert call is not None
        return call

    def goal_id(self) -> str:
        return str(service.get_work_item(self.conn, self.goal)["work_item_id"])

    def test_a_record_of_valkamas_that_asks_waits_as_a_persons_words_do(self) -> None:
        with mock.patch.object(person_events, "SERVER_ASKS", frozenset({"status"})):
            record = self.recorded()
            self.quiet(B)
            self.assertEqual(1, service.expire_leases(self.conn))
            self.conn.commit()
            [row] = self.rows(self.goal)
            self.assertEqual(record, row["from_call"], "from the record nobody heard")
            [left] = self.agent("claim_work_item", N, id=self.t7)["waiting"]
        [said] = left["said"]
        self.assertEqual(("status", "valkama"), (said["kind"], said["via"]))
        self.assertIn("confirm the close", said["text"])

    def test_a_record_of_valkamas_that_asks_for_nobody_leaves_nothing(self) -> None:
        self.recorded()
        self.quiet(B)
        self.assertEqual(1, service.expire_leases(self.conn))
        self.conn.commit()
        self.assertEqual([], self.rows(self.goal), "it wakes nobody, so nobody missed it")

    def test_recovering_twice_leaves_one_row_and_a_delivered_one_counts(self) -> None:
        said = self.says(self.goal)
        self.quiet(B)
        self.assertEqual(1, service.expire_leases(self.conn))
        lapsed = [(B, str(service.get_work_item(self.conn, self.t7)["work_item_id"]))]
        with calls.bind(calls.valkama(), "test-recovery"):
            waiting.recover(self.conn, lapsed)
        self.conn.commit()
        self.assertEqual(1, len(self.rows(self.goal)), "one open row per goal")
        self.agent("claim_work_item", N, id=self.t7)
        self.agent("claim_work_item", N, id=self.t7, release=True)
        with calls.bind(calls.valkama(), "test-recovery"):
            self.assertEqual(0, waiting.recover(self.conn, lapsed))
        self.conn.commit()
        [row] = self.rows(self.goal)
        self.assertEqual((said, N), (row["from_call"], row["delivered_session"]))


class SweepStepTests(Harness):
    """The sweep's `waiting` step: a session that stopped working while what it holds or
    follows still stands leaves the words it missed waiting, in a call of Valkama's."""

    def run_pass(self) -> sweep.Pass:
        done = sweep.run_pass(self.conn)
        self.assertEqual(({}, []), (done.failures, done.busy))
        return done

    def event(self, kind: str, session: str) -> None:
        """A client's hook ending or starting the session, as the hook reports it."""

        sessions.op_ingest_session_event(
            self.conn, {"event": kind, "session_id": session, "client": "codex"}
        )
        self.conn.commit()

    def silent(self, session: str, days: int, now: datetime | None = None) -> None:
        seen = (now or leases.utc_now()) - timedelta(days=days)
        self.conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = ?",
            (seen.strftime("%Y-%m-%dT%H:%M:%SZ"), session),
        )
        self.conn.commit()

    def follow(self, reference: str, session: str) -> None:
        self.agent("apply_work_item_changes", session, id=reference, subscribe=True)

    def all_rows(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT * FROM work_item_waiting_notices ORDER BY notice_id"
            ).fetchall()
        ]

    def test_an_ended_holder_and_a_silent_follower_leave_the_words_after_a_pass(self) -> None:
        """O17: B ended while its claim of T7 under G3 waits out its grace, and F, following
        G4, went silent past the lease while its subscription stands; a person spoke on
        both goals while each was still heard."""

        g3 = self.item("G3", "goal")
        t7 = self.item("T7", parent=g3)
        g4 = self.item("G4", "goal")
        self.agent("claim_work_item", B, id=t7)
        self.follow(g4, F)
        said = {g3: self.says(g3), g4: self.says(g4, "Keep the old format on G4")}
        self.assertEqual(([], []), (self.rows(g3), self.rows(g4)), "B and F were there")
        self.event("session_end", B)
        self.silent(F, days=4)

        self.assertEqual({sweep.WAITING: 2}, self.run_pass().changed)
        [left3], [left4] = self.rows(g3), self.rows(g4)
        self.assertEqual((said[g3], said[g4]), (left3["from_call"], left4["from_call"]))
        self.assertEqual(left3["created_call"], left4["created_call"], "one call of the step")
        self.assertEqual(
            ("valkama", waiting.RECOVERY_TOOL, None),
            tuple(self.call(left3["created_call"]))[:3],
        )
        held = service.get_work_item(self.conn, t7)["claim_ref"]
        self.assertEqual(f"codex (session {B})", held, "B's claim still stands")
        followers = service.get_work_item(self.conn, g4)["subscribers"]
        self.assertEqual([F], [entry["session"] for entry in followers], "so does F's")

        before = self.all_rows()
        self.assertEqual({}, self.run_pass().changed, "a second pass in a row changes nothing")
        self.assertEqual(before, self.all_rows())
        [taken] = self.agent("claim_work_item", N, id=t7)["waiting"]
        self.assertEqual((g3, [SAID]), (taken["reference"], [e["text"] for e in taken["said"]]))

    def test_a_pass_takes_two_hundred_containers_and_the_next_the_rest(self) -> None:
        """The step reads the time from `leases.utc_now`: by the real clock F is live."""

        goals = [self.item(f"Goal {index}", "goal") for index in range(sweep.LIMIT + 1)]
        for goal in goals:
            self.follow(goal, F)
        for goal in goals:
            self.says(goal)
        self.assertEqual([], self.all_rows(), "F heard every word")
        # A year past the real clock, F last seen four days before it.
        now = datetime.now(UTC).replace(microsecond=0) + timedelta(days=365)
        self.silent(F, days=4, now=now)
        self.assertEqual({}, self.run_pass().changed, "by the real clock F is still live")
        with mock.patch.object(leases, "utc_now", return_value=now):
            self.assertEqual({sweep.WAITING: sweep.LIMIT}, self.run_pass().changed)
            self.assertEqual(sweep.LIMIT, len(self.all_rows()))
            self.assertEqual([], self.rows(goals[-1]), "by number: the last goal is left")
            self.assertEqual({sweep.WAITING: 1}, self.run_pass().changed)
            self.assertEqual({}, self.run_pass().changed)
        waited = {
            int(row[0])
            for row in self.conn.execute(
                "SELECT i.number FROM work_item_waiting_notices n"
                " JOIN work_items i USING (work_item_id)"
            )
        }
        self.assertEqual({int(goal.rsplit("-", 1)[1]) for goal in goals}, waited)

    def test_a_step_with_nothing_to_recover_takes_no_write_lock(self) -> None:
        g3 = self.item("G3", "goal")
        t7 = self.item("T7", parent=g3)
        self.agent("claim_work_item", B, id=t7)
        self.event("session_end", B)
        [step] = [step for step in sweep.STEPS if step.name == sweep.WAITING]
        self.assertFalse(step.pending(self.conn), "B ended, but nothing was said after its call")
        self.conn.execute("PRAGMA busy_timeout = 50")
        other = sqlite3.connect(store.db_path(), isolation_level=None)
        self.addCleanup(other.close)

        other.execute("BEGIN IMMEDIATE")
        try:
            done = sweep.run_pass(self.conn)
        finally:
            other.execute("ROLLBACK")
        self.assertEqual(({}, [], {}), (done.changed, done.busy, done.failures))

        # With words it missed, the step asks for the lock, and waits for the next pass.
        self.event("session_start", B)
        self.says(g3)
        self.event("session_end", B)
        self.assertTrue(step.pending(self.conn))
        other.execute("BEGIN IMMEDIATE")
        try:
            done = sweep.run_pass(self.conn)
        finally:
            other.execute("ROLLBACK")
        self.assertEqual(({}, [sweep.WAITING]), (done.changed, done.busy))
        self.assertEqual({sweep.WAITING: 1}, self.run_pass().changed)


if __name__ == "__main__":
    unittest.main()
