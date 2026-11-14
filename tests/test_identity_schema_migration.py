"""Session identity arrived in schema 9 as one additive step.

The source is a store built from the catalog the last build before this step
created, populated as that build wrote it. What this suite holds the step to:
every existing value stays, the new columns and table arrive once, a second open
writes nothing, a fresh store has the same shape directly, and writes in the
columns the earlier build named still land. The new names are stated here
rather than read from the code under test.

Such a store is stamped 9, so since schema 10 the same open also takes schema
10's steps, and its one recovery point is the one labelled for them,
`preschema10`; the step's own `preidentity` point is taken only by a store
already at the current stamp that lacks it.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.planning import service as planning


def _call(conn: sqlite3.Connection, **fields: object) -> int:
    """One write-call row, the shape Planning writes link to."""

    values = {
        "event_uid": uuid.uuid4().hex,
        "kind": "planning_write",
        "identity_state": "confirmed",
        "identity_source": "codex-meta",
        **fields,
    }
    cursor = conn.execute(
        f"INSERT INTO execution_events({','.join(values)}) VALUES({','.join('?' for _ in values)})",
        tuple(values.values()),
    )
    return int(cursor.lastrowid or 0)


class IdentitySchemaMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_claim_written_without_naming_its_call_loses_the_link(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        planning.create_planning_space(conn, project_id="lease", name="Lease", key="LEASE")
        item = planning.create_work_item(conn, space="LEASE", title="Held")
        identity = item["work_item_id"]

        def link() -> object:
            return conn.execute(
                "SELECT claim_call_id FROM work_items WHERE work_item_id=?", (identity,)
            ).fetchone()[0]

        def claim(holder: str, call: int | None) -> None:
            # How a lease-aware write sets a holder: the call in the same UPDATE.
            conn.execute(
                "UPDATE work_items SET claim_ref=?, claim_call_id=?, revision=revision+1"
                " WHERE work_item_id=?",
                (holder, call, identity),
            )

        def unaware(holder: str) -> int:
            # How a build from before session identity writes a claim, word for word.
            revision = conn.execute(
                "SELECT revision FROM work_items WHERE work_item_id=?", (identity,)
            ).fetchone()[0]
            return conn.execute(
                "UPDATE work_items SET claim_ref = ?, revision = revision + 1, updated_at ="
                " (strftime('%Y-%m-%dT%H:%M:%SZ','now')) WHERE work_item_id = ? AND revision = ?",
                (holder, identity, revision),
            ).rowcount

        first = _call(conn, session_id="session-a", work_item_id=identity)
        claim("agent", first)
        self.assertEqual(first, link())
        # A write that does not touch the holder leaves the link alone.
        conn.execute("UPDATE work_items SET title='Still held' WHERE work_item_id=?", (identity,))
        self.assertEqual(first, link())
        # The same holder text, taken again by another call: the new call stands.
        second = _call(conn, session_id="session-b", work_item_id=identity)
        claim("agent", second)
        self.assertEqual(second, link())

        # Taken over by a writer that never names a call: the claim it made is
        # not the session's, and the store says so. Its guarded write still
        # reports exactly one row, so its compare-and-set is unaffected.
        self.assertEqual(1, unaware("someone-else"))
        self.assertIsNone(link())

        # Rewriting the same holder text counts as well: it was still that
        # writer's claim, not the call's.
        claim("agent", _call(conn, session_id="session-c", work_item_id=identity))
        self.assertEqual(1, unaware("agent"))
        self.assertIsNone(link())

        # A release clears the link itself, and an unaware release of an
        # unlinked claim changes nothing either.
        claim("agent", _call(conn, session_id="session-d", work_item_id=identity))
        claim("", None)
        self.assertIsNone(link())
        self.assertEqual(1, unaware(""))
        self.assertIsNone(link())

    def test_execution_events_are_appended_to_and_outlive_the_item_they_name(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        planning.create_planning_space(conn, project_id="tree", name="Tree", key="TREE")
        item = planning.create_work_item(conn, space="TREE", title="Deleted later")
        call = _call(conn, session_id="session-a", work_item_id=item["work_item_id"])
        conn.commit()
        before = conn.execute("SELECT * FROM execution_events").fetchall()
        with self.assertRaisesRegex(sqlite3.DatabaseError, "append-only"):
            conn.execute("UPDATE execution_events SET kind='edited' WHERE id=?", (call,))
        with self.assertRaisesRegex(sqlite3.DatabaseError, "append-only"):
            conn.execute("DELETE FROM execution_events WHERE id=?", (call,))
        conn.rollback()
        self.assertEqual(
            [tuple(row) for row in before],
            [tuple(row) for row in conn.execute("SELECT * FROM execution_events")],
        )
        # Nothing in the tree points at the work it names, so deleting that work
        # leaves the history as it was.
        planning.delete_work_item(conn, item["reference"])
        conn.commit()
        self.assertEqual(
            [tuple(row) for row in before],
            [tuple(row) for row in conn.execute("SELECT * FROM execution_events")],
        )


class VerifiedSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.location = store_backups.BackupLocation(str(self.root / "backups"), "valkama")
        self.conn = sqlite3.connect(self.root / "source.sqlite3")
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE kept(value TEXT)")
        self.conn.execute("INSERT INTO kept VALUES ('one')")
        self.conn.commit()

    def reusable(self, name: str, data: bytes) -> Path:
        path = self.root / "backups" / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(data)
        return path

    def test_an_unreadable_reusable_snapshot_is_renamed_never_deleted(self) -> None:
        bad = self.reusable("valkama-label-20261031T000000Z-abcdef.sqlite3", b"not a database")
        path, identity = store_backups.verified_snapshot(
            self.conn, "label", locate=lambda: self.location
        )
        self.assertNotEqual(str(bad), path)
        self.assertEqual(store_backups.logical_identity(self.conn), identity)
        self.assertFalse(bad.exists())
        self.assertEqual(b"not a database", Path(f"{bad}.unverified").read_bytes())

    def test_a_readable_snapshot_of_another_state_stays_under_its_label(self) -> None:
        older = self.root / "backups"
        older.mkdir()
        earlier = store_backups.snapshot(self.conn, self.location, "label")
        self.conn.execute("INSERT INTO kept VALUES ('two')")
        self.conn.commit()
        path, _ = store_backups.verified_snapshot(self.conn, "label", locate=lambda: self.location)
        self.assertNotEqual(earlier, path)
        self.assertTrue(Path(earlier).exists())
        self.assertEqual([], list(older.glob("*.unverified")))


if __name__ == "__main__":
    unittest.main()
