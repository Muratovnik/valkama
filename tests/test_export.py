"""What an installation export carries, and what it leaves to the build."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import unittest
from unittest import mock

from server import store, transcripts
from server.hooks import ingest, normalize
from server.ops import export
from server.planning import service as planning_service


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

    def test_a_retired_or_unknown_section_is_refused(self) -> None:
        for section in ("relations", "settings", "modules"):
            with (
                self.subTest(section=section),
                self.assertRaisesRegex(ValueError, "unknown export section"),
            ):
                export.export_installation(self.conn, sections=(section,))


if __name__ == "__main__":
    unittest.main()
