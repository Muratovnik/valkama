"""Who works on a goal or a stage: derived from what sessions hold and follow, live by the lease.

A person builds the tree through the interface, which subscribes nobody; agent
sessions act through bound calls whose session a channel proved, as the MCP
surface binds them. What the card and the HTTP read show is read back through
their own routes.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from unittest import mock

from server import http_surface, mcp_surface, sessions, store
from server.planning import (
    api,
    calls,
    participants,
    read_model,
    service,
    subscriptions,
    views,
)

A = "a0000000-0000-4000-8000-00000000000a"
B = "b0000000-0000-4000-8000-00000000000b"
E = "e0000000-0000-4000-8000-00000000000e"
A1, A2 = "a1", "a2"


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
        self.space = str(
            service.create_planning_space(self.conn, project_id="p", name="Crew")["key"]
        )
        self.conn.commit()

    @contextmanager
    def acting(self, session: str | None, agent: str | None = None) -> Iterator[None]:
        """One call: of that session's agent, of that session, or of the person."""

        identity = (
            calls.browser()
            if session is None
            else calls.Identity(
                state=calls.CONFIRMED,
                source=calls.CLAUDE_PAIR,
                session_id=session,
                agent_id=agent,
                client="claude-code",
            )
        )
        with calls.bind(identity, "test"):
            yield
        self.conn.commit()

    def item(
        self, title: str, kind: str = "task", parent: str | None = None, by: str | None = None
    ) -> str:
        with self.acting(by):
            return str(
                service.create_work_item(
                    self.conn, space=self.space, title=title, kind=kind, parent=parent
                )["reference"]
            )

    def claim(self, ref: str, session: str, agent: str | None = None) -> None:
        with self.acting(session, agent):
            service.claim_work_item(self.conn, ref)

    def follow(self, ref: str, session: str) -> None:
        with self.acting(session):
            subscriptions.subscribe(self.conn, read_model.item_row(self.conn, ref), True)

    def listed(self, ref: str) -> list[dict]:
        return participants.of_container(self.conn, read_model.item_row(self.conn, ref))

    def who(self, ref: str) -> list[str]:
        return [entry["session"] for entry in self.listed(ref)]

    def http(self, ref: str) -> dict:
        answer = api.handle_get(self.conn, "/api/planning/work-item", {"id": [ref]})
        assert answer is not None
        return dict(answer[1]["work_item"])

    def quiet(self, session: str, days: int) -> None:
        self.conn.execute(
            "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now',?) WHERE id = ?",
            (f"-{days} days", session),
        )
        self.conn.commit()


class TreeTests(Harness):
    """Goal G holds stage S1 with T1 and T3 and stage S2 with T2. A holds T3 through a2, B holds T2, E follows S1."""

    def setUp(self) -> None:
        super().setUp()
        self.goal = self.item("oracle goal", "goal")
        self.s1 = self.item("S1", "stage", self.goal)
        self.s2 = self.item("S2", "stage", self.goal)
        self.t1 = self.item("T1", parent=self.s1)
        self.t3 = self.item("T3", parent=self.s1)
        self.t2 = self.item("T2", parent=self.s2)
        self.claim(self.t3, A, A2)
        self.claim(self.t2, B)
        self.follow(self.s1, E)

    def test_a_goal_and_a_stage_name_who_works_under_them_and_a_task_none(self) -> None:
        self.assertEqual([A, B], self.who(self.goal), "E follows only a stage under the goal")
        self.assertEqual([A, E], self.who(self.s1))
        self.assertEqual([B], self.who(self.s2))
        self.assertEqual([], self.listed(self.t3), "a task has a holder, not participants")
        [a, b] = self.listed(self.goal)
        self.assertEqual(
            {
                "session": A,
                "client": "claude-code",
                "label": f"claude (session {A})",
                "holds": [self.t3],
                "follows": False,
            },
            {key: value for key, value in a.items() if key != "last_seen"},
            "a subagent's claim makes its session the participant",
        )
        self.assertRegex(a["last_seen"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(([self.t2], False), (b["holds"], b["follows"]))
        [_, e] = self.listed(self.s1)
        self.assertEqual(([], True), (e["holds"], e["follows"]))

    def test_an_open_step_held_by_a_subagent_counts_and_a_finished_one_does_not(self) -> None:
        with self.acting(None):
            service.set_checklist(self.conn, self.t1, ["one", "two"])
        step = service.get_work_item(self.conn, self.t1)["checklist"][0]["id"]
        with self.acting(A, A1):
            service.claim_checklist_item(self.conn, self.t1, step)
        self.assertEqual([self.t1, self.t3], self.listed(self.goal)[0]["holds"])
        with self.acting(A, A1):
            service.tick_checklist_item(self.conn, self.t1, step)
        self.assertEqual([self.t3], self.listed(self.goal)[0]["holds"])

    def test_the_card_and_the_http_read_carry_them_and_nothing_else_does(self) -> None:
        """O8: the reads that carry participants, and every other that does not."""

        self.assertEqual(
            [A, B], [entry["session"] for entry in self.http(self.goal)["participants"]]
        )
        self.assertEqual([A, E], [entry["session"] for entry in self.http(self.s1)["participants"]])
        self.assertNotIn("participants", self.http(self.t3), "a task has no such field")
        card = http_surface._card_record(self.conn, self.goal)
        self.assertEqual([A, B], [entry["session"] for entry in card["participants"]])
        read = mcp_surface.run_tool_call(
            self.conn, "get_work_item", {"id": self.goal}, meta={"sessionId": E}
        )
        assert isinstance(read, dict)
        self.assertNotIn("participants", read, "an agent's default read leaves them out")
        self.assertNotIn("participants", service.get_work_item(self.conn, self.goal))
        self.assertNotIn("participants", service.get_work_item_brief(self.conn, self.goal))
        with self.acting(B):
            written = service.update_work_item(self.conn, self.goal, title="oracle goal, renamed")
        self.assertNotIn("participants", written, "a write's answer leaves them out")
        board = views.planning_payload(self.conn, space=self.space)
        self.assertFalse(any("participants" in item for item in board["work_items"]))
        page = service.list_work_items(self.conn, space=self.space)
        self.assertFalse(any("participants" in item for item in page))

    def test_the_functions_other_readers_ask(self) -> None:
        goal_id = str(read_model.item_row(self.conn, self.goal)["work_item_id"])
        task_id = str(read_model.item_row(self.conn, self.t1)["work_item_id"])
        self.assertEqual([A, B], participants.sessions(self.conn, goal_id))
        self.assertTrue(participants.live(self.conn, goal_id))
        self.assertFalse(participants.live(self.conn, task_id), "a task has no participants")
        self.assertEqual([], participants.sessions(self.conn, task_id))
        self.assertTrue(participants.heard(self.conn, task_id), "its goal's participants hear it")
        alone = self.item("G2 without participants", "goal")
        under = self.item("T4", parent=alone)
        alone_id = str(read_model.item_row(self.conn, alone)["work_item_id"])
        under_id = str(read_model.item_row(self.conn, under)["work_item_id"])
        self.assertEqual(
            (False, False),
            (participants.live(self.conn, alone_id), participants.heard(self.conn, under_id)),
        )
        loose = str(
            read_model.item_row(self.conn, self.item("A task under nothing"))["work_item_id"]
        )
        self.assertFalse(participants.heard(self.conn, loose))

    def test_following_the_goal_makes_a_participant_of_every_stage_under_it(self) -> None:
        self.follow(self.goal, E)
        self.assertEqual([A, B, E], self.who(self.goal))
        self.assertEqual([B, E], self.who(self.s2), "a stage's participants follow its goal too")


class CreatorTests(Harness):
    def subscribed(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT i.number, u.session_id, u.agent_id, u.follows"
                " FROM work_item_subscriptions u JOIN work_items i USING (work_item_id)"
                " ORDER BY i.number"
            )
        ]

    def test_a_goal_a_subagent_creates_is_followed_by_its_session_and_a_stage_by_nobody(
        self,
    ) -> None:
        """O8: a1 of session A creates G4 and a stage under it."""

        goal = self.item("G4", "goal", by=A)
        events = len(service.get_work_item(self.conn, goal)["events"])
        with self.acting(A, A1):
            created = service.create_work_item(self.conn, space=self.space, title="G5", kind="goal")
        self.assertEqual(
            [f"claude (session {A})"], [entry["label"] for entry in created["subscribers"]]
        )
        self.item("Stage under G4", "stage", goal, by=A)
        self.assertEqual(
            [(int(goal.split("-")[1]), A, "", 1), (int(created["number"]), A, "", 1)],
            self.subscribed(),
            "the session's own conversation follows each goal; the stage subscribed nobody",
        )
        [entry] = self.listed(goal)
        self.assertEqual((A, True, []), (entry["session"], entry["follows"], entry["holds"]))
        self.assertEqual(events, len(service.get_work_item(self.conn, goal)["events"]))
        self.assertEqual("", created["subscribers"][0]["agent"] or "", "the conversation, no agent")

    def test_a_goal_the_person_creates_subscribes_nobody(self) -> None:
        goal = self.item("By hand", "goal")
        service.create_work_item(self.conn, space=self.space, title="Outside a call", kind="goal")
        self.conn.commit()
        self.assertEqual([], self.subscribed())
        self.assertEqual([], self.listed(goal))

    def test_following_on_the_servers_behalf_lifts_a_mute_and_needs_a_proved_session(self) -> None:
        goal = self.item("Followed", "goal")
        task = self.item("Muted", parent=goal)
        task_id = str(read_model.item_row(self.conn, task)["work_item_id"])
        with self.acting(None):
            self.assertFalse(subscriptions.follow(self.conn, task_id, B), "no call proved B")
        self.assertEqual([], self.subscribed())
        self.claim(task, B)
        with self.acting(B):
            self.assertEqual(
                subscriptions.MUTED,
                subscriptions.subscribe(self.conn, read_model.item_row(self.conn, task), False),
            )
        with self.acting(None):
            self.assertTrue(subscriptions.follow(self.conn, task_id, B), "a person's call may")
        number = int(task.split("-")[1])
        self.assertEqual([(number, B, "", 1)], self.subscribed(), "the mute became a subscription")
        self.assertEqual(
            [f"claude (session {B})"],
            [e["label"] for e in service.get_work_item(self.conn, task)["subscribers"]],
        )


class LivenessTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.goal = self.item("G3", "goal")
        self.task = self.item("T7", parent=self.goal)
        self.claim(self.task, B)

    def test_an_ended_session_works_on_nothing_and_answers_nothing(self) -> None:
        """O17, its participants half: gone at its end, back when it resumes."""

        self.assertEqual([B], self.who(self.goal))
        sessions.op_ingest_session_event(
            self.conn, {"event": "session_end", "session_id": B, "client": "claude-code"}
        )
        self.assertEqual([], self.who(self.goal), "no grace for an ended session")
        held = service.get_work_item(self.conn, self.task)
        self.assertEqual(f"claude (session {B})", held["claim_ref"], "its claim still stands")
        sessions.op_ingest_session_event(
            self.conn, {"event": "session_start", "session_id": B, "client": "claude-code"}
        )
        self.assertEqual([B], self.who(self.goal), "resumed, it works on the goal again")

    def test_the_lease_term_decides_for_a_claim_a_step_and_a_subscription_alike(self) -> None:
        with self.acting(None):
            service.set_checklist(self.conn, self.task, ["one"])
        step = service.get_work_item(self.conn, self.task)["checklist"][0]["id"]
        with self.acting(A, A1):
            service.claim_checklist_item(self.conn, self.task, step)
        self.follow(self.goal, E)
        self.assertEqual([A, B, E], self.who(self.goal))
        for session in (A, B, E):
            self.quiet(session, 13)
        self.assertEqual([A, B, E], self.who(self.goal), "within the lease term")
        for session in (A, B, E):
            with self.subTest(session=session):
                self.quiet(session, 15)
                self.assertNotIn(session, self.who(self.goal), "silent past the lease term")
        self.assertEqual([], self.who(self.goal))

    def test_a_session_with_no_row_is_no_participant(self) -> None:
        self.conn.execute("DELETE FROM sessions WHERE id = ?", (B,))
        self.conn.commit()
        self.assertEqual([], self.who(self.goal))


class BoardCostTests(Harness):
    def statements(self) -> int:
        count = 0

        def trace(_statement: str) -> None:
            nonlocal count
            count += 1

        self.conn.set_trace_callback(trace)
        try:
            board = views.planning_payload(self.conn, space=self.space)
        finally:
            self.conn.set_trace_callback(None)
        self.assertFalse(any("participants" in item for item in board["work_items"]))
        return count

    def test_a_board_read_costs_no_more_for_a_goal_with_participants_than_for_a_task(self) -> None:
        """A brief record of a container walks no tree: it costs what a task's does.

        A board pays per listed item for what a brief record reads of its own row, so
        the oracle is the price of one more item: four goals that sessions work on
        cost what four unheld tasks cost, and more of them following costs nothing.
        """

        self.claim(self.item("Held"), B)
        base = self.statements()
        goals = [self.item(f"Goal {number}", "goal") for number in range(4)]
        for goal in goals:
            self.follow(goal, E)
        with_goals = self.statements()
        for number in range(4):
            self.item(f"Task {number}")
        with_tasks = self.statements()
        self.assertEqual(with_goals - base, with_tasks - with_goals)
        for goal in goals:
            self.follow(goal, B)
        self.assertEqual(with_tasks, self.statements())


if __name__ == "__main__":
    unittest.main()
