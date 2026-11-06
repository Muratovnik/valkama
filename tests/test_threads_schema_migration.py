"""Schema 9 to 10: threads, the resolve mark, answer versions and where a session was opened.

The source is a store built from the catalog the last schema-9 build created,
populated as that build wrote it. What this suite holds the migration to: every
existing value stays, the new columns, table, trigger and indexes arrive once
under one recovery point labelled `preschema10`, a second open writes nothing, a
fresh store has the same catalog directly, a store at 8 still takes `preschema9`,
and a schema-9 build refuses the result. The new names are stated here rather
than read from the code under test.
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
from tests import schema8, schema9

#: Columns schema 10 appends, by table, in the order they are appended.
ADDED_COLUMNS = {
    "work_item_comments": [
        "reply_to",
        "reply_to_request",
        "resolved_at",
        "resolved_by",
        "resolution",
        "resolved_call_id",
    ],
    # Schema 12 appends the last one: the chain runs on to this build's own schema.
    "work_item_requests": ["answer_version", "comment_id"],
    "sessions": ["opened_in", "opened_host", "opened_folder", "host_session_id"],
}
#: Schema 11's and 12's tables are the rest of the chain to this build's own schema.
ADDED_TABLES = {
    "work_item_request_answers",
    "owner_alert_settings",
    "usage_runs",
    "usage_segments",
    "usage_requests",
    "pinned_work_items",
    "work_item_subscriptions",
}
ANSWER_COLUMNS = ["request_id", "version", "answers_json", "answered_by", "answered_at", "call_id"]
ADDED_INDEXES = {
    "work_item_comments_reply_to",
    "work_item_comments_reply_to_request",
    "work_item_comments_unresolved",
}
ADDED_TRIGGERS = {
    "work_item_comments_thread_shape_insert",
    "work_item_comments_thread_shape_update",
}
ADDED_ACTIONS = {"comment_resolved", "comment_reopened", "request_changed"}

HELD = "11111111-1111-4111-8111-111111111111"
CREATED_AT = "2026-11-02T00:00:00Z"
ANSWER = '{"path":"keep","_note":"Kept as answered"}'


def _catalog(conn: sqlite3.Connection, kind: str) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'", (kind,)
        )
    }


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]


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


def _sql(text: str) -> str:
    """A definition as SQLite keeps it, with the spelling differences of its history removed.

    A table rebuilt and renamed comes back with its name quoted, and a script
    statement keeps `IF NOT EXISTS` only until SQLite stores it.
    """

    text = re.sub(r"\s+", " ", text.replace('"', "")).strip()
    return text.replace(" IF NOT EXISTS ", " ")


def _event_actions(conn: sqlite3.Connection) -> set[str]:
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='work_item_events'").fetchone()[0]
    found = re.search(r"CHECK\s*\(\s*action\s+IN\s*\(([^)]*)\)", sql, flags=re.IGNORECASE)
    assert found is not None
    return set(re.findall(r"'([^']+)'", found.group(1)))


def _shape(conn: sqlite3.Connection) -> dict[str, object]:
    """The catalog a reader of the store depends on, in the order columns stand.

    A table's definition text records how it got there -- appended columns read
    differently from declared ones -- so a table is compared by what SQLite
    reports of it: its columns in order with their type, nullability, default and
    key position, and its foreign keys. Indexes and triggers are created from one
    text on every path and compare as text.
    """

    tables = {
        table: (
            [tuple(row)[1:] for row in conn.execute(f"PRAGMA table_xinfo({table})")],
            [tuple(row)[2:] for row in conn.execute(f"PRAGMA foreign_key_list({table})")],
        )
        for table in sorted(_catalog(conn, "table"))
    }
    definitions = {
        kind: {
            str(row[0]): (str(row[1]), _sql(str(row[2])))
            for row in conn.execute(
                "SELECT name, tbl_name, sql FROM sqlite_master"
                " WHERE type=? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
                (kind,),
            )
        }
        for kind in ("index", "trigger")
    }
    return {"tables": tables, "events": _event_actions(conn), **definitions}


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


def populate(conn: sqlite3.Connection) -> None:
    """What the last schema-9 build left in a store this migration touches.

    `schema9.populate` writes work, history, a comment, a pending question, a
    session and an execution; on top of them a write call, a comment and a report
    linked to it, an answered question and a declined one, written as plain SQL
    in the columns that build named.
    """

    schema9.populate(conn)
    call = _call(conn, session_id="kept-session", work_item_id=HELD, tool="comment_work_item")
    conn.execute(
        "INSERT INTO work_item_comments(work_item_id,author,body,checklist_item_id,"
        "checklist_item_text,created_at,call_id) VALUES(?,'kept-agent','With its call',"
        "'step-1','Step one',?,?)",
        (HELD, CREATED_AT, call),
    )
    conn.execute(
        "INSERT INTO work_item_comments(work_item_id,author,body,report,created_at,call_id)"
        " VALUES(?,'kept-agent','',?,?,?)",
        (HELD, '{"done":"Kept","next":"Nothing"}', CREATED_AT, call),
    )
    for request, status, answers, by in (
        ("answered-request", "answered", ANSWER, "the-owner"),
        ("declined-request", "declined", None, "the-owner"),
    ):
        conn.execute(
            "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,"
            "answers_json,status,author,answered_by,created_at,resolved_at,revision)"
            " VALUES(?,?,'question','Kept?','[]',?,?,'kept-agent',?,?,?,1)",
            (request, HELD, answers, status, by, CREATED_AT, CREATED_AT),
        )
    conn.execute(
        "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at,call_id)"
        " VALUES(?,'request_answered','answered-request','the-owner',?,?)",
        (HELD, CREATED_AT, call),
    )


class ThreadsSchemaMigrationTests(unittest.TestCase):
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

    def populated_source(self, path: str | None = None) -> None:
        path = path or self.path
        schema9.build(path, fixture=schema9.LAST)
        conn = sqlite3.connect(path)
        try:
            populate(conn)
            conn.commit()
        finally:
            conn.close()

    def source_state(self) -> tuple[dict[str, list[str]], dict, dict, object]:
        source = sqlite3.connect(self.path)
        try:
            self.assertEqual(9, source.execute("PRAGMA user_version").fetchone()[0])
            shape = {table: _columns(source, table) for table in _catalog(source, "table")}
            return (
                shape,
                _values(source, shape),
                _counts(source),
                store_backups.logical_identity(source),
            )
        finally:
            source.close()

    def open_at(self, path: str) -> sqlite3.Connection:
        with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
            conn = store.connect()
        self.addCleanup(conn.close)
        return conn

    def test_a_schema_9_store_reaches_10_and_keeps_every_value(self) -> None:
        self.populated_source()
        shape, before, _, _ = self.source_state()
        # The source holds rows in every table the migration changes.
        for table in ADDED_COLUMNS:
            with self.subTest(table=table):
                self.assertTrue(before[table])
        self.assertTrue(ADDED_TABLES.isdisjoint(shape))

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(set(shape) | ADDED_TABLES, _catalog(conn, "table"))
        for table, columns in shape.items():
            with self.subTest(table=table):
                self.assertEqual(columns + ADDED_COLUMNS.get(table, []), _columns(conn, table))
        self.assertEqual(ANSWER_COLUMNS, _columns(conn, "work_item_request_answers"))
        self.assertEqual(before, _values(conn, shape))

        # What the new columns say about rows written before them: every comment
        # is a root with no mark, an answered question is at its first answer,
        # and nothing is known about where a session was opened.
        self.assertEqual(
            [(None, None, None, "", "", None)],
            [
                tuple(row)
                for row in conn.execute(
                    "SELECT DISTINCT reply_to, reply_to_request, resolved_at, resolved_by,"
                    " resolution, resolved_call_id FROM work_item_comments"
                )
            ],
        )
        self.assertEqual(
            {"answered-request": 1, "declined-request": 0, "kept-request": 0},
            dict(conn.execute("SELECT request_id, answer_version FROM work_item_requests")),
        )
        self.assertEqual(
            [("", "", "", "")],
            [
                tuple(row)
                for row in conn.execute(
                    "SELECT DISTINCT opened_in, opened_host, opened_folder, host_session_id"
                    " FROM sessions"
                )
            ],
        )
        self.assertEqual(
            0, conn.execute("SELECT COUNT(*) FROM work_item_request_answers").fetchone()[0]
        )
        self.assertLessEqual(ADDED_INDEXES, _catalog(conn, "index"))
        self.assertLessEqual(ADDED_TRIGGERS, _catalog(conn, "trigger"))
        self.assertLessEqual(ADDED_ACTIONS, _event_actions(conn))
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual([], conn.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual("Held with its history", planning.get_work_item(conn, "KEEP-1")["title"])

    def test_one_recovery_point_labelled_preschema10_holds_the_source(self) -> None:
        self.populated_source()
        _, _, before_counts, identity = self.source_state()
        store.connect().close()

        snapshots = self.snapshots()
        self.assertEqual(1, len(snapshots))
        for label in ("preschema9", "preproductmodel", "preidentity", "preinteractions"):
            with self.subTest(label=label):
                self.assertEqual([], self.snapshots(label))
        backup = sqlite3.connect(f"file:{snapshots[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual("ok", backup.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual(9, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(before_counts, _counts(backup))
        self.assertEqual(identity, store_backups.logical_identity(backup))

    def test_a_second_open_writes_nothing_and_takes_no_copy(self) -> None:
        self.populated_source()
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        with mock.patch.object(
            store_backups, "integrity_check", wraps=store_backups.integrity_check
        ) as check:
            store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual([], check.call_args_list)
        self.assertEqual(1, len(self.snapshots()))

    def test_the_recovery_point_restores_9_and_replays_the_migration_once(self) -> None:
        self.populated_source()
        shape, before, _, identity = self.source_state()
        store.connect().close()

        restored = str(self.root / "restored.sqlite3")
        shutil.copyfile(self.snapshots()[0], restored)
        raw = sqlite3.connect(restored)
        try:
            self.assertEqual(9, raw.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(identity, store_backups.logical_identity(raw))
            self.assertTrue(ADDED_TABLES.isdisjoint(_catalog(raw, "table")))
        finally:
            raw.close()
        replayed = self.open_at(restored)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, replayed.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(before, _values(replayed, shape))
        self.assertEqual(
            1,
            replayed.execute(
                "SELECT answer_version FROM work_item_requests WHERE request_id='answered-request'"
            ).fetchone()[0],
        )
        # The restored store is the snapshot's own source, so the replay reuses
        # that recovery point instead of stacking a second copy of it.
        self.assertEqual(1, len(self.snapshots()))

    def test_a_failed_attempt_leaves_the_store_at_9_and_the_retry_reuses_its_copy(self) -> None:
        self.populated_source()
        _, _, _, identity = self.source_state()
        original = planning_store.migrate_threads

        def fail_after_threads(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected after the thread columns")

        with mock.patch.object(planning_store, "migrate_threads", side_effect=fail_after_threads):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(9, raw.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(identity, store_backups.logical_identity(raw))
            self.assertNotIn("reply_to", _columns(raw, "work_item_comments"))
        finally:
            raw.close()
        self.assertEqual(1, len(self.snapshots()))
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(1, len(self.snapshots()))

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assertEqual([], self.snapshots())
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, fresh.execute("PRAGMA user_version").fetchone()[0]
        )
        last = str(self.root / "last.sqlite3")
        self.populated_source(last)
        # The store an earlier schema-9 build left, before session identity,
        # reaches the same catalog through both additive steps in one open.
        earlier = str(self.root / "earlier.sqlite3")
        schema9.build(earlier)
        expected = _shape(fresh)
        for name, path in (("last", last), ("before identity", earlier)):
            with self.subTest(source=name):
                self.assertEqual(expected, _shape(self.open_at(path)))
        self.assertLessEqual(ADDED_TABLES, _catalog(fresh, "table"))
        self.assertLessEqual(ADDED_INDEXES, _catalog(fresh, "index"))
        self.assertLessEqual(ADDED_TRIGGERS, _catalog(fresh, "trigger"))
        self.assertLessEqual(ADDED_ACTIONS, _event_actions(fresh))
        for table, added in ADDED_COLUMNS.items():
            with self.subTest(table=table):
                self.assertEqual(added, _columns(fresh, table)[-len(added) :])

    def test_a_store_from_before_schema_9_takes_its_own_label_once(self) -> None:
        schema8.build(self.path)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(1, len(self.snapshots("preschema9")))
        self.assertEqual([], self.snapshots())
        backup = sqlite3.connect(f"file:{self.snapshots('preschema9')[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(8, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertLessEqual(ADDED_TABLES, _catalog(conn, "table"))

    def test_a_schema_9_build_refuses_the_migrated_store_before_writing(self) -> None:
        self.populated_source()
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 9):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual(
            (store.STORE_SCHEMA_VERSION, 9), (refusal.exception.stored, refusal.exception.supported)
        )
        self.assertEqual(before, Path(self.path).read_bytes())


class ThreadShapeTests(unittest.TestCase):
    """The store, not only the service, keeps a thread one level deep and on one item."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        planning.create_planning_space(self.conn, project_id="shape", name="Shape", key="SHAPE")
        self.item = planning.create_work_item(self.conn, space="SHAPE", title="Here")[
            "work_item_id"
        ]
        self.other = planning.create_work_item(self.conn, space="SHAPE", title="There")[
            "work_item_id"
        ]
        self.root = self.comment(self.item)
        self.request = self.ask(self.item, "here-request")
        self.conn.commit()

    def comment(self, item: str, **parent: object) -> int:
        columns = ["work_item_id", "author", "body", *parent]
        cursor = self.conn.execute(
            f"INSERT INTO work_item_comments({','.join(columns)})"
            f" VALUES({','.join('?' for _ in columns)})",
            (item, "agent", "words", *parent.values()),
        )
        return int(cursor.lastrowid or 0)

    def ask(self, item: str, request: str) -> str:
        self.conn.execute(
            "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,"
            "author,created_at) VALUES(?,?,'question','Which?','[]','agent',?)",
            (request, item, CREATED_AT),
        )
        return request

    def refused(self, message: str, statement: str, parameters: tuple = ()) -> None:
        with self.assertRaisesRegex(sqlite3.IntegrityError, message):
            self.conn.execute(statement, parameters)

    def test_a_reply_to_a_root_comment_or_a_question_lands(self) -> None:
        under_comment = self.comment(self.item, reply_to=self.root)
        under_question = self.comment(self.item, reply_to_request=self.request)
        self.conn.execute(
            "UPDATE work_item_comments SET resolved_at=?, resolved_by='owner', resolution='done'"
            " WHERE id=?",
            (CREATED_AT, self.root),
        )
        self.conn.commit()
        self.assertEqual(
            {under_comment: (self.root, None), under_question: (None, self.request)},
            {
                row[0]: (row[1], row[2])
                for row in self.conn.execute(
                    "SELECT id, reply_to, reply_to_request FROM work_item_comments"
                    " WHERE id IN (?,?)",
                    (under_comment, under_question),
                )
            },
        )

    def test_a_reply_names_one_parent(self) -> None:
        self.refused(
            "one parent",
            "INSERT INTO work_item_comments(work_item_id,body,reply_to,reply_to_request)"
            " VALUES(?,'both',?,?)",
            (self.item, self.root, self.request),
        )
        reply = self.comment(self.item, reply_to=self.root)
        self.refused(
            "one parent",
            "UPDATE work_item_comments SET reply_to_request=? WHERE id=?",
            (self.request, reply),
        )

    def test_a_reply_cannot_answer_a_reply(self) -> None:
        reply = self.comment(self.item, reply_to=self.root)
        under_question = self.comment(self.item, reply_to_request=self.request)
        for parent in (reply, under_question):
            with self.subTest(parent=parent):
                self.refused(
                    "not another reply",
                    "INSERT INTO work_item_comments(work_item_id,body,reply_to) VALUES(?,'deep',?)",
                    (self.item, parent),
                )
        root = self.comment(self.item)
        self.refused(
            "not another reply",
            "UPDATE work_item_comments SET reply_to=? WHERE id=?",
            (reply, root),
        )

    def test_a_reply_stays_on_its_parents_item(self) -> None:
        elsewhere = self.ask(self.other, "there-request")
        self.refused(
            "same work item",
            "INSERT INTO work_item_comments(work_item_id,body,reply_to) VALUES(?,'away',?)",
            (self.other, self.root),
        )
        self.refused(
            "same work item",
            "INSERT INTO work_item_comments(work_item_id,body,reply_to_request) VALUES(?,'away',?)",
            (self.item, elsewhere),
        )
        root = self.comment(self.other)
        self.refused(
            "same work item",
            "UPDATE work_item_comments SET reply_to=? WHERE id=?",
            (self.root, root),
        )

    def test_only_a_root_is_resolved(self) -> None:
        reply = self.comment(self.item, reply_to=self.root)
        self.refused(
            "only a root",
            "UPDATE work_item_comments SET resolved_at=? WHERE id=?",
            (CREATED_AT, reply),
        )
        self.refused(
            "only a root",
            "INSERT INTO work_item_comments(work_item_id,body,reply_to,resolved_at)"
            " VALUES(?,'marked',?,?)",
            (self.item, self.root, CREATED_AT),
        )

    def test_moving_a_whole_thread_to_another_item_is_one_statement(self) -> None:
        # How a merge carries a thread: the trigger does not stand on the item
        # column, so the root and its replies move together.
        reply = self.comment(self.item, reply_to=self.root)
        self.conn.execute(
            "UPDATE work_item_comments SET work_item_id=? WHERE id=? OR reply_to=?",
            (self.other, self.root, self.root),
        )
        self.assertEqual(
            {self.other},
            {
                row[0]
                for row in self.conn.execute(
                    "SELECT work_item_id FROM work_item_comments WHERE id IN (?,?)",
                    (self.root, reply),
                )
            },
        )

    def test_deleting_a_root_takes_its_replies(self) -> None:
        self.comment(self.item, reply_to=self.root)
        self.comment(self.item, reply_to_request=self.request)
        self.conn.execute("DELETE FROM work_item_comments WHERE id=?", (self.root,))
        self.conn.execute("DELETE FROM work_item_requests WHERE request_id=?", (self.request,))
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0]
        )

    def test_the_new_actions_are_held_and_an_unknown_one_is_not(self) -> None:
        for action in sorted(ADDED_ACTIONS):
            with self.subTest(action=action):
                self.conn.execute(
                    "INSERT INTO work_item_events(work_item_id,action,detail) VALUES(?,?,'')",
                    (self.item, action),
                )
        self.refused(
            "CHECK constraint",
            "INSERT INTO work_item_events(work_item_id,action,detail) VALUES(?,'invented','')",
            (self.item,),
        )

    def test_a_replaced_answer_is_kept_once_per_version(self) -> None:
        self.conn.execute(
            "INSERT INTO work_item_request_answers(request_id,version,answers_json,answered_by,"
            "answered_at) VALUES(?,1,'{}','owner',?)",
            (self.request, CREATED_AT),
        )
        self.refused(
            "UNIQUE",
            "INSERT INTO work_item_request_answers(request_id,version,answers_json,answered_by,"
            "answered_at) VALUES(?,1,'{}','owner',?)",
            (self.request, CREATED_AT),
        )
        self.refused(
            "CHECK constraint",
            "INSERT INTO work_item_request_answers(request_id,version,answers_json,answered_by,"
            "answered_at) VALUES(?,0,'{}','owner',?)",
            (self.request, CREATED_AT),
        )
        self.conn.execute("DELETE FROM work_item_requests WHERE request_id=?", (self.request,))
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_request_answers").fetchone()[0]
        )


if __name__ == "__main__":
    unittest.main()
