"""What an installation export carries, and what it leaves to the build."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest import mock

from server import store
from server.ops import export
from tests import registry_rows


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

    def test_settings_carry_the_owner_s_switches_and_not_the_module_list(self) -> None:
        # A store as the last build that seeded module rows left it: those rows
        # describe that build, not this installation, and do not leave.
        registry_rows.seed_modules(self.conn)
        self.conn.execute(
            "INSERT INTO integration_settings VALUES('agentmemory',0,'2026-01-01T00:00:00Z')"
        )
        self.conn.commit()
        payload = export.export_installation(self.conn, sections=("settings",))
        self.assertEqual(["settings"], payload["sections"])
        self.assertEqual({"integrations"}, set(payload["settings"]))
        self.assertEqual(
            ["agentmemory"], [row["integration_id"] for row in payload["settings"]["integrations"]]
        )
        self.assertNotIn("platform_modules", export.render(payload))

    def test_every_section_renders_and_an_unknown_one_is_refused(self) -> None:
        payload = json.loads(export.render(export.export_installation(self.conn)))
        self.assertEqual(list(export.SECTIONS), payload["sections"])
        self.assertEqual({"planning_spaces": [], "work_items": []}, payload["planning"])
        self.assertEqual([], payload["relations"])
        self.assertFalse(payload["restorable"])
        with self.assertRaisesRegex(ValueError, "unknown export section"):
            export.export_installation(self.conn, sections=("modules",))


if __name__ == "__main__":
    unittest.main()
