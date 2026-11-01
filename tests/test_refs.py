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

    def registry(self) -> mock._patch:
        """The project repository registered and bound to the TST space."""

        entity = {"kind": "planning-space", "resource_id": self.space()}
        bound = registry_bytes(
            [project_entry("test", self.project, bindings=[project_binding("test", entity)])]
        )
        return mock.patch.object(project_registry, "_read_registry_bytes", return_value=bound)

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

    def test_an_unbound_space_reaches_only_the_document_roots(self) -> None:
        os.environ[documents.DOC_ROOTS_VAR] = self.docs
        with self.registry(), mock.patch.object(processes, "run_text") as run:
            run.return_value = mock.Mock(returncode=128, stdout="", stderr="")
            answer = refs.resolve_ref("commit", self.commit, space=self.space("OTHER"))
        self.assertFalse(answer["resolved"])
        roots = [call.args[0][2] for call in run.call_args_list]
        self.assertEqual([self.docs], roots)

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
