"""The word index arrives in a store at schema 17 without raising the schema.

The source is a store built from the catalog the last schema-17 build created,
populated as that build wrote it. What this suite holds the migration to: the
index and its marks arrive, every item already there is found by a word of its
own, every former row stays as it was, all of it under one recovery point
(`prewords`), a second open writes nothing, the recovery point brings the store
back and the migration runs again, the stamp stays 17, and a fresh store has the
same catalog directly. Then the guarantee the index is designed around: a SQLite
that cannot create it still opens and writes the store, and the first open by one
that can reads every item into it.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.planning import service, words
from tests import schema9, schema17
from tests.test_schema12_migration import _catalog, _columns, _rows

#: The tables the word index brings: its marks, and the FTS5 table with the four
#: tables FTS5 keeps it in (holding no copy of the text, it has no content table).
#: A suite whose chain runs on to this build's catalog counts them among the tables
#: it gains.
WORD_TABLES = {
    "work_item_search_rows",
    "work_item_search",
    "work_item_search_data",
    "work_item_search_idx",
    "work_item_search_docsize",
    "work_item_search_config",
}
#: The triggers that mark an item stale, and the index of the marks.
WORD_TRIGGERS = {
    f"{table}_search_{event}"
    for table in ("work_items", "work_item_comments", "work_item_requests")
    for event in ("insert", "update", "delete")
}
WORD_INDEXES = {"work_item_search_rows_stale"}
HELD = "11111111-1111-4111-8111-111111111111"
LINKED = "22222222-2222-4222-8222-222222222222"


def _found(conn: sqlite3.Connection, query: str) -> list[str]:
    return [item["work_item_id"] for item in service.search_work_items(conn, query)]


class _FromSeventeen(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        schema17.build(self.path)
        conn = sqlite3.connect(self.path)
        try:
            schema9.populate(conn)
            # Words the populated rows lack: a description, a summary and a
            # question's field, each as the schema-17 build stored it.
            report = '{"done": "Measured the latency", "next": "Watch it"}'
            selected = conn.execute(
                "INSERT INTO work_item_comments(work_item_id,author,body,report,created_at)"
                " VALUES(?,'kept-agent','',?,?)",
                (LINKED, report, schema17.CREATED_AT),
            ).lastrowid
            conn.execute(
                "UPDATE work_items SET description = 'Quarterly reconciliation backlog',"
                " summary = ?, summary_comment_id = ? WHERE work_item_id = ?",
                (report, selected, LINKED),
            )
            conn.execute(
                "UPDATE work_item_requests SET fields_json ="
                ' \'[{"id": "a", "type": "text", "label": "Which hemisphere"}]\''
            )
            conn.commit()
            self.assertEqual(17, conn.execute("PRAGMA user_version").fetchone()[0])
            self.shape = _columns(conn)
            self.before = _rows(conn, self.shape)
        finally:
            conn.close()
        for table in WORD_TABLES:
            self.assertNotIn(table, self.shape)

    def snapshots(self, label: str = "prewords") -> list[Path]:
        return sorted((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def taken(self) -> dict[str, int]:
        labels = {path.name.split("-")[1] for path in (self.root / "backups").glob("*.sqlite3")}
        return {label: len(self.snapshots(label)) for label in labels}


class WordIndexMigrationTests(_FromSeventeen):
    def test_every_item_there_is_found_by_its_own_words_and_every_row_stays(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(17, conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertLessEqual(WORD_TABLES, _catalog(conn, "table"))
        self.assertEqual(
            [(HELD, 0), (LINKED, 0)],
            [
                tuple(row)
                for row in conn.execute(
                    "SELECT work_item_id, stale FROM work_item_search_rows ORDER BY work_item_id"
                )
            ],
        )
        for query, owner in (
            ("history", HELD),  # a title
            ("byte", HELD),  # a comment
            ("reconciliation", LINKED),  # a description
            ("latency", LINKED),  # a summary's field
            ("hemisphere", HELD),  # a question's field
        ):
            with self.subTest(query=query):
                self.assertEqual([owner], _found(conn, query))
        plain = sqlite3.connect(self.path)
        self.addCleanup(plain.close)
        self.assertEqual(self.before, _rows(plain, self.shape))
        self.assertEqual("ok", plain.execute("PRAGMA integrity_check").fetchone()[0])

    def test_one_recovery_point_holding_the_source_as_it_was(self) -> None:
        store.connect().close()
        self.assertEqual({"prewords": 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots()[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(self.shape, _columns(backup))
        self.assertEqual(self.before, _rows(backup, self.shape))

    def test_the_recovery_point_restores_the_source_and_the_migration_runs_again(self) -> None:
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(self.snapshots()[0], self.path)
        restored = sqlite3.connect(self.path)
        try:
            self.assertEqual(self.shape, _columns(restored))
        finally:
            restored.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual([LINKED], _found(conn, "reconciliation"))
        # The restored store is the point's own source, so the replay reuses it.
        self.assertEqual({"prewords": 1}, self.taken())

    def test_reopening_a_migrated_store_writes_nothing(self) -> None:
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual({"prewords": 1}, self.taken())

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        migrated = store.connect()
        self.addCleanup(migrated.close)
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assertLessEqual(WORD_TRIGGERS, _catalog(fresh, "trigger"))
        self.assertLessEqual(WORD_INDEXES, _catalog(fresh, "index"))
        for kind in ("table", "index", "trigger"):
            with self.subTest(kind=kind):
                self.assertEqual(_catalog(fresh, kind), _catalog(migrated, kind))


class WithoutFtsFiveTests(_FromSeventeen):
    """A SQLite built without FTS5, played by a module name no SQLite has."""

    def test_the_store_opens_and_writes_and_the_next_open_with_fts5_reads_it_all(self) -> None:
        missing = words._INDEX_DDL.replace("fts5(", "fts5_missing(")
        with mock.patch.object(words, "_INDEX_DDL", missing):
            conn = store.connect()
            try:
                self.assertNotIn("work_item_search", _catalog(conn, "table"))
                created = service.create_work_item(
                    conn, space="KEEP", title="Written where the index was out of reach"
                )
                service.comment_work_item(conn, created["reference"], "about a zeppelin")
                conn.commit()
                # The substring search that came before the index still answers.
                self.assertEqual([created["work_item_id"]], _found(conn, "a zeppelin"))
                self.assertEqual(
                    3,
                    conn.execute(
                        "SELECT COUNT(*) FROM work_item_search_rows WHERE stale = 1"
                    ).fetchone()[0],
                )
            finally:
                conn.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual([created["work_item_id"]], _found(conn, "zeppelin reach"))
        self.assertEqual([LINKED], _found(conn, "reconciliation"))
        self.assertEqual(
            0,
            conn.execute("SELECT COUNT(*) FROM work_item_search_rows WHERE stale = 1").fetchone()[
                0
            ],
        )

    def test_a_writer_without_the_module_leaves_marks_and_never_fails(self) -> None:
        store.connect().close()
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
                self.assertEqual([LINKED], _found(blind, "walrus"))
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
        self.assertEqual([LINKED], _found(conn, "walrus"))
        self.assertEqual([HELD], _found(conn, "aardvark"))
        self.assertEqual([], _found(conn, "reconciliation"))


if __name__ == "__main__":
    unittest.main()
