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


class DefectsTests(WorktreeCase):
    """`defects`: a copy of modules where a link was due, and a worker's commit carrying `web/dist`."""

    def worktree(self, branch: str, start: str = "main") -> Path:
        path = self.base / branch
        self.git(self.main, "worktree", "add", "-q", "-b", branch, str(path), start)
        return path

    def commit_bundle(self, checkout: Path, subject: str) -> str:
        """A commit in `checkout` that changes `web/dist`, by its short hash."""

        bundle = checkout / "web" / "dist" / "index.html"
        bundle.parent.mkdir(parents=True, exist_ok=True)
        bundle.write_text(f"{subject}\n", encoding="utf-8")
        self.git(checkout, "add", "-A")
        self.git(checkout, "commit", "-q", "-m", subject)
        return self.git(checkout, "rev-parse", "--short", "HEAD").strip()

    def test_the_main_checkout_has_none_whatever_it_holds(self) -> None:
        # Its own modules are directories, and its history carries web/dist under any subject.
        self.commit_bundle(self.main, "fix: a bundle committed by hand")

        self.assertEqual([], worktree.defects(self.main))

    def test_a_worktree_with_linked_modules_and_no_bundle_commit_has_none(self) -> None:
        path = self.base / "wt"
        self.assertEqual(0, self.run_tool("add", "-b", "probe", str(path))[0])
        self.assertTrue(git_worktrees.is_reparse_point(str(path / "web" / "node_modules")))

        self.assertEqual([], worktree.defects(path))

    def test_a_copy_of_modules_beside_the_main_lockfile_is_named_with_its_fix(self) -> None:
        path = self.worktree("copied")
        (path / "web" / "node_modules").mkdir()

        found = worktree.defects(path)

        self.assertEqual(1, len(found), found)
        self.assertIn(f"{path / 'web' / 'node_modules'} is a copy of its own", found[0])
        self.assertIn(
            f"remove that copy, then run python -B {self.main / 'tests' / 'worktree.py'}"
            f" link {path}",
            found[0],
        )

    def test_a_copy_beside_another_lockfile_and_an_absent_one_are_no_defect(self) -> None:
        path = self.worktree("other-lock")
        (path / "desktop" / "package-lock.json").write_bytes(DESKTOP_LOCK.replace(b"3", b"4"))
        self.git(path, "commit", "-q", "-am", "chore: another desktop lockfile")
        (path / "desktop" / "node_modules").mkdir()

        # web has no node_modules at all, desktop a copy of its own lockfile's.
        self.assertEqual([], worktree.defects(path))

    def test_a_worker_commit_that_carries_the_bundle_is_named_by_hash_and_subject(self) -> None:
        path = self.worktree("worker")
        first = self.commit_bundle(path, "fix: the drawer closes on escape")
        self.commit_bundle(path, "build(web): rebuild the bundle on the integrated head")
        second = self.commit_bundle(path, "feat(web): a wider rail")

        found = worktree.defects(path)

        self.assertEqual(2, len(found), found)
        self.assertTrue(
            found[0].startswith(f"commit {second} (feat(web): a wider rail) carries web/dist"),
            found,
        )
        self.assertTrue(
            found[1].startswith(f"commit {first} (fix: the drawer closes on escape)"), found
        )
        self.assertIn("only the integrator rebuilds it", found[0])

    def test_the_integrator_rebuild_is_no_defect(self) -> None:
        path = self.worktree("integration")
        self.commit_bundle(path, "build(web): rebuild the bundle on the integrated head")

        self.assertEqual([], worktree.defects(path))

    def test_a_merge_that_brings_a_bundle_change_is_no_defect_on_its_own(self) -> None:
        self.git(self.main, "branch", "side")
        side = self.base / "side"
        self.git(self.main, "worktree", "add", "-q", str(side), "side")
        (side / "notes.txt").write_text("side\n", encoding="utf-8")
        self.git(side, "add", "-A")
        self.git(side, "commit", "-q", "-m", "docs: a note from the side")
        path = self.worktree("merging")
        # The merge itself changes web/dist, which neither parent has.
        self.git(path, "merge", "-q", "--no-ff", "--no-commit", "side")
        bundle = path / "web" / "dist" / "index.html"
        bundle.parent.mkdir(parents=True)
        bundle.write_text("merged\n", encoding="utf-8")
        self.git(path, "add", "-A")
        self.git(path, "commit", "-q", "-m", "chore: merge side")
        self.assertIn(
            "web/dist/index.html",
            self.git(path, "show", "--first-parent", "--name-only", "--format=", "HEAD"),
        )

        self.assertEqual([], worktree.defects(path))

    def test_with_no_main_branch_the_bundle_rule_is_not_judged(self) -> None:
        path = self.worktree("worker")
        self.commit_bundle(path, "fix: the drawer closes on escape")
        self.git(self.main, "branch", "-q", "-m", "main", "trunk")

        self.assertEqual([], worktree.defects(path))


if __name__ == "__main__":
    unittest.main()
