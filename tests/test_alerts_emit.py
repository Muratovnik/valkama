"""What an agent's write owes the owner, and that it arrives once, after the commit.

These cases write the way a client does, through `mcp_surface.run_tool_call` with
a proved session, or as the browser binds a write, and read what reached the
executor. The executor is always replaced: nothing here shows or removes a toast,
and the presence question goes to a stand-in, not to a listener.

The window is held long where a case needs events to land inside it and ended by
`flush`, so no case sleeps through it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from typing import ClassVar
from unittest import mock

from server import mcp_surface, store
from server.alerts import emit, messages
from server.alerts import settings as alert_settings
from server.ops import toast
from server.planning import api, calls, requests, service
from server.planning import model as planning_model

ROOT = Path(__file__).resolve().parent.parent
#: Codex proves its session in `_meta`, the shortest door in a test.
AGENT = {"sessionId": "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"}
FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}
LONG = 60.0
STDIO_META = {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}


class EmitHarness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "emit.sqlite3")}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="p", name="Quality", key="MAIN")
        self.conn.commit()
        self.ref = self.item("Rollout order")
        self.log = os.path.join(directory.name, "valkama-alerts.log")

        self.shown: list[dict] = []
        self.removed: list[tuple[str, str]] = []
        self.asked: list[tuple[str, bool]] = []
        self.visible: set[str] = set()
        for patch in (
            mock.patch.object(toast, "active", return_value=True),
            mock.patch.object(toast, "log_path", return_value=self.log),
            mock.patch.object(toast, "logo_uri", return_value=None),
            mock.patch.object(toast, "show", side_effect=self._show),
            mock.patch.object(toast, "remove", side_effect=self._remove),
            mock.patch.object(emit, "listener_sees", side_effect=self._sees),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.use_window(LONG)
        self.addCleanup(lambda: emit.EMITTER.flush(5))

    def use_window(self, window: float) -> None:
        patch = mock.patch.object(emit, "EMITTER", emit.Emitter(window=window))
        patch.start()
        self.addCleanup(patch.stop)

    def _show(self, message: dict) -> bool:
        self.shown.append(message)
        return True

    def _remove(self, tag: str, group: str) -> bool:
        self.removed.append((tag, group))
        return True

    def _sees(self, work_item_id: str, *, question: bool) -> bool:
        self.asked.append((work_item_id, question))
        return work_item_id in self.visible

    def item(self, title: str, state: str = "dev") -> str:
        record = service.create_work_item(self.conn, space="MAIN", title=title, state=state)
        self.conn.commit()
        return str(record["reference"])

    def work_item_id(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def agent(self, tool: str, **arguments: object) -> object:
        return mcp_surface.run_tool_call(self.conn, tool, arguments, meta=AGENT)

    def ask(self, reference: str | None = None, **fields: object) -> dict:
        answer = self.agent(
            "create_work_item_request",
            id=reference or self.ref,
            kind="question",
            prompt="Which order?",
            fields=[FIELD],
            **fields,
        )
        assert isinstance(answer, dict)
        return answer

    def settle(self) -> None:
        """Let the window end and what it held be delivered."""

        emit.EMITTER.flush(5)


class OneQuestionTests(EmitHarness):
    def test_a_question_from_an_agent_is_one_toast_for_its_item_after_the_write(self) -> None:
        self.ask(expires_at="2099-01-01T09:30:00Z")
        self.settle()

        (message,) = self.shown
        self.assertEqual(self.ref, message["tag"])
        self.assertEqual(messages.GROUP, message["group"])
        self.assertEqual("2099-01-01T09:30:00Z", message["expires_at"])
        self.assertIn(f'"valkama://open/{self.ref}?reveal=question"', message["xml"])
        self.assertIn("Rollout order", message["xml"])
        reader = store.connect()
        self.addCleanup(reader.close)
        self.assertEqual(
            1,
            reader.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0],
            "the question was committed by the time the toast left",
        )

    def test_the_answer_to_the_tool_does_not_wait_for_the_window(self) -> None:
        started = time.monotonic()
        self.ask()
        self.assertLess(time.monotonic() - started, LONG / 2)
        self.assertEqual([], self.shown, "the toast is still in its window")
        self.settle()
        self.assertEqual(1, len(self.shown))

    def test_a_window_ends_by_itself(self) -> None:
        self.use_window(0.01)
        self.ask()
        deadline = time.monotonic() + 5
        while not self.shown and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(1, len(self.shown))

    def test_a_refused_call_raises_no_alert(self) -> None:
        with self.assertRaises(planning_model.PlanningError):
            self.agent(
                "create_work_item_request",
                id=self.ref,
                kind="question",
                prompt="Which order?",
                fields=[FIELD],
                expires_at="2001-01-01T00:00:00Z",
            )
        self.conn.rollback()
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_failed_commit_hands_nothing_over(self) -> None:
        conn = mock.MagicMock(wraps=self.conn)
        conn.commit.side_effect = RuntimeError("disk full")
        with (
            mock.patch.object(emit, "due_after_write", return_value=[emit.TakeBack(self.ref)]),
            mock.patch.dict(mcp_surface._OPS, {"list_platform_modules": lambda *_: {}}),
            self.assertRaises(RuntimeError),
        ):
            mcp_surface.run_tool_call(conn, "list_platform_modules", {}, meta=AGENT)
        self.settle()
        self.assertEqual([], self.removed)


class BatchQuestionTests(EmitHarness):
    """A question asked in apply_work_item_changes owes the owner what the single tool's does."""

    QUESTION: ClassVar[dict] = {"kind": "question", "prompt": "Which order?", "fields": [FIELD]}

    def test_a_question_in_a_batch_is_the_toast_the_single_tool_raises(self) -> None:
        twin = self.item("Rollout order")
        self.ask(twin, expires_at="2099-01-01T09:30:00Z")
        self.settle()
        self.agent(
            "apply_work_item_changes",
            id=self.ref,
            comments=[{"body": "Asking"}],
            questions=[{**self.QUESTION, "expires_at": "2099-01-01T09:30:00Z"}],
        )
        self.settle()

        alone, batched = self.shown
        self.assertEqual((twin, self.ref), (alone["tag"], batched["tag"]))
        self.assertEqual(alone["expires_at"], batched["expires_at"])
        self.assertEqual(alone["xml"].replace(twin, self.ref), batched["xml"])
        self.assertEqual([(self.work_item_id(self.ref), True)], self.asked[1:])

    def test_two_questions_in_one_batch_are_its_one_toast_counting_both(self) -> None:
        self.agent("apply_work_item_changes", id=self.ref, questions=[self.QUESTION] * 2)
        self.settle()
        (message,) = self.shown
        self.assertIn(": 2<", message["xml"])

    def test_a_refused_batch_asks_nothing(self) -> None:
        with self.assertRaises(api.PlanningHttpError):
            self.agent(
                "apply_work_item_changes",
                id=self.ref,
                questions=[self.QUESTION],
                comments=[{"body": "Under", "reply_to": 10_000}],
            )
        self.conn.rollback()
        self.settle()
        self.assertEqual([], self.shown)
        self.assertEqual([], requests.open_rows(self.conn))


class ListTests(EmitHarness):
    """A list under a comment waits for nobody, so it neither raises a toast nor takes one back."""

    LIST: ClassVar[dict] = {"label": "Take on", "options": [{"id": "a", "label": "A"}]}

    def listed(self) -> str:
        answer = self.agent("comment_work_item", id=self.ref, body="Findings", list=self.LIST)
        assert isinstance(answer, dict)
        return str(answer["list_request_id"])

    def test_a_list_raises_no_toast_and_a_question_beside_it_counts_alone(self) -> None:
        self.listed()
        self.settle()
        self.assertEqual([], self.shown)
        self.agent(
            "apply_work_item_changes",
            id=self.ref,
            comments=[{"body": "More findings", "list": self.LIST}],
            questions=[{"kind": "question", "prompt": "Which order?", "fields": [FIELD]}],
        )
        self.settle()
        (message,) = self.shown
        # One open question carries no count; two would read ": 2<".
        self.assertNotRegex(message["xml"], r": \d+<", "the lists are no open questions")

    def test_a_person_ticking_a_list_takes_no_toast_back(self) -> None:
        listed = self.listed()
        self.settle()
        path = "/api/planning/request/answer"
        with calls.bind(calls.browser(), path):
            api.handle_post(
                self.conn, path, {"id": listed, "expected_revision": 0, "answers": {"items": ["a"]}}
            )
            self.conn.commit()
            emit.after_write(self.conn)
        self.settle()
        self.assertEqual([], self.removed)
        self.agent("transition_work_item", id=self.ref, state="cancelled", force=True)
        self.settle()
        self.assertIn((self.ref, messages.GROUP), self.removed, "positive control: a close does")


class WhoWroteTests(EmitHarness):
    def question_as(self, identity: calls.Identity) -> None:
        with calls.bind(identity, "test"):
            requests.create(self.conn, self.ref, kind="question", prompt="?", fields=[FIELD])
            self.conn.commit()
            emit.after_write(self.conn)

    def test_the_interface_writing_raises_nothing(self) -> None:
        self.question_as(calls.browser())
        self.settle()
        self.assertEqual([], self.shown)

    def test_valkama_writing_on_its_own_account_raises_nothing(self) -> None:
        self.question_as(calls.valkama())
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_write_outside_any_call_raises_nothing(self) -> None:
        self.assertIsNone(calls.current())
        requests.create(self.conn, self.ref, kind="question", prompt="?", fields=[FIELD])
        self.conn.commit()
        emit.after_write(self.conn)
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_person_moving_an_item_to_review_raises_nothing(self) -> None:
        with calls.bind(calls.browser(), "/api/planning/work-item/transition"):
            api.handle_post(
                self.conn, "/api/planning/work-item/transition", {"id": self.ref, "state": "review"}
            )
            self.conn.commit()
            emit.after_write(self.conn)
        self.settle()
        self.assertEqual([], self.shown)


class CoalescingTests(EmitHarness):
    def test_questions_on_three_items_in_one_window_are_one_summary(self) -> None:
        references = [self.ref, self.item("Second"), self.item("Third")]
        for reference in references:
            self.ask(reference)
        self.settle()

        (message,) = self.shown
        self.assertEqual(messages.SUMMARY_TAG, message["tag"])
        for reference in references:
            self.assertIn(reference, message["xml"])
        self.assertIn("valkama://open/questions", message["xml"], "a click opens the panel")
        self.assertIn(": 3<", message["xml"], "the heading counts them")

    def test_two_questions_on_one_item_are_its_one_toast_counting_both(self) -> None:
        self.ask()
        self.ask()
        self.settle()

        (message,) = self.shown
        self.assertEqual(self.ref, message["tag"])
        self.assertIn(": 2<", message["xml"])

    def test_a_later_window_is_its_own_toast(self) -> None:
        self.ask()
        self.settle()
        self.ask()
        self.settle()
        self.assertEqual([self.ref, self.ref], [message["tag"] for message in self.shown])

    def test_the_open_question_outranks_a_move_to_review_on_the_same_item(self) -> None:
        alert_settings.write(self.conn, {"locale": "en"})
        self.ask()
        self.agent("transition_work_item", id=self.ref, state="review")
        self.settle()

        (message,) = self.shown
        self.assertIn("your answer is needed", message["xml"])

    def test_a_toast_with_a_deadline_stays_until_the_last_open_question_lapses(self) -> None:
        self.ask(expires_at="2099-01-01T00:00:00Z")
        self.ask(expires_at="2098-01-01T00:00:00Z")
        self.settle()
        self.assertEqual("2099-01-01T00:00:00Z", self.shown[-1]["expires_at"])

        other = self.item("No deadline on one")
        self.ask(other)
        self.ask(other, expires_at="2098-01-01T00:00:00Z")
        self.settle()
        self.assertIsNone(self.shown[-1]["expires_at"], "one open question has no deadline")


class SettingsTests(EmitHarness):
    def test_alerts_turned_off_raise_nothing(self) -> None:
        alert_settings.write(self.conn, {"enabled": False})
        self.ask()
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_question_alert_turned_off_raises_nothing(self) -> None:
        alert_settings.write(self.conn, {"events": {"question": False}})
        self.ask()
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_review_alert_turned_off_raises_nothing(self) -> None:
        alert_settings.write(self.conn, {"events": {"review": False}})
        self.agent("transition_work_item", id=self.ref, state="review")
        self.settle()
        self.assertEqual([], self.shown)

    def test_turned_off_still_takes_a_toast_back(self) -> None:
        answer = self.ask()
        self.settle()
        alert_settings.write(self.conn, {"enabled": False})
        self.agent(
            "expire_work_item_request",
            id=answer["request_id"],
            expected_revision=answer["revision"],
        )
        self.settle()
        self.assertIn((self.ref, messages.GROUP), self.removed)

    def test_the_stored_language_writes_the_toast(self) -> None:
        alert_settings.write(self.conn, {"locale": "ru"})
        self.ask()
        self.settle()
        self.assertIn("нужен ваш ответ", self.shown[0]["xml"])


class PresenceTests(EmitHarness):
    def test_a_page_showing_the_item_silences_its_toast(self) -> None:
        self.visible.add(self.work_item_id(self.ref))
        self.ask()
        self.settle()
        self.assertEqual([], self.shown)
        self.assertEqual([(self.work_item_id(self.ref), True)], self.asked)

    def test_a_review_alert_does_not_count_the_panel_of_questions(self) -> None:
        self.agent("transition_work_item", id=self.ref, state="review")
        self.settle()
        self.assertEqual([(self.work_item_id(self.ref), False)], self.asked)
        self.assertEqual(1, len(self.shown))

    def test_of_three_items_the_one_on_screen_leaves_the_summary(self) -> None:
        second, third = self.item("Second"), self.item("Third")
        self.visible.add(self.work_item_id(second))
        for reference in (self.ref, second, third):
            self.ask(reference)
        self.settle()

        (message,) = self.shown
        self.assertIn(self.ref, message["xml"])
        self.assertIn(third, message["xml"])
        self.assertNotIn(second, message["xml"])

    def test_of_two_items_the_one_on_screen_leaves_a_plain_toast(self) -> None:
        second = self.item("Second")
        self.visible.add(self.work_item_id(second))
        self.ask()
        self.ask(second)
        self.settle()
        self.assertEqual([self.ref], [message["tag"] for message in self.shown])


class NoListenerTests(unittest.TestCase):
    """The real question, against a port nothing listens on and one that never answers."""

    def test_no_listener_means_no_page_is_open(self) -> None:
        with mock.patch.dict(os.environ, {"VALKAMA_PORT": "1"}):
            self.assertFalse(emit.listener_sees("anything", question=True))

    def test_a_listener_that_does_not_answer_in_time_means_no_page_either(self) -> None:
        import socket

        with socket.socket() as held:
            held.bind(("127.0.0.1", 0))
            held.listen(1)
            port = held.getsockname()[1]
            started = time.monotonic()
            with mock.patch.dict(os.environ, {"VALKAMA_PORT": str(port)}):
                self.assertFalse(emit.listener_sees("anything", question=False))
        self.assertLess(time.monotonic() - started, 2.0, "and the question does not hang")


class ReviewTests(EmitHarness):
    def test_a_move_to_review_is_one_toast(self) -> None:
        self.agent("transition_work_item", id=self.ref, state="review", reason="ready")
        self.settle()
        (message,) = self.shown
        self.assertEqual(self.ref, message["tag"])

    def test_a_move_inside_a_batch_counts(self) -> None:
        self.agent("apply_work_item_changes", id=self.ref, transition={"state": "review"})
        self.settle()
        self.assertEqual([self.ref], [message["tag"] for message in self.shown])

    def test_review_to_review_is_nothing(self) -> None:
        self.agent("transition_work_item", id=self.ref, state="review")
        self.settle()
        self.shown.clear()
        self.agent("transition_work_item", id=self.ref, state="review")
        self.settle()
        self.assertEqual([], self.shown)

    def test_an_item_created_in_review_is_review_already(self) -> None:
        reference = self.item("Filed in review", state="review")
        self.agent("transition_work_item", id=reference, state="review")
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_move_elsewhere_is_nothing(self) -> None:
        self.agent("transition_work_item", id=self.ref, state="blocked", reason="waiting")
        self.settle()
        self.assertEqual([], self.shown)

    def test_a_claim_starting_an_item_is_nothing(self) -> None:
        reference = self.item("Queued", state="todo")
        self.agent("claim_work_item", id=reference)
        self.settle()
        self.assertEqual([], self.shown)


class TakingBackTests(EmitHarness):
    def test_closing_an_item_takes_its_toast_back(self) -> None:
        self.agent("transition_work_item", id=self.ref, state="cancelled", force=True)
        self.settle()
        self.assertIn((self.ref, messages.GROUP), self.removed)
        self.assertEqual([], self.shown)

    def test_withdrawing_the_last_question_takes_it_back_and_a_summary_with_it(self) -> None:
        answer = self.ask()
        self.settle()
        self.agent(
            "expire_work_item_request",
            id=answer["request_id"],
            expected_revision=answer["revision"],
        )
        self.settle()
        self.assertEqual(
            [(self.ref, messages.GROUP), (messages.SUMMARY_TAG, messages.GROUP)], self.removed
        )

    def test_withdrawing_one_of_two_keeps_the_toast(self) -> None:
        answer = self.ask()
        self.ask()
        self.settle()
        self.agent(
            "expire_work_item_request",
            id=answer["request_id"],
            expected_revision=answer["revision"],
        )
        self.settle()
        self.assertEqual([], self.removed)

    def test_the_summary_stays_while_another_item_has_an_open_question(self) -> None:
        other = self.item("Other")
        answer = self.ask()
        self.ask(other)
        self.settle()
        self.agent(
            "expire_work_item_request",
            id=answer["request_id"],
            expected_revision=answer["revision"],
        )
        self.settle()
        self.assertEqual([(self.ref, messages.GROUP)], self.removed)

    def test_a_question_withdrawn_inside_its_window_never_shows(self) -> None:
        answer = self.ask()
        self.agent(
            "expire_work_item_request",
            id=answer["request_id"],
            expected_revision=answer["revision"],
        )
        self.settle()
        self.assertEqual([], self.shown)
        self.assertIn((self.ref, messages.GROUP), self.removed)

    def test_taking_back_does_not_wait_for_the_window(self) -> None:
        answer = self.ask()
        other = self.item("Other")
        self.ask(other)
        self.agent(
            "expire_work_item_request",
            id=answer["request_id"],
            expected_revision=answer["revision"],
        )
        deadline = time.monotonic() + 5
        while not self.removed and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual([(self.ref, messages.GROUP)], self.removed)
        self.assertEqual([], self.shown, "the other item's window is still open")


class FailuresTests(EmitHarness):
    def test_a_failed_decision_leaves_the_write_committed_and_a_log_line(self) -> None:
        with mock.patch.object(emit, "_write_dues", side_effect=sqlite_failure()):
            answer = self.ask()
        self.assertEqual("pending", answer["status"])
        reader = store.connect()
        self.addCleanup(reader.close)
        self.assertEqual(1, reader.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0])
        self.assertIn("alert not decided", Path(self.log).read_text(encoding="utf-8"))

    def test_a_failed_delivery_is_a_log_line_and_the_next_window_still_delivers(self) -> None:
        with mock.patch.object(toast, "show", side_effect=OSError("no helper")):
            self.ask()
            self.settle()
        self.assertIn("alert not delivered", Path(self.log).read_text(encoding="utf-8"))
        self.ask()
        self.settle()
        self.assertEqual(1, len(self.shown))

    def test_switched_off_nothing_is_read_or_started(self) -> None:
        threads = threading.active_count()
        with (
            mock.patch.object(toast, "active", return_value=False),
            mock.patch.object(emit, "_write_dues", side_effect=AssertionError("read")),
        ):
            self.ask()
        self.assertEqual(threads, threading.active_count())
        self.assertFalse(os.path.exists(self.log))

    def test_the_real_executor_stays_silent_under_the_suite_switch(self) -> None:
        """What keeps this suite off the desktop of whoever runs it."""

        self.assertEqual("1", os.environ.get(toast.SWITCH))


def sqlite_failure() -> Exception:
    return RuntimeError("database is locked")


# Run in its own process: this is about how that process ends. Everything it would
# show is written to a file instead, with the two executor calls replaced before
# the server starts, and the presence port is one nothing listens on.
_SESSION = """
import json, sys
from server import mcp_surface
from server.alerts import emit
from server.ops import toast

def record(kind):
    def recorded(*arguments):
        with open(sys.argv[1], "a", encoding="utf-8") as seen:
            seen.write(json.dumps([kind, arguments[0]["tag"] if kind == "show" else arguments[0]]) + "\\n")
        return True
    return recorded

toast.active = lambda: True
toast.show = record("show")
toast.remove = record("remove")
emit.EMITTER = emit.Emitter(window=float(sys.argv[2]))
mcp_surface.mcp_main()
"""


class SessionEndTests(unittest.TestCase):
    def session(self, window: float, frames: list[dict]) -> tuple[list, float]:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            seen = os.path.join(directory, "seen.jsonl")
            started = time.monotonic()
            subprocess.run(
                [sys.executable, "-c", _SESSION, seen, str(window)],
                input="".join(json.dumps(frame) + "\n" for frame in frames).encode(),
                capture_output=True,
                timeout=60,
                check=True,
                cwd=ROOT,
                env={
                    **os.environ,
                    "VALKAMA_DB": os.path.join(directory, "session.sqlite3"),
                    "VALKAMA_PORT": "1",
                    "VALKAMA_NO_TRAY": "1",
                },
            )
            elapsed = time.monotonic() - started
            if not os.path.exists(seen):
                return [], elapsed
            lines = Path(seen).read_text(encoding="utf-8").splitlines()
            return [json.loads(line) for line in lines], elapsed

    @staticmethod
    def call(number: int, tool: str, **arguments: object) -> dict:
        return {
            "jsonrpc": "2.0",
            "id": number,
            "method": "tools/call",
            "params": {
                "name": tool,
                "arguments": arguments,
                "_meta": {**STDIO_META, **AGENT},
            },
        }

    def frames(self) -> list[dict]:
        return [
            self.call(1, "create_planning_space", project_id="p", name="Quality", key="MAIN"),
            self.call(2, "create_work_item", space="MAIN", title="Rollout order"),
            self.call(
                3,
                "create_work_item_request",
                id="MAIN-1",
                kind="question",
                prompt="Which order?",
                fields=[FIELD],
            ),
        ]

    def test_a_session_ending_inside_the_window_shows_before_it_exits_and_does_not_wait(
        self,
    ) -> None:
        seen, elapsed = self.session(LONG, self.frames())
        self.assertEqual([["show", "MAIN-1"]], seen)
        self.assertLess(elapsed, LONG / 2, "the window ended with the session, not by its clock")


if __name__ == "__main__":
    unittest.main()
