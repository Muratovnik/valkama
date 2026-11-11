"""What `tests/commit_subjects.py` owes: every subject read, merges too."""

from __future__ import annotations

import contextlib
import io
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import processes
from tests import commit_subjects

ROOT = Path(__file__).resolve().parents[1]


def checked(root: Path) -> tuple[int, str]:
    """The check's result for `root` and what it told its reader."""

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = commit_subjects.main([str(root)])
    return code, output.getvalue()


class SubjectPatternTests(unittest.TestCase):
    def test_each_part_of_the_rule_decides_on_its_own(self) -> None:
        accepted = (
            "fix: stop the drawer from swallowing the escape key",
            "fix(web): stop the drawer from swallowing the escape key",
            "refactor(server)!: name the module platform",
            "feat!: drop the legacy door",
            "docs(work-item): say what a claim does",
        )
        refused = (
            "merge: bring the side branch in",
            "Merge branch 'side' into integration",
            'Revert "fix: something"',
            "Fix: an uppercase type",
            "fix(Web): an uppercase scope",
            "fix(): an empty scope",
            "fixes: a type outside the set",
            "fix:no space after the colon",
            "fix: ",
            "fix",
        )
        for subject in accepted:
            with self.subTest(subject=subject):
                self.assertIsNotNone(commit_subjects.SUBJECT.match(subject))
        for subject in refused:
            with self.subTest(subject=subject):
                self.assertIsNone(commit_subjects.SUBJECT.match(subject))

    def test_the_types_are_the_set_in_the_repository_instructions(self) -> None:
        text = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
        found = re.search(r"Angular type set: (.*?), an optional lowercase scope", text, re.DOTALL)
        assert found is not None

        self.assertEqual(re.findall(r"`([a-z]+)`", found.group(1)), list(commit_subjects.TYPES))


class HistoryTests(unittest.TestCase):
    """A repository of this test's, out of reach of any configuration of the caller's."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-subjects-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        environment = mock.patch.dict(
            os.environ,
            {
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                # Whatever holds the temporary directory is not searched for a repository.
                "GIT_CEILING_DIRECTORIES": str(self.root),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.commit("feat: the first change")

    def git(self, *arguments: str) -> str:
        result = processes.run_text(
            [
                "git",
                "-C",
                str(self.repo),
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                *arguments,
            ]
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout

    def commit(self, subject: str) -> str:
        self.git("commit", "--allow-empty", "-m", subject)
        return self.git("log", "-1", "--format=%h").strip()

    def merge_side(self, *message: str) -> str:
        """A merge commit of a side branch into `main`, with `message` or Git's default."""

        self.git("switch", "-c", "side")
        self.commit("fix(side): the side change")
        self.git("switch", "main")
        self.commit("docs: the main change")
        self.git("merge", "--no-ff", "--no-edit", *message, "side")
        return self.git("log", "-1", "--format=%h %s").strip()

    def test_a_conforming_history_with_a_conforming_merge_passes_and_says_what_it_read(
        self,
    ) -> None:
        self.merge_side("-m", "chore(merge): bring the side branch in")

        code, said = checked(self.repo)

        self.assertEqual(0, code, said)
        # The first change, the side change, the main change and the merge itself.
        self.assertIn("all 4 commits reachable from HEAD conform", said)

    def test_a_merge_subject_outside_the_set_fails_naming_that_commit_alone(self) -> None:
        merge = self.merge_side("-m", "merge: bring the side branch in")

        code, said = checked(self.repo)

        self.assertEqual(1, code)
        self.assertIn("1 of 4 commits", said)
        self.assertIn(f"  {merge}\n", said)
        self.assertNotIn("the side change", said)

    def test_gits_default_merge_subject_fails(self) -> None:
        merge = self.merge_side()
        self.assertIn("Merge branch 'side'", merge)

        code, said = checked(self.repo)

        self.assertEqual(1, code)
        self.assertIn(f"  {merge}\n", said)

    def test_every_commit_that_does_not_match_is_named(self) -> None:
        first = self.commit("WIP")
        self.commit("test: a conforming one between")
        last = self.commit("Update README.md")

        code, said = checked(self.repo)

        self.assertEqual(1, code)
        self.assertIn("2 of 4 commits", said)
        self.assertIn(f"  {first} WIP\n", said)
        self.assertIn(f"  {last} Update README.md\n", said)


if __name__ == "__main__":
    unittest.main()
