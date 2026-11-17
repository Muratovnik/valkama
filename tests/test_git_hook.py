"""The Git hook in real Git: which commit leaves a record, and where.

Every commit here is made by `git` itself, with the hooks the release writes in a
global configuration file of the test's own (`commit_fixtures`), so the guard in
`sh`, the launcher's command line and Git's own hook runner are all on the way.
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest import mock

from server.hooks import commit_records, git_hook
from server.projects import project_registry

from .commit_fixtures import CALL, CLAUDE, CODEX, PROJECT, CommitPlace


def _read(path: Path) -> dict:
    return json.loads(path.read_bytes().decode("utf-8"))


class SessionTests(unittest.TestCase):
    """Whose commit is recorded: a client session's, never anyone else's."""

    def test_a_commit_without_a_session_leaves_nothing(self) -> None:
        place = CommitPlace(self)
        place.commit(place.repository, "by-a-person")
        self.assertEqual([], place.everywhere())

    def test_a_commit_without_a_session_starts_no_interpreter(self) -> None:
        """The command names an interpreter that does not exist: only the guard can keep the
        commit quiet, and a session in the environment shows the guard is what did."""

        place = CommitPlace(self, python="no-such-directory/python.exe")
        quiet = place.commit(place.repository, "by-a-person")
        self.assertEqual(b"", quiet.stderr)
        self.assertEqual([], place.everywhere())
        loud = place.commit(
            place.repository, "by-an-agent", environ=place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE)
        )
        self.assertNotEqual(b"", loud.stderr, "control: with a session the command runs")

    def test_two_client_sessions_leave_a_file_each(self) -> None:
        place = CommitPlace(self)
        environ = place.sessions(
            CLAUDE_CODE_SESSION_ID=CLAUDE,
            CODEX_SESSION_ID=CODEX,
            CODEX_THREAD_ID=CODEX,
            CODEX_TOOL_CALL_ID=CALL,
        )
        place.commit(place.repository, "nested", environ=environ)
        files = place.beside_the_store()
        self.assertEqual(
            sorted([CLAUDE, CODEX]), sorted(path.name.split("--")[0] for path in files)
        )
        first, second = files
        self.assertEqual(first.read_bytes(), second.read_bytes(), "one record, written twice")
        self.assertEqual(first.name.split("--")[1], second.name.split("--")[1], "one time and hex")
        record = _read(first)
        self.assertEqual({"session_id": CLAUDE}, record["claude"])
        self.assertEqual(
            {"session_id": CODEX, "thread_id": CODEX, "tool_call_id": CALL}, record["codex"]
        )

    def test_codex_without_a_session_id_is_named_by_its_thread(self) -> None:
        place = CommitPlace(self)
        place.commit(
            place.repository,
            "thread",
            environ=place.sessions(CODEX_THREAD_ID=CODEX, CODEX_TOOL_CALL_ID=CALL),
        )
        [path] = place.beside_the_store()
        self.assertTrue(path.name.startswith(CODEX + "--"))
        record = _read(path)
        self.assertIsNone(record["claude"])
        self.assertEqual(
            {"session_id": CODEX, "thread_id": CODEX, "tool_call_id": CALL}, record["codex"]
        )


class RepositoryTests(unittest.TestCase):
    """Which repository a commit is recorded for."""

    def setUp(self) -> None:
        self.place = CommitPlace(self)
        self.claude = self.place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE)

    def test_git_dash_c_from_the_space_root_reports_the_nested_repository(self) -> None:
        place = self.place
        place.commit(place.space, "nested", environ=self.claude, git_c="R")
        [path] = place.beside_the_store()
        self.assertTrue(path.name.startswith(CLAUDE + "--"))
        record = _read(path)
        self.assertEqual(
            {
                "format": "valkama-commit-record",
                "version": 1,
                "event": "post-commit",
                "rewrite": None,
                "rewritten": [],
                "root": str(place.repository).replace("\\", "/"),
                "project_id": PROJECT,
                "claude": {"session_id": CLAUDE},
                "codex": None,
            },
            {key: record[key] for key in record if key not in ("commits", "occurred_at")},
        )
        [commit] = record["commits"]
        self.assertEqual(place.head(), commit["hash"])
        parent = place.git(place.repository, "rev-parse", "HEAD~1").stdout.decode("ascii").strip()
        self.assertEqual([parent], commit["parents"])
        self.assertEqual("feat: nested", commit["subject"])
        self.assertTrue(commit["committed_at"])
        self.assertTrue(commit_records.valid(record))
        # The root's path is compared without case and separators: the registry wrote it
        # in capitals with backslashes.
        self.assertEqual([], place.in_the_git_directory())

    def test_an_unregistered_repository_is_not_recorded(self) -> None:
        place = self.place
        place.commit(place.space, "in-the-space-root", environ=self.claude)
        self.assertEqual([], place.everywhere())

    def test_a_linked_worktree_reports_its_main_checkout(self) -> None:
        place = self.place
        linked = place.base / "linked"
        place.git(place.repository, "worktree", "add", "-q", "-b", "side", str(linked))
        place.commit(linked, "in-the-worktree", environ=self.claude)
        [path] = place.beside_the_store()
        record = _read(path)
        self.assertEqual(str(place.repository).replace("\\", "/"), record["root"])
        self.assertEqual(place.head(linked), record["commits"][0]["hash"])

    def test_a_commit_inside_a_rebase_is_not_recorded(self) -> None:
        # The main checkout's rebase is seen in its `.git`; a linked worktree's `.git`
        # is a file, and its rebase is seen in the directories Git names.
        for checkout in ("main", "linked"):
            with self.subTest(checkout=checkout):
                place = CommitPlace(self)
                claude = place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE)
                where = place.repository
                if checkout == "linked":
                    where = place.base / "linked"
                    place.git(place.repository, "worktree", "add", "-q", "-b", "side", str(where))
                place.git(where, "checkout", "-q", "-b", "topic")
                place.commit(where, "one")
                place.commit(where, "two")
                place.git(where, "checkout", "-q", "-")
                place.commit(where, "base")
                place.git(where, "checkout", "-q", "topic")
                before = place.head(where)
                place.git(where, "rebase", "-q", "@{-1}", environ=claude)
                self.assertNotEqual(before, place.head(where), "the rebase made new commits")
                self.assertEqual([], place.everywhere())
                place.commit(where, "after", environ=claude)
                self.assertEqual(
                    1, len(place.beside_the_store()), "control: a plain commit is recorded"
                )


class PlaceTests(unittest.TestCase):
    """Where the record is left: beside the store the one resolution names, or in Git."""

    def setUp(self) -> None:
        self.place = CommitPlace(self)

    def configured(self, **extra: str) -> dict[str, str]:
        """No `VALKAMA_DB`: the configuration file of the home names the store."""

        config = self.place.home / ".valkama" / "config.json"
        config.parent.mkdir()
        config.write_text(json.dumps({"store": str(self.place.store)}), encoding="utf-8")
        environ = self.place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE, **extra)
        del environ["VALKAMA_DB"]
        return environ

    def test_the_record_goes_beside_the_configured_store(self) -> None:
        self.place.commit(self.place.repository, "configured", environ=self.configured())
        self.assertEqual(1, len(self.place.beside_the_store()))

    def test_a_protected_store_gets_no_record(self) -> None:
        environ = self.configured(VALKAMA_PROTECTED_STORE=str(self.place.store))
        self.place.commit(self.place.repository, "protected", environ=environ)
        self.assertEqual([], self.place.everywhere(), "neither beside it nor in Git")

    def test_without_the_store_s_file_the_record_waits_in_the_git_directory(self) -> None:
        place = self.place
        environ = place.sessions(
            CLAUDE_CODE_SESSION_ID=CLAUDE, VALKAMA_DB=str(place.base / "elsewhere" / "v.sqlite3")
        )
        place.commit(place.repository, "fallback", environ=environ)
        [path] = place.in_the_git_directory()
        self.assertEqual(place.head(), _read(path)["commits"][0]["hash"])
        self.assertFalse((place.base / "elsewhere").exists(), "no store directory is created")
        status = place.git(place.repository, "status", "--porcelain", "--ignored")
        self.assertEqual(b"", status.stdout, "nothing in the work tree")

    def test_a_store_directory_that_takes_nothing_sends_the_record_to_git(self) -> None:
        place = self.place
        blocker = place.store.parent / commit_records.DIRECTORY
        blocker.write_bytes(b"a file where the directory would be")
        place.commit(
            place.repository, "refused", environ=place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE)
        )
        self.assertEqual(1, len(place.in_the_git_directory()))


class CommandTests(unittest.TestCase):
    def test_the_command_guards_then_runs_the_launcher_with_its_event(self) -> None:
        text = git_hook.command("C:\\Program Files\\Python\\python.exe", "/l/v.py", "post-commit")
        self.assertEqual(
            git_hook.GUARD + '; exec "C:/Program Files/Python/python.exe" -I -S /l/v.py'
            " git-hook run post-commit",
            text,
        )

    def test_the_registry_path_is_the_registry_s_own(self) -> None:
        for local in (os.path.join("somewhere", "Local"), None):
            with self.subTest(local=local), mock.patch.dict(os.environ):
                os.environ.pop("LOCALAPPDATA", None)
                if local is not None:
                    os.environ["LOCALAPPDATA"] = local
                self.assertEqual(project_registry.registry_path(), commit_records.registry_path())

    def test_another_event_records_nothing_yet(self) -> None:
        environ = {"CLAUDE_CODE_SESSION_ID": CLAUDE}
        for event in ("post-rewrite", "post-merge", "unknown"):
            with self.subTest(event=event):
                self.assertEqual([], git_hook.run([event, "amend"], environ))
        self.assertEqual(0, git_hook.main([]))


if __name__ == "__main__":
    unittest.main()
