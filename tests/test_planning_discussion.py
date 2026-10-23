from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import store
from server.planning import api, model, read_model, service, tools


class PlanningDiscussionTests(unittest.TestCase):
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
        service.create_planning_space(self.conn, project_id="test", name="Discussion", key="DISC")
        self.item = service.create_work_item(self.conn, space="DISC", title="A shared outcome")
        self.conn.commit()

    def publish(self, **kwargs) -> dict:
        return service.report_work_item(
            self.conn,
            self.item["reference"],
            {"done": "Built the first version", "next": "Review it", "why": "Keep history"},
            author="writer",
            **kwargs,
        )

    def test_plain_comment_and_report_have_stable_distinct_shapes(self) -> None:
        note = service.comment_work_item(
            self.conn, self.item["reference"], "A question", author="reader"
        )
        reported = self.publish()
        plain, report = reported["comments"]
        self.assertEqual(note["comment_id"], plain["id"])
        self.assertEqual(
            ("comment", None, "A question"), (plain["kind"], plain["report"], plain["body"])
        )
        self.assertEqual("report", report["kind"])
        self.assertEqual("Built the first version", report["report"]["done"])
        self.assertEqual("writer", report["author"])
        self.assertRegex(report["at"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertIsNone(reported["summary"])
        self.assertIsNone(reported["summary_comment_id"])
        self.conn.commit()
        self.assertEqual(
            reported["comments"],
            service.get_work_item(self.conn, self.item["reference"])["comments"],
        )

    def test_existing_report_can_become_current_without_changing_history(self) -> None:
        first = self.publish()
        newer = service.set_summary(
            self.conn,
            self.item["reference"],
            {"done": "A later approach", "next": "Compare"},
            author="another",
        )
        self.assertEqual(2, len(newer["comments"]))
        self.assertEqual(newer["comments"][-1]["id"], newer["summary_comment_id"])
        selected = service.select_summary(
            self.conn,
            self.item["reference"],
            first["comments"][0]["id"],
            expected_revision=newer["revision"],
            author="owner",
        )
        self.assertEqual(newer["comments"], selected["comments"])
        self.assertEqual(first["comments"][0]["report"], selected["summary"])
        self.assertEqual(first["comments"][0]["id"], selected["summary_comment_id"])
        self.assertEqual(newer["revision"] + 1, selected["revision"])

    def test_current_publication_requires_revision_and_stale_write_leaves_no_report(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, "expected_revision is required"):
            self.publish(make_current=True)
        current = self.publish(make_current=True, expected_revision=self.item["revision"])
        self.conn.commit()
        before = service.get_work_item(self.conn, self.item["reference"])
        with self.assertRaises(model.RevisionConflictError):
            self.publish(make_current=True, expected_revision=self.item["revision"])
        self.conn.commit()
        self.assertEqual(before, service.get_work_item(self.conn, self.item["reference"]))
        self.assertEqual(current["comments"][0]["id"], current["summary_comment_id"])

    def test_cas_lost_after_read_rolls_back_insert_even_if_caller_commits(self) -> None:
        stale = read_model.item_row(self.conn, self.item["reference"])
        other = sqlite3.connect(store.db_path())
        self.addCleanup(other.close)
        other.execute(
            "UPDATE work_items SET revision=revision+1 WHERE work_item_id=?",
            (self.item["work_item_id"],),
        )
        other.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaises(model.RevisionConflictError):
                self.publish(make_current=True, expected_revision=self.item["revision"])
        self.conn.commit()
        after = service.get_work_item(self.conn, self.item["reference"])
        self.assertEqual([], after["comments"])
        self.assertIsNone(after["summary"])
        self.assertIsNone(after["summary_comment_id"])

    def test_event_failure_rolls_back_report_without_losing_outer_work(self) -> None:
        service.comment_work_item(self.conn, self.item["reference"], "Keep this outer write")
        with mock.patch.object(service, "_log", side_effect=RuntimeError("injected event failure")):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                self.publish(make_current=True, expected_revision=self.item["revision"])
        self.conn.commit()
        after = service.get_work_item(self.conn, self.item["reference"])
        self.assertEqual(["Keep this outer write"], [note["body"] for note in after["comments"]])
        self.assertIsNone(after["summary"])
        self.assertEqual(self.item["revision"], after["revision"])

    def test_report_write_does_not_commit_callers_transaction(self) -> None:
        self.publish(make_current=True, expected_revision=self.item["revision"])
        self.conn.rollback()
        self.assertEqual([], service.get_work_item(self.conn, self.item["reference"])["comments"])

    def test_deleting_item_cascades_its_selected_report(self) -> None:
        published = self.publish(make_current=True, expected_revision=self.item["revision"])
        service.delete_work_item(self.conn, self.item["reference"])
        self.assertIsNone(
            self.conn.execute(
                "SELECT 1 FROM work_item_comments WHERE id=?", (published["summary_comment_id"],)
            ).fetchone()
        )

    def test_selection_refuses_plain_other_item_missing_and_stale_reports(self) -> None:
        note = service.comment_work_item(self.conn, self.item["reference"], "Plain note")
        other = service.create_work_item(self.conn, space="DISC", title="Another")
        foreign = service.report_work_item(
            self.conn, other["reference"], {"done": "Elsewhere", "next": "Stay there"}
        )
        report = self.publish()
        for comment_id in (note["comment_id"], foreign["comments"][0]["id"], 99999, True):
            with self.subTest(comment_id=comment_id), self.assertRaises(model.PlanningError):
                service.select_summary(
                    self.conn,
                    self.item["reference"],
                    comment_id,
                    expected_revision=report["revision"],
                )
        with self.assertRaisesRegex(model.PlanningError, "expected_revision is required"):
            service.select_summary(self.conn, self.item["reference"], report["comments"][-1]["id"])
        with self.assertRaises(model.RevisionConflictError):
            service.select_summary(
                self.conn, self.item["reference"], report["comments"][-1]["id"], expected_revision=0
            )
        self.assertIsNone(service.get_work_item(self.conn, self.item["reference"])["summary"])

    def test_legacy_summary_and_new_http_mcp_paths_share_history(self) -> None:
        status, reported = api.handle_post(
            self.conn,
            "/api/planning/work-item/report",
            {
                "id": self.item["reference"],
                "report": {"done": "Via HTTP", "next": "Via MCP"},
            },
        )
        self.assertEqual(200, status)
        selected = tools.OPS["select_work_item_summary"](
            self.conn,
            {
                "id": self.item["reference"],
                "comment_id": reported["comments"][0]["id"],
                "expected_revision": reported["revision"],
            },
        )
        self.assertTrue(selected["summary_recorded"])
        old = tools.OPS["set_work_item_summary"](
            self.conn,
            {
                "id": self.item["reference"],
                "summary": {"done": "Legacy input", "next": "Preserved"},
            },
        )
        full = service.get_work_item(self.conn, self.item["reference"])
        self.assertEqual(old["summary_comment_id"], full["comments"][-1]["id"])
        self.assertEqual(2, len(full["comments"]))
        short = tools.OPS["report_work_item"](
            self.conn,
            {
                "id": self.item["reference"],
                "report": {"done": "New MCP", "next": "Kept in history"},
            },
        )
        self.assertIn("comment_id", short)
        self.assertNotIn("comments", short)

    def test_search_finds_report_history_and_real_references_with_space_scope(self) -> None:
        self.publish()
        other_space = service.create_planning_space(
            self.conn, project_id="other", name="Other", key="OTHER"
        )
        service.create_work_item(self.conn, space=other_space["key"], title="Another item")
        self.assertEqual(
            [self.item["reference"]],
            [item["reference"] for item in service.search_work_items(self.conn, "DISC-1")],
        )
        self.assertEqual([], service.search_work_items(self.conn, "DISC-1", space="OTHER"))
        self.assertEqual(
            [self.item["reference"]],
            [item["reference"] for item in service.search_work_items(self.conn, "Built the first")],
        )
        self.assertEqual(1, len(service.search_work_items(self.conn, "-1", limit=1)))
