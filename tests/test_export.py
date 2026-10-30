"""What an installation export carries, and what it leaves to the build."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock

from server import store
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

    def test_a_retired_or_unknown_section_is_refused(self) -> None:
        for section in ("relations", "settings", "modules"):
            with (
                self.subTest(section=section),
                self.assertRaisesRegex(ValueError, "unknown export section"),
            ):
                export.export_installation(self.conn, sections=(section,))


if __name__ == "__main__":
    unittest.main()
