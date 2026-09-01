"""EXT-002 and EXT-004: the two ways an external adapter is reached.

Half of this already existed. `AgentMemoryReferenceProvider.health` has always
made a bounded loopback call — a hard timeout, a byte ceiling, strict UTF-8, a
type check on the body, and a typed diagnostic for every way it can fail — and
that shape is right. What it could not do is be pointed anywhere: the URL was a
class constant, so the one adapter that speaks HTTP was the one adapter nobody
could configure.

So this is that call with the address taken out of the code, plus the four
things §18.2 asks for that a hardcoded loopback URL never had to answer.

**Where it may go.** Plaintext HTTP reaches loopback and nothing else. A remote
host must be `https`. This is not a preference: an adapter carries a credential
by reference, and sending one in the clear to a host on the network is a defect
the owner cannot see. Loopback is exempt because the packet does not leave the
machine, and refusing it would mean every locally-run tool — Phoenix on 6006,
Jaeger on 16686 — needed a certificate to be usable.

**Where it may not go.** A redirect is not followed. `urllib` follows by
default, and a redirect is an instruction from the very party being probed:
letting a health check be redirected to another host means the answer describes
somewhere the owner never configured, and an `Authorization` header would go
with it.

**What it carries.** A credential is a reference resolved at call time through
the same OPS-002 mechanism the configuration file uses, so a token lives in the
environment and never in a manifest. An unresolved reference is refused rather
than sent, because a header reading `Bearer ${LANGFUSE_SECRET}` authenticates
nothing and produces a 401 that looks like a wrong password.

**How much it will read.** A ceiling in bytes, checked by reading one byte past
it rather than trusting `Content-Length`, which the other side controls.

Nothing here knows what an adapter *is*. It moves bounded JSON to a checked
address and names its failures; `providers.py` decides what that means.

`CliTransport` is the same contract over a child process, and the differences
are all about what a process can do that a socket cannot.

**Nothing on the command line.** The request goes on stdin and the answer comes
back on stdout. An argv is readable by every process on the machine, so a
payload there is a payload published and a token there is a token published.

**Nowhere by default.** A child inherits the server's working directory unless
told otherwise, which would make an adapter's relative paths resolve inside the
Valkama checkout. Without a declared directory it runs in an empty temporary one
that is removed afterwards, so an adapter that needs files has to say where.

**No shell, ever.** `shell=False` and an argv array, so nothing in a manifest is
ever parsed as a command line.

**The whole tree.** A timeout terminates the child *and* its children through
`processes.stop_process_tree`; `subprocess`'s own timeout leaves grandchildren
running with the pipe open, which is how a hung adapter becomes a hung server.
"""

from __future__ import annotations

import contextlib
import ipaddress
import json
import os
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from urllib import error, parse, request

from .. import processes
from ..ops import configuration

#: Hard ceilings the caller may lower but not raise. A manifest is written by
#: the thing being probed, so a timeout or a body size it declares is a number
#: chosen by the other party; these are the numbers chosen by this one.
MAX_TIMEOUT_MS = 10_000
MAX_PAYLOAD_BYTES = 1_048_576

#: The only schemes an adapter may be reached over. `file` and `ftp` are what
#: `urllib` would otherwise accept from a manifest, and neither is a service.
SCHEMES = ("http", "https")

#: A child process gets longer than a socket does. Starting an interpreter is
#: most of what a small adapter spends, and a health check that timed out on
#: Python's own start-up would report the adapter down for being written in it.
MAX_PROCESS_TIMEOUT_MS = 60_000


class TransportError(Exception):
    """A call that did not produce a usable answer, with a code to report.

    Carries a code rather than only a sentence because the caller turns it into
    a provider diagnostic, and `{"code": ..., "message": ...}` is the shape the
    health contract already speaks.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:512]

    def diagnostic(self) -> dict:
        return {"code": self.code, "message": self.message}


class _NoRedirect(request.HTTPRedirectHandler):
    """Refuse every redirect rather than follow one.

    The party issuing it is the party under test. See the module docstring.
    """

    # urllib fixes this signature; every argument is required and none is
    # used, because the answer is always the same refusal.
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ARG002
        return None


def is_loopback(host: str) -> bool:
    """Whether a host names this machine, by address rather than by spelling.

    `localhost` is accepted by name because it is the spelling every local tool
    prints; everything else has to parse as a loopback address, so a hostname
    that merely begins with `127.` or contains `localhost` does not qualify.
    """

    if host in ("localhost", ""):
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def _checked_header(name: str, value: str) -> str:
    """One resolved header, or a refusal — a line break here is not a header.

    The declared value cannot carry one: a manifest's text is bounded and
    control characters are refused. The *resolved* value can, because it comes
    out of the environment, and `http.client` answers a header value containing
    CR or LF with `ValueError` — which is not a `TransportError`, so it escaped
    the health contract entirely and took a whole registry read with it.
    Refusing it here makes it what it is: an adapter this call cannot be made
    to, reported as one.
    """

    for text, where in ((name, "name"), (value, "value")):
        if any(character in text for character in "\r\n\x00"):
            raise TransportError(
                "transport_header_refused",
                f"the resolved {name} header {where} carries a line break",
            )
    return value


def check_url(url: str) -> parse.ParseResult:
    """The address policy, as a function so the conformance tool can reuse it."""

    parsed = parse.urlparse(url)
    if parsed.scheme not in SCHEMES:
        raise TransportError("transport_scheme_refused", f"{parsed.scheme or 'no'} is not http(s)")
    if not parsed.hostname:
        raise TransportError("transport_host_missing", "the address names no host")
    if parsed.scheme == "http" and not is_loopback(parsed.hostname):
        raise TransportError(
            "transport_insecure_remote",
            f"plaintext http reaches loopback only; {parsed.hostname} needs https",
        )
    return parsed


@dataclass(frozen=True)
class HttpTransport:
    """One configured address, and the bounds every call to it obeys."""

    base_url: str
    timeout_ms: int = 2_000
    max_payload_bytes: int = 131_072
    #: `{"Authorization": "Bearer ${PHOENIX_TOKEN}"}` — values are references
    #: resolved per call, never stored resolved.
    headers: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        check_url(self.base_url)
        if not 1 <= self.timeout_ms <= MAX_TIMEOUT_MS:
            raise TransportError(
                "transport_timeout_refused", f"timeout must be 1..{MAX_TIMEOUT_MS} ms"
            )
        if not 1 <= self.max_payload_bytes <= MAX_PAYLOAD_BYTES:
            raise TransportError(
                "transport_bound_refused", f"payload bound must be 1..{MAX_PAYLOAD_BYTES} bytes"
            )

    def resolved_headers(self, environ: dict[str, str] | None = None) -> dict[str, str]:
        """Headers with their references expanded, or a refusal naming the gap."""

        resolved = {}
        for name, value in self.headers.items():
            answer = configuration.resolve_reference(value, environ)
            if not answer["resolved"]:
                raise TransportError(
                    "transport_secret_unresolved",
                    f"{name} references {answer['reason'] or 'a value that is not set'}",
                )
            resolved[name] = _checked_header(name, answer["value"])
        return resolved

    def url_for(self, path: str, query: dict[str, str] | None = None) -> str:
        """An address under the configured base, and never above it.

        Joined by concatenation rather than `urljoin`, because `urljoin` treats
        a leading slash as "from the root of the host" and a manifest that
        supplied `/../` would reach a sibling service on the same port.
        """

        if ".." in path:
            raise TransportError("transport_path_refused", "a path may not traverse upward")
        joined = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        if query:
            joined = f"{joined}?{parse.urlencode(query)}"
        check_url(joined)
        return joined

    def get_json(self, path: str, query: dict[str, str] | None = None, **kwargs) -> dict:
        return self._call("GET", path, query=query, **kwargs)

    def post_json(self, path: str, body: dict, **kwargs) -> dict:
        return self._call("POST", path, body=body, **kwargs)

    def _call(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, str] | None = None,
        body: dict | None = None,
        environ: dict[str, str] | None = None,
        opener=None,
    ) -> dict:
        url = self.url_for(path, query)
        headers = {"Accept": "application/json", **self.resolved_headers(environ)}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        probe = request.Request(url, data=data, headers=headers, method=method)  # noqa: S310
        # The address is configured rather than literal, which is the whole
        # point of the module, so the scheme audit cannot be satisfied by
        # inspection. It is satisfied by `check_url` instead: the scheme is an
        # allowlist of two, plaintext is refused off loopback, and redirects
        # are refused, so nothing here can be steered to `file:` or elsewhere.
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        build = opener or request.build_opener(_NoRedirect)
        try:
            with build.open(probe, timeout=self.timeout_ms / 1000) as response:
                raw = response.read(self.max_payload_bytes + 1)
        except error.HTTPError as failure:
            # `HTTPError` is also the response, so it holds the socket. Left
            # unclosed it leaks one connection per refused call, and a health
            # sweep against a down adapter is exactly a stream of those.
            failure.close()
            raise TransportError(
                "transport_http_error", f"{failure.code} from the adapter"
            ) from failure
        except (error.URLError, TimeoutError, OSError) as failure:
            raise TransportError("transport_unreachable", "the adapter did not answer") from failure
        if len(raw) > self.max_payload_bytes:
            raise TransportError(
                "transport_body_too_large",
                f"the answer exceeded {self.max_payload_bytes} bytes",
            )
        try:
            payload = json.loads(raw.decode("utf-8", errors="strict"))
        except (UnicodeError, json.JSONDecodeError) as failure:
            raise TransportError(
                "transport_body_unreadable", "the answer was not UTF-8 JSON"
            ) from failure
        if not isinstance(payload, dict):
            raise TransportError("transport_body_unexpected", "the answer was not an object")
        return payload


@dataclass(frozen=True)
class CliTransport:
    """One configured program, and the bounds every call to it obeys.

    Same three calls as the HTTP side and the same JSON shapes; only the pipe
    differs. The request is written to stdin and the answer read from stdout,
    because argv is readable by every process on the machine.
    """

    command: tuple[str, ...]
    #: Where the child runs. Empty means an empty temporary directory made for
    #: the call and removed after — never the server's own, whose relative
    #: paths lead into the checkout.
    cwd: str = ""
    timeout_ms: int = 5_000
    max_payload_bytes: int = 131_072
    #: `{"TOKEN": "${ADAPTER_TOKEN}"}` — references resolved per call. The child
    #: gets these and nothing else of the server's environment beyond what a
    #: process needs to start.
    environment: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.command or not all(isinstance(item, str) and item for item in self.command):
            raise TransportError("transport_command_refused", "a command is a non-empty argv")
        if not 1 <= self.timeout_ms <= MAX_PROCESS_TIMEOUT_MS:
            raise TransportError(
                "transport_timeout_refused", f"timeout must be 1..{MAX_PROCESS_TIMEOUT_MS} ms"
            )
        if not 1 <= self.max_payload_bytes <= MAX_PAYLOAD_BYTES:
            raise TransportError(
                "transport_bound_refused", f"payload bound must be 1..{MAX_PAYLOAD_BYTES} bytes"
            )
        if self.cwd and not os.path.isdir(self.cwd):
            raise TransportError("transport_cwd_missing", f"{self.cwd} is not a directory")

    def executable(self) -> str:
        """The program, resolved once so a refusal names the program and not the call."""

        first = self.command[0]
        located = first if os.path.isabs(first) else shutil.which(first)
        if not located or not os.path.isfile(located):
            raise TransportError("transport_program_missing", f"{first} is not on PATH")
        return located

    def resolved_environment(self, environ: dict[str, str] | None = None) -> dict[str, str]:
        """The child's environment: what a process needs, plus what was declared.

        Not the server's whole environment. A child that inherited it would
        inherit every credential the server holds, which is the opposite of
        passing one credential by reference.
        """

        source = os.environ if environ is None else environ
        inherited = {
            name: source[name]
            for name in ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG")
            if name in source
        }
        for name, value in self.environment.items():
            answer = configuration.resolve_reference(value, environ)
            if not answer["resolved"]:
                raise TransportError(
                    "transport_secret_unresolved",
                    f"{name} references {answer['reason'] or 'a value that is not set'}",
                )
            inherited[name] = answer["value"]
        return inherited

    def run_json(self, body: dict, *, environ: dict[str, str] | None = None) -> dict:
        """One JSON request in, one bounded JSON object out."""

        raw = self.exchange_bytes(json.dumps(body).encode("utf-8"), environ=environ)
        try:
            payload = json.loads(raw.decode("utf-8", errors="strict"))
        except (UnicodeError, json.JSONDecodeError) as failure:
            raise TransportError(
                "transport_body_unreadable", "the answer was not UTF-8 JSON"
            ) from failure
        if not isinstance(payload, dict):
            raise TransportError("transport_body_unexpected", "the answer was not an object")
        return payload

    def exchange_bytes(
        self, request_bytes: bytes, *, environ: dict[str, str] | None = None
    ) -> bytes:
        """Write one request, read one bounded answer, and never leave a tree behind.

        Bytes rather than JSON, because the MCP bridge writes several
        line-delimited messages and reads several back. Everything a child
        process needs bounding is bounded here and once.
        """

        located = self.executable()
        environment = self.resolved_environment(environ)
        directory = self.cwd or tempfile.mkdtemp(prefix="valkama-adapter-")
        try:
            return self._exchange(located, environment, request_bytes, directory)
        finally:
            if not self.cwd:
                shutil.rmtree(directory, ignore_errors=True)

    def _exchange(
        self, located: str, environment: dict[str, str], request_bytes: bytes, directory: str
    ) -> bytes:
        try:
            child = subprocess.Popen(
                [located, *self.command[1:]],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                cwd=directory,
                env=environment,
                shell=False,
            )
        except OSError as failure:
            raise TransportError("transport_unreachable", "the adapter did not start") from failure
        raw = self._read_bounded(child, request_bytes)
        if len(raw) > self.max_payload_bytes:
            raise TransportError(
                "transport_body_too_large", f"the answer exceeded {self.max_payload_bytes} bytes"
            )
        return raw

    def _read_bounded(self, child: subprocess.Popen, request_bytes: bytes) -> bytes:
        """Read at most the ceiling plus one byte, and stop the tree on a timeout.

        A thread rather than `communicate(timeout=...)`, for two reasons that
        are the same reason: `communicate` reads everything an adapter cares to
        emit, and its timeout kills the child while its children keep the pipe
        open. Neither is a bound.
        """

        chunks: list[bytes] = []

        def read() -> None:
            with contextlib.suppress(OSError, ValueError):
                if child.stdin is not None:
                    child.stdin.write(request_bytes)
                    child.stdin.close()
                remaining = self.max_payload_bytes + 1
                while remaining > 0 and child.stdout is not None:
                    block = child.stdout.read(remaining)
                    if not block:
                        break
                    chunks.append(block)
                    remaining -= len(block)

        worker = threading.Thread(target=read, daemon=True)
        worker.start()
        worker.join(self.timeout_ms / 1000)
        # The overrun is the *reader* still waiting. `child.poll()` is still
        # None the instant after a child writes and exits, because nothing has
        # reaped it yet, and treating that as a timeout reported every healthy
        # adapter as hung.
        overran = worker.is_alive()
        if overran or child.poll() is None:
            # A child that is still running once its answer is complete gets
            # stopped either way: it wrote and stayed, or it filled the pipe
            # past the ceiling and is blocked on a write nobody will read.
            processes.stop_process_tree(child)
            worker.join(1)
        with contextlib.suppress(OSError):
            if child.stdout is not None:
                child.stdout.close()
        if overran:
            # Raised on the fact of the overrun, not on whether the reader then
            # finished. Killing the tree closes the pipe, so the reader always
            # returns a moment later — and reporting what it collected made a
            # hung adapter read as `the answer was not UTF-8 JSON`, which sends
            # somebody to look at the wrong thing entirely.
            raise TransportError(
                "transport_timed_out", f"the adapter did not answer in {self.timeout_ms} ms"
            )
        return b"".join(chunks)


#: The handshake version this client opens with. A legacy one on purpose: every
#: server that speaks MCP at all answers it, and the modern era adds nothing a
#: three-call bridge uses. Opening with a version a server has never heard of
#: would make "not an adapter" and "newer than me" the same refusal.
MCP_PROTOCOL = "2025-06-18"

#: The three calls, as the tool names an MCP adapter exposes. Using tools is
#: what makes this MCP rather than a private protocol wearing MCP's clothes:
#: §18.3 asks for the existing client/server standard, and a tool is how a
#: server offers anything.
MCP_MANIFEST_TOOL = "valkama.manifest"
MCP_HEALTH_TOOL = "valkama.health"


@dataclass(frozen=True)
class McpTransport:
    """An MCP server over stdio, asked three questions and let go.

    One session per call, and that is a decision rather than an oversight.
    §18.3 leaves a tool's lifecycle with the tool unless the owner asked
    Valkama to manage it, and a long-lived child is exactly that management: it
    has to be started, watched, restarted and stopped, and every one of those
    is a thing to get wrong on a path whose job is to answer whether something
    is reachable. A handshake per call costs an interpreter start and buys the
    property that nothing here owns a process between calls.

    The framing is JSON-RPC over line-delimited stdio, which is what MCP's
    stdio transport is. Reading is bounded the same way the plain CLI transport
    bounds it, because an adapter is not trusted for being an MCP server.
    """

    command: tuple[str, ...]
    cwd: str = ""
    timeout_ms: int = 15_000
    max_payload_bytes: int = 131_072
    environment: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Constructing it is the validation: the bounds and the argv rules are
        # `CliTransport`'s, and duplicating them here is how two copies drift.
        self._process()

    def _process(self) -> CliTransport:
        return CliTransport(
            command=self.command,
            cwd=self.cwd,
            timeout_ms=self.timeout_ms,
            max_payload_bytes=self.max_payload_bytes,
            environment=self.environment,
        )

    def call_tool(self, name: str, arguments: dict, *, environ=None) -> dict:
        """Handshake, call one tool, and read what it returned."""

        answers = self._session(
            [
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": MCP_PROTOCOL,
                        "capabilities": {},
                        "clientInfo": {"name": "valkama", "version": "1.0.0"},
                    },
                },
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                {
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": arguments},
                },
            ],
            environ=environ,
        )
        if 1 not in answers:
            raise TransportError("mcp_no_handshake", "the server did not answer initialize")
        if 2 not in answers:
            raise TransportError("mcp_no_answer", f"the server did not answer {name}")
        return _mcp_result(answers[2], name)

    def _session(self, messages: list[dict], *, environ=None) -> dict[int, dict]:
        """Write the whole exchange, read every answer, and keep nothing open."""

        request = "".join(json.dumps(message) + "\n" for message in messages).encode("utf-8")
        raw = self._process().exchange_bytes(request, environ=environ)
        try:
            # Strict, and named as a refusal rather than salvaged. These bytes
            # route decisions — every answer the session is built from is read
            # out of them — so the lenient decode this repository allows for
            # diagnostics a human reads is exactly wrong here: a replacement
            # character inside a JSON-RPC id or a tool result is a made-up
            # answer. `run_json` already refuses the same way; before this the
            # bare `decode` raised `UnicodeDecodeError`, which is not a
            # `TransportError`, so one adapter writing rubbish to stdout failed
            # every read that reconstructs the registry.
            decoded = raw.decode("utf-8", errors="strict")
        except UnicodeError as failure:
            raise TransportError(
                "mcp_stream_unreadable", "the server's stdout was not UTF-8"
            ) from failure
        answers: dict[int, dict] = {}
        for line in decoded.splitlines():
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                # A server may write anything to stdout before it behaves. A
                # line that is not JSON-RPC is not an answer, and refusing the
                # whole session over it would make a chatty server unusable.
                continue
            if isinstance(message, dict) and isinstance(message.get("id"), int):
                answers[message["id"]] = message
        return answers


def _mcp_result(message: dict, name: str) -> dict:
    """One `tools/call` answer, as the adapter protocol's JSON object.

    MCP returns content blocks rather than a typed body, so the structured half
    is preferred and the text half is parsed only when there is no other. An
    `isError` result becomes a refusal, which is the same rule the other two
    transports follow: the shape of the answer says no, not a status line.
    """

    if "error" in message:
        raise TransportError("mcp_error", str(message["error"])[:300])
    result = message.get("result")
    if not isinstance(result, dict):
        raise TransportError("mcp_result_unreadable", f"{name} returned no result object")
    payload = result.get("structuredContent")
    if not isinstance(payload, dict):
        text = ""
        for block in result.get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text":
                text = str(block.get("text") or "")
                break
        try:
            payload = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            payload = {"error": text or f"{name} returned nothing readable"}
    if not isinstance(payload, dict):
        raise TransportError("mcp_result_unexpected", f"{name} did not return an object")
    if result.get("isError"):
        raise TransportError("adapter_refused", str(payload.get("error") or payload)[:300])
    return payload


__all__ = [
    "MAX_PAYLOAD_BYTES",
    "MAX_PROCESS_TIMEOUT_MS",
    "MAX_TIMEOUT_MS",
    "MCP_HEALTH_TOOL",
    "MCP_MANIFEST_TOOL",
    "MCP_PROTOCOL",
    "SCHEMES",
    "CliTransport",
    "HttpTransport",
    "McpTransport",
    "TransportError",
    "check_url",
    "is_loopback",
]
