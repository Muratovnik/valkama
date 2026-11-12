"""Quota history imported from a neutral JSON-lines file, and the command that does it.

Held here: the lines are kept through the one write path as the `import` source, oldest
first, so a second import of the same file adds nothing; a line's seat is kept as given,
none included; one line the store cannot keep refuses the whole file and writes nothing;
and the report counts the lines, what was added and why the rest was not, with each
organization's first and last time. Every id and time is invented.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli, store
from server.quota import history, samples

NOW = dt.datetime(2030, 3, 5, tzinfo=dt.UTC)
SEAT = "week:2030-03-08T09:00Z"


def line(organization: str, at: str, kind: str = "week", **fields: object) -> str:
    return json.dumps({"organization": organization, "at": at, "kind": kind, **fields})


LINES = [
    line("org-1", "2030-03-04T09:10:00Z", percent=41, resets_at="2030-03-08T09:00:00Z", seat=SEAT),
    line("org-1", "2030-03-04T09:00:00Z", percent=40, resets_at="2030-03-08T09:00:00Z", seat=SEAT),
    "",
    line("org-1", "2030-03-04T09:20:00Z", percent=41, resets_at="2030-03-08T09:00:00Z", seat=SEAT),
    line("org-1", "2030-03-04T09:30:00Z", "five_hour", percent=5, resets_at=None),
    line("org-2", "2030-03-04T08:00:00Z", "week_model", percent=3, model="Opus", seat=None),
    line("org-2", "2030-03-04T08:30:00Z", "extra_usage", amount=1.5),
    line("org-2", "2029-01-01T00:00:00Z", percent=1),
]


class ImportTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.root / "valkama.sqlite3")})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)

    def rows(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT at, source, organization, session_id, seat, kind, model, percent,"
                " resets_at, amount, currency FROM quota_samples ORDER BY id"
            )
        ]

    def test_an_import_keeps_each_line_oldest_first_and_says_what_it_kept(self) -> None:
        report = history.import_lines(self.conn, LINES, now=NOW)
        self.assertEqual(
            {
                "lines": 7,
                "added": 5,
                "unchanged": 1,
                "expired": 1,
                "organizations": {
                    "org-1": {
                        "lines": 4,
                        "added": 3,
                        "first_at": "2030-03-04T09:00:00.000Z",
                        "last_at": "2030-03-04T09:30:00.000Z",
                    },
                    "org-2": {
                        "lines": 3,
                        "added": 2,
                        "first_at": "2029-01-01T00:00:00.000Z",
                        "last_at": "2030-03-04T08:30:00.000Z",
                    },
                },
            },
            report.as_dict(),
        )
        reset = "2030-03-08T09:00:00.000Z"
        self.assertEqual(
            [
                ("2030-03-04T08:00:00.000Z", "import", "org-2", None, None, "week_model",
                 "Opus", 3.0, None, None, None),
                ("2030-03-04T08:30:00.000Z", "import", "org-2", None, None, "extra_usage",
                 None, None, None, 1.5, None),
                ("2030-03-04T09:00:00.000Z", "import", "org-1", None, SEAT, "week", None,
                 40.0, reset, None, None),
                ("2030-03-04T09:10:00.000Z", "import", "org-1", None, SEAT, "week", None,
                 41.0, reset, None, None),
                ("2030-03-04T09:30:00.000Z", "import", "org-1", None, None, "five_hour", None,
                 5.0, None, None, None),
            ],
            self.rows(),
        )  # fmt: skip

    def test_importing_the_same_file_again_adds_nothing(self) -> None:
        history.import_lines(self.conn, LINES, now=NOW)
        before = self.rows()
        again = history.import_lines(self.conn, LINES, now=NOW)
        self.assertEqual((7, 0, 6, 1), (again.lines, again.added, again.unchanged, again.expired))
        self.assertEqual(before, self.rows())

    def test_one_line_the_store_cannot_keep_refuses_the_whole_file(self) -> None:
        refused = {
            "not JSON": "{",
            "not an object": "[1]",
            "unknown field": line("org-1", "2030-03-04T09:00:00Z", percent=1, email="a@b"),
            "missing kind": json.dumps({"organization": "org-1", "at": "2030-03-04T09:00:00Z"}),
            "kind": line("org-1", "2030-03-04T09:00:00Z", "month", percent=1),
            "seat not text": line("org-1", "2030-03-04T09:00:00Z", percent=1, seat=7),
            "time": line("org-1", "2030-03-04 09:00", percent=1),
            "percent": line("org-1", "2030-03-04T09:00:00Z", percent="41"),
        }
        for name, bad in refused.items():
            with self.subTest(name):
                with self.assertRaisesRegex(samples.SampleError, "^line 3: "):
                    history.import_lines(self.conn, [LINES[0], LINES[1], bad], now=NOW)
                self.assertEqual([], self.rows())
                self.assertFalse(self.conn.in_transaction)

    def test_the_command_imports_a_file_and_prints_its_report(self) -> None:
        recent = dt.datetime.now(dt.UTC) - dt.timedelta(days=1)
        source = self.root / "history.jsonl"
        lines = [
            line("org-1", (recent + dt.timedelta(minutes=minute)).isoformat(), percent=percent)
            for minute, percent in ((0, 10), (5, 11))
        ]
        source.write_text("\n".join(lines) + "\n", encoding="utf-8")
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            cli.main(["quota", "import", "--source", str(source)])
        first = json.loads(printed.getvalue())
        self.assertEqual((2, 2), (first["lines"], first["added"]))
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            cli.main(["quota", "import", "--source", str(source)])
        self.assertEqual(0, json.loads(printed.getvalue())["added"])
        self.assertEqual(2, len(self.rows()))

    def test_the_command_refuses_a_file_it_cannot_import(self) -> None:
        source = self.root / "history.jsonl"
        source.write_text("{\n", encoding="utf-8")
        with self.assertRaisesRegex(SystemExit, "^quota import: line 1: not JSON"):
            cli.main(["quota", "import", "--source", str(source)])
        with self.assertRaisesRegex(SystemExit, "^quota import: "):
            cli.main(["quota", "import", "--source", str(self.root / "missing.jsonl")])
        self.assertEqual([], self.rows())


if __name__ == "__main__":
    unittest.main()
