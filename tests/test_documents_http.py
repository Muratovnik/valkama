"""The two document routes: what the page is told, and what it is never told."""

from __future__ import annotations

import builtins
import hashlib
import http.client
import json
import os
import re
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import documents, http_surface, processes
from server.projects import project_registry
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes

ROOT = Path(__file__).resolve().parents[1]


SCOPE = "12345678-1234-4234-8234-123456789abc"


def space_identity(key: str) -> str:
    """A planning space's exact identity, the value `GET /api/ref` takes too."""

    return planning_space_entity({"data_scope_id": SCOPE, "space_key": key})["resource_id"]


SPACE = space_identity("MAIN")
SPACE_B = space_identity("OTHER")


def write(path: Path, data: bytes = b"text") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class DocumentRoutesHarness(unittest.TestCase):
    def setUp(self) -> None:
        scratch_root = ROOT / "tmp"
        scratch_root.mkdir(exist_ok=True)
        scratch = tempfile.TemporaryDirectory(dir=scratch_root)
        self.addCleanup(scratch.cleanup)
        self.scratch = Path(os.path.realpath(scratch.name))
        self.workspace = self.scratch / "workspace"
        self.one = self.workspace / "services" / "one"
        self.other = self.scratch / "other"
        self.outside = self.scratch / "outside"
        write(self.workspace / "docs" / "plan.md", b"# plan\n")
        write(self.workspace / "src" / "a.ts")
        write(self.one / "src" / "only-one.md", b"nested\n")
        write(self.other / "b.md")
        write(self.outside / "secret.md")
        self.registry = registry_bytes(
            [
                self.bound("workspace", self.workspace, SPACE),
                project_entry("one", self.one),
                self.bound("other", self.other, SPACE_B),
            ]
        )
        reader = mock.patch.object(
            project_registry, "_read_registry_bytes", side_effect=lambda: self.registry
        )
        reader.start()
        self.addCleanup(reader.stop)
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=self.scratch / "installation-token",
        )
        thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    @staticmethod
    def bound(project: str, root: Path, space: str) -> dict:
        entry = project_entry(project, root)
        entry["planning_binding"] = {"kind": "planning-space", "resource_id": space}
        return entry

    def request(self, path: str, *, same_origin: bool = True, origin: str | None = None):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        self.addCleanup(client.close)
        headers = {"Sec-Fetch-Site": "same-origin"} if same_origin else {}
        if origin is not None:
            headers["Origin"] = origin
        client.request("GET", path, headers=headers)
        response = client.getresponse()
        return response.status, json.loads(response.read().decode("utf-8")), response.headers

    def resolve(self, *paths: str, space: str | None = SPACE) -> list[dict]:
        query = [("path", path) for path in paths]
        if space is not None:
            query.insert(0, ("space", space))
        status, body, _ = self.request(f"/api/documents/resolve?{urlencode(query)}")
        self.assertEqual(200, status, body)
        return body["paths"]

    def read(self, project: str, path: str) -> tuple[int, dict]:
        query = urlencode({"project": project, "path": path})
        status, body, _ = self.request(f"/api/documents/read?{query}")
        return status, body


class ResolveTests(DocumentRoutesHarness):
    def test_each_status_in_the_shape_the_contract_states(self) -> None:
        self.assertEqual(
            [
                {
                    "path": "docs/plan.md",
                    "status": "file",
                    "project": "workspace",
                    "relative": "docs/plan.md",
                    "markdown": True,
                },
                {
                    "path": "src/a.ts",
                    "status": "file",
                    "project": "workspace",
                    "relative": "src/a.ts",
                    "markdown": False,
                },
                {
                    "path": "./docs/../docs/plan.md",
                    "status": "file",
                    "project": "workspace",
                    "relative": "docs/plan.md",
                    "markdown": True,
                },
                {
                    "path": "docs/",
                    "status": "directory",
                    "project": "workspace",
                    "relative": "docs",
                },
                {"path": "../outside/secret.md", "status": "refused", "code": "outside_root"},
                {"path": "docs/gone.md", "status": "missing"},
                {"path": "x.md:stream", "status": "refused", "code": "invalid_path"},
            ],
            self.resolve(
                "docs/plan.md",
                "src/a.ts",
                "./docs/../docs/plan.md",
                "docs/",
                "../outside/secret.md",
                "docs/gone.md",
                "x.md:stream",
            ),
        )

    def test_a_path_in_two_nested_projects_names_neither(self) -> None:
        write(self.one / "src" / "both.ts")
        two = self.workspace / "services" / "two"
        write(two / "src" / "both.ts")
        self.registry = registry_bytes(
            [
                self.bound("workspace", self.workspace, SPACE),
                project_entry("one", self.one),
                project_entry("two", two),
            ]
        )
        self.assertEqual(
            [{"path": "src/both.ts", "status": "ambiguous"}], self.resolve("src/both.ts")
        )

    def test_a_path_only_in_a_nested_project_is_answered_from_it(self) -> None:
        answer = self.resolve("src/only-one.md")[0]
        self.assertEqual(("one", "src/only-one.md"), (answer["project"], answer["relative"]))

    def test_an_absolute_path_answers_with_its_own_project_from_another_space(self) -> None:
        raw = str(self.other / "b.md")
        self.assertEqual(
            [
                {
                    "path": raw,
                    "status": "file",
                    "project": "other",
                    "relative": "b.md",
                    "markdown": True,
                }
            ],
            self.resolve(raw),
        )

    def test_a_space_with_no_binding_leaves_relative_paths_unbound_and_absolute_ones_answered(
        self,
    ) -> None:
        for space in (space_identity("UNBOUND"), None):
            with self.subTest(space=space):
                relative, absolute = self.resolve(
                    "docs/plan.md", str(self.workspace / "docs" / "plan.md"), space=space
                )
                self.assertEqual({"path": "docs/plan.md", "status": "space_unbound"}, relative)
                self.assertEqual("file", absolute["status"])

    def test_two_bindings_of_one_space_leave_no_registry_at_all(self) -> None:
        # The registry refuses two bindings of one identity whole, so the boundary is
        # empty too: an absolute path stays closed instead of resolving.
        self.registry = registry_bytes(
            [
                self.bound("workspace", self.workspace, SPACE),
                self.bound("other", self.other, SPACE),
            ]
        )
        relative, absolute = self.resolve("docs/plan.md", str(self.workspace / "docs" / "plan.md"))
        self.assertEqual({"path": "docs/plan.md", "status": "space_unbound"}, relative)
        self.assertEqual("outside_root", absolute["code"])

    def test_a_space_that_is_no_identity_reaches_no_directory(self) -> None:
        status, body, _ = self.request("/api/documents/resolve?space=..%5Cx&path=a.md")
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))

    def resolve_from(self, project: str, *paths: str) -> tuple[int, dict]:
        query = urlencode([("project", project), *(("path", path) for path in paths)])
        status, body, _ = self.request(f"/api/documents/resolve?{query}")
        return status, body

    def test_a_document_s_project_is_a_base_like_a_space_s_root(self) -> None:
        # The project of a document the page shows: relative paths start at its root,
        # a nested project is asked after it, and the boundary is still every root.
        status, body = self.resolve_from(
            "workspace",
            "docs/plan.md",
            "src/only-one.md",
            str(self.other / "b.md"),
            "../outside/secret.md",
        )
        self.assertEqual(200, status, body)
        plan, nested, other, outside = body["paths"]
        self.assertEqual(("workspace", "docs/plan.md"), (plan["project"], plan["relative"]))
        self.assertEqual(("one", "src/only-one.md"), (nested["project"], nested["relative"]))
        self.assertEqual(("other", "b.md"), (other["project"], other["relative"]))
        self.assertEqual(
            {"path": "../outside/secret.md", "status": "refused", "code": "outside_root"}, outside
        )

    def test_a_link_from_a_document_s_folder_is_not_looked_for_in_a_nested_project(self) -> None:
        # The same path, as a path in the document's text and as a link in it.
        query = urlencode([("project", "workspace"), ("path", "src/only-one.md")])
        status, body, _ = self.request(f"/api/documents/resolve?{query}")
        self.assertEqual((200, "file"), (status, body["paths"][0]["status"]))
        status, body, _ = self.request(f"/api/documents/resolve?{query}&exact=1")
        self.assertEqual(
            (200, [{"path": "src/only-one.md", "status": "missing"}]), (status, body["paths"])
        )
        # Under the root itself it is found all the same.
        query = urlencode([("project", "workspace"), ("path", "docs/plan.md"), ("exact", "1")])
        status, body, _ = self.request(f"/api/documents/resolve?{query}")
        self.assertEqual((200, "file"), (status, body["paths"][0]["status"]))

    def test_a_project_base_is_the_registry_s_root_for_that_id(self) -> None:
        # A nested project's base is its own root, not its parent's.
        status, body = self.resolve_from("one", "src/only-one.md", "docs/plan.md")
        self.assertEqual(200, status, body)
        found, parent = body["paths"]
        self.assertEqual(("one", "src/only-one.md"), (found["project"], found["relative"]))
        self.assertEqual("missing", parent["status"])

    def test_a_project_the_registry_does_not_know_is_refused_whole(self) -> None:
        for project in ("nobody", "", "../workspace"):
            with self.subTest(project=project):
                status, body = self.resolve_from(project, "docs/plan.md")
                self.assertEqual((404, {"error": {"code": "project_unknown"}}), (status, body))

    def test_a_page_names_one_base_or_none(self) -> None:
        query = urlencode([("space", SPACE), ("project", "workspace"), ("path", "docs/plan.md")])
        status, body, _ = self.request(f"/api/documents/resolve?{query}")
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))

    def test_the_batch_limit(self) -> None:
        paths = [f"docs/{number}.md" for number in range(documents.MAX_RESOLVE_PATHS)]
        self.assertEqual(64, len(self.resolve(*paths)))
        query = urlencode([("path", path) for path in [*paths, "docs/one-more.md"]])
        status, body, _ = self.request(f"/api/documents/resolve?{query}")
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
        status, body, _ = self.request("/api/documents/resolve")
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))

    def test_resolve_opens_no_file(self) -> None:
        opened: list[object] = []
        real_open = builtins.open

        def recording_open(file, *args, **kwargs):
            opened.append(file)
            return real_open(file, *args, **kwargs)

        with mock.patch.object(builtins, "open", recording_open):
            self.resolve("docs/plan.md", "src/a.ts", "docs/gone.md")
        under_project = [str(file) for file in opened if "workspace" in str(file)]
        self.assertEqual([], under_project)

    def test_no_answer_carries_an_absolute_path_the_server_worked_out(self) -> None:
        answers = [
            *self.resolve("docs/plan.md", "docs/", "src/only-one.md", "../x.md", "docs/gone.md"),
            self.read("workspace", "docs/plan.md")[1],
            self.read("workspace", "docs/gone.md")[1],
            self.read("workspace", "../outside/secret.md")[1],
            self.read("nobody", "docs/plan.md")[1],
        ]
        spellings = (str(self.scratch), self.scratch.as_posix())
        for answer in answers:
            text = json.dumps(answer, ensure_ascii=False).replace("\\\\", "\\")
            for spelling in spellings:
                self.assertNotIn(spelling, text)


class RequestLineTests(DocumentRoutesHarness):
    """The length the page's batches hold to: `RESOLVE_ADDRESS_LIMIT` in `documentApi.ts`."""

    def status_for(self, length: int) -> int:
        start = "/api/documents/resolve?path="
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        self.addCleanup(client.close)
        client.request(
            "GET",
            start + "a" * (length - len(start)),
            headers={"Sec-Fetch-Site": "same-origin"},
        )
        response = client.getresponse()
        response.read()
        return response.status

    def test_the_address_the_page_may_send_is_answered(self) -> None:
        self.assertEqual(200, self.status_for(65_000))

    def test_the_listener_refuses_an_address_past_its_limit(self) -> None:
        self.assertEqual(414, self.status_for(65_600))


class ReadTests(DocumentRoutesHarness):
    def test_a_document_comes_with_its_facts(self) -> None:
        status, body = self.read("workspace", "docs/plan.md")
        self.assertEqual(200, status, body)
        self.assertEqual(
            {
                "project": "workspace",
                "path": "docs/plan.md",
                "markdown": "# plan\n",
                "size": 7,
                "revision": hashlib.sha256(b"# plan\n").hexdigest()[:16],
            },
            {key: value for key, value in body.items() if key != "modified_at"},
        )
        self.assertRegex(body["modified_at"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_the_size_limit_lands_exactly(self) -> None:
        limit = documents.MAX_DOC_BYTES
        write(self.workspace / "at.md", b"a" * limit)
        write(self.workspace / "over.md", b"a" * (limit + 1))
        self.assertEqual(200, self.read("workspace", "at.md")[0])
        status, body = self.read("workspace", "over.md")
        self.assertEqual(
            (413, {"error": {"code": "too_large", "size": limit + 1, "limit": limit}}),
            (status, body),
        )

    def test_a_file_that_grew_after_the_check_is_not_read_past_the_limit(self) -> None:
        limit = documents.MAX_DOC_BYTES
        path = write(self.workspace / "grows.md", b"small")
        real_stat = os.stat

        def stale(target, *args, **kwargs):
            answer = real_stat(target, *args, **kwargs)
            path.write_bytes(b"a" * (limit + 100))
            return answer

        with mock.patch.object(documents.os, "stat", stale):
            status, body = self.read("workspace", "grows.md")
        self.assertEqual((413, "too_large"), (status, body["error"]["code"]))

    def test_a_read_takes_one_byte_past_the_limit_and_no_more(self) -> None:
        limit = documents.MAX_DOC_BYTES
        path = write(self.workspace / "huge.md", b"a" * (limit + 4096))
        data, status = documents._read_bounded(str(path), str(self.workspace))
        self.assertEqual(limit + 1, len(data))
        self.assertEqual(limit + 4096, status.st_size)

    def test_what_is_not_utf8_text_is_refused(self) -> None:
        write(self.workspace / "zero.md", b"a\0b")
        write(self.workspace / "latin.md", b"text \xff")
        self.assertEqual((415, {"error": {"code": "binary"}}), self.read("workspace", "zero.md"))
        self.assertEqual((415, {"error": {"code": "not_utf8"}}), self.read("workspace", "latin.md"))

    def test_a_byte_order_mark_goes_and_line_endings_stay(self) -> None:
        raw = "\ufeff---\r\nstatus: x\r\n---\r\n# t\r\n".encode()
        write(self.workspace / "bom.md", raw)
        _, body = self.read("workspace", "bom.md")
        self.assertEqual("---\r\nstatus: x\r\n---\r\n# t\r\n", body["markdown"])
        self.assertEqual(len(raw), body["size"], "the size is of the file, not of the text")

    def test_every_refusal_has_its_status(self) -> None:
        cases = (
            ("nobody", "docs/plan.md", 404, "project_unknown"),
            ("workspace", "docs/gone.md", 404, "not_found"),
            ("workspace", "docs", 422, "directory"),
            ("workspace", "src/a.ts", 415, "not_markdown"),
            ("workspace", "x.md:stream", 400, "invalid_path"),
            ("workspace", "../outside/secret.md", 403, "outside_root"),
            ("workspace", str(self.other / "b.md"), 403, "outside_root"),
        )
        for project, path, expected, code in cases:
            with self.subTest(path):
                self.assertEqual((expected, {"error": {"code": code}}), self.read(project, path))

    def test_a_read_stays_in_the_project_it_names(self) -> None:
        # Found through `resolve` from the nested project, and not under the space's
        # root: the second check must not find it there again by itself.
        status, body = self.read("workspace", "src/only-one.md")
        self.assertEqual((404, "not_found"), (status, body["error"]["code"]))
        self.assertEqual(200, self.read("one", "src/only-one.md")[0])

    def test_a_read_fails_without_the_text_of_the_operating_system_error(self) -> None:
        with mock.patch.object(documents, "_read_bounded", side_effect=OSError("C:/the/os/text")):
            with mock.patch("sys.stderr") as log:
                status, body = self.read("workspace", "docs/plan.md")
        self.assertEqual((503, {"error": {"code": "unreadable"}}), (status, body))
        self.assertIn("C:/the/os/text", str(log.write.call_args_list))

    def test_a_read_without_its_parameters_is_a_bad_request(self) -> None:
        for query in ("project=workspace", "path=docs/plan.md", ""):
            with self.subTest(query):
                status, body, _ = self.request(f"/api/documents/read?{query}")
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))


class SearchTests(DocumentRoutesHarness):
    """`search` offers a space's Markdown files by name or by a line, as paths `resolve` takes."""

    def search(self, query: str, space: str | None = SPACE) -> tuple[int, dict]:
        asked = [("q", query)] if space is None else [("space", space), ("q", query)]
        status, body, _ = self.request(f"/api/documents/search?{urlencode(asked)}")
        return status, body

    def test_a_name_is_found_ahead_of_a_line_and_answered_from_the_space_root(self) -> None:
        write(self.workspace / "docs" / "notes.md", b"# notes\n\nSee the plan here.\n")
        status, body = self.search("plan")
        self.assertEqual(200, status, body)
        self.assertEqual(
            [
                {"path": "docs/plan.md", "line": 0, "text": ""},
                {"path": "docs/notes.md", "line": 3, "text": "See the plan here."},
            ],
            body["documents"],
        )
        # What it answers is what `resolve` takes from the same space.
        self.assertEqual("file", self.resolve("docs/plan.md")[0]["status"])

    def test_only_markdown_inside_the_space_s_own_root_is_offered(self) -> None:
        status, body = self.search("a")
        self.assertEqual(200, status, body)
        paths = [entry["path"] for entry in body["documents"]]
        self.assertNotIn("src/a.ts", paths)
        self.assertNotIn("b.md", paths)
        self.assertEqual([], self.search("secret")[1]["documents"])
        self.assertEqual(
            ["b.md"], [entry["path"] for entry in self.search("b.md", SPACE_B)[1]["documents"]]
        )

    def test_nothing_typed_and_an_unbound_space_offer_nothing(self) -> None:
        self.assertEqual((200, {"documents": []}), self.search(""))
        self.assertEqual((200, {"documents": []}), self.search("plan", space_identity("NONE")))

    def test_a_request_without_a_space_or_with_a_crafted_one_is_refused(self) -> None:
        for space in (None, "..\\x"):
            with self.subTest(space):
                status, body = self.search("plan", space)
                self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))
        status, body = self.search("x" * (documents.MAX_QUERY_CHARS + 1))
        self.assertEqual((400, "invalid_request"), (status, body["error"]["code"]))

    def test_the_answer_is_bounded(self) -> None:
        for number in range(documents.MAX_PROJECT_HITS + 5):
            write(self.workspace / "many" / f"page-{number:02}.md", b"# page\n")
        _, body = self.search("page-")
        self.assertEqual(documents.MAX_PROJECT_HITS, len(body["documents"]))

    @unittest.skipUnless(os.name == "nt", "a junction is a Windows reparse point")
    def test_a_file_behind_a_junction_out_of_the_root_is_not_offered(self) -> None:
        link = self.workspace / "escape"
        made = processes.run_text(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(self.outside)],
            # The console's code page: read only to name a failure to a person.
            encoding="utf-8",
            errors="replace",
        )
        self.assertEqual(0, made.returncode, made.stdout + made.stderr)
        # Removing a junction must leave what it points at alone.
        self.addCleanup(os.rmdir, link)
        self.assertEqual([], self.search("secret")[1]["documents"])


class RequestSourceTests(DocumentRoutesHarness):
    ROUTES = (
        "/api/documents/resolve?path=docs/plan.md",
        "/api/documents/read?project=x&path=y",
        "/api/documents/search?space=x&q=plan",
    )

    def test_only_the_page_itself_may_ask(self) -> None:
        for route in self.ROUTES:
            with self.subTest(route):
                status, body, headers = self.request(route, same_origin=False)
                self.assertEqual({"error": {"code": "fetch_metadata_refused"}}, body)
                self.assertEqual(403, status)
                self.assertEqual("no-store", headers["Cache-Control"])

    def test_a_foreign_origin_is_refused_even_claiming_same_origin(self) -> None:
        for route in self.ROUTES:
            with self.subTest(route):
                status, body, _ = self.request(route, origin="https://example.com")
                self.assertEqual((403, {"error": {"code": "origin_refused"}}), (status, body))

    def test_every_answer_tells_nothing_to_keep_or_to_guess(self) -> None:
        routes = (*self.ROUTES, "/api/documents/read?project=workspace&path=docs/plan.md")
        for route in routes:
            with self.subTest(route):
                _, _, headers = self.request(route)
                self.assertEqual("no-store", headers["Cache-Control"])
                self.assertEqual("nosniff", headers["X-Content-Type-Options"])
                self.assertEqual("application/json", headers["Content-Type"])

    def test_the_answer_is_not_rewritten_for_a_host_it_is_not_bound_to(self) -> None:
        # The route sits behind the same Host check as every other.
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        self.addCleanup(client.close)
        client.putrequest("GET", self.ROUTES[0], skip_host=True)
        client.putheader("Host", "example.com")
        client.putheader("Sec-Fetch-Site", "same-origin")
        client.endheaders()
        response = client.getresponse()
        self.assertEqual(400, response.status)
        self.assertTrue(re.search(rb"invalid_host", response.read()))


if __name__ == "__main__":
    unittest.main()
