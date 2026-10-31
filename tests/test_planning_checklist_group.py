"""Setting the steps inside the batch and the creation, all or nothing with the rest.

Agents had to call set_work_item_checklist on its own before every batch that
claimed and started an item. These cases hold the `checklist` group to being
the single tool's write at its place in the order, to answering with the new
step ids, and to a step sent done being the same history as set and ticked.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import store
from server.planning import api, model, service


class ChecklistGroupTests(unittest.TestCase):
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
        service.create_planning_space(self.conn, project_id="steps", name="Steps", key="STP")
        self.reference = service.create_work_item(self.conn, space="STP", title="Work")["reference"]

    def post(self, path: str, **payload: object) -> dict:
        handled = api.handle_post(self.conn, path, payload)
        assert handled is not None
        return handled[1]

    def refused(self, path: str, **payload: object) -> dict:
        before = service.get_work_item(self.conn, self.reference)
        with self.assertRaises(api.PlanningHttpError) as refusal:
            api.handle_post(self.conn, path, payload)
        after = service.get_work_item(self.conn, self.reference)
        self.assertEqual(
            (before["revision"], before["events"]), (after["revision"], after["events"])
        )
        return {
            "code": refusal.exception.code,
            "message": refusal.exception.message,
            **refusal.exception.detail,
        }

    def actions(self) -> list[str]:
        return [
            event["action"] for event in service.get_work_item(self.conn, self.reference)["events"]
        ]

    def test_a_claim_and_its_steps_take_one_call(self) -> None:
        answer = self.post(
            "/api/planning/work-item/apply",
            id=self.reference,
            author="agent",
            claim=True,
            checklist={"items": ["write it", "test it"]},
        )
        self.assertEqual("dev", answer["state"]["key"])
        stored = answer["checklist"]
        self.assertEqual(
            [{"item_id": step["id"], "text": step["text"], "done": False} for step in stored],
            answer["applied"]["checklist"],
        )
        self.assertEqual(["write it", "test it"], [step["text"] for step in stored])
        self.assertEqual(
            ["created", "claimed", "transitioned", "checklist_replaced"], self.actions()
        )

    def test_a_step_sent_done_is_the_history_of_a_set_and_a_tick(self) -> None:
        answer = self.post(
            "/api/planning/work-item/apply",
            id=self.reference,
            author="agent",
            claim=True,
            checklist={"items": [{"text": "found it", "done": True}, "fix it"]},
        )
        found, fix = answer["checklist"]
        self.assertEqual((True, "agent"), (found["done"], found["done_by"]))
        self.assertEqual((False, ""), (fix["done"], fix["done_by"]))
        self.assertEqual(
            ["created", "claimed", "transitioned", "checklist_replaced", "checklist_completed"],
            self.actions(),
        )

    def test_steps_set_done_let_the_same_call_close_the_item(self) -> None:
        answer = self.post(
            "/api/planning/work-item/apply",
            id=self.reference,
            author="agent",
            claim=True,
            checklist={"items": [{"text": "did it", "done": True}]},
            summary={"done": "did it", "next": "nothing"},
            transition={"state": "done"},
        )
        self.assertEqual("done", answer["state"]["key"])

    def test_engaged_steps_are_kept_unless_force_discards_them(self) -> None:
        steps = service.set_checklist(self.conn, self.reference, ["one"])["checklist"]
        service.tick_checklist_item(self.conn, self.reference, steps[0]["id"], author="agent")
        refusal = self.refused(
            "/api/planning/work-item/apply",
            id=self.reference,
            comment={"body": "rewriting the plan"},
            checklist={"items": ["two"]},
        )
        self.assertEqual("invalid_request", refusal["code"])
        self.assertTrue(refusal["message"].startswith("checklist: "))
        self.assertEqual({"group": "checklist", "index": 0}, refusal["step"])
        forced = self.post(
            "/api/planning/work-item/apply",
            id=self.reference,
            checklist={"items": ["two"], "force": True},
        )
        self.assertEqual(["two"], [step["text"] for step in forced["checklist"]])

    def test_ticks_in_the_same_call_cannot_name_the_steps_it_replaced(self) -> None:
        old = service.set_checklist(self.conn, self.reference, ["old"])["checklist"][0]["id"]
        refusal = self.refused(
            "/api/planning/work-item/apply",
            id=self.reference,
            checklist={"items": ["new"]},
            checklist_ticks=[{"item_id": old}],
        )
        self.assertEqual({"group": "checklist_ticks", "index": 0}, refusal["step"])
        self.assertIn("has no checklist step", refusal["message"])

    def test_a_creation_takes_its_steps_between_the_claim_and_the_links(self) -> None:
        answer = self.post(
            "/api/planning/work-items",
            space="STP",
            title="Found en route",
            author="agent",
            claim=True,
            checklist={"items": ["reproduce", {"text": "noticed", "done": True}]},
            links=[{"other": self.reference, "kind": "discovered-from"}],
        )
        self.assertEqual({"claim", "checklist", "links"}, set(answer["applied"]), answer["applied"])
        self.assertEqual(["reproduce", "noticed"], [step["text"] for step in answer["checklist"]])
        self.assertEqual(
            [
                "created",
                "claimed",
                "transitioned",
                "checklist_replaced",
                "checklist_completed",
                "linked",
            ],
            [event["action"] for event in answer["events"]],
        )

    def test_a_creation_refuses_force_on_its_checklist_before_writing(self) -> None:
        with self.assertRaises(api.PlanningHttpError) as refusal:
            api.handle_post(
                self.conn,
                "/api/planning/work-items",
                {"space": "STP", "title": "Forced", "checklist": {"items": ["a"], "force": True}},
            )
        self.assertIn("unknown field(s) force", refusal.exception.message)
        self.assertEqual(1, len(service.list_work_items(self.conn, space="STP")))

    def test_steps_appended_after_the_old_ones_keep_every_claim_and_tick(self) -> None:
        old = service.set_checklist(self.conn, self.reference, ["write it", "test it", "ship"])
        first, second, third = old["checklist"]
        service.tick_checklist_item(self.conn, self.reference, first["id"], author="one")
        service.claim_checklist_item(self.conn, self.reference, second["id"], author="two")
        before = {step["id"]: step for step in self.post_get()["checklist"]}
        # The old steps by their text, one by its id and renamed, and a finding appended.
        answer = self.post(
            "/api/planning/work-item/apply",
            id=self.reference,
            author="reviewer",
            checklist={
                "items": [
                    "write it",
                    {"id": second["id"], "text": "test it on Windows"},
                    "ship",
                    "review: handle empty input",
                ]
            },
        )
        steps = answer["checklist"]
        self.assertEqual(
            [first["id"], second["id"], third["id"]], [step["id"] for step in steps[:3]]
        )
        self.assertEqual(before[first["id"]], steps[0])
        self.assertEqual({**before[second["id"]], "text": "test it on Windows"}, steps[1])
        self.assertEqual(
            ("review: handle empty input", False), (steps[3]["text"], steps[3]["done"])
        )
        self.assertEqual(
            [{"item_id": step["id"], "text": step["text"], "done": step["done"]} for step in steps],
            answer["applied"]["checklist"],
        )

    def test_a_repeated_step_sent_done_is_ticked_and_one_left_out_is_not_reopened(self) -> None:
        old = service.set_checklist(self.conn, self.reference, ["a", "b"])["checklist"]
        service.claim_checklist_item(self.conn, self.reference, old[0]["id"], author="one")
        service.tick_checklist_item(self.conn, self.reference, old[1]["id"], author="one")
        steps = service.set_checklist(
            self.conn, self.reference, [{"text": "a", "done": True}, "b"], author="agent"
        )["checklist"]
        self.assertEqual(
            [(old[0]["id"], True, "", "agent"), (old[1]["id"], True, "", "one")],
            [(s["id"], s["done"], s["claimed_by"], s["done_by"]) for s in steps],
        )
        self.assertEqual("checklist_completed", self.actions()[-1])

    def test_a_list_that_drops_an_engaged_step_names_it(self) -> None:
        old = service.set_checklist(self.conn, self.reference, ["keep", "done already"])
        service.tick_checklist_item(self.conn, self.reference, old["checklist"][1]["id"])
        before = service.get_work_item(self.conn, self.reference)
        with self.assertRaises(model.PlanningError) as refusal:
            service.set_checklist(self.conn, self.reference, ["keep", "new"])
        self.assertIn(
            "would lose 1 claimed or completed step(s): done already", str(refusal.exception)
        )
        self.assertEqual(before, service.get_work_item(self.conn, self.reference))
        # Free steps may go without force, as before.
        kept = service.set_checklist(self.conn, self.reference, ["done already"])
        self.assertEqual(["done already"], [step["text"] for step in kept["checklist"]])

    def post_get(self) -> dict:
        return service.get_work_item(self.conn, self.reference)

    def test_a_step_that_names_its_own_id_keeps_the_state_it_carries(self) -> None:
        carried = {
            "id": "4f9d3c2e-1b7a-4c11-9e0f-2f4b6d8a1c3e",
            "text": "carried over",
            "done": True,
            "done_by": "someone",
        }
        replaced = service.set_checklist(self.conn, self.reference, [carried], author="agent")
        self.assertEqual("someone", replaced["checklist"][0]["done_by"])
        self.assertEqual(["created", "checklist_replaced"], self.actions())


if __name__ == "__main__":
    unittest.main()
