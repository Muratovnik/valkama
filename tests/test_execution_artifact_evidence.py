"""Git evidence distinguishes attempt output from a checkout's starting state."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import git_worktrees, processes
from server.executions import artifacts

_PROJECT = Path(__file__).resolve().parents[1]


class ArtifactEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        # The owner project ignores tmp/. The fixture and Git's temporary files
        # stay inside it, and neither Git identity nor configuration is global.
        scratch_root = _PROJECT / "tmp"
        self.assertTrue(git_worktrees.contains(str(scratch_root), str(_PROJECT)))
        self.assertFalse(git_worktrees.is_reparse_point(str(scratch_root)))
        ignored = processes.run_text(["git", "-C", str(_PROJECT), "check-ignore", "tmp/"])
        self.assertEqual(0, ignored.returncode, "test scratch must be ignored")
        scratch_root.mkdir(exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(dir=scratch_root)
        self.addCleanup(self.scratch.cleanup)
        self.env = mock.patch.dict(
            os.environ,
            {
                "TEMP": self.scratch.name,
                "TMP": self.scratch.name,
                "TMPDIR": self.scratch.name,
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CEILING_DIRECTORIES": str(_PROJECT),
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.repo = self.make_repo("repo")

    def make_repo(self, name: str) -> Path:
        """A repository with one committed file, clean."""

        repo = Path(self.scratch.name) / name
        repo.mkdir()
        initialized = processes.run_text(["git", "-C", str(repo), "init", "-b", "main"])
        if initialized.returncode != 0:
            raise unittest.SkipTest(f"git unavailable: {initialized.stderr}")
        self.write("tracked.txt", b"before\n", repo)
        self.git("add", "tracked.txt", repo=repo)
        self.git(
            "-c",
            "user.name=Test User",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "-m",
            "initial",
            repo=repo,
        )
        return repo

    def git(self, *args: str, repo: Path | None = None) -> str:
        result = processes.run_text(["git", "-C", str(repo or self.repo), *args])
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout

    def write(self, name: str, content: bytes, repo: Path | None = None) -> None:
        path = (repo or self.repo) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def test_clean_start_counts_tracked_staged_and_untracked_changes(self) -> None:
        base = artifacts.baseline(str(self.repo))
        self.assertEqual("observed", base["quality"])
        self.assertFalse(base["dirty"])

        self.write("tracked.txt", b"after\n")
        self.write("staged.txt", b"one\ntwo\n")
        self.git("add", "staged.txt")
        self.write("new.txt", b"three\nfour\n")

        result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("observed", result["quality"])
        self.assertEqual(3, result["changed_files"])
        self.assertEqual(5, result["insertions"])
        self.assertEqual(1, result["deletions"])
        self.assertEqual([], result["commits"])

    def test_clean_unchanged_checkout_is_observed_zero(self) -> None:
        base = artifacts.baseline(str(self.repo))
        result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("observed", result["quality"])
        self.assertEqual(0, result["changed_files"])
        self.assertEqual(0, result["insertions"])
        self.assertEqual(0, result["deletions"])

    def test_untracked_text_binary_and_empty_files_all_count(self) -> None:
        base = artifacts.baseline(str(self.repo))
        self.write("new.txt", b"one\ntwo")
        self.write("new.bin", b"\x00\x01\x02")
        self.write("empty.txt", b"")

        result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("observed", result["quality"])
        self.assertEqual(3, result["changed_files"])
        self.assertEqual(2, result["insertions"])
        self.assertEqual(0, result["deletions"])

    def test_preexisting_dirty_edit_unchanged_is_not_attributed_to_attempt(self) -> None:
        self.write("tracked.txt", b"before\npreexisting\n")
        base = artifacts.baseline(str(self.repo))
        self.assertTrue(base["dirty"])
        self.assertEqual("observed", base["quality"])

        result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("unknown", result["quality"])
        self.assertIsNone(result["changed_files"])
        self.assertIsNone(result["insertions"])
        self.assertIsNone(result["deletions"])

    def test_new_file_does_not_make_dirty_start_exactly_measurable(self) -> None:
        self.write("preexisting.txt", b"earlier\n")
        base = artifacts.baseline(str(self.repo))
        self.assertTrue(base["dirty"])
        self.write("new.txt", b"later\n")

        result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("unknown", result["quality"])
        self.assertIsNone(result["changed_files"])

    def test_unavailable_git_at_outcome_cannot_be_observed_zero(self) -> None:
        base = artifacts.baseline(str(self.repo))
        with mock.patch("server.executions.artifacts.git_worktrees.git_text") as git_text:
            git_text.return_value = processes.TextResult(1, "", "git unavailable")
            result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("unknown", result["quality"])
        self.assertIsNone(result["changed_files"])

    def test_unreadable_new_file_cannot_be_observed_zero(self) -> None:
        base = artifacts.baseline(str(self.repo))
        self.write("unreadable.txt", b"content\n")
        real_git_text = git_worktrees.git_text

        def failing_diff(repo: str, *args: str) -> processes.TextResult:
            if "--no-index" in args:
                return processes.TextResult(2, "", "cannot read file")
            return real_git_text(repo, *args)

        with mock.patch(
            "server.executions.artifacts.git_worktrees.git_text", side_effect=failing_diff
        ):
            result = artifacts.outcome(str(self.repo), base)
        self.assertEqual("unknown", result["quality"])
        self.assertIsNone(result["changed_files"])

    def test_a_change_only_in_a_root_beside_the_working_one_is_measured_there(self) -> None:
        beside = self.make_repo("beside")
        added = [{"project_id": "beside", "root": str(beside)}]
        base = artifacts.baseline_with(str(self.repo), added)
        [start] = base["added"]
        self.assertEqual(
            {"project_id", "root", "repository", "head", "branch", "dirty", "quality"}, set(start)
        )
        self.assertEqual(
            ("beside", str(beside), "main", False, "observed"),
            tuple(start[key] for key in ("project_id", "root", "branch", "dirty", "quality")),
        )
        self.assertEqual(self.git("rev-parse", "HEAD", repo=beside).strip(), start["head"])

        self.write("new.txt", b"one\n", beside)
        result = artifacts.outcome_with(str(self.repo), base)
        self.assertEqual(0, result["changed_files"], "the working directory is unchanged")
        [there] = result["added"]
        self.assertEqual(
            ("beside", str(beside), 1, 1, "observed"),
            (
                there["project_id"],
                there["root"],
                there["changed_files"],
                there["insertions"],
                there["quality"],
            ),
        )

    def test_a_record_without_roots_beside_measures_none(self) -> None:
        base = artifacts.baseline_with(str(self.repo), [])
        self.assertEqual([], base["added"])
        self.assertEqual([], artifacts.outcome_with(str(self.repo), base)["added"])
        # A stop with no baseline still answers with the key.
        self.assertEqual([], artifacts.outcome_with(str(self.repo), {})["added"])


if __name__ == "__main__":
    unittest.main()
