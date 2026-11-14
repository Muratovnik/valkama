"""The trial writes `fresh-shape` of the work-model migration learns a store's constraints from.

Each test opens fresh stores of this build in a temporary directory. What the probes
must find wrong in a migrated store is proved where `fresh-shape` runs, in
`test_planning_work_model_migration`; here it is the probes themselves: that they
cover every CHECK a fresh store declares, and that a fresh store answers each as
written.
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import store
from server.planning import work_model_probes as probes


class FreshStoreTests(unittest.TestCase):
    """Two fresh stores, foreign keys off as the migration holds them."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.first, self.second = (self.open(directory.name, name) for name in ("a", "b"))

    def open(self, directory: str, name: str) -> sqlite3.Connection:
        conn = store.connect(os.path.join(directory, f"{name}.sqlite3"))
        self.addCleanup(conn.close)
        conn.commit()
        conn.execute("PRAGMA foreign_keys=OFF")
        return conn

    def test_every_check_a_fresh_store_declares_is_refused_by_a_probe_naming_it(self) -> None:
        # Counted apart from the parser: each `CHECK (` SQLite stores for a table.
        counted = sum(
            len(re.findall(r"\bCHECK\s*\(", str(sql), re.IGNORECASE))
            for (sql,) in self.first.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL"
            )
        )
        declared = probes.declared(self.first)
        found, unprobed = probes.probes(declared)
        self.assertEqual([], unprobed)
        self.assertEqual(counted, sum(len(clauses) for clauses in declared.values()))
        refusing = {
            each.fresh.removeprefix(probes.CHECK_FAILED)
            for each in found
            if each.fresh and each.fresh.startswith(probes.CHECK_FAILED)
        }
        self.assertEqual(
            sorted(clause for clauses in declared.values() for clause in clauses),
            sorted(refusing),
        )

    def test_a_fresh_store_answers_every_probe_as_written(self) -> None:
        self.assertEqual([], probes.probe(self.second, self.first))
        self.assertFalse(self.first.in_transaction)
        self.assertEqual(0, self.first.execute("SELECT COUNT(*) FROM work_items").fetchone()[0])

    def test_every_written_probe_names_a_clause_a_fresh_store_declares(self) -> None:
        declared = probes.declared(self.first)
        for table, clause in probes._WRITTEN:
            with self.subTest(table=table, clause=clause):
                self.assertIn(clause, declared.get(table, []))
        for table, column, _value in probes._TAKEN_WITH:
            with self.subTest(table=table, column=column):
                self.assertTrue(
                    any(re.match(rf"{column}\s+IN\b", clause) for clause in declared[table])
                )
        for table, column in probes._RETIRED:
            with self.subTest(table=table, column=column):
                self.assertTrue(
                    any(re.match(rf"{column}\s+IN\b", clause) for clause in declared[table])
                )

    def test_a_clause_no_probe_covers_is_reported(self) -> None:
        self.second.execute("CREATE TABLE probe_extra(x INTEGER CHECK(x * 2 < 10))")
        problems = probes.probe(self.first, self.second)
        self.assertIn("probe_extra has CHECK clauses and no probe row", problems)
        self.assertIn("probe_extra declares 0 CHECK clauses, a fresh store 1", problems)
        _found, unprobed = probes.probes({"work_items": ["title != ''"]})
        self.assertEqual(["no probe tries work_items CHECK(title != '')"], unprobed)

    def test_a_probe_a_fresh_store_answers_otherwise_is_reported_as_wrong(self) -> None:
        self.second.execute(
            "CREATE TRIGGER probe_refused BEFORE INSERT ON work_item_refs"
            " BEGIN SELECT RAISE(ABORT, 'no refs'); END"
        )
        problems = probes.probe(self.first, self.second)
        self.assertIn(
            "the probe is wrong: a fresh store has work_item_refs with its probe row"
            " refused (no refs)",
            problems,
        )

    def test_a_store_refusing_for_another_reason_is_reported(self) -> None:
        self.first.execute(
            "CREATE TRIGGER probe_refused BEFORE INSERT ON work_item_links"
            " BEGIN SELECT RAISE(ABORT, 'no links'); END"
        )
        problems = probes.probe(self.first, self.second)
        self.assertIn(
            "work_item_links with its probe row is refused (no links), a fresh store takes it",
            problems,
        )
        self.assertIn(
            "work_item_links CHECK(kind IN ('blocks','discovered-from','duplicates','relates-to'))"
            " with {'kind': 'probe-unlisted'} is refused (no links), not as a fresh store"
            " refuses it",
            problems,
        )

    def test_the_store_must_run_without_foreign_keys(self) -> None:
        self.first.execute("PRAGMA foreign_keys=ON")
        self.assertEqual(
            ["foreign keys are enforced on the migrated store, so a probe row lacks its parents"],
            probes.probe(self.first, self.second),
        )


class ClauseTests(unittest.TestCase):
    """The clause text is read as SQLite names it, past quotes and comments."""

    def test_quotes_and_comments_do_not_end_or_start_a_clause(self) -> None:
        sql = (
            "CREATE TABLE t(a TEXT CHECK(a IN ('(', ')', 'it''s')), -- CHECK(no)\n"
            " \"check\" TEXT, b TEXT CHECK (b GLOB '[)]*'), /* CHECK(x) */ c INT,"
            " CHECK((a = 'x') = (c > 0)))"
        )
        self.assertEqual(
            ["a IN ('(', ')', 'it''s')", "b GLOB '[)]*'", "(a = 'x') = (c > 0)"],
            probes.clauses(sql),
        )
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        conn.execute(sql)
        with self.assertRaises(sqlite3.IntegrityError) as refused:
            conn.execute("INSERT INTO t(a, b, c) VALUES('(', ')', 1)")
        self.assertEqual(probes.CHECK_FAILED + probes.clauses(sql)[2], str(refused.exception))


if __name__ == "__main__":
    unittest.main()
