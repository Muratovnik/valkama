"""The batch's groups for an item's fields, several comments and questions.

The single writes are the contract: the HTTP edit and comment, and
`create_work_item_request`, already say what each write does, so most cases make
the same write alone on a twin item, under the same agent's identity, and compare
what both left, refusals included. What the batch adds of its own is the order, the all or
nothing, and the two refusals only a batch can meet: `comment` beside `comments`,
and a question beside the transition that would close it unanswered.

A refused call is committed here on purpose. The HTTP surface commits whatever a
handler leaves, so what keeps a refused batch out of the store is its savepoint,
and a test that rolled back would not notice it gone.
"""

from __future__ import annotations

import re
import unittest

from server import mcp_surface
from server.planning import api, calls, model, requests, service, tools
from tests.test_planning_threads import FIELDS, ThreadTestCase

#: Codex proves its session in `_meta`, the shortest door in a test.
SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
AGENT = {"sessionId": SESSION}
BATCH = "apply_work_item_changes"
#: The HTTP writes of one edit and of one comment, which the batch's groups stand for.
UPDATE = "/api/planning/work-item/update"
COMMENT = "/api/planning/work-item/comment"
QUESTION = {"kind": "question", "prompt": "Which path?", "fields": FIELDS}
#: A decision: it recommends an answer in its one required field.
DECISION = {
    "kind": "decision",
    "prompt": "Which path?",
    "fields": [
        {
            "id": "path",
            "label": "Which path?",
            "type": "choice",
            "required": True,
            "options": [
                {"id": "near", "label": "Near", "recommended": True},
                {"id": "far", "label": "Far"},
            ],
        }
    ],
}
SUMMARY = {"done": "The change", "next": "Nothing"}
#: A move into review: it asks the owner what to check.
REVIEW = {"state": "review", "to_check": "The path chosen"}


class BatchCase(ThreadTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.twin = self.item("A discussed change")
        self.conn.commit()

    def agent(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        assert isinstance(answer, dict)
        return answer

    def apply(self, **groups: object) -> dict:
        return self.agent(BATCH, id=self.ref, **groups)

    def goal(self, title: str, *, accepted: bool = False) -> str:
        """A goal: what an item stands under, a task holding no children."""

        return str(
            service.create_work_item(
                self.conn,
                space="TALK",
                title=title,
                kind="goal",
                acceptance=model.NAMED_BASIS if accepted else None,
            )["reference"]
        )

    def refused(self, name: str, **arguments: object) -> dict:
        """The error body a surface would answer with, after committing what is left."""

        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            mcp_surface.run_tool_call(self.conn, name, arguments, meta=AGENT)
        self.conn.commit()
        error = api.error_response(caught.exception)[1]["error"]
        assert isinstance(error, dict)
        return error

    def refused_batch(self, **groups: object) -> dict:
        return self.refused(BATCH, id=self.ref, **groups)

    def single(self, path: str, **payload: object) -> dict:
        """The one write a group stands for, made alone at its HTTP path as this agent."""

        with calls.bind(calls.verify_mcp(AGENT, None), path):
            answer = api.handle_post(self.conn, path, payload)
        self.conn.commit()
        assert answer is not None and isinstance(answer[1], dict)
        return answer[1]

    def refused_single(self, path: str, **payload: object) -> dict:
        """The error body of that write alone, after committing what is left."""

        with self.assertRaises((model.PlanningError, api.PlanningHttpError)) as caught:
            with calls.bind(calls.verify_mcp(AGENT, None), path):
                api.handle_post(self.conn, path, payload)
        self.conn.commit()
        error = api.error_response(caught.exception)[1]["error"]
        assert isinstance(error, dict)
        return error

    def record(self, reference: str | None = None) -> dict:
        return service.get_work_item(self.conn, reference or self.ref)

    def actions(self, reference: str | None = None) -> list[str]:
        return [event["action"] for event in self.record(reference)["events"]]

    def call_rows(self, reference: str | None = None) -> list[dict]:
        identity = self.record(reference)["work_item_id"]
        return [
            dict(row)
            for row in self.conn.execute(
                "SELECT * FROM execution_events WHERE kind = ? AND work_item_id = ? ORDER BY id",
                (calls.KIND, identity),
            )
        ]

    def counted(self, table: str) -> int:
        return int(self.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

    def untouched(self) -> tuple:
        """Everything a refused batch has no business changing."""

        return (
            self.record(),
            self.counted("work_item_comments"),
            self.counted("work_item_requests"),
            self.counted("execution_events"),
        )


class UpdateGroupTests(BatchCase):
    def test_every_field_lands_as_the_single_edit_lands_it(self) -> None:
        parent = self.goal("An epic")
        self.conn.commit()
        edit = {
            "title": "Renamed",
            "description": "Why it changed",
            "labels": ["one", "two"],
            "priority": "high",
            "kind": "bug",
            "parent": parent,
            "source": "docs/plan.md#kb:a7f3",
        }
        self.single(UPDATE, id=self.twin, **edit)

        answer = self.apply(update=edit)

        batch, twin = self.record(), self.record(self.twin)
        for name in ("title", "description", "labels", "priority", "kind", "parent_id", "source"):
            self.assertEqual(twin[name], batch[name], name)
        self.assertEqual(twin["revision"], batch["revision"])
        self.assertEqual(batch["revision"], answer["revision"])
        # An edit logs no event, in a batch as well: its call row is its record. A
        # changed label set is the one exception, and the batch records it as the tool does.
        self.assertEqual(["created", "labels_changed"], self.actions())
        self.assertEqual(self.actions(self.twin), self.actions())
        self.assertEqual(set(edit), set(answer["applied"]["update"]))
        [row] = self.call_rows()
        [alone] = self.call_rows(self.twin)
        self.assertEqual((BATCH, UPDATE), (row["tool"], alone["tool"]))
        for name in ("identity_state", "identity_source", "session_id", "reason"):
            self.assertEqual(alone[name], row[name], name)
        self.assertEqual((calls.CONFIRMED, SESSION), (row["identity_state"], row["session_id"]))

    def test_an_edit_names_only_what_was_sent_and_a_new_parent_is_sent(self) -> None:
        parent = self.goal("An epic")
        other = self.goal("Another epic")
        service.update_work_item(self.conn, self.ref, parent=parent)
        self.conn.commit()
        answer = self.apply(update={"title": "Renamed", "parent": other, "kind": None})
        self.assertEqual(["title", "parent"], answer["applied"]["update"])
        record = self.record()
        self.assertEqual(
            ("Renamed", self.record(other)["work_item_id"]), (record["title"], record["parent_id"])
        )

    def test_an_edit_that_clears_the_parent_is_refused_naming_move_out(self) -> None:
        parent = self.goal("An epic")
        service.update_work_item(self.conn, self.ref, parent=parent)
        self.conn.commit()
        before = self.untouched()
        error = self.refused_batch(update={"title": "Renamed", "parent": ""})
        self.assertEqual({"group": "update", "index": 0}, error["step"])
        self.assertEqual("invalid_request", error["code"])
        self.assertIn("[parent]", error["message"])
        self.assertIn("move_out", error["message"])
        self.assertEqual(before, self.untouched())
        self.assertEqual(self.record(parent)["work_item_id"], self.record()["parent_id"])

    def test_an_edit_of_nothing_names_nothing_and_writes_nothing(self) -> None:
        before = self.record()["revision"]
        answer = self.apply(update={})
        self.assertEqual([], answer["applied"]["update"])
        self.assertEqual(before, self.record()["revision"])

    def test_a_refused_field_is_refused_as_the_single_edit_refuses_it(self) -> None:
        for edit in (
            {"priority": "someday"},
            {"kind": "chore"},
            {"title": ""},
            {"title": 5},
            {"labels": "one"},
            {"parent": "TALK-999"},
        ):
            with self.subTest(edit=edit):
                single = self.refused_single(UPDATE, id=self.twin, **edit)
                before = self.untouched()
                error = self.refused_batch(claim=True, update=edit)
                self.assertEqual(single["code"], error["code"])
                self.assertEqual(f"update: {single['message']}", error["message"])
                self.assertEqual({"group": "update", "index": 0}, error["step"])
                self.assertEqual(before, self.untouched())

    def test_rank_is_retired_in_the_edit_the_move_and_as_an_argument(self) -> None:
        retired = model.RETIRED_FIELDS["rank"]
        for groups, says in (
            ({"update": {"rank": "first"}}, f"update: {retired}"),
            ({"update": {"title": "Renamed", "rank": "last"}}, f"update: {retired}"),
            ({"transition": {"state": "ready", "rank": "first"}}, f"transition: {retired}"),
            ({"claim": True, "rank": "first"}, f"{BATCH}: {retired}"),
        ):
            with self.subTest(groups=groups):
                before = self.untouched()
                error = self.refused_batch(**groups)
                self.assertEqual(("invalid_request", says), (error["code"], error["message"]))
                self.assertEqual(before, self.untouched())

    def test_an_edit_answers_to_the_revision_the_batch_names(self) -> None:
        current = self.record()["revision"]
        before = self.untouched()

        stale = self.refused_batch(update={"title": "Late"}, expected_revision=current - 1)

        self.assertEqual("revision_conflict", stale["code"])
        self.assertEqual((current - 1, current), (stale["expected"], stale["actual"]))
        self.assertEqual(before, self.untouched())

        answer = self.apply(update={"title": "On time"}, expected_revision=current)
        self.assertEqual(current + 1, answer["revision"])
        self.assertEqual("On time", self.record()["title"])

    def test_the_revision_belongs_to_the_batch_and_not_to_the_group(self) -> None:
        current = self.record()["revision"]
        before = self.untouched()
        error = self.refused_batch(update={"title": "Late", "expected_revision": current})
        self.assertEqual("invalid_request", error["code"])
        self.assertIn("update: unknown field(s) expected_revision", error["message"])
        self.assertEqual({"group": "update", "index": 0}, error["step"])
        self.assertEqual(before, self.untouched())


class CommentsGroupTests(BatchCase):
    def setUp(self) -> None:
        super().setUp()
        self.step, self.twin_step = (
            service.set_checklist(self.conn, reference, ["one"])["checklist"][0]["id"]
            for reference in (self.ref, self.twin)
        )
        self.root, self.twin_root = (
            self.comment("A root", reference)["comment_id"] for reference in (self.ref, self.twin)
        )
        self.reply, self.twin_reply = (
            self.comment("A reply", reference, reply_to=root)["comment_id"]
            for reference, root in ((self.ref, self.root), (self.twin, self.twin_root))
        )
        self.asked, self.twin_asked = self.question(self.ref), self.question(self.twin)

    def entries(self, step: str, root: int, reply: int, asked: str) -> list[dict]:
        return [
            {"body": "Plain"},
            {"body": "On a step", "checklist_item_id": step},
            {"body": "Under a root", "reply_to": root},
            {"body": "Under a reply", "reply_to": reply},
            {"body": "Under a question", "reply_to_request": asked},
        ]

    def test_each_entry_lands_as_the_single_comment_lands_it_and_is_named_in_applied(
        self,
    ) -> None:
        singles = [
            self.single(COMMENT, id=self.twin, author="one", **entry)
            for entry in self.entries(
                self.twin_step, self.twin_root, self.twin_reply, self.twin_asked
            )
        ]
        revision, twin_revision = self.record()["revision"], self.record(self.twin)["revision"]

        answer = self.apply(
            author="one", comments=self.entries(self.step, self.root, self.reply, self.asked)
        )

        applied = answer["applied"]["comments"]
        ids = [entry["comment_id"] for entry in applied]
        self.assertEqual(sorted(ids), ids, "written in the order they were sent")
        self.assertEqual(5, len(set(ids)))
        # A reply joined its root, by the root's own id on each item.
        self.assertEqual(
            [None, None, self.root, self.root, None], [entry["reply_to"] for entry in applied]
        )
        self.assertEqual(
            [None, None, None, None, self.asked], [entry["reply_to_request"] for entry in applied]
        )
        self.assertEqual(
            [None, None, self.twin_root, self.twin_root, None],
            [entry["reply_to"] for entry in singles],
        )
        shape = ("comment_id", "reply_to", "reply_to_request")
        self.assertEqual([set(shape)] * 5, [set(entry) for entry in applied])
        columns = ("body", "author", "checklist_item_text", "report")
        for mine, theirs in zip(applied, singles, strict=True):
            stored, alone = self.stored(mine["comment_id"]), self.stored(theirs["comment_id"])
            self.assertEqual([alone[name] for name in columns], [stored[name] for name in columns])
        self.assertEqual(
            self.record(self.twin)["revision"] - twin_revision,
            self.record()["revision"] - revision,
        )

    def test_several_comments_are_one_call_and_each_points_at_it(self) -> None:
        answer = self.apply(comments=[{"body": "One"}, {"body": "Two"}])
        [row] = self.call_rows()
        self.assertEqual((BATCH, calls.CONFIRMED), (row["tool"], row["identity_state"]))
        self.assertEqual(
            [row["id"], row["id"]],
            [
                self.stored(entry["comment_id"])["call_id"]
                for entry in answer["applied"]["comments"]
            ],
        )

    def test_a_hundred_comments_land_and_one_more_is_refused(self) -> None:
        before = self.untouched()
        error = self.refused_batch(comments=[{"body": "Line"}] * (api.MAX_APPLY_ENTRIES + 1))
        self.assertEqual("invalid_request", error["code"])
        self.assertIn(f"at most {api.MAX_APPLY_ENTRIES}", error["message"])
        self.assertEqual(before, self.untouched())

        answer = self.apply(comments=[{"body": "Line"}] * api.MAX_APPLY_ENTRIES)
        self.assertEqual(api.MAX_APPLY_ENTRIES, len(answer["applied"]["comments"]))

    def test_a_parent_the_item_does_not_have_refuses_the_whole_batch_by_its_index(self) -> None:
        single = self.refused(
            "apply_work_item_changes", id=self.twin, comment={"body": "Under", "reply_to": 10_000}
        )
        before = self.untouched()
        error = self.refused_batch(
            comments=[{"body": "Written first"}, {"body": "Under", "reply_to": 10_000}]
        )
        self.assertEqual(single["code"], error["code"])
        self.assertEqual({"group": "comments", "index": 1}, error["step"])
        self.assertTrue(error["message"].startswith("comments[1]: comment 10000 is not on "))
        self.assertEqual(before, self.untouched())

    def test_comment_and_comments_together_are_refused(self) -> None:
        before = self.untouched()
        error = self.refused_batch(comment={"body": "One"}, comments=[{"body": "Two"}])
        self.assertEqual("invalid_request", error["code"])
        self.assertIn("comment and comments exclude each other", error["message"])
        self.assertEqual(before, self.untouched())
        # An empty list among them still names both, and says the same.
        self.assertIn(
            "exclude each other",
            self.refused_batch(comment={"body": "One"}, comments=[])["message"],
        )
        self.assertEqual(before, self.untouched())

    def test_comment_keeps_working_and_a_null_comment_is_absent(self) -> None:
        one = self.apply(comment={"body": "One"})
        self.assertEqual(["comment"], list(one["applied"]))
        two = self.apply(comment=None, comments=[{"body": "Two"}])
        self.assertEqual(["comments"], list(two["applied"]))

    def test_comments_do_not_lift_a_closing_transition_over_what_a_person_did(self) -> None:
        self.agent("claim_work_item", id=self.twin)
        path = "/api/planning/work-item/comment"
        with calls.bind(calls.browser(), path):
            api.handle_post(self.conn, path, {"id": self.twin, "body": "Stop, please"})
        self.conn.commit()
        error = self.refused(
            BATCH,
            id=self.twin,
            comments=[{"body": "Closing"}],
            checklist_ticks=[{"item_id": self.twin_step}],
            summary=SUMMARY,
            transition={"state": "done"},
        )
        self.assertEqual({"group": "transition", "index": 0}, error["step"])
        self.assertIn("[person_spoke]", error["message"])


class QuestionsGroupTests(BatchCase):
    def test_a_question_is_the_single_tools_question_and_is_named_in_applied(self) -> None:
        asked = {**DECISION, "expires_at": "2099-01-01T09:30:00Z"}
        single = self.agent("create_work_item_request", id=self.twin, author="one", **asked)

        answer = self.apply(author="one", questions=[asked, QUESTION])

        [first, second] = answer["applied"]["questions"]
        self.assertEqual({"request_id": first["request_id"], "revision": single["revision"]}, first)
        self.assertNotEqual(first["request_id"], second["request_id"])
        mine = self.agent("get_work_item_request", id=first["request_id"])
        alone = self.agent("get_work_item_request", id=single["request_id"])
        different = {"request_id", "work_item_id", "reference", "created_at"}
        self.assertEqual(
            {name: value for name, value in alone.items() if name not in different},
            {name: value for name, value in mine.items() if name not in different},
        )
        self.assertEqual("pending", mine["status"])
        # In the history as the single tool's is, and in the call the batch is.
        details = [
            (event["action"], event["detail"])
            for event in self.record()["events"]
            if event["action"] == "request_created"
        ]
        self.assertEqual(
            [("request_created", first["request_id"]), ("request_created", second["request_id"])],
            details,
        )
        [row] = self.call_rows()
        calls_of_events = {
            found[0]
            for found in self.conn.execute(
                "SELECT call_id FROM work_item_events WHERE action = 'request_created'"
                " AND detail IN (?, ?)",
                (first["request_id"], second["request_id"]),
            )
        }
        self.assertEqual({row["id"]}, calls_of_events)
        # It is an open question wherever one is read.
        waiting = self.agent("list_work_item_requests", id=self.ref, status="pending")
        self.assertEqual(
            {first["request_id"], second["request_id"]},
            {entry["id"] for entry in waiting["requests"]},
        )
        self.assertEqual(
            2, requests.item_questions(self.conn, self.record()["work_item_id"])["open"]
        )

    def test_a_refused_entry_is_refused_as_the_single_tool_refuses_it(self) -> None:
        for mistake in (
            {"kind": "wish"},
            {"prompt": ""},
            {"fields": []},
            {"fields": [{"id": "a", "label": "A", "type": "essay"}]},
            {"expires_at": "tomorrow"},
            {"expires_at": "2001-01-01T00:00:00Z"},
            {"execution_id": "not-this-item"},
            {"session_id": "not-this-item"},
        ):
            with self.subTest(mistake=mistake):
                wrong = {**QUESTION, **mistake}
                single = self.refused("create_work_item_request", id=self.twin, **wrong)
                before = self.untouched()
                error = self.refused_batch(questions=[QUESTION, wrong])
                self.assertEqual(single["code"], error["code"])
                self.assertEqual(f"questions[1]: {single['message']}", error["message"])
                self.assertEqual({"group": "questions", "index": 1}, error["step"])
                self.assertEqual(before, self.untouched())

    def test_a_missing_or_unknown_key_is_refused_by_its_index(self) -> None:
        before = self.untouched()
        missing = self.refused_batch(questions=[{"kind": "question", "prompt": "Which?"}])
        self.assertEqual("questions[0]: fields is required", missing["message"])
        self.assertEqual({"group": "questions", "index": 0}, missing["step"])
        unknown = self.refused_batch(questions=[QUESTION, {**QUESTION, "id": "TALK-9"}])
        self.assertIn("questions[1]: unknown field(s) id", unknown["message"])
        self.assertEqual({"group": "questions", "index": 1}, unknown["step"])
        self.assertEqual("invalid_request", unknown["code"])
        self.assertEqual(before, self.untouched())

    def test_a_closed_item_takes_no_question_even_from_a_batch_that_reopens_it(self) -> None:
        service.set_summary(self.conn, self.ref, SUMMARY)
        service.transition_work_item(self.conn, self.ref, "cancelled", acceptance="assignment")
        self.conn.commit()
        single = self.refused("create_work_item_request", id=self.ref, **QUESTION)
        before = self.untouched()
        error = self.refused_batch(questions=[QUESTION], transition={"state": "triage"})
        self.assertEqual(f"questions[0]: {single['message']}", error["message"])
        self.assertEqual(before, self.untouched())


#: The refusal of a question beside the close that would end it, word for word.
ENDS_UNANSWERED = (
    "transition: a question on an item this call closes would end unanswered in the"
    " same write: ask it in a call that leaves the item open"
)


class AskingAndClosingTests(BatchCase):
    def closing(self, state: str, **force: object) -> dict:
        return {
            "claim": True,
            "questions": [QUESTION],
            "summary": SUMMARY,
            "transition": {"state": state, **force},
        }

    def test_a_batch_that_asks_and_cancels_is_refused_and_says_why(self) -> None:
        before = self.untouched()
        error = self.refused_batch(**self.closing("cancelled"))
        self.assertEqual("invalid_request", error["code"])
        self.assertEqual({"group": "transition", "index": 0}, error["step"])
        self.assertEqual(ENDS_UNANSWERED, error["message"])
        self.assertEqual(before, self.untouched())

    def test_a_batch_that_asks_and_completes_is_refused_and_writes_nothing(self) -> None:
        # An agent meets the guard on a close over an open question to the owner first,
        # the question its own batch asked included, and nothing of the batch stands.
        before = self.untouched()
        error = self.refused_batch(**self.closing("done"))
        self.assertEqual(
            ("workflow_guard", {"group": "transition", "index": 0}), (error["code"], error["step"])
        )
        self.assertIn("[question]", error["message"])
        self.assertEqual(before, self.untouched())

    def test_a_person_who_asks_and_closes_in_one_write_is_refused_the_same(self) -> None:
        before = self.untouched()
        payload = {
            "id": self.ref,
            "questions": [QUESTION],
            "summary": SUMMARY,
            "transition": {"state": "done"},
        }
        with self.assertRaises(api.PlanningHttpError) as caught:
            with calls.bind(calls.browser(), "/api/planning/work-item/apply"):
                api.handle_post(self.conn, "/api/planning/work-item/apply", payload)
        self.conn.commit()
        status, body = api.error_response(caught.exception)
        self.assertEqual(400, status)
        self.assertEqual(
            ("invalid_request", ENDS_UNANSWERED, {"group": "transition", "index": 0}),
            (body["error"]["code"], body["error"]["message"], body["error"]["step"]),
        )
        self.assertEqual(before, self.untouched())

    def test_force_does_not_carry_it_through(self) -> None:
        # force overrides a guard; here there is nothing to override, only a question to lose.
        before = self.untouched()
        error = self.refused_batch(**self.closing("cancelled", force=True))
        self.assertEqual("invalid_request", error["code"])
        self.assertEqual(before, self.untouched())

    def test_a_batch_that_asks_and_moves_to_review_keeps_the_question_open(self) -> None:
        answer = self.apply(claim=True, questions=[QUESTION], summary=SUMMARY, transition=REVIEW)
        self.assertEqual("review", answer["state"]["key"])
        [asked] = answer["applied"]["questions"]
        self.assertEqual(
            "pending", self.agent("get_work_item_request", id=asked["request_id"])["status"]
        )

    def test_a_close_with_no_question_in_it_stands_as_the_single_transition_does(self) -> None:
        # Only a question this very call asks is lost unseen: one asked before has
        # had its chance, and the person's close ends it, saying the item was done. An
        # agent's close waits for the owner's answer instead (the question guard).
        asked = self.question()
        path = "/api/planning/work-item/apply"
        with calls.bind(calls.browser(), path):
            payload = {"id": self.ref, "summary": SUMMARY, "transition": {"state": "done"}}
            answer = api.handle_post(self.conn, path, payload)[1]  # type: ignore[index]
        self.conn.commit()
        self.assertEqual("done", answer["state"]["key"])
        closed = self.agent("get_work_item_request", id=asked)
        self.assertEqual(
            ("expired", "item_completed"), (closed["status"], closed["expired_reason"])
        )


class EditingAndClosingTests(BatchCase):
    def test_a_new_parent_and_kind_land_with_the_close_that_follows_them(self) -> None:
        # The claim accepts the item, and accepted work moves only under accepted goals.
        parent = self.goal("An epic", accepted=True)
        self.conn.commit()
        answer = self.apply(
            claim=True,
            update={"parent": parent, "kind": "bug"},
            summary=SUMMARY,
            transition={"state": "done"},
        )
        self.assertEqual("done", answer["state"]["key"])
        record = self.record()
        self.assertEqual(
            ("bug", self.record(parent)["work_item_id"]), (record["kind"], record["parent_id"])
        )
        self.assertEqual(["parent", "kind"], sorted(answer["applied"]["update"], reverse=True))

    def test_a_refused_parent_leaves_the_item_open(self) -> None:
        parent = self.item("A task")
        self.conn.commit()
        before = self.untouched()
        # A task holds no children: the refusal names the conversion that passes.
        error = self.refused_batch(
            claim=True,
            update={"parent": parent},
            summary=SUMMARY,
            transition={"state": "done"},
        )
        self.assertEqual({"group": "update", "index": 0}, error["step"])
        self.assertIn("is a task and holds no children", error["message"])
        self.assertIn("convert {to: goal}", error["message"])
        self.assertEqual(before, self.untouched())

    def test_an_edit_and_a_close_land_on_a_closed_item_as_the_single_tools_do(self) -> None:
        # No guard ties a closed item's fields, so an edit of one is no refusal.
        self.apply(claim=True, summary=SUMMARY, transition={"state": "done"})
        answer = self.apply(update={"kind": "bug"})
        self.assertEqual(("done", "bug"), (answer["state"]["key"], self.record()["kind"]))


class ChecklistTicksGroupTests(BatchCase):
    """A tick in the batch takes `force` as the single tick does, and is refused without it."""

    def setUp(self) -> None:
        super().setUp()
        self.step = self.held_step(self.ref)
        self.twin_step = self.held_step(self.twin)
        self.conn.commit()

    def held_step(self, reference: str) -> str:
        """One step another holder has claimed, as a second session would leave it."""

        step = service.set_checklist(self.conn, reference, ["the step"])["checklist"][0]["id"]
        service.claim_checklist_item(self.conn, reference, step, author="holder")
        return str(step)

    def test_a_forced_tick_completes_another_holders_step_as_the_single_tick_does(self) -> None:
        self.agent(
            "apply_work_item_changes",
            id=self.twin,
            checklist_ticks=[{"item_id": self.twin_step, "force": True}],
        )

        answer = self.apply(checklist_ticks=[{"item_id": self.step, "force": True}])

        [step] = self.record()["checklist"]
        [single] = self.record(self.twin)["checklist"]
        self.assertEqual((True, ""), (step["done"], step["claimed_by"]))
        self.assertEqual(
            (single["done"], single["done_by"], single["claimed_by"]),
            (step["done"], step["done_by"], step["claimed_by"]),
        )
        self.assertEqual(self.actions(self.twin), self.actions())
        # The tick took the task's last holder, so it went back to the queue.
        self.assertEqual(["checklist_completed", "overridden", "transitioned"], self.actions()[-3:])
        self.assertEqual(
            [{"item_id": self.step, "done": True}], answer["applied"]["checklist_ticks"]
        )

    def overridden_events(self, reference: str | None = None) -> list[str]:
        return [
            event["detail"]
            for event in self.record(reference)["events"]
            if event["action"] == "overridden"
        ]

    def unclaimed_step(self, reference: str) -> str:
        """A step nobody holds, added beside the step the holder claimed."""

        steps = service.set_checklist(self.conn, reference, ["the step", "free"])["checklist"]
        self.conn.commit()
        return str(steps[1]["id"])

    def test_a_forced_tick_records_the_override_it_carried_as_the_single_tick_does(self) -> None:
        single = self.agent(
            "apply_work_item_changes",
            id=self.twin,
            checklist_ticks=[{"item_id": self.twin_step, "force": True}],
        )

        answer = self.apply(checklist_ticks=[{"item_id": self.step, "force": True}])

        self.assertEqual(["checklist_claim"], single["overridden"])
        self.assertEqual(["checklist_claim"], answer["overridden"])
        self.assertEqual(["checklist_claim"], self.overridden_events())
        self.assertEqual(["checklist_claim"], self.overridden_events(self.twin))
        self.assertEqual(["checklist_completed", "overridden", "transitioned"], self.actions()[-3:])

    def test_a_forced_tick_of_an_unclaimed_step_records_no_override(self) -> None:
        free = self.unclaimed_step(self.ref)

        answer = self.apply(checklist_ticks=[{"item_id": free, "force": True}])

        self.assertNotIn("overridden", answer)
        self.assertEqual([], self.overridden_events())
        self.assertEqual("checklist_completed", self.actions()[-1])

    def test_a_forced_tick_of_a_step_the_caller_holds_records_no_override(self) -> None:
        mine = self.unclaimed_step(self.ref)
        self.agent("claim_work_item_checklist_item", id=self.ref, item_id=mine)

        single = self.agent(
            "apply_work_item_changes",
            id=self.ref,
            checklist_ticks=[{"item_id": mine, "force": True}],
        )

        self.assertNotIn("overridden", single)
        self.assertEqual([], self.overridden_events())

    def test_forced_ticks_and_a_forced_close_in_one_batch_record_every_override(self) -> None:
        answer = self.apply(
            claim=True,
            checklist_ticks=[{"item_id": self.step, "force": True}],
            transition={"state": "done", "force": True},
        )

        self.assertEqual(["checklist_claim", "summary"], answer["overridden"])
        self.assertEqual(["checklist_claim", "summary"], self.overridden_events())

    def test_a_forced_checklist_group_that_discards_a_held_step_records_it(self) -> None:
        answer = self.apply(checklist={"items": ["replacement"], "force": True})

        self.assertEqual(["checklist_discard"], answer["overridden"])
        self.assertEqual(["checklist_discard"], self.overridden_events())

    def test_without_force_another_holders_step_is_refused_as_the_single_tick_refuses_it(
        self,
    ) -> None:
        single = self.refused_single(
            "/api/planning/work-item/checklist/tick", id=self.twin, item_id=self.twin_step
        )
        before = self.untouched()

        error = self.refused_batch(
            update={"title": "Renamed"}, checklist_ticks=[{"item_id": self.step}]
        )

        self.assertEqual({"group": "checklist_ticks", "index": 0}, error["step"])
        self.assertEqual(
            (single["code"], f"checklist_ticks[0]: {single['message']}"),
            (error["code"], error["message"]),
        )
        self.assertEqual(before, self.untouched())

    def test_a_tick_flag_that_is_not_a_boolean_is_refused_by_its_index_and_writes_nothing(
        self,
    ) -> None:
        before = self.untouched()
        for tick, wanted in (
            ({"item_id": self.step, "force": "yes"}, "force must be a boolean"),
            ({"item_id": self.step, "force": 1}, "force must be a boolean"),
            ({"item_id": self.step, "done": "yes"}, "done must be a boolean"),
        ):
            with self.subTest(tick=tick):
                error = self.refused_batch(update={"title": "Renamed"}, checklist_ticks=[tick])
                self.assertEqual("invalid_request", error["code"])
                self.assertEqual({"group": "checklist_ticks", "index": 0}, error["step"])
                self.assertEqual(f"checklist_ticks[0]: {wanted}", error["message"])
                self.assertEqual(before, self.untouched())


class OrderTests(BatchCase):
    def test_the_groups_are_applied_in_the_published_order(self) -> None:
        self.assertEqual(
            (
                "claim",
                "subscribe",
                "update",
                "convert",
                "checklist",
                "checklist_ticks",
                "refs",
                "commits",
                "links",
                "comment",
                "comments",
                "resolutions",
                "questions",
                "summary",
                "transition",
                "defer",
                "move_out",
            ),
            tuple(group for group, _fields in api.APPLY_GROUPS),
        )

    def test_the_history_follows_the_order_and_applied_names_each_group(self) -> None:
        other = self.item("Related")
        step = service.set_checklist(self.conn, self.ref, ["one"])["checklist"][0]["id"]
        root = self.comment("A root")["comment_id"]
        self.conn.commit()
        recorded = len(self.actions())

        answer = self.apply(
            author="one",
            transition=REVIEW,
            summary=SUMMARY,
            questions=[QUESTION],
            resolutions=[{"comment_id": root, "resolution": "Settled"}],
            comments=[{"body": "One"}, {"body": "Two"}],
            links=[{"other": other, "kind": "relates-to"}],
            refs=[{"kind": "memory", "value": "abc1234"}],
            checklist_ticks=[{"item_id": step}],
            checklist={"items": ["one", {"text": "two", "done": True}]},
            update={"title": "Renamed"},
            claim=True,
        )

        self.assertEqual(
            [
                "claimed",
                "accepted",
                "transitioned",
                "checklist_replaced",
                "checklist_completed",
                "checklist_completed",
                "linked",
                "comment_resolved",
                "request_created",
                "summarized",
                "transitioned",
                "released",
                # The question the move into review asks, after the move.
                "request_created",
            ],
            self.actions()[recorded:],
        )
        record = self.record()
        comments = sorted(
            entry["id"] for entry in record["comments"] if entry["body"] in ("One", "Two")
        )
        applied = answer["applied"]
        self.assertEqual(["title"], applied["update"])
        self.assertEqual(
            comments, [entry["comment_id"] for entry in applied["comments"]], "every new comment"
        )
        review = applied["transition"]["review_request_id"]
        [request] = [
            event["detail"]
            for event in record["events"]
            if event["action"] == "request_created" and event["detail"] != review
        ]
        self.assertEqual([{"request_id": request, "revision": 0}], applied["questions"])
        self.assertEqual(
            [
                "claim",
                "update",
                "checklist",
                "checklist_ticks",
                "refs",
                "links",
                "comments",
                "resolutions",
                "questions",
                "summary",
                "transition",
            ],
            list(applied),
        )

    def test_an_edit_comes_before_the_first_write_that_could_record_the_call(self) -> None:
        # An edit logs no event: the fields it changed are kept on the call row, and
        # only the write that inserts that row can put them there.
        step = service.set_checklist(self.conn, self.ref, ["one"])["checklist"][0]["id"]
        self.conn.commit()
        self.apply(
            comments=[{"body": "On a step", "checklist_item_id": step}],
            checklist={"items": ["one", "two"]},
            update={"title": "Renamed"},
        )
        [row] = self.call_rows()
        self.assertEqual("title", row["reason"])

    def test_a_comment_reads_the_checklist_the_same_call_set(self) -> None:
        step = service.set_checklist(self.conn, self.ref, ["old name"])["checklist"][0]["id"]
        self.conn.commit()
        answer = self.apply(
            comments=[{"body": "On the step", "checklist_item_id": step}],
            checklist={"items": [{"id": step, "text": "new name"}]},
        )
        [written] = answer["applied"]["comments"]
        self.assertEqual("new name", self.stored(written["comment_id"])["checklist_item_text"])

    def test_a_comment_cannot_name_a_step_the_same_call_removed(self) -> None:
        kept, gone = service.set_checklist(self.conn, self.ref, ["kept", "gone"])["checklist"]
        self.conn.commit()
        before = self.untouched()
        error = self.refused_batch(
            comments=[{"body": "On the step", "checklist_item_id": gone["id"]}],
            checklist={"items": [{"id": kept["id"], "text": "kept"}]},
        )
        self.assertEqual({"group": "comments", "index": 0}, error["step"])
        self.assertEqual(before, self.untouched())


class AllOrNothingTests(BatchCase):
    """One wrong entry, in any new group and at any position, against a batch that else lands."""

    def setUp(self) -> None:
        super().setUp()
        self.other = self.item("Related")
        self.root = self.comment("A root")["comment_id"]
        self.step = service.set_checklist(self.conn, self.ref, ["one"])["checklist"][0]["id"]
        self.conn.commit()

    def groups(self, **wrong: object) -> dict:
        three = [{"body": "One"}, {"body": "Two"}, {"body": "Three"}]
        return {
            "claim": True,
            "update": {"title": "Renamed"},
            "checklist": {"items": ["one", {"text": "two", "done": True}]},
            "checklist_ticks": [{"item_id": self.step}],
            "refs": [{"kind": "memory", "value": "abc1234"}],
            "links": [{"other": self.other, "kind": "relates-to"}],
            "comments": three,
            "resolutions": [{"comment_id": self.root, "resolution": "Settled"}],
            "questions": [QUESTION, QUESTION, QUESTION],
            "summary": SUMMARY,
            "transition": REVIEW,
            **wrong,
        }

    def test_the_whole_batch_lands_when_nothing_is_wrong(self) -> None:
        answer = self.apply(**self.groups())
        self.assertEqual("review", answer["state"]["key"])
        self.assertEqual(3, len(answer["applied"]["questions"]))

    def test_one_wrong_entry_anywhere_writes_nothing_and_names_the_step_and_its_code(self) -> None:
        good = {"body": "Good"}
        bad = {"body": "Bad", "reply_to": 10_000}
        wrong = {**QUESTION, "kind": "wish"}
        malformed = {"body": "Bad", "author": "someone"}
        for groups, group, index in (
            ({"update": {"priority": "someday"}}, "update", 0),
            ({"comments": [bad, good, good]}, "comments", 0),
            ({"comments": [good, bad, good]}, "comments", 1),
            ({"comments": [good, good, bad]}, "comments", 2),
            ({"comments": [good, good, malformed]}, "comments", 2),
            ({"comments": [good, "text"]}, "comments", 1),
            ({"questions": [wrong, QUESTION, QUESTION]}, "questions", 0),
            ({"questions": [QUESTION, wrong, QUESTION]}, "questions", 1),
            ({"questions": [QUESTION, QUESTION, wrong]}, "questions", 2),
            ({"questions": [QUESTION, 5]}, "questions", 1),
        ):
            with self.subTest(group=group, index=index, groups=groups):
                before = self.untouched()
                error = self.refused_batch(**self.groups(**groups))
                self.assertEqual("invalid_request", error["code"])
                self.assertEqual({"group": group, "index": index}, error["step"])
                label = group if group == "update" else f"{group}[{index}]"
                # "comments[1]: …" for a refused write, "comments[1] must be …" for a shape.
                self.assertRegex(error["message"], rf"^{re.escape(label)}[: ]")
                self.assertEqual(before, self.untouched())

    def test_a_later_group_refused_takes_the_new_groups_back_with_it(self) -> None:
        before = self.untouched()
        error = self.refused_batch(**self.groups(transition={"state": "no-such-state"}))
        self.assertEqual({"group": "transition", "index": 0}, error["step"])
        self.assertEqual(before, self.untouched())


class PublishedSchemaTests(unittest.TestCase):
    def test_the_schema_names_what_each_new_group_takes(self) -> None:
        tool = next(entry for entry in tools.TOOLS if entry["name"] == BATCH)
        properties = tool["inputSchema"]["properties"]
        fields = dict(api.APPLY_GROUPS)
        self.assertEqual(fields["update"], set(properties["update"]["properties"]))
        self.assertEqual(fields["comments"], set(properties["comments"]["items"]["properties"]))
        self.assertEqual(fields["comments"], set(properties["comment"]["properties"]))
        self.assertEqual(fields["questions"], set(properties["questions"]["items"]["properties"]))
        self.assertEqual(
            fields["checklist_ticks"], set(properties["checklist_ticks"]["items"]["properties"])
        )
        for group in ("comments", "questions"):
            self.assertEqual(api.MAX_APPLY_ENTRIES, properties[group]["maxItems"])

    def test_the_groups_take_what_their_single_writes_take(self) -> None:
        schemas = {entry["name"]: entry["inputSchema"]["properties"] for entry in tools.TOOLS}
        fields = dict(api.APPLY_GROUPS)
        # What is the batch's own, the item and who signs, stays on the batch.
        batch_own = {"id", "author", "expected_revision", "verbose"}
        self.assertEqual({*model.UPDATABLE_FIELDS, "mentions"}, fields["update"])
        self.assertEqual(set(schemas["create_work_item_request"]) - batch_own, fields["questions"])

    def test_the_description_states_the_order(self) -> None:
        tool = next(entry for entry in tools.TOOLS if entry["name"] == BATCH)
        self.assertIn(
            "claim, subscribe, update, convert, checklist, checklist_ticks, refs, commits, links,"
            " comment or comments, resolutions, questions, summary, then one of transition,"
            " defer or move_out",
            tool["description"],
        )


if __name__ == "__main__":
    unittest.main()
