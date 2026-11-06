"""What another agent session writes wakes a session only when it asks for that session.

The owner's rules: a session that asks with `awaits_reply` is woken once by the
first reply in that thread from another session or a person, and later replies are
told at its next tool call. The comment that asks wakes, once, the holders of the
item it is written on and of the items it names in `mentions`, for a day after it
was written; a subscriber hears it at its next tool call. A blocker of an item
reaching a terminal state wakes that item's holder once, closed by a person or by
another session; closed by the holder's own session, it tells nobody. Other agents
wake one session at most 6 times an hour; past that, what would have woken it is
told at its next tool call with a line saying how many such events waited, and a
person's news is neither counted nor held back. A wake is the watcher
exiting 2 for an idle session, or
a `Stop` notice that continues the turn once; a session's own writes, its own
subagents' included, never wake it, and a subagent is never woken itself: its
orchestrator is.

The expectations come from the hook contract, "When another agent's news wakes a
session". Agents write through `mcp_surface.call_tool` with a proved session, a
person through the HTTP boundary as the browser binds it, and the hook answers a
payload shaped like the client's input.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import threading
import time
import unittest
from unittest import mock

from server.hooks import notify
from tests.test_hooks_agent_notices import AS_A, AS_B, COMMENT, FROM_AGENTS, A, B, Harness

A_CHILD = "019a3c2e-3333-7c11-9e0f-2f4b6d8a1c3e"
AS_A_CHILD = {"sessionId": A, "threadId": A_CHILD}


class Wakes(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.agent("claim_work_item", AS_B, id=self.held)
        self.settle()

    def settle(self) -> None:
        """Both sessions told what there is, and both idle, as after a `Stop`."""

        for session in (A, B):
            self.hook(session=session)
            self.assertIsNone(self.hook(event="stop", session=session), "idle with nothing new")

    def watch_as(self, session: str, *, alive: float | None = 1.0) -> tuple[int, str]:
        """`session`'s watcher in this thread; its client process dies after `alive`."""

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

    def ask(self, meta: object = AS_A, ref: str | None = None, **extra: object) -> int:
        return self.comment(
            meta, ref or self.held, "Which parser, marker Q-1?", awaits_reply=True, **extra
        )

    def reply(self, meta: object, root: int, marker: str) -> int:
        return self.comment(meta, self.held, f"This one, marker {marker}", reply_to=root)

    def stop(self, session: str) -> str | None:
        return self.hook(event="stop", session=session)


class AskerTests(Wakes):
    def test_the_first_reply_wakes_the_asker_once_and_the_second_is_told_passively(self) -> None:
        root = self.ask()
        self.assertIsNone(self.hook(session=A), "A's own question is no news to A")
        self.assertIsNone(self.stop(A), "idle again")
        self.reply(AS_B, root, "R-1")
        status, text = self.watch_as(A, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status, "woken by the reply it awaited")
        self.assertTrue(text.startswith(FROM_AGENTS), text)
        self.assertIn("while this session was idle", text)
        self.assertRegex(text, rf"by session {B}, in your thread #{root} \(the reply awaited\)")
        self.assertIn("marker R-1", text)
        self.assertIn("This is not an error", text)
        self.assertIsNone(self.stop(A), "once: nothing more to continue a turn with")

        self.reply(AS_B, root, "R-2")
        self.assertIsNone(self.stop(A), "a later reply does not continue a turn")
        self.assertEqual((0, ""), self.watch_as(A), "nor wake")
        told = self.hook(session=A)
        assert told is not None, "it waits for the next tool call"
        self.assertIn("marker R-2", told)
        self.assertNotIn("the reply awaited", told)
        self.assertNotIn("This is not an error", told)

    def test_at_stop_the_reply_continues_the_turn_once(self) -> None:
        root = self.ask()
        self.hook(session=A)
        self.reply(AS_B, root, "S-1")
        told = self.stop(A)
        assert told is not None, "a Stop notice continues the turn"
        self.assertIn("marker S-1", told)
        self.assertIn("(the reply awaited)", told)
        self.assertIsNone(self.stop(A))
        self.assertIsNone(self.hook(session=A), "and it is not told again")

    def test_an_asker_that_is_not_the_roots_author_is_answered_too(self) -> None:
        root = self.comment(AS_B, self.held, "B started this thread")
        self.settle()
        self.ask(reply_to=root)
        self.reply(AS_B, root, "N-1")
        told = self.stop(A)
        assert told is not None
        self.assertRegex(told, rf"in thread #{root} \(the reply awaited\)")
        self.assertIn("marker N-1", told)

    def test_a_persons_reply_answers_and_wakes_as_a_persons_news_does(self) -> None:
        root = self.comment(AS_B, self.held, "B started this thread too")
        self.settle()
        self.ask(reply_to=root)
        self.person(COMMENT, id=self.held, body="A person, marker P-1", reply_to=root)
        status, text = self.watch_as(A, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status)
        self.assertIn("a person acted", text)
        self.assertIn("marker P-1", text)
        self.reply(AS_B, root, "P-2")
        self.assertIsNone(self.stop(A), "the person's reply ended the wait")

    def test_its_own_subagent_answers_nothing_and_a_resolved_thread_ends_the_wait(self) -> None:
        root = self.ask()
        self.reply(AS_A_CHILD, root, "C-1")
        self.assertIsNone(self.stop(A), "its own subagent is not an answer")
        self.agent("resolve_work_item_comment", AS_B, id=self.held, comment_id=root)
        self.reply(AS_B, root, "C-2")
        self.assertIsNone(self.stop(A), "the wait ended when the thread was resolved")
        self.assertIn("marker C-2", self.hook(session=A) or "", "told at the next tool call")

    def test_a_subagents_question_wakes_its_orchestrator_never_the_subagent(self) -> None:
        root = self.ask(AS_A_CHILD)
        self.hook(session=A)
        self.reply(AS_B, root, "O-1")
        child = notify.deliver(
            "claude", "stop", {"session_id": A, "agent_id": A_CHILD}, self.environ
        )
        self.assertIsNone(child, "a subagent's Stop never continues for another agent")
        status, text = self.watch_as(A, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status)
        self.assertIn("marker O-1", text)
        self.assertIn(f"in thread #{root} of agent {A_CHILD}", text)

    def test_codex_is_told_at_its_next_tool_call_and_has_no_wake(self) -> None:
        root = self.ask()
        self.hook(session=A)
        self.reply(AS_B, root, "X-1")
        self.assertIsNone(notify.deliver("codex", "stop", {"session_id": A}, self.environ))
        answer = notify.deliver("codex", "post-tool-use", {"session_id": A}, self.environ)
        assert answer is not None
        told = json.loads(answer)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("marker X-1", told)


class AddresseeTests(Wakes):
    def test_a_question_on_bs_item_wakes_b_once_and_not_a(self) -> None:
        """The owner's example: A asks B with awaits_reply on B's item while both idle."""

        self.ask()
        status, text = self.watch_as(B, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status, "B is woken")
        self.assertTrue(text.startswith(FROM_AGENTS), text)
        self.assertRegex(text, rf"- comment at \S+ by session {A} \(awaits a reply\): «[^»]*Q-1\?»")
        self.assertIn("This is not an error", text)
        self.assertIsNone(self.stop(B), "once")
        self.assertIsNone(self.hook(session=B))
        self.assertEqual((0, ""), self.watch_as(A), "A is not woken by its own question")
        self.assertIsNone(self.stop(A))

    def test_at_bs_stop_the_question_continues_the_turn_once(self) -> None:
        self.ask()
        told = self.stop(B)
        assert told is not None
        self.assertIn("(awaits a reply)", told)
        self.assertIsNone(self.stop(B))

    def test_a_question_naming_bs_item_in_mentions_wakes_b(self) -> None:
        elsewhere = self.item("A's own")
        self.agent("claim_work_item", AS_A, id=elsewhere)
        self.settle()
        self.comment(
            AS_A,
            elsewhere,
            "Does yours read it, marker M-1?",
            awaits_reply=True,
            mentions=[self.held],
        )
        told = self.stop(B)
        assert told is not None, "the holder of the item named is asked"
        self.assertRegex(
            told, rf"- mentioned at \S+ by session {A}, from {elsewhere} #\d+ \(awaits a reply\)"
        )

    def test_a_question_older_than_a_day_wakes_no_addressee(self) -> None:
        asked = self.ask()
        self.conn.execute(
            "UPDATE work_item_comments SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now',"
            " '-25 hours') WHERE id = ?",
            (asked,),
        )
        self.conn.commit()
        self.assertIsNone(self.stop(B), "too old to continue a turn")
        self.assertEqual((0, ""), self.watch_as(B), "or to wake")
        told = self.hook(session=B)
        assert told is not None, "still told at the next tool call"
        self.assertIn("(awaits a reply)", told)

    def test_a_question_a_day_old_less_a_minute_still_wakes(self) -> None:
        asked = self.ask()
        self.conn.execute(
            "UPDATE work_item_comments SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now',"
            " '-23 hours', '-59 minutes') WHERE id = ?",
            (asked,),
        )
        self.conn.commit()
        self.assertIsNotNone(self.stop(B))

    def test_a_subscriber_and_a_plain_comment_are_told_and_wake_nobody(self) -> None:
        self.subscribe(AS_B, self.followed, True)
        self.settle()
        self.ask(ref=self.followed)
        self.comment(AS_A, self.held, "Just so you know, marker J-1")
        self.assertIsNone(self.stop(B), "a subscriber is not asked, and news is not a question")
        told = self.hook(session=B)
        assert told is not None
        self.assertIn("marker Q-1", told)
        self.assertIn("marker J-1", told)

    def test_a_question_from_bs_own_subagent_asks_b_nothing(self) -> None:
        self.comment({"sessionId": B, "threadId": A_CHILD}, self.held, "Mine", awaits_reply=True)
        self.assertIsNone(self.stop(B))
        self.assertIsNone(self.hook(session=B))


TRANSITION = "/api/planning/work-item/transition"


class BlockerTests(Wakes):
    def setUp(self) -> None:
        super().setUp()
        self.blocker = self.item("The parser rewrite")
        self.agent("link_work_items", AS_A, id=self.blocker, other=self.held, kind="blocks")
        self.settle()

    def close_as(self, meta: object) -> None:
        self.agent("transition_work_item", meta, id=self.blocker, state="cancelled", force=True)

    def test_a_person_closing_the_blocker_wakes_the_holder_once(self) -> None:
        self.person(TRANSITION, id=self.blocker, state="cancelled", force=True)
        status, text = self.watch_as(B, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status)
        self.assertIn("a person acted", text)
        self.assertRegex(
            text, rf"- blocker_closed at \S+ on {self.blocker}, now Cancelled: «The parser rewrite»"
        )
        self.assertIsNone(self.stop(B), "once")
        self.assertIsNone(self.hook(session=B))
        self.assertIsNone(self.stop(A), "A holds nothing it blocked")

    def test_another_session_closing_the_blocker_wakes_the_holder_once(self) -> None:
        self.close_as(AS_A)
        status, text = self.watch_as(B, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status)
        self.assertTrue(text.startswith(FROM_AGENTS), text)
        self.assertRegex(
            text, rf"- blocker_closed at \S+ by session {A}, on {self.blocker}, now Cancelled"
        )
        self.assertIn("a blocker of its work closed", text)
        self.assertIsNone(self.stop(B), "once")
        self.assertIsNone(self.hook(session=B))

    def test_the_holders_own_session_closing_it_wakes_and_tells_nobody(self) -> None:
        self.close_as(AS_B)
        self.assertIsNone(self.stop(B))
        self.assertEqual((0, ""), self.watch_as(B))
        self.assertIsNone(self.hook(session=B))
        self.assertIsNone(self.stop(A))

    def test_closed_again_after_a_reopen_it_wakes_again_and_busy_it_waits(self) -> None:
        self.close_as(AS_A)
        self.assertIsNotNone(self.stop(B))
        self.person(TRANSITION, id=self.blocker, state="backlog", force=True)
        self.hook(session=B)
        self.close_as(AS_A)
        told = self.hook(session=B)
        assert told is not None, "busy: told at the next tool call"
        self.assertIn("blocker_closed", told)
        self.assertIsNone(self.stop(B), "and then nothing is left to wake for")

    def move_as(self, meta: object, state: str) -> None:
        self.agent("transition_work_item", meta, id=self.blocker, state=state, force=True)

    def test_every_state_change_is_told_at_the_next_call_and_only_a_close_wakes(self) -> None:
        self.agent("claim_work_item", AS_A, id=self.blocker)
        self.assertIsNone(self.stop(B), "a blocker started continues no turn")
        self.assertEqual((0, ""), self.watch_as(B), "nor wakes")
        started = self.hook(session=B)
        assert started is not None, "told at the next tool call"
        self.assertRegex(started, rf"- blocker_changed at \S+ by session {A}, on {self.blocker}")
        self.close_as(AS_A)
        self.assertIn("blocker_closed", self.stop(B) or "", "a close wakes, once")
        self.move_as(AS_A, "backlog")
        self.assertIsNone(self.stop(B), "a reopen continues no turn")
        reopened = self.hook(session=B)
        assert reopened is not None, "a reopened blocker is heard"
        self.assertRegex(
            reopened, rf"- blocker_changed at \S+ by session {A}, on {self.blocker}, now Backlog"
        )

    def test_a_persons_change_short_of_a_close_waits_for_the_next_call(self) -> None:
        self.person(TRANSITION, id=self.blocker, state="backlog", force=True)
        self.assertIsNone(self.stop(B), "a person's change of a blocker continues no turn")
        self.assertEqual((0, ""), self.watch_as(B), "nor wakes")
        told = self.hook(session=B)
        assert told is not None, "and is not lost"
        self.assertIn("a person acted", told)
        self.assertRegex(told, rf"- blocker_changed at \S+ on {self.blocker}, now Backlog")
        self.assertNotIn("by session", told)

    def test_a_close_undone_before_anyone_read_it_wakes_nobody(self) -> None:
        self.close_as(AS_A)
        self.move_as(AS_A, "backlog")
        self.assertIsNone(self.stop(B))
        told = self.hook(session=B)
        assert told is not None
        self.assertIn(f"on {self.blocker}, now Cancelled", told)
        self.assertIn(f"on {self.blocker}, now Backlog", told)
        self.assertNotIn("blocker_closed", told)

    def test_the_holders_own_session_changing_it_tells_nobody(self) -> None:
        self.agent("claim_work_item", AS_B, id=self.blocker)
        self.move_as(AS_B, "backlog")
        self.assertIsNone(self.stop(B))
        self.assertIsNone(self.hook(session=B))

    def test_a_place_from_before_blockers_counted_tells_nothing_again(self) -> None:
        self.close_as(AS_A)
        self.assertIsNotNone(self.hook(session=B))
        path = self.marks_path()
        marks = notify.read_marks(path)
        lines = [
            f"{item} {mark[0]} {mark[1][0]} {mark[1][1]} {mark[1][2]} {int(mark[2])}"
            f" {mark[3]} {int(mark[4])}"
            for item, mark in marks.items()
        ]
        with open(path, "wb") as handle:
            handle.write(("\n".join(["v3", *lines]) + "\n").encode("ascii"))
        self.assertEqual(
            {item: (m[0], (*m[1][:3], 0), m[2], m[3], m[4]) for item, m in marks.items()},
            notify.read_marks(path),
        )
        self.assertIsNone(self.hook(session=B), "read once more from its place: nothing new")
        self.assertTrue(notify.read_marks(path), "and counted now")

    def marks_path(self) -> str:
        return os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY, B + ".marks")


class BudgetTests(Wakes):
    def setUp(self) -> None:
        super().setUp()
        # These ask on one item many times an hour: what is said of the wake budget is
        # read here, and folding an item's news past its third notice is `FoldTests`'.
        patch = mock.patch.object(notify, "MOST_NOTICES", 100)
        patch.start()
        self.addCleanup(patch.stop)

    def asked_and_continued(self, number: int) -> str | None:
        self.ask(marker=number)
        return self.stop(B)

    def ask(self, meta: object = AS_A, ref: str | None = None, **extra: object) -> int:
        marker = extra.pop("marker", "")
        return self.comment(
            meta, ref or self.held, f"Question {marker}, marker Q-1?", awaits_reply=True, **extra
        )

    def test_the_seventh_wake_within_the_hour_is_told_passively_with_the_count(self) -> None:
        for number in range(1, 7):
            told = self.asked_and_continued(number)
            assert told is not None, f"wake {number} of 6 continues the turn"
            self.assertIn(f"Question {number},", told)
        self.assertIsNone(self.asked_and_continued(7), "the seventh does not")
        self.assertEqual((0, ""), self.watch_as(B), "nor does the watcher wake for it")
        self.ask(marker=8)
        self.assertIsNone(self.stop(B), "nor for the eighth")
        told = self.hook(session=B)
        assert told is not None, "both are told at the next tool call"
        self.assertIn("Question 7,", told)
        self.assertIn("Question 8,", told)
        self.assertIn(
            "2 events here would have woken this session, past the limit of 6 wakes an hour"
            " by other agents, so they waited for this call.",
            told,
        )
        self.comment(AS_A, self.held, "Plain news, marker L-1")
        later = self.hook(session=B)
        assert later is not None
        self.assertNotIn("would have woken", later, "the count is said once")

    def test_a_persons_news_is_not_counted_and_still_wakes_past_the_limit(self) -> None:
        for number in range(1, 7):
            self.assertIsNotNone(self.asked_and_continued(number))
        self.person(COMMENT, id=self.held, body="A person, marker P-9")
        status, text = self.watch_as(B, alive=None)
        self.assertEqual(notify.WAKE_STATUS, status)
        self.assertIn("marker P-9", text)

    def test_a_wake_held_back_does_not_wake_later_and_an_hour_on_a_new_one_does(self) -> None:
        for number in range(1, 7):
            self.assertIsNotNone(self.asked_and_continued(number))
        self.assertIsNone(self.asked_and_continued(7))
        later = time.time() + notify.WAKE_WINDOW_SECONDS + 1
        with mock.patch.object(notify.time, "time", return_value=later):
            self.comment(AS_A, self.held, "Plain news after the hour, marker L-2")
            self.assertIsNone(self.stop(B), "what the limit held back never wakes")
            told = self.asked_and_continued(8)
            assert told is not None, "an hour on, a new question wakes again"
            self.assertIn("Question 7,", told, "and what waited comes with it")
            self.assertIn("Question 8,", told)

    def test_a_damaged_place_wakes_at_most_once_more_and_never_loops(self) -> None:
        self.assertIsNotNone(self.asked_and_continued(1))
        with open(self.marks_path(), "wb") as handle:
            handle.write(b"\x00\xffnot marks")
        repeated = [self.stop(B) for _ in range(3)]
        self.assertLessEqual(len([told for told in repeated if told is not None]), 1, repeated)
        self.assertIsNone(repeated[-1])

    def marks_path(self) -> str:
        return os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY, B + ".marks")


class CostTests(Wakes):
    def statements(self, **reading: bool) -> list[str]:
        conn = notify._connect(self.path)
        assert conn is not None
        self.addCleanup(conn.close)
        seen: list[str] = []
        conn.set_trace_callback(seen.append)
        state = os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY)
        notify.collect(conn, state, B, None, **reading)
        return seen

    def test_nothing_new_is_two_indexed_reads_for_a_call_a_stop_and_the_watcher(self) -> None:
        blocker = self.item("Blocks the held item")
        self.agent("link_work_items", AS_A, id=blocker, other=self.held, kind="blocks")
        self.agent("transition_work_item", AS_A, id=blocker, state="cancelled", force=True)
        self.subscribe(AS_B, self.followed, True)
        self.ask()
        self.hook(session=B)
        for reading in (
            {},
            {"agents": False, "wake": True},
            {"take": False, "agents": False, "wake": True},
        ):
            with self.subTest(reading=reading):
                seen = self.statements(**reading)
                self.assertEqual(2, len(seen), seen)
                self.assertFalse([sql for sql in seen if "JOIN execution_events" in sql], seen)
        plan = " ".join(str(row[3]) for row in self.conn.execute("EXPLAIN QUERY PLAN " + seen[1]))
        self.assertIn("work_item_links_to", plan, "the blockers are read by the item blocked")
        self.assertNotIn("SCAN l", plan)
        self.assertNotIn("SCAN b", plan)


if __name__ == "__main__":
    unittest.main()
