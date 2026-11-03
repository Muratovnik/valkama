"""What two agents on one store do to each other.

Every write verb in the Planning domain reads an item, decides from what it
read, and writes once. Those are separate statements, so every test here drives
the gap between them: a decision that was true when it was made, acted on after
somebody else has already acted. The verbs take the write lock before they read,
which closes that gap; the tests that hand a verb a stale row prove the guarded
write that still refuses one, and the rest prove the lock comes first.

The rest of the Planning tests share a single connection and run in order, which
is why none of them could see this. A claim is promised to be atomic and to fail
naming the holder, so the promise needs a test that actually has two callers.

A refused write leaves its connection inside the transaction SQLite opened for
it, exactly as it would on a live surface, and every test rolls that back the
way the surface's error path does — opening another connection while it is held
would fail on the lock rather than on the thing under test.
"""

from __future__ import annotations

import functools
import os
import sqlite3
import tempfile
import threading
import unittest
from collections.abc import Callable
from unittest import mock

from server import store
from server.planning import calls, model, read_model, service
from server.planning import store as planning_store


class PlanningConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = self.open()
        self.space = service.create_planning_space(
            self.conn, project_id="example-workspace", name="Quality Assurance"
        )
        self.conn.commit()

    def open(self) -> sqlite3.Connection:
        """A second caller — its own connection, like the real ones.

        The HTTP surface opens one per request and an MCP session holds its own
        for as long as it lives, so two callers never share a transaction.
        """

        conn = store.connect()
        self.addCleanup(conn.close)
        return conn

    def item(self, title: str, **kwargs) -> dict:
        created = service.create_work_item(
            self.conn, space=self.space["key"], title=title, author="tester", **kwargs
        )
        self.conn.commit()
        return created

    def holder(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["claim_ref"])

    def events(self, action: str) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_events WHERE action = ?", (action,)
        ).fetchone()
        return int(row[0])

    # -- the claim itself ----------------------------------------------------

    def test_a_claim_decided_from_a_stale_row_is_refused_naming_the_holder(self) -> None:
        self.item("Land the guarded write")
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        second = self.open()
        service.claim_work_item(second, "QA-1", author="agent-two")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaisesRegex(model.PlanningError, "already held by agent-two"):
                service.claim_work_item(first, "QA-1", author="agent-one")
        first.rollback()
        self.assertEqual("agent-two", self.holder("QA-1"))
        self.assertEqual(1, self.events("claimed"))

    def test_two_connections_racing_one_item_produce_one_holder(self) -> None:
        """The reproduction the review ran, kept as a test.

        It used to hold both callers at their read until both had read, which is
        the interleaving that let two agents both see an unheld item. A claim now
        reads under the lock it writes with, so that interleaving cannot happen:
        the second caller, arriving while the first is reading, cannot start, and
        once the first has committed it reads the holder and is refused by name.
        The second caller is driven from the first one's read, not from a thread,
        so the order does not depend on the scheduler.
        """

        self.item("Contested")
        first = self.open()
        second = self.open()
        second.execute("PRAGMA busy_timeout=0")
        during_read: list[str] = []

        def arrive(sql: str) -> None:
            if during_read or "FROM work_items" not in sql:
                return
            try:
                service.claim_work_item(second, "QA-1", author="agent-two")
                during_read.append("claimed")
            except sqlite3.OperationalError as locked:
                during_read.append(str(locked))
            second.rollback()

        first.set_trace_callback(arrive)
        claimed = service.claim_work_item(first, "QA-1", author="agent-one")
        first.set_trace_callback(None)
        first.commit()
        self.assertEqual(["database is locked"], during_read)
        self.assertEqual("agent-one", claimed["claim_ref"])
        with self.assertRaisesRegex(model.PlanningError, "already held by agent-one"):
            service.claim_work_item(second, "QA-1", author="agent-two")
        second.rollback()
        self.assertEqual("agent-one", self.holder("QA-1"))
        self.assertEqual(1, self.events("claimed"))

    def test_losing_the_race_to_your_own_earlier_claim_is_not_a_refusal(self) -> None:
        """A retry that already succeeded is answered with the item, not a conflict.

        The same agent asking twice — a retried request, a resent tool call — is
        asking for a state that already holds, and reporting a race there would
        punish it for having won.
        """

        self.item("Idempotent")
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        second = self.open()
        service.claim_work_item(second, "QA-1", author="agent-one")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            answered = service.claim_work_item(first, "QA-1", author="agent-one")
        first.rollback()
        self.assertEqual("agent-one", answered["claim_ref"])
        self.assertEqual(1, self.events("claimed"))

    def test_a_release_decided_from_a_stale_row_reports_the_conflict(self) -> None:
        self.item("Released twice")
        service.claim_work_item(self.conn, "QA-1", author="agent-one")
        self.conn.commit()
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        second = self.open()
        service.claim_work_item(second, "QA-1", author="agent-one", release=True)
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaises(model.RevisionConflictError):
                service.claim_work_item(first, "QA-1", author="agent-one", release=True)
        first.rollback()

    # -- the other verbs, which share the one guarded write ------------------

    def test_a_checklist_step_claim_decided_from_a_stale_row_is_refused(self) -> None:
        self.item("Split work")
        service.set_checklist(self.conn, "QA-1", ["read", "write"], author="tester")
        self.conn.commit()
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        step = model.checklist(stale["checklist"])[0]["id"]
        second = self.open()
        service.claim_checklist_item(second, "QA-1", step, author="agent-two")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaises(model.RevisionConflictError):
                service.claim_checklist_item(first, "QA-1", step, author="agent-one")
        first.rollback()
        steps = service.get_work_item(self.conn, "QA-1")["checklist"]
        self.assertEqual(["agent-two", ""], [entry["claimed_by"] for entry in steps])

    def test_a_tick_decided_from_a_stale_row_does_not_overwrite_the_other_step(self) -> None:
        """Two agents ticking two different steps of one item.

        The checklist is one column, so a stale write here would not merely lose
        a race — it would write back a whole checklist that never had the other
        agent's step ticked at all.
        """

        self.item("Two steps")
        service.set_checklist(self.conn, "QA-1", ["read", "write"], author="tester")
        self.conn.commit()
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        steps = model.checklist(stale["checklist"])
        second = self.open()
        service.tick_checklist_item(second, "QA-1", steps[1]["id"], author="agent-two")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaises(model.RevisionConflictError):
                service.tick_checklist_item(first, "QA-1", steps[0]["id"], author="agent-one")
        first.rollback()
        done = [entry["done"] for entry in service.get_work_item(self.conn, "QA-1")["checklist"]]
        self.assertEqual([False, True], done)

    def test_a_transition_decided_from_a_stale_row_is_refused(self) -> None:
        self.item("Moved twice")
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        second = self.open()
        service.claim_work_item(second, "QA-1", author="agent-two")
        service.transition_work_item(second, "QA-1", "dev", author="agent-two")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaises(model.RevisionConflictError):
                service.transition_work_item(first, "QA-1", "todo", author="agent-one")
        first.rollback()
        self.assertEqual("dev", service.get_work_item(self.conn, "QA-1")["state"]["key"])

    def test_an_edit_decided_from_a_stale_row_is_refused(self) -> None:
        self.item("Retitled twice")
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        second = self.open()
        service.update_work_item(second, "QA-1", title="Named by two", author="agent-two")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaises(model.RevisionConflictError):
                service.update_work_item(first, "QA-1", title="Named by one", author="agent-one")
        first.rollback()
        self.assertEqual("Named by two", service.get_work_item(self.conn, "QA-1")["title"])

    def test_a_write_whose_item_was_deleted_says_so(self) -> None:
        self.item("Gone")
        first = self.open()
        stale = read_model.item_row(first, "QA-1")
        second = self.open()
        service.delete_work_item(second, "QA-1")
        second.commit()
        with mock.patch.object(read_model, "item_row", return_value=stale):
            with self.assertRaisesRegex(model.PlanningError, "deleted"):
                service.claim_work_item(first, "QA-1", author="agent-one")
        first.rollback()

    # -- the take-next queue ------------------------------------------------

    def test_the_queue_takes_the_next_candidate_when_its_pick_is_taken(self) -> None:
        """Losing the pick must hand out a different item, not the same one.

        The race is real rather than injected: another connection claims the
        chosen item and commits in the gap between this caller's pick and its
        write, so the guard refuses on its own and the loop is what decides what
        happens next.
        """

        self.item("First", priority="urgent")
        self.item("Second", priority="urgent")
        queue = self.open()
        rival = self.open()
        original = service._write
        taken_first: list[str] = []

        def claimed_underneath(
            conn: sqlite3.Connection,
            row: sqlite3.Row,
            updates: list[str],
            parameters: list[object],
        ) -> None:
            if not taken_first:
                taken_first.append(str(row["work_item_id"]))
                service.claim_work_item(rival, str(row["work_item_id"]), author="agent-one")
                rival.commit()
            original(conn, row, updates, parameters)

        with mock.patch.object(service, "_write", claimed_underneath):
            taken = service.claim_ready_work_item(
                queue, space=self.space["key"], author="agent-two"
            )
        assert taken is not None
        self.assertEqual("Second", taken["title"])
        self.assertEqual("agent-two", taken["claim_ref"])
        self.assertNotEqual(taken_first[0], taken["work_item_id"])
        queue.commit()
        self.assertEqual("agent-one", self.holder("QA-1"))
        self.assertEqual("agent-two", self.holder("QA-2"))

    def test_the_queue_reports_the_race_it_keeps_losing(self) -> None:
        """A caller that can never win is told so, rather than looped on.

        The refusal is injected here because the point is the bound: a caller
        inside its own older transaction would keep being offered the same item
        forever, and the attempts have to end somewhere.
        """

        self.item("Only one")
        queue = self.open()

        def always_refuse(
            conn: sqlite3.Connection,
            row: sqlite3.Row,
            updates: list[str],
            parameters: list[object],
        ) -> None:
            del conn, updates, parameters
            raise model.RevisionConflictError(int(row["revision"]), int(row["revision"]) + 1)

        with mock.patch.object(service, "_write", always_refuse):
            with self.assertRaises(model.RevisionConflictError):
                service.claim_ready_work_item(queue, space=self.space["key"], author="agent-two")
        queue.rollback()
        self.assertEqual("", self.holder("QA-1"))

    def test_an_empty_queue_still_answers_with_nothing(self) -> None:
        self.assertIsNone(
            service.claim_ready_work_item(self.conn, space=self.space["key"], author="agent-two")
        )


class ReadThenWriteTests(unittest.TestCase):
    """A number, a key or a call row decided before the write lock is held.

    Each test puts another writer's whole commit into the one gap a real pair of
    agents can hit: `set_trace_callback` runs when SQLite starts a statement and
    before that statement takes any lock, so the other writer lands between what
    the caller read and what it writes, every time rather than now and then. A
    writer the caller already locks out is refused at once and retried after the
    caller commits, which is the correct outcome of a write that holds its lock
    before it reads.
    """

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = self.open()
        self.other = self.open()
        self.other.execute("PRAGMA busy_timeout=0")
        self.space = service.create_planning_space(
            self.conn, project_id="example-workspace", name="Quality Assurance"
        )
        self.conn.commit()

    def open(self) -> sqlite3.Connection:
        conn = store.connect()
        self.addCleanup(conn.close)
        return conn

    def before(self, statement: str, other_write: Callable[[], object]) -> list[bool]:
        """Run `other_write` on `self.other` the first time `self.conn` starts `statement`.

        The list says whether it landed: empty until the statement started, then
        one entry, false when the caller's lock kept the other writer out.
        """

        landed: list[bool] = []

        def race(sql: str) -> None:
            if landed or statement not in sql:
                return
            try:
                other_write()
                self.other.commit()
                landed.append(True)
            except sqlite3.OperationalError:
                self.other.rollback()
                landed.append(False)

        self.conn.set_trace_callback(race)
        self.addCleanup(self.conn.set_trace_callback, None)
        return landed

    def test_a_number_read_before_another_writer_commits_is_not_handed_out_twice(self) -> None:
        def other_create() -> None:
            service.create_work_item(self.other, space=self.space["key"], title="Theirs")

        landed = self.before("UPDATE planning_spaces", other_create)
        mine = service.create_work_item(self.conn, space=self.space["key"], title="Mine")
        self.conn.commit()
        self.conn.set_trace_callback(None)
        self.assertEqual([True], landed)
        self.assertEqual("QA-2", mine["reference"])
        self.assertEqual(
            {1: "Theirs", 2: "Mine"},
            {
                row["number"]: row["title"]
                for row in self.conn.execute("SELECT number, title FROM work_items")
            },
        )
        self.assertEqual(
            3,
            self.conn.execute(
                "SELECT next_number FROM planning_spaces WHERE key = ?", (self.space["key"],)
            ).fetchone()[0],
        )

    def test_four_writers_creating_at_once_take_every_number_once(self) -> None:
        """The reproduction the review ran: four agents, thirty items each, no retry."""

        start = threading.Barrier(4)
        failures: list[str] = []
        lock = threading.Lock()

        def agent() -> None:
            conn = sqlite3.connect(self.path, timeout=30)
            conn.row_factory = sqlite3.Row
            try:
                start.wait()
                for index in range(30):
                    service.create_work_item(conn, space=self.space["key"], title=f"Item {index}")
                    conn.commit()
            except sqlite3.Error as error:
                with lock:
                    failures.append(f"{type(error).__name__}: {error}")
            finally:
                conn.close()

        threads = [threading.Thread(target=agent) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual([], failures)
        numbers = [row[0] for row in self.conn.execute("SELECT number FROM work_items")]
        self.assertEqual(list(range(1, 121)), sorted(numbers))

    def test_a_missing_space_is_refused_when_a_number_is_asked_for(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, "planning space does not exist"):
            planning_store.next_number(self.conn, model.new_id())
        self.conn.rollback()

    def test_two_spaces_deriving_one_key_at_once_get_two_keys(self) -> None:
        def other_space() -> None:
            service.create_planning_space(self.other, project_id="theirs", name="Valkama")

        landed = self.before("INSERT INTO planning_spaces", other_space)
        mine = service.create_planning_space(self.conn, project_id="mine", name="Valkama")
        self.conn.commit()
        self.conn.set_trace_callback(None)
        self.assertEqual(1, len(landed))
        if not landed[0]:
            other_space()
            self.other.commit()
        keys = {row[0] for row in self.conn.execute("SELECT key FROM planning_spaces")}
        self.assertEqual({"QA", "VAL", "VAL2"}, keys)
        self.assertIn(mine["key"], keys)

    def test_one_project_taking_one_space_name_twice_is_refused_in_words(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, "already has a planning space"):
            service.create_planning_space(
                self.conn, project_id="example-workspace", name="Quality Assurance"
            )
        self.conn.rollback()

    def test_a_summary_takes_its_lock_before_it_reads_its_call(self) -> None:
        """A read inside a deferred transaction cannot be upgraded after another commit.

        SQLite answers that with `database is locked` at once, whatever the busy
        timeout, so an agent got a raw error for a summary nothing was wrong with.
        """

        service.create_work_item(self.conn, space=self.space["key"], title="Report on me")
        self.conn.commit()

        def other_comment() -> None:
            service.comment_work_item(self.other, "QA-1", "Theirs", author="other")

        landed = self.before("INSERT INTO execution_events", other_comment)
        with calls.bind(calls.verify_mcp({}, None), "set_work_item_summary"):
            answer = service.set_summary(
                self.conn, "QA-1", {"done": "Done it", "next": "Nothing"}, author="agent"
            )
        self.conn.commit()
        self.conn.set_trace_callback(None)
        self.assertEqual(1, len(landed))
        self.assertTrue(answer["summary"])

    def test_a_write_that_names_no_revision_is_not_refused_for_one_it_never_saw(self) -> None:
        """Four agents reporting on one item got `revision 30, not 0` without naming one.

        Each verb read the item and only then took the lock it writes under, so
        a write another agent committed in between made the guarded write refuse
        a revision the caller never asked about. The other write lands here at
        the first `BEGIN` the caller issues, whichever kind it is: before the
        read when the lock comes first, after it when it does not.

        The other write is a report, which changes nothing but the revision,
        except under the merge: that one adds a step to the survivor, because a
        merge read before the lock wrote the survivor's checklist back as it had
        read it, with `force`, and the step was gone without a word.
        """

        mine = {"done": "Mine", "next": "Nothing"}
        theirs = {"done": "Theirs", "next": "Nothing"}

        def report(ref: str) -> None:
            service.report_work_item(self.other, ref, theirs)

        def add_step(ref: str) -> None:
            service.set_checklist(self.other, ref, ["read", "write", "late"])

        def first_step(ref: str) -> str:
            return str(service.get_work_item(self.conn, ref)["checklist"][0]["id"])

        verbs: dict[
            str,
            tuple[Callable[[str], object], Callable[[str], None], Callable[[dict], object], object],
        ] = {
            "report": (
                lambda ref: service.report_work_item(self.conn, ref, mine),
                report,
                lambda item: [entry["report"]["done"] for entry in item["comments"]],
                ["Theirs", "Theirs", "Mine"],
            ),
            "summary": (
                lambda ref: service.set_summary(self.conn, ref, mine),
                report,
                lambda item: item["summary"]["done"],
                "Mine",
            ),
            "edit": (
                lambda ref: service.update_work_item(self.conn, ref, title="Renamed"),
                report,
                lambda item: item["title"],
                "Renamed",
            ),
            "transition": (
                lambda ref: service.transition_work_item(self.conn, ref, "todo"),
                report,
                lambda item: item["state"]["key"],
                "todo",
            ),
            "claim": (
                lambda ref: service.claim_work_item(self.conn, ref, author="agent-one"),
                report,
                lambda item: item["claim_ref"],
                "agent-one",
            ),
            "checklist": (
                lambda ref: service.set_checklist(self.conn, ref, ["read", "write", "ship"]),
                report,
                lambda item: len(item["checklist"]),
                3,
            ),
            "step claim": (
                lambda ref: service.claim_checklist_item(
                    self.conn, ref, first_step(ref), author="agent-one"
                ),
                report,
                lambda item: item["checklist"][0]["claimed_by"],
                "agent-one",
            ),
            "tick": (
                lambda ref: service.tick_checklist_item(self.conn, ref, first_step(ref)),
                report,
                lambda item: item["checklist"][0]["done"],
                True,
            ),
            "merge": (
                lambda ref: service.merge_work_items(self.conn, ref, [self.twin()]),
                add_step,
                lambda item: [step["text"] for step in item["checklist"]],
                ["read", "write", "late", "ship"],
            ),
        }
        for name, (act, other_write, observe, expected) in verbs.items():
            with self.subTest(verb=name):
                self.conn.rollback()
                reference = service.create_work_item(
                    self.conn, space=self.space["key"], title=name
                )["reference"]
                service.set_checklist(self.conn, reference, ["read", "write"])
                service.report_work_item(self.conn, reference, theirs)
                self.conn.commit()
                landed = self.before("BEGIN", functools.partial(other_write, reference))
                act(reference)
                self.conn.commit()
                self.conn.set_trace_callback(None)
                self.assertEqual([True], landed)
                self.assertEqual(expected, observe(service.get_work_item(self.conn, reference)))

    def test_a_delete_counts_children_under_the_lock_it_deletes_with(self) -> None:
        """A child created as the delete begins is counted, not met as a raw FOREIGN KEY.

        The delete counted the item's children and only then took the lock, so a
        child another agent created in between reached the DELETE, and the caller
        got SQLite's `IntegrityError` instead of the refusal that names the child.
        """

        parent = service.create_work_item(self.conn, space=self.space["key"], title="Parent")
        self.conn.commit()

        def other_child() -> None:
            service.create_work_item(
                self.other, space=self.space["key"], title="Child", parent=parent["reference"]
            )

        landed = self.before("BEGIN", other_child)
        with self.assertRaisesRegex(model.PlanningError, "still has 1 child item"):
            service.delete_work_item(self.conn, parent["reference"])
        self.conn.rollback()
        self.conn.set_trace_callback(None)
        self.assertEqual([True], landed)
        titles = {row[0] for row in self.conn.execute("SELECT title FROM work_items")}
        self.assertEqual({"Parent", "Child"}, titles)

    def twin(self) -> str:
        """A second item with one step, for a merge to fold in.

        Created on the other connection, so the caller's own transaction is still
        unopened when the merge begins.
        """

        created = service.create_work_item(self.other, space=self.space["key"], title="Twin")
        service.set_checklist(self.other, created["reference"], ["ship"])
        self.other.commit()
        return str(created["reference"])


if __name__ == "__main__":
    unittest.main()
