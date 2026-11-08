"""A summary's friction: what hindered the work itself, kept apart from what the work did.

The expectations are the connection contract's: `friction` is taken wherever `done`,
`next` and `why` are — `set_work_item_summary`, `report_work_item`, the `summary`
group of `apply_work_item_changes` and the HTTP report — as text of at most 4000
characters, stored with the report and returned by every read of the item. A
summary without it is what it always was. An agent writes through `mcp_surface`, a
person through the HTTP boundary as the browser binds it.
"""

from __future__ import annotations

import unittest

from server.planning import api, calls, model, tools
from tests.test_planning_comment_lists import Harness

FRICTION = "MAIN-1 needed two claims.\nThe gate read a stale bundle."
SUMMARY = {"done": "Shipped the parser", "next": "Nothing", "friction": FRICTION}


class SummaryFrictionTests(Harness):
    def read(self) -> dict:
        return self.agent("get_work_item", id=self.ref, full=True)

    def http_read(self) -> dict:
        answer = api.handle_get(self.conn, "/api/planning/work-item", {"id": [self.ref]})
        assert answer is not None
        return answer[1]["work_item"]

    def test_set_work_item_summary_keeps_friction_and_every_read_returns_it(self) -> None:
        self.agent("set_work_item_summary", id=self.ref, summary=SUMMARY)
        read = self.read()
        self.assertEqual(SUMMARY, read["summary"])
        self.assertEqual(SUMMARY, read["comments"][-1]["report"])
        self.assertEqual(SUMMARY, self.http_read()["summary"])

    def test_report_work_item_and_the_http_report_keep_friction(self) -> None:
        self.agent("report_work_item", id=self.ref, report=SUMMARY)
        self.assertEqual(SUMMARY, self.read()["comments"][-1]["report"])
        revision = self.read()["revision"]
        written = self.person(
            "/api/planning/work-item/report",
            id=self.ref,
            report={**SUMMARY, "friction": "none"},
            make_current=True,
            expected_revision=revision,
        )
        self.assertEqual({**SUMMARY, "friction": "none"}, written["summary"])

    def test_the_summary_group_of_a_batch_keeps_friction(self) -> None:
        self.agent("apply_work_item_changes", id=self.ref, summary=SUMMARY)
        self.assertEqual(SUMMARY, self.read()["summary"])

    def test_a_summary_without_friction_says_nothing_of_it(self) -> None:
        plain = {"done": "Shipped", "next": "Nothing"}
        for given in (plain, {**plain, "friction": ""}, {**plain, "friction": "  \n"}):
            with self.subTest(given=given):
                self.agent("set_work_item_summary", id=self.ref, summary=given)
                self.assertEqual(plain, self.read()["summary"])

    def test_friction_is_text_of_at_most_4000_characters(self) -> None:
        kept = {**SUMMARY, "friction": "f" * 4000}
        self.agent("set_work_item_summary", id=self.ref, summary=kept)
        self.assertEqual(kept, self.read()["summary"])
        before = self.counts()
        for friction, message in (
            ("f" * 4001, "work_item.summary.friction must be at most 4000 characters"),
            (["none"], "work_item.summary.friction must be a string"),
            (False, "work_item.summary.friction must be a string"),
        ):
            with self.subTest(friction=friction):
                error = self.refused(
                    "set_work_item_summary", id=self.ref, summary={**SUMMARY, "friction": friction}
                )
                self.assertEqual(("invalid_request", message), (error["code"], error["message"]))
                self.assertEqual(before, self.counts())
        with calls.bind(calls.browser(), "/api/planning/work-item/report"):
            with self.assertRaisesRegex(model.PlanningError, "unknown field"):
                api.handle_post(
                    self.conn,
                    "/api/planning/work-item/report",
                    {"id": self.ref, "report": {**SUMMARY, "frictions": "x"}},
                )

    def test_the_tool_schemas_name_friction_beside_why(self) -> None:
        schemas = {tool["name"]: tool["inputSchema"]["properties"] for tool in tools.TOOLS}
        for name, shape in (
            ("set_work_item_summary", schemas["set_work_item_summary"]["summary"]),
            ("report_work_item", schemas["report_work_item"]["report"]),
            ("apply_work_item_changes", schemas["apply_work_item_changes"]["summary"]),
        ):
            with self.subTest(name):
                friction = shape["properties"]["friction"]
                self.assertEqual("string", friction["type"])
                self.assertIn("none", friction["description"])
                self.assertEqual(["done", "next"], shape["required"])
        self.assertIn("friction", dict(api.APPLY_GROUPS)["summary"])


if __name__ == "__main__":
    unittest.main()
