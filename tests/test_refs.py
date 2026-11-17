"""Where an attached commit is shown from, and what is never handed to git.

A commit is attached as a registered project and a hash, so `GET /api/commit`
asks that project's repository and no other: the path comes from the registry
alone, and the hash is a hash, so a value from the request never becomes a
directory git runs in or an option it reads. A commit is no ref, and
`GET /api/ref` refuses one with where it went.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, processes, refs, store
from server.planning import model
from server.projects import project_registry
from tests import SUITE_STORE
from tests.registry_fixtures import project_entry, registry_bytes

_PROJECT = Path(__file__).resolve().parents[1]


class ShowCommitTests(unittest.TestCase):
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
        store.connect().close()
        self.project = self.repository("alpha")
        self.other = self.repository("beta")
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

    def registry(self, **projects: str) -> mock._patch:
        """`alpha` and `beta` registered at their repositories, and each keyword as well."""

        roots = {"alpha": self.project, "beta": self.other, **projects}
        entries = [project_entry(project_id, root) for project_id, root in roots.items()]
        return mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes(entries)
        )

    def get(self, path: str) -> tuple[int, bytes]:
        captured: dict[str, object] = {}
        handler = object.__new__(http_surface.Handler)
        handler.path = path
        handler._require_host = mock.Mock(return_value=True)
        handler._send = lambda code, body, _content_type: captured.update(code=code, body=body)
        handler.do_GET()
        return int(captured["code"]), bytes(captured["body"])

    def test_a_commit_is_shown_from_its_projects_root_alone(self) -> None:
        # The other registered repository is never asked, though it is a repository too.
        with (
            self.registry(),
            mock.patch.object(processes, "run_text", wraps=processes.run_text) as run,
        ):
            code, body = self.get(f"/api/commit?repository=alpha&hash={self.commit[:7]}")
        self.assertEqual(200, code, body)
        answer = json.loads(body)
        self.assertEqual(
            {
                "kind": "commit",
                "value": self.commit[:7],
                "resolved": True,
                "repository": self.project,
            },
            {key: answer[key] for key in ("kind", "value", "resolved", "repository")},
        )
        self.assertIn("alpha: first", answer["detail"])
        self.assertIn("notes.md", answer["detail"])
        self.assertEqual([self.project], [call.args[0][2] for call in run.call_args_list])
        for call in run.call_args_list:
            self.assertEqual(refs.REF_RESOLVE_TIMEOUT, call.kwargs["timeout"])

    def test_a_hash_in_capitals_is_read_as_the_hash_it_is(self) -> None:
        with self.registry():
            answer = refs.show_commit("alpha", self.commit.upper())
        self.assertTrue(answer["resolved"], answer)
        self.assertEqual(self.commit, answer["value"])

    def test_a_commit_of_another_project_is_not_found_in_this_one(self) -> None:
        commit = self.git(self.other, "rev-parse", "HEAD")
        with self.registry():
            answer = refs.show_commit("alpha", commit)
        self.assertFalse(answer["resolved"])
        self.assertEqual("commit not found in alpha", answer["detail"])

    def test_a_project_with_no_root_here_is_said_so_and_no_git_runs(self) -> None:
        missing = os.path.join(self.scratch.name, "elsewhere")
        with self.registry(gamma=missing), mock.patch.object(processes, "run_text") as run:
            answer = refs.show_commit("gamma", self.commit)
        self.assertFalse(answer["resolved"])
        self.assertEqual("gamma has no root on this machine", answer["detail"])
        run.assert_not_called()

    def test_an_unregistered_project_is_refused_with_the_registered_ones(self) -> None:
        with self.registry(), mock.patch.object(processes, "run_text") as run:
            code, body = self.get(f"/api/commit?repository=nobody&hash={self.commit}")
        self.assertEqual(400, code)
        self.assertEqual(b"[commit] nobody is not a registered project: alpha, beta", body)
        run.assert_not_called()

    def test_what_is_no_hash_is_refused_and_never_handed_to_git(self) -> None:
        # A revision name, a path into the tree, an option and a project path are
        # all refused before any directory is chosen.
        written = os.path.join(self.scratch.name, "written.txt")
        with self.registry(), mock.patch.object(processes, "run_text") as run:
            for value in ("HEAD", "HEAD:notes.md", f"--output={written}", "abc12", ""):
                code, body = self.get(f"/api/commit?repository=alpha&hash={value}")
                self.assertEqual(400, code, value)
                self.assertTrue(body.startswith(b"[commit] "), body)
            code, _ = self.get(f"/api/commit?repository={self.project}&hash={self.commit}")
            self.assertEqual(400, code)
        run.assert_not_called()
        self.assertFalse(os.path.exists(written))


class RefKindTests(unittest.TestCase):
    """What `GET /api/ref` takes now that a commit is attached rather than a ref."""

    def get(self, query: str) -> tuple[int, bytes]:
        captured: dict[str, object] = {}
        handler = object.__new__(http_surface.Handler)
        handler.path = f"/api/ref?{query}"
        handler._require_host = mock.Mock(return_value=True)
        handler._send = lambda code, body, _content_type: captured.update(code=code, body=body)
        handler.do_GET()
        return int(captured["code"]), bytes(captured["body"])

    def test_a_commit_is_refused_with_where_it_is_attached_and_shown(self) -> None:
        with mock.patch.object(processes, "run_text") as run:
            code, body = self.get("kind=commit&value=abc1234")
        self.assertEqual(400, code)
        self.assertIn(model.COMMIT_REF_HINT.encode(), body)
        self.assertIn(b"GET /api/commit", body)
        run.assert_not_called()

    def test_a_space_is_no_longer_read(self) -> None:
        # It chose which repositories a commit was looked for in; a value that is no
        # space's identity now changes nothing, where it was refused before.
        for space in ("", "C%3A%2FWindows", "..%2F.."):
            code, body = self.get(f"kind=url&value=docs%2Fplan.md&space={space}")
            self.assertEqual(200, code, space)
            self.assertEqual(
                {
                    "kind": "url",
                    "value": "docs/plan.md",
                    "resolved": True,
                    "detail": "docs/plan.md",
                },
                json.loads(body),
            )


if __name__ == "__main__":
    unittest.main()
