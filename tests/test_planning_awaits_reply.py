"""A comment can say it waits for a reply, and a read says whether one came.

An agent asks with `awaits_reply: true` on `comment_work_item` or on the batch's
`comment` and `comments`, beside `mentions` too. `get_work_item` shows the flag on
that comment and `answered`: whether a later reply in its thread came from a person
or from a confirmed session other than the asker's. The asker's own session,
subagents included, does not answer itself. A comment that does not wait carries
neither key. What the flag makes the hook do is in `test_hooks_agent_wakes`.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import api, calls, model, service

A = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
B = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
AS_A = {"sessionId": A}
AS_A_CHILD = {"sessionId": A, "threadId": CHILD}
AS_B = {"sessionId": B}
COMMENT = "/api/planning/work-item/comment"


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
        service.create_planning_space(self.conn, project_id="p", name="Crew", key="MAIN")
        self.ref = str(
            service.create_work_item(self.conn, space="MAIN", title="Asked")["reference"]
        )
        self.other = str(
            service.create_work_item(self.conn, space="MAIN", title="Named")["reference"]
        )
        self.conn.commit()

    def agent(self, tool: str, meta: object, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, tool, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def ask(self, meta: object = AS_A, **extra: object) -> int:
        answer = self.agent(
            "comment_work_item", meta, id=self.ref, body="Which one?", awaits_reply=True, **extra
        )
        return int(answer["comment_id"])

    def reply(self, meta: object, root: int) -> None:
        self.agent("comment_work_item", meta, id=self.ref, body="This one", reply_to=root)

    def person_reply(self, root: int) -> None:
        with calls.bind(calls.browser(), COMMENT):
            api.handle_post(self.conn, COMMENT, {"id": self.ref, "body": "Mine", "reply_to": root})
        self.conn.commit()

    def comment(self, identity: int) -> dict:
        item = service.get_work_item(self.conn, self.ref, thread=identity)
        return next(entry for entry in item["comments"] if entry["id"] == identity)


class AwaitsReplyTests(Harness):
    def test_an_awaiting_comment_is_answered_by_another_session_not_its_own(self) -> None:
        root = self.ask()
        self.assertEqual(
            (True, False), (self.comment(root)["awaits_reply"], self.comment(root)["answered"])
        )
        self.reply(AS_A, root)
        self.reply(AS_A_CHILD, root)
        self.assertFalse(self.comment(root)["answered"], "its own session does not answer it")
        self.reply(AS_B, root)
        self.assertTrue(self.comment(root)["answered"])
        listed = service.get_work_item(self.conn, self.ref)["comments"]
        self.assertTrue(next(entry for entry in listed if entry["id"] == root)["answered"])
        threads = service.get_work_item(self.conn, self.ref, threads=5)["comments"]
        self.assertTrue(threads[0]["answered"], "the read by threads says the same")

    def test_a_person_answers_too(self) -> None:
        root = self.ask()
        self.person_reply(root)
        self.assertTrue(self.comment(root)["answered"])

    def test_an_awaiting_reply_is_answered_only_by_what_comes_after_it(self) -> None:
        root = self.agent("comment_work_item", AS_B, id=self.ref, body="Started by B")
        self.reply(AS_B, int(root["comment_id"]))
        asked = self.ask(reply_to=int(root["comment_id"]))
        self.assertFalse(self.comment(asked)["answered"], "B's earlier reply came before")
        self.reply(AS_B, int(root["comment_id"]))
        self.assertTrue(self.comment(asked)["answered"])

    def test_a_plain_comment_carries_neither_key(self) -> None:
        plain = self.agent("comment_work_item", AS_A, id=self.ref, body="Just so you know")
        record = self.comment(int(plain["comment_id"]))
        self.assertNotIn("awaits_reply", record)
        self.assertNotIn("answered", record)

    def test_the_batch_asks_beside_mentions_in_comment_and_comments(self) -> None:
        one = self.agent(
            "apply_work_item_changes",
            AS_A,
            id=self.ref,
            comment={"body": "Over there?", "awaits_reply": True, "mentions": [self.other]},
        )
        many = self.agent(
            "apply_work_item_changes",
            AS_A,
            id=self.ref,
            comments=[{"body": "And this?", "awaits_reply": True}, {"body": "Plain"}],
        )
        asked = [int(one["applied"]["comment"]["comment_id"])] + [
            int(entry["comment_id"]) for entry in many["applied"]["comments"]
        ]
        self.assertEqual(
            [True, True, False], [self.comment(n).get("awaits_reply", False) for n in asked]
        )
        self.assertEqual([self.other], self.comment(asked[0])["mentions"])

    def test_anything_but_a_boolean_is_refused_before_a_write(self) -> None:
        count = "SELECT COUNT(*) FROM work_item_comments"
        before = self.conn.execute(count).fetchone()[0]
        for value in ("yes", 1, None):
            with self.subTest(value=value):
                arguments = {"id": self.ref, "body": "Hm", "awaits_reply": value}
                with self.assertRaises((model.PlanningError, api.PlanningHttpError)):
                    mcp_surface.call_tool(self.conn, "comment_work_item", arguments, meta=AS_A)
                self.conn.rollback()
        self.assertEqual(before, self.conn.execute(count).fetchone()[0])


if __name__ == "__main__":
    unittest.main()
