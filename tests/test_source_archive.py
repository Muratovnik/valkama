"""The source archive record is read as untrusted input.

An unpacked archive is any directory someone hands `launcher install`. Its
record names the directory a release is written to and the paths copied into
it, so a record whose commit is not a commit id, or whose paths lead out of the
archive, is refused before a single file is read or written.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from server import source_archive

COMMIT = "0123456789abcdef0123456789abcdef01234567"
DIGEST = hashlib.sha256(b"x").hexdigest()


class SourceArchiveRecordTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "unpacked"
        self.root.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, document: object) -> None:
        (self.root / source_archive.RECORD).write_text(json.dumps(document), encoding="utf-8")

    def test_a_record_round_trips_through_its_reader(self) -> None:
        (self.root / source_archive.RECORD).write_bytes(
            source_archive.record(COMMIT, "9.9.9", {"valkama.py": DIGEST})
        )
        read = source_archive.read(self.root)
        self.assertEqual(
            (COMMIT, "9.9.9", {"valkama.py": DIGEST}), (read.commit, read.version, read.files)
        )

    def test_a_path_that_leaves_the_archive_is_refused_on_both_sides(self) -> None:
        for path in (
            "../outside",
            "/absolute",
            "server\\cli.py",
            "C:x",
            "./valkama.py",
            "a//b",
            source_archive.RECORD,
        ):
            with self.subTest(path=path):
                with self.assertRaises(source_archive.SourceArchiveError):
                    source_archive.record(COMMIT, "9.9.9", {path: DIGEST})
                self.write(
                    {
                        "schema_version": 1,
                        "commit": COMMIT,
                        "version": "9.9.9",
                        "files": {path: DIGEST},
                    }
                )
                with self.assertRaisesRegex(
                    source_archive.SourceArchiveError, "not a source archive record"
                ):
                    source_archive.read(self.root)

    def test_a_record_that_is_not_one_is_refused_saying_why(self) -> None:
        good = {"schema_version": 1, "commit": COMMIT, "version": "9.9.9", "files": {"a": DIGEST}}
        for document, reason in (
            ([], "not an object"),
            ({**good, "schema_version": 2}, "not schema 1"),
            ({**good, "commit": "../../elsewhere"}, "not a full commit id"),
            ({**good, "version": ""}, "no version"),
            ({**good, "files": {}}, "lists no files"),
            ({**good, "files": {"a": "md5"}}, "not a SHA-256"),
        ):
            with self.subTest(reason=reason):
                self.write(document)
                with self.assertRaisesRegex(source_archive.SourceArchiveError, reason):
                    source_archive.read(self.root)


if __name__ == "__main__":
    unittest.main()
