"""The guarantee the word index is designed around, on a store of this build.

A SQLite that cannot create the FTS5 index still opens and writes the store, with
every item marked for the index; the first open by one that can reads every item
into it. A writer whose SQLite cannot load the module of an index that exists
leaves marks and never fails. A SQLite without FTS5 is played by a module name no
SQLite has.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.planning import service, words


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {
        str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def _found(conn: sqlite3.Connection, query: str) -> list[str]:
    return [item["work_item_id"] for item in service.search_work_items(conn, query)]


def _stale(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute("SELECT COUNT(*) FROM work_item_search_rows WHERE stale = 1").fetchone()[0]
    )


class WithoutFtsFiveTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def seed(self, conn: sqlite3.Connection) -> tuple[str, str]:
        """Two items, the second found by a word of its description."""

        service.create_planning_space(conn, project_id="keep", name="Keep", key="KEEP")
        held = service.create_work_item(conn, space="KEEP", title="Held for a while")
        linked = service.create_work_item(
            conn, space="KEEP", title="Linked", description="Quarterly reconciliation"
        )
        conn.commit()
        return str(held["work_item_id"]), str(linked["work_item_id"])

    def test_the_store_opens_and_writes_and_the_next_open_with_fts5_reads_it_all(self) -> None:
        missing = words._INDEX_DDL.replace("fts5(", "fts5_missing(")
        with mock.patch.object(words, "_INDEX_DDL", missing):
            conn = store.connect()
            try:
                self.assertNotIn("work_item_search", _tables(conn))
                _held, linked = self.seed(conn)
                created = service.create_work_item(
                    conn, space="KEEP", title="Written where the index was out of reach"
                )
                service.comment_work_item(conn, created["reference"], "about a zeppelin")
                conn.commit()
                # The substring search that came before the index still answers.
                self.assertEqual([created["work_item_id"]], _found(conn, "a zeppelin"))
                self.assertEqual(3, _stale(conn))
            finally:
                conn.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertIn("work_item_search", _tables(conn))
        self.assertEqual([created["work_item_id"]], _found(conn, "zeppelin reach"))
        self.assertEqual([linked], _found(conn, "reconciliation"))
        self.assertEqual(0, _stale(conn))

    def test_a_writer_without_the_module_leaves_marks_and_never_fails(self) -> None:
        conn = store.connect()
        held, linked = self.seed(conn)
        conn.close()
        # The index exists, and this connection's SQLite cannot load its module.
        conn = sqlite3.connect(self.path)
        conn.execute("PRAGMA writable_schema = ON")
        conn.execute(
            "UPDATE sqlite_master SET sql = replace(sql, 'fts5(', 'fts5_missing(')"
            " WHERE name = 'work_item_search'"
        )
        conn.commit()
        conn.close()
        try:
            blind = store.connect()
            try:
                service.update_work_item(blind, "KEEP-2", description="Now about a walrus")
                service.comment_work_item(blind, "KEEP-1", "and an aardvark")
                blind.commit()
                with self.assertRaisesRegex(sqlite3.OperationalError, "no such module"):
                    blind.execute("SELECT * FROM work_item_search").fetchall()
                self.assertEqual([linked], _found(blind, "walrus"))
            finally:
                blind.close()
        finally:
            conn = sqlite3.connect(self.path)
            conn.execute("PRAGMA writable_schema = ON")
            conn.execute(
                "UPDATE sqlite_master SET sql = replace(sql, 'fts5_missing(', 'fts5(')"
                " WHERE name = 'work_item_search'"
            )
            conn.commit()
            conn.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual([linked], _found(conn, "walrus"))
        self.assertEqual([held], _found(conn, "aardvark"))
        self.assertEqual([], _found(conn, "reconciliation"))


if __name__ == "__main__":
    unittest.main()
