"""Discussion threads: a comment is a root, a reply stands under one, one level deep.

The guarantees here are what an agent and the card rely on: a reply lands under
the root of whatever it answered and the acknowledgement names that root; the
default read shows the threads with the newest activity, so a reply in an old
thread is not lost behind newer roots; `comments_after` stays the flat
"everything since" read; a merge moves a thread whole and leaves a report's
thread where the report is.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.ops import export
from server.planning import api, calls, model, read_model, requests, service

SPACE = "TALK"
FIELDS = [{"id": "path", "label": "Which path?", "type": "text", "required": True, "options": []}]


class ThreadTestCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3"),
                "HOME": directory.name,
                "USERPROFILE": directory.name,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="threads", name="Threads", key=SPACE)
        self.ref = self.item("A discussed change")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(service.create_work_item(self.conn, space=SPACE, title=title)["reference"])

    def comment(self, body: str, reference: str | None = None, **parents: object) -> dict:
        answer = service.comment_work_item(self.conn, reference or self.ref, body, **parents)
        self.conn.commit()
        return answer

    def question(self, reference: str | None = None) -> str:
        created = requests.create(
            self.conn, reference or self.ref, kind="question", prompt="Which?", fields=FIELDS
        )
        self.conn.commit()
        return str(created["request_id"])

    def stored(self, comment_id: int) -> sqlite3.Row:
        row = self.conn.execute(
            "SELECT * FROM work_item_comments WHERE id = ?", (comment_id,)
        ).fetchone()
        assert row is not None
        return row

    def call(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments)
        assert isinstance(answer, dict)
        return answer

    def read(self, parameters: dict[str, list[str]]) -> dict:
        handled = api.handle_get(
            self.conn, "/api/planning/work-item", {"id": [self.ref], **parameters}
        )
        assert handled is not None
        return dict(handled[1]["work_item"])

    def count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0])


class ReplyWriteTests(ThreadTestCase):
    def test_a_root_answers_as_before_and_a_reply_names_its_root(self) -> None:
        root = self.comment("Which parser?")
        self.assertEqual(
            {"work_item", "comment_count", "comment_id", "reply_to", "reply_to_request"},
            set(root),
        )
        self.assertEqual((None, None), (root["reply_to"], root["reply_to_request"]))
        reply = self.comment("The new one.", reply_to=root["comment_id"])
        self.assertEqual(
            (root["comment_id"], None, 2),
            (reply["reply_to"], reply["reply_to_request"], reply["comment_count"]),
        )
        first, second = service.get_work_item(self.conn, self.ref)["comments"]
        self.assertEqual((None, None), (first["reply_to"], first["reply_to_request"]))
        self.assertEqual(
            (root["comment_id"], None), (second["reply_to"], second["reply_to_request"])
        )

    def test_a_reply_to_a_reply_joins_the_root_of_that_reply(self) -> None:
        root = self.comment("Root")
        first = self.comment("First reply", reply_to=root["comment_id"])
        second = self.comment("Answering the reply", reply_to=first["comment_id"])
        self.assertEqual(root["comment_id"], second["reply_to"])
        self.assertEqual(root["comment_id"], self.stored(second["comment_id"])["reply_to"])

    def test_a_report_is_a_root_and_takes_replies(self) -> None:
        reported = service.report_work_item(self.conn, self.ref, {"done": "built", "next": "check"})
        report_id = reported["comments"][-1]["id"]
        reply = self.comment("Checked; one gap.", reply_to=report_id)
        self.assertEqual(report_id, reply["reply_to"])

    def test_a_reply_to_a_question_and_a_reply_to_that_reply_stand_under_the_question(
        self,
    ) -> None:
        request_id = self.question()
        reply = self.comment("Does it cover the CLI?", reply_to_request=request_id)
        self.assertEqual((None, request_id), (reply["reply_to"], reply["reply_to_request"]))
        again = self.comment("It does.", reply_to=reply["comment_id"])
        self.assertEqual((None, request_id), (again["reply_to"], again["reply_to_request"]))
        row = self.stored(again["comment_id"])
        self.assertEqual((None, request_id), (row["reply_to"], row["reply_to_request"]))

    def test_what_cannot_be_a_reply_is_refused_and_writes_nothing(self) -> None:
        root = self.comment("Root")
        other = self.item("Elsewhere")
        elsewhere = self.comment("Not here", reference=other)
        foreign_question = self.question(other)
        step = service.set_checklist(self.conn, self.ref, ["verify"])["checklist"][0]
        self.conn.commit()
        before = self.count()
        for parents, wanted in (
            (
                {"reply_to": root["comment_id"], "reply_to_request": foreign_question},
                "reply_to and reply_to_request exclude each other",
            ),
            ({"reply_to": 999999}, f"comment 999999 is not on {self.ref}"),
            (
                {"reply_to": elsewhere["comment_id"]},
                f"comment {elsewhere['comment_id']} is not on {self.ref}",
            ),
            (
                {"reply_to_request": "no-such-question"},
                f"question no-such-question is not on {self.ref}",
            ),
            (
                {"reply_to_request": foreign_question},
                f"question {foreign_question} is not on {self.ref}",
            ),
            (
                {"reply_to": root["comment_id"], "checklist_item_id": step["id"]},
                "a reply carries no checklist step; its root does",
            ),
            ({"reply_to": 0}, "reply_to must be a positive integer"),
        ):
            with self.subTest(parents=parents):
                with self.assertRaises(model.PlanningError) as refusal:
                    service.comment_work_item(self.conn, self.ref, "reply", **parents)
                self.assertEqual(wanted, str(refusal.exception))
                self.conn.rollback()
                self.assertEqual(before, self.count())

    def test_the_http_write_takes_the_parents_and_refuses_their_wrong_types(self) -> None:
        root = self.comment("Root")
        handled = api.handle_post(
            self.conn,
            "/api/planning/work-item/comment",
            {"id": self.ref, "body": "Reply", "reply_to": root["comment_id"]},
        )
        assert handled is not None
        self.assertEqual(root["comment_id"], handled[1]["reply_to"])
        for payload, wanted in (
            ({"reply_to": "12"}, "reply_to must be an integer"),
            ({"reply_to": True}, "reply_to must be an integer"),
            ({"reply_to_request": 12}, "reply_to_request must be a string"),
        ):
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(api.PlanningHttpError, wanted):
                    api.handle_post(
                        self.conn,
                        "/api/planning/work-item/comment",
                        {"id": self.ref, "body": "Reply", **payload},
                    )

    def test_the_tool_and_the_batch_reply_and_say_under_which_root(self) -> None:
        root = self.comment("Root")
        first = self.call("comment_work_item", id=self.ref, body="One", reply_to=root["comment_id"])
        self.assertEqual(root["comment_id"], first["reply_to"])
        batch = self.call(
            "apply_work_item_changes",
            id=self.ref,
            comment={"body": "Two", "reply_to": first["comment_id"]},
        )
        applied = batch["applied"]["comment"]
        self.assertEqual(root["comment_id"], applied["reply_to"])
        self.assertEqual(root["comment_id"], self.stored(applied["comment_id"])["reply_to"])

    def test_a_report_takes_no_parent(self) -> None:
        root = self.comment("Root")
        with self.assertRaisesRegex(api.PlanningHttpError, "reply_to"):
            self.call(
                "report_work_item",
                id=self.ref,
                report={"done": "d", "next": "n"},
                reply_to=root["comment_id"],
            )

    def test_a_resolved_root_carries_its_mark_in_every_read_and_a_reply_none(self) -> None:
        root = self.comment("Decide the parser")["comment_id"]
        reply = self.comment("Take the new one", reply_to=root)["comment_id"]
        open_root = self.comment("Still open")["comment_id"]
        # The resolve write is another change's; the read shows what the columns hold.
        self.conn.execute(
            "UPDATE work_item_comments SET resolved_at = ?, resolved_by = ?, resolution = ?"
            " WHERE id = ?",
            ("2026-11-03T11:30:00.000000Z", "user", "Took the new parser", root),
        )
        self.conn.commit()
        mark = {
            "at": "2026-11-03T11:30:00.000000Z",
            "by": "user",
            "by_person": None,
            "text": "Took the new parser",
        }
        wanted = {root: mark, reply: None, open_root: None}
        for name, arguments in (
            ("full", {"full": True}),
            ("default", {}),
            ("thread", {"thread": reply}),
            ("comments_after", {"comments_after": 0}),
        ):
            with self.subTest(read=name):
                comments = self.call("get_work_item", id=self.ref, **arguments)["comments"]
                self.assertEqual(
                    {c["id"]: wanted[c["id"]] for c in comments},
                    {c["id"]: c["resolution"] for c in comments},
                )

    def test_by_person_says_whether_the_interface_wrote_the_comment(self) -> None:
        self.comment("Runner note, no call")
        with calls.bind(calls.browser(), "/api/planning/work-item/comment"):
            self.comment("By hand")
        self.call("comment_work_item", id=self.ref, body="By an agent")
        self.assertEqual(
            [None, True, False],
            [c["by_person"] for c in service.get_work_item(self.conn, self.ref)["comments"]],
        )


class ThreadReadTests(ThreadTestCase):
    """The modes of get_work_item over one item with seven threads."""

    def setUp(self) -> None:
        super().setUp()
        self.roots = [self.comment(f"root {number}")["comment_id"] for number in range(7)]
        self.request_id = self.question()
        self.on_question = self.comment("about the question", reply_to_request=self.request_id)[
            "comment_id"
        ]
        # The oldest thread gets the newest activity.
        self.reply = self.comment("late reply", reply_to=self.roots[0])["comment_id"]

    def test_the_default_read_is_the_threads_with_the_newest_activity(self) -> None:
        answer = self.call("get_work_item", id=self.ref)
        self.assertEqual(
            [self.roots[3], self.roots[4], self.roots[5], self.roots[6], self.roots[0]],
            [comment["id"] for comment in answer["comments"]],
        )
        lifted = answer["comments"][-1]
        self.assertEqual(1, lifted["replies"])
        self.assertEqual({"id", "author", "by_person", "at", "body"}, set(lifted["last_reply"]))
        self.assertEqual(
            (self.reply, "late reply"), (lifted["last_reply"]["id"], lifted["last_reply"]["body"])
        )
        self.assertEqual(
            (0, None), (answer["comments"][0]["replies"], answer["comments"][0]["last_reply"])
        )
        self.assertEqual(
            (9, 7, True),
            (answer["comments_total"], answer["threads_total"], answer["history_truncated"]),
        )

    def test_a_short_discussion_is_whole_in_the_default_read(self) -> None:
        reference = self.item("Short")
        root = self.comment("only", reference=reference)["comment_id"]
        self.comment("and its reply", reference=reference, reply_to=root)
        answer = self.call("get_work_item", id=reference)
        self.assertEqual([root], [comment["id"] for comment in answer["comments"]])
        self.assertEqual(
            (2, 1, False),
            (answer["comments_total"], answer["threads_total"], answer["history_truncated"]),
        )

    def test_thread_reads_a_root_and_its_replies_from_either_end(self) -> None:
        second = self.comment("second reply", reply_to=self.roots[0])["comment_id"]
        for named in (self.roots[0], self.reply, second):
            with self.subTest(named=named):
                answer = self.call("get_work_item", id=self.ref, thread=named)
                self.assertEqual(
                    [self.roots[0], self.reply, second],
                    [comment["id"] for comment in answer["comments"]],
                )
                self.assertEqual((10, 7), (answer["comments_total"], answer["threads_total"]))

    def test_thread_refuses_what_is_not_a_comment_thread_of_this_item(self) -> None:
        other = self.item("Elsewhere")
        elsewhere = self.comment("not here", reference=other)["comment_id"]
        for named, wanted in (
            (elsewhere, f"comment {elsewhere} is not on {self.ref}"),
            (
                self.on_question,
                f"comment {self.on_question} answers question {self.request_id};"
                " get_work_item_request reads that thread",
            ),
        ):
            with self.subTest(named=named):
                with self.assertRaises(model.PlanningError) as refusal:
                    self.call("get_work_item", id=self.ref, thread=named)
                self.assertEqual(wanted, str(refusal.exception))

    def test_comments_after_is_flat_and_names_every_parent(self) -> None:
        answer = self.call("get_work_item", id=self.ref, comments_after=self.roots[6])
        self.assertEqual(
            [
                (self.on_question, None, self.request_id),
                (self.reply, self.roots[0], None),
            ],
            [(c["id"], c["reply_to"], c["reply_to_request"]) for c in answer["comments"]],
        )
        self.assertNotIn("replies", answer["comments"][0])
        self.assertEqual((9, 7), (answer["comments_total"], answer["threads_total"]))

    def test_full_is_every_comment_flat_without_counters(self) -> None:
        answer = self.call("get_work_item", id=self.ref, full=True)
        self.assertEqual(9, len(answer["comments"]))
        self.assertNotIn("threads_total", answer)
        self.assertEqual(service.get_work_item(self.conn, self.ref)["comments"], answer["comments"])

    def test_the_reads_that_exclude_each_other_are_refused(self) -> None:
        for extra, wanted in (
            ({"full": True, "thread": self.roots[0]}, "full and thread exclude each other"),
            (
                {"comments_after": 1, "thread": self.roots[0]},
                "thread and comments_after exclude each other",
            ),
            ({"full": True, "comments_after": 1}, "full and comments_after exclude each other"),
            ({"thread": 0}, "thread must be a positive integer"),
        ):
            with self.subTest(extra=extra):
                with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as refusal:
                    self.call("get_work_item", id=self.ref, **extra)
                self.assertIn(wanted, str(refusal.exception))

    def test_the_http_read_takes_threads_and_thread_and_refuses_mixing_them(self) -> None:
        threads = self.read({"threads": ["2"]})
        self.assertEqual([self.roots[6], self.roots[0]], [c["id"] for c in threads["comments"]])
        thread = self.read({"thread": [str(self.reply)]})
        self.assertEqual([self.roots[0], self.reply], [c["id"] for c in thread["comments"]])
        for parameters, wanted in (
            ({"thread": [str(self.reply)], "comments": ["2"]}, "thread and comments exclude"),
            ({"thread": [str(self.reply)], "threads": ["2"]}, "thread and threads exclude"),
            ({"threads": ["2"], "comments": ["2"]}, "threads and comments exclude"),
            ({"threads": ["2"], "comments_after": ["1"]}, "threads and comments_after exclude"),
        ):
            with self.subTest(parameters=parameters):
                with self.assertRaisesRegex(model.PlanningError, wanted):
                    self.read(parameters)
        # Without a cut the read is the complete flat record, as the card reads it.
        self.assertEqual(service.get_work_item(self.conn, self.ref), self.read({}))

    def test_search_finds_an_item_by_what_a_reply_says(self) -> None:
        found = service.search_work_items(self.conn, "late reply", space=SPACE)
        self.assertEqual(
            [(self.ref, "late reply")], [(f["reference"], f["comment_hit"]) for f in found]
        )

    def test_the_export_carries_each_comments_parent(self) -> None:
        payload = json.loads(export.render(export.export_installation(self.conn)))
        (item,) = payload["planning"]["work_items"]
        parents = {c["id"]: (c["reply_to"], c["reply_to_request"]) for c in item["comments"]}
        self.assertEqual((self.roots[0], None), parents[self.reply])
        self.assertEqual((None, self.request_id), parents[self.on_question])
        self.assertEqual((None, None), parents[self.roots[0]])


_REPLY = {"id": 4, "author": "one", "by_person": True, "at": "2026-11-03T10:00:00Z"}


class LastReplyTests(unittest.TestCase):
    """The compact form of a thread's newest reply, a pure function of the reply."""

    def test_a_short_body_is_whole_and_says_nothing_about_clipping(self) -> None:
        reply = {**_REPLY, "body": "x" * read_model.LAST_REPLY_LIMIT, "kind": "comment"}
        self.assertEqual(
            {**_REPLY, "body": "x" * read_model.LAST_REPLY_LIMIT}, read_model.last_reply(reply)
        )

    def test_a_long_body_is_cut_and_says_so(self) -> None:
        reply = {**_REPLY, "body": "y" * (read_model.LAST_REPLY_LIMIT + 1)}
        self.assertEqual(
            {**_REPLY, "body": "y" * read_model.LAST_REPLY_LIMIT, "clipped": True},
            read_model.last_reply(reply),
        )

    def test_no_reply_is_none(self) -> None:
        self.assertIsNone(read_model.last_reply(None))


class ThreadMergeTests(ThreadTestCase):
    def test_a_merge_moves_threads_whole_and_leaves_a_reports_thread_with_it(self) -> None:
        merged = self.item("Same change")
        root = self.comment("seen it", reference=merged)["comment_id"]
        reply = self.comment("me too", reference=merged, reply_to=root)["comment_id"]
        reported = service.report_work_item(self.conn, merged, {"done": "looked", "next": "fix"})
        report = reported["comments"][-1]["id"]
        on_report = self.comment("good report", reference=merged, reply_to=report)["comment_id"]
        request_id = self.question(merged)
        on_question = self.comment("which one?", reference=merged, reply_to_request=request_id)[
            "comment_id"
        ]
        handled = api.handle_post(
            self.conn, "/api/planning/work-item/merge", {"id": self.ref, "items": [merged]}
        )
        assert handled is not None
        self.conn.commit()
        (entry,) = handled[1]["merged"]
        self.assertEqual(3, entry["moved"]["comments"])
        survivor = service.get_work_item(self.conn, self.ref)["work_item_id"]
        left = service.get_work_item(self.conn, merged)["work_item_id"]
        homes = {
            row["id"]: row["work_item_id"]
            for row in self.conn.execute("SELECT id, work_item_id FROM work_item_comments")
        }
        self.assertEqual(
            {root: survivor, reply: survivor, on_question: survivor, report: left, on_report: left},
            {key: homes[key] for key in (root, reply, on_question, report, on_report)},
        )
        self.assertEqual(root, self.stored(reply)["reply_to"])
        # No reply is left on another item than its parent.
        self.assertEqual(
            [],
            self.conn.execute(
                "SELECT r.id FROM work_item_comments r"
                " LEFT JOIN work_item_comments p ON p.id = r.reply_to"
                " LEFT JOIN work_item_requests q ON q.request_id = r.reply_to_request"
                " WHERE COALESCE(p.work_item_id, q.work_item_id) != r.work_item_id"
            ).fetchall(),
        )


if __name__ == "__main__":
    unittest.main()
