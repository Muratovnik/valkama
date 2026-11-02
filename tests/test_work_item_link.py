"""`GET /open/<reference>`: a short address that leads to one card, on this origin only."""

from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import re
import sys
import tempfile
import threading
import time
import unittest
from collections.abc import Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from server import http_surface, mcp_surface, processes, store
from server.ops import configuration, desktop_app
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

if sys.platform == "win32":
    import _winapi

ROOT = Path(__file__).resolve().parents[1]

#: Worked out by hand from the route grammar, with nothing from the module under
#: test. `web/tests/platformRoute.test.ts` holds the same literal and reads it with
#: the parser the browser runs, and `desktop/open_path.test.js` holds it too: the
#: languages share this route and no code.
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


class LinkedStoreCase(unittest.TestCase):
    """A real listener over two stores, whose projects bind the spaces a link names."""

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

    def get(
        self,
        path: str,
        *,
        host: str | None = None,
        headers: Sequence[tuple[str, str]] = (),
    ) -> http.client.HTTPResponse:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(client.close)
        client.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        client.putheader("Host", host or f"127.0.0.1:{self.server.server_port}")
        for name, value in headers:
            client.putheader(name, value)
        client.endheaders()
        return client.getresponse()

    def assert_leads_to(
        self,
        path: str,
        project_id: str,
        space_ref: dict,
        reference: str,
        *,
        headers: Sequence[tuple[str, str]] = (),
    ) -> None:
        response = self.get(path, headers=headers)
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

    def assert_shell_says_why(
        self, path: str, status: int = 404, *, headers: Sequence[tuple[str, str]] = ()
    ) -> None:
        """The app page, so a person reads the reason; never JSON, never empty."""

        response = self.get(path, headers=headers)
        body = response.read()
        self.assertEqual(status, response.status, path)
        self.assertIsNone(response.getheader("Location"), path)
        self.assertIn("text/html", response.getheader("Content-Type") or "", path)
        self.assertIn(b'<div id="app"', body, path)


class WorkItemLinkTests(LinkedStoreCase):
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


#: What a browser sends for an address it was handed by another application.
PERSON = (
    ("Sec-Fetch-Site", "none"),
    ("Sec-Fetch-Dest", "document"),
    ("Sec-Fetch-Mode", "navigate"),
)


def _with(name: str, value: str) -> list[tuple[str, str]]:
    return [(key, value if key == name else other) for key, other in PERSON]


def _without(name: str) -> list[tuple[str, str]]:
    return [header for header in PERSON if header[0] != name]


class WorkItemLinkInAppTests(LinkedStoreCase):
    """A person's click goes to the desktop app; every other request stays a redirect.

    The app is an empty file where the installer would put it and `start_detached` is
    the seam, so everything before starting a process runs as it does on a machine with
    the app installed. No test here can reach an app that is really installed.
    """

    def setUp(self) -> None:
        super().setUp()
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.local = Path(directory.name)
        self.app = self.local / "Programs" / "valkama-desktop" / "Valkama.exe"
        self.app.parent.mkdir(parents=True)
        self.app.write_bytes(b"")
        environment = mock.patch.dict(
            os.environ,
            {
                "LOCALAPPDATA": str(self.local),
                "VALKAMA_PORT": str(self.server.server_port),
                "ELECTRON_RUN_AS_NODE": "1",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.started: list[tuple[list[str], dict]] = []
        spawn = mock.patch.object(desktop_app.processes, "start_detached", self.record_start)
        spawn.start()
        self.addCleanup(spawn.stop)

    def record_start(self, argv: list[str], **options: object) -> int:
        self.started.append((argv, options))
        return 4242

    def card_route(self, path: str) -> str:
        response = self.get(path)
        response.read()
        return response.getheader("Location") or ""

    def assert_stays_a_redirect(self, path: str, headers: Sequence[tuple[str, str]]) -> None:
        self.assert_leads_to(path, "example-project", self.main, "MAIN-1", headers=headers)
        self.assertEqual([], self.started, headers)

    @unittest.skipUnless(sys.platform == "win32", "the app is looked for only on Windows")
    def test_a_person_s_click_starts_the_app_on_the_card_and_answers_the_page(self) -> None:
        route = self.card_route("/open/MAIN-1")
        response = self.get("/open/main-1?from=chat", headers=PERSON)
        body = response.read().decode("utf-8")
        self.assertEqual(200, response.status)
        self.assertIsNone(response.getheader("Location"))
        self.assertEqual("no-store", response.getheader("Cache-Control"))
        self.assertIn("text/html", response.getheader("Content-Type") or "")
        self.assertIn("MAIN-1", body)
        self.assertIn('href="/open/MAIN-1?in=browser"', body)
        self.assertIn("window.close()", body)

        [(argv, options)] = self.started
        self.assertEqual([str(self.app), f"--open-path={route}"], argv)
        self.assertEqual(str(self.app.parent), options["cwd"])
        environment = options["env"]
        assert isinstance(environment, dict)
        self.assertNotIn("ELECTRON_RUN_AS_NODE", environment)
        self.assertEqual(str(self.server.server_port), environment["VALKAMA_PORT"])

    @unittest.skipUnless(sys.platform == "win32", "the app is looked for only on Windows")
    def test_the_page_may_run_the_one_script_it_carries_and_nothing_else(self) -> None:
        # A hash that does not match stops the tab closing and raises no error anywhere.
        response = self.get("/open/MAIN-1", headers=PERSON)
        body = response.read().decode("utf-8")
        policy = response.getheader("Content-Security-Policy") or ""
        [script] = re.findall(r"<script>(.*?)</script>", body, flags=re.DOTALL)
        digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
        self.assertIn(f"script-src 'sha256-{digest}'", policy)
        self.assertIn("default-src 'none'", policy)

    @unittest.skipUnless(sys.platform == "win32", "the app is looked for only on Windows")
    def test_the_page_speaks_the_language_the_app_falls_back_on(self) -> None:
        for accept, expected in (
            ("ru-RU,ru;q=0.9,en;q=0.8", 'lang="ru"'),
            ("en-US,en;q=0.9,ru;q=0.8", 'lang="ru"'),
            ("en-US,en;q=0.9", 'lang="en"'),
            ("de", 'lang="en"'),
        ):
            with self.subTest(accept=accept):
                response = self.get("/open/MAIN-1", headers=[*PERSON, ("Accept-Language", accept)])
                self.assertIn(expected, response.read().decode("utf-8"))
        response = self.get("/open/MAIN-1", headers=PERSON)
        self.assertIn('lang="en"', response.read().decode("utf-8"))

    def test_only_a_navigation_started_outside_any_page_starts_the_app(self) -> None:
        for headers in (
            [],
            _with("Sec-Fetch-Site", "cross-site"),
            _with("Sec-Fetch-Site", "same-site"),
            _with("Sec-Fetch-Site", "same-origin"),
            _with("Sec-Fetch-Dest", "image"),
            _with("Sec-Fetch-Dest", "iframe"),
            _with("Sec-Fetch-Dest", "empty"),
            _with("Sec-Fetch-Mode", "no-cors"),
            _with("Sec-Fetch-Mode", "cors"),
            _without("Sec-Fetch-Site"),
            _without("Sec-Fetch-Dest"),
            _without("Sec-Fetch-Mode"),
            [*PERSON, ("Sec-Fetch-Site", "none")],
            _with("Sec-Fetch-Site", "NONE"),
            [*PERSON, ("Sec-Purpose", "prefetch;prerender")],
            [*PERSON, ("Purpose", "prefetch")],
        ):
            with self.subTest(headers=headers):
                self.assert_stays_a_redirect("/open/MAIN-1", headers)

    def test_asking_for_the_browser_keeps_the_redirect(self) -> None:
        self.assert_stays_a_redirect("/open/MAIN-1?in=browser", PERSON)

    def test_a_launch_that_fails_falls_back_on_the_redirect(self) -> None:
        for failure in (FileNotFoundError("gone"), PermissionError("refused"), OSError("bad")):
            with (
                self.subTest(failure=failure),
                mock.patch.object(desktop_app.processes, "start_detached", side_effect=failure),
            ):
                self.assert_stays_a_redirect("/open/MAIN-1", PERSON)

    def test_an_address_that_leads_nowhere_is_explained_by_the_app_page_and_starts_nothing(
        self,
    ) -> None:
        for path in ("/open/MAIN-99", "/open/NOPE-1", "/open/LOOSE-1", "/open/not-a-number"):
            with self.subTest(path=path):
                self.assert_shell_says_why(path, headers=PERSON)
        self.assertEqual([], self.started)

    def test_a_store_that_cannot_open_starts_nothing(self) -> None:
        with mock.patch.object(http_surface, "connect", side_effect=ValueError("too new")):
            self.assert_shell_says_why("/open/MAIN-1", 503, headers=PERSON)
        self.assertEqual([], self.started)

    def test_a_foreign_host_starts_nothing(self) -> None:
        response = self.get("/open/MAIN-1", host="evil.example", headers=PERSON)
        response.read()
        self.assertEqual(400, response.status)
        self.assertEqual([], self.started)

    def test_without_the_app_the_click_is_a_redirect(self) -> None:
        self.app.unlink()
        self.assert_stays_a_redirect("/open/MAIN-1", PERSON)

    def test_without_a_local_application_data_folder_the_click_is_a_redirect(self) -> None:
        del os.environ["LOCALAPPDATA"]
        self.assert_stays_a_redirect("/open/MAIN-1", PERSON)

    def test_outside_windows_the_app_is_not_looked_for(self) -> None:
        with mock.patch.object(desktop_app, "sys", SimpleNamespace(platform="linux")):
            self.assert_stays_a_redirect("/open/MAIN-1", PERSON)

    def test_a_listener_on_another_port_keeps_its_links_to_itself(self) -> None:
        # An open window belongs to the expected port and would look in another store.
        os.environ["VALKAMA_PORT"] = str(self.server.server_port + 1)
        self.assert_stays_a_redirect("/open/MAIN-1", PERSON)


#: The right to wait for a process and nothing else.
SYNCHRONIZE = 0x00100000


@unittest.skipUnless(sys.platform == "win32", "the app is looked for only on Windows")
class DesktopAppProcessTests(LinkedStoreCase):
    """The same click with a real child, standing in for the app at the last moment."""

    def setUp(self) -> None:
        super().setUp()
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.local = Path(directory.name)
        self.app = self.local / "Programs" / "valkama-desktop" / "Valkama.exe"
        self.app.parent.mkdir(parents=True)
        self.app.write_bytes(b"")
        self.report = self.local / "report.json"
        self.release = self.local / "release"
        self.child = self.local / "child.py"
        self.child.write_text(
            "import json, os, sys, time\n"
            "report, release = sys.argv[1:3]\n"
            "with open(report + '.tmp', 'w', encoding='utf-8') as out:\n"
            "    json.dump({'argv': sys.argv[3:], 'cwd': os.getcwd(),\n"
            "               'run_as_node': os.environ.get('ELECTRON_RUN_AS_NODE'),\n"
            "               'port': os.environ.get('VALKAMA_PORT')}, out)\n"
            "os.replace(report + '.tmp', report)\n"
            "deadline = time.monotonic() + 30\n"
            "while time.monotonic() < deadline and not os.path.exists(release):\n"
            "    time.sleep(0.05)\n",
            encoding="utf-8",
        )
        environment = mock.patch.dict(
            os.environ,
            {
                "LOCALAPPDATA": str(self.local),
                "VALKAMA_PORT": str(self.server.server_port),
                "ELECTRON_RUN_AS_NODE": "1",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        real_start = processes.start_detached

        def start_child_instead(argv: list[str], **options: Any) -> int:
            command = [sys.executable, str(self.child), str(self.report), str(self.release)]
            pid = real_start([*command, *argv[1:]], **options)
            self.addCleanup(self.let_child_finish, _winapi.OpenProcess(SYNCHRONIZE, False, pid))
            return pid

        spawn = mock.patch.object(desktop_app.processes, "start_detached", start_child_instead)
        spawn.start()
        self.addCleanup(spawn.stop)

    def let_child_finish(self, handle: int) -> None:
        """It holds its working directory, which goes with this test's folder."""

        self.release.write_bytes(b"")
        _winapi.WaitForSingleObject(handle, 20_000)
        _winapi.CloseHandle(handle)

    def test_the_child_gets_the_route_and_a_clean_environment_and_nobody_waits_for_it(self) -> None:
        route = self.get("/open/MAIN-1")
        route.read()
        response = self.get("/open/MAIN-1", headers=PERSON)
        response.read()
        # The answer is here while the child is still waiting for `release`.
        self.assertEqual(200, response.status)
        self.assertFalse(self.release.exists())
        deadline = time.monotonic() + 20
        while not self.report.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        seen = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual([f"--open-path={route.getheader('Location')}"], seen["argv"])
        self.assertIsNone(seen["run_as_node"])
        self.assertEqual(str(self.server.server_port), seen["port"])
        self.assertEqual(
            os.path.normcase(os.path.realpath(self.app.parent)),
            os.path.normcase(os.path.realpath(seen["cwd"])),
        )


class DesktopContractTests(unittest.TestCase):
    """What the server and the other copies of the same fact must agree on."""

    def test_the_app_is_where_the_tray_starts_it(self) -> None:
        # install-desktop.ps1 compares its target with this same default.
        tray = (ROOT / "windows" / "tray.ps1").read_text(encoding="utf-8")
        found = re.search(r'\$AppPath = "\$env:LOCALAPPDATA\\([^"]+)"', tray)
        assert found is not None
        self.assertEqual(found.group(1).split("\\"), list(desktop_app._INSTALLED_APP))

    def test_the_app_accepts_the_one_route_this_surface_lets_through(self) -> None:
        source = (ROOT / "desktop" / "open_path.js").read_text(encoding="utf-8")
        self.assertIn(f"const OPEN_PATH_SWITCH = '{desktop_app._OPEN_PATH_SWITCH}'", source)
        found = re.search(r"const CARD_ROUTE = /\^(.*)\$/\n", source)
        assert found is not None
        self.assertEqual(http_surface._CARD_ROUTE.pattern, found.group(1).replace(r"\/", "/"))


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
