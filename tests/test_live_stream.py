"""How the live-work frame arrives: an event of its own in a stream a page already has.

From the connection contract ("How it arrives"): a `view=planning` stream carries the
frame as `event: live` beside the space's read model, and `view=live` carries only
that event and takes no scope. A stream sends the frame when it opens and again only
when it differs from the one sent last; it computes it at most once every two seconds
and at its 60-second reread.
"""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, store, watchers
from server.planning import service
from server.projects import project_registry
from tests.registry_fixtures import registry_bytes


class LiveFramesTests(unittest.TestCase):
    """The pacing alone, on a clock the test moves."""

    def setUp(self) -> None:
        self.now = 100.0
        self.frames = http_surface.LiveFrames(clock=lambda: self.now)
        self.payload = '{"spaces": [], "elsewhere": 0}'
        self.computed = 0

    def compute(self) -> str:
        self.computed += 1
        return self.payload

    def test_the_frame_is_sent_when_the_stream_opens(self) -> None:
        self.assertEqual(
            b'event: live\ndata: {"spaces": [], "elsewhere": 0}\n\n',
            self.frames.frame(self.compute),
        )

    def test_nothing_is_computed_until_something_changed(self) -> None:
        self.frames.frame(self.compute)
        self.now += 60
        self.assertIsNone(self.frames.frame(self.compute))
        self.assertEqual(1, self.computed)

    def test_an_unchanged_frame_is_computed_and_not_sent(self) -> None:
        self.frames.frame(self.compute)
        self.now += 60
        self.frames.changed()
        self.assertIsNone(self.frames.frame(self.compute))
        self.assertEqual(2, self.computed)

    def test_a_change_within_two_seconds_waits_for_them_and_then_sends(self) -> None:
        self.frames.frame(self.compute)
        self.payload = '{"spaces": [], "elsewhere": 1}'
        self.now += 1.9
        self.frames.changed()
        self.assertIsNone(self.frames.frame(self.compute))
        self.assertEqual(1, self.computed, "not computed sooner than two seconds after the last")
        self.now += 0.1
        self.assertIn(b'"elsewhere": 1', self.frames.frame(self.compute) or b"")
        self.assertIsNone(self.frames.frame(self.compute), "computed once for one change")
        self.assertEqual(2, self.computed)


class LiveStreamTests(unittest.TestCase):
    """A real listener, read the way a browser's `EventSource` reads it."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(root / "store.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        registry = mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes([])
        )
        registry.start()
        self.addCleanup(registry.stop)
        conn = store.connect()
        try:
            service.create_planning_space(conn, project_id="live", name="Live", key="LIVE")
            self.reference = str(
                service.create_work_item(conn, space="LIVE", title="Pinned")["reference"]
            )
            service.pin_work_item(conn, self.reference, True)
            conn.commit()
        finally:
            conn.close()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.released)
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def released(self) -> None:
        """The handler lets go of the store once it notices the closed socket."""

        deadline = time.monotonic() + 3
        while watchers.WATCHERS._queues and time.monotonic() < deadline:
            time.sleep(0.05)

    def open(self, path: str) -> http.client.HTTPResponse:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(client.close)
        client.request("GET", path)
        response = client.getresponse()
        self.addCleanup(response.close)
        return response

    def events(
        self, response: http.client.HTTPResponse, seconds: float
    ) -> list[tuple[str, object]]:
        """Each event the stream wrote within `seconds`, as its name and data; comments skipped."""

        found: list[tuple[str, object]] = []
        name = "message"
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            line = response.readline().decode()
            if line.startswith("event: "):
                name = line[7:].strip()
            elif line.startswith("data: "):
                found.append((name, json.loads(line[6:])))
                name = "message"
        return found

    def test_a_live_stream_carries_only_the_frame(self) -> None:
        response = self.open("/api/events?view=live")
        self.assertEqual(200, response.status)
        ((name, frame),) = self.events(response, 1.0)
        self.assertEqual("live", name)
        assert isinstance(frame, dict)
        self.assertEqual([self.reference], [row["reference"] for row in frame["spaces"][0]["rows"]])

    def test_a_live_stream_takes_no_scope(self) -> None:
        for query in ("project=live&data_scope_id=x&space_key=LIVE", "space_key=LIVE"):
            with self.subTest(query=query):
                response = self.open(f"/api/events?view=live&{query}")
                self.assertEqual(400, response.status)

    def test_a_planning_stream_carries_exactly_one_new_kind_of_event(self) -> None:
        response = self.open("/api/events?view=planning&space=LIVE")
        events = self.events(response, 1.0)
        self.assertEqual(["message", "live"], [name for name, _data in events])
        self.assertIn(self.reference, json.dumps(events[1][1]))

    def test_a_reread_sends_the_frame_only_when_it_changed(self) -> None:
        said = {"spaces": [], "elsewhere": 0}
        with (
            mock.patch.object(http_surface.live_frame, "frame", lambda _conn: said),
            mock.patch.object(http_surface, "STREAM_REREAD_SECONDS", 0.1),
            mock.patch.object(http_surface, "LIVE_FRAME_SECONDS", 0.1),
        ):
            response = self.open("/api/events?view=live")
            self.assertEqual([("live", said)], self.events(response, 1.5))
            said = {"spaces": [], "elsewhere": 3}
            self.assertEqual([("live", said)], self.events(response, 1.5))

    def test_a_pin_another_connection_writes_reaches_an_open_stream(self) -> None:
        response = self.open("/api/events?view=live")
        self.events(response, 0.6)
        conn = store.connect()
        try:
            service.pin_work_item(conn, self.reference, False)
            conn.commit()
        finally:
            conn.close()
        self.assertEqual([("live", {"spaces": [], "elsewhere": 0})], self.events(response, 3.0))


if __name__ == "__main__":
    unittest.main()
