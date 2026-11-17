"""What is written under a goal reaches every session that works under it, once.

A person builds the tree in the interface, which subscribes nobody: goal G holds stage
S1 with tasks T1 and T3 and stage S2 with task T2, and goal H holds task U. T1 and T2
stand in different stages on purpose. Sessions act through `mcp_surface.call_tool`
with a proved session, a person through the HTTP boundary as the browser binds it,
and each hook answers a payload shaped like Claude Code's input.

The expectations come from the hook contract, "Under a goal": a session works on a
goal or stage when it holds a task under it or follows it or one over it, and then
hears, from other sessions and the person, where the work under it stands and
everything written on the goal or stage itself. A person's act on the goal or a
stage wakes it; nothing else there does. Each pair of a recipient and an item is
told by one path, so nothing comes twice.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from server import mcp_surface, store
from server.hooks import notify
from server.planning import (
    api,
    calls,
    item_tree,
    participants,
    person_events,
    read_model,
    service,
)

A = "0a000000-0000-4000-8000-00000000000a"
B = "0b000000-0000-4000-8000-00000000000b"
C = "0c000000-0000-4000-8000-00000000000c"
D = "0d000000-0000-4000-8000-00000000000d"
E = "0e000000-0000-4000-8000-00000000000e"
F = "0f000000-0000-4000-8000-00000000000f"
A1 = "0a000000-0000-4000-8000-0000000000a1"
A2 = "0a000000-0000-4000-8000-0000000000a2"
AS_A = {"sessionId": A}
AS_A1 = {"sessionId": A, "threadId": A1}
AS_A2 = {"sessionId": A, "threadId": A2}
AS_B = {"sessionId": B}
AS_C = {"sessionId": C}
AS_D = {"sessionId": D}
AS_E = {"sessionId": E}
AS_F = {"sessionId": F}
CREATE = "/api/planning/work-items"
COMMENT = "/api/planning/work-item/comment"
UPDATE = "/api/planning/work-item/update"
FROM_AGENTS = "Valkama notice, not from the person:"
A_PERSON = "Valkama notice: a person acted in the Valkama interface"


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "store", "valkama.sqlite3")
        os.makedirs(os.path.dirname(self.path))
        home = os.path.join(directory.name, "home")
        os.makedirs(home)
        self.environ = {
            "VALKAMA_DB": self.path,
            # The suite's guard for the owner's real store, handed to every hook call.
            "VALKAMA_PROTECTED_STORE": os.environ["VALKAMA_PROTECTED_STORE"],
            "HOME": home,
            "USERPROFILE": home,
        }
        patch = mock.patch.dict(os.environ, self.environ)
        patch.start()
        self.addCleanup(patch.stop)
        for name in ("CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "VALKAMA_NOTIFY"):
            os.environ.pop(name, None)
        for name, value in (("POLL_SECONDS", 0.05), ("GRACE_SECONDS", 0.2)):
            patch = mock.patch.object(notify, name, value)
            patch.start()
            self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, name="Crew", key="MAIN")
        self.space = "MAIN"
        self.conn.commit()
        self.goal = self.made("oracle goal", "goal")
        self.s1 = self.made("S1", "stage", self.goal)
        self.s2 = self.made("S2", "stage", self.goal)
        self.t1 = self.made("T1", parent=self.s1)
        self.t3 = self.made("T3", parent=self.s1)
        self.t2 = self.made("T2", parent=self.s2)
        self.h = self.made("H", "goal")
        self.u = self.made("U", parent=self.h)

    def made(self, title: str, kind: str = "task", parent: str | None = None) -> str:
        payload: dict = {"space": self.space, "title": title, "kind": kind}
        if parent is not None:
            payload["parent"] = parent
        return str(self.person(CREATE, **payload)["reference"])

    def agent(self, tool: str, meta: object, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        assert "error" not in answer, answer
        return answer

    def comment(self, meta: object, ref: str, body: str, **extra: object) -> int:
        answer = self.agent(
            "apply_work_item_changes", meta, id=ref, comment={"body": body, **extra}
        )
        return int(answer["applied"]["comment"]["comment_id"])

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def close(self, meta: object, ref: str) -> None:
        """An agent takes the task in one call and closes it in the next, with a summary."""

        self.agent("claim_work_item", meta, id=ref)
        self.agent(
            "apply_work_item_changes",
            meta,
            id=ref,
            transition={"state": "done"},
            summary={"done": "Parser rewritten, marker S-1", "next": "Nothing"},
        )

    def hook(self, session: str, event: str = "post-tool-use") -> str | None:
        answer = notify.deliver("claude", event, {"session_id": session}, self.environ)
        if answer is None:
            return None
        return str(json.loads(answer)["hookSpecificOutput"]["additionalContext"])

    def settle(self, *sessions: str) -> None:
        """Each session's hook has read up to now: its tree's news starts here."""

        for session in sessions:
            self.hook(session)
            self.assertIsNone(self.hook(session), f"{session} has read everything")

    def watch(self, session: str, *, alive: float | None = None) -> tuple[int, str]:
        """The session's watcher in this thread; with `alive`, its client dies after that long."""

        environ = dict(self.environ)
        if alive is not None:
            client = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
            self.addCleanup(client.kill)
            timer = threading.Timer(alive, client.kill)
            timer.start()
            self.addCleanup(timer.join)
            environ["CLAUDE_PID"] = str(client.pid)
        stderr = io.BytesIO()
        fake = mock.Mock()
        fake.buffer = stderr
        deadline = time.monotonic() + 20
        pause = time.sleep

        def sleep(seconds: float) -> None:
            if time.monotonic() > deadline:
                raise AssertionError("the watcher was still waiting after 20 s")
            pause(seconds)

        with mock.patch.object(sys, "stderr", fake), mock.patch.object(notify.time, "sleep", sleep):
            status = notify.watch({"session_id": session}, environ)
        return status, stderr.getvalue().decode("utf-8")

    def title_of(self, ref: str) -> str:
        return str(read_model.item_row(self.conn, ref)["title"])

    def line(self, ref: str, under: str | None = None) -> str:
        """The line that names an item of the tree, and the goal or stage it came under."""

        named = f"{ref} «{self.title_of(ref)}»"
        return named + (f", under {under} «{self.title_of(under)}»" if under else "") + ":"


class UnderTheGoalTests(Harness):
    """B holds T2 in S2; A's subagent a1 closes T1 in S1, under the same goal."""

    def test_a_close_under_the_goal_reaches_its_other_participant(self) -> None:
        self.agent("claim_work_item", AS_B, id=self.t2)
        self.settle(A, B)
        self.close(AS_A1, self.t1)
        self.assertIsNone(self.hook(B, "stop"), "a close under the goal continues no turn")
        self.assertEqual((0, ""), self.watch(B, alive=1.0), "and wakes nothing")
        told = self.hook(B)
        assert told is not None, "B works under the goal and hears where T1 stands"
        self.assertTrue(told.startswith(FROM_AGENTS), told)
        self.assertIn(f"\n{self.line(self.t1, self.goal)}\n", told)
        self.assertRegex(told, rf"\n- status at \S+ by agent {A1} of session {A}: «done»\n")
        self.assertEqual(1, told.count("«done»"), "the close, once")
        self.assertNotIn("- claimed at", told, "a claim is not where the work stands")
        self.assertNotIn("marker S-1", told, "a summary sent with a close is the report's")
        self.assertIn("works on", told.splitlines()[0])
        self.assertIsNone(self.hook(B), "once")

    def test_an_item_read_for_addressed_news_is_told_once(self) -> None:
        self.agent("claim_work_item", AS_B, id=self.t2)
        root = self.comment(AS_B, self.t1, "B asks about T1, marker R-0")
        self.settle(A, B)
        self.close(AS_A1, self.t1)
        self.comment(AS_A, self.t1, "An answer in B's thread, marker R-1", reply_to=root)
        told = self.hook(B)
        assert told is not None
        self.assertEqual(1, told.count("«done»"), told)
        self.assertRegex(
            told, rf"- reply at \S+ by session {A}, in your thread #{root}: «[^»]*R-1»"
        )
        self.assertIsNone(self.hook(B), "once")
        self.comment(AS_A, self.t1, "A second answer, marker R-2", reply_to=root)
        self.assertIn("R-2", self.hook(B) or "", "the thread is still addressed to B")

    def test_a_session_outside_the_goal_hears_nothing(self) -> None:
        self.agent("claim_work_item", AS_C, id=self.u)
        self.agent("apply_work_item_changes", AS_D, id=self.h, comment={"body": "D was here"})
        self.settle(A, C, D)
        self.close(AS_A1, self.t1)
        self.assertIsNone(self.hook(C), "C works under H only")
        self.assertIsNone(self.hook(D), "D holds nothing")

    def test_a_subagent_hears_no_tree(self) -> None:
        self.agent("claim_work_item", AS_A2, id=self.t3)
        self.settle(A)
        self.assertIsNone(self.hook(A, "post-tool-use"))
        self.comment(AS_B, self.s1, "On the stage, marker SA-1")
        answer = notify.deliver(
            "claude", "post-tool-use", {"session_id": A, "agent_id": A2}, self.environ
        )
        self.assertIsNone(answer, "the tree is its orchestrator's")
        self.assertIn("marker SA-1", self.hook(A) or "")

    def test_words_on_a_stage_reach_whoever_works_under_the_goal_whole_or_cut(self) -> None:
        """B writes on S1; A holds T3 under the same goal and hears it through the tree."""

        self.agent("claim_work_item", AS_A, id=self.t3)
        self.settle(A)
        self.comment(AS_B, self.s1, "w" * 1399 + "1")
        told = self.hook(A)
        assert told is not None, "A hears what B wrote on the stage over its task"
        self.assertIn(f"\n{self.line(self.s1, self.goal)}\n", told)
        self.assertIn("w" * 1399 + "1»", told, "whole")
        self.assertNotIn(notify.READ_THE_REST, told, "and no read is asked for")
        self.comment(AS_B, self.s1, "v" * 2000)
        told = self.hook(A)
        assert told is not None
        self.assertIn("v" * 1499 + "…»", told)
        self.assertNotIn("v" * 1500, told)
        self.assertTrue(told.endswith(notify.READ_THE_REST), told)


class PersonOnTheTreeTests(Harness):
    """B holds T2 and once wrote on G; A holds T3 through a2 and never wrote on G; F follows
    G and holds nothing; E follows only S1."""

    def setUp(self) -> None:
        super().setUp()
        self.agent("claim_work_item", AS_B, id=self.t2)
        self.comment(AS_B, self.goal, "B once wrote on the goal")
        self.agent("claim_work_item", AS_A2, id=self.t3)
        self.agent("apply_work_item_changes", AS_F, id=self.goal, subscribe=True)
        self.agent("apply_work_item_changes", AS_E, id=self.s1, subscribe=True)
        self.settle(A, B, E, F)

    def heard(self, session: str, markers: tuple[str, ...], status: int, text: str) -> None:
        self.assertEqual(notify.WAKE_STATUS, status, f"{session} is woken")
        self.assertTrue(text.startswith("Valkama notice, not an error:"), text)
        for marker in markers:
            self.assertEqual(1, text.count(marker), f"{session} hears {marker} whole, once")
        self.assertIsNone(self.hook(session), f"{session} is told once")

    def person_on_the_goal(self) -> None:
        self.person(COMMENT, id=self.goal, body="The owner on the goal, marker G-1")
        for session in (A, B, F):
            self.heard(session, ("marker G-1",), *self.watch(session))
        self.assertIsNone(self.hook(E), "E works on S1 alone")
        self.assertIsNone(self.hook(E, "stop"))

    def person_on_a_stage(self) -> None:
        self.person(UPDATE, id=self.s2, description="New scope for S2, marker D-1")
        self.person(COMMENT, id=self.s2, body="The owner on the stage, marker S2-1")
        continued = self.hook(A, "stop")
        assert continued is not None, "A's turn goes on with the person's news"
        self.assertTrue(continued.startswith(A_PERSON), continued)
        self.assertIn("- edited at", continued)
        for marker in ("marker D-1", "marker S2-1"):
            self.assertEqual(1, continued.count(marker), continued)
        self.assertIsNone(self.hook(A), "A is told once")
        for session in (B, F):
            self.heard(session, ("marker D-1", "marker S2-1"), *self.watch(session))
        self.assertIsNone(self.hook(E), "S2 is not under S1")
        self.assertIsNone(self.hook(E, "stop"))

    def test_a_person_on_the_goal_wakes_everyone_working_under_it_once(self) -> None:
        self.person_on_the_goal()

    def test_a_person_on_a_stage_wakes_everyone_working_under_its_goal(self) -> None:
        self.person_on_a_stage()

    def woken(self, session: str) -> bool:
        """Whether the watcher would wake the session now, read without moving a place."""

        conn = notify._connect(self.path)
        assert conn is not None
        try:
            state = os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY)
            return bool(
                notify.collect(conn, state, session, None, take=False, agents=False, wake=True)
            )
        finally:
            conn.close()

    def test_without_works_on_the_goal_one_wrote_on_or_follows_is_missed(self) -> None:
        """O15 fails without `works_on`: the goal B wrote on and F follows is read by its own
        path, so B hears only what is addressed to it there and F is told without a wake."""

        with mock.patch.object(notify, "_working", lambda scoped: scoped):
            self.setUp()
            self.person(COMMENT, id=self.goal, body="The owner on the goal, marker G-1")
            self.assertTrue(self.woken(A), "A never wrote on the goal: the tree's news has it")
            self.assertFalse(self.woken(B))
            self.assertIsNone(self.hook(B), "B hears nothing of the person on the goal")
            self.assertFalse(self.woken(F), "F is not woken")
            self.assertIn("marker G-1", self.hook(F) or "", "and hears it at its next call")

    def test_without_the_tree_a_person_on_a_stage_reaches_nobody(self) -> None:
        """O16 fails on the code before the tree, no `works_on` and no tree's news: nobody
        holds or follows S2 itself. With `works_on` alone it passes, since S2 is on no
        recipient's own path and the tree's news carries it to all three."""

        with (
            mock.patch.object(notify, "_working", lambda scoped: scoped),
            mock.patch.object(
                notify, "_feed", lambda _conn, _tree, places, *_: ({}, {}, {}, places, {})
            ),
        ):
            self.setUp()
            self.person(UPDATE, id=self.s2, description="New scope for S2, marker D-1")
            self.person(COMMENT, id=self.s2, body="The owner on the stage, marker S2-1")
            self.assertIsNone(self.hook(A, "stop"))
            for session in (A, B, F):
                self.assertFalse(self.woken(session))
                self.assertIsNone(self.hook(session))


class MutedGoalTests(Harness):
    """A holds T1 under S1 and muted the goal G; B writes beside it."""

    def setUp(self) -> None:
        super().setUp()
        self.agent("claim_work_item", AS_A, id=self.t1)
        answer = self.agent("apply_work_item_changes", AS_A, id=self.goal, subscribe=False)
        self.assertEqual("muted", answer["applied"]["subscribe"], "working under G holds it")
        self.settle(A)

    def test_a_mute_on_the_goal_keeps_other_sessions_out_and_lets_a_person_wake(self) -> None:
        self.comment(AS_B, self.goal, "B on the muted goal, marker M-1")
        self.assertIsNone(self.hook(A), "other sessions' news on the goal is muted")
        self.comment(AS_B, self.s1, "B on the stage, marker M-2")
        told = self.hook(A)
        assert told is not None, "the mute is the goal's, not the stage's under it"
        self.assertIn("marker M-2", told)
        self.assertNotIn("marker M-1", told)
        self.person(COMMENT, id=self.goal, body="The owner on the goal, marker P-1")
        status, text = self.watch(A)
        self.assertEqual(notify.WAKE_STATUS, status, "a person's act wakes through the mute")
        self.assertEqual(1, text.count("marker P-1"), text)
        self.assertNotIn("marker M-1", text)
        self.assertIsNone(self.hook(A), "once")

    def test_a_mute_left_once_the_work_is_let_go_follows_nothing(self) -> None:
        self.agent("claim_work_item", AS_A, id=self.t1, release=True)
        self.settle(A)
        rows = self.conn.execute(
            "SELECT follows FROM work_item_subscriptions WHERE session_id = ?", (A,)
        ).fetchall()
        self.assertEqual([(0,)], [tuple(row) for row in rows], "the row stays, as on a task")
        self.assertEqual(frozenset(), notify.watched(self.conn, A), "and adds no root")
        goal = read_model.item_row(self.conn, self.goal)
        self.assertEqual([], participants.of_container(self.conn, goal))
        # Held at its last read, the goal's next news is told once more, as a task's is to the
        # holder that let it go; the mute counts for nothing then, as on a task.
        self.comment(AS_B, self.goal, "B on the goal, marker M-3")
        self.assertIn("marker M-3", self.hook(A) or "")
        self.comment(AS_B, self.goal, "B on the goal again, marker M-4")
        self.assertIsNone(self.hook(A), "A works on nothing and follows nothing")


class PlacesTests(Harness):
    def marks_path(self, session: str) -> str:
        return os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY, session + ".marks")

    def test_a_version_4_file_starts_the_tree_at_the_end(self) -> None:
        self.agent("claim_work_item", AS_A, id=self.t3)
        self.settle(A)
        path = self.marks_path(A)
        with open(path, "rb") as handle:
            lines = handle.read().decode("ascii").splitlines()
        self.assertEqual("v5", lines[0])
        self.assertEqual(1, len([line for line in lines if line.startswith("@tree ")]), lines)
        with open(path, "wb") as handle:
            kept = [line for line in lines[1:] if not line.startswith("@tree ")]
            handle.write(("\n".join(["v4", *kept]) + "\n").encode("ascii"))
        self.assertEqual(notify.read_marks(path), notify.read_state(path)[0], "it reads")
        self.assertIsNone(notify.read_state(path)[1][4], "with no place in the tree yet")
        self.comment(AS_B, self.s1, "Before the upgrade, marker P-1")
        self.assertIsNone(self.hook(A), "the tree's past is not told")
        with open(path, "rb") as handle:
            self.assertEqual(b"v5\n", handle.read(3))
        self.comment(AS_B, self.s1, "After it, marker P-2")
        told = self.hook(A)
        assert told is not None
        self.assertIn("marker P-2", told)
        self.assertNotIn("marker P-1", told)

    def test_a_new_recipient_starts_the_tree_at_the_end(self) -> None:
        self.agent("claim_work_item", AS_A, id=self.t3)
        self.comment(AS_B, self.s1, "Before A's first hook, marker N-1")
        self.assertIsNone(self.hook(A), "nothing from before")
        self.comment(AS_B, self.s1, "After it, marker N-2")
        self.assertIn("marker N-2", self.hook(A) or "")

    def test_a_read_takes_at_most_a_bound_of_rows_per_source_and_the_rest_comes_next(self) -> None:
        self.assertEqual(2000, person_events.MOST_FEED_ROWS)
        self.agent("claim_work_item", AS_A, id=self.t3)
        self.settle(A)
        for number in range(7):
            self.comment(AS_B, self.s1, f"Row marker K-{number}.")
        told = []
        with mock.patch.object(person_events, "MOST_FEED_ROWS", 3):
            for _call in range(4):
                text = self.hook(A) or ""
                told.append([n for n in range(7) if f"marker K-{n}." in text])
        self.assertEqual([[0, 1, 2], [3, 4, 5], [6], []], told)


class WatchedTests(Harness):
    """The hook's W(R) and `participants` give every session the same tree."""

    def test_the_tree_the_hook_reads_is_the_participants_tree(self) -> None:
        q = "01000000-0000-4000-8000-000000000001"
        x = "02000000-0000-4000-8000-000000000002"
        answer = self.agent(
            "apply_work_item_changes", AS_C, id=self.u, checklist={"items": ["One", "Two"]}
        )
        first, second = (step["item_id"] for step in answer["applied"]["checklist"])
        self.agent(
            "claim_work_item_checklist_item",
            {"sessionId": C, "threadId": "c1"},
            id=self.u,
            item_id=first,
        )
        self.agent("claim_work_item_checklist_item", AS_D, id=self.u, item_id=second)
        self.agent(
            "apply_work_item_changes", AS_D, id=self.u, checklist_ticks=[{"item_id": second}]
        )
        self.agent("claim_work_item", AS_A2, id=self.t3)
        self.agent("claim_work_item", AS_B, id=self.t2)
        self.agent("apply_work_item_changes", AS_E, id=self.s1, subscribe=True)
        self.agent("apply_work_item_changes", AS_F, id=self.goal, subscribe=True)
        self.agent("apply_work_item_changes", {"sessionId": q}, id=self.s2, subscribe=True)
        self.agent("claim_work_item", {"sessionId": x}, id=self.t1)
        self.conn.execute(
            "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now','-4 days')"
            " WHERE id = ?",
            (q,),
        )
        self.conn.execute(
            "UPDATE sessions SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
            " WHERE id = ?",
            (x,),
        )
        self.conn.commit()
        items = [self.goal, self.s1, self.s2, self.t1, self.t2, self.t3, self.h, self.u]
        sessions = [A, B, C, D, E, F, q, x]
        rows = {ref: read_model.item_row(self.conn, ref) for ref in items}
        listed = {
            ref: {p["session"] for p in participants.of_container(self.conn, row)}
            for ref, row in rows.items()
        }
        for session in sessions:
            roots = notify.watched(self.conn, session)
            for ref, row in rows.items():
                chain = [
                    identity for identity, *_ in item_tree.above(self.conn, row["work_item_id"])
                ]
                by_hook = any(identity in roots for identity in chain)
                by_participants = any(
                    session in listed[ref_of]
                    for ref_of, other in rows.items()
                    if other["work_item_id"] in chain
                )
                with self.subTest(session=session, item=ref):
                    self.assertEqual(by_participants, by_hook)
        self.assertEqual(
            {self.goal: {A, B, F}, self.s1: {A, E, F}, self.s2: {B, F}, self.h: {C}},
            {ref: who for ref, who in listed.items() if who},
            "the fixture covers each way in and out",
        )

    def test_the_roots_are_found_without_reading_every_root_of_the_store(self) -> None:
        """A climb from a session's tasks reads the roots above them, not every root."""

        for number in range(60):
            self.made(f"Unrelated goal {number}", "goal")
        self.agent("claim_work_item", AS_A2, id=self.t3)
        goal = read_model.item_row(self.conn, self.goal)["work_item_id"]
        self.assertEqual(frozenset({goal}), notify.watched(self.conn, A))
        plan = [
            str(row[3])
            for row in self.conn.execute(
                "EXPLAIN QUERY PLAN " + notify._WATCHED,
                (A, notify.holder_suffix(A, None), notify.MOST_DEPTH),
            )
        ]
        self.assertFalse([step for step in plan if "AUTOMATIC" in step], plan)
        self.assertFalse([step for step in plan if step.startswith("SCAN w")], plan)
        self.assertFalse(
            [step for step in plan if "work_items_parent" in step],
            f"the parent index holds every root, a search on it reads them all: {plan}",
        )

    def test_the_channels_are_the_planning_rules(self) -> None:
        self.assertEqual(set(calls._CHANNEL_NAMES), set(notify.CHANNELS))


if __name__ == "__main__":
    unittest.main()
