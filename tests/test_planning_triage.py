"""The triage stack and the review's mark, as the store keeps them.

The oracle is the rule of the stack: an item waits there when it stands in triage,
has no parent or stands in accepted open goals and stages all the way up, and has no
question to the owner open, which is a request pending with no comment under it and
no session asked (`questions.OWNER_QUESTION`). It entered at its last state entry, or
at its creation when its history records none, and the stack is read oldest entry
first, then by space key and number. A mark stays until the item leaves triage or
moves under a goal or out of one, or gains a comment, a thread or a question to the
owner, which a merge moving one onto it counts as; the store takes it away then, and
nothing else does.

Goal G, filed by the person and so accepted, holds what each case names. Session B
files the findings, which stand in triage with no basis.
"""

from __future__ import annotations

import re
import sqlite3

from server.planning import questions, triage
from tests.test_planning_closing import APPLY, AS_B, MERGE, UPDATE, Tree

FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}
QUESTION = {"kind": "question", "prompt": "Is this one change or two?", "fields": [FIELD]}
ANSWER = "/api/planning/request/answer"
T1 = "2026-11-10T09:00:00Z"
T2 = "2026-11-11T09:00:00Z"
T3 = "2026-11-12T09:00:00Z"


class Stack(Tree):
    def setUp(self) -> None:
        super().setUp()
        self.space = str(
            self.conn.execute(
                "SELECT planning_space_id FROM planning_spaces WHERE key = 'MAIN'"
            ).fetchone()[0]
        )

    # -- writes ---------------------------------------------------------------------

    def found(self, title: str, kind: str = "task", parent: str | None = None) -> str:
        """An item session B filed: with nothing accepted over it, it stands in triage."""

        arguments: dict = {"space": "MAIN", "title": title, "kind": kind}
        if parent is not None:
            arguments["parent"] = parent
        return str(self.agent("create_work_item", AS_B, **arguments)["reference"])

    def asked(self, reference: str) -> None:
        self.agent("apply_work_item_changes", AS_B, id=reference, questions=[QUESTION])

    def marked(self, reference: str) -> None:
        answer = triage.mark(
            self.conn, self.identity(reference), True, author="worker-a", call_id=None
        )
        self.conn.commit()
        self.assertEqual({"seen_at"}, set(answer))

    def entries_at(self, reference: str, moment: str) -> None:
        """Date every state entry and the creation of the item to `moment`."""

        identity = self.identity(reference)
        self.conn.execute(
            "UPDATE work_item_events SET created_at = ? WHERE work_item_id = ?"
            " AND action IN ('created', 'transitioned', 'opened')",
            (moment, identity),
        )
        self.conn.execute(
            "UPDATE work_items SET created_at = ? WHERE work_item_id = ?", (moment, identity)
        )
        self.conn.commit()

    # -- reads ----------------------------------------------------------------------

    def mark_of(self, reference: str) -> tuple | None:
        found = self.conn.execute(
            "SELECT seen_at, author FROM triage_marks WHERE work_item_id = ?",
            (self.identity(reference),),
        ).fetchone()
        return None if found is None else tuple(found)

    def stack(self) -> list[str]:
        return [
            f"{found.space_key}-{found.number}" for found in triage.waiting(self.conn, self.space)
        ]


class SelectionTests(Stack):
    def test_the_stack_holds_what_waits_in_triage_and_nothing_decided_elsewhere(self) -> None:
        f = self.found("f, a finding")
        t = self.made("t, a task in the accepted goal", parent=self.goal)
        self.person(APPLY, id=t, transition={"state": "triage"})
        stage = self.made("S", "stage", parent=self.goal)
        deep = self.made("d, a task in an accepted stage", parent=stage)
        self.person(APPLY, id=deep, transition={"state": "triage"})
        g = self.found("g, a goal nobody accepted", "goal")
        u = self.found("u, under the goal nobody accepted", parent=g)
        q = self.found("q, a finding asked about")
        self.asked(q)
        ready = self.made("r, accepted")

        listed = self.stack()

        self.assertEqual(sorted([f, t, deep]), sorted(listed))
        for outside in (g, u, q, ready, self.goal, stage):
            self.assertNotIn(outside, listed)
        # The goal waits for the owner's answer to the question its proposal asked;
        # once nobody waits for one, it is the review's to see.
        [(request_id, revision)] = self.conn.execute(
            "SELECT request_id, revision FROM work_item_requests WHERE work_item_id = ?"
            " AND status = 'pending'",
            (self.identity(g),),
        ).fetchall()
        self.agent("expire_work_item_request", AS_B, id=request_id, expected_revision=revision)
        self.assertEqual(sorted([f, t, deep, g]), sorted(self.stack()))

    def test_the_stack_is_read_by_entry_then_number(self) -> None:
        first, second, third = (self.found(name) for name in ("first", "second", "third"))
        self.entries_at(first, T2)
        self.entries_at(second, T1)
        self.entries_at(third, T2)

        self.assertEqual([second, first, third], self.stack())

    def test_an_item_enters_at_its_last_state_entry_or_else_its_creation(self) -> None:
        moved = self.found("moved")
        self.entries_at(moved, T1)
        self.person(APPLY, id=moved, transition={"state": "ready"})
        self.person(APPLY, id=moved, transition={"state": "triage"})
        self.conn.execute(
            "UPDATE work_item_events SET created_at = ? WHERE work_item_id = ?"
            " AND action = 'transitioned'",
            (T3, self.identity(moved)),
        )
        bare = self.found("bare")
        self.entries_at(bare, T2)
        self.conn.execute(
            "DELETE FROM work_item_events WHERE work_item_id = ?", (self.identity(bare),)
        )
        self.conn.commit()

        self.assertEqual(T3, triage.entered(self.conn, self.identity(moved)))
        self.assertEqual(T2, triage.entered(self.conn, self.identity(bare)))
        self.assertIsNone(triage.entered(self.conn, "no such item"))
        self.assertEqual(
            {bare: T2, moved: T3},
            {
                f"{found.space_key}-{found.number}": found.entered_at
                for found in triage.waiting(self.conn, self.space)
            },
        )

    def test_the_field_is_the_mark_of_an_item_in_the_stack_only(self) -> None:
        seen, unseen = self.found("seen"), self.found("unseen")
        self.marked(seen)
        outside = self.made("accepted")

        field = triage.field(self.conn, [self.identity(r) for r in (seen, unseen, outside)])

        seen_at, author = self.mark_of(seen) or (None, None)
        self.assertEqual(
            {
                self.identity(seen): {"seen_at": seen_at, "seen_by": "worker-a"},
                self.identity(unseen): {"seen_at": None, "seen_by": None},
            },
            dict(field),
        )
        self.assertEqual("worker-a", author)
        self.assertEqual({}, dict(triage.field(self.conn, [])))


class MarkTests(Stack):
    def test_a_mark_is_set_and_taken_away_by_its_call_alone(self) -> None:
        item = self.found("s1")
        self.marked(item)
        self.assertIsNotNone(self.mark_of(item))

        answer = triage.mark(self.conn, self.identity(item), False, author="worker-a", call_id=None)

        self.assertEqual({"cleared": True}, answer)
        self.assertIsNone(self.mark_of(item))

    def test_what_the_store_takes_the_mark_away_on(self) -> None:
        """Each write on its own item; the mark goes on the first five and stays on the rest."""

        donor = self.found("a finding whose thread moves")
        unaccepted = self.found("a goal nobody accepted", "goal")
        self.agent("apply_work_item_changes", AS_B, id=donor, comment={"body": "Seen twice"})
        writes = {
            "it leaves triage": lambda item: self.person(
                APPLY, id=item, transition={"state": "ready"}
            ),
            "it moves under a goal": lambda item: self.person(UPDATE, id=item, parent=unaccepted),
            "a comment": lambda item: self.agent(
                "apply_work_item_changes", AS_B, id=item, comment={"body": "Still seen"}
            ),
            "a thread moved onto it": lambda item: self.person(MERGE, id=item, items=[donor]),
            "a question to the owner": self.asked,
        }
        kept = {
            "an edit of its title": lambda item: self.person(UPDATE, id=item, title="Renamed"),
            "an edit of its labels": lambda item: self.person(UPDATE, id=item, labels=["docs"]),
        }
        for name, write in {**writes, **kept}.items():
            with self.subTest(name):
                item = self.found(f"marked before {name}")
                self.marked(item)
                write(item)
                if name in writes:
                    self.assertIsNone(self.mark_of(item))
                else:
                    self.assertIsNotNone(self.mark_of(item))
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_events WHERE action = 'triage_seen'"
            ).fetchone()[0],
            "the store takes a mark away with no event",
        )

    def test_a_question_merged_in_clears_the_mark(self) -> None:
        """A finding with a question still waiting merged into a marked one: the question
        moves, the mark goes, and the survivor leaves the stack while it is open.

        A merge also notes on the survivor what it moved there, a comment, which takes a
        mark away by itself; that the moved question does as well is held where a row
        moves alone (`QuestionTriggerTests`)."""

        s1 = self.found("s1")
        self.marked(s1)
        f8 = self.found("f8, asked about")
        self.asked(f8)

        self.person(MERGE, id=s1, items=[f8])

        [(request_id, revision, item)] = self.conn.execute(
            "SELECT request_id, revision, work_item_id FROM work_item_requests"
        ).fetchall()
        self.assertEqual(self.identity(s1), item, "the question moved onto s1")
        self.assertIsNone(self.mark_of(s1))
        self.assertNotIn(s1, self.stack())

        self.person(
            ANSWER, id=request_id, expected_revision=revision, answers={"answer": "One change"}
        )
        self.assertIn(s1, self.stack(), "back in the stack once answered")
        self.assertEqual({"seen_at": None, "seen_by": None}, triage.field(self.conn, [item])[item])


class QuestionTriggerTests(Stack):
    def test_the_question_triggers_read_the_owner_question(self) -> None:
        """Their conditions are `questions.OWNER_QUESTION` on the row `NEW`, as stored."""

        owner_question = re.sub(r"\br\.", "NEW.", questions.OWNER_QUESTION)
        stored = dict(
            self.conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE type = 'trigger'"
                " AND name IN ('triage_marks_question', 'triage_marks_question_moved')"
            ).fetchall()
        )
        conditions = {
            name: re.search(r"\nWHEN (.*)\nBEGIN ", sql, re.DOTALL).group(1)  # type: ignore[union-attr]
            for name, sql in stored.items()
        }
        self.assertEqual(
            {
                "triage_marks_question": owner_question,
                "triage_marks_question_moved": "NEW.work_item_id IS NOT OLD.work_item_id AND "
                + owner_question,
            },
            conditions,
        )

    def test_only_a_question_to_the_owner_takes_the_mark_away(self) -> None:
        """Rows written straight into the store, inserted and moved: a list under a comment,
        a request asked of a session and an answered question leave the mark."""

        self.conn.execute("INSERT INTO sessions(id, client) VALUES('worker-b-session', 'codex')")
        other = self.identity(self.found("the item a request moves from"))
        rows = {
            "a list under a comment": {"comment": True},
            "a request asked of a session": {"addressee": "worker-b-session"},
            "an answered question": {"status": "answered"},
            "a question to the owner": {},
        }
        for moved in (False, True):
            for name, row in rows.items():
                with self.subTest(name, moved=moved):
                    reference = self.found(f"{name}, moved {moved}")
                    identity = self.identity(reference)
                    comment = None
                    if row.get("comment"):
                        comment = self.conn.execute(
                            "INSERT INTO work_item_comments(work_item_id, body) VALUES(?, 'x')",
                            (other if moved else identity,),
                        ).lastrowid
                    self.marked(reference)
                    request_id = f"{reference}-{moved}"
                    self.conn.execute(
                        "INSERT INTO work_item_requests(request_id, work_item_id, kind, prompt,"
                        " fields_json, status, author, created_at, comment_id, addressee)"
                        " VALUES(?, ?, 'question', 'Which?', '[]', ?, 'worker-b', ?, ?, ?)",
                        (
                            request_id,
                            other if moved else identity,
                            row.get("status", "pending"),
                            T1,
                            comment,
                            row.get("addressee"),
                        ),
                    )
                    if moved:
                        self.conn.execute(
                            "UPDATE work_item_requests SET work_item_id = ? WHERE request_id = ?",
                            (identity, request_id),
                        )
                    self.conn.commit()
                    if name == "a question to the owner":
                        self.assertIsNone(self.mark_of(reference))
                    else:
                        self.assertIsNotNone(self.mark_of(reference))


class DeclarationTests(Stack):
    def test_a_mark_goes_with_its_item(self) -> None:
        item = self.found("deleted")
        self.marked(item)
        self.conn.execute("DELETE FROM work_items WHERE work_item_id = ?", (self.identity(item),))
        self.assertEqual(0, self.conn.execute("SELECT COUNT(*) FROM triage_marks").fetchone()[0])

    def test_a_mark_names_an_item_the_store_holds(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO triage_marks(work_item_id, seen_at, author) VALUES('nobody', ?, 'x')",
                (T1,),
            )
        self.conn.rollback()
