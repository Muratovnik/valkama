"""The wire an external adapter answers on, and the provider that speaks it.

Two things are easy to conflate here and the whole layer depends on keeping
them apart.

A **backend** is somebody else's product with somebody else's API — Phoenix,
Langfuse, Jaeger. Valkama reaches one through a provider written on this side
that knows that product's shape. Nothing about a backend conforms to anything
here, and asking it to would be asking Phoenix to become a Valkama plugin.

An **adapter** is a service written to be reached by Valkama. It answers the
three calls below, and `valkama adapter check` is the tool that says whether it
does. This module is that half.

The paths are fixed rather than declared in the manifest. A declared path is one
more thing that can disagree with the implementation, and the failure it
produces — probing the wrong URL and reading the answer as "down" — is
indistinguishable from the service being down. Namespacing them under
`/valkama/v1/` keeps the adapter free to serve anything else it likes on the
same host and port.

```text
GET  {base}/valkama/v1/manifest   the adapter's own manifest, for §18.4 discovery
GET  {base}/valkama/v1/health     {"status": ..., "diagnostics": {...}?}
POST {base}/valkama/v1/invoke     {"capability_id": ..., "payload": {...}}
```

A CLI adapter answers the same three, on stdin and stdout, distinguished by a
`call` field rather than a path:

```text
{"call": "manifest"}
{"call": "health"}
{"call": "invoke", "capability_id": ..., "payload": {...}}
```

The channel classes below are where that difference lives, and they live here
rather than in `transports` because a path name and a field name are the
protocol. A transport moves bounded JSON to a checked destination and is
deliberately ignorant of what any of it means.

An adapter is trusted for none of this. Its manifest is validated before it is
believed, its health answer has to name a state this product knows, and the
capability it was asked for is checked against what it declared rather than
against what it returns — an adapter answering a capability it never declared
is the fictional universality §15.4 forbids, arriving over a socket.
"""

from __future__ import annotations

from dataclasses import dataclass

from .adapter_contract import HEALTH_STATES, validate_adapter_manifest
from .transports import (
    MCP_HEALTH_TOOL,
    MCP_MANIFEST_TOOL,
    CliTransport,
    HttpTransport,
    McpTransport,
    TransportError,
)

MANIFEST_PATH = "/valkama/v1/manifest"
HEALTH_PATH = "/valkama/v1/health"
INVOKE_PATH = "/valkama/v1/invoke"


def _refusal(answer: dict) -> dict:
    """An answer carrying `error` is a refusal, on either transport.

    HTTP has a status line and stdin/stdout has nothing, so a refusal that
    relied on the status would be a refusal only one transport could make —
    and the conformance tool would pass a CLI adapter for accepting everything,
    which is exactly what it did before this rule existed.

    So the shape is the contract: `{"error": "..."}` is a no, whatever carried
    it. The HTTP side still fails on a 4xx as well, because a status *and* a
    body is more information than a body alone.
    """

    if isinstance(answer.get("error"), str):
        raise TransportError("adapter_refused", answer["error"])
    return answer


class ExternalAdapterError(ValueError):
    """An adapter answered, and the answer was not usable -- or it refused.

    One refusal family for every way an adapter call can fail, carrying a code
    as well as a sentence, because the conformance tool and the CLI have to
    tell one failure from another.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:512]


def fetch_manifest(channel: CliChannel | HttpChannel | McpChannel) -> dict:
    """An adapter's own manifest, validated before it is believed.

    §18.4 allows discovery from the adapter itself, and this is that. What
    arrives is a document written by the thing being installed, so it goes
    through the same validator a first-party manifest does and gains nothing
    for having been fetched.
    """

    try:
        raw = channel.call("manifest")
    except TransportError as failure:
        raise ExternalAdapterError(failure.code, failure.message) from failure
    try:
        return validate_adapter_manifest(raw)
    # Every way a contract can refuse is one answer here: the manifest was
    # not believable, and which field it was belongs in the message.
    except Exception as failure:
        raise ExternalAdapterError(
            "adapter_manifest_invalid", f"the adapter's manifest was refused: {failure}"
        ) from failure


@dataclass(frozen=True)
class HttpChannel:
    """The three calls as paths."""

    transport: HttpTransport

    def call(self, name: str, body: dict | None = None) -> dict:
        if name == "invoke":
            return _refusal(self.transport.post_json(INVOKE_PATH, body or {}))
        return _refusal(self.transport.get_json(HEALTH_PATH if name == "health" else MANIFEST_PATH))


@dataclass(frozen=True)
class CliChannel:
    """The three calls as a field on stdin."""

    transport: CliTransport

    def call(self, name: str, body: dict | None = None) -> dict:
        return _refusal(self.transport.run_json({"call": name, **(body or {})}))


@dataclass(frozen=True)
class McpChannel:
    """The three calls as tools on a server that already speaks MCP.

    §18.3 asks for the existing client/server standard rather than a private
    subprocess protocol wearing its clothes, and a tool is how an MCP server
    offers anything at all. So an adapter that is already an MCP server becomes
    a Valkama adapter by exposing `valkama.manifest`, `valkama.health`, and one
    tool per capability it declares — nothing here is outside MCP.

    A capability is invoked as the tool of the same name. That is the whole
    mapping, and it means a general-purpose MCP server can serve Valkama
    without pretending to be only that: tools whose names are not Valkama
    capability ids are simply not capabilities.
    """

    transport: McpTransport

    def call(self, name: str, body: dict | None = None) -> dict:
        if name == "invoke":
            payload = body or {}
            return _refusal(
                self.transport.call_tool(
                    str(payload.get("capability_id") or ""), dict(payload.get("payload") or {})
                )
            )
        tool = MCP_HEALTH_TOOL if name == "health" else MCP_MANIFEST_TOOL
        return _refusal(self.transport.call_tool(tool, {}))


@dataclass(frozen=True)
class ExternalProvider:
    """An adapter reached over a channel: its manifest, its health, one call.

    One provider for every transport rather than one each. The difference
    between a path, a stdin field and a tool name is three lines in a channel;
    duplicating identity, health and dispatch around it would be several
    implementations of the same contract, which is how they drift.

    It holds a validated manifest rather than re-reading identity from the wire
    on every call: an adapter that could change its own `adapter_id` between
    calls would attribute its answers to somebody else.
    """

    manifest_record: dict
    channel: CliChannel | HttpChannel | McpChannel

    @property
    def adapter_id(self) -> str:
        return str(self.manifest_record["adapter_id"])

    @property
    def capabilities(self) -> tuple[str, ...]:
        return tuple(self.manifest_record["capabilities"])

    def health(self) -> tuple[str, dict | None]:
        """Never raises, and never takes the adapter's word for the state name."""

        try:
            answer = self.channel.call("health")
        except TransportError as failure:
            return "unavailable", {
                "code": "provider_unavailable",
                "message": failure.message,
            }
        state = str(answer.get("status") or "")
        if state not in HEALTH_STATES:
            return "degraded", {
                "code": "adapter_health_unreadable",
                "message": f"the adapter reported {state!r}, which is not a health state",
            }
        diagnostics = answer.get("diagnostics")
        if state == "ready":
            return "ready", None
        return state, diagnostics if isinstance(diagnostics, dict) else None

    def dispatch(self, capability_id: str, payload: dict) -> dict:
        """Ask for one capability the adapter declared, and check what comes back."""

        if capability_id not in self.capabilities or not isinstance(payload, dict):
            raise ExternalAdapterError(
                "capability_not_declared",
                f"{self.adapter_id} does not declare {capability_id}",
            )
        try:
            answer = self.channel.call(
                "invoke", {"capability_id": capability_id, "payload": payload}
            )
        except TransportError as failure:
            raise ExternalAdapterError(failure.code, failure.message) from failure
        if not isinstance(answer.get("result_type"), str) or not answer["result_type"]:
            raise ExternalAdapterError(
                "adapter_result_untyped", "the answer carried no result_type"
            )
        # The provider is stamped here rather than trusted from the answer: an
        # adapter naming another would attribute its result to somebody else.
        return {**answer, "provider": self.adapter_id}


__all__ = [
    "HEALTH_PATH",
    "INVOKE_PATH",
    "MANIFEST_PATH",
    "CliChannel",
    "ExternalAdapterError",
    "ExternalProvider",
    "HttpChannel",
    "McpChannel",
    "fetch_manifest",
]
