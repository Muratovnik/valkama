"""What an answer to a question may hold, and how it changes after it was given.

An answer names an option or the person's own variant in each field with
options, may comment on each such field and on the whole question, and can be
changed later while the item is open: by a person in the interface or by an
agent the owner asked, through `answer_work_item_request` with `change: true`.
Each change keeps the answer it replaced as a version. Expected values come from
that contract; the stores are real ones, an agent's calls go through
`mcp_surface.call_tool`, and a person's run under the identity the HTTP surface
binds, `calls.browser()`.
"""

from __future__ import annotations

import json
import unittest

from server.ops import export
from server.planning import api, calls, model, request_model, requests, service
from tests.test_planning_questions import BOOLEAN, CHOICE, MULTI, TEXT, QuestionCase

REQUIRED_BOOLEAN = {**BOOLEAN, "required": True}
REQUIRED_MULTI = {**MULTI, "required": True}
#: The refusal a note alone meets in place of a required field with options.
NOTE_NO_LONGER = (
    "answer path is required; give an option or your own variant in own;"
    " a note no longer stands in for a field"
)
OLD = "2001-01-01T00:00:00.000000Z"


class AnswerCase(QuestionCase):
    def as_person(self, operation: str, request: dict, **others: object) -> dict:
        with calls.bind(calls.browser(), "test"):
            answer = api.handle_post(
                self.conn,
                f"/api/planning/request/{operation}",
                {
                    "id": request["request_id"],
                    "expected_revision": request["revision"],
                    "author": "user",
                    **others,
                },
            )
        self.conn.commit()
        assert answer is not None
        return answer[1]

    def change(self, request: dict, answers: dict, **others: object) -> dict:
        """An agent's change, through the one tool an agent answers with."""

        return self.answer(request, answers, change=True, **others)

    def row(self, request: dict) -> dict:
        return dict(
            self.conn.execute(
                "SELECT * FROM work_item_requests WHERE request_id=?", (request["request_id"],)
            ).fetchone()
        )

    def compact(self, request: dict) -> dict:
        [found] = [
            row
            for row in self.tool("list_work_item_requests", id=self.reference)["requests"]
            if row["id"] == request["request_id"]
        ]
        return found

    def reply(self, request: dict, body: str, author: str = "someone") -> int:
        """A comment in the question's thread, as the store holds one."""

        cursor = self.conn.execute(
            "INSERT INTO work_item_comments(work_item_id,author,body,reply_to_request)"
            " VALUES(?,?,?,?)",
            (request["work_item_id"], author, body, request["request_id"]),
        )
        self.conn.commit()
        return int(cursor.lastrowid or 0)


class OwnVariantTests(AnswerCase):
    def test_a_choice_takes_its_own_variant_instead_of_an_option(self) -> None:
        answered = self.answer(self.ask(), {}, own={"path": "  Ask the vendor first  "})
        self.assertEqual(
            ("answered", {}, {"path": "Ask the vendor first"}),
            (answered["status"], answered["answers"], answered["own"]),
        )
        self.assertEqual({"_own": {"path": "Ask the vendor first"}}, self.stored_answers(answered))

    def test_a_boolean_takes_its_own_variant_instead_of_yes_or_no(self) -> None:
        answered = self.answer(self.ask([REQUIRED_BOOLEAN]), {}, own={"sure": "Only on Fridays"})
        self.assertEqual(({}, {"sure": "Only on Fridays"}), (answered["answers"], answered["own"]))

    def test_a_multi_choice_takes_its_own_variant_beside_the_chosen_options(self) -> None:
        answered = self.answer(
            self.ask([REQUIRED_MULTI]), {"areas": ["api"]}, own={"areas": "The docs"}
        )
        self.assertEqual(
            ({"areas": ["api"]}, {"areas": "The docs"}), (answered["answers"], answered["own"])
        )
        alone = self.answer(self.ask([REQUIRED_MULTI]), {}, own={"areas": "Only the docs"})
        self.assertEqual(({}, {"areas": "Only the docs"}), (alone["answers"], alone["own"]))

    def test_an_option_and_an_own_variant_exclude_each_other_in_a_single_choice(self) -> None:
        for field, value in ((CHOICE, "keep"), (REQUIRED_BOOLEAN, True)):
            request = self.ask([field])
            with (
                self.subTest(field=field["type"]),
                self.assertRaisesRegex(model.PlanningError, "not both"),
            ):
                self.answer(request, {field["id"]: value}, own={field["id"]: "Something else"})
            self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])

    def test_a_text_field_has_no_own_variant(self) -> None:
        request = self.ask([TEXT])
        with self.assertRaisesRegex(model.PlanningError, "own: why is a text field"):
            self.answer(request, {"why": "Cheap"}, own={"why": "Cheaper"})

    def test_an_own_variant_names_a_known_field_and_says_something(self) -> None:
        request = self.ask()
        for own in ({"nope": "x"}, {"path": "   "}, {"path": 1}, ["path"]):
            with self.subTest(own=own), self.assertRaises(model.PlanningError):
                self.answer(request, {}, own=own)

    def test_an_own_variant_runs_to_8000_characters(self) -> None:
        request = self.ask()
        with self.assertRaisesRegex(model.PlanningError, "at most 8000 characters"):
            self.answer(request, {}, own={"path": "o" * 8001})
        self.assertEqual(
            "o" * 8000, self.answer(request, {}, own={"path": "o" * 8000})["own"]["path"]
        )


class FieldNoteTests(AnswerCase):
    def test_a_field_with_options_takes_a_comment_beside_its_answer(self) -> None:
        answered = self.answer(
            self.ask([CHOICE, MULTI]),
            {"path": "keep"},
            field_notes={"path": "Because it is cheap", "areas": "None of these yet"},
        )
        self.assertEqual(
            {"path": "Because it is cheap", "areas": "None of these yet"},
            answered["field_notes"],
        )
        self.assertEqual(
            {
                "path": "keep",
                "_notes": {"path": "Because it is cheap", "areas": "None of these yet"},
            },
            self.stored_answers(answered),
        )

    def test_a_text_field_takes_no_comment(self) -> None:
        request = self.ask([TEXT])
        with self.assertRaisesRegex(model.PlanningError, "field_notes: why is a text field"):
            self.answer(request, {"why": "Cheap"}, field_notes={"why": "And quick"})
        self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])

    def test_a_field_comment_runs_to_2000_characters(self) -> None:
        request = self.ask()
        with self.assertRaisesRegex(model.PlanningError, "at most 2000 characters"):
            self.answer(request, {"path": "keep"}, field_notes={"path": "c" * 2001})


class RequiredFieldTests(AnswerCase):
    def test_a_note_no_longer_stands_in_for_a_required_field(self) -> None:
        request = self.ask()
        with self.assertRaises(model.PlanningError) as refused:
            self.answer(request, {}, note="Neither: ask the vendor first.")
        self.assertEqual(NOTE_NO_LONGER, str(refused.exception))
        self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])

    def test_a_field_comment_does_not_answer_its_field(self) -> None:
        request = self.ask()
        with self.assertRaises(model.PlanningError) as refused:
            self.answer(request, {}, field_notes={"path": "Not sure"})
        self.assertEqual(NOTE_NO_LONGER, str(refused.exception))

    def test_a_required_text_field_is_told_where_its_answer_goes(self) -> None:
        request = self.ask([{**TEXT, "required": True}])
        with self.assertRaisesRegex(
            model.PlanningError, "answer why is required; .*a note no longer stands in"
        ):
            self.answer(request, {}, note="See above")

    def test_the_note_stays_a_comment_on_the_whole_question(self) -> None:
        answered = self.answer(self.ask(), {"path": "keep"}, note="And the docs.")
        self.assertEqual(
            ({"path": "keep"}, "And the docs."), (answered["answers"], answered["note"])
        )


class FirstAnswerTests(AnswerCase):
    def test_a_first_answer_is_version_1_and_has_no_history(self) -> None:
        request = self.ask()
        self.assertEqual(0, self.row(request)["answer_version"])
        self.assertEqual(0, requests.get(self.conn, request["request_id"])["answer_version"])
        answered = self.answer(request, {"path": "keep"})
        self.assertEqual(1, self.row(request)["answer_version"])
        self.assertEqual((1, []), (answered["answer_version"], answered["history"]))

    def test_a_person_s_first_answer_is_version_1_too(self) -> None:
        request = self.ask()
        self.as_person("answer", request, answers={"path": "keep"})
        self.assertEqual(1, self.row(request)["answer_version"])

    def test_declining_or_withdrawing_gives_no_version(self) -> None:
        for tool in ("decline_work_item_request", "expire_work_item_request"):
            request = self.ask()
            self.tool(tool, id=request["request_id"], expected_revision=0)
            with self.subTest(tool=tool):
                self.assertEqual(0, self.row(request)["answer_version"])


class ChangeTests(AnswerCase):
    def test_a_change_keeps_the_replaced_answer_as_a_version(self) -> None:
        request = self.ask()
        first = self.as_person("answer", request, answers={"path": "keep"}, note="First")
        self.conn.execute(
            "UPDATE work_item_requests SET resolved_at=? WHERE request_id=?",
            (OLD, request["request_id"]),
        )
        self.conn.commit()
        changed = self.as_person(
            "change", first, answers={"path": "drop"}, field_notes={"path": "It costs too much"}
        )
        self.assertEqual(
            ("answered", {"path": "drop"}, {"path": "It costs too much"}, None, 2),
            (
                changed["status"],
                changed["answers"],
                changed["field_notes"],
                changed["note"],
                changed["answer_version"],
            ),
        )
        self.assertEqual(first["revision"] + 1, changed["revision"])
        self.assertGreater(changed["resolved_at"], OLD)
        self.assertEqual(
            [
                {
                    "version": 1,
                    "answers": {"path": "keep"},
                    "own": {},
                    "field_notes": {},
                    "note": "First",
                    "answered_by": "user",
                    "answered_at": OLD,
                    "by_person": True,
                }
            ],
            changed["history"],
        )
        self.assertEqual(
            ["request_answered", "request_changed"],
            [
                row[0]
                for row in self.conn.execute(
                    "SELECT action FROM work_item_events WHERE detail=? AND action<>'request_created'"
                    " ORDER BY id",
                    (request["request_id"],),
                )
            ],
        )

    def test_a_reader_of_answers_after_a_time_finds_the_change(self) -> None:
        request = self.ask()
        first = self.answer(request, {"path": "keep"})
        self.conn.execute(
            "UPDATE work_item_requests SET resolved_at=? WHERE request_id=?",
            (OLD, request["request_id"]),
        )
        self.conn.commit()
        after = "2010-01-01T00:00:00Z"
        self.assertEqual([], self.tool("list_work_item_requests", answered_after=after)["requests"])
        self.as_person("change", first, answers={"path": "drop"})
        [found] = self.tool("list_work_item_requests", answered_after=after)["requests"]
        self.assertEqual(
            (request["request_id"], 2, [{"field": "path", "value": "drop", "label": "Drop it"}]),
            (found["id"], found["answer_version"], found["answer"]),
        )

    def test_an_agent_changes_an_answer_through_mcp_and_is_no_person(self) -> None:
        request = self.ask()
        first = self.as_person("answer", request, answers={"path": "keep"})
        changed = self.change(first, {"path": "drop"}, note="The owner asked for this")
        self.assertEqual(
            (2, "the-owner", False),
            (changed["answer_version"], changed["answered_by"], changed["by_person"]),
        )
        self.assertEqual([True], [version["by_person"] for version in changed["history"]])
        # The person changes it back: the agent's version is kept as the agent's.
        again = self.as_person("change", changed, answers={"path": "keep"})
        self.assertEqual((3, True), (again["answer_version"], again["by_person"]))
        self.assertEqual(
            [(1, True, "user"), (2, False, "the-owner")],
            [
                (version["version"], version["by_person"], version["answered_by"])
                for version in again["history"]
            ],
        )

    def test_a_version_no_call_gave_is_nobody_known(self) -> None:
        # As on a comment: `by_person` is null for a row no call wrote, such as
        # one older than call identity or a write made outside any call.
        request = self.ask()
        first = requests.resolve(
            self.conn,
            request["request_id"],
            status="answered",
            expected_revision=request["revision"],
            answers={"path": "keep"},
        )
        self.conn.commit()
        changed = self.as_person("change", first, answers={"path": "drop"})
        self.assertEqual(
            [(1, None)],
            [(version["version"], version["by_person"]) for version in changed["history"]],
        )
        self.assertIs(True, changed["by_person"])

    def test_who_answered_is_read_from_the_latest_call_on_every_read(self) -> None:
        request = self.ask()
        first = self.answer(request, {"path": "keep"})
        self.as_person("change", first, answers={"path": "drop"})
        self.assertIs(True, requests.get(self.conn, request["request_id"])["by_person"])
        self.assertIs(True, self.compact(request)["by_person"])
        [listed] = requests.list_requests(self.conn, reference=self.reference)
        self.assertIs(True, listed["by_person"])

    def test_the_same_answer_again_is_refused_as_unchanged(self) -> None:
        request = self.ask()
        first = self.answer(request, {"path": "keep"}, note="Same")
        with self.assertRaisesRegex(model.PlanningError, r"\[unchanged\]") as refused:
            self.change(first, {"path": "keep"}, note="  Same  ")
        # The request is well formed and repeats itself: no workflow guard stops it.
        self.assertEqual(
            (400, "invalid_request"),
            (
                api.error_response(refused.exception)[0],
                api.error_response(refused.exception)[1]["error"]["code"],
            ),
        )
        self.assertEqual(1, self.row(request)["answer_version"])

    def test_the_same_options_in_another_order_are_unchanged(self) -> None:
        # A multi_choice answer is the set of options chosen: the order they were
        # sent in says nothing, so it is the answer already given.
        request = self.ask([CHOICE, MULTI])
        first = self.answer(request, {"path": "keep", "areas": ["api", "web"]})
        with self.assertRaisesRegex(model.PlanningError, r"\[unchanged\]"):
            self.change(first, {"path": "keep", "areas": ["web", "api"]})
        self.assertEqual(
            (1, {"path": "keep", "areas": ["api", "web"]}),
            (self.row(request)["answer_version"], self.stored_answers(first)),
        )

    def test_answering_again_without_change_is_still_refused(self) -> None:
        first = self.answer(self.ask(), {"path": "keep"})
        with self.assertRaisesRegex(model.WorkflowGuardError, "no longer pending"):
            self.answer(first, {"path": "drop"})

    def test_only_an_answered_question_changes(self) -> None:
        pending = self.ask()
        with self.assertRaisesRegex(model.WorkflowGuardError, "only an answered question"):
            self.change(pending, {"path": "keep"})
        declined = self.tool(
            "decline_work_item_request", id=self.ask()["request_id"], expected_revision=0
        )
        with self.assertRaisesRegex(model.WorkflowGuardError, "only an answered question"):
            self.change(declined, {"path": "keep"})

    def test_a_change_names_the_revision_it_read(self) -> None:
        request = self.ask()
        first = self.answer(request, {"path": "keep"})
        with self.assertRaises(model.RevisionConflictError):
            self.change(request, {"path": "drop"})
        self.assertEqual(1, self.change(first, {"path": "drop"})["revision"] - first["revision"])

    def test_a_change_is_held_to_the_same_fields(self) -> None:
        first = self.answer(self.ask(), {"path": "keep"})
        with self.assertRaises(model.PlanningError) as refused:
            self.change(first, {}, note="Changed my mind")
        self.assertEqual(NOTE_NO_LONGER, str(refused.exception))

    def test_a_closed_item_keeps_its_answer(self) -> None:
        first = self.answer(self.ask(), {"path": "keep"})
        service.set_summary(self.conn, self.reference, {"done": "Closed", "next": "Nothing"})
        service.transition_work_item(self.conn, self.reference, "cancelled")
        self.conn.commit()
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[task_closed\]"):
            self.as_person("change", first, answers={"path": "drop"})
        self.assertEqual({"path": "keep"}, self.stored_answers(first))

    def test_an_answer_has_at_most_50_versions(self) -> None:
        request = self.ask()
        first = self.answer(request, {"path": "keep"})
        self.conn.execute(
            "UPDATE work_item_requests SET answer_version=49 WHERE request_id=?",
            (request["request_id"],),
        )
        self.conn.commit()
        fiftieth = self.change(first, {"path": "drop"})
        self.assertEqual(50, fiftieth["answer_version"])
        with self.assertRaisesRegex(model.WorkflowGuardError, r"\[answer_versions\]"):
            self.change(fiftieth, {"path": "keep"})

    def test_the_change_tool_flag_is_a_boolean(self) -> None:
        first = self.answer(self.ask(), {"path": "keep"})
        with self.assertRaisesRegex(api.PlanningHttpError, "change must be a boolean"):
            self.answer(first, {"path": "drop"}, change="yes")


class CompactFormTests(AnswerCase):
    def test_a_row_carries_its_own_variant_and_comment(self) -> None:
        request = self.ask([CHOICE, MULTI])
        self.answer(
            request,
            {"areas": ["api"]},
            own={"path": "Ask first", "areas": "The docs"},
            field_notes={"areas": "Mostly the API"},
        )
        self.assertEqual(
            [
                {"field": "path", "value": None, "label": None, "own": "Ask first"},
                {
                    "field": "areas",
                    "value": ["api"],
                    "label": "The API",
                    "own": "The docs",
                    "note": "Mostly the API",
                },
            ],
            self.compact(request)["answer"],
        )

    def test_a_first_answer_has_no_previous(self) -> None:
        request = self.ask()
        self.answer(request, {"path": "keep"})
        compact = self.compact(request)
        self.assertEqual(1, compact["answer_version"])
        self.assertNotIn("previous", compact)

    def test_a_changed_answer_shows_the_one_it_replaced(self) -> None:
        request = self.ask()
        first = self.answer(request, {"path": "keep"}, note="First thought")
        self.change(first, {"path": "drop"})
        compact = self.compact(request)
        self.assertEqual(
            (
                2,
                [{"field": "path", "value": "drop", "label": "Drop it"}],
                {
                    "answer": [{"field": "path", "value": "keep", "label": "Keep it"}],
                    "note": "First thought",
                    "answered_at": first["resolved_at"],
                },
            ),
            (compact["answer_version"], compact["answer"], compact["previous"]),
        )
        self.assertNotIn("clipped", compact)

    def test_the_replaced_answer_is_cut_first_to_keep_2000_characters(self) -> None:
        fields = [{**TEXT, "id": f"t{n}", "label": f"Text {n}"} for n in range(6)]
        request = self.ask(fields)
        first = self.answer(
            request, {f"t{n}": f"{n}" + "w" * 450 for n in range(6)}, note="n" * 450
        )
        self.change(first, {"t0": "short"}, note="Now brief")
        compact = self.compact(request)
        self.assertLessEqual(len(json.dumps(compact, ensure_ascii=False)), 2000)
        self.assertIs(True, compact["clipped"])
        # The current answer is whole; what the replaced one lost is what was cut.
        self.assertEqual(
            ([{"field": "t0", "value": "short", "label": None}], "Now brief"),
            (compact["answer"], compact["note"]),
        )
        self.assertLess(len(compact["previous"]["answer"]), 6)

    def test_replies_count_and_the_latest_one_is_quoted(self) -> None:
        request = self.ask()
        compact = self.compact(request)
        self.assertEqual((0, None), (compact["replies"], compact["last_reply"]))
        self.reply(request, "First", author="asking-agent")
        latest = self.reply(request, "r" * 501, author="the-owner")
        compact = self.compact(request)
        self.assertEqual(2, compact["replies"])
        self.assertEqual(
            {
                "id": latest,
                "author": "the-owner",
                "by_person": None,
                "at": compact["last_reply"]["at"],
                "body": "r" * 500,
                "clipped": True,
            },
            compact["last_reply"],
        )
        [on_item] = self.tool("get_work_item", id=self.reference)["questions"]["items"]
        self.assertEqual((2, latest), (on_item["replies"], on_item["last_reply"]["id"]))

    def test_a_reply_through_the_interface_is_a_person_s(self) -> None:
        request = self.ask()
        with calls.bind(calls.browser(), "test"):
            self.conn.execute(
                "INSERT INTO work_item_comments(work_item_id,author,body,reply_to_request,call_id)"
                " VALUES(?,?,?,?,?)",
                (
                    request["work_item_id"],
                    "user",
                    "Short",
                    request["request_id"],
                    calls.call_id(self.conn, request["work_item_id"]),
                ),
            )
        self.conn.commit()
        last = self.compact(request)["last_reply"]
        self.assertEqual(("Short", True), (last["body"], last["by_person"]))
        self.assertNotIn("clipped", last)


class FullFormTests(AnswerCase):
    def test_get_work_item_request_carries_the_versions_and_the_whole_thread(self) -> None:
        request = self.ask([CHOICE, MULTI])
        first = self.answer(request, {"path": "keep"}, own={"areas": "Docs"})
        self.change(first, {"path": "drop"}, field_notes={"path": "Too dear"})
        first_reply = self.reply(request, "Why drop it?")
        second_reply = self.reply(request, "x" * 900, author="the-owner")
        read = self.tool("get_work_item_request", id=request["request_id"])
        self.assertEqual(
            ({"path": "drop"}, {}, {"path": "Too dear"}, 2),
            (read["answers"], read["own"], read["field_notes"], read["answer_version"]),
        )
        self.assertEqual(
            [(1, {"path": "keep"}, {"areas": "Docs"})],
            [(v["version"], v["answers"], v["own"]) for v in read["history"]],
        )
        self.assertEqual(
            [(first_reply, "Why drop it?"), (second_reply, "x" * 900)],
            [(reply["id"], reply["body"]) for reply in read["replies"]],
        )
        # The flat form of a comment, as every comment read gives it.
        self.assertEqual(
            {
                "id": first_reply,
                "kind": "comment",
                "report": None,
                "checklist_item_id": None,
                "checklist_item_text": None,
                "author": "someone",
                "body": "Why drop it?",
                "at": read["replies"][0]["at"],
                "reply_to": None,
                "reply_to_request": request["request_id"],
                "by_person": None,
                "resolution": None,
            },
            read["replies"][0],
        )
        # The interface's read and a write's answer do not carry the thread.
        self.assertNotIn("replies", requests.get(self.conn, request["request_id"]))

    def test_an_export_carries_the_versions_and_not_the_thread(self) -> None:
        first = self.answer(self.ask(), {"path": "keep"})
        self.change(first, {"path": "drop"})
        self.reply(first, "Noted")
        payload = json.loads(export.render(export.export_installation(self.conn)))
        [kept] = payload["planning"]["requests"]
        self.assertEqual(
            (2, [{"path": "keep"}]),
            (kept["answer_version"], [v["answers"] for v in kept["history"]]),
        )
        self.assertNotIn("replies", kept)

    def test_a_pending_question_has_no_answer_parts(self) -> None:
        read = self.tool("get_work_item_request", id=self.ask()["request_id"])
        self.assertEqual(
            (None, None, None, None, 0, [], []),
            (
                read["answers"],
                read["own"],
                read["field_notes"],
                read["note"],
                read["answer_version"],
                read["history"],
                read["replies"],
            ),
        )


class OldRowTests(AnswerCase):
    def test_a_note_given_in_place_of_a_field_reads_as_an_unanswered_field(self) -> None:
        request = self.ask()
        self.conn.execute(
            "UPDATE work_item_requests SET status='answered',answers_json=?,answered_by='user',"
            "resolved_at=?,answer_version=1,revision=1 WHERE request_id=?",
            (json.dumps({"_note": "Neither: ask the vendor"}), OLD, request["request_id"]),
        )
        self.conn.commit()
        read = requests.get(self.conn, request["request_id"])
        self.assertEqual(
            ({}, {}, {}, "Neither: ask the vendor", 1),
            (
                read["answers"],
                read["own"],
                read["field_notes"],
                read["note"],
                read["answer_version"],
            ),
        )
        compact = self.compact(request)
        self.assertEqual(([], "Neither: ask the vendor"), (compact["answer"], compact["note"]))
        # Changing it is held to today's rule.
        with self.assertRaises(model.PlanningError) as refused:
            self.change(read, {}, note="Still neither")
        self.assertEqual(NOTE_NO_LONGER, str(refused.exception))
        changed = self.change(read, {}, own={"path": "Ask the vendor"})
        self.assertEqual(
            [(1, {}, "Neither: ask the vendor")],
            [(v["version"], v["answers"], v["note"]) for v in changed["history"]],
        )


class AnswerTextTests(unittest.TestCase):
    def test_one_line_names_own_variants_and_comments(self) -> None:
        stored = request_model.stored_answers(
            {"areas": ["api"]},
            "And the docs.",
            own={"path": "Ask first", "areas": "The docs"},
            field_notes={"areas": "Mostly the API"},
        )
        self.assertEqual(
            "Which path: own variant: Ask first; Areas: The API, own variant: The docs"
            " (comment: Mostly the API); And the docs.",
            request_model.answer_text([CHOICE, MULTI], stored),
        )


if __name__ == "__main__":
    unittest.main()
