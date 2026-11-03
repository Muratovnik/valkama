"""The sample table the page's path parsing and the server's path check share.

The table says what a text becomes on the page. The web tests read it as the
expected output of the parser; here its own promises are held, so a row added
for one suite cannot quietly say something the other suite would refuse.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

SAMPLES = (
    Path(__file__).resolve().parents[1]
    / "web"
    / "tests"
    / "fixtures"
    / ("document-path-samples.json")
)
FORMS = {"strong", "weak", "copy-only", "none"}
PLACES = {"text", "option-row", "option-detail"}
KEYS = {"text", "where", "form", "candidate", "paths", "suffix", "copy", "caption"}
#: Where a tail is cut: what the page offers the server as a second variant.
TAIL = ".,;:)»]\"'"


def load_rows() -> list[dict]:
    return json.loads(SAMPLES.read_text(encoding="utf-8"))["rows"]


class SampleTableTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = load_rows()

    def lookup(self, text: str, where: str = "text") -> dict:
        return next(row for row in self.rows if (row["text"], row["where"]) == (text, where))

    def test_every_row_has_the_same_shape(self) -> None:
        self.assertGreaterEqual(len(self.rows), 60)
        for row in self.rows:
            with self.subTest(text=row["text"]):
                self.assertLessEqual(KEYS, row.keys())
                self.assertLessEqual(row.keys() - KEYS, {"note"})
                self.assertIn(row["form"], FORMS)
                self.assertIn(row["where"], PLACES)

    def test_a_text_says_one_thing_in_one_place(self) -> None:
        seen = [(row["text"], row["where"]) for row in self.rows]
        self.assertEqual(len(seen), len(set(seen)))

    def test_each_form_promises_what_a_click_can_do(self) -> None:
        for row in self.rows:
            with self.subTest(text=row["text"]):
                if row["form"] == "none":
                    self.assertIsNone(row["candidate"])
                    self.assertIsNone(row["copy"])
                    self.assertEqual([], row["paths"])
                elif row["form"] == "copy-only":
                    self.assertEqual([], row["paths"], "a network path never reaches the server")
                    self.assertTrue(row["copy"])
                elif row["form"] == "weak":
                    self.assertTrue(row["paths"])
                    self.assertIsNone(row["copy"], "a weak form is never a copy button")
                else:
                    self.assertTrue(row["paths"])
                    self.assertTrue(row["copy"])

    def test_a_suffix_never_reaches_the_server(self) -> None:
        for row in self.rows:
            if not row["suffix"]:
                continue
            with self.subTest(text=row["text"]):
                self.assertTrue(row["candidate"].endswith(row["suffix"]))
                self.assertEqual(row["candidate"], row["copy"], "the copy keeps the suffix")
                for path in row["paths"]:
                    self.assertNotIn(row["suffix"], path)

    def test_a_tail_gives_two_variants_and_the_copy_has_none(self) -> None:
        rows = [row for row in self.rows if len(row["paths"]) == 2]
        self.assertGreaterEqual(len(rows), 8)
        for row in rows:
            with self.subTest(text=row["text"]):
                bare, tailed = row["paths"]
                self.assertEqual(tailed.rstrip(TAIL), bare.rstrip(TAIL))
                self.assertLess(len(bare), len(tailed))
                if row["form"] == "strong":
                    self.assertEqual(bare, row["copy"])

    def test_the_boundaries_the_contract_names_are_here(self) -> None:
        # One separator: text in prose and weak in backticks, pinned on purpose.
        self.assertEqual("none", self.lookup("docs/plans")["form"])
        self.assertEqual("weak", self.lookup("`docs/plans`")["form"])
        # Both separators, spaces only in backticks.
        self.assertEqual("strong", self.lookup("C:\\work\\probe")["form"])
        self.assertEqual("strong", self.lookup("C:/work/probe")["form"])
        self.assertEqual("D:\\x y\\z.txt", self.lookup("`D:\\x y\\z.txt`")["copy"])
        self.assertEqual("D:\\x", self.lookup("D:\\x y\\z.txt")["copy"])
        # Network, home, a folder with and without its separator.
        self.assertEqual("copy-only", self.lookup("\\\\server\\share\\x")["form"])
        self.assertEqual("strong", self.lookup("~/.valkama/config.json")["form"])
        self.assertEqual("strong", self.lookup("docs/plans/")["form"])
        self.assertEqual("weak", self.lookup("`web/src`")["form"])
        # What stays text.
        for text in ("AGENTS.md", "/api/documents/read", "`python tools/workbench.py check`"):
            self.assertEqual("none", self.lookup(text)["form"], text)
        self.assertEqual("weak", self.lookup("`owner/repo`")["form"])
        self.assertEqual("strong", self.lookup("[x](AGENTS.md)")["form"])
        # The same path inside an option's label and in its expanded description.
        self.assertEqual("none", self.lookup("docs/plan.md", "option-row")["form"])
        self.assertEqual("strong", self.lookup("docs/plan.md", "option-detail")["form"])


if __name__ == "__main__":
    unittest.main()
