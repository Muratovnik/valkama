"""Merging items that turned out to be one change into the item that survives.

Closing the extras as duplicates by hand lost what they held: the steps someone
ticked, the discussion, the commits and the links that made other work wait.
These cases hold the merge to moving all of that to the survivor in its own
shape, to closing each merged item as a duplicate that still reads as itself,
to writing only the history every earlier build already reads, and to writing
nothing at all when any part is refused.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

from server import mcp_surface, store
from server.planning import api, model, requests, service

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
OTHER = "019a3c2e-6c8e-7c11-9e0f-2f4b6d8a1c3e"

#: Every event a merge may write: actions each single tool already wrote before
#: merging existed, so a build without it reads a merge as ordinary history.
EARLIER_ACTIONS = {
    "linked",
    "unlinked",
    "checklist_replaced",
    "summarized",
    "transitioned",
    "released",
    "overridden",
}


class MergeTestCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3"),
                "HOME": directory.name,
                "USERPROFILE": directory.name,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="merge", name="Merge", key="MRG")
        self.survivor = self.item("The change")
        self.first = self.item("Found it once")
        self.second = self.item("Found it again")

    def item(self, title: str, **fields: object) -> str:
        return str(
            service.create_work_item(self.conn, space="MRG", title=title, **fields)["reference"]
        )

    def get(self, reference: str) -> dict:
        return service.get_work_item(self.conn, reference)

    def merge(self, *items: str, **arguments: object) -> dict:
        handled = api.handle_post(
            self.conn,
            "/api/planning/work-item/merge",
            {"id": self.survivor, "items": list(items), **arguments},
        )
        assert handled is not None
        return handled[1]

    def snapshot(self) -> list[tuple]:
        """Everything a merge could touch, for every item in the space."""

        return [
            (
                item["revision"],
                item["state"]["key"],
                item["claim_ref"],
                item["checklist"],
                item["comments"],
                item["refs"],
                item["links"],
                item["events"],
            )
            for item in (
                self.get(row["reference"])
                for row in service.list_work_items(self.conn, space="MRG")
            )
        ]

    def refused(self, *items: str, **arguments: object) -> str:
        before = self.snapshot()
        with self.assertRaises((api.PlanningHttpError, model.PlanningError)) as refusal:
            self.merge(*items, **arguments)
        self.assertEqual(before, self.snapshot())
        return str(refusal.exception)


class MergeMovesTests(MergeTestCase):
    def setUp(self) -> None:
        super().setUp()
        service.set_checklist(self.conn, self.survivor, ["fix it"])
        steps = service.set_checklist(
            self.conn, self.first, [{"text": "reproduce", "done": True}, "bisect"], author="one"
        )["checklist"]
        self.reproduce, self.bisect = steps
        service.claim_checklist_item(self.conn, self.first, self.bisect["id"], author="helper")
        self.again = service.set_checklist(self.conn, self.second, ["confirm"])["checklist"][0]
        service.comment_work_item(self.conn, self.first, "seen on Windows", author="one")
        service.comment_work_item(
            self.conn,
            self.first,
            "bisected to the parser",
            author="one",
            checklist_item_id=self.bisect["id"],
        )
        service.report_work_item(self.conn, self.first, {"done": "looked", "next": "fix"})
        service.attach_ref(self.conn, self.first, "commit", "abc123", author="one")
        service.attach_ref(self.conn, self.first, "url", "https://example.test/1", author="one")
        service.attach_ref(self.conn, self.survivor, "url", "https://example.test/1")
        self.waiting = self.item("Waits on the fix")
        self.related = self.item("Nearby work")
        service.link_work_items(self.conn, self.first, self.waiting, "blocks")
        service.link_work_items(self.conn, self.related, self.first, "relates-to")
        service.link_work_items(self.conn, self.first, self.survivor, "relates-to")
        service.link_work_items(self.conn, self.first, self.second, "relates-to")
        self.conn.commit()
        self.before = {ref: self.get(ref) for ref in (self.survivor, self.first, self.second)}
        self.answer = self.merge(self.first, self.second, reason="one parser bug")

    def links(self, reference: str) -> set[tuple[str, str, str]]:
        return {
            (link["kind"], link["direction"], link["reference"])
            for link in self.get(reference)["links"]
        }

    def test_the_survivor_takes_every_step_in_its_own_shape(self) -> None:
        steps = self.get(self.survivor)["checklist"]
        self.assertEqual(
            ["fix it", "reproduce", "bisect", "confirm"], [step["text"] for step in steps]
        )
        carried = {step["id"]: step for step in steps}
        self.assertEqual(self.reproduce, carried[self.reproduce["id"]])
        self.assertEqual("helper", carried[self.bisect["id"]]["claimed_by"])
        self.assertEqual(self.again, carried[self.again["id"]])
        self.assertEqual([], self.get(self.first)["checklist"])
        # A step's holder finds it by the same id on the survivor.
        ticked = service.tick_checklist_item(
            self.conn, self.survivor, self.bisect["id"], author="helper"
        )
        self.assertTrue(
            next(s for s in ticked["checklist"] if s["id"] == self.bisect["id"])["done"]
        )

    def test_the_discussion_moves_and_the_reports_stay(self) -> None:
        survivor = self.get(self.survivor)
        bodies = [comment["body"] for comment in survivor["comments"]]
        self.assertEqual(["seen on Windows", "bisected to the parser"], bodies[:2])
        bound = survivor["comments"][1]
        self.assertEqual(self.bisect["id"], bound["checklist_item_id"])
        self.assertIn(self.bisect["id"], {step["id"] for step in survivor["checklist"]})
        first = self.get(self.first)
        self.assertEqual(["report", "report"], [comment["kind"] for comment in first["comments"]])
        self.assertEqual("looked", first["comments"][0]["report"]["done"])

    def test_refs_move_unless_the_survivor_has_them(self) -> None:
        survivor = {(ref["kind"], ref["value"]) for ref in self.get(self.survivor)["refs"]}
        self.assertEqual({("commit", "abc123"), ("url", "https://example.test/1")}, survivor)
        left = [(ref["kind"], ref["value"]) for ref in self.get(self.first)["refs"]]
        self.assertEqual([("url", "https://example.test/1")], left)

    def test_links_move_in_their_direction_and_none_ties_the_survivor_to_itself(self) -> None:
        self.assertLessEqual(
            {
                ("blocks", "outgoing", self.waiting),
                ("relates-to", "incoming", self.related),
                ("duplicates", "incoming", self.first),
                ("duplicates", "incoming", self.second),
            },
            self.links(self.survivor),
        )
        self.assertEqual({("blocks", "incoming", self.survivor)}, self.links(self.waiting))
        self.assertEqual({("relates-to", "outgoing", self.survivor)}, self.links(self.related))
        # What would have tied the survivor to itself stays on the merged item.
        self.assertEqual(
            {
                ("relates-to", "outgoing", self.survivor),
                ("relates-to", "outgoing", self.second),
                ("duplicates", "outgoing", self.survivor),
            },
            self.links(self.first),
        )

    def test_each_merged_item_closes_as_a_duplicate_that_names_the_survivor(self) -> None:
        for reference in (self.first, self.second):
            with self.subTest(reference):
                item = self.get(reference)
                self.assertEqual("cancelled", item["state"]["key"])
                self.assertEqual("", item["claim_ref"])
                self.assertTrue(item["summary"]["done"].startswith(f"Merged into {self.survivor}"))
                self.assertEqual(f"Continue in {self.survivor}.", item["summary"]["next"])
                self.assertEqual("one parser bug", item["summary"]["why"])
                closing = [e for e in item["events"] if e["action"] == "transitioned"][-1]
                self.assertEqual(f"cancelled: duplicate of {self.survivor}", closing["detail"])
        survivor = self.get(self.survivor)
        self.assertEqual("backlog", survivor["state"]["key"])
        self.assertEqual(
            f"Merged {self.first}, {self.second} into this item: 3 steps, 2 comments,"
            " 1 ref and 2 links moved here. one parser bug",
            survivor["comments"][-1]["body"],
        )

    def test_the_answer_is_the_survivor_and_what_each_item_moved(self) -> None:
        self.assertEqual(self.survivor, self.answer["reference"])
        self.assertEqual(
            [
                {
                    "reference": self.first,
                    "work_item_id": self.before[self.first]["work_item_id"],
                    "state": "cancelled",
                    "moved": {"steps": 2, "comments": 2, "refs": 1, "links": 2},
                },
                {
                    "reference": self.second,
                    "work_item_id": self.before[self.second]["work_item_id"],
                    "state": "cancelled",
                    "moved": {"steps": 1, "comments": 0, "refs": 0, "links": 0},
                },
            ],
            self.answer["merged"],
        )
        self.assertEqual(self.get(self.survivor)["revision"], self.answer["revision"])

    def test_history_stays_on_both_sides_in_actions_every_build_reads(self) -> None:
        for reference in (self.survivor, self.first, self.second, self.waiting, self.related):
            with self.subTest(reference):
                before = len(self.before[reference]["events"]) if reference in self.before else None
                events = self.get(reference)["events"]
                written = events[before:] if before is not None else events
                self.assertLessEqual(
                    {event["action"] for event in written} - {"created", "linked"},
                    EARLIER_ACTIONS,
                )
        first = self.get(self.first)["events"]
        self.assertTrue(set(model.EVENT_ACTIONS) >= {event["action"] for event in first})
        self.assertIn(
            "checklist_completed", [event["action"] for event in first]
        )  # the tick before the merge is still its own history


class MergeRefusalTests(MergeTestCase):
    def test_what_cannot_be_one_change_is_refused_before_anything_is_written(self) -> None:
        service.create_planning_space(self.conn, project_id="far", name="Far", key="FAR")
        elsewhere = str(service.create_work_item(self.conn, space="FAR", title="Far")["reference"])
        closed = self.item("Closed")
        service.set_summary(self.conn, closed, {"done": "d", "next": "n"})
        service.transition_work_item(self.conn, closed, "done")
        epic = self.item("Umbrella", kind="epic")
        self.item("Under it", parent=epic)
        for name, items, message in (
            ("itself", [self.survivor], "is the item the others merge into"),
            ("twice", [self.first, self.first], "is named twice"),
            ("another space", [elsewhere], "lives in another planning space"),
            ("a closed item", [self.first, closed], "is already closed in Done"),
            ("children", [epic], "has 1 child item(s)"),
            ("nothing", [], "items must list 1 to 20"),
            ("too many", [self.first] * 21, "items must list 1 to 20"),
            ("unknown", ["MRG-99"], "no work item MRG-99"),
        ):
            with self.subTest(name):
                self.assertIn(message, self.refused(*items))

    def test_a_closed_survivor_is_reopened_first(self) -> None:
        service.set_summary(self.conn, self.survivor, {"done": "d", "next": "n"})
        service.transition_work_item(self.conn, self.survivor, "done")
        self.assertIn("is closed; reopen it", self.refused(self.first))

    def test_a_checklist_past_its_limit_is_refused(self) -> None:
        service.set_checklist(self.conn, self.survivor, [f"s{n}" for n in range(60)])
        service.set_checklist(self.conn, self.first, [f"f{n}" for n in range(41)])
        self.assertIn("would hold 101 checklist steps", self.refused(self.first))

    def test_a_workflow_with_no_way_to_cancel_is_refused(self) -> None:
        self.conn.execute(
            "DELETE FROM workflow_transitions WHERE to_state_id IN"
            " (SELECT state_id FROM workflow_states WHERE category = 'cancelled')"
        )
        self.assertIn("has no cancelled state it can move to", self.refused(self.first))

    def test_a_stale_survivor_revision_is_refused(self) -> None:
        stale = self.get(self.survivor)["revision"]
        service.set_checklist(self.conn, self.survivor, ["changed"])
        before = self.snapshot()
        with self.assertRaises(model.RevisionConflictError):
            self.merge(self.first, expected_revision=stale)
        self.assertEqual(before, self.snapshot())

    def test_a_write_refused_late_undoes_every_write_before_it(self) -> None:
        service.set_checklist(self.conn, self.first, ["one"])
        service.comment_work_item(self.conn, self.first, "talk")
        service.link_work_items(self.conn, self.first, self.item("Elsewhere"), "blocks")
        self.conn.commit()
        real = service.transition_work_item
        calls = []

        def second_close_fails(*arguments: object, **keywords: object) -> dict:
            calls.append(arguments[1])
            if len(calls) == 2:
                raise model.WorkflowGuardError("[summary] refused late")
            return real(*arguments, **keywords)  # type: ignore[arg-type]

        before = self.snapshot()
        with (
            mock.patch.object(service, "transition_work_item", second_close_fails),
            self.assertRaises(model.WorkflowGuardError),
        ):
            self.merge(self.first, self.second)
        self.assertEqual(2, len(calls))
        self.assertEqual(before, self.snapshot())


class MergeClaimTests(MergeTestCase):
    def call(self, session: str | None, **arguments: object) -> dict:
        meta = {"sessionId": session, "threadId": session} if session else None
        try:
            answer = mcp_surface.call_tool(self.conn, "merge_work_items", arguments, meta=meta)
        except model.PlanningError as refusal:
            self.conn.rollback()
            return {"refused": str(refusal)}
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def claim(self, reference: str, session: str) -> None:
        mcp_surface.call_tool(
            self.conn, "claim_work_item", {"id": reference}, meta={"sessionId": session}
        )
        self.conn.commit()

    def test_an_item_another_session_holds_needs_force(self) -> None:
        for held in (self.survivor, self.first):
            with self.subTest(held):
                self.claim(held, OTHER)
                before = self.snapshot()
                refused = self.call(SESSION, id=self.survivor, items=[self.first])
                self.assertIn(f"{held} is held by codex (session {OTHER})", refused["refused"])
                self.assertEqual(before, self.snapshot())
                service.claim_work_item(self.conn, held, release=True, force=True)
                self.conn.commit()

    def test_force_carries_another_claim_through_on_the_record(self) -> None:
        self.claim(self.first, OTHER)
        answer = self.call(SESSION, id=self.survivor, items=[self.first], force=True)
        self.assertEqual([f"{self.first}: claim"], answer["overridden"])
        first = self.get(self.first)
        self.assertEqual(("cancelled", ""), (first["state"]["key"], first["claim_ref"]))
        actions = [event["action"] for event in first["events"]]
        self.assertIn("overridden", actions)
        self.assertEqual("released", actions[actions.index("overridden") - 1])

    def test_my_own_claims_and_a_stale_one_do_not_stand_in_the_way(self) -> None:
        self.claim(self.survivor, SESSION)
        self.claim(self.first, SESSION)
        self.claim(self.second, OTHER)
        self.conn.execute("UPDATE sessions SET status = 'ended' WHERE id = ?", (OTHER,))
        self.conn.commit()
        answer = self.call(SESSION, id=self.survivor, items=[self.first, self.second])
        self.assertNotIn("refused", answer)
        self.assertNotIn("overridden", answer)
        self.assertEqual(f"codex (session {SESSION})", answer["claim_ref"])
        self.assertEqual("", self.get(self.first)["claim_ref"])

    def test_the_call_is_recorded_against_the_survivor(self) -> None:
        service.set_checklist(self.conn, self.first, ["moves first in time"])
        self.conn.commit()
        self.call(SESSION, id=self.survivor, items=[self.first])
        recorded = self.conn.execute(
            "SELECT work_item_id FROM execution_events WHERE tool = 'merge_work_items'"
        ).fetchall()
        self.assertEqual([self.get(self.survivor)["work_item_id"]], [row[0] for row in recorded])
        self.assertIn(
            SESSION,
            {
                s["session_id"]
                for s in service.get_work_item(self.conn, self.survivor, sessions=True)["sessions"]
            },
        )


class MergeSurfaceTests(MergeTestCase):
    def test_the_tool_answers_briefly_with_what_moved(self) -> None:
        service.set_checklist(self.conn, self.first, ["one"])
        answer = mcp_surface.call_tool(
            self.conn, "merge_work_items", {"id": self.survivor, "items": [self.first]}
        )
        self.assertEqual(
            {
                "reference",
                "url",
                "work_item_id",
                "revision",
                "state",
                "claim_ref",
                "claim_state",
                "merged",
            },
            set(answer),
        )
        self.assertEqual(
            {"steps": 1, "comments": 0, "refs": 0, "links": 0}, answer["merged"][0]["moved"]
        )
        verbose = mcp_surface.call_tool(
            self.conn,
            "merge_work_items",
            {"id": self.survivor, "items": [self.second], "verbose": True},
        )
        self.assertIn("checklist", verbose)

    def test_the_tool_publishes_its_arguments(self) -> None:
        [tool] = [t for t in mcp_surface.catalogue() if t["name"] == "merge_work_items"]
        schema = tool["inputSchema"]
        self.assertEqual(["id", "items"], schema["required"])
        self.assertEqual(service.MAX_MERGE_ITEMS, schema["properties"]["items"]["maxItems"])
        self.assertFalse(tool["annotations"]["destructiveHint"])

    def test_the_answer_warns_of_what_the_merge_left_or_carried_elsewhere(self) -> None:
        epic = self.item("Elsewhere", kind="epic")
        child = self.item("Under another epic", parent=epic)
        requests.create(
            self.conn,
            child,
            kind="question",
            prompt="Which parser?",
            fields=[
                {"id": "reply", "label": "Reply", "type": "text", "required": True, "options": []}
            ],
        )
        answer = self.merge(child)
        self.assertEqual(
            [
                f"{child} stays under {epic}; {self.survivor} keeps its own parent",
                f"{child}'s 1 pending request(s) now wait on {self.survivor}",
            ],
            answer["warnings"],
        )


if __name__ == "__main__":
    unittest.main()
