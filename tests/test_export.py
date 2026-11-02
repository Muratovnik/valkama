"""What an installation export carries, and what it leaves to the build."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import time
import unittest
from typing import Any
from unittest import mock

from server import store, transcripts
from server.hooks import ingest, normalize
from server.ops import doctor, export
from server.planning import model as planning_model
from server.planning import service as planning_service
from tests.planning_fixtures import bulk_items, item_ids


class ExportSectionTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.directory = directory.name
        self.store_path = os.path.join(directory.name, "valkama.sqlite3")
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def test_the_planning_trail_is_the_whole_export(self) -> None:
        planning_service.create_planning_space(
            self.conn, project_id="export", name="Export", key="EXP"
        )
        planning_service.create_work_item(self.conn, space="EXP", title="Kept in the export")
        self.conn.commit()
        payload = json.loads(export.render(export.export_installation(self.conn)))
        self.assertEqual(["planning"], payload["sections"])
        self.assertEqual(
            ["Kept in the export"],
            [item["title"] for item in payload["planning"]["work_items"]],
        )
        # The registry's links and the integration switches left with their
        # tables at schema 9; the export does not answer for them at all.
        self.assertNotIn("relations", payload)
        self.assertNotIn("settings", payload)
        self.assertFalse(payload["restorable"])

    def test_an_archived_transcript_never_reaches_the_export(self) -> None:
        """A store holding an archive exports neither its content nor where it is."""

        data = b'{"type": "synthetic", "text": "needle-0c41"}\n'
        source = os.path.join(self.directory, "session.jsonl")
        with open(source, "wb") as handle:
            handle.write(data)
        session_id = "6f1c2a8e-0000-4000-8000-0000000000bb"
        record = normalize.lifecycle_event(
            "claude",
            "session-end",
            {"session_id": session_id, "transcript_path": source},
            event_uid="00000000-0000-4000-8000-0000000000bb",
            occurred_at=normalize.timestamp(time.time_ns()),
        )
        assert record is not None
        # A generous copy deadline: a slow runner must not leave the copy pending.
        with mock.patch.object(transcripts, "HOOK_SECONDS", 60.0):
            ingest.deliver(
                record,
                store_path=self.store_path,
                schema_version=store.STORE_SCHEMA_VERSION,
                occurred_ns=time.time_ns(),
                now=normalize.timestamp(time.time_ns()),
            )
        (archive,) = transcripts.current(self.conn).values()
        planning_service.create_planning_space(
            self.conn, project_id="export", name="Export", key="EXP"
        )
        item = planning_service.create_work_item(self.conn, space="EXP", title="Refers to it")
        planning_service.attach_ref(self.conn, str(item["reference"]), "session", session_id)
        self.conn.commit()

        rendered = export.render(export.export_installation(self.conn))
        self.assertIn("transcript archive", json.loads(rendered)["excluded"])
        for leaked in (
            "needle-0c41",
            archive.archive_path,
            hashlib.sha256(data).hexdigest(),
            transcripts.ROOT_NAME,
            transcripts.ARCHIVED,
            "archive_sha256",
        ):
            with self.subTest(leaked=leaked):
                self.assertNotIn(leaked, rendered)

    def test_an_agents_label_never_reaches_the_export_or_doctor(self) -> None:
        """A label can hold private data; only the card it was written for may draw it."""

        record = normalize.lifecycle_event(
            "claude",
            "post-tool-use",
            {
                "session_id": "6f1c2a8e-0000-4000-8000-0000000000cc",
                "tool_name": "Agent",
                "tool_input": {"description": "needle-7d2e"},
                "tool_response": {"status": "async_launched", "agentId": "a4d2"},
            },
            event_uid="00000000-0000-4000-8000-0000000000cc",
            occurred_at=normalize.timestamp(time.time_ns()),
        )
        assert record is not None
        ingest.deliver(
            record,
            store_path=self.store_path,
            schema_version=store.STORE_SCHEMA_VERSION,
            occurred_ns=time.time_ns(),
            now=normalize.timestamp(time.time_ns()),
        )
        stored = self.conn.execute("SELECT label FROM sessions WHERE label != ''").fetchall()
        self.assertEqual(["needle-7d2e"], [row["label"] for row in stored])
        self.assertNotIn("needle-7d2e", export.render(export.export_installation(self.conn)))
        with mock.patch.dict(
            os.environ,
            {"HOME": self.directory, "USERPROFILE": self.directory, "LOCALAPPDATA": self.directory},
        ):
            report = doctor.diagnose(probe=False)
        self.assertNotIn("needle-7d2e", json.dumps(report, default=str))

    def test_a_retired_or_unknown_section_is_refused(self) -> None:
        for section in ("relations", "settings", "modules"):
            with (
                self.subTest(section=section),
                self.assertRaisesRegex(ValueError, "unknown export section"),
            ):
                export.export_installation(self.conn, sections=(section,))


class CompleteExportTests(unittest.TestCase):
    """A space larger than one list page is exported whole, or not at all."""

    BIG = "BIG"
    SMALL = "SML"

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
        for key, name in ((self.BIG, "Big"), (self.SMALL, "Small")):
            planning_service.create_planning_space(
                self.conn, project_id="export", name=name, key=key
            )
        bulk_items(self.conn, self.BIG, planning_service.MAX_LIST_PAGE + 1)
        bulk_items(self.conn, self.SMALL, 3)

    def exported_ids(self, payload: dict) -> list[str]:
        return [str(item["work_item_id"]) for item in payload["planning"]["work_items"]]

    def test_every_item_of_every_space_is_exported_once(self) -> None:
        payload = export.export_installation(self.conn)
        exported = self.exported_ids(payload)
        self.assertEqual(len(exported), len(set(exported)))
        self.assertEqual(
            item_ids(self.conn, self.BIG) | item_ids(self.conn, self.SMALL), set(exported)
        )
        # The items a list in state order reaches last are the terminal ones,
        # and they are the ones a capped read used to lose.
        terminal = [
            item for item in payload["planning"]["work_items"] if item["state"]["is_terminal"]
        ]
        self.assertTrue(terminal)
        self.assertNotIn("space_filter", payload)

    def test_a_space_filter_exports_exactly_that_space(self) -> None:
        payload = export.export_installation(self.conn, spaces=(self.SMALL,))
        self.assertEqual(
            [self.SMALL], [space["key"] for space in payload["planning"]["planning_spaces"]]
        )
        self.assertEqual([self.SMALL], payload["space_filter"])
        self.assertEqual(item_ids(self.conn, self.SMALL), set(self.exported_ids(payload)))

    def test_an_unknown_space_is_refused(self) -> None:
        with self.assertRaisesRegex(planning_model.PlanningError, "no planning space named NOPE"):
            export.export_installation(self.conn, spaces=(self.SMALL, "NOPE"))

    def test_items_that_do_not_add_up_to_the_space_stop_the_export(self) -> None:
        real = planning_service.list_work_items_page

        def short(conn: sqlite3.Connection, **arguments: Any) -> dict:
            page = real(conn, **arguments)
            return {**page, "work_items": page["work_items"][1:]}

        def repeated(conn: sqlite3.Connection, **arguments: Any) -> dict:
            page = real(conn, **arguments)
            first, _, *rest = page["work_items"]
            return {**page, "work_items": [first, *rest, first]}

        for name, fault in (("short", short), ("repeated", repeated)):
            with (
                self.subTest(fault=name),
                mock.patch.object(planning_service, "list_work_items_page", fault),
                self.assertRaisesRegex(export.ExportIncompleteError, "nothing was written"),
            ):
                export.export_installation(self.conn, spaces=(self.SMALL,))

    def test_the_read_leaves_no_transaction_open(self) -> None:
        export.export_installation(self.conn, spaces=(self.SMALL,))
        self.assertFalse(self.conn.in_transaction)


class ExportFileTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.target = os.path.join(directory.name, "export.json")
        self.payload = {"planning": {"planning_spaces": [{"key": "ONE"}], "work_items": [{}, {}]}}

    def test_the_file_is_the_rendered_export_and_nothing_is_left_beside_it(self) -> None:
        written = export.write(self.payload, self.target)
        with open(self.target, "rb") as handle:
            self.assertEqual((export.render(self.payload) + "\n").encode("utf-8"), handle.read())
        self.assertEqual(["export.json"], os.listdir(self.directory))
        self.assertEqual(
            f"wrote {written}: 1 planning space(s) (ONE), 2 work item(s)",
            export.summary(self.payload, written),
        )

    def test_a_failed_replace_keeps_the_previous_file_whole(self) -> None:
        with open(self.target, "wb") as handle:
            handle.write(b"previous")
        with (
            mock.patch.object(export.os, "replace", side_effect=OSError("disk gone")),
            self.assertRaises(OSError),
        ):
            export.write(self.payload, self.target)
        with open(self.target, "rb") as handle:
            self.assertEqual(b"previous", handle.read())
        self.assertEqual(["export.json"], os.listdir(self.directory))


if __name__ == "__main__":
    unittest.main()
