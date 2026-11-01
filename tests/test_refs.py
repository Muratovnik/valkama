"""What a commit ref is allowed to make git do.

A commit ref is a value an agent wrote, so the lookup hands git a revision and
nothing else: never an option, and never a path into the repository's files.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import documents, processes, refs

_PROJECT = Path(__file__).resolve().parents[1]


class CommitRefRootTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.env = mock.patch.dict(
            os.environ,
            {
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CEILING_DIRECTORIES": str(_PROJECT),
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        os.environ.pop(documents.DOC_ROOTS_VAR, None)
        self.project = self.repository("project")

    def repository(self, name: str) -> str:
        root = os.path.join(self.scratch.name, name)
        os.makedirs(root)
        if processes.run_text(["git", "-C", root, "init", "-b", "main"]).returncode != 0:
            raise unittest.SkipTest("git unavailable")
        with open(os.path.join(root, "notes.md"), "w", encoding="utf-8") as handle:
            handle.write(f"{name}\n")
        self.git(root, "add", "notes.md")
        self.git(
            root,
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            f"{name}: first",
        )
        return root

    def git(self, root: str, *args: str) -> str:
        completed = processes.run_text(["git", "-C", root, *args])
        self.assertEqual(0, completed.returncode, completed.stderr)
        return completed.stdout.strip()

    def test_a_value_is_never_read_as_an_option_or_as_a_file(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self.project
        written = os.path.join(self.scratch.name, "written.txt")
        for value in (f"--output={written}", "HEAD:notes.md"):
            answer = refs.resolve_ref("commit", value)
            self.assertFalse(answer["resolved"], value)
        self.assertFalse(os.path.exists(written))
        self.assertTrue(refs.resolve_ref("commit", "HEAD")["resolved"])


if __name__ == "__main__":
    unittest.main()
