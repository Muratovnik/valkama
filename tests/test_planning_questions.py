"""A question is a request row, and an agent reads it three ways.

Every expected value is stated from the contract rather than read from the code
under test. The stores are real ones brought up by `connect`, and an agent's
reads and writes go through `mcp_surface.call_tool`, the path a client reaches.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store, store_backups
from server.ops import export
from server.planning import api, model, requests, service, tools

CHOICE = {
    "id": "path",
    "label": "Which path",
    "type": "choice",
    "required": True,
    "options": [
        {
            "id": "keep",
            "label": "Keep it",
            "description": "**Costs** nothing now.\n\nA second paragraph.",
            "recommended": True,
        },
        {"id": "drop", "label": "Drop it"},
    ],
}
MULTI = {
    "id": "areas",
    "label": "Areas",
    "type": "multi_choice",
    "required": False,
    "options": [{"id": "api", "label": "The API"}, {"id": "web", "label": "The web"}],
}
BOOLEAN = {"id": "sure", "label": "Sure", "type": "boolean", "required": False, "options": []}
TEXT = {"id": "why", "label": "Why", "type": "text", "required": False, "options": []}

#: Every key the web's strict schema accepts on a request: a new one here refuses
#: the whole list in the browser, so the HTTP read must not grow on its own.
WEB_REQUEST_KEYS = {
    "request_id",
    "work_item_id",
    "reference",
    "title",
    "kind",
    "prompt",
    "fields",
    "answers",
    "note",
    "by_person",
    "status",
    "author",
    "answered_by",
    "execution_id",
    "session_id",
    "expires_at",
    "created_at",
    "resolved_at",
    "revision",
    "expired_reason",
}
COMPACT_KEYS = {
    "id",
    "status",
    "question",
    "answer",
    "note",
    "answered_by",
    "by_person",
    "answered_at",
}


class QuestionCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "store.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="test", name="Questions", key="QST")
        self.reference = self.item("Pick a direction")
        self.conn.commit()

    def item(self, title: str) -> str:
        return str(service.create_work_item(self.conn, space="QST", title=title)["reference"])

    def tool(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments)
        self.conn.commit()
        return answer

    def ask(
        self,
        fields: list[dict] | None = None,
        reference: str | None = None,
        prompt: str = "Which way?",
    ) -> dict:
        return self.tool(
            "create_work_item_request",
            id=reference or self.reference,
            kind="decision",
            prompt=prompt,
            fields=fields if fields is not None else [CHOICE],
            author="asking-agent",
        )

    def answer(self, request: dict, answers: dict, **others: object) -> dict:
        return self.tool(
            "answer_work_item_request",
            id=request["request_id"],
            answers=answers,
            expected_revision=request["revision"],
            author="the-owner",
            **others,
        )

    def stored_answers(self, request: dict) -> object:
        return json.loads(
            self.conn.execute(
                "SELECT answers_json FROM work_item_requests WHERE request_id=?",
                (request["request_id"],),
            ).fetchone()[0]
        )


class OptionTests(QuestionCase):
    def test_an_option_keeps_its_description_and_recommendation(self) -> None:
        request = self.ask()
        self.assertEqual(CHOICE["options"], request["fields"][0]["options"])
        self.assertEqual(
            CHOICE["options"],
            self.tool("get_work_item_request", id=request["request_id"])["fields"][0]["options"],
        )

    def test_an_option_says_nothing_of_what_it_was_not_given(self) -> None:
        self.assertEqual({"id": "drop", "label": "Drop it"}, self.ask()["fields"][0]["options"][1])

    def test_a_description_runs_from_1_to_8000_characters(self) -> None:
        def with_description(text: object) -> list[dict]:
            return [
                {**CHOICE, "options": [{"id": "keep", "label": "Keep it", "description": text}]}
            ]

        self.assertEqual(
            "d" * 8000,
            self.ask(with_description("d" * 8000))["fields"][0]["options"][0]["description"],
        )
        for text, refusal in (
            ("d" * 8001, "at most 8000 characters"),
            ("", "option.description is required"),
            ("   ", "option.description is required"),
            (5, "must be a string"),
        ):
            with self.subTest(text=text):
                with self.assertRaisesRegex(model.PlanningError, refusal):
                    self.ask(with_description(text))
        self.assertEqual(
            1, self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0]
        )

    def test_one_recommendation_in_a_choice_and_any_number_in_a_multi_choice(self) -> None:
        options = [
            {"id": "keep", "label": "Keep it", "recommended": True},
            {"id": "drop", "label": "Drop it", "recommended": True},
        ]
        with self.assertRaisesRegex(model.PlanningError, "at most one"):
            self.ask([{**CHOICE, "options": options}])
        created = self.ask([{**MULTI, "options": options}])
        self.assertEqual(options, created["fields"][0]["options"])
        # False is no recommendation.
        allowed = [options[0], {"id": "drop", "label": "Drop it", "recommended": False}]
        self.assertEqual(
            allowed, self.ask([{**CHOICE, "options": allowed}])["fields"][0]["options"]
        )

    def test_an_option_takes_nothing_else_and_recommended_is_a_boolean(self) -> None:
        for option in (
            {"id": "keep", "label": "Keep it", "recommended": "yes"},
            {"id": "keep", "label": "Keep it", "colour": "red"},
            {"id": "keep", "description": "No label"},
        ):
            with self.subTest(option=option), self.assertRaises(model.PlanningError):
                requests.create(
                    self.conn,
                    self.reference,
                    kind="question",
                    prompt="Which?",
                    fields=[{**CHOICE, "options": [option]}],
                )
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0]
        )

    def test_the_fields_of_one_question_stop_at_64_kib_and_the_refusal_names_it(self) -> None:
        def many(length: int, letter: str = "d") -> list[dict]:
            return [
                {
                    **CHOICE,
                    "id": f"f{field}",
                    "options": [
                        {"id": f"o{option}", "label": "L", "description": letter * length}
                        for option in range(20)
                    ],
                }
                for field in range(2)
            ]

        with self.assertRaisesRegex(model.PlanningError, "64 KiB"):
            self.ask(many(1700))
        # Bytes as stored, so text that is not ASCII reaches the limit sooner.
        with self.assertRaisesRegex(model.PlanningError, "64 KiB"):
            self.ask(many(850, "я"))
        fits = self.ask(many(1500))
        self.assertEqual(2, len(fits["fields"]))


class NoteTests(QuestionCase):
    def test_a_note_stands_in_for_required_fields_and_reads_apart_from_the_answers(self) -> None:
        request = self.ask()
        answered = self.answer(request, {}, note="  Neither: ask the vendor first.  ")
        self.assertEqual("answered", answered["status"])
        self.assertEqual({}, answered["answers"])
        self.assertEqual("Neither: ask the vendor first.", answered["note"])
        # Kept with the answers under a key no field id can take.
        self.assertEqual({"_note": "Neither: ask the vendor first."}, self.stored_answers(request))
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM pragma_table_info('work_item_requests') WHERE name='note'"
            ).fetchone()[0],
        )

    def test_a_note_comes_beside_given_answers(self) -> None:
        answered = self.answer(self.ask(), {"path": "keep"}, note="And the docs.")
        self.assertEqual(
            ({"path": "keep"}, "And the docs."), (answered["answers"], answered["note"])
        )

    def test_no_note_reads_null_and_a_pending_question_has_no_answers(self) -> None:
        request = self.ask()
        self.assertEqual((None, None), (request["answers"], request["note"]))
        answered = self.answer(request, {"path": "keep"})
        self.assertEqual(({"path": "keep"}, None), (answered["answers"], answered["note"]))
        self.assertEqual({"path": "keep"}, self.stored_answers(request))

    def test_without_a_note_a_required_field_is_still_required(self) -> None:
        request = self.ask()
        for note in (None, "", "   "):
            with (
                self.subTest(note=note),
                self.assertRaisesRegex(model.PlanningError, "answer path is required"),
            ):
                requests.resolve(
                    self.conn,
                    request["request_id"],
                    status="answered",
                    expected_revision=0,
                    answers={},
                    note=note,
                )
        self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])

    def test_a_given_answer_is_still_checked_when_a_note_comes_with_it(self) -> None:
        request = self.ask()
        with self.assertRaisesRegex(model.PlanningError, "answer path does not match its field"):
            self.answer(request, {"path": "neither"}, note="Something else")
        self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])

    def test_a_note_cannot_be_written_as_an_answer(self) -> None:
        request = self.ask()
        with self.assertRaisesRegex(model.PlanningError, "known field ids"):
            self.answer(request, {"path": "keep", "_note": "Smuggled"})

    def test_a_note_is_held_to_8000_characters(self) -> None:
        request = self.ask()
        with self.assertRaisesRegex(model.PlanningError, "at most 8000 characters"):
            requests.resolve(
                self.conn,
                request["request_id"],
                status="answered",
                expected_revision=0,
                answers={"path": "keep"},
                note="n" * 8001,
            )
        self.assertEqual(
            "n" * 8000, self.answer(request, {"path": "keep"}, note="n" * 8000)["note"]
        )

    def test_the_plain_http_path_takes_a_note_and_declining_does_not(self) -> None:
        request = self.ask()
        with self.assertRaisesRegex(api.PlanningHttpError, "unknown fields"):
            api.handle_post(
                self.conn,
                "/api/planning/request/decline",
                {"id": request["request_id"], "expected_revision": 0, "note": "No such field"},
            )
        answer = api.handle_post(
            self.conn,
            "/api/planning/request/answer",
            {
                "id": request["request_id"],
                "answers": {},
                "note": "My own words",
                "expected_revision": 0,
            },
        )
        assert answer is not None
        self.assertEqual((200, "My own words"), (answer[0], answer[1]["note"]))


class ResolutionTests(QuestionCase):
    def test_an_answer_cannot_be_changed_or_given_twice(self) -> None:
        request = self.ask()
        answered = self.answer(request, {"path": "keep"}, note="First")
        with self.assertRaises(model.WorkflowGuardError):
            self.answer(answered, {"path": "drop"}, note="Second")
        with self.assertRaises(model.RevisionConflictError):
            self.answer(request, {"path": "drop"}, note="Second")
        kept = requests.get(self.conn, request["request_id"])
        self.assertEqual(
            ({"path": "keep"}, "First", 1), (kept["answers"], kept["note"], kept["revision"])
        )

    def test_a_comment_over_an_open_question_is_no_answer(self) -> None:
        request = self.ask()
        service.comment_work_item(self.conn, self.reference, "keep", author="the-owner")
        self.conn.commit()
        kept = requests.get(self.conn, request["request_id"])
        self.assertEqual(("pending", None, 0), (kept["status"], kept["answers"], kept["revision"]))
        read = self.tool("get_work_item", id=self.reference)
        self.assertEqual(1, read["questions"]["open"])

    def test_a_question_writes_no_comment_and_moves_no_stamp(self) -> None:
        self.answer(self.ask(), {"path": "keep"}, note="Fine")
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        )
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, self.conn.execute("PRAGMA user_version").fetchone()[0]
        )


class ByPersonTests(QuestionCase):
    def test_an_answer_through_the_agent_tool_is_not_a_persons(self) -> None:
        request = self.ask()
        self.assertIsNone(self.tool("get_work_item_request", id=request["request_id"])["by_person"])
        self.answer(request, {"path": "keep"})
        self.assertIs(
            False, self.tool("get_work_item_request", id=request["request_id"])["by_person"]
        )

    def test_the_caller_cannot_say_who_it_is(self) -> None:
        request = self.ask()
        with self.assertRaises(api.PlanningHttpError):
            self.answer(request, {"path": "keep"}, by_person=True)
        with self.assertRaisesRegex(api.PlanningHttpError, "unknown fields"):
            api.handle_post(
                self.conn,
                "/api/planning/request/answer",
                {
                    "id": request["request_id"],
                    "answers": {"path": "keep"},
                    "expected_revision": 0,
                    "by_person": True,
                },
            )
        self.assertEqual("pending", requests.get(self.conn, request["request_id"])["status"])


class CompactFormTests(QuestionCase):
    def compact(self, request: dict) -> dict:
        [found] = [
            row
            for row in self.tool("list_work_item_requests", id=self.reference)["requests"]
            if row["id"] == request["request_id"]
        ]
        return found

    def test_a_pending_question_in_the_compact_form(self) -> None:
        request = self.ask()
        self.assertEqual(
            {
                "id": request["request_id"],
                "status": "pending",
                "question": "Which way?",
                "answer": [],
                "note": None,
                "answered_by": None,
                "by_person": None,
                "answered_at": None,
            },
            self.compact(request),
        )

    def test_an_answered_question_in_the_compact_form(self) -> None:
        request = self.ask([CHOICE, MULTI, BOOLEAN, TEXT])
        answered = self.answer(
            request,
            {"path": "keep", "areas": ["api", "web"], "sure": False, "why": "It is cheap"},
            note="And the docs.",
        )
        self.assertEqual(
            {
                "id": request["request_id"],
                "status": "answered",
                "question": "Which way?",
                "answer": [
                    {"field": "path", "value": "keep", "label": "Keep it"},
                    {"field": "areas", "value": ["api", "web"], "label": "The API, The web"},
                    {"field": "sure", "value": False, "label": None},
                    {"field": "why", "value": "It is cheap", "label": None},
                ],
                "note": "And the docs.",
                "answered_by": "the-owner",
                "by_person": False,
                "answered_at": answered["resolved_at"],
            },
            self.compact(request),
        )

    def test_a_field_left_out_or_empty_is_not_named(self) -> None:
        request = self.ask([CHOICE, MULTI, TEXT])
        self.answer(request, {"path": "drop", "areas": [], "why": "  "})
        self.assertEqual(
            [{"field": "path", "value": "drop", "label": "Drop it"}],
            self.compact(request)["answer"],
        )

    def test_the_question_is_cut_at_160_characters_with_an_ellipsis(self) -> None:
        exact = self.ask(prompt="q" * 160)
        self.assertEqual("q" * 160, self.compact(exact)["question"])
        longer = self.ask(prompt="q" * 161)
        self.assertEqual("q" * 160 + "…", self.compact(longer)["question"])

    def test_it_carries_no_options_and_no_descriptions(self) -> None:
        request = self.ask()
        compact = self.compact(request)
        self.assertEqual(COMPACT_KEYS, set(compact))
        self.assertNotIn("Costs", json.dumps(compact))

    def test_a_declined_question_names_no_answerer(self) -> None:
        request = self.ask()
        self.tool(
            "decline_work_item_request",
            id=request["request_id"],
            expected_revision=0,
            author="the-owner",
        )
        compact = self.compact(request)
        self.assertEqual(
            # Who declined it is no answerer, and the call that did was an agent's.
            ("declined", None, False, None),
            (
                compact["status"],
                compact["answered_by"],
                compact["by_person"],
                compact["answered_at"],
            ),
        )


class ThreeReadsTests(QuestionCase):
    def test_get_work_item_says_how_many_and_shows_open_first_then_newest_closed(self) -> None:
        for index in range(4):
            self.answer(self.ask(prompt=f"Closed {index}"), {"path": "keep"})
        for index in range(2):
            self.ask(prompt=f"Open {index}")
        questions = self.tool("get_work_item", id=self.reference)["questions"]
        self.assertEqual(
            (6, 2, True), (questions["total"], questions["open"], questions["truncated"])
        )
        self.assertEqual(
            ["Open 1", "Open 0", "Closed 3", "Closed 2", "Closed 1"],
            [row["question"] for row in questions["items"]],
        )
        self.assertEqual(COMPACT_KEYS, set(questions["items"][0]))

    def test_nothing_is_cut_at_five_and_no_questions_read_as_none(self) -> None:
        self.assertEqual(
            {"total": 0, "open": 0, "items": [], "truncated": False},
            self.tool("get_work_item", id=self.reference)["questions"],
        )
        for index in range(5):
            self.ask(prompt=f"Open {index}")
        questions = self.tool("get_work_item", id=self.reference)["questions"]
        self.assertEqual(
            (5, 5, False), (questions["total"], len(questions["items"]), questions["truncated"])
        )

    def test_the_http_card_does_not_carry_them(self) -> None:
        self.ask()
        answer = api.handle_get(self.conn, "/api/planning/work-item", {"id": [self.reference]})
        assert answer is not None
        self.assertNotIn("questions", answer[1]["work_item"])

    def test_get_work_item_request_gives_the_whole_question(self) -> None:
        request = self.ask()
        self.answer(request, {"path": "keep"}, note="Fine")
        full = self.tool("get_work_item_request", id=request["request_id"])
        self.assertEqual("Which way?", full["prompt"])
        self.assertEqual([CHOICE], full["fields"])
        self.assertEqual(
            ({"path": "keep"}, "Fine", False), (full["answers"], full["note"], full["by_person"])
        )

    def test_the_list_filters_by_space_item_status_and_answered_after(self) -> None:
        other = self.item("Elsewhere")
        first = self.ask()
        second = self.ask(reference=other)
        third = self.ask()
        answered = self.answer(first, {"path": "keep"})
        later = self.answer(second, {"path": "drop"})

        def ids(**filters: object) -> set[str]:
            found = self.tool("list_work_item_requests", **filters)["requests"]
            return {row["id"] for row in found}

        everyone = {first["request_id"], second["request_id"], third["request_id"]}
        self.assertEqual(everyone, ids(space="QST"))
        self.assertEqual({second["request_id"]}, ids(id=other))
        self.assertEqual({third["request_id"]}, ids(status="pending"))
        self.assertEqual(
            {first["request_id"], second["request_id"]},
            ids(answered_after="2000-01-01T00:00:00Z"),
        )
        self.assertEqual({second["request_id"]}, ids(answered_after=answered["resolved_at"]))
        self.assertEqual(set(), ids(answered_after=later["resolved_at"]))
        with self.assertRaisesRegex(model.PlanningError, "answered_after"):
            ids(answered_after="yesterday")

    def test_the_list_is_compact_unless_asked_for_all_of_it(self) -> None:
        request = self.ask()
        [compact] = self.tool("list_work_item_requests", space="QST")["requests"]
        self.assertEqual(COMPACT_KEYS, set(compact))
        [full] = self.tool("list_work_item_requests", space="QST", full=True)["requests"]
        self.assertEqual(request["request_id"], full["request_id"])
        self.assertEqual([CHOICE], full["fields"])
        self.assertIn("by_person", full)

    def test_the_http_read_stays_what_the_web_schema_accepts(self) -> None:
        request = self.ask()
        self.answer(request, {"path": "keep"}, note="Fine")
        listed = api.handle_get(self.conn, "/api/planning/requests", {"space": ["QST"]})
        detail = api.handle_get(self.conn, "/api/planning/request", {"id": [request["request_id"]]})
        assert listed is not None and detail is not None
        self.assertEqual(WEB_REQUEST_KEYS, set(listed[1]["requests"][0]))
        self.assertEqual(WEB_REQUEST_KEYS, set(detail[1]["request"]))

    def test_the_tool_schemas_say_what_the_tools_take(self) -> None:
        schemas = {tool["name"]: tool for tool in tools.TOOLS}
        answer = schemas["answer_work_item_request"]["inputSchema"]
        self.assertEqual(8000, answer["properties"]["note"]["maxLength"])
        self.assertEqual(["id", "answers", "expected_revision"], answer["required"])
        self.assertNotIn("by_person", answer["properties"])
        option = schemas["create_work_item_request"]["inputSchema"]["properties"]["fields"][
            "items"
        ]["properties"]["options"]["items"]
        self.assertEqual(["id", "label"], option["required"])
        self.assertEqual(8000, option["properties"]["description"]["maxLength"])
        self.assertEqual("boolean", option["properties"]["recommended"]["type"])
        listing = schemas["list_work_item_requests"]["inputSchema"]["properties"]
        self.assertLessEqual({"space", "id", "status", "answered_after", "full"}, set(listing))
        self.assertIn("questions", schemas["get_work_item"]["description"])


class SearchTests(QuestionCase):
    def found(self, text: str) -> list[str]:
        return [item["reference"] for item in service.search_work_items(self.conn, text)]

    def test_search_finds_an_item_by_what_its_question_asks_and_was_answered(self) -> None:
        other = self.item("Unrelated")
        self.ask(
            [
                {
                    **CHOICE,
                    "options": [
                        {"id": "keep", "label": "Сохранить ключ", "description": "Без затрат"}
                    ],
                },
                TEXT,
            ],
            prompt="Which-prompt-needle?",
        )
        request = self.ask([TEXT], reference=other, prompt="Second")
        self.answer(request, {"why": "Ответная-иголка"}, note="Заметка-иголка")
        for text, reference in (
            ("Which-prompt-needle", self.reference),
            ("Сохранить ключ", self.reference),
            ("Без затрат", self.reference),
            ("Ответная-иголка", other),
            ("Заметка-иголка", other),
        ):
            with self.subTest(text=text):
                self.assertEqual([reference], self.found(text))

    def test_the_names_of_the_stored_keys_find_nothing(self) -> None:
        self.answer(self.ask([{**CHOICE, "required": False}]), {}, note="Fine")
        for text in ("_note", "recommended", "multi_choice"):
            with self.subTest(text=text):
                self.assertEqual([], self.found(text))

    def test_a_row_says_a_question_is_why_it_was_found(self) -> None:
        self.ask(prompt="Which-prompt-needle?")
        [row] = self.tool("search_work_items", query="Which-prompt-needle")["work_items"]
        self.assertEqual("Which-prompt-needle?", row["question_hit"])

    def test_an_attached_store_with_no_requests_is_still_searched(self) -> None:
        self.conn.execute("DROP TABLE work_item_requests")
        self.assertEqual([self.reference], self.found("Pick a direction"))


class KeptTests(QuestionCase):
    def test_an_export_carries_the_questions(self) -> None:
        request = self.ask()
        self.answer(request, {"path": "keep"}, note="Fine")
        payload = json.loads(export.render(export.export_installation(self.conn)))
        [exported] = payload["planning"]["requests"]
        self.assertEqual(request["request_id"], exported["request_id"])
        self.assertEqual(({"path": "keep"}, "Fine"), (exported["answers"], exported["note"]))
        self.assertEqual([CHOICE], exported["fields"])

    def test_an_export_of_one_space_carries_only_that_spaces_questions(self) -> None:
        self.ask()
        service.create_planning_space(self.conn, project_id="else", name="Else", key="ELS")
        elsewhere = str(
            service.create_work_item(self.conn, space="ELS", title="There")["reference"]
        )
        kept = self.ask(reference=elsewhere)
        payload = json.loads(export.render(export.export_installation(self.conn, spaces=("ELS",))))
        self.assertEqual(
            [kept["request_id"]], [row["request_id"] for row in payload["planning"]["requests"]]
        )

    def test_a_recovery_point_holds_them(self) -> None:
        request = self.ask()
        self.answer(request, {"path": "keep"}, note="Fine")
        snapshot = store_backups.snapshot(self.conn, store._backups(), "manual")
        restored = str(self.root / "restored.sqlite3")
        shutil.copyfile(snapshot, restored)
        copy = sqlite3.connect(restored)
        self.addCleanup(copy.close)
        self.assertEqual(
            [(request["request_id"], '{"_note":"Fine","path":"keep"}')],
            copy.execute("SELECT request_id,answers_json FROM work_item_requests").fetchall(),
        )

    def test_merging_moves_the_questions_to_the_survivor(self) -> None:
        survivor = self.reference
        merged = self.item("Asked here")
        answered = self.ask(reference=merged)
        self.answer(answered, {"path": "keep"}, note="Kept")
        pending = self.ask([TEXT], reference=merged)
        result = service.merge_work_items(self.conn, survivor, [merged], author="merging-agent")
        self.conn.commit()
        self.assertEqual(
            [f"{merged}'s 1 pending request(s) now wait on {survivor}"], result["warnings"]
        )
        for request in (answered, pending):
            self.assertEqual(survivor, requests.get(self.conn, request["request_id"])["reference"])
        # Still open on an open item: closing the merged one did not end it.
        self.assertEqual("pending", requests.get(self.conn, pending["request_id"])["status"])
        questions = self.tool("get_work_item", id=survivor)["questions"]
        self.assertEqual((2, 1), (questions["total"], questions["open"]))
        self.assertEqual(0, self.tool("get_work_item", id=merged)["questions"]["total"])
        self.assertEqual("Kept", requests.get(self.conn, answered["request_id"])["note"])
        # And it can still be answered where it now lives.
        self.assertEqual("answered", self.answer(pending, {"why": "Moved"})["status"])

    def test_closing_the_item_expires_a_pending_question(self) -> None:
        request = self.ask()
        service.set_summary(self.conn, self.reference, {"done": "Closed", "next": "Nothing"})
        service.transition_work_item(self.conn, self.reference, "cancelled")
        self.conn.commit()
        questions = self.tool("get_work_item", id=self.reference)["questions"]
        self.assertEqual((1, 0), (questions["total"], questions["open"]))
        self.assertEqual("expired", questions["items"][0]["status"])
        self.assertEqual(
            "task_closed", requests.get(self.conn, request["request_id"])["expired_reason"]
        )

    def test_deleting_an_item_takes_its_questions_with_it(self) -> None:
        self.ask()
        service.delete_work_item(self.conn, self.reference)
        self.conn.commit()
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0]
        )


if __name__ == "__main__":
    unittest.main()
