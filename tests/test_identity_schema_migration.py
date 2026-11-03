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
import re
import shutil
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from server import store, store_backups
from server.planning import service as planning
from server.planning import store as planning_store
from server.platform import migrations
from tests import schema9

#: Columns the step appends, by table.
ADDED_COLUMNS = {
    "work_items": {"claim_call_id"},
    "work_item_events": {"call_id"},
    "work_item_comments": {"call_id"},
    "work_item_refs": {"call_id"},
    "sessions": {"parent_session_id", "agent_id", "transcript_path", "client_version"},
}
EXECUTION_EVENT_COLUMNS = {
    "id",
    "event_uid",
    "kind",
    "identity_state",
    "identity_source",
    "delivery",
    "received_at",
    "occurred_at",
    "spooled_at",
    "client",
    "client_version",
    "hook_event",
    "tool",
    "session_id",
    "agent_id",
    "agent_type",
    "parent_session_id",
    "turn_id",
    "tool_use_id",
    "permission_mode",
    "model",
    "source",
    "reason",
    "cwd",
    "transcript_path",
    "archive_path",
    "archive_sha256",
    "work_item_id",
}
#: What schema 10 adds in the same open, so that the shapes below are exact.
SCHEMA10_COLUMNS = {
    "work_item_comments": {
        "reply_to",
        "reply_to_request",
        "resolved_at",
        "resolved_by",
        "resolution",
        "resolved_call_id",
    },
    "work_item_requests": {"answer_version"},
    "sessions": {"opened_in", "opened_host", "opened_folder", "host_session_id"},
}
SCHEMA10_TABLES = {"work_item_request_answers"}
ADDED_TRIGGERS = {
    "work_items_claim_follows_call",
    "execution_events_append_only_update",
    "execution_events_append_only_delete",
}
ADDED_INDEXES = {"execution_events_session", "sessions_parent"}


def _catalog(conn: sqlite3.Connection, kind: str) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'", (kind,)
        )
    }


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]


def _shape(conn: sqlite3.Connection) -> dict[str, set[str]]:
    return {table: set(_columns(conn, table)) for table in _catalog(conn, "table")}


def _values(conn: sqlite3.Connection, shape: dict[str, list[str]]) -> dict[str, list[tuple]]:
    """Every row of every table, read through the columns the source had."""

    return {
        table: [
            tuple(row)
            for row in conn.execute(f"SELECT {', '.join(columns)} FROM {table} ORDER BY rowid")
        ]
        for table, columns in sorted(shape.items())
    }


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in sorted(_catalog(conn, "table"))
    }


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

    def snapshots(self, label: str = "preschema10") -> list[Path]:
        return list((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def populated_source(self) -> None:
        schema9.build(self.path)
        conn = sqlite3.connect(self.path)
        try:
            schema9.populate(conn)
            conn.commit()
        finally:
            conn.close()

    def migrated(self, path: str) -> sqlite3.Connection:
        with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
            schema9.build(path)
            conn = store.connect()
        self.addCleanup(conn.close)
        return conn

    def test_a_schema_9_store_gains_identity_once_and_keeps_every_value(self) -> None:
        self.populated_source()
        source = sqlite3.connect(self.path)
        try:
            self.assertEqual(9, source.execute("PRAGMA user_version").fetchone()[0])
            shape = {table: _columns(source, table) for table in _catalog(source, "table")}
            self.assertNotIn("execution_events", shape)
            before = _values(source, shape)
            before_counts = _counts(source)
            identity = store_backups.logical_identity(source)
        finally:
            source.close()
        # The source holds rows in every table the step changes.
        for table in ADDED_COLUMNS:
            with self.subTest(table=table):
                self.assertTrue(before[table])

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(
            set(shape) | {"execution_events"} | SCHEMA10_TABLES, _catalog(conn, "table")
        )
        for table, columns in shape.items():
            with self.subTest(table=table):
                self.assertEqual(
                    set(columns)
                    | ADDED_COLUMNS.get(table, set())
                    | SCHEMA10_COLUMNS.get(table, set()),
                    set(_columns(conn, table)),
                )
        self.assertEqual(EXECUTION_EVENT_COLUMNS, set(_columns(conn, "execution_events")))
        self.assertEqual(before, _values(conn, shape))
        # What the new columns say about rows written before them: no call, and
        # nothing a session reported.
        for table, (column,) in (
            ("work_items", ("claim_call_id",)),
            ("work_item_events", ("call_id",)),
            ("work_item_comments", ("call_id",)),
            ("work_item_refs", ("call_id",)),
        ):
            with self.subTest(table=table):
                self.assertEqual(
                    [None],
                    [row[0] for row in conn.execute(f"SELECT DISTINCT {column} FROM {table}")],
                )
        self.assertEqual(
            [("", "", "", "")],
            [
                tuple(row)
                for row in conn.execute(
                    "SELECT DISTINCT parent_session_id, agent_id, transcript_path, client_version"
                    " FROM sessions"
                )
            ],
        )
        self.assertEqual(0, conn.execute("SELECT COUNT(*) FROM execution_events").fetchone()[0])
        self.assertLessEqual(ADDED_TRIGGERS, _catalog(conn, "trigger"))
        self.assertLessEqual(ADDED_INDEXES, _catalog(conn, "index"))
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual([], conn.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual("Held with its history", planning.get_work_item(conn, "KEEP-1")["title"])

        # One recovery point, taken before the first write and holding the source.
        snapshots = self.snapshots()
        self.assertEqual(1, len(snapshots))
        backup = sqlite3.connect(f"file:{snapshots[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual("ok", backup.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual(9, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(before_counts, _counts(backup))
        self.assertEqual(identity, store_backups.logical_identity(backup))

        # A second open writes nothing and takes no copy.
        conn.close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual(1, len(self.snapshots()))

    def test_a_fresh_store_has_the_shape_a_migrated_one_reaches(self) -> None:
        fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assertEqual([], self.snapshots())
        migrated = self.migrated(str(self.root / "migrated.sqlite3"))
        self.assertEqual(_shape(migrated), _shape(fresh))
        self.assertEqual(_catalog(migrated, "index"), _catalog(fresh, "index"))
        self.assertEqual(_catalog(migrated, "trigger"), _catalog(fresh, "trigger"))
        self.assertLessEqual(ADDED_TRIGGERS, _catalog(fresh, "trigger"))
        self.assertLessEqual(ADDED_INDEXES, _catalog(fresh, "index"))
        self.assertEqual(EXECUTION_EVENT_COLUMNS, set(_columns(fresh, "execution_events")))
        for table, added in ADDED_COLUMNS.items():
            with self.subTest(table=table):
                self.assertTrue(added <= set(_columns(fresh, table)))

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

    def test_writes_in_the_columns_a_build_before_the_step_named_still_land(self) -> None:
        # Fresh and migrated. Since schema 10 such a build refuses either store
        # on its stamp; what is still held is that the step is additive: that
        # build's whole catalog, run guarded, writes nothing, and its inserts,
        # which name none of the new columns, land.
        stores = {
            "fresh": store.connect(),
            "migrated": self.migrated(str(self.root / "migrated.sqlite3")),
        }
        stores["fresh"].close()
        stores["migrated"].close()
        for name, path in (("fresh", self.path), ("migrated", str(self.root / "migrated.sqlite3"))):
            with self.subTest(store=name):
                conn = sqlite3.connect(path)
                conn.row_factory = sqlite3.Row
                self.addCleanup(conn.close)
                conn.execute("PRAGMA foreign_keys=ON")
                observer = sqlite3.connect(path)
                self.addCleanup(observer.close)
                written = observer.execute("PRAGMA data_version").fetchone()[0]
                # That build's bring-up: its whole schema, every statement guarded
                # the way its own script guards them.
                for _, statement in schema9.statements():
                    conn.execute(
                        re.sub(
                            r"^CREATE (UNIQUE )?(TABLE|INDEX|TRIGGER) ",
                            r"CREATE \1\2 IF NOT EXISTS ",
                            statement,
                        )
                    )
                migrations.assert_product_model_postconditions(conn)
                conn.commit()
                self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
                # And its writes, in the columns it names.
                space = planning_store.create_space(conn, project_id="old", name="Old", key="OLD")
                workflow = planning_store.workflow_for_space(conn, space["planning_space_id"])
                state = planning_store.states_for_workflow(conn, str(workflow["workflow_id"]))[0]
                conn.execute(
                    "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,"
                    "state_id,title,position) VALUES('old-item',?,1,?,?,'Old',1.0)",
                    (space["planning_space_id"], workflow["workflow_id"], state["state_id"]),
                )
                conn.execute(
                    "INSERT INTO work_item_events(work_item_id,action,detail,author)"
                    " VALUES('old-item','claimed','','old')"
                )
                conn.execute(
                    "INSERT INTO work_item_comments(work_item_id,author,body,checklist_item_id,"
                    "checklist_item_text) VALUES('old-item','old','still lands',NULL,NULL)"
                )
                conn.execute(
                    "INSERT OR IGNORE INTO work_item_refs(work_item_id,kind,value,label,author)"
                    " VALUES('old-item','commit','abc1234','','old')"
                )
                conn.execute(
                    "INSERT INTO sessions(id, client, cwd, label) VALUES ('old-session','codex','','')"
                )
                migrations.assert_product_model_postconditions(conn)
                conn.commit()
                self.assertEqual(
                    store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
                )
                self.assertEqual(
                    ("", "", "", ""),
                    tuple(
                        conn.execute(
                            "SELECT parent_session_id, agent_id, transcript_path, client_version"
                            " FROM sessions WHERE id='old-session'"
                        ).fetchone()
                    ),
                )

    def test_a_failed_attempt_leaves_the_store_as_it_was_and_the_retry_reuses_its_copy(
        self,
    ) -> None:
        self.populated_source()
        source = sqlite3.connect(self.path)
        identity = store_backups.logical_identity(source)
        source.close()
        original = planning_store.migrate_identity

        def fail_after_adding(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected after the identity columns")

        with mock.patch.object(planning_store, "migrate_identity", side_effect=fail_after_adding):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(identity, store_backups.logical_identity(raw))
            self.assertNotIn("execution_events", _catalog(raw, "table"))
        finally:
            raw.close()
        self.assertEqual(1, len(self.snapshots()))

        # The recovery point restores to the source, and the retry reuses it.
        restored = str(self.root / "restored.sqlite3")
        shutil.copyfile(self.snapshots()[0], restored)
        raw = sqlite3.connect(restored)
        try:
            self.assertEqual(identity, store_backups.logical_identity(raw))
        finally:
            raw.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertIn("execution_events", _catalog(conn, "table"))
        self.assertEqual(1, len(self.snapshots()))

    def test_a_snapshot_cut_short_is_set_aside_and_a_fresh_one_taken(self) -> None:
        """A process killed during `VACUUM INTO` leaves half a snapshot under a reusable name."""

        self.populated_source()
        source = sqlite3.connect(self.path)
        try:
            identity = store_backups.logical_identity(source)
            whole = store_backups.snapshot(source, store._backups(), "preschema10")
        finally:
            source.close()
        data = Path(whole).read_bytes()
        Path(whole).write_bytes(data[: len(data) // 2])
        cut = Path(whole).read_bytes()

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertIn("execution_events", _catalog(conn, "table"))
        [fresh] = self.snapshots()
        self.assertNotEqual(Path(whole), fresh)
        self.assertEqual(identity, store_backups.snapshot_identity(str(fresh)))
        # Set aside under a name no reuse or retention matches, byte for byte.
        [aside] = list((self.root / "backups").glob("*.unverified"))
        self.assertEqual(Path(whole).name, aside.name.removesuffix(".unverified"))
        self.assertEqual(cut, aside.read_bytes())


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
