"""`store.copy_store`: a copy holds every commit and leaves the source as it found it.

Each case copies a throwaway store in WAL mode, as the product keeps its own.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store


class CopyStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.source = self.root / "source" / "valkama.sqlite3"
        self.source.parent.mkdir()
        self.target = self.root / "copy"
        with contextlib.closing(sqlite3.connect(self.source)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE notes (value TEXT)")
            connection.execute("INSERT INTO notes VALUES ('committed')")
            connection.commit()

    def copied_notes(self, copy: str) -> list[str]:
        with contextlib.closing(
            sqlite3.connect(f"{Path(copy).as_uri()}?mode=ro", uri=True)
        ) as held:
            return [row[0] for row in held.execute("SELECT value FROM notes ORDER BY rowid")]

    def test_a_store_open_nowhere_is_copied_and_left_without_a_journal(self) -> None:
        self.assertEqual(["valkama.sqlite3"], os.listdir(self.source.parent))
        before = self.source.read_bytes()

        copy = store.copy_store(str(self.source), str(self.target))

        self.assertEqual(["committed"], self.copied_notes(copy))
        self.assertEqual(["valkama.sqlite3"], os.listdir(self.source.parent))
        self.assertEqual(before, self.source.read_bytes())

    def test_a_store_open_elsewhere_is_copied_with_the_commits_only_its_journal_holds(
        self,
    ) -> None:
        writer = sqlite3.connect(self.source)
        self.addCleanup(writer.close)
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("INSERT INTO notes VALUES ('in the journal')")
        writer.commit()
        self.assertTrue(Path(f"{self.source}-wal").stat().st_size > 0)

        copy = store.copy_store(str(self.source), str(self.target))

        self.assertEqual(["committed", "in the journal"], self.copied_notes(copy))

    def test_a_store_written_while_it_was_copied_is_refused_and_no_copy_is_left(self) -> None:
        stamps = iter([(1, 1), (2, 2)])
        with (
            mock.patch.object(store, "_stamp", side_effect=lambda _path: next(stamps)),
            self.assertRaisesRegex(RuntimeError, "opened while it was copied"),
        ):
            store.copy_store(str(self.source), str(self.target))

        self.assertFalse((self.target / "valkama.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
