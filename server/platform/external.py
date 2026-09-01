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
from urllib.parse import urlparse

from .adapters import ProviderError
from .contracts import HEALTH_STATES, validate_adapter_manifest
from .transports import (
    MCP_HEALTH_TOOL,
    MCP_MANIFEST_TOOL,
    CliTransport,
    HttpTransport,
    McpTransport,
    TransportError,
    is_loopback,
)

MANIFEST_PATH = "/valkama/v1/manifest"
HEALTH_PATH = "/valkama/v1/health"
INVOKE_PATH = "/valkama/v1/invoke"


def _host_of(url: str) -> str:
    return urlparse(url).hostname or ""


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


class ExternalAdapterError(ProviderError):
    """An adapter answered, and the answer was not usable.

    A `ProviderError` because that is the refusal family the Provider protocol
    names, and an external adapter is a provider. Derived from `Exception` it
    was outside every handler written for a provider refusal, so a dispatched
    external no — including the undeclared-capability case the protocol calls
    out by name — reached the surface as a generic failure rather than as the
    typed refusal a built-in produces for the identical situation.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message[:512]

    def diagnostic(self) -> dict:
        return {"code": self.code, "message": self.message}


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

    @property
    def label(self) -> str:
        return "loopback-http" if is_loopback(_host_of(self.transport.base_url)) else "remote-https"

    @property
    def where(self) -> str:
        return self.transport.base_url

    @property
    def probe_ceiling_ms(self) -> int:
        return self.transport.timeout_ms

    def call(self, name: str, body: dict | None = None) -> dict:
        if name == "invoke":
            return _refusal(self.transport.post_json(INVOKE_PATH, body or {}))
        return _refusal(self.transport.get_json(HEALTH_PATH if name == "health" else MANIFEST_PATH))


@dataclass(frozen=True)
class CliChannel:
    """The three calls as a field on stdin."""

    transport: CliTransport

    @property
    def label(self) -> str:
        return "local-process"

    @property
    def where(self) -> str:
        return " ".join(self.transport.command)

    @property
    def probe_ceiling_ms(self) -> int:
        return self.transport.timeout_ms

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

    @property
    def label(self) -> str:
        return "local-process"

    @property
    def where(self) -> str:
        return " ".join(self.transport.command)

    @property
    def probe_ceiling_ms(self) -> int:
        return self.transport.timeout_ms

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
    """An adapter reached over a channel, satisfying the same contract as a built-in.

    One provider for both transports rather than one each. The difference
    between a path and a stdin field is three lines in a channel; duplicating
    identity, health and dispatch around it would be two implementations of the
    same contract, which is how they drift.

    It holds a validated manifest rather than re-deriving identity from the
    wire on every call: an adapter that could change its own `adapter_id`
    between calls would break every ref pointing at it, and the ref outliving
    the implementation is the reason `adapter_lineage_id` exists.
    """

    manifest_record: dict
    channel: CliChannel | HttpChannel | McpChannel
    connection_id: str = "default"

    @property
    def adapter_id(self) -> str:
        return str(self.manifest_record["adapter_id"])

    @property
    def adapter_lineage_id(self) -> str:
        return str(self.manifest_record.get("adapter_lineage_id") or self.adapter_id)

    @property
    def capabilities(self) -> tuple[str, ...]:
        return tuple(self.manifest_record["capabilities"])

    @property
    def transport(self) -> str:
        """The display label the Connections list reads, not the destination.

        The second thing the Kernel asked of this provider that the extracted
        contract had not named — found the same way as the first, by being the
        first provider written from outside the two built-in families.

        `remote-https` is a new value in that vocabulary and it is the honest
        one: the four that existed were all local, and calling an adapter on
        another host `loopback-http` because the enum had no other slot is the
        kind of label that reads as fact.
        """

        return self.channel.label

    @property
    def probe_ceiling_ms(self) -> int:
        """What one health call can cost, taken from the channel that enforces it.

        The channel's transport holds the timeout it actually applies — a socket
        deadline, or a process one that stops the whole tree — so this is the
        Kernel's honest ceiling for this adapter rather than a number the
        adapter's own manifest offered about itself.
        """

        return self.channel.probe_ceiling_ms

    @property
    def core_ref_kinds(self) -> tuple[str, ...]:
        """None, and not by omission.

        Claiming a core ref kind binds every ref of that kind to this provider,
        and the Kernel refuses two claimants — so a manifest that could claim
        one would displace whatever the owner already had, at install time,
        without the owner deciding. That is an owner action, not a declaration.
        """

        return ()

    @property
    def service_ref(self) -> dict:
        return {
            "owner_id": str(self.manifest_record["configuration_owner"]),
            "service_id": self.adapter_id,
        }

    @property
    def connection_ref(self) -> dict:
        return {
            "service_ref": self.service_ref,
            "adapter_lineage_id": self.adapter_lineage_id,
            "connection_id": self.connection_id,
        }

    def manifest(self) -> dict:
        return dict(self.manifest_record)

    def package_descriptor(self) -> dict:
        return {
            "package_id": str(self.manifest_record["package_id"]),
            "publisher_id": str(self.manifest_record["publisher_id"]),
            "version": str(self.manifest_record["version"]),
            "execution": str(self.manifest_record["execution"]),
            # Never `platform-built-in`: this arrived from somewhere, and the
            # provenance is the only field that says so after installation.
            "provenance": "external-endpoint",
        }

    def service_descriptor(self) -> dict:
        return {
            "service_ref": self.service_ref,
            "service_type": str(self.manifest_record["supported_service_types"][0]),
            "title_key": str(self.manifest_record["title_key"]),
            "configuration_owner": str(self.manifest_record["configuration_owner"]),
            "trust_owner": str(self.manifest_record["trust_owner"]),
            "discovery_provenance": "external-endpoint",
            "state": "registered",
            "direct_read": False,
        }

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

    def connection(self, scope: dict | None = None, *, observe: bool = True) -> dict:
        state, diagnostics = self.health() if observe else ("not-observed", None)
        record = {
            "connection_ref": self.connection_ref,
            "applicability": scope or {"kind": "global"},
            "configuration_owner": str(self.manifest_record["configuration_owner"]),
            "trust_owner": str(self.manifest_record["trust_owner"]),
            # Reaching an adapter is not trusting it. Only the owner lifecycle
            # promotes this, which is the same rule the built-ins follow.
            "trust": "unknown",
            "health": state,
            "state": "registered",
        }
        if diagnostics is not None:
            record["diagnostics"] = diagnostics
        return record

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
        # The provider and connection are stamped here rather than trusted from
        # the answer: an adapter naming a different connection would attribute
        # its result to somebody else's.
        return {
            **answer,
            "provider": self.adapter_id,
            "connection_ref": self.connection_ref,
        }


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
