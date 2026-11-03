"""What reading a question costs and promises: who closed it, paging, and the compact bound.

Expected values come from the contract. An agent's calls go through
`mcp_surface.call_tool`, and an answer from the owner's interface runs under the
identity the HTTP surface binds, `calls.browser()`.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.ops import export
from server.planning import api, calls, model, requests, service
from server.projects import scopes
from tests import schema9
from tests.test_planning_questions import BOOLEAN, CHOICE, MULTI, TEXT, QuestionCase


def size(value: object) -> int:
    """Characters of JSON as a tool writes text, with the roomier default separators."""

    return len(json.dumps(value, ensure_ascii=False))


class ByPersonTests(QuestionCase):
    def http_request(self, request: dict) -> dict:
        answer = api.handle_get(self.conn, "/api/planning/request", {"id": [request["request_id"]]})
        assert answer is not None
        return answer[1]["request"]

    def http_listed(self, request: dict) -> dict:
        answer = api.handle_get(self.conn, "/api/planning/requests", {"space": ["QST"]})
        assert answer is not None
        return next(
            row for row in answer[1]["requests"] if row["request_id"] == request["request_id"]
        )

    def as_person(self, request: dict, status: str = "answered", **others: object) -> dict:
        with calls.bind(calls.browser(), "test"):
            closed = requests.resolve(
                self.conn,
                request["request_id"],
                status=status,
                expected_revision=request["revision"],
                **others,
            )
        self.conn.commit()
        return closed

    def test_every_http_read_says_null_while_nothing_has_closed_the_question(self) -> None:
        request = self.ask()
        self.assertIsNone(self.http_request(request)["by_person"])
        self.assertIsNone(self.http_listed(request)["by_person"])

    def test_an_agent_signing_as_the_owner_is_still_no_person(self) -> None:
        request = self.ask()
        answered = self.tool(
            "answer_work_item_request",
            id=request["request_id"],
            answers={"path": "keep"},
            expected_revision=0,
            author=calls.OWNER_ACTOR,
        )
        self.assertEqual(calls.OWNER_ACTOR, answered["answered_by"])
        self.assertIs(False, answered["by_person"])
        self.assertIs(False, self.http_request(request)["by_person"])
        self.assertIs(False, self.http_listed(request)["by_person"])
        [compact] = self.tool("list_work_item_requests", id=self.reference)["requests"]
        self.assertIs(False, compact["by_person"])

    def test_an_answer_through_the_interface_is_a_persons_whatever_it_signs(self) -> None:
        request = self.ask()
        answered = self.as_person(request, answers={"path": "keep"}, author="someone")
        self.assertEqual("someone", answered["answered_by"])
        self.assertIs(True, answered["by_person"])
        self.assertIs(True, self.http_request(request)["by_person"])
        self.assertIs(True, self.http_listed(request)["by_person"])

    def test_a_decline_or_withdrawal_says_whose_call_it_was(self) -> None:
        for tool, status in (
            ("decline_work_item_request", "declined"),
            ("expire_work_item_request", "expired"),
        ):
            with self.subTest(status=status):
                by_agent = self.ask()
                self.tool(
                    tool,
                    id=by_agent["request_id"],
                    expected_revision=0,
                    author=calls.OWNER_ACTOR,
                )
                self.assertIs(False, self.http_request(by_agent)["by_person"])
                by_person = self.ask()
                self.as_person(by_person, status=status)
                self.assertIs(True, self.http_request(by_person)["by_person"])

    def test_a_question_that_ran_out_by_itself_has_no_one_to_name(self) -> None:
        request = self.ask()
        self.conn.execute(
            "UPDATE work_item_requests SET expires_at='2020-01-01T00:00:00.000000Z'"
            " WHERE request_id=?",
            (request["request_id"],),
        )
        self.conn.commit()
        read = self.http_request(request)
        self.assertEqual(("expired", None), (read["status"], read["by_person"]))

    def test_a_merge_does_not_change_who_answered(self) -> None:
        merged = self.item("Asked here")
        request = self.ask(reference=merged)
        self.as_person(request, answers={"path": "keep"})
        service.merge_work_items(self.conn, self.reference, [merged], author="merging-agent")
        self.conn.commit()
        read = self.http_request(request)
        self.assertEqual((self.reference, True), (read["reference"], read["by_person"]))

    def test_an_export_says_it_too(self) -> None:
        by_agent = self.ask()
        self.answer(by_agent, {"path": "keep"})
        by_person = self.ask()
        self.as_person(by_person, answers={"path": "drop"})
        waiting = self.ask()
        payload = json.loads(export.render(export.export_installation(self.conn)))
        said = {row["request_id"]: row["by_person"] for row in payload["planning"]["requests"]}
        self.assertEqual(
            {
                by_agent["request_id"]: False,
                by_person["request_id"]: True,
                waiting["request_id"]: None,
            },
            said,
        )


class OlderAttachedStoreTests(unittest.TestCase):
    def test_a_store_with_no_call_rows_still_lists_its_questions(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            path = str(Path(directory) / "older.sqlite3")
            schema9.build(path)
            raw = sqlite3.connect(path)
            schema9.populate(raw)
            raw.execute(
                "UPDATE work_item_requests SET status='answered',answers_json='{}',"
                "resolved_at='2026-10-31T00:00:00.000000Z'"
            )
            raw.commit()
            raw.close()
            conn = scopes.open_readonly({"name": "older", "path": path})
            try:
                [read] = requests.list_requests(conn)
            finally:
                conn.close()
        self.assertEqual(("answered", False), (read["status"], read["by_person"]))


class AnsweredAfterTests(QuestionCase):
    START = "2000-01-01T00:00:00Z"

    def three_answers(self) -> list[dict]:
        return [self.answer(self.ask(prompt=f"Asked {n}"), {"path": "keep"}) for n in range(3)]

    def same_time(self, first: dict, second: dict) -> None:
        self.conn.execute(
            "UPDATE work_item_requests SET resolved_at=? WHERE request_id=?",
            (first["resolved_at"], second["request_id"]),
        )
        self.conn.commit()

    def page(self, **filters: object) -> dict:
        return self.tool("list_work_item_requests", space="QST", **filters)

    def by_last_answered_at(self, limit: int) -> list[str]:
        """What a reader that keeps the last `answered_at` it read receives, in order."""

        seen: list[str] = []
        after = self.START
        for _ in range(10):
            page = self.page(answered_after=after, limit=limit)
            seen += [row["id"] for row in page["requests"]]
            if not page["requests"]:
                return seen
            after = page["requests"][-1]["answered_at"]
        raise AssertionError("the reader never finished")

    def by_next_offset(self, limit: int) -> list[str]:
        seen: list[str] = []
        offset: int | None = 0
        for _ in range(10):
            page = self.page(answered_after=self.START, limit=limit, offset=offset)
            seen += [row["id"] for row in page["requests"]]
            offset = page["next_offset"]
            if offset is None:
                return seen
        raise AssertionError("the reader never finished")

    def test_the_oldest_answer_comes_first_and_the_page_says_more_follow(self) -> None:
        first, second, third = self.three_answers()
        page = self.page(answered_after=self.START, limit=1)
        self.assertEqual([first["request_id"]], [row["id"] for row in page["requests"]])
        self.assertEqual((True, 1), (page["truncated"], page["next_offset"]))
        page = self.page(answered_after=self.START, limit=3)
        self.assertEqual(
            [first["request_id"], second["request_id"], third["request_id"]],
            [row["id"] for row in page["requests"]],
        )
        self.assertEqual((False, None), (page["truncated"], page["next_offset"]))

    def test_a_reader_taking_one_at_a_time_loses_nothing_either_way(self) -> None:
        expected = [row["request_id"] for row in self.three_answers()]
        self.assertEqual(expected, self.by_last_answered_at(1))
        self.assertEqual(expected, self.by_next_offset(1))

    def test_two_answers_of_one_time_stay_on_one_page(self) -> None:
        first, second, third = self.three_answers()
        self.same_time(first, second)
        tied = sorted([first["request_id"], second["request_id"]])
        page = self.page(answered_after=self.START, limit=1)
        # The second key is the request id, and the page runs past its limit by the tie.
        self.assertEqual(tied, [row["id"] for row in page["requests"]])
        self.assertEqual((True, 2), (page["truncated"], page["next_offset"]))
        expected = [*tied, third["request_id"]]
        self.assertEqual(expected, self.by_last_answered_at(1))
        self.assertEqual(expected, self.by_next_offset(1))

    def test_a_tie_at_the_end_of_everything_ends_the_reading(self) -> None:
        _first, second, third = self.three_answers()
        self.same_time(second, third)
        page = self.page(answered_after=second["resolved_at"], limit=1)
        self.assertEqual(([], False), (page["requests"], page["truncated"]))

    def test_only_answers_count_as_answered_after(self) -> None:
        answered = self.answer(self.ask(), {"path": "keep"})
        declined = self.ask(prompt="Declined later")
        self.tool(
            "decline_work_item_request",
            id=declined["request_id"],
            expected_revision=0,
            author="the-owner",
        )
        withdrawn = self.ask(prompt="Withdrawn later")
        self.tool("expire_work_item_request", id=withdrawn["request_id"], expected_revision=0)
        self.ask(prompt="Still waiting")
        self.assertEqual(
            [answered["request_id"]],
            [row["id"] for row in self.page(answered_after=self.START)["requests"]],
        )

    def test_the_plain_list_pages_the_same_way_newest_first(self) -> None:
        first, second = self.ask(prompt="First"), self.ask(prompt="Second")
        page = self.page(limit=1)
        self.assertEqual((True, 1), (page["truncated"], page["next_offset"]))
        rest = self.page(limit=1, offset=1)
        self.assertEqual((False, None), (rest["truncated"], rest["next_offset"]))
        self.assertEqual(
            [second["request_id"], first["request_id"]],
            [page["requests"][0]["id"], rest["requests"][0]["id"]],
        )

    def test_a_bad_offset_is_refused(self) -> None:
        with self.assertRaises(model.PlanningError):
            self.page(offset=-1)

    def test_paging_counts_what_the_status_filter_kept(self) -> None:
        waiting = self.ask(prompt="Waiting")
        self.answer(self.ask(prompt="Answered"), {"path": "keep"})
        also = self.ask(prompt="Also waiting")
        page = self.page(status="pending", limit=1)
        self.assertEqual((True, 1), (page["truncated"], page["next_offset"]))
        rest = self.page(status="pending", limit=1, offset=page["next_offset"])
        self.assertEqual(
            {waiting["request_id"], also["request_id"]},
            {page["requests"][0]["id"], rest["requests"][0]["id"]},
        )
        self.assertFalse(rest["truncated"])


class CompactBoundTests(QuestionCase):
    def compact(self, request: dict) -> dict:
        [found] = [
            row
            for row in self.tool("list_work_item_requests", id=self.reference)["requests"]
            if row["id"] == request["request_id"]
        ]
        return found

    def test_a_long_note_and_text_are_cut_and_the_whole_stays_a_read_away(self) -> None:
        request = self.ask([TEXT])
        self.answer(request, {"why": "w" * 8000}, note="n" * 8000)
        compact = self.compact(request)
        self.assertEqual("n" * 500 + "…", compact["note"])
        self.assertEqual("w" * 500 + "…", compact["answer"][0]["value"])
        self.assertIs(True, compact["clipped"])
        whole = self.tool("get_work_item_request", id=request["request_id"])
        self.assertEqual(("n" * 8000, {"why": "w" * 8000}), (whole["note"], whole["answers"]))
        [full] = self.tool("list_work_item_requests", id=self.reference, full=True)["requests"]
        self.assertEqual(("n" * 8000, {"why": "w" * 8000}), (full["note"], full["answers"]))
        self.assertNotIn("clipped", full)

    def test_exactly_500_characters_are_not_cut(self) -> None:
        request = self.ask([TEXT])
        self.answer(request, {"why": "w" * 500}, note="n" * 500)
        compact = self.compact(request)
        self.assertEqual(("n" * 500, "w" * 500), (compact["note"], compact["answer"][0]["value"]))
        self.assertNotIn("clipped", compact)

    def test_only_the_note_being_long_is_enough_to_say_so(self) -> None:
        request = self.ask([BOOLEAN])
        self.answer(request, {"sure": True}, note="n" * 501)
        self.assertIs(True, self.compact(request)["clipped"])

    def test_the_largest_question_stays_under_2000_with_its_first_fields(self) -> None:
        fields = [
            {"id": f"f{n:02}", "label": "L", "type": "text", "required": False, "options": []}
            for n in range(12)
        ]
        request = self.ask(fields, prompt="p" * 8000)
        self.answer(request, {f"f{n:02}": "w" * 8000 for n in range(12)}, note="n" * 8000)
        compact = self.compact(request)
        self.assertLessEqual(size(compact), 2000)
        self.assertIs(True, compact["clipped"])
        rows = [row["field"] for row in compact["answer"]]
        self.assertEqual([f"f{n:02}" for n in range(len(rows))], rows)
        self.assertGreater(len(rows), 0)
        self.assertLess(len(rows), 12)

    def test_many_long_labels_are_cut_too(self) -> None:
        options = [{"id": f"o{n:02}", "label": "l" * 200} for n in range(20)]
        request = self.ask([{**MULTI, "options": options}])
        self.answer(request, {"areas": [f"o{n:02}" for n in range(20)]})
        compact = self.compact(request)
        self.assertLessEqual(size(compact), 2000)
        self.assertIs(True, compact["clipped"])
        self.assertLessEqual(len(compact["answer"][0]["label"]), 501)

    def test_text_that_grows_in_json_still_fits(self) -> None:
        for letter in ('"', "\x01"):
            with self.subTest(letter=repr(letter)):
                request = self.ask([TEXT], prompt=letter * 8000)
                self.answer(request, {"why": letter * 8000}, note=letter * 8000)
                found = self.compact(request)
                self.assertLessEqual(size(found), 2000)
                self.assertIs(True, found["clipped"])

    def test_get_work_item_stays_cheap_at_its_most(self) -> None:
        fields = [
            {"id": f"f{n:02}", "label": "L", "type": "text", "required": False, "options": []}
            for n in range(12)
        ]
        for _ in range(5):
            request = self.ask(fields, prompt="p" * 8000)
            self.answer(request, {f"f{n:02}": "w" * 8000 for n in range(12)}, note="n" * 8000)
        questions = self.tool("get_work_item", id=self.reference)["questions"]
        self.assertEqual(5, len(questions["items"]))
        self.assertLessEqual(size(questions), 5 * 2000 + 100)

    def test_an_ordinary_question_says_nothing_about_clipping(self) -> None:
        request = self.ask([CHOICE])
        self.answer(request, {"path": "keep"}, note="Fine")
        self.assertNotIn("clipped", self.compact(request))


if __name__ == "__main__":
    unittest.main()
