"""Where a commit ref is looked up, and what is never handed to git.

A commit written on a card belongs to the repository of the card's project far
more often than to a document root the owner happened to offer, so the lookup
asks the project the registry binds the card's space to as well. The space is
named by its exact identity; the path comes from the registry alone, so a value
from the request never becomes a directory git runs in.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import documents, http_surface, processes, refs, store
from server.projects import project_registry
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests import SUITE_STORE
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

_PROJECT = Path(__file__).resolve().parents[1]


class CommitRefRootTests(unittest.TestCase):
    def setUp(self) -> None:
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.env = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": os.path.join(self.scratch.name, "test.sqlite3"),
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_CEILING_DIRECTORIES": str(_PROJECT),
                # Every lookup reads the project registry; outside `registry()`
                # it is absent rather than the real one.
                "LOCALAPPDATA": self.scratch.name,
            },
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(os.environ.__setitem__, "VALKAMA_DB", SUITE_STORE)
        os.environ.pop(documents.DOC_ROOTS_VAR, None)
        conn = store.connect()
        try:
            self.data_scope_id = read_store_metadata(conn)["data_scope_id"]
        finally:
            conn.close()
        self.project = self.repository("project")
        self.docs = self.repository("docs")
        self.commit = self.git(self.project, "rev-parse", "HEAD")

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

    def space(self, key: str = "TST") -> str:
        entity = planning_space_entity({"data_scope_id": self.data_scope_id, "space_key": key})
        return str(entity["resource_id"])

    def registry(self, **others: str) -> mock._patch:
        """The project repository registered and bound to the TST space.

        Each keyword registers one more project under that id, bound to no space.
        """

        entity = {"kind": "planning-space", "resource_id": self.space()}
        entries = [project_entry("test", self.project, bindings=[project_binding("test", entity)])]
        entries += [project_entry(project_id, root) for project_id, root in others.items()]
        return mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes(entries)
        )

    def asked(self, run: mock.Mock) -> list[tuple[str, str]]:
        """Each git call as (subcommand, repository), in the order it ran."""

        return [(call.args[0][3], call.args[0][2]) for call in run.call_args_list]

    def get(self, query: str) -> tuple[int, bytes]:
        captured: dict[str, object] = {}
        handler = object.__new__(http_surface.Handler)
        handler.path = f"/api/ref?{query}"
        handler._require_host = mock.Mock(return_value=True)
        handler._send = lambda code, body, _content_type: captured.update(code=code, body=body)
        handler.do_GET()
        return int(captured["code"]), bytes(captured["body"])

    def test_a_commit_is_found_in_the_registered_root_of_the_cards_project(self) -> None:
        # The project's repository is no document root: the docs one is.
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry():
            code, body = self.get(f"kind=commit&value={self.commit[:7]}&space={self.space()}")
        self.assertEqual(200, code)
        answer = json.loads(body)
        self.assertTrue(answer["resolved"], answer)
        self.assertEqual(self.project, answer["repository"])
        self.assertIn("project: first", answer["detail"])

    def test_a_commit_in_no_root_is_reported_unresolved(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry():
            answer = refs.resolve_ref("commit", "0" * 40, space=self.space())
        self.assertFalse(answer["resolved"])
        self.assertIn("project", answer["detail"])
        self.assertIn("document root", answer["detail"])

    def test_a_space_that_names_a_path_is_refused_and_no_git_runs(self) -> None:
        # A path, or anything else that is not a planning space's exact
        # identity, is refused before any directory is chosen.
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry(), mock.patch.object(processes, "run_text") as run:
            for crafted in (self.project, "..%2F..", "C%3A%2FWindows"):
                code, _ = self.get(f"kind=commit&value={self.commit}&space={crafted}")
                self.assertEqual(400, code, crafted)
        run.assert_not_called()

    def test_a_malformed_registry_leaves_the_document_roots_to_answer(self) -> None:
        # The registry reports a file it cannot parse as "malformed", as it
        # does a space value that does not parse; the card's space is not at
        # fault, so the lookup goes on without the registry's roots.
        commit = self.git(self.docs, "rev-parse", "HEAD")
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=b"not = [a registry"
        ):
            code, body = self.get(f"kind=commit&value={commit[:7]}&space={self.space()}")
        self.assertEqual(200, code, body)
        answer = json.loads(body)
        self.assertTrue(answer["resolved"], answer)
        self.assertEqual(self.docs, answer["repository"])

    def test_an_unbound_space_adds_no_root_of_its_own(self) -> None:
        # Nothing is asked first for the space; the document roots come before
        # the registered repositories, as for a card with no space at all.
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry(), mock.patch.object(processes, "run_text") as run:
            run.return_value = mock.Mock(returncode=128, stdout="", stderr="")
            answer = refs.resolve_ref("commit", self.commit, space=self.space("OTHER"))
        self.assertFalse(answer["resolved"])
        self.assertEqual([("cat-file", self.docs), ("cat-file", self.project)], self.asked(run))

    def test_a_commit_is_found_in_another_registered_repository(self) -> None:
        # A space bound to one repository still carries commits of the others.
        other = self.repository("other")
        commit = self.git(other, "rev-parse", "--short", "HEAD")
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry(tools=other):
            answer = refs.resolve_ref("commit", commit, space=self.space())
        self.assertTrue(answer["resolved"], answer)
        self.assertEqual(other, answer["repository"])
        self.assertIn("other: first", answer["detail"])

    def test_roots_are_asked_in_order_and_the_search_stops_at_the_first_hit(self) -> None:
        # One existence check per repository until one has the commit, then one
        # `git show` there, and nothing after it.
        alpha = self.repository("alpha")
        beta = self.repository("beta")
        commit = self.git(alpha, "rev-parse", "HEAD")
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with (
            self.registry(alpha=alpha, beta=beta),
            mock.patch.object(processes, "run_text", wraps=processes.run_text) as run,
        ):
            answer = refs.resolve_ref("commit", commit, space=self.space())
        self.assertTrue(answer["resolved"], answer)
        self.assertEqual(alpha, answer["repository"])
        self.assertEqual(
            [
                ("cat-file", self.project),
                ("cat-file", self.docs),
                ("cat-file", alpha),
                ("show", alpha),
            ],
            self.asked(run),
        )
        for call in run.call_args_list:
            self.assertEqual(documents.REF_RESOLVE_TIMEOUT, call.kwargs["timeout"])

    def test_a_value_that_names_its_repository_is_looked_up_there_first(self) -> None:
        # By the project's id or by its directory's name, in any case; the
        # prefix is not part of the revision git is asked about.
        other = self.repository("other")
        commit = self.git(other, "rev-parse", "--short", "HEAD")
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        for value in (f"tools@{commit}", f"Other {commit}", f"other@{commit}"):
            with (
                self.registry(tools=other),
                mock.patch.object(processes, "run_text", wraps=processes.run_text) as run,
            ):
                answer = refs.resolve_ref("commit", value, space=self.space())
            self.assertTrue(answer["resolved"], value)
            self.assertEqual(other, answer["repository"], value)
            self.assertEqual(value, answer["value"])
            self.assertEqual([("cat-file", other), ("show", other)], self.asked(run), value)

    def test_a_prefix_that_names_no_project_falls_back_to_the_usual_order(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry():
            for value in (f"nobody@{self.commit[:7]}", f"workbench {self.commit[:7]}"):
                answer = refs.resolve_ref("commit", value, space=self.space())
                self.assertTrue(answer["resolved"], value)
                self.assertEqual(self.project, answer["repository"], value)

    def test_an_option_or_a_file_after_a_prefix_is_still_refused(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self.project
        written = os.path.join(self.scratch.name, "written.txt")
        with self.registry(), mock.patch.object(processes, "run_text") as run:
            for value in (f"test@--output={written}", f"test --output={written}"):
                answer = refs.resolve_ref("commit", value)
                self.assertFalse(answer["resolved"], value)
                self.assertIn("cannot begin with '-'", answer["detail"], value)
        run.assert_not_called()
        self.assertFalse(os.path.exists(written))
        with self.registry():
            self.assertFalse(refs.resolve_ref("commit", "test@HEAD:notes.md")["resolved"])
            self.assertTrue(refs.resolve_ref("commit", "test@HEAD")["resolved"])

    def test_a_value_is_never_read_as_an_option_or_as_a_file(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self.project
        written = os.path.join(self.scratch.name, "written.txt")
        for value in (f"--output={written}", "HEAD:notes.md"):
            answer = refs.resolve_ref("commit", value)
            self.assertFalse(answer["resolved"], value)
        self.assertFalse(os.path.exists(written))
        self.assertTrue(refs.resolve_ref("commit", "HEAD")["resolved"])


class CommitValueRuleTests(unittest.TestCase):
    """The one rule for a commit value that names its repository.

    The same examples are in web/tests/textReferences.test.ts ('commit names'),
    where `sameCommit` reads a recorded value by this rule.
    """

    def test_a_named_repository_is_split_from_the_revision(self) -> None:
        cases = {
            "repo@a1b2c3d": ("repo", "a1b2c3d"),
            "my-repo a1b2c3d": ("my-repo", "a1b2c3d"),
            "a1b2c3d": (None, "a1b2c3d"),
            # Git's own `@{...}` syntax, a value that begins like an option and
            # a phrase of more than two words are left whole.
            "HEAD@{1}": (None, "HEAD@{1}"),
            "-x@a1b2c3d": (None, "-x@a1b2c3d"),
            "fix the bug": (None, "fix the bug"),
            "repo@--output=x": ("repo", "--output=x"),
        }
        for value, expected in cases.items():
            self.assertEqual(expected, refs.split_commit_value(value), value)


if __name__ == "__main__":
    unittest.main()
