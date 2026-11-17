"""One record per `relates-to` link: the migration that merges the ones stored twice.

Earlier builds looked for an existing link only in the direction they were asked
for, so a relation linked from both ends lay as two records, and each card listed
it twice. What this suite holds the migration to: the later record of each such
pair goes and the earlier one stays with its id, direction and time -- by
`created_at`, then by `id` when two share a second -- under a verified recovery
point of its own (`prerelatesonce`) in a store already at this schema, and under
the upgrade's in an older one; every other kind keeps both directions; the store
then refuses a mirror; a second open neither deletes nor snapshots; a failed
attempt leaves the store as it was, and the recovery point brings it back and the
migration runs again. The pairs are written here as the earlier builds wrote them,
with plain SQL, rather than through the service under test.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.planning import store as planning_store
from tests import schema9

#: Items of the source store, numbered as `populate` gives them.
A, B, C, D = (f"{n}{n}{n}{n}{n}{n}{n}{n}-0000-4000-8000-00000000000{n}" for n in range(3, 7))
LABEL = "prerelatesonce"


def _links(conn: sqlite3.Connection) -> list[tuple]:
    return [
        tuple(row)
        for row in conn.execute(
            "SELECT id, from_id, to_id, kind, created_at FROM work_item_links ORDER BY id"
        )
    ]


def _populate(conn: sqlite3.Connection) -> dict[str, list[tuple]]:
    """Items and links as the earlier builds stored them; answers the links by fate.

    `schema9.populate` writes the space, two items and a `blocks` link between
    them; four more items carry the pairs. The caller commits.
    """

    schema9.populate(conn)
    # In the state of the waiting item: one at work stands accepted, on a basis.
    space, workflow, state = conn.execute(
        "SELECT planning_space_id, workflow_id, state_id FROM work_items WHERE number = 2"
    ).fetchone()
    # An earlier build's table holds the place a person set by hand; this one's not.
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(work_items)")}
    placed, place = (",position", ",?") if "position" in columns else ("", "")
    for number, identity in enumerate((A, B, C, D), start=3):
        conn.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            f"title,created_at,updated_at{placed}) VALUES(?,?,?,?,?,?,?,?{place})",
            (
                identity,
                space,
                number,
                workflow,
                state,
                f"Item {number}",
                schema9.CREATED_AT,
                schema9.CREATED_AT,
                *([float(number)] if place else []),
            ),
        )
    conn.execute("UPDATE planning_spaces SET next_number=7")
    rows = (
        # A pair written a day apart, the later one first by id: time decides.
        (101, B, A, "relates-to", "2026-10-02T00:00:00Z"),
        (102, A, B, "relates-to", "2026-10-01T00:00:00Z"),
        # A pair written in one second: the lower id decides.
        (103, C, D, "relates-to", "2026-10-03T00:00:00Z"),
        (104, D, C, "relates-to", "2026-10-03T00:00:00Z"),
        # One record, no mirror.
        (105, A, C, "relates-to", "2026-10-04T00:00:00Z"),
        # The directed kinds keep both directions.
        (106, A, D, "blocks", "2026-10-05T00:00:00Z"),
        (107, D, A, "blocks", "2026-10-05T00:00:00Z"),
        (108, B, C, "discovered-from", "2026-10-06T00:00:00Z"),
        (109, C, B, "discovered-from", "2026-10-06T00:00:00Z"),
        (110, B, D, "duplicates", "2026-10-07T00:00:00Z"),
        (111, D, B, "duplicates", "2026-10-07T00:00:00Z"),
    )
    conn.executemany(
        "INSERT INTO work_item_links(id,from_id,to_id,kind,created_at) VALUES(?,?,?,?,?)", rows
    )
    before = _links(conn)
    gone = {101, 104}
    return {
        "before": before,
        "kept": [row for row in before if row[0] not in gone],
        "gone": [row for row in before if row[0] in gone],
    }


class RelatesOnceMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def snapshots(self, label: str = LABEL) -> list[Path]:
        return list((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def current_source(self) -> tuple[dict[str, list[tuple]], tuple]:
        """A store at this schema as the build before this change left it.

        That build declared everything this one does except the index, so the
        index is dropped from a store this build made; the links are the rows
        the earlier build wrote.
        """

        conn = store.connect()
        try:
            conn.execute(f"DROP INDEX {planning_store.SYMMETRIC_ONCE_INDEX}")
            links = _populate(conn)
            conn.commit()
            return links, store_backups.logical_identity(conn)
        finally:
            conn.close()

    def assert_merged(self, conn: sqlite3.Connection, links: dict[str, list[tuple]]) -> None:
        self.assertEqual(links["kept"], _links(conn))
        self.assertEqual(len(links["before"]) - 2, len(_links(conn)))
        self.assertFalse(planning_store.symmetric_mirrors_present(conn))
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO work_item_links(from_id,to_id,kind) VALUES(?,?,'relates-to')", (B, A)
            )

    def test_a_store_at_this_schema_merges_its_pairs_under_its_own_recovery_point(self) -> None:
        links, identity = self.current_source()
        conn = store.connect()
        try:
            self.assertEqual(
                store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
            )
            self.assert_merged(conn, links)
            self.assertEqual(1, len(self.snapshots()))
            self.assertEqual(identity, store_backups.snapshot_identity(str(self.snapshots()[0])))
        finally:
            conn.close()
        again = store.connect()
        try:
            self.assertEqual(links["kept"], _links(again))
            self.assertEqual(1, len(self.snapshots()))
        finally:
            again.close()

    def test_a_failed_merge_leaves_the_store_and_the_recovery_point_replays_it(self) -> None:
        links, identity = self.current_source()
        original = planning_store.migrate_symmetric_links

        def fail_after_merge(conn: sqlite3.Connection) -> int:
            original(conn)
            raise RuntimeError("injected migration failure")

        with mock.patch.object(
            planning_store, "migrate_symmetric_links", side_effect=fail_after_merge
        ):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(identity, store_backups.logical_identity(raw))
            self.assertEqual(links["before"], _links(raw))
        finally:
            raw.close()
        self.assertEqual(1, len(self.snapshots()))
        restored = str(self.root / "restored.sqlite3")
        shutil.copyfile(self.snapshots()[0], restored)
        with mock.patch.dict(os.environ, {"VALKAMA_DB": restored}):
            replayed = store.connect()
            try:
                self.assert_merged(replayed, links)
                store_backups.integrity_check(replayed, source="restored migration")
            finally:
                replayed.close()

    def test_a_mirror_written_after_the_snapshot_decision_is_refused(self) -> None:
        """The read that decides on a recovery point and the delete are not one moment."""

        links, identity = self.current_source()
        with mock.patch.object(
            planning_store, "symmetric_mirrors_present", side_effect=[False, True]
        ):
            with self.assertRaisesRegex(RuntimeError, "pre-mutation snapshot"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(identity, store_backups.logical_identity(raw))
        finally:
            raw.close()
        self.assertEqual([], self.snapshots())
        conn = store.connect()
        try:
            self.assert_merged(conn, links)
        finally:
            conn.close()

    def test_a_store_without_pairs_gains_the_index_and_no_snapshot(self) -> None:
        conn = store.connect()
        try:
            conn.execute(f"DROP INDEX {planning_store.SYMMETRIC_ONCE_INDEX}")
            conn.commit()
        finally:
            conn.close()
        conn = store.connect()
        try:
            self.assertIsNotNone(
                conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
                    (planning_store.SYMMETRIC_ONCE_INDEX,),
                ).fetchone()
            )
        finally:
            conn.close()
        self.assertEqual([], self.snapshots())


if __name__ == "__main__":
    unittest.main()
