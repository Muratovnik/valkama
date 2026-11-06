"""What another agent session writes wakes a session only when it asks for that session.

The owner's rules: a session that asks with `awaits_reply` is woken once by the
first reply in that thread from another session or a person, and later replies are
told at its next tool call. A wake is the watcher exiting 2 for an idle session, or
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


if __name__ == "__main__":
    unittest.main()
