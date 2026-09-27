"""Two guards against running one version of Valkama against another's data.

A stdio MCP server is spawned by its client from a working tree and lives as
long as the session does. Nothing makes it exit when that tree moves, so the
next session gets a process built from the new code while this one keeps
answering from the old -- both against the same store. Neither half of the
product noticed: the MCP handshake advertises a literal `1.0.0` that has never
moved, and the store carried no generation number at all.

`SourceWatch` covers the process that went stale while it ran. It is a warning,
not a refusal, because the client owns this process's lifetime and a server that
killed itself mid-call would lose the call rather than fix anything.

`STORE_SCHEMA_VERSION` covers the opposite case, a build that was already old
when it started -- a checkout moved back, an installed copy left behind. That
one is refused outright, before any write, because a build cannot be trusted to
read rows a later version defined.

Every case here runs against a throwaway store in a temporary home.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import static_assets, store


class Clock:
    """A hand-wound monotonic clock, so an interval is tested and not waited out."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class SourceWatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.tree.cleanup)
        os.mkdir(os.path.join(self.tree.name, "server"))
        self.module = os.path.join(self.tree.name, "server", "thing.py")
        self.write("value = 1\n")
        self.clock = Clock()
        self.watch = static_assets.SourceWatch(self.tree.name, interval=5.0, clock=self.clock)

    def write(self, body: str, *, mtime: float | None = None) -> None:
        with open(self.module, "w", encoding="utf-8") as handle:
            handle.write(body)
        # Set explicitly rather than trusting the filesystem clock: a same-second
        # rewrite can leave the stamp identical and make a test pass for the
        # wrong reason.
        if mtime is not None:
            os.utime(self.module, (mtime, mtime))

    def test_an_untouched_tree_never_reports_drift(self) -> None:
        self.clock.advance(60)
        self.assertFalse(self.watch.drifted())

    def test_changed_content_is_drift(self) -> None:
        self.write("value = 2\n", mtime=2_000_000)
        self.clock.advance(60)
        self.assertTrue(self.watch.drifted())

    def test_a_new_module_is_drift(self) -> None:
        with open(
            os.path.join(self.tree.name, "server", "another.py"), "w", encoding="utf-8"
        ) as handle:
            handle.write("value = 3\n")
        self.clock.advance(60)
        self.assertTrue(self.watch.drifted())

    def test_a_release_version_change_is_drift(self) -> None:
        release_file = os.path.join(self.tree.name, "VERSION")
        with open(release_file, "w", encoding="utf-8") as handle:
            handle.write("1.0.2\n")
        self.watch = static_assets.SourceWatch(self.tree.name, interval=5.0, clock=self.clock)
        initial = self.watch.build_id
        with open(release_file, "w", encoding="utf-8") as handle:
            handle.write("1.0.3\n")
        self.clock.advance(60)
        self.assertTrue(self.watch.drifted())
        self.assertNotEqual(initial, static_assets.backend_digest(self.tree.name)[:12])

    def test_identical_bytes_at_a_new_mtime_are_not_drift(self) -> None:
        # What `git checkout` does to a file it restores unchanged. Warning here
        # would teach the reader to ignore the warning that matters.
        self.write("value = 1\n", mtime=2_000_000)
        self.clock.advance(60)
        self.assertFalse(self.watch.drifted())

    def test_the_tree_is_not_read_again_before_the_interval_elapses(self) -> None:
        self.write("value = 2\n", mtime=2_000_000)
        self.clock.advance(4.9)
        self.assertFalse(self.watch.drifted())
        self.clock.advance(0.2)
        self.assertTrue(self.watch.drifted())

    def test_drift_is_one_way_and_a_restored_file_does_not_clear_it(self) -> None:
        self.write("value = 2\n", mtime=2_000_000)
        self.clock.advance(60)
        self.assertTrue(self.watch.drifted())
        self.write("value = 1\n", mtime=3_000_000)
        self.clock.advance(60)
        self.assertTrue(
            self.watch.drifted(),
            "a process that has run replaced code cannot become current again",
        )

    def test_a_stamp_change_alone_does_not_cost_a_digest_of_the_whole_tree(self) -> None:
        # The cheap probe exists to keep the expensive one rare. If an unchanged
        # tree still hashed every module on every call, the throttle would be the
        # only thing standing between this and a slow tool call.
        with mock.patch.object(
            static_assets, "backend_digest", wraps=static_assets.backend_digest
        ) as digest:
            self.clock.advance(60)
            self.watch.drifted()
            self.clock.advance(60)
            self.watch.drifted()
        self.assertEqual(0, digest.call_count)


class StoreSchemaVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.path = os.path.join(self.home.name, "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {"VALKAMA_DB": self.path, "USERPROFILE": self.home.name, "HOME": self.home.name},
        )
        patch.start()
        self.addCleanup(patch.stop)

    def stored_version(self) -> int:
        conn = sqlite3.connect(self.path)
        try:
            return int(conn.execute("PRAGMA user_version").fetchone()[0])
        finally:
            conn.close()

    def test_a_fresh_store_is_stamped_with_this_build_s_generation(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(store.STORE_SCHEMA_VERSION, self.stored_version())

    def test_a_store_written_before_versioning_existed_is_brought_up(self) -> None:
        conn = store.connect()
        conn.close()
        legacy = sqlite3.connect(self.path)
        legacy.execute("PRAGMA user_version=0")
        legacy.commit()
        legacy.close()
        reopened = store.connect()
        self.addCleanup(reopened.close)
        self.assertEqual(store.STORE_SCHEMA_VERSION, self.stored_version())

    def test_reopening_a_current_store_leaves_the_generation_alone(self) -> None:
        first = store.connect()
        first.close()
        second = store.connect()
        self.addCleanup(second.close)
        self.assertEqual(store.STORE_SCHEMA_VERSION, self.stored_version())

    def test_a_newer_store_is_refused_before_anything_is_created(self) -> None:
        future = store.STORE_SCHEMA_VERSION + 1
        seed = sqlite3.connect(self.path)
        seed.execute(f"PRAGMA user_version={future}")
        seed.commit()
        seed.close()
        with open(self.path, "rb") as handle:
            before_hash = hashlib.sha256(handle.read()).hexdigest()

        with self.assertRaises(store.StoreTooNewError) as raised:
            store.connect()

        self.assertEqual(future, raised.exception.stored)
        self.assertEqual(store.STORE_SCHEMA_VERSION, raised.exception.supported)
        with open(self.path, "rb") as handle:
            self.assertEqual(before_hash, hashlib.sha256(handle.read()).hexdigest())
        self.assertFalse(os.path.exists(self.path + "-wal"))
        self.assertFalse(os.path.exists(self.path + "-shm"))
        self.assertFalse(os.path.exists(self.path + ".migration.lock"))
        check = sqlite3.connect(self.path)
        try:
            tables = [
                row[0] for row in check.execute("SELECT name FROM sqlite_master WHERE type='table'")
            ]
            self.assertEqual([], tables, "a refused store was written to anyway")
            self.assertEqual(future, int(check.execute("PRAGMA user_version").fetchone()[0]))
        finally:
            check.close()

    def test_the_refusal_says_both_numbers_and_what_to_do(self) -> None:
        message = str(store.StoreTooNewError(9, 4))
        self.assertIn("9", message)
        self.assertIn("4", message)
        self.assertIn("Restart", message)


if __name__ == "__main__":
    unittest.main()
