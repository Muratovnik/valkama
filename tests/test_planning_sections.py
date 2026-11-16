"""A description read by sections: by heading, or by paragraph when it has none.

An agent that wants to refresh one piece of a long description reads that piece by
its key. The keys come from the text on every read, so these hold what an edit
does to them: an edit to one section leaves every other key alone, and a key whose
text is gone is refused with the keys there are rather than read as other text.
"""

from __future__ import annotations

import hashlib
import unittest

from server.planning import api, model, sections
from tests.test_planning_card import CardCase

PLAN = "Why this exists.\n\n# Plan\nFirst do this.\n\n## Steps\nOne, two.\n\n# Notes\nAside.\n"


def keys(description: str) -> list[str]:
    return [entry["key"] for entry in sections.contents(description)]


def paragraph_key(text: str) -> str:
    """The key the contract gives a paragraph: `p` and its hash's first 8 hex digits."""

    return "p" + hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()[:8]


class KeyTests(unittest.TestCase):
    def test_a_heading_opens_a_section_that_holds_its_subsections(self) -> None:
        start, plan, steps, notes = (
            "Why this exists.\n\n",
            "# Plan\nFirst do this.\n\n## Steps\nOne, two.\n\n",
            "## Steps\nOne, two.\n\n",
            "# Notes\nAside.\n",
        )
        self.assertEqual(
            [
                {"key": "(start)", "level": 0, "chars": len(start)},
                {"key": "Plan", "level": 1, "chars": len(plan)},
                {"key": "Steps", "level": 2, "chars": len(steps)},
                {"key": "Notes", "level": 1, "chars": len(notes)},
            ],
            sections.contents(PLAN),
        )
        self.assertEqual(
            [start, plan, steps, notes],
            [entry["text"] for entry in sections.named(PLAN, keys(PLAN))],
        )
        # The sections no other holds, in order, are the description without loss.
        self.assertEqual(PLAN, start + plan + notes)

    def test_an_edit_to_a_section_changes_no_key(self) -> None:
        edits = (
            PLAN.replace("First do this.", "First do this, then that.\n\nAnd more."),
            PLAN.replace("Why this exists.", "Why."),
            PLAN.replace("## Steps", "## Steps taken"),
            PLAN.replace("Aside.", "Aside, at length."),
        )
        before = keys(PLAN)
        self.assertEqual(before, keys(edits[0]))
        self.assertEqual(before, keys(edits[1]))
        # Another heading renamed changes that heading's key and no other.
        self.assertEqual(["(start)", "Plan", "Steps taken", "Notes"], keys(edits[2]))
        self.assertEqual(before, keys(edits[3]))

    def test_a_repeated_key_is_numbered_in_order(self) -> None:
        text = "Lead.\n# Plan\na\n# plan\nb\n## Plan\nc\n# (start)\nd\n"
        self.assertEqual(["(start)", "Plan", "plan (2)", "Plan (3)", "(start) (2)"], keys(text))
        # The numbered key reads its own section, and keys compare without case.
        self.assertEqual("# plan\nb\n## Plan\nc\n", sections.named(text, ["PLAN (2)"])[0]["text"])

    def test_a_hash_in_a_fenced_block_opens_no_section(self) -> None:
        for fence in ("```", "~~~", "````"):
            with self.subTest(fence=fence):
                text = f"# Run\n{fence}sh\n# a comment, not a heading\n{fence}\n# After\nx"
                self.assertEqual(["Run", "After"], keys(text))
        # A fence of the other mark does not close the block.
        self.assertEqual(["Run"], keys("# Run\n```\n~~~\n# still code\n```\n"))

    def test_a_line_that_is_not_a_heading_opens_nothing(self) -> None:
        for line in ("#tag", "####### seven", " # indented", "#"):
            with self.subTest(line=line):
                self.assertEqual([paragraph_key(f"Lead.\n{line}\nx")], keys(f"Lead.\n{line}\nx"))
        self.assertEqual(["C# notes"], keys("## C#   notes ##\nx"))

    def test_without_headings_paragraphs_are_the_sections(self) -> None:
        first, code, last = "One para\nline two", "```\ncode\n\nmore code\n```", "Last  one."
        text = f"{first}\n\n\n{code}\n\n{last}\n"
        self.assertEqual(
            [
                {"key": paragraph_key(first), "chars": len(first), "starts": "One para line two"},
                {
                    "key": paragraph_key(code),
                    "chars": len(code),
                    "starts": "``` code more code ```",
                },
                {"key": paragraph_key(last), "chars": len(last), "starts": "Last one."},
            ],
            sections.contents(text),
        )
        # An edit to one paragraph changes its key alone.
        edited = keys(text.replace("Last  one.", "Last one, changed."))
        self.assertEqual(keys(text)[:2], edited[:2])
        self.assertNotEqual(keys(text)[2], edited[2])
        self.assertEqual(paragraph_key(first), keys(text.replace("One para", "One  para"))[0])
        long = "word " * 40
        self.assertEqual(" ".join(long.split())[:60], sections.contents(long)[0]["starts"])

    def test_a_key_gone_is_refused_with_the_keys_there_are(self) -> None:
        renamed = PLAN.replace("# Notes", "# Remarks")
        with self.assertRaises(model.PlanningError) as caught:
            sections.named(renamed, ["Notes"])
        self.assertEqual(
            "unknown section 'Notes'; sections are (start), Plan, Steps, Remarks",
            str(caught.exception),
        )
        many = "\n".join(f"# H{number}\nx" for number in range(23))
        with self.assertRaises(model.PlanningError) as caught:
            sections.named(many, ["H1", "nope"])
        listed = ", ".join(f"H{number}" for number in range(20))
        self.assertEqual(
            f"unknown section 'nope'; sections are {listed} and 3 more", str(caught.exception)
        )
        paragraph = paragraph_key("Old text.")
        with self.assertRaises(model.PlanningError):
            sections.named("New text.", [paragraph])

    def test_the_named_sections_come_once_in_the_description_order(self) -> None:
        read = sections.named(PLAN, ["Notes", "(start)", "notes"])
        self.assertEqual(
            [
                {"key": "(start)", "level": 0, "chars": 18, "text": "Why this exists.\n\n"},
                {"key": "Notes", "level": 1, "chars": 15, "text": "# Notes\nAside.\n"},
            ],
            read,
        )


class ReadTests(CardCase):
    def setUp(self) -> None:
        super().setUp()
        self.ref = self.item("Sections", description=PLAN)
        # The store keeps a description without its closing line break.
        self.text = str(self.http()["description"])
        self.assertEqual(PLAN.rstrip(), self.text)

    def test_the_sections_part_reads_the_contents(self) -> None:
        answer = self.read(parts=["sections"])
        revision = int(self.http()["revision"])
        self.assertEqual(
            {"reference": self.ref, "revision": revision, "sections": sections.contents(self.text)},
            answer,
        )
        self.assertEqual(
            ["(start)", "Plan", "Steps", "Notes"], [entry["key"] for entry in answer["sections"]]
        )

    def test_section_without_parts_reads_the_named_sections_alone(self) -> None:
        self.assertEqual(
            {
                "reference": self.ref,
                "revision": int(self.http()["revision"]),
                "sections": sections.named(self.text, ["Steps"]),
            },
            self.read(section="Steps"),
        )
        self.assertEqual(
            sections.named(self.text, ["Plan", "Notes"]),
            self.read(section=["Notes", "Plan"])["sections"],
        )
        beside = self.read(parts=["card", "sections"], section="Notes")
        self.assertEqual("Sections", beside["title"])
        self.assertEqual(["Notes"], [entry["key"] for entry in beside["sections"]])

    def test_http_reads_a_section_whose_key_holds_a_comma(self) -> None:
        text = "# One, two\na\n# Three\nb"
        comma = self.item("Comma", description=text)
        answer = api.handle_get(
            self.conn,
            "/api/planning/work-item",
            {"id": [comma], "section": ["One, two", "Three"]},
        )
        assert answer is not None
        self.assertEqual(
            sections.named(text, ["One, two", "Three"]), answer[1]["work_item"]["sections"]
        )
        # Without parts or section the full record is read, as before.
        self.assertNotIn("sections", self.http())

    def test_the_card_names_the_sections_of_a_long_description_only(self) -> None:
        for size, named in ((sections.CARD_FROM, False), (sections.CARD_FROM + 1, True)):
            with self.subTest(size=size):
                text = PLAN + "x" * (size - len(PLAN))
                self.ref = self.item(f"Long {size}", description=text)
                contents = self.read()["parts"]
                self.assertEqual(named, "sections" in contents)
                if named:
                    read = self.read(parts="sections")["sections"]
                    self.assertEqual({"count": len(read)}, contents["sections"])


if __name__ == "__main__":
    unittest.main()
