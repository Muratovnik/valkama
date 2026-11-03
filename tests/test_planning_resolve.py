"""The resolved mark: a thread's root is marked with a short decision, and the mark comes off.

Expected values come from the connection contract. What an agent and the card rely
on: a mark goes on a root and nowhere else, leaves the item's revision alone and
the history says who set it; `unresolved` walks every open root in pages that a
mark set meanwhile does not shift; a batch of marks is one write, all or nothing;
and the card's "reply and mark" works as two plain writes in a row.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.ops import export
from server.planning import api, calls, model, service, tools
from server.projects import scopes
from tests import schema9
from tests.test_planning_threads import SPACE, ThreadTestCase

RESOLVE = "/api/planning/work-item/comment/resolve"


class ResolveCase(ThreadTestCase):
    def mark(self, comment_id: int, *, reference: str | None = None, **others: object) -> dict:
        """A mark set outside any call, for what a test only stands on."""

        answer = service.resolve_comment(self.conn, reference or self.ref, comment_id, **others)
        self.conn.commit()
        return answer

    def http(self, path: str, **payload: object) -> dict:
        """A write as the HTTP surface makes it, bound to the interface."""

        with calls.bind(calls.browser(), path):
            handled = api.handle_post(self.conn, path, payload)
        assert handled is not None
        self.conn.commit()
        return handled[1]

    def tool(self, name: str, **arguments: object) -> dict:
        answer = self.call(name, **arguments)
        self.conn.commit()
        return answer

    def history(self, reference: str | None = None) -> list[tuple[str, str]]:
        events = service.get_work_item(self.conn, reference or self.ref)["events"]
        return [
            (event["action"], event["detail"])
            for event in events
            if event["action"] in ("comment_resolved", "comment_reopened")
        ]

    def revision(self) -> int:
        return int(service.get_work_item(self.conn, self.ref)["revision"])

    def resolution(self, comment_id: int) -> object:
        for comment in service.get_work_item(self.conn, self.ref)["comments"]:
            if comment["id"] == comment_id:
                return comment["resolution"]
        raise AssertionError(f"no comment {comment_id}")


class MarkTests(ResolveCase):
    def test_a_mark_answers_as_it_stands_and_the_history_says_so(self) -> None:
        root = self.comment("The export leaves out claims.")["comment_id"]
        before = self.revision()
        answer = self.tool(
            "resolve_work_item_comment",
            id=self.ref,
            comment_id=root,
            resolution="Moved to MAIN-14",
            author="codex",
        )
        self.assertEqual({"work_item", "comment_id", "resolution"}, set(answer))
        self.assertEqual((self.ref, root), (answer["work_item"], answer["comment_id"]))
        mark = answer["resolution"]
        self.assertEqual({"at", "by", "by_person", "text"}, set(mark))
        self.assertEqual(
            ("codex", False, "Moved to MAIN-14"), (mark["by"], mark["by_person"], mark["text"])
        )
        self.assertEqual(mark, self.resolution(root))
        self.assertEqual([("comment_resolved", f"{root}: Moved to MAIN-14")], self.history())
        self.assertEqual(before, self.revision())

    def test_removing_the_mark_empties_it_and_the_history_keeps_both(self) -> None:
        root = self.comment("Decide the parser")["comment_id"]
        self.mark(root, resolution="The new one")
        before = self.revision()
        answer = self.tool("resolve_work_item_comment", id=self.ref, comment_id=root, reopen=True)
        self.assertEqual({"work_item": self.ref, "comment_id": root, "resolution": None}, answer)
        stored = self.stored(root)
        self.assertEqual(
            (None, "", "", None),
            (
                stored["resolved_at"],
                stored["resolved_by"],
                stored["resolution"],
                stored["resolved_call_id"],
            ),
        )
        self.assertEqual(
            [("comment_resolved", f"{root}: The new one"), ("comment_reopened", str(root))],
            self.history(),
        )
        self.assertEqual(before, self.revision())

    def test_marking_again_replaces_the_decision_and_is_a_new_mark(self) -> None:
        root = self.comment("Decide")["comment_id"]
        self.mark(root, resolution="Postponed", author="first")
        answer = self.mark(root, resolution="Declined", author="second")
        self.assertEqual(("second", "Declined"), (answer["resolution"]["by"], self.decision(root)))
        self.assertEqual(
            [("comment_resolved", f"{root}: Postponed"), ("comment_resolved", f"{root}: Declined")],
            self.history(),
        )

    def decision(self, comment_id: int) -> str:
        mark = self.resolution(comment_id)
        assert isinstance(mark, dict)
        return str(mark["text"])

    def test_reopening_a_root_without_a_mark_writes_nothing(self) -> None:
        root = self.comment("Open")["comment_id"]
        answer = self.mark(root, reopen=True)
        self.assertIsNone(answer["resolution"])
        self.assertEqual([], self.history())

    def test_a_decision_may_be_blank_and_is_cut_to_one_line_of_280(self) -> None:
        for given in ({"resolution": ""}, {}, {"resolution": "   "}):
            with self.subTest(given=given):
                root = self.comment("Blank")["comment_id"]
                answer = self.mark(root, **given)
                self.assertEqual("", answer["resolution"]["text"])
                self.assertEqual(("comment_resolved", str(root)), self.history()[-1])
        root = self.comment("Longest")["comment_id"]
        self.assertEqual(
            "d" * 280, self.mark(root, resolution=" " + "d" * 280 + "\n")["resolution"]["text"]
        )

    def test_a_report_is_a_root_and_takes_a_mark(self) -> None:
        reported = service.report_work_item(self.conn, self.ref, {"done": "built", "next": "check"})
        report = reported["comments"][-1]["id"]
        self.assertEqual("Read", self.mark(report, resolution="Read")["resolution"]["text"])

    def test_a_mark_says_whether_the_interface_set_it(self) -> None:
        by_hand = self.comment("One")["comment_id"]
        by_agent = self.comment("Two")["comment_id"]
        no_call = self.comment("Three")["comment_id"]
        self.http(RESOLVE, id=self.ref, comment_id=by_hand, resolution="Done", author="anyone")
        self.tool(
            "resolve_work_item_comment",
            id=self.ref,
            comment_id=by_agent,
            author=calls.OWNER_ACTOR,
        )
        self.mark(no_call)
        self.assertEqual(
            [True, False, None],
            [self.by_person(comment) for comment in (by_hand, by_agent, no_call)],
        )

    def by_person(self, comment_id: int) -> object:
        mark = self.resolution(comment_id)
        assert isinstance(mark, dict)
        return mark["by_person"]

    def test_a_write_that_names_nobody_through_the_interface_is_the_owners(self) -> None:
        root = self.comment("Mine")["comment_id"]
        answer = self.http(RESOLVE, id=self.ref, comment_id=root)
        self.assertEqual(calls.OWNER_ACTOR, answer["resolution"]["by"])

    def test_the_tool_is_published_as_a_write_with_its_fields(self) -> None:
        tool = next(t for t in tools.TOOLS if t["name"] == "resolve_work_item_comment")
        self.assertIs(False, tool["annotations"]["destructiveHint"])
        schema = tool["inputSchema"]
        self.assertEqual(
            {"id", "comment_id", "resolution", "reopen", "author"}, set(schema["properties"])
        )
        self.assertEqual(["id", "comment_id"], schema["required"])

    def test_a_merge_carries_the_mark_with_its_root(self) -> None:
        merged = self.item("Same change")
        root = self.comment("Seen", reference=merged)["comment_id"]
        mark = self.mark(root, reference=merged, resolution="Fixed")["resolution"]
        service.merge_work_items(self.conn, self.ref, [merged], author="merging-agent")
        self.conn.commit()
        self.assertEqual(mark, self.resolution(root))
        self.assertIsNone(self.mark(root, reopen=True)["resolution"])

    def test_an_export_carries_the_mark_and_its_event(self) -> None:
        root = self.comment("Exported")["comment_id"]
        self.mark(root, resolution="Kept")
        payload = json.loads(export.render(export.export_installation(self.conn)))
        (item,) = payload["planning"]["work_items"]
        (comment,) = item["comments"]
        self.assertEqual("Kept", comment["resolution"]["text"])
        self.assertIn("comment_resolved", [event["action"] for event in item["events"]])


class RefusalTests(ResolveCase):
    def setUp(self) -> None:
        super().setUp()
        self.root = self.comment("Root")["comment_id"]
        self.reply = self.comment("Reply", reply_to=self.root)["comment_id"]
        self.request_id = self.question()
        self.on_question = self.comment("About it", reply_to_request=self.request_id)["comment_id"]
        other = self.item("Elsewhere")
        self.elsewhere = self.comment("Not here", reference=other)["comment_id"]

    def refusal(self, **payload: object) -> tuple[int, dict]:
        """How the boundary refuses a write, having left nothing behind."""

        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as refused:
            self.http(RESOLVE, id=self.ref, **payload)
        self.conn.commit()
        self.assertEqual([], self.history())
        marks = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_comments WHERE resolved_at IS NOT NULL"
        ).fetchone()[0]
        self.assertEqual(0, marks)
        status, body = api.error_response(refused.exception)
        return status, body["error"]

    def test_what_is_no_root_of_this_item_is_refused_naming_why(self) -> None:
        for comment_id, code, status, message in (
            (
                self.reply,
                "invalid_request",
                400,
                f"comment {self.reply} is a reply; mark its root, comment {self.root}",
            ),
            (
                self.on_question,
                "invalid_request",
                400,
                f"comment {self.on_question} answers question {self.request_id};"
                " a question has its own status and no mark",
            ),
            (
                self.elsewhere,
                "invalid_request",
                400,
                f"comment {self.elsewhere} is not on {self.ref}",
            ),
            (999999, "not_found", 404, "no comment 999999"),
        ):
            with self.subTest(comment_id=comment_id):
                found_status, error = self.refusal(comment_id=comment_id)
                self.assertEqual(
                    (status, code, message), (found_status, error["code"], error["message"])
                )

    def test_what_is_no_decision_is_refused(self) -> None:
        for extra, message in (
            ({"resolution": "d" * 281}, "resolution must be at most 280 characters"),
            ({"resolution": "first\nsecond"}, "resolution must be one line"),
            ({"resolution": "first\rsecond"}, "resolution must not contain control characters"),
            ({"resolution": 7}, "resolution must be a string"),
            ({"resolution": "x", "reopen": True}, "resolution and reopen exclude each other"),
            ({"resolution": "", "reopen": True}, "resolution and reopen exclude each other"),
            ({"reopen": "yes"}, "reopen must be a boolean"),
        ):
            with self.subTest(extra=extra):
                _, error = self.refusal(comment_id=self.root, **extra)
                self.assertEqual(("invalid_request", message), (error["code"], error["message"]))

    def test_what_is_no_comment_id_is_refused(self) -> None:
        for given, message in (
            ("41", "comment_id must be an integer"),
            (True, "comment_id must be an integer"),
            (0, "comment_id must be a positive integer"),
            (-1, "comment_id must be a positive integer"),
        ):
            with self.subTest(given=given):
                _, error = self.refusal(comment_id=given)
                self.assertEqual(("invalid_request", message), (error["code"], error["message"]))
        with self.assertRaisesRegex(api.PlanningHttpError, "comment_id is required"):
            self.http(RESOLVE, id=self.ref)

    def test_an_unknown_item_is_not_found(self) -> None:
        with self.assertRaises(model.WorkItemNotFoundError):
            self.http(RESOLVE, id=f"{SPACE}-999", comment_id=self.root)
        self.conn.commit()


class TellingTests(ResolveCase):
    def kinds(self, answer: dict) -> list[str]:
        return [event["kind"] for event in answer.get("from_person", [])]

    def test_a_persons_mark_and_its_removal_reach_the_next_agent_write(self) -> None:
        root = self.comment("Root")["comment_id"]
        self.http(RESOLVE, id=self.ref, comment_id=root, resolution="Done")
        self.http(RESOLVE, id=self.ref, comment_id=root, reopen=True)
        answer = self.tool("comment_work_item", id=self.ref, body="Heard")
        self.assertEqual(["thread_resolved", "thread_reopened"], self.kinds(answer))

    def test_a_persons_mark_holds_a_close_as_any_act_of_a_person_does(self) -> None:
        root = self.comment("Root")["comment_id"]
        self.http(RESOLVE, id=self.ref, comment_id=root, resolution="Done")
        self.tool("set_work_item_summary", id=self.ref, summary={"done": "d", "next": "n"})
        self.http(RESOLVE, id=self.ref, comment_id=root, resolution="Done again")
        with self.assertRaisesRegex(model.WorkflowGuardError, "person_spoke"):
            self.call("transition_work_item", id=self.ref, state="completed")
        self.conn.commit()

    def test_an_agents_mark_says_what_a_person_did_and_ends_the_window(self) -> None:
        root = self.comment("Root")["comment_id"]
        self.http("/api/planning/work-item/comment", id=self.ref, body="Over to you")
        answer = self.tool("resolve_work_item_comment", id=self.ref, comment_id=root)
        self.assertEqual(["comment"], self.kinds(answer))
        self.assertEqual([], self.kinds(self.tool("comment_work_item", id=self.ref, body="Next")))

    def test_a_reopen_that_writes_nothing_is_still_a_write_on_the_item(self) -> None:
        root = self.comment("Root")["comment_id"]
        self.http("/api/planning/work-item/comment", id=self.ref, body="Over to you")
        answer = self.tool("resolve_work_item_comment", id=self.ref, comment_id=root, reopen=True)
        self.assertEqual(["comment"], self.kinds(answer))
        self.assertEqual([], self.kinds(self.tool("comment_work_item", id=self.ref, body="Next")))


class ReplyAndMarkTests(ResolveCase):
    """What the card's "reply and mark the thread resolved" sends: two plain writes."""

    def test_a_reply_then_a_blank_mark_needs_nothing_else(self) -> None:
        root = self.comment("Which parser?")["comment_id"]
        before = self.revision()
        reply = self.http(
            "/api/planning/work-item/comment", id=self.ref, body="The new one.", reply_to=root
        )
        self.assertEqual(root, reply["reply_to"])
        # The reply's answer names the root, so the second write needs nothing else,
        # and no revision can stand between the two.
        answer = self.http(RESOLVE, id=self.ref, comment_id=reply["reply_to"], resolution="")
        self.assertEqual(
            ("", True), (answer["resolution"]["text"], answer["resolution"]["by_person"])
        )
        self.assertEqual(before, self.revision())

    def test_when_the_mark_failed_the_reply_stands_and_marking_again_works(self) -> None:
        root = self.comment("Which parser?")["comment_id"]
        reply = self.http(
            "/api/planning/work-item/comment", id=self.ref, body="The new one.", reply_to=root
        )
        with self.assertRaises(model.PlanningError):
            self.http(RESOLVE, id=self.ref, comment_id=reply["comment_id"], resolution="")
        self.conn.commit()
        self.assertEqual(reply["comment_id"], self.stored(reply["comment_id"])["id"])
        self.assertIsNone(self.resolution(root))
        self.assertEqual(
            "",
            self.http(RESOLVE, id=self.ref, comment_id=root, resolution="")["resolution"]["text"],
        )

    def test_a_reply_after_the_mark_leaves_it_in_place(self) -> None:
        root = self.comment("Which parser?")["comment_id"]
        mark = self.mark(root, resolution="The new one")["resolution"]
        self.comment("A late thought", reply_to=root)
        self.assertEqual(mark, self.resolution(root))


class UnresolvedReadTests(ResolveCase):
    def page(self, **arguments: object) -> dict:
        return self.call("get_work_item", id=self.ref, unresolved=True, **arguments)

    def test_forty_five_roots_take_three_pages_and_nothing_is_lost(self) -> None:
        roots = [self.comment(f"root {number}")["comment_id"] for number in range(45)]
        seen: list[int] = []
        sizes: list[tuple[int, bool]] = []
        after: dict[str, int] = {}
        for _ in range(4):
            page = self.page(**after)
            ids = [comment["id"] for comment in page["comments"]]
            seen += ids
            sizes.append((len(ids), page["truncated"]))
            self.assertEqual(45, page["unresolved_total"])
            if not page["truncated"]:
                break
            after = {"comments_after": ids[-1]}
        self.assertEqual([(20, True), (20, True), (5, False)], sizes)
        self.assertEqual(roots, seen)

    def test_a_page_of_exactly_twenty_says_nothing_remains(self) -> None:
        for number in range(20):
            self.comment(f"root {number}")
        page = self.page()
        self.assertEqual((20, False), (len(page["comments"]), page["truncated"]))

    def test_it_leaves_out_marks_and_replies_and_carries_what_a_root_needs(self) -> None:
        marked = self.comment("Marked")["comment_id"]
        answered = self.comment("Answered")["comment_id"]
        self.comment("First reply", reply_to=answered)
        last = self.comment("Last reply", reply_to=answered)["comment_id"]
        reported = service.report_work_item(self.conn, self.ref, {"done": "built", "next": "check"})
        report = reported["comments"][-1]["id"]
        request_id = self.question()
        self.comment("About the question", reply_to_request=request_id)
        self.comment("On the marked one", reply_to=marked)
        self.mark(marked, resolution="Done")
        page = self.page()
        self.assertEqual([answered, report], [comment["id"] for comment in page["comments"]])
        root = page["comments"][0]
        self.assertEqual(
            (2, last, "Last reply"),
            (root["replies"], root["last_reply"]["id"], root["last_reply"]["body"]),
        )
        self.assertIsNone(page["comments"][1]["last_reply"])
        self.assertEqual(
            (7, 3, 2, False),
            (
                page["comments_total"],
                page["threads_total"],
                page["unresolved_total"],
                page["truncated"],
            ),
        )
        # A marked thread is not shown, and the contract's flag counts what exists.
        self.assertIs(True, page["history_truncated"])

    def test_with_nothing_marked_nothing_is_said_to_be_left_out(self) -> None:
        self.comment("Only")
        page = self.page()
        self.assertEqual((False, False), (page["truncated"], page["history_truncated"]))

    def test_a_mark_set_between_two_pages_moves_nothing_still_to_read(self) -> None:
        roots = [self.comment(f"root {number}")["comment_id"] for number in range(25)]
        first = self.page()
        read = [comment["id"] for comment in first["comments"]]
        self.assertEqual(roots[:20], read)
        self.mark(roots[3])
        self.mark(roots[21])
        second = self.page(comments_after=read[-1])
        self.assertEqual(
            [roots[20], roots[22], roots[23], roots[24]],
            [comment["id"] for comment in second["comments"]],
        )
        self.assertEqual(23, second["unresolved_total"])

    def test_an_item_with_no_comment_answers_an_empty_page(self) -> None:
        page = self.page()
        self.assertEqual(
            ([], False, 0, 0),
            (page["comments"], page["truncated"], page["threads_total"], page["unresolved_total"]),
        )

    def test_every_counted_read_says_how_many_are_open_and_full_does_not(self) -> None:
        root = self.comment("Marked")["comment_id"]
        self.comment("Open")
        self.mark(root)
        for arguments in ({}, {"thread": root}, {"comments_after": 0}):
            with self.subTest(read=arguments):
                answer = self.call("get_work_item", id=self.ref, **arguments)
                self.assertEqual(1, answer["unresolved_total"])
                self.assertNotIn("truncated", answer)
        self.assertNotIn("unresolved_total", self.call("get_work_item", id=self.ref, full=True))

    def test_the_reads_it_excludes_are_refused(self) -> None:
        root = self.comment("Root")["comment_id"]
        for extra, wanted in (
            ({"full": True}, "full and unresolved exclude each other"),
            ({"thread": root}, "thread and unresolved exclude each other"),
        ):
            with self.subTest(extra=extra):
                with self.assertRaises(model.PlanningError) as refused:
                    self.call("get_work_item", id=self.ref, unresolved=True, **extra)
                self.assertEqual(wanted, str(refused.exception))
        with self.assertRaisesRegex(api.PlanningHttpError, "unresolved must be a boolean"):
            self.call("get_work_item", id=self.ref, unresolved="yes")

    def test_the_http_read_takes_it_and_refuses_what_it_excludes(self) -> None:
        roots = [self.comment(f"root {number}")["comment_id"] for number in range(3)]
        self.mark(roots[0])
        found = self.read({"unresolved": ["true"]})
        self.assertEqual(roots[1:], [comment["id"] for comment in found["comments"]])
        self.assertEqual((False, 2), (found["truncated"], found["unresolved_total"]))
        after = self.read({"unresolved": ["true"], "comments_after": [str(roots[1])]})
        self.assertEqual([roots[2]], [comment["id"] for comment in after["comments"]])
        for parameters, wanted in (
            ({"thread": [str(roots[1])]}, "thread and unresolved exclude"),
            ({"threads": ["2"]}, "threads and unresolved exclude"),
            ({"comments": ["2"]}, "unresolved and comments exclude"),
        ):
            with self.subTest(parameters=parameters):
                with self.assertRaisesRegex(model.PlanningError, wanted):
                    self.read({"unresolved": ["true"], **parameters})
        with self.assertRaisesRegex(api.PlanningHttpError, "unresolved must be true or false"):
            self.read({"unresolved": ["1"]})
        self.assertEqual(
            service.get_work_item(self.conn, self.ref), self.read({"unresolved": ["false"]})
        )

    def test_the_tool_publishes_the_read(self) -> None:
        tool = next(t for t in tools.TOOLS if t["name"] == "get_work_item")
        self.assertEqual("boolean", tool["inputSchema"]["properties"]["unresolved"]["type"])


class ResolutionsGroupTests(ResolveCase):
    def apply(self, **groups: object) -> dict:
        return self.tool("apply_work_item_changes", id=self.ref, **groups)

    def test_a_hundred_marks_are_one_call_and_each_says_how_it_stands(self) -> None:
        roots = [self.comment(f"line {number}")["comment_id"] for number in range(100)]
        answer = self.apply(
            resolutions=[{"comment_id": root, "resolution": "Review 2026-11-03"} for root in roots]
        )
        applied = answer["applied"]["resolutions"]
        self.assertEqual(roots, [entry["comment_id"] for entry in applied])
        self.assertEqual({"Review 2026-11-03"}, {entry["resolution"]["text"] for entry in applied})
        self.assertEqual(
            100,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_comments WHERE resolved_at IS NOT NULL"
            ).fetchone()[0],
        )
        # One call: every mark and every event points to the same row.
        marks = {
            row[0] for row in self.conn.execute("SELECT resolved_call_id FROM work_item_comments")
        }
        events = {
            row[0]
            for row in self.conn.execute(
                "SELECT call_id FROM work_item_events WHERE action = 'comment_resolved'"
            )
        }
        self.assertEqual(1, len(marks))
        self.assertEqual(marks, events)
        self.assertIsNotNone(next(iter(marks)))

    def test_one_refused_entry_writes_none_of_them_and_is_named(self) -> None:
        roots = [self.comment(f"line {number}")["comment_id"] for number in range(99)]
        reply = self.comment("A reply", reply_to=roots[0])["comment_id"]
        count = self.count()
        entries = [{"comment_id": root, "resolution": "Done"} for root in roots]
        with self.assertRaises(api.PlanningHttpError) as refused:
            self.apply(
                comment={"body": "Reviewed", "reply_to": roots[0]},
                resolutions=[*entries, {"comment_id": reply}],
            )
        self.conn.commit()
        self.assertEqual({"group": "resolutions", "index": 99}, refused.exception.detail["step"])
        self.assertEqual(
            f"resolutions[99]: comment {reply} is a reply; mark its root, comment {roots[0]}",
            refused.exception.message,
        )
        self.assertEqual("invalid_request", refused.exception.code)
        self.assertEqual(count, self.count())
        self.assertEqual([], self.history())
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_comments WHERE resolved_at IS NOT NULL"
            ).fetchone()[0],
        )

    def test_a_group_past_its_size_or_with_an_unknown_field_is_refused_first(self) -> None:
        root = self.comment("Root")["comment_id"]
        for resolutions, wanted in (
            ([{"comment_id": root}] * 101, "resolutions must be a list of at most 100 objects"),
            ({"comment_id": root}, "resolutions must be a list of at most 100 objects"),
            ([{"comment_id": root, "reason": "x"}], "resolutions[0]: unknown field(s) reason"),
            (["not an object"], "resolutions[0] must be an object"),
        ):
            with self.subTest(resolutions=resolutions):
                with self.assertRaises(api.PlanningHttpError) as refused:
                    self.call("apply_work_item_changes", id=self.ref, resolutions=resolutions)
                self.conn.commit()
                self.assertIn(wanted, refused.exception.message)
        self.assertEqual([], self.history())

    def test_it_runs_after_the_comment_and_before_a_close(self) -> None:
        marked = self.comment("To mark")["comment_id"]
        again = self.comment("To open again")["comment_id"]
        self.mark(again)
        answer = self.apply(
            comment={"body": "Reviewed.", "reply_to": marked},
            resolutions=[
                {"comment_id": marked, "resolution": "Done"},
                {"comment_id": again, "reopen": True},
            ],
            summary={"done": "Reviewed", "next": "Nothing"},
            transition={"state": "completed"},
        )
        self.assertEqual(
            [marked, again], [entry["comment_id"] for entry in answer["applied"]["resolutions"]]
        )
        self.assertEqual("Done", answer["applied"]["resolutions"][0]["resolution"]["text"])
        self.assertIsNone(answer["applied"]["resolutions"][1]["resolution"])
        self.assertEqual(marked, answer["applied"]["comment"]["reply_to"])
        self.assertEqual("done", answer["applied"]["transition"]["state"])
        actions = [
            event["action"] for event in service.get_work_item(self.conn, self.ref)["events"]
        ]
        self.assertLess(actions.index("comment_reopened"), actions.index("summarized"))

    def test_the_http_batch_answers_the_same(self) -> None:
        root = self.comment("Root")["comment_id"]
        answer = self.http(
            "/api/planning/work-item/apply",
            id=self.ref,
            resolutions=[{"comment_id": root, "resolution": "Done"}],
        )
        self.assertIs(True, answer["applied"]["resolutions"][0]["resolution"]["by_person"])
        self.assertEqual("Done", answer["comments"][0]["resolution"]["text"])

    def test_the_tool_publishes_the_group(self) -> None:
        tool = next(t for t in tools.TOOLS if t["name"] == "apply_work_item_changes")
        group = tool["inputSchema"]["properties"]["resolutions"]
        self.assertEqual(api.MAX_APPLY_ENTRIES, group["maxItems"])
        self.assertEqual({"comment_id", "resolution", "reopen"}, set(group["items"]["properties"]))


class DecisionSearchTests(ResolveCase):
    def hits(self, query: str) -> list[tuple[str, str | None]]:
        return [
            (found["reference"], found.get("comment_hit"))
            for found in service.search_work_items(self.conn, query, space=SPACE)
        ]

    def test_a_decision_finds_its_item_and_says_why(self) -> None:
        root = self.comment("Which parser?")["comment_id"]
        self.mark(root, resolution="Moved to the parser rewrite")
        self.assertEqual([(self.ref, "Moved to the parser rewrite")], self.hits("rewrite"))

    def test_a_mark_taken_off_finds_nothing(self) -> None:
        root = self.comment("Which parser?")["comment_id"]
        self.mark(root, resolution="Moved to the parser rewrite")
        self.mark(root, reopen=True)
        self.assertEqual([], self.hits("rewrite"))

    def test_what_a_comment_says_is_the_hit_when_both_match(self) -> None:
        root = self.comment("The rewrite of the parser")["comment_id"]
        self.mark(root, resolution="Moved to the rewrite")
        self.assertEqual([(self.ref, "The rewrite of the parser")], self.hits("rewrite"))

    def test_a_store_older_than_threads_is_still_searched(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            path = str(Path(directory) / "older.sqlite3")
            schema9.build(path)
            raw = sqlite3.connect(path)
            schema9.populate(raw)
            raw.commit()
            raw.close()
            conn = scopes.open_readonly({"name": "older", "path": path})
            try:
                found = service.search_work_items(conn, "Held")
            finally:
                conn.close()
        self.assertGreater(len(found), 0)


if __name__ == "__main__":
    unittest.main()
