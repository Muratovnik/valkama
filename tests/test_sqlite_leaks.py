"""The suite's guard against SQLite connections left open, `tests/sqlite_leaks.py`."""

from __future__ import annotations

import gc
import sqlite3
import sys
import tracemalloc
import unittest
import warnings

from tests import sqlite_leaks

#: Connections a case keeps past its own end, as an attribute of a test would.
_KEPT: list[sqlite3.Connection] = []


def _cases() -> type[unittest.TestCase]:
    """The cases the guard is tried on, made here so that discovery does not run them."""

    class Cases(unittest.TestCase):
        def test_leaves_open(self) -> None:
            sqlite3.connect(":memory:").execute("SELECT 1")
            gc.collect()

        def test_ends_a_transaction_only(self) -> None:
            conn = sqlite3.connect(":memory:")
            with conn:
                conn.execute("CREATE TABLE t (x)")
            del conn
            gc.collect()

        def test_closes(self) -> None:
            conn = sqlite3.connect(":memory:")
            conn.execute("SELECT 1")
            conn.close()
            del conn
            gc.collect()

        def test_warns_of_something_else(self) -> None:
            warnings.warn("unclosed file <a test's own>", ResourceWarning, stacklevel=1)

        def test_keeps_open_past_its_end(self) -> None:
            _KEPT.append(sqlite3.connect(":memory:"))

    return Cases


@unittest.skipIf(
    sys.version_info < (3, 13), "sqlite3 warns about an unclosed connection from Python 3.13"
)
@unittest.skipIf(tracemalloc.is_tracing(), "under tracemalloc the guard stands aside")
class GuardTest(unittest.TestCase):
    def setUp(self) -> None:
        # A connection an earlier test left is that test's failure, not one of these.
        gc.collect()
        sqlite_leaks.fail_if_collected()

    def run_case(self, name: str) -> unittest.TestResult:
        result = unittest.TestResult()
        _cases()(name).run(result)
        return result

    def test_a_connection_left_open_fails_the_test_that_dropped_it(self) -> None:
        result = self.run_case("test_leaves_open")

        self.assertEqual(len(result.errors), 1)
        case, text = result.errors[0]
        self.assertEqual(case.id().rsplit(".", 1)[-1], "test_leaves_open")
        self.assertIn("ResourceWarning", text)
        self.assertIn("unclosed database", text)
        self.assertIn("-X tracemalloc=20", text)
        self.assertEqual(result.failures, [])

    def test_a_with_block_does_not_close_the_connection(self) -> None:
        result = self.run_case("test_ends_a_transaction_only")

        self.assertEqual(len(result.errors), 1)
        self.assertIn("unclosed database", result.errors[0][1])

    def test_a_closed_connection_passes(self) -> None:
        result = self.run_case("test_closes")

        self.assertEqual((result.errors, result.failures), ([], []))
        self.assertEqual(result.testsRun, 1)

    def test_another_resource_warning_keeps_the_action_the_run_gave_it(self) -> None:
        with warnings.catch_warnings(record=True) as seen:
            warnings.simplefilter("always")
            result = self.run_case("test_warns_of_something_else")

        self.assertEqual(result.errors, [])
        self.assertEqual(
            [str(warning.message) for warning in seen], ["unclosed file <a test's own>"]
        )

    def test_a_connection_dropped_after_the_last_test_fails_the_run(self) -> None:
        result = unittest.TestResult()
        result.startTestRun()
        _cases()("test_keeps_open_past_its_end").run(result)
        self.assertEqual(result.errors, [])
        _KEPT.clear()
        result.stopTestRun()

        self.assertEqual(len(result.errors), 1)
        where, text = result.errors[0]
        self.assertEqual(where.shortDescription(), "the end of the run")
        self.assertIn("after the last test", text)
        self.assertIn("unclosed database", text)


if __name__ == "__main__":
    unittest.main()
