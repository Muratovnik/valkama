"""The external adapter contract, and the transports that carry it.

An adapter declares four things about itself -- the contract it speaks, its id,
its version and the capabilities it answers -- and the owner states where it is.
The cases here are mostly refusals: a contract that accepted a field nobody
checks, or a destination nobody vetted, would be a contract only on paper.
"""

from __future__ import annotations

import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from server.platform import adapter_contract, external, transports
from server.store_identity.primitives import (
    ContractError,
    InvalidDiscriminantError,
    MissingFieldError,
    UnknownFieldError,
    UnsafePayloadError,
)

_MANIFEST = {
    "contract_version": "valkama-adapter",
    "adapter_id": "example-adapter",
    "version": "1.0.0",
    "capabilities": ["memory.open"],
}


class AdapterManifestTests(unittest.TestCase):
    """Four fields, every one required, nothing else accepted."""

    def test_a_manifest_is_exactly_its_four_fields(self) -> None:
        self.assertEqual(_MANIFEST, adapter_contract.validate_adapter_manifest(dict(_MANIFEST)))
        for field in _MANIFEST:
            with self.subTest(missing=field), self.assertRaises(MissingFieldError):
                adapter_contract.validate_adapter_manifest(
                    {key: value for key, value in _MANIFEST.items() if key != field}
                )

    def test_a_field_the_contract_does_not_name_is_refused(self) -> None:
        # What the registry-era manifest carried is now exactly such a field:
        # an adapter still sending it is told so rather than half-read.
        for field, value in (
            ("title_key", "platform.adapters.example"),
            ("execution", "local_service"),
            ("permissions", []),
            ("health_contract", {"timeout_ms": 500, "max_payload_bytes": 1024}),
        ):
            with self.subTest(field=field), self.assertRaises(UnknownFieldError):
                adapter_contract.validate_adapter_manifest({**_MANIFEST, field: value})

    def test_an_argv_in_a_manifest_is_refused(self) -> None:
        # A manifest may come from the adapter itself; the transport half,
        # which the owner writes, is the only place an argv belongs.
        with self.assertRaises(ContractError):
            adapter_contract.validate_adapter_manifest(
                {**_MANIFEST, "transport": {"kind": "cli", "command": ["/usr/bin/python"]}}
            )
        with self.assertRaises(UnsafePayloadError):
            adapter_contract.validate_adapter_manifest({**_MANIFEST, "adapter_id": "<script>"})

    def test_each_field_is_held_to_its_own_grammar(self) -> None:
        for field, value, refusal in (
            ("contract_version", "valkama-adapter-v2", InvalidDiscriminantError),
            ("version", "1.0", ContractError),
            ("capabilities", ["memory"], ContractError),
            ("capabilities", ["Memory.Open"], ContractError),
            ("capabilities", ["memory.open", "memory.open"], ContractError),
            ("capabilities", "memory.open", ContractError),
            ("adapter_id", "", ContractError),
        ):
            with self.subTest(field=field, value=value), self.assertRaises(refusal):
                adapter_contract.validate_adapter_manifest({**_MANIFEST, field: value})

    def test_the_capability_set_is_the_adapter_s_own(self) -> None:
        # No list here decides which capability ids exist: the caller checks a
        # call against what the adapter declared.
        manifest = {**_MANIFEST, "capabilities": ["notes.search", "trace.export-run"]}
        self.assertEqual(
            ["notes.search", "trace.export-run"],
            adapter_contract.validate_adapter_manifest(manifest)["capabilities"],
        )
        self.assertEqual(
            [],
            adapter_contract.validate_adapter_manifest({**_MANIFEST, "capabilities": []})[
                "capabilities"
            ],
        )


class AdapterTransportTests(unittest.TestCase):
    """Where an adapter is: an address or an argv, never both."""

    transport = staticmethod(adapter_contract.validate_adapter_transport)

    def test_the_kind_names_the_protocol(self) -> None:
        self.assertEqual(
            {"kind": "http", "base_url": "http://127.0.0.1:1"},
            self.transport({"kind": "http", "base_url": "http://127.0.0.1:1"}),
        )
        for kind in ("cli", "mcp"):
            with self.subTest(kind=kind):
                self.assertEqual(
                    {"kind": kind, "command": ["/usr/bin/python", "adapter.py"]},
                    self.transport({"kind": kind, "command": ["/usr/bin/python", "adapter.py"]}),
                )
        with self.assertRaises(InvalidDiscriminantError):
            self.transport({"kind": "grpc", "base_url": "http://127.0.0.1:1"})

    def test_an_address_and_an_argv_do_not_mix(self) -> None:
        with self.assertRaises(ContractError):
            self.transport({"kind": "cli", "command": ["x"], "base_url": "http://127.0.0.1:1"})
        with self.assertRaises(ContractError):
            self.transport({"kind": "http", "base_url": "http://127.0.0.1:1", "command": ["x"]})

    def test_an_empty_argv_is_not_a_command(self) -> None:
        with self.assertRaises(MissingFieldError):
            self.transport({"kind": "cli", "command": []})

    def test_an_unknown_field_and_an_unbounded_limit_are_refused(self) -> None:
        with self.assertRaises(UnknownFieldError):
            self.transport({"kind": "http", "base_url": "http://127.0.0.1:1", "proxy": "x"})
        with self.assertRaises(ContractError):
            self.transport({"kind": "http", "base_url": "http://127.0.0.1:1", "timeout_ms": 0})

    def test_a_credential_stays_a_reference_in_the_record(self) -> None:
        # Resolved at call time by the transport, never stored resolved: a
        # record gets logged, dumped and exported, and a token in one is a
        # token in all three.
        answer = self.transport(
            {
                "kind": "http",
                "base_url": "https://cloud.langfuse.com",
                "headers": {"Authorization": "Basic ${LANGFUSE_KEYS}"},
            }
        )
        self.assertEqual("Basic ${LANGFUSE_KEYS}", answer["headers"]["Authorization"])


class ExternalProviderTests(unittest.TestCase):
    def test_an_unreachable_endpoint_is_unavailable_rather_than_an_exception(self) -> None:
        provider = external.ExternalProvider(
            manifest_record=_MANIFEST,
            channel=external.HttpChannel(
                transports.HttpTransport(base_url="http://127.0.0.1:1", timeout_ms=50)
            ),
        )
        state, diagnostics = provider.health()
        self.assertEqual("unavailable", state)
        # The transport's own code says how the call failed; a health reader
        # wants what that means for the adapter.
        self.assertEqual("provider_unavailable", (diagnostics or {})["code"])


class AddressPolicyTests(unittest.TestCase):
    """Where an adapter may be reached, and where it may not."""

    def test_plaintext_reaches_loopback_and_nothing_else(self) -> None:
        for good in ("http://127.0.0.1:6006", "http://localhost:16006", "http://[::1]:4000"):
            with self.subTest(url=good):
                self.assertTrue(transports.HttpTransport(base_url=good).base_url)
        with self.assertRaises(transports.TransportError) as refused:
            transports.HttpTransport(base_url="http://phoenix.example.com")
        self.assertEqual("transport_insecure_remote", refused.exception.code)

    def test_a_remote_host_over_tls_is_allowed(self) -> None:
        self.assertTrue(transports.HttpTransport(base_url="https://cloud.langfuse.com").base_url)

    def test_a_hostname_that_merely_looks_local_is_not_loopback(self) -> None:
        # `127.0.0.1.evil.example` and `localhost.attacker.example` both read as
        # local to a substring check, which is why this is an address test.
        for spelling in ("127.0.0.1.evil.example", "localhost.attacker.example", "0x7f000001"):
            with self.subTest(host=spelling):
                self.assertFalse(transports.is_loopback(spelling))

    def test_only_http_and_https(self) -> None:
        for bad in ("file:///etc/passwd", "ftp://host/x", "gopher://host"):
            with self.subTest(url=bad):
                with self.assertRaises(transports.TransportError) as refused:
                    transports.HttpTransport(base_url=bad)
                self.assertEqual("transport_scheme_refused", refused.exception.code)

    def test_a_path_may_not_climb_out_of_its_base(self) -> None:
        transport = transports.HttpTransport(base_url="http://127.0.0.1:6006/v1")
        with self.assertRaises(transports.TransportError) as refused:
            transport.url_for("/../../admin")
        self.assertEqual("transport_path_refused", refused.exception.code)

    def test_bounds_are_ceilings_the_caller_may_lower_but_not_raise(self) -> None:
        for field, value, code in (
            ("timeout_ms", transports.MAX_TIMEOUT_MS + 1, "transport_timeout_refused"),
            ("timeout_ms", 0, "transport_timeout_refused"),
            ("max_payload_bytes", transports.MAX_PAYLOAD_BYTES + 1, "transport_bound_refused"),
        ):
            with self.subTest(field=field, value=value):
                with self.assertRaises(transports.TransportError) as refused:
                    transports.HttpTransport(base_url="http://127.0.0.1:1", **{field: value})
                self.assertEqual(code, refused.exception.code)


class SecretReferenceTests(unittest.TestCase):
    """A credential is a reference, resolved at call time or refused."""

    def test_a_reference_is_expanded_from_the_environment(self) -> None:
        transport = transports.HttpTransport(
            base_url="https://cloud.langfuse.com",
            headers={"Authorization": "Bearer ${LANGFUSE_SECRET}"},
        )
        resolved = transport.resolved_headers({"LANGFUSE_SECRET": "sk-lf-abc"})
        self.assertEqual({"Authorization": "Bearer sk-lf-abc"}, resolved)
        # And the resolved value is never kept: the transport still holds the
        # reference, so a manifest dump or a log of it carries no secret.
        self.assertIn("${LANGFUSE_SECRET}", transport.headers["Authorization"])

    def test_a_resolved_value_carrying_a_line_break_is_refused_rather_than_sent(self) -> None:
        # The declared value cannot carry one — a manifest's text is bounded and
        # control characters are refused — but the resolved value comes out of
        # the environment. `http.client` answers a header value containing CR or
        # LF with `ValueError`, which is not a `TransportError`, so it escaped
        # the never-raises health contract and failed the whole registry read.
        transport = transports.HttpTransport(
            base_url="http://127.0.0.1:8770",
            headers={"Authorization": "Bearer ${INJECTED_TOKEN}"},
        )
        with self.assertRaises(transports.TransportError) as refused:
            transport.resolved_headers({"INJECTED_TOKEN": "abc\r\nX-Injected: 1"})
        self.assertEqual("transport_header_refused", refused.exception.code)

    def test_an_unresolved_reference_is_refused_rather_than_sent(self) -> None:
        # Sending `Bearer ${NOT_SET}` authenticates nothing and returns a 401
        # that reads exactly like a wrong password.
        transport = transports.HttpTransport(
            base_url="https://cloud.langfuse.com",
            headers={"Authorization": "Bearer ${NOT_SET}"},
        )
        with self.assertRaises(transports.TransportError) as refused:
            transport.resolved_headers({})
        self.assertEqual("transport_secret_unresolved", refused.exception.code)


class _Opener:
    """Stands in for the urllib opener so a body can be malformed on purpose."""

    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.seen: list[str] = []

    def open(self, request_object, timeout=None):  # noqa: ARG002
        self.seen.append(request_object.full_url)
        return self

    def read(self, size: int) -> bytes:
        return self.payload[:size]

    def __enter__(self):
        return self

    def __exit__(self, *_: object) -> bool:
        return False


class BodyTests(unittest.TestCase):
    def transport(self, **kwargs) -> transports.HttpTransport:
        return transports.HttpTransport(base_url="http://127.0.0.1:6006", **kwargs)

    def test_an_answer_over_the_ceiling_is_refused_by_reading_one_byte_past_it(self) -> None:
        # By reading rather than by trusting Content-Length, which is a number
        # chosen by the party being probed.
        opener = _Opener(b"x" * 500)
        with self.assertRaises(transports.TransportError) as refused:
            self.transport(max_payload_bytes=100).get_json("/v1/projects", opener=opener)
        self.assertEqual("transport_body_too_large", refused.exception.code)

    def test_an_answer_that_is_not_utf8_json_is_named_rather_than_guessed(self) -> None:
        for payload, code in (
            (b"\xff\xfe not utf8", "transport_body_unreadable"),
            (b"<html>nope</html>", "transport_body_unreadable"),
            (b"[1,2,3]", "transport_body_unexpected"),
        ):
            with self.subTest(payload=payload[:12]):
                with self.assertRaises(transports.TransportError) as refused:
                    self.transport().get_json("/v1/x", opener=_Opener(payload))
                self.assertEqual(code, refused.exception.code)

    def test_a_query_reaches_the_address_the_base_declared(self) -> None:
        opener = _Opener(json.dumps({"data": []}).encode("utf-8"))
        self.transport().get_json("/v1/projects", {"limit": "2"}, opener=opener)
        self.assertEqual(["http://127.0.0.1:6006/v1/projects?limit=2"], opener.seen)


class _Redirector(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.send_response(302)
        self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
        self.end_headers()

    def log_message(self, *_: object) -> None:
        return


class RedirectTests(unittest.TestCase):
    """A redirect is an instruction from the party under test."""

    def test_a_redirect_is_refused_rather_than_followed(self) -> None:
        # Following one means the answer describes a host the owner never
        # configured — and the Authorization header goes there too.
        server = http.server.HTTPServer(("127.0.0.1", 0), _Redirector)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        # LIFO: shutdown, then join, then close the listening socket.
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.shutdown)
        transport = transports.HttpTransport(
            base_url=f"http://127.0.0.1:{server.server_address[1]}", timeout_ms=3000
        )
        with self.assertRaises(transports.TransportError) as refused:
            transport.get_json("/anything")
        self.assertEqual("transport_http_error", refused.exception.code)


class CliTransportTests(unittest.TestCase):
    """EXT-004: the same contract over a child process.

    Everything here is about what a process can do that a socket cannot —
    outlive its timeout, read a directory it was not meant to see, inherit a
    credential nobody passed it, or publish a payload in its own argv.
    """

    def program(self, source: str, **kwargs) -> transports.CliTransport:
        return transports.CliTransport(command=(sys.executable, "-c", source), **kwargs)

    def test_the_request_arrives_on_stdin_and_the_answer_on_stdout(self) -> None:
        # And nothing is on the command line: argv is readable by every process
        # on the machine, so a payload there is a payload published.
        echo = self.program(
            "import json,sys;"
            "print(json.dumps({'seen': json.load(sys.stdin), 'argv': sys.argv[1:]}))"
        )
        answer = echo.run_json({"call": "health"})
        self.assertEqual({"call": "health"}, answer["seen"])
        self.assertNotIn("health", json.dumps(answer["argv"]))

    def test_a_program_that_is_not_there_is_named_rather_than_run(self) -> None:
        with self.assertRaises(transports.TransportError) as refused:
            transports.CliTransport(command=("valkama-no-such-program",)).run_json({})
        self.assertEqual("transport_program_missing", refused.exception.code)

    def test_an_empty_argv_is_not_a_command(self) -> None:
        with self.assertRaises(transports.TransportError) as refused:
            transports.CliTransport(command=())
        self.assertEqual("transport_command_refused", refused.exception.code)

    def test_a_child_that_never_answers_is_stopped_rather_than_waited_on(self) -> None:
        # `subprocess`'s own timeout kills the child and leaves its children
        # holding the pipe, which is how a hung adapter becomes a hung server.
        sleeper = self.program("import time;time.sleep(60)", timeout_ms=400)
        with self.assertRaises(transports.TransportError) as refused:
            sleeper.run_json({"call": "health"})
        self.assertEqual("transport_timed_out", refused.exception.code)

    def test_an_answer_over_the_ceiling_is_refused(self) -> None:
        noisy = self.program("print('x' * 5000)", max_payload_bytes=100)
        with self.assertRaises(transports.TransportError) as refused:
            noisy.run_json({})
        self.assertEqual("transport_body_too_large", refused.exception.code)

    def test_an_answer_that_is_not_json_is_named_rather_than_guessed(self) -> None:
        for source, code in (
            ("print('not json')", "transport_body_unreadable"),
            ("print('[1,2]')", "transport_body_unexpected"),
            ("pass", "transport_body_unreadable"),
        ):
            with self.subTest(source=source):
                with self.assertRaises(transports.TransportError) as refused:
                    self.program(source).run_json({})
                self.assertEqual(code, refused.exception.code)

    def test_the_child_gets_what_was_declared_and_not_the_rest(self) -> None:
        # A child that inherited the server's environment would inherit every
        # credential it holds, which is the opposite of passing one by
        # reference.
        program = self.program(
            "import json,os;print(json.dumps({'names': sorted(os.environ)}))",
            environment={"ADAPTER_TOKEN": "${SECRET_FOR_ADAPTER}"},
        )
        answer = program.run_json(
            {},
            environ={
                "SECRET_FOR_ADAPTER": "s3cret",
                "PATH": os.environ["PATH"],
                "SOMETHING_ELSE": "no",
            },
        )
        self.assertIn("ADAPTER_TOKEN", answer["names"])
        self.assertNotIn("SOMETHING_ELSE", answer["names"])
        self.assertNotIn("SECRET_FOR_ADAPTER", answer["names"])

    def test_an_unresolved_reference_is_refused_rather_than_passed(self) -> None:
        program = self.program("pass", environment={"TOKEN": "${NOT_SET_ANYWHERE}"})
        with self.assertRaises(transports.TransportError) as refused:
            program.resolved_environment({})
        self.assertEqual("transport_secret_unresolved", refused.exception.code)

    def test_without_a_declared_directory_the_child_sees_an_empty_one(self) -> None:
        # Inheriting the server's would make an adapter's relative paths
        # resolve inside the Valkama checkout.
        program = self.program("import json,os;print(json.dumps({'here': os.listdir('.')}))")
        self.assertEqual([], program.run_json({})["here"])

    def test_a_declared_directory_that_is_not_one_is_refused(self) -> None:
        with self.assertRaises(transports.TransportError) as refused:
            self.program("pass", cwd=os.path.join(tempfile.gettempdir(), "valkama-absent-dir"))
        self.assertEqual("transport_cwd_missing", refused.exception.code)

    def test_a_declared_directory_is_where_it_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "marker.txt").write_text("here", encoding="utf-8")
            program = self.program(
                "import json,os;print(json.dumps({'here': os.listdir('.')}))", cwd=directory
            )
            self.assertEqual(["marker.txt"], program.run_json({})["here"])


_MCP_SERVER = """
import json, sys
BEHAVIOUR = sys.argv[1] if len(sys.argv) > 1 else "conforming"
for line in sys.stdin:
    if not line.strip():
        continue
    message = json.loads(line)
    identifier, method = message.get("id"), message.get("method")
    params = message.get("params") or {}
    if identifier is None:
        continue
    if method == "initialize":
        if BEHAVIOUR == "silent":
            continue
        result = {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {}}
    elif method == "tools/call":
        name = params.get("name", "")
        if BEHAVIOUR == "text-only":
            result = {"content": [{"type": "text", "text": json.dumps({"status": "ready"})}]}
        elif BEHAVIOUR == "refusing":
            result = {"structuredContent": {"error": "no"}, "isError": True}
        elif BEHAVIOUR == "prose":
            result = {"content": [{"type": "text", "text": "something went wrong"}]}
        else:
            result = {"structuredContent": {"status": "ready", "tool": name}}
    else:
        result = {}
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": identifier, "result": result}) + chr(10))
    sys.stdout.flush()
"""


class McpTransportTests(unittest.TestCase):
    """EXT-003: MCP's own client/server standard, not a private one in its clothes.

    An adapter that already speaks MCP becomes a Valkama adapter by exposing
    tools — `valkama.manifest`, `valkama.health`, and one per capability. There
    is no second protocol to implement, which is what §18.3 asks for.
    """

    def server(self, behaviour: str = "conforming", **kwargs) -> transports.McpTransport:
        return transports.McpTransport(
            command=(sys.executable, "-c", _MCP_SERVER, behaviour), **kwargs
        )

    def test_a_tool_call_carries_the_handshake_with_it(self) -> None:
        # One session per call: §18.3 leaves a tool's lifecycle with the tool,
        # and a long-lived child is exactly the management it says not to take.
        answer = self.server().call_tool("valkama.health", {})
        self.assertEqual("ready", answer["status"])
        self.assertEqual("valkama.health", answer["tool"])

    def test_a_server_that_never_answers_initialize_is_named_as_that(self) -> None:
        with self.assertRaises(transports.TransportError) as refused:
            self.server("silent").call_tool("valkama.health", {})
        self.assertEqual("mcp_no_handshake", refused.exception.code)

    def test_a_text_only_result_is_parsed_rather_than_refused(self) -> None:
        # MCP returns content blocks, and a server without structured output is
        # still a server. The structured half is preferred; the text half is
        # read only when there is no other.
        answer = self.server("text-only").call_tool("valkama.health", {})
        self.assertEqual("ready", answer["status"])

    def test_an_is_error_result_is_a_refusal(self) -> None:
        # The same rule the other two transports follow: the shape of the
        # answer says no. MCP has `isError`, stdio has nothing, HTTP has a
        # status — a refusal only one of them could make is one the
        # conformance tool would miss on the others.
        with self.assertRaises(transports.TransportError) as refused:
            self.server("refusing").call_tool("memory.open", {})
        self.assertEqual("adapter_refused", refused.exception.code)

    def test_prose_where_a_result_belongs_becomes_the_refusal_shape(self) -> None:
        # The transport turns unreadable prose into `{"error": ...}` and the
        # channel raises on it, which is the same two steps every transport
        # takes. Putting the raise in the transport would give MCP a refusal
        # rule of its own, and one rule per transport is how they diverge.
        answer = self.server("prose").call_tool("memory.open", {})
        self.assertIn("something went wrong", answer["error"])
        with self.assertRaises(transports.TransportError) as refused:
            external.McpChannel(self.server("prose")).call(
                "invoke", {"capability_id": "memory.open", "payload": {}}
            )
        self.assertEqual("adapter_refused", refused.exception.code)

    def test_the_bounds_are_the_process_transport_s_and_checked_on_construction(self) -> None:
        with self.assertRaises(transports.TransportError) as refused:
            transports.McpTransport(command=())
        self.assertEqual("transport_command_refused", refused.exception.code)
        with self.assertRaises(transports.TransportError) as refused:
            self.server(timeout_ms=transports.MAX_PROCESS_TIMEOUT_MS + 1)
        self.assertEqual("transport_timeout_refused", refused.exception.code)

    def test_stdout_that_is_not_utf8_is_a_typed_refusal_rather_than_an_escape(self) -> None:
        # A session is built out of these bytes, so they route decisions and the
        # decode stays strict: a replacement character inside a JSON-RPC id is
        # an invented answer. What changed is that the failure is now a
        # `TransportError` — a bare `UnicodeDecodeError` is not one, so it went
        # straight through `health`, which promises never to raise, and took
        # every read that reconstructs the registry with it.
        transport = transports.McpTransport(
            command=(
                sys.executable,
                "-c",
                'import sys; sys.stdout.buffer.write(bytes([255, 254]) + b" not utf8")',
            ),
            timeout_ms=5_000,
        )
        with self.assertRaises(transports.TransportError) as refused:
            transport.call_tool("valkama.health", {})
        self.assertEqual("mcp_stream_unreadable", refused.exception.code)
        provider = external.ExternalProvider(
            manifest_record=_MANIFEST, channel=external.McpChannel(transport)
        )
        state, diagnostics = provider.health()
        self.assertEqual("unavailable", state)
        self.assertEqual("provider_unavailable", (diagnostics or {})["code"])

    def test_a_refused_dispatch_is_a_typed_refusal(self) -> None:
        # One refusal family for every way a call can fail, with a code a
        # caller can tell apart, and a `ValueError` so a surface answers it as
        # a refused request rather than a failure of its own.
        provider = external.ExternalProvider(
            manifest_record=_MANIFEST, channel=external.McpChannel(self.server("refusing"))
        )
        with self.assertRaises(external.ExternalAdapterError) as refused:
            provider.dispatch("memory.open", {"resource_ref": {}})
        self.assertEqual("adapter_refused", refused.exception.code)
        self.assertIsInstance(refused.exception, ValueError)
        # And the case the protocol names outright: a capability the adapter
        # never declared is refused rather than forwarded.
        with self.assertRaises(external.ExternalAdapterError) as undeclared:
            provider.dispatch("execution.launch", {})
        self.assertEqual("capability_not_declared", undeclared.exception.code)

    def test_the_channel_maps_a_capability_to_the_tool_of_the_same_name(self) -> None:
        # That is the whole mapping, and it lets a general-purpose MCP server
        # serve Valkama without pretending to be only that: a tool whose name
        # is not a capability id is simply not a capability.
        channel = external.McpChannel(self.server())
        answer = channel.call("invoke", {"capability_id": "memory.open", "payload": {}})
        self.assertEqual("memory.open", answer["tool"])
        self.assertEqual("valkama.manifest", channel.call("manifest")["tool"])


if __name__ == "__main__":
    unittest.main()
