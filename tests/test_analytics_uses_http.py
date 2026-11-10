"""`POST` and `GET /api/analytics/uses` on the real HTTP surface.

The write is held to its neighbour, the shell's route preference, for everything that
refuses it before it is read, and to the usage read's envelope for what it refuses
itself. Nothing refused is counted, and the read writes nothing.
"""

from __future__ import annotations

import datetime as dt
import http.client
import json
import sqlite3
import threading
from collections.abc import Mapping
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, store
from server.analytics import uses
from tests.analytics_fixtures import UsageStore

USES = "/api/analytics/uses"
NEIGHBOUR = "/api/platform/ui-prefs"
USAGE = "/api/analytics/usage"
#: The moment every use below is counted at: late on 4 March in UTC.
NOW = dt.datetime(2030, 3, 4, 22, 30, tzinfo=dt.UTC)
#: What differs between two answers for reasons that are not the route's.
_PER_ANSWER = {"date", "content-length"}

Answer = tuple[int, dict[str, str], dict]


class AnalyticsUsesHttpTests(UsageStore):
    def setUp(self) -> None:
        super().setUp()
        patch = mock.patch.object(uses, "_now", lambda: NOW)
        patch.start()
        self.addCleanup(patch.stop)
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.authority = f"127.0.0.1:{self.server.server_port}"
        self.watcher = sqlite3.connect(store.db_path())
        self.addCleanup(self.watcher.close)

    def request(
        self,
        method: str,
        path: str,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
        host: str | None = None,
    ) -> Answer:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            client.putrequest(method, path, skip_host=True)
            client.putheader("Host", self.authority if host is None else host)
            for name, value in (headers or {}).items():
                client.putheader(name, value)
            if body is not None:
                client.putheader("Content-Length", str(len(body)))
            client.endheaders(body)
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
            "Content-Type": "application/json",
        }

    def post(self, path: str, body: object, headers: Mapping[str, str] | None = None) -> Answer:
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        return self.request("POST", path, self.browser() if headers is None else headers, raw)

    def count(self, kind: str, utc_offset: int) -> dict:
        status, _, answer = self.post(USES, {"kind": kind, "utc_offset": utc_offset})
        self.assertEqual(200, status, answer)
        self.assertEqual("valkama-analytics-api", answer["interface_version"])
        return answer["use"]

    def read(self, headers: Mapping[str, str] | None = None, **parameters: str) -> Answer:
        return self.request("GET", f"{USES}?{urlencode(parameters)}", headers)

    def counted(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.watcher.execute(
                "SELECT day, kind, count FROM analytics_surface_uses ORDER BY day, kind"
            )
        ]

    def test_a_use_is_counted_on_the_callers_day_and_read_back(self) -> None:
        self.assertEqual(
            {"day": "2030-03-04", "kind": "page_open", "count": 1}, self.count("page_open", 0)
        )
        # 01:30 on the 5th three hours east of UTC, 08:30 on the 4th fourteen hours west.
        self.assertEqual(
            {"day": "2030-03-05", "kind": "page_open", "count": 1}, self.count("page_open", 180)
        )
        self.assertEqual(
            {"day": "2030-03-04", "kind": "page_open", "count": 2}, self.count("page_open", 0)
        )
        self.assertEqual(
            {"day": "2030-03-04", "kind": "task_open", "count": 1}, self.count("task_open", -840)
        )
        self.assertEqual(
            {"day": "2030-03-05", "kind": "mini_open", "count": 1}, self.count("mini_open", 840)
        )

        status, _, answer = self.read(**{"from": "2030-03-04", "to": "2030-03-06"})
        self.assertEqual(200, status)
        zero = {"page_open": 0, "panel_open": 0, "mini_open": 0, "task_open": 0}
        self.assertEqual(
            {
                "interface_version": "valkama-analytics-api",
                "uses": {
                    "from": "2030-03-04",
                    "to": "2030-03-06",
                    "total": {**zero, "page_open": 3, "task_open": 1, "mini_open": 1},
                    "days": [
                        {"day": "2030-03-04", "counts": {**zero, "page_open": 2, "task_open": 1}},
                        {"day": "2030-03-05", "counts": {**zero, "page_open": 1, "mini_open": 1}},
                    ],
                },
            },
            answer,
        )
        # `to` is not included, and a period with nothing in it reads every kind as 0.
        self.assertEqual(
            ["2030-03-04"],
            [
                day["day"]
                for day in self.read(**{"from": "2030-03-01", "to": "2030-03-05"})[2]["uses"][
                    "days"
                ]
            ],
        )
        self.assertEqual(
            {"from": "2030-03-06", "to": "2030-03-07", "total": zero, "days": []},
            self.read(**{"from": "2030-03-06", "to": "2030-03-07"})[2]["uses"],
        )

    def test_off_the_page_the_write_is_refused_as_its_neighbour_is(self) -> None:
        body = {"kind": "page_open", "utc_offset": 0}
        own = self.browser()
        cases = {
            "foreign origin": {**own, "Origin": "http://evil.test"},
            "no origin, as an agent's tool": {
                k: v for k, v in own.items() if k not in {"Origin", "X-Valkama-Session"}
            },
            "another site's fetch": {**own, "Sec-Fetch-Site": "cross-site"},
            "no session": {k: v for k, v in own.items() if k != "X-Valkama-Session"},
            "a wrong session": {**own, "X-Valkama-Session": "x" * 64},
        }
        for name, headers in cases.items():
            with self.subTest(name):
                mine, neighbour = self.post(USES, body, headers), self.post(NEIGHBOUR, {}, headers)
                self.assertIn(mine[0], {401, 403})
                self.assertEqual(neighbour[0], mine[0])
                self.assertEqual(neighbour[2], mine[2])
                self.assertEqual(
                    {k: v for k, v in neighbour[1].items() if k not in _PER_ANSWER},
                    {k: v for k, v in mine[1].items() if k not in _PER_ANSWER},
                )
        with self.subTest("a foreign host"):
            raw = json.dumps(body).encode()
            mine = self.request("POST", USES, own, raw, host="evil.test")
            neighbour = self.request("POST", NEIGHBOUR, own, b"{}", host="evil.test")
            self.assertEqual((neighbour[0], neighbour[2]), (mine[0], mine[2]))
        self.assertEqual([], self.counted())

    def test_a_body_that_is_no_json_object_is_refused_as_its_neighbour_is(self) -> None:
        for name, raw, headers in (
            ("not JSON", b"page_open", self.browser()),
            ("a JSON list", b'["page_open", 0]', self.browser()),
            ("an empty body", b"", self.browser()),
            (
                "no JSON type",
                b'{"kind": "page_open", "utc_offset": 0}',
                {**self.browser(), "Content-Type": "text/plain"},
            ),
        ):
            with self.subTest(name):
                mine = self.request("POST", USES, headers, raw)
                neighbour = self.request("POST", NEIGHBOUR, headers, raw)
                self.assertGreaterEqual(mine[0], 400)
                self.assertEqual((neighbour[0], neighbour[2]), (mine[0], mine[2]))
        self.assertEqual([], self.counted())

    def test_a_use_it_does_not_count_is_refused_in_the_reads_envelope(self) -> None:
        refusal = self.request("GET", f"{USAGE}?{urlencode({'from': '2030-03-04'})}")
        self.assertEqual(400, refusal[0])
        for body in (
            {"kind": "item_open", "utc_offset": 0},
            {"kind": "PAGE_OPEN", "utc_offset": 0},
            {"kind": 1, "utc_offset": 0},
            {"kind": "page_open"},
            {"utc_offset": 0},
            {"kind": "page_open", "utc_offset": 0, "item": "MAIN-1"},
            {"kind": "page_open", "utc_offset": "180"},
            {"kind": "page_open", "utc_offset": True},
            {"kind": "page_open", "utc_offset": 180.5},
            {"kind": "page_open", "utc_offset": None},
            {"kind": "page_open", "utc_offset": 841},
            {"kind": "page_open", "utc_offset": -841},
        ):
            with self.subTest(body=body):
                status, headers, answer = self.post(USES, body)
                self.assertEqual(400, status)
                self.assertEqual(refusal[1]["content-type"], headers["content-type"])
                self.assertEqual({"error"}, set(answer))
                self.assertEqual({"code", "message"}, set(answer["error"]))
                self.assertEqual("invalid_request", answer["error"]["code"])
        self.assertEqual([], self.counted())

    def test_the_read_answers_the_page_and_an_agent_and_writes_nothing(self) -> None:
        self.count("page_open", 0)
        self.count("panel_open", 0)

        def state() -> tuple:
            return self.watcher.execute("PRAGMA data_version").fetchone()[0], self.counted()

        before = state()
        period = {"from": "2030-03-04", "to": "2030-03-05"}
        browser = self.read(
            {k: v for k, v in self.browser().items() if k != "Content-Type"}, **period
        )
        agent = self.read(**period)
        self.assertEqual((200, 200), (browser[0], agent[0]))
        self.assertEqual(browser[2], agent[2])
        self.assertEqual(
            {"page_open": 1, "panel_open": 1, "mini_open": 0, "task_open": 0},
            agent[2]["uses"]["total"],
        )
        for refused in (
            {"to": "2030-03-05"},
            {"from": "2030-03-04"},
            {"from": "2030-03-05", "to": "2030-03-05"},
            {"from": "2030-03-04T00:00:00Z", "to": "2030-03-05"},
            {"from": "2030-02-30", "to": "2030-03-05"},
            {**period, "kind": "page_open"},
        ):
            with self.subTest(refused):
                status, _, answer = self.read(**refused)
                self.assertEqual(400, status)
                self.assertEqual("invalid_request", answer["error"]["code"])
        repeated = self.request("GET", f"{USES}?from=2030-03-04&from=2030-03-03&to=2030-03-05")
        self.assertEqual(400, repeated[0])
        self.assertEqual(before, state())
