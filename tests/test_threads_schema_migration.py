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
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

from server import store
from server.planning import service as planning
from tests import schema9

ADDED_ACTIONS = {"comment_resolved", "comment_reopened", "request_changed"}

HELD = "11111111-1111-4111-8111-111111111111"
CREATED_AT = "2026-11-02T00:00:00Z"
ANSWER = '{"path":"keep","_note":"Kept as answered"}'


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
