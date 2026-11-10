"""Pins, as the connection contract describes them ("Pins").

A pin is the person's own list: one per item, in the store, written through
`POST /api/planning/work-item/pin`, which answers with the live-work frame. It is
no change to the item and nothing an agent is told. It outlives the item's close,
moves to the survivor of a merge, goes with a deleted item, and an export carries it.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import store
from server.ops import export
from server.planning import api, calls, model, person_events, service

SPACE = "PIN"
PATH = "/api/planning/work-item/pin"


class PinCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="pins", name="Pins", key=SPACE)

    def item(self) -> str:
        return str(service.create_work_item(self.conn, space=SPACE, title="Work")["reference"])

    def post(self, payload: dict) -> tuple[int, dict]:
        """The write as the interface makes it, under the browser's identity."""

        try:
            with calls.bind(calls.browser(), PATH):
                answer = api.handle_post(self.conn, PATH, payload)
        except (api.PlanningHttpError, model.PlanningError) as error:
            # The surface maps a refusal the same way.
            return api.error_response(error)
        assert answer is not None
        return answer

    def pins(self) -> dict[str, str]:
        return {
            str(row[0]): str(row[1])
            for row in self.conn.execute("SELECT work_item_id, pinned_at FROM pinned_work_items")
        }

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])


class WriteTests(PinCase):
    def test_a_pin_answers_with_the_frame_that_now_has_its_row(self) -> None:
        reference = self.item()
        status, answer = self.post({"id": reference, "pinned": True})
        self.assertEqual(200, status)
        (space,) = answer["spaces"]
        self.assertEqual(
            [(reference, True)], [(r["reference"], r["pinned"]) for r in space["rows"]]
        )
        status, answer = self.post({"id": self.identity(reference), "pinned": False})
        self.assertEqual((200, {"spaces": [], "elsewhere": []}), (status, answer))
        self.assertEqual({}, self.pins())

    def test_a_pin_is_no_change_to_the_item_and_nothing_an_agent_is_told(self) -> None:
        reference = self.item()
        before = service.get_work_item(self.conn, reference)
        events = self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        self.post({"id": reference, "pinned": True})
        after = service.get_work_item(self.conn, reference)
        self.assertEqual(
            (before["revision"], before["updated_at"]), (after["revision"], after["updated_at"])
        )
        self.assertEqual(
            events, self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        )
        self.assertEqual(
            [], person_events.since_last_agent_write(self.conn, self.identity(reference))
        )

    def test_the_call_is_recorded_with_its_identity_and_the_pin_points_to_it(self) -> None:
        reference = self.item()
        self.post({"id": reference, "pinned": True})
        row = self.conn.execute(
            "SELECT c.identity_source, c.tool, c.work_item_id FROM pinned_work_items n"
            " JOIN execution_events c ON c.id = n.call_id"
        ).fetchone()
        self.assertEqual((calls.BROWSER, PATH, self.identity(reference)), tuple(row))

    def test_a_pin_already_as_asked_writes_nothing(self) -> None:
        reference = self.item()
        self.post({"id": reference, "pinned": True})
        self.conn.execute("UPDATE pinned_work_items SET pinned_at = '2026-01-01T00:00:00Z'")
        status, _answer = self.post({"id": reference, "pinned": True})
        self.assertEqual(200, status)
        self.assertEqual({self.identity(reference): "2026-01-01T00:00:00Z"}, self.pins())
        other = self.item()
        self.assertEqual(200, self.post({"id": other, "pinned": False})[0])
        self.assertEqual(1, len(self.pins()))

    def test_an_unknown_item_is_not_found_and_a_pinned_that_is_no_boolean_is_refused(self) -> None:
        reference = self.item()
        status, answer = self.post({"id": "PIN-99", "pinned": True})
        self.assertEqual((404, "not_found"), (status, answer["error"]["code"]))
        for pinned in ("true", 1, None):
            with self.subTest(pinned=pinned):
                status, answer = self.post({"id": reference, "pinned": pinned})
                self.assertEqual((400, "invalid_request"), (status, answer["error"]["code"]))
        status, answer = self.post({"id": reference})
        self.assertEqual((400, "invalid_request"), (status, answer["error"]["code"]))
        self.assertEqual({}, self.pins())


class LifetimeTests(PinCase):
    def test_a_pin_outlives_the_close_and_the_reopening(self) -> None:
        reference = self.item()
        self.post({"id": reference, "pinned": True})
        service.transition_work_item(self.conn, reference, "done", force=True)
        service.transition_work_item(self.conn, reference, "dev", force=True)
        self.assertEqual({self.identity(reference)}, set(self.pins()))

    def test_a_deleted_item_takes_its_pin_with_it(self) -> None:
        reference = self.item()
        self.post({"id": reference, "pinned": True})
        service.delete_work_item(self.conn, reference)
        self.assertEqual({}, self.pins())

    def test_a_merge_moves_the_pin_to_the_survivor(self) -> None:
        survivor, merged = self.item(), self.item()
        self.post({"id": merged, "pinned": True})
        pinned_at = self.pins()[self.identity(merged)]
        service.merge_work_items(self.conn, survivor, [merged])
        self.assertEqual({self.identity(survivor): pinned_at}, self.pins())

    def test_a_survivor_pinned_already_keeps_its_own_pin(self) -> None:
        survivor, merged, other = self.item(), self.item(), self.item()
        self.post({"id": survivor, "pinned": True})
        self.post({"id": merged, "pinned": True})
        self.post({"id": other, "pinned": True})
        self.conn.execute(
            "UPDATE pinned_work_items SET pinned_at = '2026-01-01T00:00:00Z' WHERE work_item_id = ?",
            (self.identity(survivor),),
        )
        answer = service.merge_work_items(self.conn, survivor, [merged, other])
        self.assertEqual({self.identity(survivor): "2026-01-01T00:00:00Z"}, self.pins())
        self.assertEqual(
            [{"steps": 0, "comments": 0, "refs": 0, "links": 0}] * 2,
            [entry["moved"] for entry in answer["merged"]],
            "a pin is no part of what a merge reports moved",
        )


class ExportTests(PinCase):
    def test_an_export_carries_the_pins_of_the_spaces_it_carries(self) -> None:
        service.create_planning_space(self.conn, project_id="other", name="Other", key="OTH")
        reference = self.item()
        elsewhere = str(service.create_work_item(self.conn, space="OTH", title="x")["reference"])
        self.post({"id": reference, "pinned": True})
        self.post({"id": elsewhere, "pinned": True})
        service.transition_work_item(self.conn, reference, "done", force=True)
        pins = self.pins()
        everything = export.export_installation(self.conn)["planning"]["pins"]
        self.assertEqual(
            [
                {
                    "reference": elsewhere,
                    "work_item_id": self.identity(elsewhere),
                    "pinned_at": pins[self.identity(elsewhere)],
                },
                {
                    "reference": reference,
                    "work_item_id": self.identity(reference),
                    "pinned_at": pins[self.identity(reference)],
                },
            ],
            everything,
        )
        narrowed = export.export_installation(self.conn, spaces=(SPACE,))["planning"]["pins"]
        self.assertEqual([reference], [pin["reference"] for pin in narrowed])


if __name__ == "__main__":
    unittest.main()
