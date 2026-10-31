"""The order of work: placing an item in its state, and who reads that order.

Three things are proved here. A placement puts exactly one item exactly where it
was asked and moves nothing else a reader can see. The queue, the list and the
chain read that one order. And the order lives in a column every earlier build
already reads and writes the same way, so placing items changes nothing about
the store such a build opens: no schema object, no stamp, no recovery point, and
its own reads and writes keep agreeing with this build's.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.planning import api as planning_api
from server.planning import calls, chain, model, ranking, service

#: How an earlier build listed a state and put an item last in it, copied from
#: that build rather than restated from the code under test, so the assertions
#: below hold against what it actually ran.
EARLIER_LIST_ORDER = (
    "SELECT i.number FROM work_items i JOIN workflow_states s ON s.state_id = i.state_id"
    " WHERE i.planning_space_id = ? ORDER BY s.position, i.position, i.number, i.work_item_id"
)
EARLIER_TAIL = "SELECT MAX(position) FROM work_items WHERE planning_space_id = ? AND state_id = ?"


class RankingTestCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(
            self.conn, project_id="example-workspace", name="Quality Assurance"
        )

    def item(self, title: str, **kwargs: object) -> str:
        created = service.create_work_item(
            self.conn, space=self.space["key"], title=title, author="tester", **kwargs
        )
        return str(created["reference"])

    def order(self, state: str = "backlog") -> list[str]:
        return [
            item["reference"]
            for item in service.list_work_items(self.conn, space=self.space["key"], state_key=state)
        ]

    def revisions(self) -> dict[str, int]:
        return {
            item["reference"]: item["revision"]
            for item in service.list_work_items(self.conn, space=self.space["key"], limit=None)
        }

    def positions(self, state: str = "backlog") -> list[float]:
        return [
            float(row[0])
            for row in self.conn.execute(
                "SELECT i.position FROM work_items i JOIN workflow_states s"
                " ON s.state_id = i.state_id WHERE s.key = ? ORDER BY i.position",
                (state,),
            )
        ]


class PlacementTests(RankingTestCase):
    """Where `rank` puts an item, and what else it leaves alone."""

    def setUp(self) -> None:
        super().setUp()
        self.a, self.b, self.c, self.d = (self.item(name) for name in "ABCD")

    def place(self, reference: str, rank: str) -> dict:
        return service.update_work_item(self.conn, reference, rank=rank, author="tester")

    def test_each_placement_lands_exactly_where_it_names(self) -> None:
        self.assertEqual([self.a, self.b, self.c, self.d], self.order())
        self.place(self.d, "first")
        self.assertEqual([self.d, self.a, self.b, self.c], self.order())
        self.place(self.d, "last")
        self.assertEqual([self.a, self.b, self.c, self.d], self.order())
        self.place(self.a, f"after:{self.c}")
        self.assertEqual([self.b, self.c, self.a, self.d], self.order())
        self.place(self.d, f"before:{self.b}")
        self.assertEqual([self.d, self.b, self.c, self.a], self.order())
        self.place(self.b, f"after:{self.a}")
        self.assertEqual([self.d, self.c, self.a, self.b], self.order())

    def test_a_placement_moves_one_revision_and_no_neighbour(self) -> None:
        before = self.revisions()
        self.place(self.c, "first")
        after = self.revisions()
        self.assertEqual(before[self.c] + 1, after[self.c])
        self.assertEqual(
            {ref: rev for ref, rev in before.items() if ref != self.c},
            {ref: rev for ref, rev in after.items() if ref != self.c},
        )
        self.assertEqual(4, len(set(self.positions())))

    def test_a_placement_that_changes_nothing_writes_nothing(self) -> None:
        before = self.revisions()
        for reference, rank in (
            (self.a, "first"),
            (self.d, "last"),
            (self.b, f"after:{self.a}"),
            (self.b, f"before:{self.c}"),
        ):
            with self.subTest(rank=rank):
                self.place(reference, rank)
                self.assertEqual(before, self.revisions())

    def test_a_placement_travels_with_other_edits_in_one_write(self) -> None:
        before = self.revisions()[self.d]
        edited = service.update_work_item(
            self.conn, self.d, title="Renamed", rank="first", author="tester"
        )
        self.assertEqual(("Renamed", before + 1), (edited["title"], edited["revision"]))
        self.assertEqual(self.d, self.order()[0])

    def test_a_refused_placement_writes_nothing(self) -> None:
        other = service.create_planning_space(self.conn, project_id="other", name="Elsewhere")
        foreign = str(
            service.create_work_item(self.conn, space=other["key"], title="Theirs")["reference"]
        )
        moved = self.item("In development", state="dev")
        cases = {
            "top": "rank must be first, last",
            "first:QA-1": "rank must be first, last",
            "before:": "rank must be first, last",
            " ": "rank must be first, last",
            f"before:{self.a}": "relative to itself",
            f"after:{foreign}": "another planning space",
            f"before:{moved}": f"{moved} is in Dev, not Backlog",
            "after:QA-999": "no work item QA-999",
        }
        before = (self.revisions(), self.positions())
        for rank, refusal in cases.items():
            with self.subTest(rank=rank), self.assertRaisesRegex(model.PlanningError, refusal):
                self.place(self.a, rank)
        self.assertEqual(before, (self.revisions(), self.positions()))

    def test_a_stale_revision_refuses_the_placement(self) -> None:
        stale = self.revisions()[self.d]
        self.place(self.d, "first")
        with self.assertRaises(model.RevisionConflictError):
            service.update_work_item(self.conn, self.d, rank="last", expected_revision=stale)
        self.assertEqual(self.d, self.order()[0])

    def test_a_gap_that_runs_out_is_renumbered_in_the_order_it_had(self) -> None:
        # Always into the same gap, just after A: halving runs out long before
        # eighty, and the state is renumbered without anyone seeing it.
        others = {ref: rev for ref, rev in self.revisions().items() if ref not in (self.a,)}
        placed = []
        for index in range(80):
            reference = self.item(f"Wedged {index}")
            self.place(reference, f"after:{self.a}")
            placed.append(reference)
        self.assertEqual([self.a, *reversed(placed), self.b, self.c, self.d], self.order())
        positions = self.positions()
        self.assertEqual(len(positions), len(set(positions)))
        self.assertEqual(sorted(positions), positions)
        # The renumbering moved no revision: B, C and D were never written.
        after = self.revisions()
        self.assertEqual(
            {ref: others[ref] for ref in (self.b, self.c, self.d)},
            {ref: after[ref] for ref in (self.b, self.c, self.d)},
        )

    def test_an_earlier_builds_tied_positions_are_untied_by_a_placement(self) -> None:
        self.conn.execute("UPDATE work_items SET position = 1.0")
        # A tie reads in number order, which is today's order for such rows.
        self.assertEqual([self.a, self.b, self.c, self.d], self.order())
        self.place(self.d, f"before:{self.b}")
        self.assertEqual([self.a, self.d, self.b, self.c], self.order())
        self.assertEqual(4, len(set(self.positions())))


class TransitionPlacementTests(RankingTestCase):
    """A move between states keeps a sensible place: last, unless it names one."""

    def setUp(self) -> None:
        super().setUp()
        self.queued = [self.item(f"Queued {index}", state="todo") for index in range(3)]
        self.moving = self.item("Moving")

    def move(self, rank: str | None = None) -> dict:
        return service.transition_work_item(
            self.conn, self.moving, "todo", rank=rank, author="tester"
        )

    def test_a_move_without_a_placement_queues_last(self) -> None:
        self.move()
        self.assertEqual([*self.queued, self.moving], self.order("todo"))

    def test_a_move_can_name_its_place_in_the_new_state(self) -> None:
        moved = self.move(f"before:{self.queued[1]}")
        self.assertEqual("todo", moved["state"]["key"])
        self.assertEqual(
            [self.queued[0], self.moving, *self.queued[1:]],
            self.order("todo"),
        )

    def test_the_anchor_of_a_move_belongs_to_the_state_it_moves_to(self) -> None:
        stay = self.item("Stays in the backlog")
        with self.assertRaisesRegex(model.PlanningError, "is in Backlog, not Todo"):
            self.move(f"after:{stay}")
        self.assertEqual("backlog", service.get_work_item(self.conn, self.moving)["state"]["key"])

    def test_a_refused_move_places_nothing(self) -> None:
        with self.assertRaisesRegex(model.WorkflowGuardError, "executor"):
            service.transition_work_item(self.conn, self.moving, "dev", rank="first")
        self.assertEqual([self.moving], self.order("backlog"))


class OrderReaderTests(RankingTestCase):
    """The queue, the list and the chain all read the one order."""

    def take(self) -> str | None:
        taken = service.claim_ready_work_item(self.conn, space=self.space["key"], author="agent")
        return None if taken is None else str(taken["reference"])

    def test_the_queue_takes_todo_before_the_backlog_and_each_in_its_order(self) -> None:
        backlog = [self.item(f"Backlog {index}") for index in range(2)]
        todo = [self.item(f"Todo {index}", state="todo") for index in range(2)]
        service.update_work_item(self.conn, todo[1], rank="first")
        service.update_work_item(self.conn, backlog[1], rank="first")
        self.assertEqual(
            [todo[1], todo[0], backlog[1], backlog[0], None], [self.take() for _ in range(5)]
        )

    def test_priority_only_breaks_a_tie_in_the_order(self) -> None:
        first = self.item("Placed first")
        urgent = self.item("Urgent but last", priority="urgent")
        self.assertEqual(first, self.take())
        service.claim_work_item(self.conn, first, release=True, author="agent")
        # The release put the started item in the queued state; back beside the
        # urgent one, so the two share a state.
        service.transition_work_item(self.conn, first, "backlog")
        # Two rows an earlier build left at one position: the urgent one goes first.
        self.conn.execute("UPDATE work_items SET position = 7.0")
        self.assertEqual(urgent, self.take())

    def test_the_list_reads_each_state_in_its_order(self) -> None:
        a, b = self.item("A"), self.item("B")
        t = self.item("T", state="todo")
        service.update_work_item(self.conn, b, rank="first")
        listed = [
            item["reference"]
            for item in service.list_work_items(self.conn, space=self.space["key"], limit=None)
        ]
        self.assertEqual([b, a, t], listed)

    def test_a_chain_member_carries_its_place_in_the_order_of_work(self) -> None:
        epic = self.item("Epic", kind="epic")
        later = self.item("Backlog later", parent=epic)
        sooner = self.item("Backlog sooner", parent=epic)
        queued = self.item("Queued", parent=epic, state="todo")
        review = self.item("Reviewed", parent=epic, state="review")
        service.update_work_item(self.conn, sooner, rank="first")
        members = chain.chain(self.conn, epic)["members"]
        by_rank = [member["reference"] for member in sorted(members, key=lambda m: m["rank"])]
        # Review before the queue, the queue before the backlog, and the backlog
        # in the order it was placed in -- the order the take-next queue reads.
        self.assertEqual([review, queued, sooner, later], by_rank)
        self.assertEqual(len(members), len({member["rank"] for member in members}))

    def test_the_work_order_names_every_category_once(self) -> None:
        self.assertEqual(sorted(model.STATE_CATEGORIES), sorted(ranking.WORK_ORDER))


class BoundaryTests(RankingTestCase):
    """`rank` through the HTTP boundary: one call row, the same refusals."""

    def setUp(self) -> None:
        super().setUp()
        self.first, self.second = self.item("First"), self.item("Second")

    def post(self, path: str, **payload: object) -> tuple[int, dict]:
        try:
            with calls.bind(calls.browser(), path):
                answer = planning_api.handle_post(self.conn, path, payload)
        except (model.PlanningError, planning_api.PlanningHttpError) as error:
            return planning_api.error_response(error)
        assert answer is not None
        return answer

    def calls(self) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM execution_events WHERE kind = ? ORDER BY id", (calls.KIND,)
        ).fetchall()

    def test_an_update_places_the_item_and_is_recorded_as_one_call(self) -> None:
        status, body = self.post(
            "/api/planning/work-item/update", id=self.second, rank=f"before:{self.first}"
        )
        self.assertEqual(200, status)
        self.assertEqual([self.second, self.first], self.order())
        [call] = self.calls()
        self.assertEqual(
            ("/api/planning/work-item/update", "browser", body["work_item_id"]),
            (call["tool"], call["identity_source"], call["work_item_id"]),
        )

    def test_a_transition_places_the_item_in_its_new_state(self) -> None:
        queued = self.item("Queued", state="todo")
        status, _ = self.post(
            "/api/planning/work-item/transition", id=self.first, state="todo", rank="first"
        )
        self.assertEqual(200, status)
        self.assertEqual([self.first, queued], self.order("todo"))

    def test_a_batch_transition_takes_the_placement_too(self) -> None:
        queued = self.item("Queued", state="todo")
        status, body = self.post(
            "/api/planning/work-item/apply",
            id=self.first,
            transition={"state": "todo", "rank": f"before:{queued}"},
        )
        self.assertEqual(200, status)
        self.assertEqual({"transition": {"state": "todo"}}, body["applied"])
        self.assertEqual([self.first, queued], self.order("todo"))

    def test_a_refused_placement_answers_like_any_refused_edit_and_writes_nothing(self) -> None:
        for rank in ("top", 7):
            with self.subTest(rank=rank):
                status, body = self.post("/api/planning/work-item/update", id=self.first, rank=rank)
                self.assertEqual(400, status)
                self.assertEqual("invalid_request", body["error"]["code"])
        self.assertEqual([self.first, self.second], self.order())


class EarlierBuildTests(RankingTestCase):
    """What a build from before placements meets in a store this one has ordered."""

    def schema(self, conn: sqlite3.Connection) -> list[tuple]:
        return [tuple(row) for row in conn.execute("SELECT type, name, sql FROM sqlite_master")]

    def test_placing_items_changes_nothing_about_the_stores_format(self) -> None:
        a, b, c = self.item("A"), self.item("B"), self.item("C")
        self.conn.commit()
        shape = self.schema(self.conn)
        for _ in range(60):
            service.update_work_item(self.conn, c, rank=f"after:{a}")
            service.update_work_item(self.conn, c, rank="last")
        service.transition_work_item(self.conn, b, "todo", rank="first")
        self.conn.commit()
        self.assertEqual(shape, self.schema(self.conn))
        self.assertEqual(9, self.conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(9, store.STORE_SCHEMA_VERSION)
        # Opening it again takes no recovery point: there is nothing to migrate.
        store.connect().close()
        backups = self.root / "backups"
        self.assertFalse(backups.exists() and any(backups.iterdir()))

    def test_an_earlier_build_reads_the_order_this_one_placed(self) -> None:
        a, b, c = self.item("A"), self.item("B"), self.item("C")
        service.update_work_item(self.conn, c, rank="first")
        service.update_work_item(self.conn, a, rank=f"after:{b}")
        self.conn.commit()
        earlier = sqlite3.connect(self.path)
        self.addCleanup(earlier.close)
        listed = [
            f"{self.space['key']}-{row[0]}"
            for row in earlier.execute(EARLIER_LIST_ORDER, (self.space["planning_space_id"],))
        ]
        self.assertEqual([c, b, a], listed)
        self.assertEqual(listed, self.order())

    def test_an_earlier_builds_writes_land_last_and_keep_the_order_whole(self) -> None:
        a, b = self.item("A"), self.item("B")
        service.update_work_item(self.conn, b, rank="first")
        self.conn.commit()
        earlier = sqlite3.connect(self.path)
        self.addCleanup(earlier.close)
        state = earlier.execute(
            "SELECT state_id, workflow_id FROM work_items WHERE planning_space_id = ? LIMIT 1",
            (self.space["planning_space_id"],),
        ).fetchone()
        tail = float(
            earlier.execute(EARLIER_TAIL, (self.space["planning_space_id"], state[0])).fetchone()[0]
        )
        # Its create: last in the state, by the rule it always had.
        earlier.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "title,position) VALUES('earlier-item',?,99,?,?,'Earlier',?)",
            (self.space["planning_space_id"], state[1], state[0], tail + 1.0),
        )
        earlier.commit()
        self.assertEqual([b, a, f"{self.space['key']}-99"], self.order())
        # And this build goes on placing among them.
        service.update_work_item(self.conn, f"{self.space['key']}-99", rank=f"before:{a}")
        self.assertEqual([b, f"{self.space['key']}-99", a], self.order())
        self.assertEqual(3, len(set(self.positions())))


if __name__ == "__main__":
    unittest.main()
