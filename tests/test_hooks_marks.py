"""The marks file one hook writes and the close guard reads.

The hook reads a file that does not parse as empty and rewrites it; the guard
must instead tell "no marks" from "marks without this item", because the first
sends it back to the item's window and the second does not.
"""

from __future__ import annotations

import os
import tempfile
import unittest

from server.hooks import marks

SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CHILD = "019a3c2e-9999-7c11-9e0f-2f4b6d8a1c3e"
ITEM = "6f1c1a52-0c4e-4b8e-9a43-3c2d6f7e8a90"
OTHER_ITEM = "0b9d2c11-7a5e-4f60-8d21-5e4c3b2a1f00"


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.store = os.path.join(directory.name, "valkama.sqlite3")
        os.makedirs(marks.directory(self.store))

    def file(self, agent_id: str | None = None) -> str:
        return marks.path(marks.directory(self.store), SESSION, agent_id)

    def write(self, data: bytes, agent_id: str | None = None) -> None:
        with open(self.file(agent_id), "wb") as handle:
            handle.write(data)


class ParseTests(Harness):
    def test_what_is_written_reads_back(self) -> None:
        kept = {ITEM: (41, (3, 7, 2, 0), True, 40, False)}
        budget = ((1700000000,), 2, 39, {ITEM: (1700000001,)}, (5, 6, 7, 8))
        marks.write_marks(self.file(), kept, budget)
        self.assertEqual((kept, budget), marks.parse(self.file()))
        self.assertEqual(kept, marks.read_marks(self.file()))

    def test_a_file_that_does_not_read_is_none_to_the_guard_and_empty_to_the_hook(self) -> None:
        cases = {
            "missing": None,
            "no header": b"",
            "unknown layout": b"v9\n",
            "a line of the wrong width": b"v4\n" + ITEM.encode() + b" 1 2 3\n",
            "a word where a number goes": b"v4\n" + ITEM.encode() + b" 1 2 3 4 0 one 5 0\n",
            "not ascii": b"v4\n\xff\n",
        }
        for name, data in cases.items():
            with self.subTest(name):
                if data is None:
                    if os.path.exists(self.file()):
                        os.remove(self.file())
                else:
                    self.write(data)
                self.assertIsNone(marks.parse(self.file()))
                self.assertEqual(({}, marks.NO_BUDGET), marks.read_state(self.file()))

    def test_each_recipient_has_its_own_file(self) -> None:
        self.assertNotEqual(self.file(), self.file(CHILD))
        self.assertTrue(self.file(CHILD).endswith(f"{SESSION}--{CHILD}{marks.SUFFIX}"))


class ToldThroughTests(Harness):
    def test_no_file_is_none(self) -> None:
        self.assertIsNone(marks.told_through(self.store, SESSION, None, ITEM))

    def test_a_damaged_file_is_none(self) -> None:
        self.write(b"v4\ngarbage\n")
        self.assertIsNone(marks.told_through(self.store, SESSION, None, ITEM))

    def test_a_held_place_is_the_call_it_read_to(self) -> None:
        marks.write_marks(self.file(), {ITEM: (41, (3, 7, 2, 0), True, 40, False)})
        self.assertEqual(41, marks.told_through(self.store, SESSION, None, ITEM))

    def test_a_place_kept_without_holding_the_item_is_zero(self) -> None:
        marks.write_marks(self.file(), {ITEM: (41, (3, 7, 2, 0), False, 40, False)})
        self.assertEqual(0, marks.told_through(self.store, SESSION, None, ITEM))

    def test_a_file_without_the_item_is_zero(self) -> None:
        marks.write_marks(self.file(), {OTHER_ITEM: (41, (3, 7, 2, 0), True, 40, False)})
        self.assertEqual(0, marks.told_through(self.store, SESSION, None, ITEM))

    def test_the_orchestrators_file_says_nothing_for_its_subagent(self) -> None:
        marks.write_marks(self.file(), {ITEM: (41, (3, 7, 2, 0), True, 40, False)})
        self.assertIsNone(marks.told_through(self.store, SESSION, CHILD, ITEM))


if __name__ == "__main__":
    unittest.main()
