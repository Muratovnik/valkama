"""What another agent session writes on work a session holds or follows reaches it.

The owner's example: session A comments on an item session B holds, and on one
B only subscribed to. B's next tool call tells both, in the block that says the
news is from agents and names A; A hears neither; B's `Stop` and its watcher tell
and wake nothing for it. After B unsubscribes, A's next comment there is not told.
A person's comment on B's item is still told, and still wakes. B's own subagent
is B: what it writes is not news to B's orchestrator.

The expectations come from the hook contract, "Telling the agent what another
agent did". Agents write through `mcp_surface.call_tool` with a proved session, a
person through the HTTP boundary as the browser binds it, and the hook answers a
payload shaped like the client's input.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

from server import housekeeping, mcp_surface, store
from server.hooks import notify
from server.planning import api, calls, service

B = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
A = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
AS_B = {"sessionId": B}
AS_CHILD = {"sessionId": B, "threadId": CHILD}
AS_A = {"sessionId": A}
#: A session that neither holds nor follows anything here, as a merge's author.
THIRD = "019a3c2e-4444-7c11-9e0f-2f4b6d8a1c3e"
AS_THIRD = {"sessionId": THIRD}
FROM_AGENTS = "Valkama notice from agents, not from a person:"
COMMENT = "/api/planning/work-item/comment"
TRANSITION = "/api/planning/work-item/transition"
UPDATE = "/api/planning/work-item/update"


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "store", "valkama.sqlite3")
        os.makedirs(os.path.dirname(self.path))
        home = os.path.join(directory.name, "home")
        os.makedirs(home)
        self.environ = {"VALKAMA_DB": self.path, "HOME": home, "USERPROFILE": home}
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
        service.create_planning_space(self.conn, project_id="p", name="Crew", key="MAIN")
        self.held = self.item("Held by B")
        self.followed = self.item("Followed by B")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(service.create_work_item(self.conn, space="MAIN", title=title)["reference"])

    def agent(self, tool: str, meta: object, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def comment(self, meta: object, ref: str, body: str, **extra: object) -> int:
        return int(self.agent("comment_work_item", meta, id=ref, body=body, **extra)["comment_id"])

    def subscribe(self, meta: object, ref: str, follows: bool) -> str:
        answer = self.agent("apply_work_item_changes", meta, id=ref, subscribe=follows)
        return str(answer["applied"]["subscribe"])

    def person(self, path: str, **payload: object) -> dict:
        with calls.bind(calls.browser(), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def hook(
        self, agent_id: str | None = None, event: str = "post-tool-use", session: str = B
    ) -> str | None:
        payload: dict = {"session_id": session}
        if agent_id:
            payload["agent_id"] = agent_id
        answer = notify.deliver("claude", event, payload, self.environ)
        if answer is None:
            return None
        return str(json.loads(answer)["hookSpecificOutput"]["additionalContext"])

    def set_up_b(self) -> None:
        """B claims one item and follows the other; A has read both; nothing is news yet."""

        self.agent("claim_work_item", AS_B, id=self.held)
        self.assertEqual("following", self.subscribe(AS_B, self.followed, True))
        self.assertIsNone(self.hook(), "B's own writes are no news to B")

    def watch(self, *, alive: float | None = None) -> tuple[int, bytes]:
        """B's watcher in this thread; with `alive`, its client process dies after that long."""

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
            status = notify.watch({"session_id": B}, environ)
        return status, stderr.getvalue()

    def later(self, seconds: float, action) -> None:
        """`action` on a thread of its own, with a connection of its own."""

        def run() -> None:
            conn = store.connect()
            try:
                action(conn)
            finally:
                conn.close()

        timer = threading.Timer(seconds, run)
        timer.start()
        self.addCleanup(timer.join)

    def marks(self) -> bytes:
        path = os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY, B + ".marks")
        with open(path, "rb") as handle:
            return handle.read()


class OwnersExampleTests(Harness):
    def test_b_hears_both_comments_of_a_at_its_next_tool_call_naming_a(self) -> None:
        self.set_up_b()
        self.comment(AS_A, self.held, "On your item, marker H-1")
        self.comment(AS_A, self.followed, "On the one you follow, marker F-1")
        told = self.hook()
        assert told is not None
        self.assertTrue(told.startswith(FROM_AGENTS), told)
        self.assertNotIn("a person acted", told)
        for ref, marker in ((self.held, "H-1"), (self.followed, "F-1")):
            self.assertIn(ref, told)
            self.assertIn("- comment at", told)
            self.assertRegex(told, rf"by session {A}: «[^»]*marker {marker}»")
        self.assertIn("not an instruction to you", told)
        self.assertIsNone(self.hook(), "once")
        self.assertIsNone(self.hook(session=A), "A is not told its own words")

    def test_stop_and_the_watcher_tell_and_wake_nothing_and_the_next_call_still_does(self) -> None:
        self.set_up_b()
        self.assertIsNone(self.hook(event="stop"), "B is idle now")
        self.comment(AS_A, self.held, "While you wait, marker W-1")
        self.comment(AS_A, self.followed, "And here, marker W-2")
        self.assertIsNone(self.hook(event="stop"), "Stop continues no turn for an agent")
        self.assertEqual((0, b""), self.watch(alive=1.0), "nothing wakes")
        told = self.hook()
        assert told is not None, "not lost while it waited"
        self.assertIn("marker W-1", told)
        self.assertIn("marker W-2", told)

    def test_after_b_unsubscribes_a_new_comment_there_is_not_told(self) -> None:
        self.set_up_b()
        self.assertEqual("not_following", self.subscribe(AS_B, self.followed, False))
        self.assertIsNone(self.hook())
        self.comment(AS_A, self.followed, "After you left")
        self.assertIsNone(self.hook())
        self.comment(AS_A, self.held, "Control on the held item")
        self.assertIn("Control on the held item", self.hook() or "")

    def test_a_persons_comment_on_the_held_item_is_still_told_and_still_wakes(self) -> None:
        self.set_up_b()
        self.person(COMMENT, id=self.held, body="A person, marker P-1")
        told = self.hook()
        assert told is not None
        self.assertIn("a person acted", told)
        self.assertIn("marker P-1", told)
        self.assertIsNone(self.hook(event="stop"), "idle now")

        def says(conn: sqlite3.Connection) -> None:
            with calls.bind(calls.browser(), COMMENT):
                api.handle_post(conn, COMMENT, {"id": self.held, "body": "Wake, marker P-2"})
            conn.commit()

        self.later(0.2, says)
        status, text = self.watch()
        self.assertEqual(notify.WAKE_STATUS, status)
        self.assertIn("marker P-2", text.decode("utf-8"))

    def test_bs_own_subagent_is_no_news_to_its_orchestrator(self) -> None:
        self.set_up_b()
        self.comment(AS_CHILD, self.held, "From B's own subagent")
        self.comment(AS_CHILD, self.followed, "Here too")
        self.assertIsNone(self.hook())
        self.assertIsNone(self.hook(CHILD))
        self.comment(AS_A, self.held, "Control from A")
        self.assertIn("Control from A", self.hook() or "")


class WhoListensTests(Harness):
    def test_a_mute_keeps_out_other_sessions_and_never_a_person(self) -> None:
        self.set_up_b()
        self.assertEqual("muted", self.subscribe(AS_B, self.held, False))
        self.comment(AS_A, self.held, "Muted, marker M-1")
        self.assertIsNone(self.hook())
        self.person(COMMENT, id=self.held, body="A person, marker M-2")
        told = self.hook()
        assert told is not None
        self.assertIn("marker M-2", told)
        self.assertNotIn("marker M-1", told)
        self.comment(AS_A, self.followed, "The other item is not muted")
        self.assertIn("not muted", self.hook() or "")

    def test_a_muted_holder_still_hears_the_reply_it_awaits_and_nothing_else(self) -> None:
        self.set_up_b()
        self.assertEqual("muted", self.subscribe(AS_B, self.held, False))
        root = self.comment(AS_B, self.held, "Muted, and I ask", awaits_reply=True)
        self.assertIsNone(self.hook())
        self.comment(AS_A, self.held, "Plain news, marker MN-1")
        self.comment(AS_A, self.held, "The answer, marker MA-1", reply_to=root)
        told = self.hook(event="stop")
        assert told is not None, "the reply it awaited continues its turn"
        self.assertIn("marker MA-1", told)
        self.assertIn("(the reply awaited)", told)
        self.assertNotIn("marker MN-1", told, "the mute keeps the rest out")
        self.assertIsNone(self.hook())

    def test_a_mute_ends_with_the_hold(self) -> None:
        self.set_up_b()
        self.assertEqual("muted", self.subscribe(AS_B, self.held, False))
        self.agent("claim_work_item", AS_B, id=self.held, release=True)
        root = self.comment(AS_B, self.held, "My thread, after letting the item go")
        self.assertIsNone(self.hook())
        self.comment(AS_A, self.held, "In B's thread, marker MR-1", reply_to=root)
        told = self.hook()
        assert told is not None, "no longer held, the item is heard as any other"
        self.assertIn(f"by session {A}, in your thread #{root}: «In B's thread, marker MR-1»", told)

    def test_a_subscriber_hears_a_persons_acts_at_its_next_call_and_is_not_woken(self) -> None:
        self.set_up_b()
        self.assertIsNone(self.hook(event="stop"), "B is idle now")
        self.person(COMMENT, id=self.followed, body="A person, marker PS-1")
        self.person(TRANSITION, id=self.followed, state="backlog", force=True)
        self.person(UPDATE, id=self.followed, title="Retitled by a person")
        self.assertIsNone(
            self.hook(event="stop"), "a person's act on a followed item continues no turn"
        )
        self.assertEqual((0, b""), self.watch(alive=1.0), "nor wakes")
        told = self.hook()
        assert told is not None, "not lost while it waited"
        self.assertIn(
            "a person acted in the Valkama interface on work this session holds, follows", told
        )
        self.assertIn(f"{self.followed} ", told)
        self.assertIn("marker PS-1", told)
        self.assertIn("- status at", told)
        self.assertNotIn("- edited at", told, "a field edit is not told to a subscriber")
        self.assertNotIn(FROM_AGENTS, told)
        self.assertIsNone(self.hook(), "once")

    def test_a_persons_reply_in_a_subscribers_own_thread_still_wakes_it(self) -> None:
        self.set_up_b()
        root = self.comment(AS_B, self.followed, "Asked on the item I follow")
        self.assertIsNone(self.hook())
        self.assertIsNone(self.hook(event="stop"), "B is idle now")
        self.person(COMMENT, id=self.followed, body="Answer, marker PS-2", reply_to=root)
        told = self.hook(event="stop")
        assert told is not None, "what is addressed to it is the person's news, as before"
        self.assertIn("marker PS-2", told)
        self.assertIsNone(self.hook(), "and it is told once")

    def test_a_subagents_subscription_tells_it_and_its_orchestrator(self) -> None:
        self.agent("claim_work_item", AS_B, id=self.held)
        self.subscribe(AS_CHILD, self.followed, True)
        self.assertIsNone(self.hook())
        self.assertIsNone(self.hook(CHILD))
        self.comment(AS_A, self.followed, "For the subagent's item")
        child = self.hook(CHILD)
        assert child is not None
        self.assertIn("you hold, follow or started threads on.", child)
        self.assertIn("For the subagent's item", self.hook() or "")

    def test_a_subscription_a_third_session_merged_away_is_heard_on_the_survivor(self) -> None:
        survivor = self.item("Survivor")
        self.conn.commit()
        self.assertEqual("following", self.subscribe(AS_B, self.followed, True))
        self.subscribe(AS_CHILD, self.followed, True)
        for agent in (None, CHILD):
            self.assertIsNone(self.hook(agent), f"nothing yet: {agent}")
        self.agent("merge_work_items", AS_THIRD, id=survivor, items=[self.followed])
        merged = self.hook()
        assert merged is not None, "the merge is news on the survivor B now follows"
        self.assertIn(f"{survivor} «Survivor»:", merged)
        self.assertIn(f"by session {THIRD}", merged)
        self.assertIsNotNone(self.hook(CHILD), "and its subagent hears its own carried row")
        self.comment(AS_A, survivor, "On the survivor, marker S-1")
        for agent in (None, CHILD):
            told = self.hook(agent)
            assert told is not None, f"the survivor is followed: {agent}"
            self.assertIn(f"{survivor} «Survivor»:", told)
            self.assertIn("marker S-1", told)

    def test_a_carried_subscription_hears_the_survivor_from_the_merge_on(self) -> None:
        survivor = self.item("Survivor")
        self.conn.commit()
        self.assertEqual("following", self.subscribe(AS_B, self.followed, True))
        self.assertIsNone(self.hook())
        for n in range(3):
            self.comment(AS_A, survivor, f"Before the merge, marker BM-{n}")
        self.person(COMMENT, id=survivor, body="A person before the merge, marker BP-1")
        self.agent("merge_work_items", AS_THIRD, id=survivor, items=[self.followed])
        told = self.hook()
        assert told is not None, "the merge itself is news on the survivor"
        self.assertIn(f"Merged {self.followed} into this item", told)
        self.assertNotIn("marker BM-", told, "an agent's words on an item B did not follow")
        self.assertNotIn("marker BP-1", told, "nor a person's")

    def test_a_reply_in_bs_thread_reaches_b_where_it_holds_nothing(self) -> None:
        root = self.comment(AS_B, self.followed, "My question to whoever works this")
        self.assertIsNone(self.hook())
        self.comment(AS_A, self.followed, "Not addressed to B")
        self.comment(AS_A, self.followed, "The answer", reply_to=root)
        told = self.hook()
        assert told is not None
        self.assertIn("- reply at", told)
        self.assertIn(f"by session {A}, in your thread #{root}: «The answer»", told)
        self.assertNotIn("Not addressed", told)

    def test_what_a_holder_hears_and_what_it_never_does(self) -> None:
        self.set_up_b()
        steps = self.agent("set_work_item_checklist", AS_B, id=self.held, items=["one", "two"])
        self.assertIsNone(self.hook())
        step = service.get_work_item(self.conn, self.held)["checklist"][1]["id"]
        self.agent("claim_work_item_checklist_item", AS_A, id=self.held, item_id=step)
        self.agent("link_work_items", AS_A, id=self.held, other=self.followed, kind="relates-to")
        self.agent("update_work_item", AS_A, id=self.held, title="Retitled by A")
        self.agent(
            "report_work_item", AS_A, id=self.held, report={"done": "Half of it", "next": "More"}
        )
        told = self.hook()
        assert told is not None, steps
        for kind in ("step_claimed", "linked", "report"):
            self.assertIn(f"- {kind} at", told)
        self.assertNotIn("- edited at", told, "a field edit is not told")

    def test_a_lapsed_subscription_tells_nothing_more(self) -> None:
        self.set_up_b()
        self.conn.execute(
            "UPDATE sessions SET status = 'ended',"
            " ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now','-13 hours') WHERE id = ?",
            (B,),
        )
        self.conn.commit()
        housekeeping.expire_leases(self.conn)
        self.comment(AS_A, self.followed, "After the session lapsed")
        self.assertIsNone(self.hook())


class FoldTests(Harness):
    """Past three quoting notices on one item in an hour, its news is one line a call."""

    def three_notices(self) -> None:
        for number in range(1, 4):
            self.comment(AS_A, self.held, f"News {number}, marker F-{number}")
            self.assertIn(f"marker F-{number}", self.hook() or "", f"notice {number} quotes")

    def test_the_fourth_notice_on_an_item_counts_its_events_and_names_who_wrote(self) -> None:
        self.set_up_b()
        self.three_notices()
        self.comment(AS_A, self.held, "News 4, marker F-4")
        self.comment(AS_THIRD, self.held, "News 5, marker F-5")
        told = self.hook()
        assert told is not None, "folded, not dropped"
        self.assertTrue(told.startswith(FROM_AGENTS), told)
        self.assertNotIn("marker F-4", told)
        self.assertNotIn("marker F-5", told)
        self.assertRegex(
            told,
            rf"\n{self.held} «Held by B»: 2 events by session {A}, session {THIRD}, the newest"
            rf" at \S+, folded into this line after 3 notices on this item within the hour;"
            r" read the item with get_work_item for what they say\.\n",
        )
        self.comment(AS_A, self.held, "News 6, marker F-6")
        again = self.hook()
        assert again is not None
        self.assertIn(f"{self.held} «Held by B»: 1 event by session {A},", again)
        self.comment(AS_A, self.followed, "Another item, marker F-7")
        self.assertIn("marker F-7", self.hook() or "", "the count is per item")

    def test_an_hour_on_the_item_is_quoted_again(self) -> None:
        self.set_up_b()
        self.three_notices()
        later = time.time() + 3601
        with mock.patch.object(notify.time, "time", return_value=later):
            self.comment(AS_A, self.held, "An hour on, marker F-8")
            self.assertIn("marker F-8", self.hook() or "")

    def test_the_awaited_reply_and_a_persons_words_are_never_folded(self) -> None:
        self.set_up_b()
        root = self.comment(AS_B, self.held, "Which one?", awaits_reply=True)
        self.assertIsNone(self.hook())
        self.three_notices()
        self.comment(AS_A, self.held, "This one, marker F-9", reply_to=root)
        self.person(COMMENT, id=self.held, body="A person, marker F-10")
        self.comment(AS_A, self.held, "Folded, marker F-11")
        told = self.hook()
        assert told is not None
        self.assertIn("marker F-9", told, "the reply B awaited")
        self.assertIn("(the reply awaited)", told)
        self.assertIn("marker F-10", told, "a person's words")
        self.assertNotIn("marker F-11", told)
        self.assertIn("1 event by session", told)

    def test_a_question_past_the_third_notice_wakes_with_its_words(self) -> None:
        """A wake says why it came: the question that woke the session is never folded."""

        self.set_up_b()
        self.three_notices()
        self.assertIsNone(self.hook(event="stop"), "B is idle now")
        self.comment(AS_A, self.held, "Plain news, marker F-13")
        self.comment(AS_A, self.held, "Which parser, marker F-12?", awaits_reply=True)
        told = self.hook(event="stop")
        assert told is not None, "it asks for B, so it continues the turn"
        self.assertIn("This is not an error", told)
        self.assertIn("marker F-12", told, "the question, quoted")
        self.assertNotIn("marker F-13", told, "the news beside it still folds")
        self.assertIn(f"{self.held} «Held by B»: 1 event by session {A},", told)

    def test_the_notices_are_kept_beside_the_wake_budget(self) -> None:
        self.set_up_b()
        self.three_notices()
        item = str(service.get_work_item(self.conn, self.held)["work_item_id"])
        lines = self.marks().decode("ascii").splitlines()
        told = [line.split() for line in lines if line.startswith("@told ")]
        self.assertEqual([["@told", item]], [line[:2] for line in told], lines)
        self.assertEqual(3, len(told[0]) - 2, "one time per quoting notice")
        path = os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY, B + ".marks")
        self.assertEqual(3, len(notify.read_state(path)[1][3][item]))


class FitTests(Harness):
    def test_a_waking_question_keeps_its_place_among_newer_news(self) -> None:
        """A notice holds 8 events: what woke the session takes its room before the newest."""

        self.set_up_b()
        self.assertIsNone(self.hook(event="stop"), "B is idle now")
        self.comment(AS_A, self.held, "Which parser, marker FIT-Q?", awaits_reply=True)
        for number in range(8):
            self.comment(AS_A, self.held, f"Plain news {number}, marker FIT-{number}")
        told = self.hook(event="stop")
        assert told is not None, "the question asks for B, so it continues the turn"
        self.assertIn("marker FIT-Q", told, "the reason for the wake")
        self.assertIn("marker FIT-7", told, "the newest news")
        self.assertNotIn("marker FIT-0", told, "the oldest plain news gives way")
        self.assertEqual(8, told.count("\n- comment at "), "a notice's eight events")
        self.assertLess(told.index("marker FIT-Q"), told.index("marker FIT-1"), "in order")
        self.assertIn("- and 1 more, in the history of the item.", told)


class LapseTests(Harness):
    """A subscription that lapsed with its session tells nothing, swept or not yet."""

    def lapse(self, change: str) -> tuple[str, str]:
        self.subscribe(AS_CHILD, self.followed, True)
        self.assertIsNone(self.hook())
        self.assertIsNone(self.hook(CHILD))
        self.conn.execute(f"UPDATE sessions SET {change} WHERE id = ?", (B,))
        self.conn.commit()
        self.listed = service.get_work_item(self.conn, self.followed)["subscribers"]
        self.comment(AS_A, self.followed, "After the lapse, marker LP-1")
        return self.hook(CHILD) or "", self.hook() or ""

    def test_a_lapsed_subscription_is_not_told_before_the_sweep(self) -> None:
        for case, change in {
            "ended past its grace": "status = 'ended',"
            " ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-13 hours')",
            "failed": "status = 'failed', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
            "silent past the lease": "last_seen = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-15 days')",
        }.items():
            with self.subTest(case):
                self.setUp()
                self.assertEqual(("", ""), self.lapse(change))
                self.assertEqual([], self.listed, "the card lists nobody either")

    def test_a_session_back_within_its_grace_still_hears_what_it_follows(self) -> None:
        child, orchestrator = self.lapse(
            "status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 hours')"
        )
        self.assertIn("marker LP-1", child)
        self.assertIn("marker LP-1", orchestrator)
        self.assertEqual([CHILD], [entry["agent"] for entry in self.listed])

    def test_the_hook_reads_the_lease_periods_the_planning_rule_has(self) -> None:
        from server.planning import leases

        self.assertEqual(leases.LEASE_PERIOD.total_seconds(), notify.LEASE_SECONDS)
        self.assertEqual(leases.ENDED_GRACE.total_seconds(), notify.ENDED_GRACE_SECONDS)


class UpgradeTests(Harness):
    def test_a_store_without_the_new_table_tells_nothing_and_loses_nothing(self) -> None:
        """A hook of a new release can meet a store that release has not opened yet."""

        self.set_up_b()
        self.comment(AS_A, self.held, "Waiting for the upgrade")
        before = self.marks()
        self.conn.execute("DROP TABLE work_item_subscriptions")
        self.conn.commit()
        self.assertIsNone(self.hook())
        self.assertEqual(before, self.marks(), "no place moved")
        store.connect().close()
        self.assertIn("Waiting for the upgrade", self.hook() or "")


class CostTests(Harness):
    def statements(self) -> list[str]:
        conn = notify._connect(self.path)
        assert conn is not None
        self.addCleanup(conn.close)
        seen: list[str] = []
        conn.set_trace_callback(seen.append)
        state = os.path.join(os.path.dirname(self.path), notify.STATE_DIRECTORY)
        notify.collect(conn, state, B, None)
        return seen

    def test_nothing_new_with_a_subscription_is_still_two_indexed_reads(self) -> None:
        self.set_up_b()
        self.subscribe(AS_CHILD, self.held, True)
        self.assertIsNone(self.hook())
        seen = self.statements()
        self.assertEqual(2, len(seen), seen)
        self.assertFalse([sql for sql in seen if "JOIN execution_events" in sql], seen)
        plan = " ".join(str(row[3]) for row in self.conn.execute("EXPLAIN QUERY PLAN " + seen[1]))
        self.assertNotIn("SCAN u", plan, "the subscriptions are read by their key")
        self.assertIn("work_item_subscriptions", plan)
        scope = " ".join(str(row[3]) for row in self.conn.execute("EXPLAIN QUERY PLAN " + seen[0]))
        self.assertIn("work_item_subscriptions_session", scope, "and the session's rows by its")
        self.assertNotIn("SCAN work_item_subscriptions", scope)
        self.assertNotIn("SCAN execution_events", scope)


if __name__ == "__main__":
    unittest.main()
