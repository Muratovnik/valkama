"""The counts of how often each analytics surface is used: one row per day and kind.

The table's name, its columns and the four kinds are stated here rather than read from
the code under test. A row is a day, a kind and a count, so nothing finer than the day
and no text of any use can be stored.
"""

from __future__ import annotations

import datetime as dt
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.analytics import uses

TABLE = "analytics_surface_uses"
KINDS = ("page_open", "panel_open", "mini_open", "task_open")
DAY = dt.date(2030, 3, 4)


class SurfaceUseCountTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.root / "valkama.sqlite3")})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def rows(self, conn: sqlite3.Connection | None = None) -> list[tuple]:
        return [
            tuple(row)
            for row in (conn or self.conn).execute(
                f"SELECT day, kind, count FROM {TABLE} ORDER BY day, kind"
            )
        ]

    def test_a_fresh_store_holds_the_table_empty_with_a_day_a_kind_and_a_count(self) -> None:
        columns = [
            (row[1], row[2], bool(row[3]), row[5])
            for row in self.conn.execute(f"PRAGMA table_info({TABLE})")
        ]
        self.assertEqual(
            [("day", "TEXT", True, 1), ("kind", "TEXT", True, 2), ("count", "INTEGER", True, 0)],
            columns,
        )
        self.assertEqual([], self.rows())

    def test_two_uses_on_one_day_are_one_row_of_two(self) -> None:
        self.assertEqual(1, uses.add(self.conn, "page_open", DAY))
        self.assertEqual(2, uses.add(self.conn, "page_open", DAY))
        self.assertEqual([("2030-03-04", "page_open", 2)], self.rows())

    def test_each_day_and_each_kind_counts_apart(self) -> None:
        for kind in KINDS:
            uses.add(self.conn, kind, DAY)
        uses.add(self.conn, "task_open", DAY + dt.timedelta(days=1))
        self.assertEqual(
            sorted([("2030-03-04", kind, 1) for kind in KINDS] + [("2030-03-05", "task_open", 1)]),
            self.rows(),
        )

    def test_a_count_is_committed_by_the_write(self) -> None:
        uses.add(self.conn, "mini_open", DAY)
        other = sqlite3.connect(store.db_path())
        self.addCleanup(other.close)
        self.assertEqual([("2030-03-04", "mini_open", 1)], self.rows(other))

    def test_an_unknown_kind_is_refused_and_writes_nothing(self) -> None:
        for kind in ("page_opened", "PAGE_OPEN", "", "page_open "):
            with self.subTest(kind=kind), self.assertRaises(uses.UseError):
                uses.add(self.conn, kind, DAY)
        self.assertEqual([], self.rows())
        self.assertFalse(self.conn.in_transaction)

    def test_the_table_itself_refuses_another_kind_a_finer_time_and_a_non_count(self) -> None:
        for day, kind, count in (
            ("2030-03-04", "item_open", 1),
            ("2030-03-04T09:00", "page_open", 1),
            ("2030-03-04", "page_open", 0),
            ("2030-03-04", "page_open", "1 MAIN-12"),
        ):
            with self.subTest(day=day, kind=kind, count=count):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.conn.execute(
                        f"INSERT INTO {TABLE}(day, kind, count) VALUES (?, ?, ?)",
                        (day, kind, count),
                    )
                self.conn.rollback()
        self.assertEqual([], self.rows())

    def test_a_snapshot_of_the_store_holds_the_counts(self) -> None:
        uses.add(self.conn, "page_open", DAY)
        uses.add(self.conn, "page_open", DAY)
        uses.add(self.conn, "task_open", DAY)
        snapshot = store_backups.snapshot(self.conn, store.backup_location(), "check")
        copy = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
        self.addCleanup(copy.close)
        self.assertEqual(
            [("2030-03-04", "page_open", 2), ("2030-03-04", "task_open", 1)], self.rows(copy)
        )


if __name__ == "__main__":
    unittest.main()
