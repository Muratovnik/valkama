from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import api as planning_api
from server.planning import migration, model
from server.planning import tools as planning_tools
from tests import board_era


class PlanningCatalogueTests(unittest.TestCase):
    """One vocabulary, and every published tool has a handler behind it."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def names(self) -> set[str]:
        return {tool["name"] for tool in mcp_surface.catalogue()}

    def test_the_work_item_vocabulary_is_the_published_one(self) -> None:
        published = self.names()
        self.assertTrue(published >= planning_tools.TOOL_NAMES)
        # The Board names are gone from the process, not merely unpublished.
        for retired in ("list_cards", "create_card", "move_card", "create_board"):
            self.assertNotIn(retired, published)

    def test_the_tools_planning_does_not_own_are_published_too(self) -> None:
        published = self.names()
        self.assertIn("list_platform_modules", published)
        self.assertNotIn("run_improvement_eval", published)

    def test_every_published_tool_has_a_handler(self) -> None:
        for tool in mcp_surface.catalogue():
            self.assertIn(tool["name"], mcp_surface._OPS, tool["name"])

    def test_the_vocabulary_belongs_to_the_planning_module(self) -> None:
        self.assertTrue(planning_tools.TOOL_NAMES <= mcp_surface._PLANNING_TOOLS)

    def test_update_work_item_schema_accepts_source(self) -> None:
        schema = next(tool for tool in planning_tools.TOOLS if tool["name"] == "update_work_item")[
            "inputSchema"
        ]
        self.assertIn("source", schema["properties"])
        self.assertEqual("string", schema["properties"]["source"]["type"])


class PlanningToolCallTests(unittest.TestCase):
    """The neutral tools must reach the same boundary the HTTP surface uses."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        board_id = board_era.seed(self.conn, "Quality Assurance")
        board_era.add_card(self.conn, board_id, "Carried over")
        migration.migrate_board_domain(self.conn, project_for_space={"QA": "example-workspace"})
        # The real cutover drops these; without that a second connection would
        # find a Board domain and refuse to open the store.
        store.drop_board_domain(self.conn)
        self.conn.commit()

    def call(self, name: str, **arguments: object) -> object:
        return mcp_surface.call_tool(self.conn, name, arguments)

    def test_a_tool_write_is_committed_and_not_only_in_this_transaction(self) -> None:
        """What the MCP loop owes a write it just made.

        Board operations committed inside themselves; the Planning service
        leaves the transaction to its caller. Without the loop's own commit
        every tool write an agent made was rolled back when the process ended,
        and only a second connection can tell the difference.
        """

        created = self.call("create_work_item", space="QA", title="Committed")
        self.conn.commit()
        fresh = store.connect()
        try:
            self.assertEqual(
                "Committed",
                fresh.execute("SELECT title FROM work_items WHERE title = 'Committed'").fetchone()[
                    0
                ],
            )
        finally:
            fresh.close()
        self.assertTrue(str(created["reference"]).startswith("QA-"))

    def test_the_whole_path_of_one_item_goes_through_the_tools(self) -> None:
        spaces = self.call("list_planning_spaces")
        self.assertEqual(1, len(spaces["planning_spaces"]))
        space = self.call("get_planning_space", space="QA")
        self.assertEqual(6, len(space["workflow"]["states"]))

        created = self.call("create_work_item", space="QA", title="Through the tools", author="one")
        self.assertEqual("QA-2", created["reference"])
        self.assertEqual(
            created["work_item_id"], self.call("get_work_item", id="QA-2")["work_item_id"]
        )
        self.assertEqual(2, len(self.call("list_work_items", space="QA")["work_items"]))
        self.assertEqual(
            ["QA-2"],
            [
                item["reference"]
                for item in self.call("search_work_items", query="Through the tools")["work_items"]
            ],
        )
        self.call("claim_work_item", id="QA-2", author="one")
        steps = self.call("set_work_item_checklist", id="QA-2", items=["write it"])
        step = steps["checklist"][0]["item_id"]
        self.call("claim_work_item_checklist_item", id="QA-2", item_id=step, author="one")
        self.call("tick_work_item_checklist_item", id="QA-2", item_id=step, author="one")
        self.call("link_work_items", id="QA-2", other="QA-1", kind="relates-to")
        self.call("attach_work_item_ref", id="QA-2", kind="commit", value="abc1234")
        self.call("comment_work_item", id="QA-2", body="a note", author="one")
        self.call(
            "set_work_item_summary", id="QA-2", summary={"done": "through", "next": "the frontend"}
        )
        moved = self.call("transition_work_item", id="QA-2", state="done", author="one")
        self.assertTrue(moved["state"]["is_terminal"])
        self.assertEqual(
            {"done": "through", "next": "the frontend"},
            self.call("get_work_item", id="QA-2")["summary"],
        )

    def test_a_guard_refusal_reaches_the_caller(self) -> None:
        self.call("create_work_item", space="QA", title="Unclaimed")
        with self.assertRaisesRegex(Exception, r"\[executor\]"):
            self.call("transition_work_item", id="QA-2", state="dev")

    def test_claim_ready_answers_with_nothing_when_nothing_is_ready(self) -> None:
        self.call("claim_work_item", id="QA-1", author="one")
        self.assertIsNone(self.call("claim_ready_work_item", space="QA", author="two")["work_item"])

    def test_an_update_and_a_delete_go_through_the_same_boundary(self) -> None:
        created = self.call("create_work_item", space="QA", title="Temporary")
        renamed = self.call(
            "update_work_item",
            id=created["reference"],
            title="Renamed",
            expected_revision=created["revision"],
        )
        self.assertEqual(["title"], renamed["updated"])
        self.assertEqual("Renamed", self.call("get_work_item", id=created["reference"])["title"])
        self.assertTrue(self.call("delete_work_item", id=created["reference"])["deleted"])
        self.assertEqual(1, len(self.call("list_work_items", space="QA")["work_items"]))

    def test_a_disabled_planning_module_refuses_a_neutral_tool_too(self) -> None:
        self.conn.execute(
            "UPDATE platform_modules SET state = 'disabled' WHERE module_id = 'planning'"
        )
        with self.assertRaisesRegex(Exception, "disabled"):
            self.call("list_work_items", space="QA")

    def test_a_tool_nobody_declared_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown tool"):
            self.call("invent_work_item")


#: Everything a full record carries that an acknowledgement leaves to a read.
FULL_ONLY = (
    "description",
    "summary",
    "links",
    "refs",
    "comments",
    "events",
    "checklist",
    "labels",
    "source",
    "created_at",
    "updated_at",
)

ACKNOWLEDGED = (
    "create_work_item",
    "update_work_item",
    "transition_work_item",
    "claim_work_item",
    "set_work_item_checklist",
    "claim_work_item_checklist_item",
    "tick_work_item_checklist_item",
    "set_work_item_summary",
    "report_work_item",
    "select_work_item_summary",
)


class PlanningAcknowledgementTests(unittest.TestCase):
    """A write answers briefly by default and in full on request."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        board_id = board_era.seed(self.conn, "Quality Assurance")
        board_era.add_card(self.conn, board_id, "Carried over")
        migration.migrate_board_domain(self.conn, project_for_space={"QA": "example-workspace"})
        store.drop_board_domain(self.conn)
        self.conn.commit()
        # An item that carries every part of a full record, so that a field
        # missing from an acknowledgement is missing by design.
        item = self.call(
            "create_work_item",
            space="QA",
            title="Busy item",
            description="a long description",
            labels=["one"],
            source="docs/plan.md#kb:a7f3",
        )
        self.ref = item["reference"]
        self.call("set_work_item_checklist", id=self.ref, items=["first", "second"])
        self.call("comment_work_item", id=self.ref, body="a note", author="one")
        self.call("attach_work_item_ref", id=self.ref, kind="commit", value="abc1234")
        self.call("link_work_items", id=self.ref, other="QA-1", kind="relates-to")

    def call(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments)
        assert isinstance(answer, dict)
        return answer

    @property
    def step(self) -> str:
        """The first step as it stands now; a checklist replacement mints new ids."""

        return str(self.call("get_work_item", id=self.ref)["checklist"][0]["id"])

    def arguments_for(self, tool: str) -> dict:
        ref, step = self.ref, self.step
        if tool == "select_work_item_summary":
            full = self.call("get_work_item", id=ref)
            reports = [comment for comment in full["comments"] if comment["kind"] == "report"]
            if not reports:
                full = self.call(
                    "report_work_item", id=ref, report={"done": "d", "next": "n"}, verbose=True
                )
                reports = full["comments"]
            return {
                "id": ref,
                "comment_id": reports[-1]["id"],
                "expected_revision": full["revision"],
            }
        return {
            "create_work_item": {"space": "QA", "title": "Another", "author": "one"},
            "update_work_item": {"id": ref, "title": "Edited", "labels": ["two"]},
            "transition_work_item": {"id": ref, "state": "todo", "author": "one"},
            "claim_work_item": {"id": ref, "author": "one"},
            "set_work_item_checklist": {"id": ref, "items": ["x", "y"], "force": True},
            "claim_work_item_checklist_item": {"id": ref, "item_id": step, "author": "one"},
            "tick_work_item_checklist_item": {"id": ref, "item_id": step, "author": "one"},
            "set_work_item_summary": {"id": ref, "summary": {"done": "d", "next": "n"}},
            "report_work_item": {"id": ref, "report": {"done": "d", "next": "n"}},
        }[tool]

    def test_exactly_the_acknowledged_tools_publish_verbose_as_a_boolean(self) -> None:
        for tool in planning_tools.TOOLS:
            schema = tool["inputSchema"]
            if tool["name"] in ACKNOWLEDGED:
                self.assertEqual("boolean", schema["properties"]["verbose"]["type"], tool["name"])
                self.assertIn("full", schema["properties"]["verbose"]["description"])
                self.assertNotIn("verbose", schema.get("required", []), tool["name"])
            else:
                self.assertNotIn("verbose", schema["properties"], tool["name"])

    def test_the_default_answer_is_the_short_acknowledgement(self) -> None:
        for tool in ACKNOWLEDGED:
            with self.subTest(tool):
                answer = self.call(tool, **self.arguments_for(tool))
                stored = self.call("get_work_item", id=answer["reference"])
                for key in ("reference", "work_item_id", "revision", "state", "claim_ref"):
                    self.assertIn(key, answer)
                self.assertEqual(stored["revision"], answer["revision"])
                self.assertEqual(stored["work_item_id"], answer["work_item_id"])
                self.assertEqual(stored["claim_ref"], answer["claim_ref"])
                self.assertEqual(
                    {
                        "key": stored["state"]["key"],
                        "name": stored["state"]["name"],
                        "is_terminal": stored["state"]["is_terminal"],
                    },
                    answer["state"],
                )
                for key in FULL_ONLY:
                    if key == "checklist" and tool == "set_work_item_checklist":
                        continue
                    self.assertNotIn(key, answer)

    def test_a_verbose_answer_is_the_full_item(self) -> None:
        for tool in ACKNOWLEDGED:
            with self.subTest(tool):
                answer = self.call(tool, verbose=True, **self.arguments_for(tool))
                stored = self.call("get_work_item", id=answer["reference"])
                # A transition also reports what the guards said about it.
                self.assertEqual(stored, {k: v for k, v in answer.items() if k != "warnings"})

    def test_verbose_false_is_the_default_and_anything_else_is_refused(self) -> None:
        arguments = self.arguments_for("claim_work_item")
        explicit = self.call("claim_work_item", verbose=False, **arguments)
        self.assertNotIn("events", explicit)
        with self.assertRaisesRegex(planning_api.PlanningHttpError, "verbose must be a boolean"):
            self.call("claim_work_item", verbose="yes", **arguments)

    def test_what_each_write_reports_is_what_it_changed(self) -> None:
        created = self.call("create_work_item", **self.arguments_for("create_work_item"))
        self.assertEqual(
            {"title": "Another", "kind": "task", "priority": "medium"},
            {name: created[name] for name in ("title", "kind", "priority")},
        )

        edited = self.call("update_work_item", **self.arguments_for("update_work_item"))
        self.assertEqual(["title", "labels"], edited["updated"])
        untouched = self.call("update_work_item", id=self.ref)
        self.assertEqual([], untouched["updated"])
        self.assertEqual(edited["revision"], untouched["revision"])

        claimed = self.call("claim_work_item", **self.arguments_for("claim_work_item"))
        self.assertEqual("one", claimed["claim_ref"])

        arguments = self.arguments_for("set_work_item_checklist")
        replaced = self.call("set_work_item_checklist", **arguments)
        stored = self.call("get_work_item", id=self.ref)["checklist"]
        self.assertEqual(
            [{"item_id": step["id"], "text": step["text"]} for step in stored],
            replaced["checklist"],
        )
        self.assertEqual(["x", "y"], [step["text"] for step in replaced["checklist"]])

        step = replaced["checklist"][0]["item_id"]
        held = self.call("claim_work_item_checklist_item", id=self.ref, item_id=step, author="two")
        self.assertEqual(
            {"item_id": step, "done": False, "claimed_by": "two", "done_by": ""}, held["step"]
        )
        ticked = self.call("tick_work_item_checklist_item", id=self.ref, item_id=step, author="two")
        self.assertEqual(
            {"item_id": step, "done": True, "claimed_by": "", "done_by": "two"}, ticked["step"]
        )
        reopened = self.call(
            "tick_work_item_checklist_item", id=self.ref, item_id=step, done=False, author="two"
        )
        self.assertFalse(reopened["step"]["done"])

        summarized = self.call(
            "set_work_item_summary", **self.arguments_for("set_work_item_summary")
        )
        self.assertTrue(summarized["summary_recorded"])

    def test_a_forced_transition_still_reports_the_override(self) -> None:
        forced = self.call("transition_work_item", id=self.ref, state="dev", force=True)
        self.assertEqual("dev", forced["state"]["key"])
        self.assertIn("executor", forced["overridden"])
        # The busy item carries a commit ref; a bare one entering review does not.
        bare = self.call("create_work_item", space="QA", title="Bare")["reference"]
        warned = self.call("transition_work_item", id=bare, state="review", force=True)
        self.assertRegex(warned["warnings"][0], "no session or commit ref")
        clean = self.call("transition_work_item", id=self.ref, state="review")
        self.assertNotIn("overridden", clean)
        self.assertNotIn("warnings", clean)

    def test_a_revision_taken_from_an_acknowledgement_is_accepted_by_the_next_write(self) -> None:
        first = self.call("claim_work_item", id=self.ref, author="one")
        second = self.call(
            "tick_work_item_checklist_item",
            id=self.ref,
            item_id=self.step,
            author="one",
            expected_revision=first["revision"],
        )
        self.assertEqual(first["revision"] + 1, second["revision"])
        with self.assertRaises(model.RevisionConflictError):
            self.call(
                "update_work_item", id=self.ref, title="Late", expected_revision=first["revision"]
            )
        third = self.call(
            "update_work_item", id=self.ref, title="On time", expected_revision=second["revision"]
        )
        self.assertEqual(second["revision"] + 1, third["revision"])

    def test_the_tools_that_already_answer_briefly_are_unchanged(self) -> None:
        link = self.call("link_work_items", id=self.ref, other="QA-1", kind="relates-to")
        self.assertEqual({"from", "to", "kind", "removed"}, set(link))
        ref = self.call("attach_work_item_ref", id=self.ref, kind="commit", value="def5678")
        self.assertEqual({"work_item", "kind", "value"}, set(ref))
        comment = self.call("comment_work_item", id=self.ref, body="again")
        self.assertEqual({"work_item", "comment_count", "comment_id"}, set(comment))

    def test_the_reads_and_the_take_next_queue_still_answer_in_full(self) -> None:
        full = self.call("get_work_item", id=self.ref)
        for key in FULL_ONLY:
            self.assertIn(key, full)
        listed = self.call("list_work_items", space="QA")["work_items"]
        self.assertTrue(all("comment_count" in item and "events" not in item for item in listed))
        taken = self.call("claim_ready_work_item", space="QA", author="one")["work_item"]
        for key in ("events", "checklist", "description", "comments"):
            self.assertIn(key, taken)

    def test_the_http_boundary_still_answers_with_the_full_item(self) -> None:
        for path, payload in (
            (
                "/api/planning/work-item/checklist/tick",
                {"id": self.ref, "item_id": self.step, "author": "one"},
            ),
            ("/api/planning/work-item/claim", {"id": self.ref, "author": "one"}),
            ("/api/planning/work-item/transition", {"id": self.ref, "state": "todo"}),
        ):
            with self.subTest(path):
                handled = planning_api.handle_post(self.conn, path, payload)
                assert handled is not None
                status, body = handled
                self.assertEqual(200, status)
                stored = self.call("get_work_item", id=self.ref)
                self.assertEqual(stored, {k: v for k, v in body.items() if k != "warnings"})


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
