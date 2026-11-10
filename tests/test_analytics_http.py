"""`GET /api/analytics/usage` on the real HTTP surface, held to the per-item read beside it."""

from __future__ import annotations

import http.client
import json
import sqlite3
import threading
from urllib.parse import urlencode

from server import http_surface, store
from server.analytics import api
from tests.analytics_fixtures import HOUR, UsageStore, day

ITEM_USAGE = "/api/planning/work-item/usage"
#: What differs between two answers for reasons that are not the route's.
_PER_ANSWER = {"date", "content-length"}


class AnalyticsHttpTests(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        self.reference, item = self.item()
        self.session("s-1")
        self.segment("s-1", 0, HOUR, item=item, organization="org-a")
        self.segment("s-1", HOUR, 2 * HOUR, agent="worker")
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.authority = f"127.0.0.1:{self.server.server_port}"

    def get(
        self, path: str, headers: dict[str, str] | None = None, host: str | None = None
    ) -> tuple[int, dict[str, str], dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            client.putrequest("GET", path, skip_host=True)
            client.putheader("Host", self.authority if host is None else host)
            for name, value in (headers or {}).items():
                client.putheader(name, value)
            client.endheaders()
            response = client.getresponse()
            raw = response.read()
            found = {name.casefold(): value for name, value in response.getheaders()}
        finally:
            client.close()
        return response.status, found, json.loads(raw) if raw.startswith(b"{") else {}

    def browser(self) -> dict[str, str]:
        return {
            "Origin": f"http://{self.authority}",
            "Sec-Fetch-Site": "same-origin",
            "X-Valkama-Session": self.server.security_context.browser_session_token,
        }

    @staticmethod
    def usage_path(**parameters: str) -> str:
        return f"{api.USAGE_PATH}?{urlencode(parameters)}"

    def test_a_browser_and_an_agent_read_the_same_answer(self) -> None:
        path = self.usage_path(**{"from": day(0), "to": day(1), "group_by": "work_item,account"})
        browser = self.get(path, self.browser())
        agent = self.get(path)
        self.assertEqual(200, browser[0])
        self.assertEqual(200, agent[0])
        self.assertEqual(browser[2], agent[2])
        self.assertEqual(api.ANALYTICS_API_INTERFACE, agent[2]["interface_version"])
        usage = agent[2]["usage"]
        self.assertEqual(2 * HOUR, usage["total"]["agent_seconds"])
        self.assertEqual(
            {self.reference, None},
            {row["group"]["work_item"]["reference"] for row in usage["rows"]},
        )

    def test_its_headers_and_its_security_are_the_per_item_reads(self) -> None:
        ours = self.usage_path(**{"from": day(0), "to": day(1)})
        theirs = f"{ITEM_USAGE}?{urlencode({'id': self.reference})}"
        for name, headers, host in (
            ("browser", self.browser(), None),
            ("agent", {}, None),
            (
                "foreign origin",
                {"Origin": "http://evil.test", "Sec-Fetch-Site": "cross-site"},
                None,
            ),
            ("foreign host", {}, "evil.test"),
            ("no host", {}, ""),
        ):
            with self.subTest(name):
                mine, neighbour = self.get(ours, headers, host), self.get(theirs, headers, host)
                self.assertEqual(neighbour[0], mine[0])
                self.assertEqual(
                    {k: v for k, v in neighbour[1].items() if k not in _PER_ANSWER},
                    {k: v for k, v in mine[1].items() if k not in _PER_ANSWER},
                )

    def test_a_refusal_has_the_neighbouring_reads_shape(self) -> None:
        neighbour = self.get(ITEM_USAGE)
        self.assertEqual(400, neighbour[0])
        for parameters in (
            {"to": day(1)},
            {"from": day(1), "to": day(0)},
            {"from": day(0), "to": day(1), "group_by": "colour"},
            {"from": day(0), "to": day(1), "utc_offset": "3h"},
        ):
            with self.subTest(parameters):
                status, headers, body = self.get(self.usage_path(**parameters))
                self.assertEqual(400, status)
                self.assertEqual(neighbour[1]["content-type"], headers["content-type"])
                self.assertEqual(set(neighbour[2]), set(body))
                self.assertEqual(set(neighbour[2]["error"]), set(body["error"]))
                self.assertEqual("invalid_request", body["error"]["code"])

    def test_a_read_writes_nothing_to_the_store(self) -> None:
        watcher = sqlite3.connect(store.db_path())
        self.addCleanup(watcher.close)

        def state() -> tuple:
            version = watcher.execute("PRAGMA data_version").fetchone()[0]
            counts = tuple(
                watcher.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in ("usage_runs", "usage_segments", "sessions", "work_items")
            )
            return version, counts

        before = state()
        path = self.usage_path(
            **{"from": day(0), "to": day(1), "group_by": "project,executor", "compare": "true"}
        )
        self.assertEqual(200, self.get(path, self.browser())[0])
        self.assertEqual(200, self.get(path)[0])
        self.assertEqual(400, self.get(self.usage_path(**{"from": day(0)}))[0])
        self.assertEqual(before, state())

    def test_another_path_under_it_is_not_found(self) -> None:
        self.assertEqual(404, self.get("/api/analytics/usage/extra")[0])
        self.assertEqual(404, self.get("/api/analytics")[0])
