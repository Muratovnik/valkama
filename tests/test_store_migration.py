"""Adopting a store written before the product was renamed.

Two renames have happened now, so adoption has a chain to walk rather than one
predecessor to assume. Every case runs against a throwaway home directory. The
real store is never a subject here: this repository can destroy the owner's
board.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import store, store_backups
from tests import SUITE_STORE


def build_legacy_root(home: str, root_name: str = ".agent-hub", prefix: str = "hub") -> str:
    """A store shaped exactly like the one the rename has to pick up."""

    root = os.path.join(home, root_name)
    os.makedirs(os.path.join(root, "backups"))
    os.makedirs(os.path.join(root, f"{prefix}.modules"))
    database = os.path.join(root, f"{prefix}.sqlite3")
    conn = sqlite3.connect(database)
    conn.execute("CREATE TABLE boards(id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO boards(name) VALUES ('Example Board')")
    conn.commit()
    conn.close()
    for name in (f"{prefix}.sqlite3-wal", f"{prefix}.sqlite3-shm", "routa-export.json"):
        with open(os.path.join(root, name), "w", encoding="utf-8") as handle:
            handle.write("{}")
    with open(os.path.join(root, f"{prefix}.modules", "improvements.sqlite3"), "wb") as handle:
        handle.write(b"module store")
    with open(
        os.path.join(root, "backups", f"{prefix}-pretables-20260814T163423Z-cce4c9.sqlite3"), "wb"
    ) as handle:
        handle.write(b"backup")
    return root


class StoreAdoptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        patch = mock.patch.dict(os.environ, {"USERPROFILE": self.home.name, "HOME": self.home.name})
        patch.start()
        self.addCleanup(patch.stop)
        # Adoption is what happens when nobody named a store, so these cases go
        # through the default deliberately. The redirected home above is what
        # keeps that default disposable.
        os.environ.pop("VALKAMA_DB", None)
        self.addCleanup(os.environ.__setitem__, "VALKAMA_DB", SUITE_STORE)

    def test_the_whole_directory_moves_and_every_name_loses_the_old_prefix(self) -> None:
        legacy = build_legacy_root(self.home.name)
        adopted = store.adopt_legacy_store()

        self.assertEqual(os.path.join(self.home.name, ".valkama"), adopted)
        self.assertFalse(os.path.exists(legacy), "the old root is moved, not copied")
        self.assertTrue(os.path.isfile(os.path.join(adopted, "valkama.sqlite3")))
        self.assertTrue(os.path.isfile(os.path.join(adopted, "valkama.sqlite3-wal")))
        self.assertTrue(os.path.isfile(os.path.join(adopted, "valkama.sqlite3-shm")))
        self.assertTrue(
            os.path.isfile(os.path.join(adopted, "valkama.modules", "improvements.sqlite3")),
            "the sidecar module store is found by the database's stem, so it renames too",
        )
        self.assertTrue(
            os.path.isfile(
                os.path.join(
                    adopted, "backups", "valkama-pretables-20260814T163423Z-cce4c9.sqlite3"
                )
            )
        )
        self.assertTrue(
            os.path.isfile(os.path.join(adopted, "routa-export.json")),
            "a file that never carried the prefix keeps its name",
        )

    def test_a_store_that_skipped_a_rename_is_still_adopted(self) -> None:
        """A workstation last used before the middle rename has the oldest layout."""

        legacy = build_legacy_root(self.home.name, ".agent-kanban", "kanban")
        adopted = store.adopt_legacy_store()

        self.assertEqual(os.path.join(self.home.name, ".valkama"), adopted)
        self.assertFalse(os.path.exists(legacy))
        self.assertTrue(os.path.isfile(os.path.join(adopted, "valkama.sqlite3")))
        self.assertTrue(
            os.path.isfile(os.path.join(adopted, "valkama.modules", "improvements.sqlite3"))
        )

    def test_the_newest_layout_wins_when_two_generations_are_on_disk(self) -> None:
        """The abandoned older root is left where it is rather than merged in."""

        older = build_legacy_root(self.home.name, ".agent-kanban", "kanban")
        newer = build_legacy_root(self.home.name)
        conn = sqlite3.connect(os.path.join(newer, "hub.sqlite3"))
        conn.execute("INSERT INTO boards(name) VALUES ('Newer Board')")
        conn.commit()
        conn.close()

        store.adopt_legacy_store()

        self.assertFalse(os.path.exists(newer))
        self.assertTrue(os.path.isdir(older), "the skipped generation is not touched")
        conn = sqlite3.connect(store.db_path())
        try:
            names = {row[0] for row in conn.execute("SELECT name FROM boards")}
        finally:
            conn.close()
        self.assertIn("Newer Board", names)

    def test_every_hop_is_recorded_so_the_oldest_path_stays_readable(self) -> None:
        legacy = build_legacy_root(self.home.name)
        adopted = store.adopt_legacy_store()

        with open(os.path.join(adopted, "MOVED-FROM.txt"), encoding="utf-8") as note:
            self.assertEqual([legacy], note.read().split())

    def test_the_cards_survive_the_move(self) -> None:
        build_legacy_root(self.home.name)
        store.adopt_legacy_store()
        conn = sqlite3.connect(store.db_path())
        try:
            self.assertEqual(
                [("Example Board",)], conn.execute("SELECT name FROM boards").fetchall()
            )
        finally:
            conn.close()

    def test_an_existing_new_root_is_never_overwritten(self) -> None:
        build_legacy_root(self.home.name)
        current = os.path.join(self.home.name, ".valkama")
        os.makedirs(current)
        with open(os.path.join(current, "valkama.sqlite3"), "wb") as handle:
            handle.write(b"already here")

        self.assertIsNone(store.adopt_legacy_store())
        with open(os.path.join(current, "valkama.sqlite3"), "rb") as handle:
            self.assertEqual(b"already here", handle.read())

    def test_an_explicit_database_path_is_left_alone(self) -> None:
        legacy = build_legacy_root(self.home.name)
        os.environ["VALKAMA_DB"] = os.path.join(self.home.name, "throwaway.sqlite3")
        self.addCleanup(os.environ.pop, "VALKAMA_DB", None)  # setUp's default again

        self.assertIsNone(store.adopt_legacy_store())
        self.assertTrue(os.path.isdir(legacy))

    def test_nothing_to_adopt_is_not_an_error(self) -> None:
        self.assertIsNone(store.adopt_legacy_store())

    def test_snapshots_are_named_for_the_current_product_and_stay_collectable(self) -> None:
        """Generation and retention must read the same prefix.

        They did not through the last rename: both were spelled `hub-`, so the
        adopted backups the move had just renamed stopped matching the retention
        pattern while new ones kept the previous product's name.
        """

        conn = store.connect()
        self.addCleanup(conn.close)
        backups = os.path.join(store.data_root(), "backups")

        made = [
            os.path.basename(store_backups.snapshot(conn, store._backups(), "preupgrade"))
            for _ in range(7)
        ]

        self.assertTrue(
            all(name.startswith(f"{store.DATA_PREFIX}-preupgrade-") for name in made), made
        )
        kept = sorted(name for name in os.listdir(backups) if name.endswith(".sqlite3"))
        self.assertEqual(5, len(kept), f"retention did not collect its own files: {kept}")

    def test_a_store_that_cannot_be_moved_refuses_loudly(self) -> None:
        """The failure mode this guards is an empty board that looks like data loss."""

        legacy = build_legacy_root(self.home.name)
        with mock.patch("os.rename", side_effect=OSError("used by another process")):
            with self.assertRaisesRegex(RuntimeError, "predates the rename"):
                store.adopt_legacy_store()
        self.assertTrue(os.path.isdir(legacy), "a refusal leaves the old store exactly as it was")
        self.assertFalse(os.path.exists(os.path.join(self.home.name, ".valkama")))

    def test_a_racing_adoption_loses_loudly_without_losing_or_half_moving_data(self) -> None:
        """`os.path.exists(current)` and `os.rename(legacy, current)` are not
        atomic together, and the migration lock is only acquired later, so two
        processes opening the store for the first time can both pass the
        exists check before either renames. This pins today's honest answer
        for the loser: a loud RuntimeError, its own legacy root left exactly
        as it was, and nothing half-moved -- not a silently empty board.
        """

        legacy = build_legacy_root(self.home.name)
        current = os.path.join(self.home.name, ".valkama")
        real_rename = os.rename

        def racing_rename(src: str, dst: str) -> None:
            # Simulate a second process winning the race in the gap between
            # this process's exists() check (already passed, above) and its
            # own rename call: the destination appears out from under it.
            os.makedirs(dst)
            real_rename(src, dst)

        with mock.patch("os.rename", side_effect=racing_rename):
            with self.assertRaisesRegex(RuntimeError, "predates the rename"):
                store.adopt_legacy_store()

        self.assertTrue(os.path.isdir(legacy), "the loser's legacy root is left untouched")
        self.assertTrue(os.path.isdir(current), "the winner's directory is not disturbed")
        self.assertFalse(
            os.path.exists(os.path.join(legacy, "MOVED-FROM.txt")),
            "a refused adoption records no move",
        )

    def test_future_legacy_store_refuses_before_any_adoption_mutation(self) -> None:
        legacy = build_legacy_root(self.home.name)
        database = os.path.join(legacy, "hub.sqlite3")
        conn = sqlite3.connect(database)
        conn.execute(f"PRAGMA user_version={store.STORE_SCHEMA_VERSION + 1}")
        conn.commit()
        conn.close()

        def snapshot(root: str) -> dict[str, bytes | None]:
            result = {}
            for directory, names, files in os.walk(root):
                for name in names:
                    result[os.path.relpath(os.path.join(directory, name), root)] = None
                for name in files:
                    path = os.path.join(directory, name)
                    with open(path, "rb") as handle:
                        result[os.path.relpath(path, root)] = handle.read()
            return result

        before = snapshot(legacy)
        with self.assertRaises(store.StoreTooNewError):
            store.adopt_legacy_store()
        self.assertEqual(before, snapshot(legacy))
        self.assertFalse(os.path.exists(os.path.join(self.home.name, ".valkama")))
        self.assertFalse(os.path.exists(os.path.join(legacy, "MOVED-FROM.txt")))


if __name__ == "__main__":
    unittest.main()


class StoreIsolationTests(unittest.TestCase):
    """A suite run must not be able to reach the owner's canonical store."""

    def test_the_suite_points_the_store_somewhere_disposable(self) -> None:
        configured = os.environ.get("VALKAMA_DB", "")
        self.assertTrue(configured, "importing tests must set VALKAMA_DB")
        canonical = os.path.join(os.path.expanduser("~"), ".valkama", "valkama.sqlite3")
        self.assertNotEqual(os.path.abspath(canonical).lower(), os.path.abspath(configured).lower())

    def test_a_board_era_store_refuses_to_convert_without_permission(self) -> None:
        """The gate this suite's own escape once proved necessary."""

        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "board.sqlite3")
            legacy = sqlite3.connect(path)
            try:
                legacy.executescript(
                    "CREATE TABLE boards(id INTEGER PRIMARY KEY, name TEXT NOT NULL);"
                    "CREATE TABLE cards(id INTEGER PRIMARY KEY, board_id INTEGER NOT NULL);"
                )
                legacy.commit()
            finally:
                legacy.close()
            self.assertFalse(store.cutover_permitted())
            with (
                mock.patch.dict(os.environ, {"VALKAMA_DB": path}, clear=False),
                mock.patch.dict(os.environ, {store.CUTOVER_ENV: ""}, clear=False),
                self.assertRaises(store.CutoverRequiredError) as refusal,
            ):
                store.connect()
            self.assertIn("valkama migrate planning-model", str(refusal.exception))


class LegacyMigrationPredicateTests(unittest.TestCase):
    """F13: the migration writer and its backup gate must not be able to disagree.

    `_migrate` and `_store_data_migration_needs_snapshot` now both derive their
    answer from `store._legacy_migration_status`, computed once. This drives a
    store through an actual pending shape -- one MIGRATIONS column, one event
    action and the improvement index all short of the last Board release --
    and checks that the shared predicate reports it, that the writer clears
    it, and that the backup gate agrees before and after. If a future change
    to MIGRATIONS, `_LEGACY_EVENT_ACTIONS` or the index name landed in only
    one of the two functions again, one of the assertions below would fail.
    """

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "legacy.sqlite3")

    def _pre_release_store(self) -> sqlite3.Connection:
        """`cards` missing `checklist`/`launch`, `events` missing most actions,
        and no improvement index -- older than the last Board-era release."""

        conn = sqlite3.connect(self.path)
        conn.executescript(
            "CREATE TABLE boards(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);"
            "CREATE TABLE cards(id INTEGER PRIMARY KEY,"
            " board_id INTEGER NOT NULL REFERENCES boards(id),"
            " title TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',"
            " parent_id INTEGER REFERENCES cards(id),"
            " claimed_by TEXT NOT NULL DEFAULT '',"
            " revision INTEGER NOT NULL DEFAULT 0,"
            " summary TEXT NOT NULL DEFAULT '');"
            "CREATE TABLE events(id INTEGER PRIMARY KEY,"
            " card_id INTEGER NOT NULL REFERENCES cards(id),"
            " author TEXT NOT NULL DEFAULT 'agent',"
            " action TEXT NOT NULL CHECK(action IN ('created','moved')),"
            " detail TEXT NOT NULL DEFAULT '',"
            " created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));"
            "INSERT INTO boards(name) VALUES ('Legacy');"
            "INSERT INTO cards(board_id, title) VALUES (1, 'One');"
        )
        conn.commit()
        return conn

    def test_pending_status_agrees_before_and_after_the_writer_runs(self) -> None:
        conn = self._pre_release_store()
        self.addCleanup(conn.close)

        before = store._legacy_migration_status(conn)
        self.assertTrue(before.any_pending)
        self.assertTrue(any("checklist" in statement for statement in before.pending_columns))
        self.assertTrue(any("launch" in statement for statement in before.pending_columns))
        self.assertTrue(before.event_actions_pending)
        self.assertTrue(before.index_pending)
        self.assertTrue(
            store._store_data_migration_needs_snapshot(conn),
            "a store with a real row and pending work must be backed up first",
        )

        store._migrate(conn)
        conn.commit()

        after = store._legacy_migration_status(conn)
        self.assertFalse(after.any_pending)
        self.assertFalse(
            store._store_data_migration_needs_snapshot(conn),
            "the writer's own predicate says nothing is pending anymore",
        )
