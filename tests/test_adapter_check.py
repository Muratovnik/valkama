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

from server.ops import adapter_check
from server.platform import external, transports

CONFORMING = "conforming"
LAX = "lax"


def manifest_for(adapter_id: str) -> dict:
    return {
        "contract_version": "valkama-adapter",
        "adapter_id": adapter_id,
        "version": "1.0.0",
        "capabilities": ["memory.open"],
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

    def test_an_adapter_declaring_no_capability_is_a_warning_with_its_reason(self) -> None:
        base = self.serve(CONFORMING)
        record = record_for("example-adapter", base)
        record["manifest"]["capabilities"] = []
        report = adapter_check.check_file(self.write(record))
        self.assertEqual("warn", self.statuses(report)["capabilities"])

    def test_a_manifest_in_the_former_long_shape_fails_by_the_field_it_names(self) -> None:
        base = self.serve(CONFORMING)
        record = record_for("example-adapter", base)
        record["manifest"]["health_contract"] = {"timeout_ms": 500, "max_payload_bytes": 1024}
        report = adapter_check.check_file(self.write(record))
        self.assertEqual("fail", report["status"])
        self.assertEqual(["manifest"], [item["id"] for item in report["findings"]])
        self.assertIn("health_contract", report["findings"][0]["detail"])

    def test_a_declared_capability_is_answered_and_attributed_to_the_adapter(self) -> None:
        base = self.serve(CONFORMING)
        provider = external.ExternalProvider(
            manifest_record=manifest_for("example-adapter"),
            channel=external.HttpChannel(transports.HttpTransport(base_url=base)),
        )
        answer = provider.dispatch("memory.open", {"external_id": "note-1"})
        self.assertEqual("memory-resource", answer["result_type"])
        self.assertEqual("example-adapter", answer["provider"])

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


class _McpAdapter:
    """An MCP server as the channel sees it: one tool per declared capability."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def call_tool(self, name: str, arguments: dict) -> dict:
        self.calls.append((name, arguments))
        if name != "memory.open":
            raise transports.TransportError("adapter_refused", f"no tool {name}")
        return {"opened": True}


class McpRefusalTests(unittest.TestCase):
    def test_over_mcp_only_what_the_protocol_can_carry_is_probed(self) -> None:
        # MCP tool arguments are always an object, so the non-object probe
        # would reach this adapter as a valid empty call to a tool it declared.
        server = _McpAdapter()
        finding = adapter_check._refusal_finding(
            external.McpChannel(server), manifest_for("example-adapter")
        )
        self.assertEqual("ok", finding["status"])
        self.assertEqual([("execution.launch", {})], server.calls)


if __name__ == "__main__":
    unittest.main()
