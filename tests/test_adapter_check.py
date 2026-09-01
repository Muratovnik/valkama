"""EXT-005: whether the conformance tool can tell a good adapter from a lax one.

A tool that answers `ok` to everything is worse than no tool, so the cases here
are mostly about a deliberately lax adapter — one that accepts a capability it
never declared and reads a list as a payload. The first version of the refusal
check passed that adapter, because it asked through the client-side dispatch,
which declines both on this side and never sends anything. That case is kept
below as the one this file exists for.
"""

from __future__ import annotations

import http.server
import json
import tempfile
import threading
import unittest
from pathlib import Path

# `server.store` first, and it has to be an import isort will keep first:
# `providers` reaches analytics, which reaches back into `platform.core`, so
# entering the package through `platform` alone meets that cycle half-built.
# `store` initialises the Kernel and sorts before `server.platform`, so the
# ordering survives a formatter that reorders imports — an earlier attempt used
# a comment and a `core` import, and the formatter moved it.
from server import store  # noqa: F401  (primes the platform import cycle)
from server.ops import adapter_check
from server.platform import external

CONFORMING = "conforming"
LAX = "lax"


def manifest_for(adapter_id: str) -> dict:
    return {
        "contract_version": "valkama-adapter",
        "adapter_id": adapter_id,
        "version": "1.0.0",
        "title_key": "platform.adapters.notes-reference",
        "package_id": "example.adapter",
        "publisher_id": "example",
        "owner_id": "example",
        "configuration_owner": "example",
        "trust_owner": "example",
        "execution": "local_service",
        "supported_service_types": ["notes-reference"],
        "capabilities": ["memory.open"],
        "consumes": [],
        "contributions": [],
        "permissions": [
            {
                "permission_id": "memory.open",
                "connection_mode": "required",
                "entity_kinds": ["adapter-resource"],
                "target_kinds": ["note"],
            }
        ],
        "health_contract": {"timeout_ms": 500, "max_payload_bytes": 131072},
    }


def record_for(adapter_id: str, base_url: str) -> dict:
    return {
        "record_version": "valkama-adapter-installation",
        "manifest": manifest_for(adapter_id),
        "transport": {"kind": "http", "base_url": base_url},
    }


class _Adapter(http.server.BaseHTTPRequestHandler):
    """Serves either the conforming behaviour or the lax one, by port."""

    behaviour = CONFORMING
    adapter_id = "example-adapter"
    base_url = ""

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == external.MANIFEST_PATH:
            self._send(200, manifest_for(self.adapter_id))
        elif self.path == external.HEALTH_PATH:
            self._send(200, {"status": "ready"})
        else:
            self._send(404, {"error": "no"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        request = json.loads(self.rfile.read(length).decode("utf-8"))
        if self.behaviour == LAX:
            # Answers anything. This is the adapter the tool must catch.
            self._send(200, {"result_type": "memory-resource", "target": {}})
            return
        if request.get("capability_id") != "memory.open":
            self._send(400, {"error": "not declared"})
        elif not isinstance(request.get("payload"), dict):
            self._send(400, {"error": "payload was not an object"})
        else:
            self._send(200, {"result_type": "memory-resource", "target": {}})

    def log_message(self, *_: object) -> None:
        return


class ConformanceTests(unittest.TestCase):
    def serve(self, behaviour: str, adapter_id: str = "example-adapter") -> str:
        handler = type("Handler", (_Adapter,), {"behaviour": behaviour, "adapter_id": adapter_id})
        server = http.server.HTTPServer(("127.0.0.1", 0), handler)
        handler.base_url = f"http://127.0.0.1:{server.server_address[1]}"
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.shutdown)
        return handler.base_url

    def write(self, record: object) -> str:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "record.json"
        path.write_text(json.dumps(record), encoding="utf-8")
        return str(path)

    def statuses(self, report: dict) -> dict:
        return {item["id"]: item["status"] for item in report["findings"]}

    def test_a_conforming_adapter_passes_every_check(self) -> None:
        base = self.serve(CONFORMING)
        report = adapter_check.check_file(self.write(record_for("example-adapter", base)))
        self.assertEqual("ok", report["status"], report["findings"])
        self.assertEqual("ok", self.statuses(report)["refusals"])

    def test_an_adapter_asked_for_its_own_manifest_is_checked_against_it(self) -> None:
        # §18.4's discovery half: the owner supplies the destination, because
        # it is how the manifest is reached, and the adapter supplies the rest.
        base = self.serve(CONFORMING)
        report = adapter_check.check_source({"kind": "http", "base_url": base}, base)
        self.assertEqual("ok", report["status"], report["findings"])

    def test_an_adapter_that_answers_anything_fails_its_refusals(self) -> None:
        # The case the first version of this check got wrong. It asked through
        # `ExternalProvider.dispatch`, which declines an undeclared
        # capability and a non-object payload on this side — so the probe never
        # left the process and the lax adapter got a clean bill.
        base = self.serve(LAX)
        report = adapter_check.check_file(self.write(record_for("example-adapter", base)))
        self.assertEqual("fail", report["status"])
        self.assertEqual("fail", self.statuses(report)["refusals"])
        detail = next(i for i in report["findings"] if i["id"] == "refusals")["detail"]
        self.assertIn("never declared", detail)
        self.assertIn("not an object", detail)

    def test_a_file_describing_a_different_adapter_than_the_address_serves(self) -> None:
        # Installing this registers one adapter and reaches another — the same
        # failure `valkama setup` guards one level out.
        base = self.serve(CONFORMING, adapter_id="somebody-else")
        report = adapter_check.check_file(self.write(record_for("example-adapter", base)))
        self.assertEqual("fail", self.statuses(report)["identity"])

    def test_a_capability_without_a_permission_is_a_warning_with_its_reason(self) -> None:
        base = self.serve(CONFORMING)
        record = record_for("example-adapter", base)
        record["manifest"]["permissions"] = []
        report = adapter_check.check_file(self.write(record))
        self.assertEqual("warn", self.statuses(report)["permissions"])

    def test_an_adapter_that_is_not_running_stops_at_health(self) -> None:
        record = record_for("example-adapter", "http://127.0.0.1:1")
        record["transport"]["timeout_ms"] = 50
        report = adapter_check.check_file(self.write(record))
        statuses = self.statuses(report)
        self.assertEqual("fail", statuses["health"])
        # And says nothing about refusals, rather than reporting them as passed:
        # an adapter that never answered declined nothing.
        self.assertNotIn("refusals", statuses)

    def test_a_record_with_no_destination_reports_what_it_could_not_check(self) -> None:
        record = record_for("example-adapter", "http://127.0.0.1:1")
        record["transport"] = {}
        report = adapter_check.check(record, "nowhere")
        self.assertEqual("unknown", self.statuses(report)["reachability"])

    def test_a_manifest_that_is_not_one_fails_before_anything_is_probed(self) -> None:
        for payload, where in (
            ({"contract_version": "nope"}, "wrong contract"),
            ([], "not an object"),
        ):
            with self.subTest(where=where):
                report = adapter_check.check_file(self.write(payload))
                self.assertEqual("fail", report["status"])
                self.assertEqual(1, len(report["findings"]))

    def test_a_missing_file_is_a_finding_rather_than_a_traceback(self) -> None:
        report = adapter_check.check_file("/no/such/record.json")
        self.assertEqual("fail", report["status"])
        self.assertIn("no file", report["findings"][0]["detail"])

    def test_the_rendering_puts_the_worst_first_and_carries_the_fix(self) -> None:
        base = self.serve(LAX)
        rendered = adapter_check.render(
            adapter_check.check_file(self.write(record_for("example-adapter", base)))
        )
        self.assertLess(rendered.index("Refusals"), rendered.index("Manifest"))
        self.assertIn("fix:", rendered)


if __name__ == "__main__":
    unittest.main()
