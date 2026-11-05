"""A one-line text is refused for its length or for a control character, never one for the other.

A step may be 1000 characters long, but the control-character pattern used to stop at 512, so a
step of 513 to 1000 characters was refused as if it held a control character.
"""

from __future__ import annotations

import unittest

from server.planning import model


class TextFieldTests(unittest.TestCase):
    def test_a_step_up_to_its_own_limit_is_accepted(self) -> None:
        text = "a" * model.MAX_CHECKLIST_TEXT
        self.assertEqual(model.new_checklist_item(text)["text"], text)
        steps = model.checklist([{"text": "b" * 600}])
        self.assertEqual(len(steps[0]["text"]), 600)

    def test_a_step_over_its_limit_is_refused_for_its_length(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, "at most 1000 characters"):
            model.new_checklist_item("a" * (model.MAX_CHECKLIST_TEXT + 1))

    def test_a_control_character_is_still_refused_at_any_length(self) -> None:
        # Inside the text: a trailing one is stripped as whitespace before the check.
        for text in ("a\rb", "a\x00b", "a" * 700 + "\rb"):
            with (
                self.subTest(length=len(text)),
                self.assertRaisesRegex(model.PlanningError, "must not contain control characters"),
            ):
                model.text_field(text, "x", limit=model.MAX_CHECKLIST_TEXT)

    def test_a_shorter_limit_still_holds(self) -> None:
        with self.assertRaisesRegex(model.PlanningError, "at most 200 characters"):
            model.text_field("a" * (model.MAX_TITLE + 1), "work_item.title")


if __name__ == "__main__":
    unittest.main()
