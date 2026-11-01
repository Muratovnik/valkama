"""A close ends the claims on the item it closes, and the record still says who held it.

A transition into a terminal state used to leave the claim live: a closed item
read as held until a second call released it or its lease ran out a fortnight
later, and every close cost an agent two writes. These cases hold the close to
releasing in its own write on every surface that moves an item, to recording
that release, and to the read model naming the holder afterwards — for an item
closed this way, for one an older build closed with its claim still on it, and
for one closed with a release that came after.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import api, leases, service, views

SUMMARY = {"done": "the work", "next": "nothing"}


class CloseTestCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = service.create_planning_space(self.conn, project_id="close", name="Close")
        self.key = self.space["key"]

    def held_item(self, *steps: str) -> str:
        """An item `agent` holds and has started, with a summary and the given steps."""

        reference = service.create_work_item(self.conn, space=self.key, title="Work")["reference"]
        service.claim_work_item(self.conn, reference, author="agent")
        if steps:
            service.set_checklist(self.conn, reference, list(steps), author="agent")
        service.set_summary(self.conn, reference, SUMMARY, author="agent")
        return reference

    def item(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def brief(self, reference: str) -> dict:
        rows = service.list_work_items(self.conn, space=self.key, limit=None)
        return next(row for row in rows if row["reference"] == reference)

    def tail(self, reference: str, count: int) -> list[tuple[str, str]]:
        events = self.item(reference)["events"]
        return [(event["action"], event["detail"]) for event in events[-count:]]

    def close_as_an_older_build(self, reference: str) -> str:
        """Close the item the way a build before the release did: state moved, claim left on."""

        identity = str(self.item(reference)["work_item_id"])
        self.conn.execute(
            "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
            (self.state_id("done"), identity),
        )
        self.conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author) VALUES(?,?,?,?)",
            (identity, "transitioned", "done", "agent"),
        )
        return identity

    def state_id(self, key: str) -> str:
        return next(
            str(state["state_id"])
            for state in self.space["workflow"]["states"]
            if state["key"] == key
        )


class CloseReleasesTests(CloseTestCase):
    def test_a_completed_close_releases_the_claim_and_records_the_release(self) -> None:
        reference = self.held_item()

        closed = service.transition_work_item(self.conn, reference, "done", author="agent")

        self.assertEqual(("", None), (closed["claim_ref"], closed["claim_state"]))
        self.assertIsNone(closed["claim"])
        self.assertEqual("agent", closed["released"])
        self.assertEqual([("transitioned", "done"), ("released", "agent")], self.tail(reference, 2))
        self.assertEqual(
            ["agent"], [event["author"] for event in self.item(reference)["events"][-1:]]
        )

    def test_a_cancelled_close_releases_the_claim_and_the_steps_it_leaves_open(self) -> None:
        reference = self.held_item("finished", "never started")
        steps = self.item(reference)["checklist"]
        service.tick_checklist_item(self.conn, reference, steps[0]["id"], author="agent")
        service.claim_checklist_item(self.conn, reference, steps[1]["id"], author="helper")

        closed = service.transition_work_item(self.conn, reference, "cancelled", author="agent")

        self.assertEqual("", closed["claim_ref"])
        # The undone step stays undone: cancelling claims no work. Only its claim ends.
        self.assertEqual(
            [(True, "", "agent"), (False, "", "")],
            [(step["done"], step["claimed_by"], step["done_by"]) for step in closed["checklist"]],
        )
        self.assertEqual(
            [
                ("transitioned", "cancelled"),
                ("released", "agent"),
                ("checklist_released", "never started"),
            ],
            self.tail(reference, 3),
        )

    def test_a_forced_close_with_open_steps_releases_them_and_records_the_override(self) -> None:
        reference = self.held_item("still open")
        step = self.item(reference)["checklist"][0]["id"]
        service.claim_checklist_item(self.conn, reference, step, author="agent")

        closed = service.transition_work_item(
            self.conn, reference, "done", force=True, author="agent"
        )

        self.assertEqual(["checklist"], closed["overridden"])
        self.assertEqual(("", "agent"), (closed["claim_ref"], closed["released"]))
        self.assertEqual([(False, "")], [(s["done"], s["claimed_by"]) for s in closed["checklist"]])
        self.assertEqual(
            [
                ("transitioned", "done"),
                ("released", "agent"),
                ("checklist_released", "still open"),
                ("overridden", "checklist"),
            ],
            self.tail(reference, 4),
        )

    def test_a_close_releases_whoever_holds_the_item(self) -> None:
        reference = self.held_item()

        closed = service.transition_work_item(self.conn, reference, "done", author="owner")

        self.assertEqual(("", "agent"), (closed["claim_ref"], closed["released"]))
        self.assertEqual(("released", "agent"), self.tail(reference, 1)[0])

    def test_an_unheld_close_releases_nothing(self) -> None:
        reference = service.create_work_item(self.conn, space=self.key, title="Work")["reference"]
        service.set_summary(self.conn, reference, SUMMARY, author="owner")

        closed = service.transition_work_item(self.conn, reference, "cancelled", author="owner")

        self.assertNotIn("released", closed)
        self.assertEqual([("transitioned", "cancelled")], self.tail(reference, 1))
        self.assertIsNone(closed["last_claim_ref"])

    def test_a_move_between_open_states_keeps_the_claim(self) -> None:
        reference = self.held_item()

        moved = service.transition_work_item(self.conn, reference, "review", author="agent")

        self.assertEqual("agent", moved["claim_ref"])
        self.assertNotIn("released", moved)

    def test_reopening_a_closed_item_does_not_restore_the_claim(self) -> None:
        reference = self.held_item()
        service.transition_work_item(self.conn, reference, "done", author="agent")

        reopened = service.transition_work_item(self.conn, reference, "dev", author="agent")

        self.assertEqual("dev", reopened["state"]["key"])
        self.assertEqual(("", None), (reopened["claim_ref"], reopened["claim"]))
        # Open again, it names no former holder: that was about its close.
        self.assertEqual((None, None), (reopened["closed_at"], reopened["last_claim_ref"]))
        self.assertNotIn("claimed", [action for action, _ in self.tail(reference, 1)])


class LastHolderTests(CloseTestCase):
    def test_a_closed_item_names_its_last_holder_and_when_it_closed(self) -> None:
        reference = self.held_item()
        service.transition_work_item(self.conn, reference, "done", author="agent")
        closing = next(
            event
            for event in reversed(self.item(reference)["events"])
            if event["action"] == "transitioned"
        )

        for read in (self.item(reference), self.brief(reference)):
            self.assertEqual(("", "agent"), (read["claim_ref"], read["last_claim_ref"]))
            self.assertEqual(closing["at"], read["closed_at"])

    def test_open_work_names_no_closing(self) -> None:
        reference = self.held_item()

        brief = self.brief(reference)

        self.assertEqual("agent", brief["claim_ref"])
        self.assertEqual((None, None), (brief["closed_at"], brief["last_claim_ref"]))

    def test_an_item_an_older_build_closed_still_held_reads_its_claim(self) -> None:
        """A close that predates the release left the claim on the item; it is still the holder."""

        reference = self.held_item()
        self.close_as_an_older_build(reference)

        brief = self.brief(reference)

        self.assertEqual(("agent", "agent"), (brief["claim_ref"], brief["last_claim_ref"]))
        self.assertIsNotNone(brief["closed_at"])

    def test_a_release_after_an_older_close_names_the_holder_it_released(self) -> None:
        """The close and its separate release that agents used to send as two calls."""

        reference = self.held_item()
        self.close_as_an_older_build(reference)
        service.claim_work_item(self.conn, reference, author="agent", release=True)

        brief = self.brief(reference)
        self.assertEqual(("", "agent"), (brief["claim_ref"], brief["last_claim_ref"]))

    def test_an_expired_lease_on_a_closed_item_names_the_holder_not_the_expiry(self) -> None:
        reference = self.held_item()
        identity = self.close_as_an_older_build(reference)
        self.conn.execute(
            "UPDATE work_items SET claim_ref = '', claim_call_id = NULL WHERE work_item_id = ?",
            (identity,),
        )
        self.conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author) VALUES(?,?,?,?)",
            (identity, "released", f"{leases.EXPIRY_REASON}: agent", leases.EXPIRY_AUTHOR),
        )

        self.assertEqual("agent", self.brief(reference)["last_claim_ref"])

    def test_a_release_before_the_close_is_not_the_holder_at_the_close(self) -> None:
        reference = self.held_item()
        service.claim_work_item(self.conn, reference, author="agent", release=True)

        closed = service.transition_work_item(self.conn, reference, "cancelled", author="owner")

        self.assertIsNone(closed["last_claim_ref"])

    def test_the_board_read_model_carries_the_closing_of_each_item(self) -> None:
        closed = self.held_item()
        service.transition_work_item(self.conn, closed, "done", author="agent")
        open_item = self.held_item()

        payload = views.planning_payload(self.conn, space=self.key)

        rows = {row["reference"]: row for row in payload["work_items"]}
        self.assertEqual("agent", rows[closed]["last_claim_ref"])
        self.assertIsNotNone(rows[closed]["closed_at"])
        self.assertEqual(
            (None, None), (rows[open_item]["closed_at"], rows[open_item]["last_claim_ref"])
        )


class SurfaceTests(CloseTestCase):
    def test_the_graph_names_who_held_a_closed_item(self) -> None:
        closed = self.held_item()
        service.transition_work_item(self.conn, closed, "done", author="agent")
        open_item = self.held_item()

        nodes = {
            node["reference"]: node
            for node in views.graph_payload(self.conn, space=self.key)["nodes"]
        }

        self.assertEqual(
            ("", "agent"), (nodes[closed]["claim_ref"], nodes[closed]["last_claim_ref"])
        )
        self.assertIsNotNone(nodes[closed]["closed_at"])
        self.assertEqual(
            ("agent", None, None),
            (
                nodes[open_item]["claim_ref"],
                nodes[open_item]["closed_at"],
                nodes[open_item]["last_claim_ref"],
            ),
        )

    def test_the_transition_tool_answers_with_the_release(self) -> None:
        reference = self.held_item()

        answer = mcp_surface.call_tool(
            self.conn, "transition_work_item", {"id": reference, "state": "done", "author": "agent"}
        )

        assert isinstance(answer, dict)
        self.assertEqual(
            ("", None, "agent"), (answer["claim_ref"], answer["claim_state"], answer["released"])
        )
        self.assertEqual("", self.item(reference)["claim_ref"])

    def test_the_http_transition_releases_and_the_board_read_names_the_holder(self) -> None:
        reference = self.held_item()

        status, closed = api.handle_post(
            self.conn,
            "/api/planning/work-item/transition",
            {"id": reference, "state": "done", "author": "user"},
        )

        self.assertEqual(200, status)
        self.assertEqual(("", "agent"), (closed["claim_ref"], closed["released"]))
        read = api.handle_get(self.conn, "/api/planning", {"space": [self.key]})
        assert read is not None
        row = next(item for item in read[1]["work_items"] if item["reference"] == reference)
        self.assertEqual(("", "agent"), (row["claim_ref"], row["last_claim_ref"]))


if __name__ == "__main__":
    unittest.main()
