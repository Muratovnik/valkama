"""A triage review run by the procedure the skill ships, through the agent's tools.

The expectations come from that procedure (`references/triage.md` of the skill) and
the contract it rests on: an obvious repeat is merged into the older item after its
evidence is copied there as a comment; a doubtful repeat is a decision on the newer
item, which holds it out of the stack while the owner is asked and comes back
answered by its recommendation where the setting leaves decisions to the agent;
tasks of one topic go under a proposed goal, whose answer waits for the owner at the
default setting; and every item the review leaves as it is gets its mark. What a
review leaves is read as the procedure reads it, by `list_work_items` with
`triage_stack`.

Another session files the findings, as work met by other work is filed. The space
stands at the default set, where findings, proposed goals and decisions are the
owner's.
"""

from __future__ import annotations

import json
import unittest

from server.planning import participation
from tests.test_planning_pending_actions import OTHER
from tests.test_planning_triage_groups import GroupHarness

#: The day a group the review puts off waits for.
UNTIL = "2026-12-01"


def doubt(older: str) -> dict:
    """The decision the procedure asks of a doubtful repeat: merge into the older item,
    which it recommends, or keep both."""

    return {
        "kind": "decision",
        "prompt": f"Is this the defect {older} already holds?",
        "fields": [
            {
                "id": "answer",
                "label": "Answer",
                "type": "choice",
                "required": True,
                "options": [
                    {
                        "id": "merge",
                        "label": f"Merge into {older}",
                        "recommended": True,
                        "why": "The same message at the same step",
                    },
                    {"id": "keep", "label": "Keep both"},
                ],
            }
        ],
    }


class ReviewHarness(GroupHarness):
    """The agent's steps of the procedure, and the stack as it reads it."""

    def found(self, *titles: str) -> list[str]:
        """Findings another session filed: tasks with no parent lying in triage."""

        return [self.filed(title, by=OTHER) for title in titles]

    def stack(self, seen: str) -> list[str]:
        """What `list_work_items` gives for the space with this `triage_stack`, in order."""

        answer = self.tool("list_work_items", space="ALPHA", triage_stack=seen)
        return [str(row["reference"]) for row in answer["work_items"]]

    def label(self, items: list[str], topic: str) -> None:
        for item in items:
            self.tool(
                "apply_work_item_changes",
                id=item,
                update={"labels_add": [topic], "priority": "medium"},
            )

    def merge(self, survivor: str, repeat: str) -> None:
        """The evidence the survivor lacks as a comment on it, then the merge."""

        self.tool(
            "apply_work_item_changes",
            id=survivor,
            comment={"body": f"Evidence from {repeat}: an export of 3 rows wrote 2."},
        )
        self.tool("merge_work_items", id=survivor, items=[repeat])

    def ask_doubt(self, newer: str, older: str) -> dict:
        """The decision on the newer item of a doubtful pair, as the batch answers it."""

        answer = self.tool("apply_work_item_changes", id=newer, questions=[doubt(older)])
        [asked] = answer["applied"]["questions"]
        return dict(self.request(str(asked["request_id"])))

    def leave(self, item: str, why: str | None = None) -> None:
        """The mark on an item the review leaves as it is, with its reason when one helps."""

        groups: dict[str, object] = {"triage_seen": True}
        if why is not None:
            groups["comment"] = {"body": why}
        self.tool("apply_work_item_changes", id=item, **groups)

    def links(self, item: str) -> set[tuple[str, str, str]]:
        return {
            (link["kind"], link["direction"], link["reference"])
            for link in self.card(item)["links"]
        }

    def category(self, item: str) -> str:
        return str(self.card(item)["state"]["category"])


class ReviewTests(ReviewHarness):
    def test_a_review_leaves_groups_merges_and_marks(self) -> None:
        """O1: one review at the default set merges a repeat, asks about a doubtful one,
        proposes two groups and marks what it leaves, and the stack holds nothing unmarked."""

        f1, f2 = self.found("Export drops the last row", "The last row is missing from exports")
        f3, f4 = self.found("Import rejects a padded header", "Import fails on a header")
        tasks = self.found(*(f"Export: write field {name}" for name in "ABCD"))
        docs = self.found(*(f"Docs: describe command {name}" for name in "XYZ"))
        s1, s2 = self.found("The CLI help is terse", "The board flickers on resize")
        review = str(
            self.tool(
                "create_work_item",
                space="ALPHA",
                title="Triage review of ALPHA",
                acceptance="assignment",
                claim=True,
            )["reference"]
        )

        self.label([f1, f2, *tasks], "export")
        self.label([f3, f4], "import")
        self.label(docs, "docs")
        self.label([s1, s2], "ux")
        self.merge(f1, f2)
        decision = self.ask_doubt(f4, f3)
        first = self.group(tasks, title="Export writes every field")
        second = self.group(docs, "later", title="Docs catch up", group={"until": UNTIL})
        self.leave(f1)
        self.leave(f3)
        self.leave(s1, "Left: the CLI help is rewritten with the next release")
        self.leave(s2)
        self.tool(
            "apply_work_item_changes",
            id=review,
            summary={
                "done": "Merged 1; 2 groups (do 4, later 3); 1 decision asked; 4 marked.",
                "next": "The owner answers the groups and the decision.",
            },
            transition={"state": "completed"},
        )

        # The repeat closed into the older item.
        self.assertEqual("cancelled", self.category(f2))
        self.assertIn(("duplicates", "outgoing", f1), self.links(f2))
        # Both groups wait for the owner in triage, their tasks under them.
        for answer, members in ((first, tasks), (second, docs)):
            goal = str(answer["reference"])
            self.assertFalse(answer["applied"]["group"]["carried_out"])
            self.assertEqual(("triage", None, None), self.where(goal))
            [waits] = self.waiting_on(goal)
            question = self.request(str(answer["waits_for_owner"]["question"]))
            self.assertEqual(
                (waits.id, "triage", "pending"),
                (question["action_id"], question["purpose"], question["status"]),
            )
            for task in members:
                self.assertEqual(("triage", None, goal), self.where(task))
        # The doubtful repeat waits for the owner's decision, out of the stack.
        self.assertEqual(("decision", "pending"), (decision["kind"], decision["status"]))
        self.assertNotIn("triage_stack", self.card(f4))
        # Nothing waits unmarked; what the review left is marked, oldest entry first.
        self.assertEqual([], self.stack("unseen"))
        self.assertEqual([f1, f3, s1, s2], self.stack("seen"))
        # The review cancelled nothing but the merged repeat, and its own item is done.
        cancelled = [
            item
            for item in (f1, f2, f3, f4, *tasks, *docs, s1, s2)
            if self.category(item) == "cancelled"
        ]
        self.assertEqual([f2], cancelled)
        self.assertEqual("completed", self.category(review))

    def test_a_doubtful_repeat_is_a_decision(self) -> None:
        """O24: the decision on the newer item holds it out of the stack while the owner is
        asked; where decisions are the agent's it comes back answered by its recommendation,
        the item stays in the stack, and the review acts on the answer."""

        older, newer = self.found("Import rejects a padded header", "Import fails on a header")
        asked = self.ask_doubt(newer, older)
        self.assertEqual("pending", asked["status"])
        self.assertIn(str(asked["request_id"]), self.owners_list())
        self.assertNotIn("triage_stack", self.card(newer))
        self.assertEqual([older], self.stack("unseen"))
        # The owner keeps both: the item is back in the stack, unmarked, for the next review.
        self.answer(str(asked["request_id"]), "keep")
        self.assertEqual([older, newer], self.stack("unseen"))
        self.assertEqual({"seen_at": None, "seen_by": None}, self.card(newer)["triage_stack"])

        self.at(participation.MINIMAL)
        first, second = self.found("Search misses a quoted word", "Search ignores quotes")
        answered = self.ask_doubt(second, first)
        self.assertEqual("answered", answered["status"])
        self.assertEqual("merge", json.loads(answered["answers_json"])["answer"])
        self.assertNotIn(str(answered["request_id"]), self.owners_list())
        self.assertEqual([older, newer, first, second], self.stack("unseen"))
        self.assertEqual(["decision"], [point for point, _item, _what in self.decided()])
        # The review merges as the answer says.
        self.merge(first, second)
        self.assertEqual("cancelled", self.category(second))
        self.assertIn(("duplicates", "outgoing", first), self.links(second))
        self.assertEqual([older, newer, first], self.stack("unseen"))

    def test_a_repeat_found_after_filing_is_merged(self) -> None:
        """O25: a finding filed again is named by `similar`; the comment that carries its
        evidence and the merge take the older item's mark away, so it waits unmarked."""

        [older] = self.found("Export drops the last row")
        self.leave(older)
        self.assertEqual([older], self.stack("seen"))
        work = str(
            self.tool(
                "create_work_item",
                space="ALPHA",
                title="Speed up the export",
                acceptance="assignment",
                claim=True,
            )["reference"]
        )

        filed = self.tool(
            "create_work_item",
            space="ALPHA",
            title="Export drops the last row",
            labels=["export"],
            links=[{"other": work, "kind": "discovered-from"}],
        )
        repeat = str(filed["reference"])
        self.assertIn(older, [entry["reference"] for entry in filed["similar"]])
        self.assertEqual(("triage", None, None), self.where(repeat))
        self.merge(older, repeat)

        self.assertEqual({"seen_at": None, "seen_by": None}, self.card(older)["triage_stack"])
        self.assertEqual([], self.stack("seen"))
        self.assertEqual([older], self.stack("unseen"))
        self.assertEqual("cancelled", self.category(repeat))
        self.assertIn(("duplicates", "outgoing", older), self.links(repeat))


if __name__ == "__main__":
    unittest.main()
