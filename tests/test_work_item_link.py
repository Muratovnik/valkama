"""`GET /open/<reference>`: a short address that leads to one card, on this origin only."""

from __future__ import annotations

import base64
import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from server import http_surface, mcp_surface, store
from server.ops import configuration
from server.planning import api as planning_api
from server.planning import service
from server.projects import project_registry, scopes
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import (
    planning_space_entity,
    planning_work_item_entity,
    route_entity_parameter,
)
from tests.registry_fixtures import project_entry, registry_bytes

#: Worked out by hand from the route grammar, with nothing from the module under
#: test. `web/tests/platformRoute.test.ts` holds the same literal and reads it with
#: the parser the browser runs: the two languages share this route and no code.
TWIN_ROUTE = (
    "/modules/planning/project/example-project?entity="
    "eyJraW5kIjoid29yay1pdGVtIiwicmVzb3VyY2VfaWQiOiJleUp5WldabGNtVnVZMlVpT2lKTlFVbE9MVEV5SWl3aWMz"
    "QmhZMlZmY21WbUlqcDdJbVJoZEdGZmMyTnZjR1ZmYVdRaU9pSXdNVEl6TkRVMk55MDRPV0ZpTFRSa1pXWXRPREV5TXkw"
    "ME5UWTNPRGxoWW1Oa1pXWWlMQ0p6Y0dGalpWOXJaWGtpT2lKTlFVbE9JbjE5In0"
)


def _decoded(token: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))


class RouteSpellingTests(unittest.TestCase):
    def test_the_route_entity_is_spelled_as_the_web_app_reads_it(self) -> None:
        entity = planning_work_item_entity(
            {
                "space_ref": {
                    "data_scope_id": "01234567-89ab-4def-8123-456789abcdef",
                    "space_key": "MAIN",
                },
                "reference": "MAIN-12",
            }
        )
        self.assertEqual(
            TWIN_ROUTE,
            f"/modules/planning/project/example-project?entity={route_entity_parameter(entity)}",
        )


class WorkItemLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.primary = self.root / "primary.sqlite3"
        self.attached = self.root / "attached.sqlite3"
        self.registry = self.root / "projects.json"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.primary)})
        environment.start()
        self.addCleanup(environment.stop)
        self.main = self.seed(self.primary, "MAIN", items=1)
        self.docs = self.seed(self.primary, "DOCS", items=1)
        self.seed(self.primary, "LOOSE", items=1)
        self.other_main = self.seed(self.attached, "MAIN", items=2)
        scopes.attach(str(self.primary), "attached", str(self.attached))
        self.bind(
            {"example-project": self.main, "docs-project": self.docs, "other": self.other_main}
        )
        registry_patch = mock.patch.object(
            project_registry, "_read_registry_bytes", self.registry.read_bytes
        )
        registry_patch.start()
        self.addCleanup(registry_patch.stop)
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def seed(self, path: Path, key: str, *, items: int) -> dict:
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}):
            conn = store.connect()
            try:
                service.create_planning_space(conn, project_id="seeded", name=key, key=key)
                for index in range(items):
                    service.create_work_item(conn, space=key, title=f"{key} item {index}")
                conn.commit()
                return {
                    "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                    "space_key": key,
                }
            finally:
                conn.close()

    def bind(self, bindings: dict[str, dict]) -> None:
        entries = []
        for project_id, space_ref in bindings.items():
            entry = project_entry(project_id, self.root / project_id)
            entry["planning_binding"] = planning_space_entity(space_ref)
            entries.append(entry)
        self.registry.write_bytes(registry_bytes(entries))

    def get(self, path: str, *, host: str | None = None) -> http.client.HTTPResponse:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(client.close)
        client.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        client.putheader("Host", host or f"127.0.0.1:{self.server.server_port}")
        client.endheaders()
        return client.getresponse()

    def assert_leads_to(self, path: str, project_id: str, space_ref: dict, reference: str) -> None:
        response = self.get(path)
        response.read()
        self.assertEqual(302, response.status, path)
        location = urlsplit(response.getheader("Location") or "")
        self.assertEqual(("", ""), (location.scheme, location.netloc))
        self.assertEqual(f"/modules/planning/project/{project_id}", location.path)
        entity = _decoded(parse_qs(location.query)["entity"][0])
        self.assertEqual("work-item", entity["kind"])
        self.assertEqual(
            {"reference": reference, "space_ref": space_ref}, _decoded(entity["resource_id"])
        )

    def assert_shell_says_why(self, path: str, status: int = 404) -> None:
        """The app page, so a person reads the reason; never JSON, never empty."""

        response = self.get(path)
        body = response.read()
        self.assertEqual(status, response.status, path)
        self.assertIsNone(response.getheader("Location"), path)
        self.assertIn("text/html", response.getheader("Content-Type") or "", path)
        self.assertIn(b'<div id="app"', body, path)

    def test_a_reference_redirects_to_the_card_in_any_case_and_any_space(self) -> None:
        self.assert_leads_to("/open/MAIN-1", "example-project", self.main, "MAIN-1")
        self.assert_leads_to("/open/main-1", "example-project", self.main, "MAIN-1")
        self.assert_leads_to("/open/Main-1?from=chat", "example-project", self.main, "MAIN-1")
        self.assert_leads_to("/open/docs-1", "docs-project", self.docs, "DOCS-1")

    def test_the_redirect_is_never_cached(self) -> None:
        # A number missing now may be filed a minute later, and a binding can move.
        response = self.get("/open/MAIN-1")
        response.read()
        self.assertEqual("no-store", response.getheader("Cache-Control"))

    def test_the_redirect_lands_on_a_route_this_server_serves_as_the_app(self) -> None:
        response = self.get("/open/MAIN-1")
        response.read()
        landed = self.get(response.getheader("Location") or "")
        self.assertEqual(200, landed.status)
        self.assertIn(b'<div id="app"', landed.read())

    def test_the_primary_store_answers_first_and_an_attached_store_after_it(self) -> None:
        # Both stores keep a MAIN. MAIN-1 is in both, MAIN-2 only in the attached.
        self.assert_leads_to("/open/MAIN-1", "example-project", self.main, "MAIN-1")
        self.assert_leads_to("/open/MAIN-2", "other", self.other_main, "MAIN-2")

    def test_an_address_that_leads_nowhere_gets_the_app_page(self) -> None:
        for path in (
            "/open/MAIN-99",  # no such number
            "/open/NOPE-1",  # no such space
            "/open/LOOSE-1",  # a space no project binds: no card route can name it
            "/open/not-a-number",
            "/open/MAIN-0",
            "/open/MAIN",
            "/open/",
            "/open",
        ):
            with self.subTest(path=path):
                self.assert_shell_says_why(path)

    def test_nothing_in_the_address_becomes_a_redirect(self) -> None:
        # MAIN-1 exists, so only the text around it separates these from a hit.
        for path in (
            "/open//evil.example",
            "/open/%2F%2Fevil.example",
            "/open/https:%2F%2Fevil.example",
            "/open/http://evil.example/MAIN-1",
            "/open/MAIN-1%2F%2Fevil.example",
            "/open/MAIN-1@evil.example",
            "/open/evil.example/MAIN-1",
            "/open/MAIN-1%0d%0aLocation:%20http://evil.example",
            "/open/%5C%5Cevil.example",
        ):
            with self.subTest(path=path):
                self.assert_shell_says_why(path)

    def test_a_foreign_authority_in_the_request_line_is_no_link(self) -> None:
        self.assert_shell_says_why("//evil.example/open/MAIN-1")

    def test_the_surface_refuses_any_location_that_is_not_one_card_here(self) -> None:
        # The domain cannot produce these today; this is what stops one that could.
        for location in (
            "https://evil.example/",
            "//evil.example/modules/planning/project/example-project?entity=abc",
            "/modules/planning/global",
            "/modules/planning/project/example-project?entity=abc\r\nSet-Cookie: stolen=1",
            "/modules/planning/project/example-project?entity=abc#//evil.example",
        ):
            with (
                self.subTest(location=location),
                mock.patch.object(
                    http_surface.planning_interactions,
                    "work_item_location",
                    return_value=location,
                ),
            ):
                self.assert_shell_says_why("/open/MAIN-1")

    def test_the_address_a_tool_hands_out_is_one_this_route_answers(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        answer = mcp_surface.call_tool(conn, "get_work_item", {"id": "MAIN-1"})
        assert isinstance(answer, dict)
        path = urlsplit(answer["url"]).path
        self.assert_leads_to(path, "example-project", self.main, "MAIN-1")

    def test_a_foreign_host_is_refused_as_on_every_other_route(self) -> None:
        for host in ("evil.example", f"127.0.0.1:{self.server.server_port}.evil.example"):
            with self.subTest(host=host):
                response = self.get("/open/MAIN-1", host=host)
                response.read()
                self.assertEqual(400, response.status)
                self.assertIsNone(response.getheader("Location"))

    def test_a_store_that_cannot_open_is_explained_by_the_app_not_by_json(self) -> None:
        with mock.patch.object(http_surface, "connect", side_effect=ValueError("store is too new")):
            self.assert_shell_says_why("/open/MAIN-1", 503)

    def test_an_unreadable_project_registry_is_explained_by_the_app_too(self) -> None:
        self.registry.write_bytes(b"not a registry")
        self.assert_shell_says_why("/open/MAIN-1", 503)


class WorkItemUrlTests(unittest.TestCase):
    """`url` is an addition to the answers an agent reads, and to nothing else."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        without_port = {k: v for k, v in os.environ.items() if k != "VALKAMA_PORT"}
        environment = mock.patch.dict(
            os.environ,
            {**without_port, "VALKAMA_DB": str(Path(directory.name) / "valkama.sqlite3")},
            clear=True,
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="seeded", name="Main", key="MAIN")
        service.create_work_item(self.conn, space="MAIN", title="One")
        self.conn.commit()

    def call(self, name: str, **arguments: object) -> dict:
        answer = mcp_surface.call_tool(self.conn, name, arguments)
        assert isinstance(answer, dict)
        return answer

    def test_the_full_record_carries_the_address(self) -> None:
        expected = "http://127.0.0.1:8642/open/MAIN-1"
        self.assertEqual(expected, self.call("get_work_item", id="MAIN-1")["url"])
        self.assertEqual(expected, self.call("get_work_item", id="MAIN-1", full=True)["url"])
        verbose = self.call("update_work_item", id="MAIN-1", title="Two", verbose=True)
        self.assertEqual(expected, verbose["url"])

    def test_a_write_acknowledgement_carries_the_address(self) -> None:
        created = self.call("create_work_item", space="MAIN", title="Three")
        self.assertEqual("http://127.0.0.1:8642/open/MAIN-2", created["url"])
        moved = self.call("claim_work_item", id="MAIN-1", author="one")
        self.assertEqual("http://127.0.0.1:8642/open/MAIN-1", moved["url"])

    def test_the_item_the_queue_hands_over_carries_the_address(self) -> None:
        taken = self.call("claim_ready_work_item", space="MAIN", author="one")
        self.assertEqual("http://127.0.0.1:8642/open/MAIN-1", taken["work_item"]["url"])
        self.assertIsNone(self.call("claim_ready_work_item", space="MAIN")["work_item"])

    def test_the_port_comes_from_the_one_expectation_and_a_bad_value_is_no_port(self) -> None:
        with mock.patch.dict(os.environ, {"VALKAMA_PORT": "9123"}):
            self.assertEqual(
                "http://127.0.0.1:9123/open/MAIN-1",
                self.call("get_work_item", id="MAIN-1")["url"],
            )
        for bad in ("", "abc", "0", "70000", "86420000", "-1", "٣٤٥"):
            with self.subTest(bad=bad), mock.patch.dict(os.environ, {"VALKAMA_PORT": bad}):
                self.assertEqual(configuration.DEFAULT_LISTENER_PORT, configuration.listener_port())

    def test_a_row_of_a_list_or_a_search_stays_as_it_was(self) -> None:
        listed = self.call("list_work_items", space="MAIN")
        found = self.call("search_work_items", query="MAIN-1")
        self.assertTrue(listed["work_items"])
        self.assertTrue(found["work_items"])
        for row in [*listed["work_items"], *found["work_items"]]:
            self.assertNotIn("url", row)

    def test_the_http_record_and_every_schema_stay_as_they_were(self) -> None:
        answer = planning_api.handle_get(self.conn, "/api/planning/work-item", {"id": ["MAIN-1"]})
        assert answer is not None
        self.assertNotIn("url", answer[1]["work_item"])
        for tool in mcp_surface.catalogue():
            self.assertNotIn("url", tool["inputSchema"]["properties"], tool["name"])


if __name__ == "__main__":
    unittest.main()
