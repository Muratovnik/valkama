"""`transcript_roots`: when it is set, no transcript outside its directories is read.

A server on a copy of another installation's store finds that installation's
clients' files named in the copy's rows; without the setting its sweep copied
them into its own archive and recorded `transcript_archived` for sessions it never
saw. Every file here is synthetic, in a directory the test made: `own` is the
client directory the setting names, `foreign` one it does not.
"""

from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from server import transcript_roots, transcripts
from server.planning import live_sessions
from server.telemetry import usage_targets
from tests.test_transcripts import SESSION, ArchiveCase, synthetic

FOREIGN_SESSION = "6f1c2a8e-0000-4000-8000-0000000000bb"
VARIABLE = "VALKAMA_TRANSCRIPT_ROOTS"


class RootsCase(ArchiveCase):
    def setUp(self) -> None:
        super().setUp()
        self.own = os.path.join(self.home.name, "own")
        self.foreign = os.path.join(self.home.name, "foreign")
        for directory in (self.own, self.foreign):
            os.makedirs(directory)

    def write(self, directory: str, name: str, data: bytes) -> str:
        path = os.path.join(directory, name)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def bounded(self) -> mock._patch:
        return mock.patch.dict(os.environ, {VARIABLE: self.own})


class ReadableTests(RootsCase):
    def test_unset_bounds_nothing(self) -> None:
        with mock.patch.dict(os.environ, {VARIABLE: ""}):
            self.assertTrue(transcript_roots.readable(os.path.join(self.foreign, "x.jsonl")))

    def test_set_admits_only_files_under_its_directories(self) -> None:
        other = os.path.join(self.home.name, "else")
        with mock.patch.dict(os.environ, {VARIABLE: os.pathsep.join([self.own, other])}):
            self.assertTrue(transcript_roots.readable(os.path.join(self.own, "a", "x.jsonl")))
            self.assertTrue(transcript_roots.readable(os.path.join(other, "x.jsonl")))
            self.assertFalse(transcript_roots.readable(os.path.join(self.foreign, "x.jsonl")))
            # A sibling whose name starts with the root's is not under it.
            self.assertFalse(transcript_roots.readable(self.own + "-copy" + os.sep + "x.jsonl"))
            self.assertFalse(transcript_roots.readable(""))
        if os.name == "nt":
            with self.bounded():
                prefixed = "\\\\?\\" + os.path.join(self.own, "x.jsonl")
                self.assertTrue(transcript_roots.readable(prefixed))


class ArchiveTests(RootsCase):
    def test_a_foreign_end_is_never_copied_and_stays_owed(self) -> None:
        own = self.write(self.own, "own.jsonl", synthetic(3))
        foreign = self.write(self.foreign, "foreign.jsonl", synthetic(4))
        with self.bounded():
            self.deliver("session-end", transcript_path=own)
            self.deliver("session-end", session_id=FOREIGN_SESSION, transcript_path=foreign)
            result = self.sweep()

        self.assertEqual([SESSION], [row["session_id"] for row in self.rows()])
        self.assertEqual(1, result.outside)
        self.assertEqual(0, result.missing + result.unreadable)
        self.assertEqual(
            [(FOREIGN_SESSION, foreign)],
            [(owed.session_id, owed.transcript_path) for owed in transcripts.pending(self.conn)],
        )
        self.assertFalse(any(name.startswith(FOREIGN_SESSION) for name in self.files()))

    def test_without_the_setting_the_sweep_copies_the_same_end(self) -> None:
        foreign = self.write(self.foreign, "foreign.jsonl", synthetic(4))
        with self.bounded():
            self.deliver("session-end", session_id=FOREIGN_SESSION, transcript_path=foreign)
        self.assertEqual([], self.rows())

        with mock.patch.dict(os.environ, {VARIABLE: ""}):
            result = self.sweep()

        self.assertEqual(1, result.archived)
        self.assertEqual([FOREIGN_SESSION], [row["session_id"] for row in self.rows()])


class ReaderTests(RootsCase):
    TITLE = json.dumps({"type": "custom-title", "customTitle": "Named"}).encode() + b"\n"

    def test_a_session_title_is_read_only_inside_the_roots(self) -> None:
        own = self.write(self.own, "own.jsonl", self.TITLE)
        foreign = self.write(self.foreign, "foreign.jsonl", self.TITLE)
        with self.bounded(), mock.patch.dict(live_sessions._titles, clear=True):
            self.assertEqual("Named", live_sessions._title(own))
            self.assertIsNone(live_sessions._title(foreign))

    def test_the_usage_reread_skips_a_foreign_session(self) -> None:
        own = self.write(self.own, "own.jsonl", synthetic(2))
        foreign = self.write(self.foreign, "foreign.jsonl", synthetic(2))
        self.deliver("session-start", transcript_path=own)
        self.deliver("session-start", session_id=FOREIGN_SESSION, transcript_path=foreign)
        with self.bounded():
            found = list(usage_targets.Finder(self.conn, self.root).targets(set()))

        self.assertEqual([(SESSION, own)], [(target.session, target.path) for target in found])


if __name__ == "__main__":
    unittest.main()
