"""What an external adapter declares about itself, and where it is reached.

Two documents, kept apart for a reason the CLI transport made unavoidable.

The **manifest** is the adapter's own declaration: the contract it speaks, its
identity, its version and the capabilities it answers. It may be fetched from
the adapter itself (`valkama adapter check --at ...`), so it is a document
written by the thing being checked and is believed only after it passes here.
Four fields, every one required, nothing else accepted: a manifest that carries
a field this contract does not name is refused rather than half-read, because a
field nobody checks is a field an adapter can use to say something nobody
reviewed.

The **transport** is the owner's statement of where the adapter is: a base URL,
or the argv of a process speaking the CLI or MCP protocol. It never comes from
the adapter, never travels with the manifest and is not held to the browser
rule, because it has to hold an absolute interpreter path.

A capability is a dotted lowercase name such as `memory.open`. The set is open:
the adapter says what it answers, and the caller checks a call against that
declaration rather than against a list kept here.
"""

from __future__ import annotations

import re

from ..store_identity.primitives import (
    _SAFE_TEXT,
    ContractError,
    InvalidDiscriminantError,
    MissingFieldError,
    _enum,
    _identifier,
    _list,
    _object,
    _reject_unsafe_tree,
    _semver,
)

ADAPTER_INTERFACE = "valkama-adapter"
#: The states a health answer may name. Anything else is read as `degraded`.
HEALTH_STATES = frozenset({"ready", "not-observed", "degraded", "unavailable"})
#: How an adapter may be reached. `mcp` is the stdio transport: MCP over HTTP is
#: a different destination with a session and a stream, and naming it here would
#: promise something nothing implements.
TRANSPORT_KINDS = frozenset({"http", "cli", "mcp"})

_CAPABILITY_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})+$")


def _capability(value, where):
    if not isinstance(value, str) or not _CAPABILITY_RE.fullmatch(value):
        raise ContractError(f"{where} must be a dotted lowercase capability id")
    return value


def validate_adapter_manifest(value):
    """The manifest, normalized, or the reason it is not one."""

    obj = _object(
        value,
        ("contract_version", "adapter_id", "version", "capabilities"),
        where="adapter_manifest",
    )
    _reject_unsafe_tree(obj, "adapter_manifest")
    if obj["contract_version"] != ADAPTER_INTERFACE:
        raise InvalidDiscriminantError(
            f"adapter_manifest.contract_version must be {ADAPTER_INTERFACE}"
        )
    return {
        "contract_version": ADAPTER_INTERFACE,
        "adapter_id": _identifier(obj["adapter_id"], "adapter_manifest.adapter_id"),
        "version": _semver(obj["version"], "adapter_manifest.version"),
        "capabilities": _list(
            obj["capabilities"], "adapter_manifest.capabilities", item=_capability
        ),
    }


def _local_text(value, where, *, max_length=512):
    """Bounded text that never reaches the browser, so the browser rule is off.

    The bounds stay -- length, no control characters -- because they are about
    the value being a value. Only the path and URI refusal is lifted, and the
    reason it can be is that a transport is never published.
    """

    if not isinstance(value, str) or len(value) > max_length or not _SAFE_TEXT.fullmatch(value):
        raise ContractError(f"{where} must be bounded text")
    return value


def validate_adapter_transport(value):
    """Where an adapter is: the shape only.

    Whether a destination may actually be reached is `transports`' decision and
    stays there: a record is validated long before anyone chooses to call it.
    """

    obj = _object(
        value,
        ("kind",),
        optional=("base_url", "command", "timeout_ms", "max_payload_bytes", "headers"),
        where="adapter_transport",
    )
    kind = _enum(obj["kind"], TRANSPORT_KINDS, "adapter_transport.kind")
    result: dict = {"kind": kind}
    if kind in ("cli", "mcp"):
        if "base_url" in obj:
            raise ContractError(f"a {kind} transport is a process and takes no base_url")
        command = _list(
            obj.get("command"),
            "adapter_transport.command",
            item=lambda item, where: _local_text(item, where, max_length=1024),
            unique=False,
        )
        if not command:
            raise MissingFieldError("adapter_transport.command may not be empty")
        result["command"] = command
    else:
        if "command" in obj:
            raise ContractError("an http transport is an address and takes no command")
        result["base_url"] = _local_text(
            obj.get("base_url"), "adapter_transport.base_url", max_length=2048
        )
    for name, ceiling in (("timeout_ms", 120_000), ("max_payload_bytes", 10_000_000)):
        if obj.get(name) is not None:
            bound = obj[name]
            if not isinstance(bound, int) or isinstance(bound, bool) or not 1 <= bound <= ceiling:
                raise ContractError(f"adapter_transport.{name} must be bounded")
            result[name] = bound
    if obj.get("headers") is not None:
        if not isinstance(obj["headers"], dict):
            raise ContractError("adapter_transport.headers must be an object")
        # Values stay as written. A credential belongs here as a `${VAR}`
        # reference and is resolved at call time, so nothing resolved is ever
        # stored in a record or printed with one.
        result["headers"] = {
            _local_text(name, "adapter_transport.headers key", max_length=128): _local_text(
                item, "adapter_transport.headers value", max_length=2048
            )
            for name, item in obj["headers"].items()
        }
    return result


__all__ = [
    "ADAPTER_INTERFACE",
    "HEALTH_STATES",
    "TRANSPORT_KINDS",
    "validate_adapter_manifest",
    "validate_adapter_transport",
]
