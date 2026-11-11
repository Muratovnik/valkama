"""Adding and removing labels without sending the whole set.

`labels` replaces an item's labels, so an agent that meant to add one sent
`labels: ["observation"]` and erased the two the item had. `labels_add` and
`labels_remove` change the set the item has. Every write surface reaches the same
edit, so each case runs through all four: the single tool and the batch's `update`
group over MCP, and the two HTTP routes they stand for. Each edit that changes the set,
by whichever field, leaves one `labels_changed` event with the set before and after;
one that leaves the set as it was leaves none.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path

from server.planning import api, model, service, tools
from tests.test_planning_apply_groups import BatchCase

#: The item's labels before every case.
BEFORE = ["bug", "triage"]
#: Where the web lists the actions its strict reader accepts.
WEB_ACTIONS = (
    Path(__file__).resolve().parents[1]
    / "web"
    / "src"
    / "shared"
    / "api"
    / "planningEventActions.ts"
)


class LabelEditTests(BatchCase):
    def setUp(self) -> None:
        super().setUp()
        service.update_work_item(self.conn, self.ref, labels=BEFORE)
        self.conn.commit()

    def surfaces(self) -> dict[str, Callable[..., object]]:
        """Each write surface, as one call that edits this item with the fields given."""

        def http(path: str, **payload: object) -> object:
            answer = api.handle_post(self.conn, path, payload)
            self.conn.commit()
            return answer

        return {
            "update_work_item": lambda **edit: self.agent("update_work_item", id=self.ref, **edit),
            "apply_work_item_changes": lambda **edit: self.apply(update=edit),
            "POST work-item/update": lambda **edit: http(
                "/api/planning/work-item/update", id=self.ref, **edit
            ),
            "POST work-item/apply": lambda **edit: http(
                "/api/planning/work-item/apply", id=self.ref, update=edit
            ),
        }

    def each_surface(self, edit: dict, expected: list[str]) -> None:
        for name, write in self.surfaces().items():
            with self.subTest(surface=name):
                service.update_work_item(self.conn, self.ref, labels=BEFORE)
                self.conn.commit()
                write(**edit)
                self.assertEqual(expected, self.record()["labels"])

    def test_an_added_label_joins_the_ones_the_item_has(self) -> None:
        self.each_surface({"labels_add": ["observation"]}, [*BEFORE, "observation"])

    def test_a_removed_label_leaves_the_rest(self) -> None:
        self.each_surface({"labels_remove": ["bug"]}, ["triage"])

    def test_adding_a_label_the_item_has_keeps_it_once_and_in_place(self) -> None:
        self.each_surface({"labels_add": ["triage", "triage", "new"]}, [*BEFORE, "new"])

    def test_removing_a_label_the_item_lacks_changes_nothing(self) -> None:
        self.each_surface({"labels_remove": ["absent"]}, BEFORE)

    def test_add_and_remove_in_one_edit_apply_together(self) -> None:
        self.each_surface({"labels_add": ["next"], "labels_remove": ["bug"]}, ["triage", "next"])

    def test_labels_still_replaces_the_whole_set(self) -> None:
        self.each_surface({"labels": ["only"]}, ["only"])

    def test_an_edit_that_leaves_the_set_as_it_was_names_no_changed_field(self) -> None:
        # As `labels` sent with the set the item has: the call row's `reason` is
        # the record of what an edit changed, and here it changed nothing.
        for edit in ({"labels_add": ["bug"]}, {"labels_remove": ["absent"]}, {"labels_add": []}):
            with self.subTest(edit=edit):
                self.agent("update_work_item", id=self.ref, **edit)
                self.assertEqual(BEFORE, self.record()["labels"])
                self.assertIsNone(self.call_rows()[-1]["reason"])

    def test_the_answer_names_the_fields_sent(self) -> None:
        single = self.agent("update_work_item", id=self.ref, labels_add=["x"], labels_remove=["y"])
        self.assertEqual(["labels_add", "labels_remove"], single["updated"])
        batch = self.apply(update={"labels_add": ["z"]})
        self.assertEqual(["labels_add"], batch["applied"]["update"])

    def test_the_call_row_names_the_labels_column_it_changed(self) -> None:
        self.agent("update_work_item", id=self.ref, labels_add=["observation"])
        self.assertEqual("labels", self.call_rows()[-1]["reason"])

    def test_a_contradictory_or_malformed_edit_is_refused_by_every_surface(self) -> None:
        refusals = (
            ({"labels": ["only"], "labels_add": ["observation"]}, "send one or the other"),
            ({"labels": ["only"], "labels_remove": ["bug"]}, "send one or the other"),
            ({"labels_add": ["bug"], "labels_remove": ["bug"]}, "both labels_add and"),
            ({"labels_add": "observation"}, "labels_add must be a list"),
            ({"labels_remove": [5]}, r"labels_remove\[0\]"),
            ({"labels_add": [f"l{n}" for n in range(model.MAX_LABELS - 1)]}, "at most 32"),
        )
        for edit, message in refusals:
            for name, write in self.surfaces().items():
                with self.subTest(edit=edit, surface=name):
                    before = self.untouched()
                    with self.assertRaisesRegex(
                        (model.PlanningError, api.PlanningHttpError), message
                    ):
                        write(**edit)
                    # Committed, as a surface commits what a refused handler leaves.
                    self.conn.commit()
                    self.assertEqual(before, self.untouched())

    def label_events(self) -> list[object]:
        """The details of the item's `labels_changed` events, oldest first, as JSON read back."""

        return [
            json.loads(str(row[0]))
            for row in self.conn.execute(
                "SELECT detail FROM work_item_events WHERE work_item_id = ?"
                " AND action = 'labels_changed' ORDER BY id",
                (self.record()["work_item_id"],),
            )
        ]

    def each_surface_records(self, edit: dict, after: list[str] | None) -> None:
        """Through every surface, the edit leaves one event from `BEFORE` to `after`, or none."""

        for name, write in self.surfaces().items():
            with self.subTest(surface=name):
                service.update_work_item(self.conn, self.ref, labels=BEFORE)
                self.conn.commit()
                seen = len(self.label_events())
                write(**edit)
                expected = [] if after is None else [{"from": BEFORE, "to": after}]
                self.assertEqual(expected, self.label_events()[seen:])

    def test_a_replaced_set_is_recorded_with_both_sets(self) -> None:
        self.each_surface_records({"labels": ["only"]}, ["only"])

    def test_an_added_label_is_recorded_with_both_sets(self) -> None:
        self.each_surface_records({"labels_add": ["observation"]}, [*BEFORE, "observation"])

    def test_a_removed_label_is_recorded_with_both_sets(self) -> None:
        self.each_surface_records({"labels_remove": ["bug"]}, ["triage"])

    def test_one_edit_that_adds_and_removes_is_one_event(self) -> None:
        self.each_surface_records(
            {"labels_add": ["next"], "labels_remove": ["bug"]}, ["triage", "next"]
        )

    def test_an_edit_that_leaves_the_set_as_it_was_records_no_event(self) -> None:
        unchanged = (
            {"labels": BEFORE},
            # Reordered, the set is the same set.
            {"labels": list(reversed(BEFORE))},
            {"labels_add": ["bug"]},
            {"labels_remove": ["absent"]},
            {"labels_add": []},
            {"title": "Renamed, labels untouched"},
        )
        for edit in unchanged:
            with self.subTest(edit=edit):
                self.each_surface_records(edit, None)

    def test_the_event_stands_in_the_history_under_the_call_that_made_it(self) -> None:
        self.agent("update_work_item", id=self.ref, labels_add=["observation"])
        newest = self.record()["events"][-1]
        self.assertEqual("labels_changed", newest["action"])
        self.assertEqual(
            {"from": BEFORE, "to": [*BEFORE, "observation"]}, json.loads(newest["detail"])
        )
        self.assertEqual("confirmed", newest["identity"]["state"])

    def test_full_sets_of_the_longest_labels_are_recorded_whole(self) -> None:
        # Quotes and control characters are what JSON escapes, so they make the longest detail.
        width = model.MAX_LABEL_LENGTH - 2
        old = [f"{n:02d}" + '"' * width for n in range(model.MAX_LABELS)]
        new = [f"{n:02d}" + "\x01" * width for n in range(model.MAX_LABELS)]
        service.update_work_item(self.conn, self.ref, labels=old)
        self.agent("update_work_item", id=self.ref, labels=new)
        detail = self.label_events()[-1]
        self.assertEqual({"from": old, "to": new}, detail)
        self.assertGreater(len(model.dumps(detail)), service.EVENT_DETAIL_LIMIT)
        self.assertLessEqual(len(model.dumps(detail)), model.LABELS_DETAIL_LIMIT)

    def test_the_web_reads_every_action_and_the_longest_detail_the_server_writes(self) -> None:
        # The card's strict reader refuses an item over an action or a detail it does not
        # expect, so the two lists and the two bounds move together.
        source = WEB_ACTIONS.read_text(encoding="utf-8")
        listed = source.split("export const EVENT_ACTIONS = [", 1)[1].split("]", 1)[0]
        self.assertEqual(set(model.EVENT_ACTIONS), set(re.findall(r"'([a-z_]+)'", listed)))
        bound = re.search(r"LABELS_DETAIL_MAX = ([\d_]+)", source)
        assert bound is not None
        self.assertEqual(model.LABELS_DETAIL_LIMIT, int(bound.group(1).replace("_", "")))

    def test_the_tool_schemas_declare_the_new_fields_beside_labels(self) -> None:
        declared = {tool["name"]: tool["inputSchema"] for tool in tools.TOOLS}
        single = declared["update_work_item"]["properties"]
        batch = declared["apply_work_item_changes"]["properties"]["update"]["properties"]
        for properties in (single, batch):
            for name in ("labels", "labels_add", "labels_remove"):
                self.assertEqual("array", properties[name]["type"], name)
                self.assertEqual({"type": "string"}, properties[name]["items"], name)
        self.assertEqual(set(single) - {"id", "expected_revision", "author", "verbose"}, set(batch))
