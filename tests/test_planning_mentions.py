"""Which numbers in an agent's Markdown count as mentions, and that nothing else moves.

The expectations are written by hand from CommonMark's rules for code, links and
autolinks and from the interface's fences in `web/src/shared/lib/textReferences.ts`,
with nothing taken from the module under test.
"""

# ruff: noqa: RUF001 - Cyrillic beside Latin is what these cases are about.

from __future__ import annotations

import re
import unittest

from hypothesis import given
from hypothesis import strategies as st

from server.planning.mentions import ScanState, scan, with_links

URL = "http://u"


def link(reference: str = "MAIN-12") -> str:
    return f"[{reference}]({URL})"


def linked(text: str) -> str:
    """The whole text as one batch, with every mention treated as a real item."""

    found = scan(text, ScanState(), final=True)
    return with_links(text, found, {mention.reference: URL for mention in found})


def linked_in_batches(*batches: str) -> list[str]:
    state = ScanState()
    shown = []
    for position, batch in enumerate(batches):
        found = scan(batch, state, final=position == len(batches) - 1)
        shown.append(with_links(batch, found, {mention.reference: URL for mention in found}))
    return shown


class MentionTests(unittest.TestCase):
    def test_a_number_in_prose_becomes_a_link_in_latin_and_cyrillic(self) -> None:
        for text, expected in (
            ("See MAIN-12 now.", f"See {link()} now."),
            ("MAIN-12", link()),
            ("задача MAIN-12 готова", f"задача {link()} готова"),
            ("«MAIN-12»", f"«{link()}»"),
            ("(MAIN-12)", f"({link()})"),
            ("Сделано: MAIN-12.", f"Сделано: {link()}."),
            ("MAIN-12: готово", f"{link()}: готово"),
            ("**MAIN-12** готова", f"**{link()}** готова"),
            ("**задача MAIN-12**", f"**задача {link()}**"),
            ("*MAIN-12*", f"*{link()}*"),
            ("~~MAIN-12~~", f"~~{link()}~~"),
            ("- MAIN-12 сделано", f"- {link()} сделано"),
            ("1. MAIN-12", f"1. {link()}"),
            ("> MAIN-12", f"> {link()}"),
            ("# MAIN-12", f"# {link()}"),
            ("| MAIN-12 | да |", f"| {link()} | да |"),
            ("- [ ] MAIN-12", f"- [ ] {link()}"),
            ("- [x] MAIN-12 готово", f"- [x] {link()} готово"),
            ("[^1]: MAIN-12", f"[^1]: {link()}"),
        ):
            with self.subTest(text=text):
                self.assertEqual(expected, linked(text))

    def test_several_numbers_each_become_a_link(self) -> None:
        for text, expected in (
            ("MAIN-12, MAIN-13", f"{link()}, {link('MAIN-13')}"),
            ("MAIN-12,MAIN-13", f"{link()},{link('MAIN-13')}"),
            ("MAIN-12/MAIN-13", f"{link()}/{link('MAIN-13')}"),
            ("A1-1 и AB-2", f"{link('A1-1')} и {link('AB-2')}"),
        ):
            with self.subTest(text=text):
                self.assertEqual(expected, linked(text))

    def test_the_middle_of_something_longer_is_no_mention(self) -> None:
        for text in (
            "MAIN-12a",
            "MAIN-12-3",
            "MAIN-12_x",
            "MAIN-12.md",
            "MAIN-12.1",
            "aMAIN-12",
            "1MAIN-12",
            "x-MAIN-12",
            "_MAIN-12_",
            "задачаMAIN-12",
            "MAIN-12а",
            "MAIN-12-й",
            "C:\\work\\MAIN-12",
            "MAIN-12\\x",
            "me@MAIN-12",
            "MAIN-12@example.com",
        ):
            with self.subTest(text=text):
                self.assertEqual(text, linked(text))

    def test_what_the_planning_grammar_refuses_is_no_candidate(self) -> None:
        for text in (
            "main-12",
            "Main-12",
            "M-12",
            "ABCDEFGHI-12",
            "МAIN-12",  # the first letter is Cyrillic
            "MAIN-0",
            "MAIN-012",
            "MAIN-1234567890",
            "1A-2",
        ):
            with self.subTest(text=text):
                self.assertEqual([], scan(text, ScanState(), final=True))

    def test_a_longer_key_is_its_own_candidate_and_not_the_shorter_one(self) -> None:
        self.assertEqual(
            ["XMAIN-12"], [found.reference for found in scan("XMAIN-12", ScanState(), final=True)]
        )

    def test_the_shape_alone_is_a_candidate_for_the_store_to_refuse(self) -> None:
        found = scan("UTF-8 и SHA-256", ScanState(), final=True)
        self.assertEqual(["UTF-8", "SHA-256"], [mention.reference for mention in found])


class ProtectedTextTests(unittest.TestCase):
    def assert_unchanged(self, *texts: str) -> None:
        for text in texts:
            with self.subTest(text=text):
                self.assertEqual(text, linked(text))

    def test_code_spans_of_any_length(self) -> None:
        self.assert_unchanged(
            "`MAIN-12`",
            "а `MAIN-12` б",
            "``MAIN-12``",
            "`` a ` MAIN-12 ``",
            "`` `MAIN-12` ``",
            "`a\nMAIN-12\nb`",
            "**`MAIN-12`**",
        )

    def test_prose_around_a_code_span_still_links(self) -> None:
        self.assertEqual(f"`x` {link()} `y`", linked("`x` MAIN-12 `y`"))

    def test_escaped_punctuation_opens_nothing(self) -> None:
        self.assertEqual(f"\\`{link()}\\`", linked("\\`MAIN-12\\`"))
        self.assertEqual(f"\\[{link()}\\]", linked("\\[MAIN-12\\]"))

    def test_fenced_blocks(self) -> None:
        self.assert_unchanged(
            "```\nMAIN-12\n```\n",
            "```python\nMAIN-12\n```\n",
            "~~~\nMAIN-12\n~~~\n",
            "````\n```\nMAIN-12\n```\nMAIN-13\n````\n",
            "```\n~~~\nMAIN-12\n```\n",
            "~~~\n```\nMAIN-12\n~~~\n",
            "   ```\nMAIN-12\n   ```\n",
            "```\nMAIN-12\n",
            "- item\n  ```\n  MAIN-12\n  ```\n",
            "- ```\n  MAIN-12\n  ```\n",
            "> ```\n> MAIN-12\n> ```\n",
        )

    def test_a_shorter_or_other_closing_run_does_not_end_a_fence(self) -> None:
        self.assert_unchanged("````\nMAIN-12\n```\nMAIN-13\n````\n")

    def test_prose_after_a_fence_links_again(self) -> None:
        self.assertEqual(f"```\nMAIN-12\n```\n{link()}\n", linked("```\nMAIN-12\n```\nMAIN-12\n"))
        self.assertEqual(f"~~~\nx\n~~~\n{link()}", linked("~~~\nx\n~~~\nMAIN-12"))

    def test_three_backticks_with_more_on_the_line_are_a_code_span_not_a_fence(self) -> None:
        self.assertEqual(f"``` x ``` {link()}\n", linked("``` x ``` MAIN-12\n"))

    def test_indented_code(self) -> None:
        self.assert_unchanged(
            "    MAIN-12\n",
            "\tMAIN-12\n",
            "para\n\n    MAIN-12\n\n    MAIN-13\n",
        )

    def test_an_indented_continuation_of_a_paragraph_is_prose(self) -> None:
        self.assertEqual(f"para\n    {link()}\n", linked("para\n    MAIN-12\n"))

    def test_existing_links_text_and_target(self) -> None:
        self.assert_unchanged(
            "[MAIN-12](http://x)",
            "[см. MAIN-12](http://x)",
            "[a](http://x/MAIN-12)",
            "[a](MAIN-12)",
            '[a](http://x "MAIN-12")',
            "[a](<x MAIN-12>)",
            "[a](x(MAIN-12)y)",
            "[`MAIN-12`](http://x)",
            "[a [b] MAIN-12](http://x)",
            "![MAIN-12](http://x)",
            "[MAIN-12][ref]",
            "[a][MAIN-12]",
            "[MAIN-12]",
            "[MAIN-12\nmore](http://x)",
            "[a](http://x\nMAIN-12)",
            "[MAIN-12](http://127.0.0.1:8642/open/MAIN-12)",
        )

    def test_prose_after_a_link_still_links(self) -> None:
        self.assertEqual(f"[a](u) {link()}", linked("[a](u) MAIN-12"))
        self.assertEqual(f"[a](u(v)) {link()}", linked("[a](u(v)) MAIN-12"))
        self.assertEqual(f"[a][b] {link()}", linked("[a][b] MAIN-12"))

    def test_reference_definitions(self) -> None:
        self.assert_unchanged(
            "[a]: http://x/MAIN-12",
            '[a]: http://x "MAIN-12"',
            "[MAIN-12]: http://x",
            "   [a]: MAIN-12",
            "> [a]: MAIN-12",
        )

    def test_autolinks_and_raw_html(self) -> None:
        self.assert_unchanged(
            "<http://x/MAIN-12>",
            "<MAIN-12@example.com>",
            '<a href="MAIN-12">',
            "</MAIN-12>",
            "<!-- MAIN-12 -->",
        )

    def test_bare_urls(self) -> None:
        self.assert_unchanged(
            "https://x.example/MAIN-12",
            "http://127.0.0.1:8642/open/MAIN-12",
            "https://x.example/?id=MAIN-12&a=1",
            "https://пример.рф/MAIN-12",
            "www.x.example/MAIN-12",
            "x.example/MAIN-12",
            "mailto:MAIN-12",
        )

    def test_prose_after_a_url_still_links(self) -> None:
        self.assertEqual(f"https://x/y {link()}", linked("https://x/y MAIN-12"))

    def test_an_angle_bracket_of_arithmetic_opens_nothing(self) -> None:
        self.assertEqual(f"a < b {link()} > c", linked("a < b MAIN-12 > c"))

    def test_a_stray_opener_silences_only_its_own_paragraph(self) -> None:
        self.assertEqual(f"a ` MAIN-12\n\n{link()}", linked("a ` MAIN-12\n\nMAIN-12"))
        self.assertEqual(f"a [ MAIN-12\n\n{link()}", linked("a [ MAIN-12\n\nMAIN-12"))
        self.assertEqual(f"- a `\n- {link()}", linked("- a `\n- MAIN-12"))
        self.assertEqual(f"a `\n# {link()}", linked("a `\n# MAIN-12"))


class ExactTextTests(unittest.TestCase):
    def test_every_other_character_comes_back_as_it_was(self) -> None:
        for text, expected in (
            ("a\r\nMAIN-12\r\nb\r\n", f"a\r\n{link()}\r\nb\r\n"),
            ("  MAIN-12  \n\n\n", f"  {link()}  \n\n\n"),
            ("😀 MAIN-12 😀", f"😀 {link()} 😀"),
            ("\ufeffа\u2028MAIN-12", f"\ufeffа\u2028{link()}"),
        ):
            with self.subTest(text=text):
                self.assertEqual(expected, linked(text))

    def test_only_a_mention_the_caller_confirmed_is_replaced(self) -> None:
        text = "UTF-8 MAIN-12 SHA-256"
        found = scan(text, ScanState(), final=True)
        self.assertEqual(f"UTF-8 {link()} SHA-256", with_links(text, found, {"MAIN-12": URL}))
        self.assertEqual(text, with_links(text, found, {}))


class BatchTests(unittest.TestCase):
    def test_a_fence_outlives_a_batch(self) -> None:
        self.assertEqual(
            ["```\n", "MAIN-12\n", "```\n", link() + "\n", ""],
            linked_in_batches("```\n", "MAIN-12\n", "```\n", "MAIN-12\n", ""),
        )

    def test_a_code_span_and_a_link_outlive_a_batch_within_a_paragraph(self) -> None:
        self.assertEqual(["a `x\n", "MAIN-12` b\n"], linked_in_batches("a `x\n", "MAIN-12` b\n"))
        self.assertEqual(
            ["[a\n", "MAIN-12](http://x)\n"], linked_in_batches("[a\n", "MAIN-12](http://x)\n")
        )

    def test_a_blank_line_ends_what_a_paragraph_left_open_across_batches(self) -> None:
        self.assertEqual(
            ["a `x\n", "\n", link() + "\n"], linked_in_batches("a `x\n", "\n", "MAIN-12\n")
        )

    def test_the_last_batch_may_end_inside_a_line(self) -> None:
        self.assertEqual(["x\n", f"see {link()}"], linked_in_batches("x\n", "see MAIN-12"))

    def test_a_reference_cut_by_a_batch_boundary_stays_as_it_was_in_both_parts(self) -> None:
        for first, second in (
            ("See MAIN-1", "2 done\n"),
            ("See MAIN", "-12 done\n"),
            ("See MA", "IN-12 done\n"),
        ):
            with self.subTest(first=first):
                self.assertEqual([first, second], linked_in_batches(first, second, "")[:2])

    def test_a_batch_ending_inside_a_line_stops_the_rest_of_the_message_only(self) -> None:
        self.assertEqual(
            [f"{link()}\nMAIN-13", " tail\n", "MAIN-14\n", ""],
            linked_in_batches("MAIN-12\nMAIN-13", " tail\n", "MAIN-14\n", ""),
        )


_LINES = st.sampled_from(
    [
        "",
        "plain text\n",
        "\n",
        "MAIN-12 and MAIN-13\n",
        "```\n",
        "````\n",
        "~~~\n",
        "```python\n",
        "`open\n",
        "close` MAIN-14\n",
        "[open\n",
        "text](http://x/MAIN-15) MAIN-16\n",
        "[a]: http://x/MAIN-17\n",
        "    MAIN-18\n",
        "- MAIN-19\n",
        "https://x/MAIN-20 MAIN-21\n",
        "UTF-8\n",
        "задача MAIN-22\r\n",
    ]
)
_LINK = re.compile(rf"\[([A-Z][A-Z0-9]*-\d+)\]\({re.escape(URL)}\)")


class PropertyTests(unittest.TestCase):
    @given(st.lists(_LINES, max_size=30), st.data())
    def test_how_a_message_is_cut_at_line_ends_changes_nothing(
        self, lines: list[str], data: st.DataObject
    ) -> None:
        text = "".join(lines)
        whole = [found.reference for found in scan(text, ScanState(), final=True)]
        state = ScanState()
        parts = []
        position = 0
        while position < len(lines):
            size = data.draw(st.integers(1, len(lines) - position))
            parts.append("".join(lines[position : position + size]))
            position += size
        parts.append("")
        by_batch = []
        for number, part in enumerate(parts):
            found = scan(part, state, final=number == len(parts) - 1)
            by_batch += [mention.reference for mention in found]
        self.assertEqual(whole, by_batch)

    @given(
        st.text(alphabet=st.sampled_from(list("MAIN-12 `[]()<>*_~\\\n\r.,:/@#xя")), max_size=200)
    )
    def test_linking_only_ever_adds_the_link_around_a_number(self, text: str) -> None:
        self.assertEqual(text, _LINK.sub(r"\1", linked(text)))


if __name__ == "__main__":
    unittest.main()
