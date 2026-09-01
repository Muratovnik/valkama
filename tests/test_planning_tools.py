from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import migration
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
        self.assertIn("run_improvement_eval", published)

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
        board_id = board_era.seed(self.conn, "Alpha Workspace")
        board_era.add_card(self.conn, board_id, "Carried over")
        migration.migrate_board_domain(self.conn, project_for_space={"AW": "example-workspace"})
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

        created = self.call("create_work_item", space="AW", title="Committed")
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
        self.assertTrue(str(created["reference"]).startswith("AW-"))

    def test_the_whole_path_of_one_item_goes_through_the_tools(self) -> None:
        spaces = self.call("list_planning_spaces")
        self.assertEqual(1, len(spaces["planning_spaces"]))
        space = self.call("get_planning_space", space="AW")
        self.assertEqual(6, len(space["workflow"]["states"]))

        created = self.call("create_work_item", space="AW", title="Through the tools", author="one")
        self.assertEqual("EX-2", created["reference"])
        self.assertEqual(
            created["work_item_id"], self.call("get_work_item", id="EX-2")["work_item_id"]
        )
        self.assertEqual(2, len(self.call("list_work_items", space="AW")["work_items"]))
        self.assertEqual(
            ["EX-2"],
            [
                item["reference"]
                for item in self.call("search_work_items", query="Through the tools")["work_items"]
            ],
        )
        self.call("claim_work_item", id="EX-2", author="one")
        steps = self.call("set_work_item_checklist", id="EX-2", items=["write it"])
        step = steps["checklist"][0]["id"]
        self.call("claim_work_item_checklist_item", id="EX-2", item_id=step, author="one")
        self.call("tick_work_item_checklist_item", id="EX-2", item_id=step, author="one")
        self.call("link_work_items", id="EX-2", other="EX-1", kind="relates-to")
        self.call("attach_work_item_ref", id="EX-2", kind="commit", value="abc1234")
        self.call("comment_work_item", id="EX-2", body="a note", author="one")
        self.call(
            "set_work_item_summary", id="EX-2", summary={"done": "through", "next": "the frontend"}
        )
        moved = self.call("transition_work_item", id="EX-2", state="done", author="one")
        self.assertTrue(moved["state"]["is_terminal"])
        self.assertEqual({"done": "through", "next": "the frontend"}, moved["summary"])

    def test_a_guard_refusal_reaches_the_caller(self) -> None:
        self.call("create_work_item", space="AW", title="Unclaimed")
        with self.assertRaisesRegex(Exception, r"\[executor\]"):
            self.call("transition_work_item", id="EX-2", state="dev")

    def test_claim_ready_answers_with_nothing_when_nothing_is_ready(self) -> None:
        self.call("claim_work_item", id="EX-1", author="one")
        self.assertIsNone(self.call("claim_ready_work_item", space="AW", author="two")["work_item"])

    def test_an_update_and_a_delete_go_through_the_same_boundary(self) -> None:
        created = self.call("create_work_item", space="AW", title="Temporary")
        renamed = self.call(
            "update_work_item",
            id=created["reference"],
            title="Renamed",
            expected_revision=created["revision"],
        )
        self.assertEqual("Renamed", renamed["title"])
        self.assertTrue(self.call("delete_work_item", id=created["reference"])["deleted"])
        self.assertEqual(1, len(self.call("list_work_items", space="AW")["work_items"]))

    def test_a_disabled_planning_module_refuses_a_neutral_tool_too(self) -> None:
        self.conn.execute(
            "UPDATE platform_modules SET state = 'disabled' WHERE module_id = 'planning'"
        )
        with self.assertRaisesRegex(Exception, "disabled"):
            self.call("list_work_items", space="AW")

    def test_a_tool_nobody_declared_is_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown tool"):
            self.call("invent_work_item")


if __name__ == "__main__":  # pragma: no cover - unittest discovery owns this
    unittest.main()
