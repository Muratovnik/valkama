"""Why the asker recommends what it does: `why` beside `recommended`, on an option or a verdict.

The expectations are the connection contract's, "Questions and decisions": `why` is
markdown of 1 to 8000 characters, held to a description's rules; an option takes it
only while its `recommended` is true and a field only beside its `recommended`; each
refusal names the option or the field and the way out, and writes nothing; every
full read of a question returns it as written. An agent's calls go through
`mcp_surface`, a person's reads through the HTTP handlers.
"""

from __future__ import annotations

import unittest

from server.planning import api, model, requests, service, tools
from tests.test_planning_questions import QuestionCase

WHY = "**Cheapest** now.\n\nThe second way needs a migration."
CHOICE = {
    "id": "path",
    "label": "Which path",
    "type": "choice",
    "required": True,
    "options": [
        {"id": "keep", "label": "Keep it", "recommended": True, "why": WHY},
        {"id": "drop", "label": "Drop it"},
    ],
}
VERDICT = {
    "id": "p1",
    "label": "P1 Narrow the rule",
    "type": "verdict",
    "required": False,
    "options": [],
    "recommended": "accept",
    "why": "Fourteen false alarms came from it.",
}


class RecommendationWhyTests(QuestionCase):
    def count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0])

    def refusal(self, fields: list[dict]) -> str:
        with self.assertRaises(model.PlanningError) as caught:
            self.ask(fields)
        return str(caught.exception)

    def test_every_full_read_returns_the_why_of_an_option_and_a_verdict(self) -> None:
        created = self.ask([CHOICE, VERDICT])
        expected = [CHOICE, VERDICT]
        self.assertEqual(expected, created["fields"])
        self.assertEqual(
            expected, self.tool("get_work_item_request", id=created["request_id"])["fields"]
        )
        listed = self.tool("list_work_item_requests", id=self.reference, full=True)
        self.assertEqual(expected, listed["requests"][0]["fields"])
        http_list = api.handle_get(self.conn, "/api/planning/requests", {"space": ["QST"]})
        http_one = api.handle_get(
            self.conn, "/api/planning/request", {"id": [created["request_id"]]}
        )
        assert http_list is not None and http_one is not None
        self.assertEqual(expected, http_list[1]["requests"][0]["fields"])
        self.assertEqual(expected, http_one[1]["request"]["fields"])

    def test_why_on_an_option_runs_from_1_to_8000_characters_as_a_description_does(self) -> None:
        def with_why(text: object) -> list[dict]:
            option = {"id": "keep", "label": "Keep it", "recommended": True, "why": text}
            return [{**CHOICE, "options": [option]}]

        self.assertEqual(
            "w" * 8000, self.ask(with_why("w" * 8000))["fields"][0]["options"][0]["why"]
        )
        # Surrounding blanks go, as they go from a description.
        self.assertEqual("Cheap", self.ask(with_why("  Cheap\n"))["fields"][0]["options"][0]["why"])
        before = self.count()
        for text, refusal in (
            ("w" * 8001, "option.why must be at most 8000 characters"),
            ("", "option.why is required when it is given"),
            ("   ", "option.why is required when it is given"),
            (5, "option.why must be a string"),
            ("a\x00b", "option.why must not contain a NUL byte"),
        ):
            with self.subTest(text=text):
                self.assertEqual(refusal, self.refusal(with_why(text)))
        self.assertEqual(before, self.count())

    def test_an_option_takes_why_only_while_it_is_recommended(self) -> None:
        before = self.count()
        refusal = (
            "option drop: why says why it is recommended; give recommended: true or leave why out"
        )
        for option in (
            {"id": "drop", "label": "Drop it", "why": WHY},
            {"id": "drop", "label": "Drop it", "recommended": False, "why": WHY},
        ):
            with self.subTest(option=option):
                fields = [{**CHOICE, "options": [CHOICE["options"][0], option]}]
                self.assertEqual(refusal, self.refusal(fields))
        self.assertEqual(before, self.count())
        # Without why a recommendation is what it always was, and says nothing of why.
        bare = {"id": "keep", "label": "Keep it", "recommended": True}
        self.assertEqual(bare, self.ask([{**CHOICE, "options": [bare]}])["fields"][0]["options"][0])

    def test_a_multi_choice_gives_each_recommended_option_its_own_why(self) -> None:
        options = [
            {"id": "api", "label": "The API", "recommended": True, "why": "It breaks first."},
            {"id": "web", "label": "The web", "recommended": True, "why": "It reads the API."},
            {"id": "docs", "label": "The docs"},
        ]
        field = {**CHOICE, "id": "areas", "type": "multi_choice", "options": options}
        self.assertEqual(options, self.ask([field])["fields"][0]["options"])

    def test_a_field_takes_why_only_beside_its_recommended(self) -> None:
        self.assertEqual(VERDICT, self.ask([VERDICT])["fields"][0])
        before = self.count()
        bare = {name: value for name, value in VERDICT.items() if name != "recommended"}
        self.assertEqual(
            "field p1: why says why recommended; give recommended or leave why out",
            self.refusal([bare]),
        )
        # A choice recommends on its options, so its own why is refused for the same reason.
        self.assertEqual(
            "field path: why says why recommended; give recommended or leave why out",
            self.refusal([{**CHOICE, "why": WHY}]),
        )
        for text, refusal in (
            ("", "field.why is required when it is given"),
            ("w" * 8001, "field.why must be at most 8000 characters"),
        ):
            with self.subTest(text=text):
                self.assertEqual(refusal, self.refusal([{**VERDICT, "why": text}]))
        self.assertEqual(before, self.count())

    def test_a_list_under_a_comment_keeps_the_why_of_its_options(self) -> None:
        options = [
            {"id": "a", "label": "Widen the check", "recommended": True, "why": "Two misses."},
            {"id": "b", "label": "Fix the docs"},
        ]
        written = self.tool(
            "comment_work_item",
            id=self.reference,
            body="Findings",
            list={"label": "What to take on", "options": options},
        )
        self.assertEqual(
            options, requests.get(self.conn, written["list_request_id"])["fields"][0]["options"]
        )
        with self.assertRaisesRegex(model.PlanningError, "option b: why says why"):
            self.tool(
                "comment_work_item",
                id=self.reference,
                body="More",
                list={"label": "Again", "options": [{"id": "b", "label": "B", "why": "No."}]},
            )

    def test_a_search_finds_a_question_by_its_why(self) -> None:
        self.ask([CHOICE, VERDICT])
        found = service.search_work_items(self.conn, "Fourteen false alarms")
        self.assertEqual([self.reference], [item["reference"] for item in found])
        self.assertEqual([], service.search_work_items(self.conn, "why"))

    def test_the_tool_schemas_tell_an_agent_to_give_why_whenever_it_recommends(self) -> None:
        schemas = {tool["name"]: tool["inputSchema"] for tool in tools.TOOLS}
        field = schemas["create_work_item_request"]["properties"]["fields"]["items"]
        option = field["properties"]["options"]["items"]
        listed = schemas["comment_work_item"]["properties"]["list"]["properties"]["options"]
        for name, why in (
            ("field", field["properties"]["why"]),
            ("option", option["properties"]["why"]),
            ("list option", listed["items"]["properties"]["why"]),
        ):
            with self.subTest(name):
                self.assertEqual("string", why["type"])
                self.assertEqual(8000, why["maxLength"])
                self.assertIn("whenever you recommend", why["description"])
        self.assertNotIn("why", option["required"])


if __name__ == "__main__":
    unittest.main()
