"""Adding and removing labels without sending the whole set.

`labels` replaces an item's labels, so an agent that meant to add one sent
`labels: ["observation"]` and erased the two the item had. `labels_add` and
`labels_remove` change the set the item has. Every write surface reaches the same
edit, so each case runs through all four: the single tool and the batch's `update`
group over MCP, and the two HTTP routes they stand for.
"""

from __future__ import annotations

from collections.abc import Callable

from server.planning import api, model, service, tools
from tests.test_planning_apply_groups import BatchCase

#: The item's labels before every case.
BEFORE = ["bug", "triage"]


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

    def test_the_tool_schemas_declare_the_new_fields_beside_labels(self) -> None:
        declared = {tool["name"]: tool["inputSchema"] for tool in tools.TOOLS}
        single = declared["update_work_item"]["properties"]
        batch = declared["apply_work_item_changes"]["properties"]["update"]["properties"]
        for properties in (single, batch):
            for name in ("labels", "labels_add", "labels_remove"):
                self.assertEqual("array", properties[name]["type"], name)
                self.assertEqual({"type": "string"}, properties[name]["items"], name)
        self.assertEqual(set(single) - {"id", "expected_revision", "author", "verbose"}, set(batch))
