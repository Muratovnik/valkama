"""The suite's guard against resources left open, `tests/resource_leaks.py`."""

from __future__ import annotations

import gc
import os
import sqlite3
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
import warnings

from tests import resource_leaks

#: Connections a case keeps past its own end, as an attribute of a test would.
_KEPT: list[sqlite3.Connection] = []
#: The temporary directories a case left to the collector.
_NAMES: list[str] = []
#: A child that exits at once, so a case that never waits for it leaves nothing running.
_CHILD = [sys.executable, "-c", "pass"]


def _start_child() -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        _CHILD, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


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
            warnings.warn("unclosed transport <a test's own>", ResourceWarning, stacklevel=1)

        def test_keeps_open_past_its_end(self) -> None:
            _KEPT.append(sqlite3.connect(":memory:"))

        def test_never_waits_for_its_child(self) -> None:
            process = _start_child()
            del process

        def test_waits_for_its_child(self) -> None:
            process = _start_child()
            process.wait(timeout=60)
            del process

        def test_leaves_a_file_open(self) -> None:
            handle = open(__file__, "rb")
            handle.read(1)
            del handle

        def test_closes_its_file(self) -> None:
            with open(__file__, "rb") as handle:
                handle.read(1)
            del handle

        def test_never_cleans_up_its_directory(self) -> None:
            directory = tempfile.TemporaryDirectory()
            _NAMES.append(directory.name)
            del directory

        def test_cleans_up_its_directory(self) -> None:
            directory = tempfile.TemporaryDirectory()
            directory.cleanup()
            del directory

    return Cases


def run_case(name: str) -> unittest.TestResult:
    result = unittest.TestResult()
    _cases()(name).run(result)
    return result


@unittest.skipIf(tracemalloc.is_tracing(), "under tracemalloc the guard stands aside")
class GuardCase(unittest.TestCase):
    def setUp(self) -> None:
        # A resource an earlier test left is that test's failure, not one of these.
        gc.collect()
        resource_leaks.fail_if_collected()

    def assert_fails_with(self, name: str, message: str) -> None:
        result = run_case(name)

        self.assertEqual(len(result.errors), 1, result.errors)
        case, text = result.errors[0]
        self.assertEqual(case.id().rsplit(".", 1)[-1], name)
        self.assertIn("ResourceWarning", text)
        self.assertRegex(text, message)
        self.assertIn("-X tracemalloc=20", text)
        self.assertEqual(result.failures, [])

    def assert_passes(self, name: str) -> None:
        result = run_case(name)

        self.assertEqual((result.errors, result.failures), ([], []))
        self.assertEqual(result.testsRun, 1)


@unittest.skipIf(
    sys.version_info < (3, 13), "sqlite3 warns about an unclosed connection from Python 3.13"
)
class ConnectionTest(GuardCase):
    def test_a_connection_left_open_fails_the_test_that_dropped_it(self) -> None:
        self.assert_fails_with("test_leaves_open", "unclosed database")

    def test_a_with_block_does_not_close_the_connection(self) -> None:
        self.assert_fails_with("test_ends_a_transaction_only", "unclosed database")

    def test_a_closed_connection_passes(self) -> None:
        self.assert_passes("test_closes")

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


class ProcessTest(GuardCase):
    def test_a_child_never_waited_for_fails_the_test_that_dropped_it(self) -> None:
        self.assert_fails_with("test_never_waits_for_its_child", r"subprocess \d+ is still running")

    def test_a_child_waited_for_passes(self) -> None:
        self.assert_passes("test_waits_for_its_child")


class FileTest(GuardCase):
    def test_a_file_left_open_fails_the_test_that_dropped_it(self) -> None:
        self.assert_fails_with("test_leaves_a_file_open", "unclosed file")

    def test_a_closed_file_passes(self) -> None:
        self.assert_passes("test_closes_its_file")


class DirectoryTest(GuardCase):
    def test_a_directory_left_to_the_collector_fails_the_test_that_dropped_it(self) -> None:
        self.assert_fails_with("test_never_cleans_up_its_directory", "Implicitly cleaning up")
        # The collector still removes it; the failure is that nobody else did.
        self.assertFalse(os.path.exists(_NAMES.pop()))

    def test_a_directory_cleaned_up_passes(self) -> None:
        self.assert_passes("test_cleans_up_its_directory")


class OtherWarningTest(GuardCase):
    def test_another_resource_warning_keeps_the_action_the_run_gave_it(self) -> None:
        with warnings.catch_warnings(record=True) as seen:
            warnings.simplefilter("always")
            result = run_case("test_warns_of_something_else")

        self.assertEqual(result.errors, [])
        self.assertEqual(
            [str(warning.message) for warning in seen], ["unclosed transport <a test's own>"]
        )


if __name__ == "__main__":
    unittest.main()
