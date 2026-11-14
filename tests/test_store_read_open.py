"""`store.connect_for_read`: a read of a current store waits for no one's bring-up.

`connect()` holds the migration lock through the whole bring-up of every open, so
requests that opened the store together were answered one after another. Each case
holds that lock the way a concurrent `connect()` does and runs against a throwaway
store.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from unittest import mock

from server import store, store_lock


class ReadOpenTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {"VALKAMA_DB": self.path, "HOME": str(self.root), "USERPROFILE": str(self.root)},
        )
        patch.start()
        self.addCleanup(patch.stop)

    @contextmanager
    def bring_up_in_progress(self) -> Iterator[None]:
        """The migration lock, held by another thread for as long as the block runs."""

        entered, release = threading.Event(), threading.Event()

        def hold() -> None:
            with store_lock.migration_lock(self.path):
                entered.set()
                release.wait(10)

        holder = threading.Thread(target=hold)
        holder.start()
        try:
            self.assertTrue(entered.wait(5))
            yield
        finally:
            release.set()
            holder.join(10)

    def stamp(self, version: int) -> None:
        conn = sqlite3.connect(self.path)
        try:
            conn.execute(f"PRAGMA user_version={version}")
            conn.commit()
        finally:
            conn.close()

    def test_a_current_store_opens_while_another_open_holds_the_lock(self) -> None:
        store.connect().close()
        with self.bring_up_in_progress():
            conn = store.connect_for_read()
        self.addCleanup(conn.close)
        # As `connect()` leaves it: rows by name and foreign keys on.
        row = conn.execute("PRAGMA user_version").fetchone()
        self.assertEqual(store.STORE_SCHEMA_VERSION, row["user_version"])
        self.assertEqual(1, conn.execute("PRAGMA foreign_keys").fetchone()[0])

    def test_a_missing_store_is_brought_up_as_connect_brings_it_up(self) -> None:
        conn = store.connect_for_read()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertIn(
            "work_items",
            {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")},
        )

    def test_a_store_from_a_newer_build_is_refused(self) -> None:
        store.connect().close()
        self.stamp(store.STORE_SCHEMA_VERSION + 1)
        with self.assertRaises(store.StoreTooNewError):
            store.connect_for_read().close()

    def test_a_store_from_an_older_build_is_refused(self) -> None:
        store.connect().close()
        self.stamp(store.OLDEST_SCHEMA_VERSION - 1)
        with self.assertRaises(store.StoreTooOldError):
            store.connect_for_read().close()

    def test_a_store_at_another_schema_waits_for_the_bring_up(self) -> None:
        # A file that holds no table yet is one the bring-up creates a store in.
        self.root.joinpath("valkama.sqlite3").touch()
        patient = store_lock.migration_lock

        def impatient(path: str) -> AbstractContextManager[None]:
            return patient(path, timeout=0.05)

        with (
            self.bring_up_in_progress(),
            mock.patch.object(store_lock, "migration_lock", impatient),
            self.assertRaisesRegex(RuntimeError, "migration lock"),
        ):
            store.connect_for_read()


if __name__ == "__main__":
    unittest.main()
