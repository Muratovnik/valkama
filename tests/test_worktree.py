"""The worktree helper links modules only where the lockfile is the main checkout's, and unlinks before Git removes."""

from __future__ import annotations

import contextlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import git_worktrees, processes
from tests import worktree

WEB_LOCK = b'{"name": "web", "lockfileVersion": 3, "packages": {"": {}}}\n'
DESKTOP_LOCK = b'{"name": "desktop", "lockfileVersion": 3, "packages": {"": {}}}\n'


class WorktreeCase(unittest.TestCase):
    """A main checkout with installed `web` and `desktop` modules, one marker file in each."""

    def setUp(self) -> None:
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.base = Path(scratch.name).resolve()
        self.main = self.base / "main"
        self.main.mkdir()
        self.git(self.main, "init", "-q", "-b", "main")
        (self.main / ".gitignore").write_bytes(b"node_modules/\n")
        for name, lock in (("web", WEB_LOCK), ("desktop", DESKTOP_LOCK)):
            (self.main / name).mkdir()
            (self.main / name / "package-lock.json").write_bytes(lock)
            (self.main / name / "node_modules").mkdir()
            (self.main / name / "node_modules" / "marker.txt").write_text(name, encoding="utf-8")
        self.git(self.main, "add", "-A")
        self.git(self.main, "commit", "-q", "-m", "chore: the packages")

    def git(self, checkout: Path, *arguments: str) -> str:
        result = processes.run_text(
            [
                "git",
                "-C",
                str(checkout),
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                *arguments,
            ]
        )
        self.assertEqual(0, result.returncode, result.stderr)
        return result.stdout

    def run_tool(self, *argv: str, root: Path | None = None) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = worktree.main(list(argv), root=self.main if root is None else root)
        return code, out.getvalue(), err.getvalue()

    def registered(self, path: Path) -> bool:
        return git_worktrees.canonical(path) in git_worktrees.registered_worktrees(str(self.main))

    def assert_main_modules_intact(self) -> None:
        for name in ("web", "desktop"):
            marker = self.main / name / "node_modules" / "marker.txt"
            self.assertEqual(
                name, marker.read_text(encoding="utf-8"), f"{name} modules were touched"
            )


class AddTests(WorktreeCase):
    def test_a_package_with_the_main_lockfile_is_linked_and_one_with_another_is_not(self) -> None:
        self.git(self.main, "switch", "-q", "-c", "side")
        (self.main / "desktop" / "package-lock.json").write_bytes(DESKTOP_LOCK.replace(b"3", b"4"))
        self.git(self.main, "commit", "-q", "-am", "chore: another desktop lockfile")
        self.git(self.main, "switch", "-q", "main")
        path = self.base / "wt"

        code, out, err = self.run_tool("add", "-b", "probe", str(path), "side")

        self.assertEqual(0, code, err)
        self.assertTrue(self.registered(path))
        self.assertTrue(git_worktrees.is_reparse_point(str(path / "web" / "node_modules")))
        self.assertEqual(
            "web", (path / "web" / "node_modules" / "marker.txt").read_text(encoding="utf-8")
        )
        self.assertFalse(os.path.lexists(path / "desktop" / "node_modules"))
        self.assertIn(f"desktop: npm ci is needed in {path / 'desktop'}", out)

    def test_run_from_a_linked_worktree_it_links_to_the_main_checkout(self) -> None:
        first = self.base / "first"
        self.assertEqual(0, self.run_tool("add", "-b", "first", str(first))[0])
        second = self.base / "second"

        code, _out, err = self.run_tool("add", "-b", "second", str(second), root=first)

        self.assertEqual(0, code, err)
        for name in ("web", "desktop"):
            self.assertEqual(
                git_worktrees.canonical(self.main / name / "node_modules"),
                git_worktrees.canonical(second / name / "node_modules"),
            )

    def test_an_option_given_as_the_commit_is_refused_before_git_runs(self) -> None:
        code, _out, err = self.run_tool("add", str(self.base / "wt"), "--", "--orphan")

        self.assertEqual(1, code)
        self.assertIn("non-option ref", err)
        self.assertFalse((self.base / "wt").exists())


class LinkTests(WorktreeCase):
    def test_modules_already_in_place_are_left_and_missing_ones_linked(self) -> None:
        path = self.base / "wt"
        self.git(self.main, "worktree", "add", "-q", "-b", "plain", str(path))
        (path / "web" / "node_modules").mkdir()
        (path / "web" / "node_modules" / "own.txt").write_text("own", encoding="utf-8")

        code, out, err = self.run_tool("link", str(path))

        self.assertEqual(0, code, err)
        self.assertIn("web: left as it is, its own node_modules", out)
        self.assertFalse(git_worktrees.is_reparse_point(str(path / "web" / "node_modules")))
        self.assertTrue((path / "web" / "node_modules" / "own.txt").is_file())
        self.assertEqual(
            "desktop",
            (path / "desktop" / "node_modules" / "marker.txt").read_text(encoding="utf-8"),
        )

    def test_the_main_checkout_and_a_directory_git_does_not_know_are_refused(self) -> None:
        stranger = self.base / "stranger"
        (stranger / "web").mkdir(parents=True)
        (stranger / "web" / "package-lock.json").write_bytes(WEB_LOCK)

        for path, reason in ((self.main, "is the main checkout"), (stranger, "is not a worktree")):
            with self.subTest(path=path.name):
                code, _out, err = self.run_tool("link", str(path))
                self.assertEqual(1, code)
                self.assertIn(reason, err)
        self.assertFalse(os.path.lexists(stranger / "web" / "node_modules"))
        self.assertFalse(git_worktrees.is_reparse_point(str(self.main / "web" / "node_modules")))


class RemoveTests(WorktreeCase):
    def setUp(self) -> None:
        super().setUp()
        self.path = self.base / "wt"
        code, _out, err = self.run_tool("add", "-b", "probe", str(self.path))
        self.assertEqual(0, code, err)

    def test_the_links_go_first_so_the_worktree_goes_whole_and_the_modules_stay(self) -> None:
        code, out, err = self.run_tool("remove", str(self.path))

        self.assertEqual(0, code, err)
        self.assertIn("web: link removed", out)
        self.assertFalse(os.path.lexists(self.path), "Git leaves a directory holding a link")
        self.assertFalse(self.registered(self.path))
        self.assert_main_modules_intact()

    def test_a_worktree_with_changes_is_refused_before_a_link_is_touched(self) -> None:
        (self.path / "draft.txt").write_text("not committed", encoding="utf-8")

        code, _out, err = self.run_tool("remove", str(self.path))

        self.assertEqual(1, code)
        self.assertIn("has changes", err)
        self.assertTrue(self.registered(self.path))
        self.assertTrue(git_worktrees.is_reparse_point(str(self.path / "web" / "node_modules")))

    def test_a_locked_worktree_is_refused_before_a_link_is_touched(self) -> None:
        self.git(self.main, "worktree", "lock", "--reason", "in use", str(self.path))

        code, _out, err = self.run_tool("remove", str(self.path))

        self.assertEqual(1, code)
        self.assertIn("is locked (in use)", err)
        self.assertTrue(git_worktrees.is_reparse_point(str(self.path / "desktop" / "node_modules")))

    @unittest.skipUnless(
        sys.platform == "win32", "Git leaves a junction behind, and only Windows has one"
    )
    def test_what_git_leaves_behind_is_reported_and_not_deleted(self) -> None:
        with mock.patch.object(worktree, "unlink_directory"):
            code, out, err = self.run_tool("remove", str(self.path))

        self.assertEqual(0, code, err)
        self.assertIn(f"left in {self.path}, which Git did not remove", out)
        self.assert_main_modules_intact()


if __name__ == "__main__":
    unittest.main()
