"""The tick: intervals of a running machine, kept where they wake nothing."""

from __future__ import annotations

import contextlib
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from server import housekeeping, store
from server.telemetry import liveness

NOON = 1_800_000_000.0


class IntervalTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store_path = str(Path(directory.name) / "valkama.sqlite3")

    def test_ticks_a_minute_apart_extend_one_interval(self) -> None:
        for minute in range(4):
            liveness.tick(self.store_path, NOON + 60 * minute)
        self.assertEqual([(NOON, NOON + 180)], liveness.intervals(self.store_path))

    def test_a_silence_longer_than_the_break_starts_a_new_interval(self) -> None:
        liveness.tick(self.store_path, NOON)
        liveness.tick(self.store_path, NOON + 60)
        liveness.tick(self.store_path, NOON + 60 + liveness.BREAK_SECONDS + 1)
        self.assertEqual(
            [
                (NOON, NOON + 60),
                (NOON + 60 + liveness.BREAK_SECONDS + 1, NOON + 60 + liveness.BREAK_SECONDS + 1),
            ],
            liveness.intervals(self.store_path),
        )

    def test_a_silence_of_exactly_the_break_stays_one_interval(self) -> None:
        liveness.tick(self.store_path, NOON)
        liveness.tick(self.store_path, NOON + liveness.BREAK_SECONDS)
        self.assertEqual(
            [(NOON, NOON + liveness.BREAK_SECONDS)], liveness.intervals(self.store_path)
        )

    def test_processes_ticking_together_write_once(self) -> None:
        liveness.tick(self.store_path, NOON)
        liveness.tick(self.store_path, NOON + 5)
        liveness.tick(self.store_path, NOON + 10)
        self.assertEqual([(NOON, NOON)], liveness.intervals(self.store_path))

    def test_a_clock_set_back_changes_nothing(self) -> None:
        liveness.tick(self.store_path, NOON)
        liveness.tick(self.store_path, NOON - 3600)
        self.assertEqual([(NOON, NOON)], liveness.intervals(self.store_path))

    def test_no_tick_means_no_interval_and_no_file(self) -> None:
        self.assertEqual([], liveness.intervals(self.store_path))
        self.assertFalse(os.path.exists(liveness.path_for(self.store_path)))

    def test_a_tick_never_makes_the_store_directory(self) -> None:
        missing = str(Path(self.store_path).parent / "not-yet" / "valkama.sqlite3")
        liveness.tick(missing, NOON)
        self.assertFalse(os.path.exists(os.path.dirname(missing)))


class QuietTests(unittest.TestCase):
    """What a tick must not do: move the version every event stream polls."""

    def test_a_tick_moves_no_data_version_of_the_store(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "valkama.sqlite3")
            with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
                store.connect().close()
            with contextlib.closing(sqlite3.connect(path)) as observer:
                before = observer.execute("PRAGMA data_version").fetchone()[0]
                changes = observer.execute("SELECT total_changes()").fetchone()[0]
                for second in (0, 60, 120, 400):
                    liveness.tick(path, NOON + second)
                self.assertEqual(before, observer.execute("PRAGMA data_version").fetchone()[0])
                self.assertEqual(changes, observer.execute("SELECT total_changes()").fetchone()[0])

    def test_a_commit_to_the_store_does_move_it_which_is_why_the_file_is_apart(self) -> None:
        """The control: the observer above can see a commit from another connection."""

        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "valkama.sqlite3")
            with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
                writer = store.connect()
            with contextlib.closing(writer), contextlib.closing(sqlite3.connect(path)) as observer:
                before = observer.execute("PRAGMA data_version").fetchone()[0]
                writer.execute(
                    "INSERT INTO usage_runs(session_id, client, path) VALUES ('s', 'claude', 'p')"
                )
                writer.commit()
                self.assertNotEqual(before, observer.execute("PRAGMA data_version").fetchone()[0])


class CoverageTests(unittest.TestCase):
    def test_before_the_first_tick_a_gap_is_estimated_and_cut_at_the_limit(self) -> None:
        coverage = liveness.Coverage([])
        parts, dark = coverage.split(NOON, NOON + 7200)
        self.assertEqual(
            [(NOON, NOON + liveness.HISTORY_LIMIT_SECONDS, liveness.ESTIMATED)],
            parts,
        )
        self.assertEqual(7200 - liveness.HISTORY_LIMIT_SECONDS, dark)

    def test_a_short_gap_before_the_first_tick_counts_whole(self) -> None:
        coverage = liveness.Coverage([(NOON + 1000, NOON + 2000)])
        self.assertEqual(
            ([(NOON, NOON + 60, liveness.ESTIMATED)], 0.0), coverage.split(NOON, NOON + 60)
        )

    def test_what_lies_in_a_hole_does_not_count(self) -> None:
        coverage = liveness.Coverage([(NOON, NOON + 600), (NOON + 7800, NOON + 9000)])
        parts, dark = coverage.split(NOON + 300, NOON + 8100)
        self.assertEqual(
            [
                (NOON + 300, NOON + 600, liveness.OBSERVED),
                (NOON + 7800, NOON + 8100, liveness.OBSERVED),
            ],
            parts,
        )
        self.assertEqual(7200, dark)

    def test_a_stretch_short_of_the_break_counts_whatever_the_intervals_say(self) -> None:
        """Both of its records were written, so the machine was on around them."""

        coverage = liveness.Coverage([(NOON, NOON + 600)])
        self.assertEqual(
            ([(NOON + 700, NOON + 800, liveness.OBSERVED)], 0.0),
            coverage.split(NOON + 700, NOON + 800),
        )

    def test_a_record_just_past_the_last_tick_is_no_hole(self) -> None:
        coverage = liveness.Coverage([(NOON, NOON + 600)])
        parts, dark = coverage.split(NOON + 300, NOON + 650)
        self.assertEqual([(NOON + 300, NOON + 650, liveness.OBSERVED)], parts)
        self.assertEqual(0.0, dark)

    def test_after_the_last_tick_a_long_silence_is_a_hole(self) -> None:
        coverage = liveness.Coverage([(NOON, NOON + 600)])
        parts, dark = coverage.split(NOON + 300, NOON + 4000)
        self.assertEqual([(NOON + 300, NOON + 600, liveness.OBSERVED)], parts)
        self.assertEqual(3400, dark)

    def test_a_stretch_across_the_first_tick_takes_both_rules(self) -> None:
        coverage = liveness.Coverage([(NOON + 3600, NOON + 7200)])
        parts, dark = coverage.split(NOON, NOON + 3660)
        self.assertEqual(
            [
                (NOON, NOON + liveness.HISTORY_LIMIT_SECONDS, liveness.ESTIMATED),
                (NOON + 3600, NOON + 3660, liveness.OBSERVED),
            ],
            parts,
        )
        self.assertEqual(3600 - liveness.HISTORY_LIMIT_SECONDS, dark)

    def test_nothing_to_split(self) -> None:
        self.assertEqual(([], 0.0), liveness.Coverage([]).split(NOON, NOON))


class PulseTests(unittest.TestCase):
    def test_a_surface_ticks_at_once_and_stops_when_told(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "valkama.sqlite3")
            with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
                ticked = threading.Event()
                real = liveness.tick

                def tick(*arguments: object) -> None:
                    real(*arguments)  # type: ignore[arg-type]
                    ticked.set()

                with mock.patch.object(liveness, "tick", tick):
                    pulse = housekeeping.start_pulse(self.fail)
                    self.assertTrue(ticked.wait(10))
                    pulse.stop()
                    self.assertFalse(pulse.thread.is_alive())
                self.assertEqual(1, len(liveness.intervals(path)))

    def test_stopping_waits_out_a_tick_under_way(self) -> None:
        # A surface that returned while a tick still held the liveness file left its
        # journal open, and a test's temporary home could not be removed on Windows.
        entered = threading.Event()
        finished = threading.Event()
        release = threading.Event()

        def tick(_path: str, _now: float) -> None:
            entered.set()
            release.wait(10)
            finished.set()

        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "valkama.sqlite3")
            with (
                mock.patch.dict(os.environ, {"VALKAMA_DB": path}),
                mock.patch.object(liveness, "tick", tick),
            ):
                pulse = housekeeping.start_pulse(self.fail)
                self.assertTrue(entered.wait(10))
                threading.Timer(0.2, release.set).start()
                pulse.stop()
                self.assertTrue(finished.is_set())
                self.assertFalse(pulse.thread.is_alive())

    def test_a_tick_that_fails_says_so_once_and_the_thread_goes_on(self) -> None:
        said: list[str] = []
        failed = threading.Event()

        def tick(_path: str, _now: float) -> None:
            failed.set()
            raise sqlite3.OperationalError("the disk is full")

        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "valkama.sqlite3")
            with (
                mock.patch.dict(os.environ, {"VALKAMA_DB": path}),
                mock.patch.object(liveness, "tick", tick),
                mock.patch.object(liveness, "TICK_SECONDS", 0.01),
            ):
                pulse = housekeeping.start_pulse(said.append)
                self.assertTrue(failed.wait(10))
                # Long enough for the thread to come round several more times.
                pulse.event.wait(0.2)
                pulse.stop()
        self.assertEqual(1, len(said), said)
        self.assertIn("the disk is full", said[0])


if __name__ == "__main__":
    unittest.main()
