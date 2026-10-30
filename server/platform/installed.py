"""Which external adapters this installation declares, as files it can read.

An external adapter is declared by the owner, one file per adapter under
`~/.valkama/adapters/`. That choice is deliberately boring: it needs no table,
and the owner can read and delete what is installed without a tool.

**The file is not a manifest.** It is a manifest *and* a transport, and they are
separate for a reason the CLI transport made unavoidable: a manifest may be
fetched from the adapter itself and is held to the browser rule, which refuses a
`command` key or a path-shaped string anywhere in it. An argv naming an absolute
interpreter is local configuration, not a declaration about what an adapter is.
A manifest may also be *discovered* from an endpoint, so the destination is
known before the manifest is, and cannot live inside the document it is used to
fetch.

```json
{
  "record_version": "valkama-adapter-installation",
  "manifest": {"contract_version": "valkama-adapter", "adapter_id": "...",
               "version": "1.0.0", "capabilities": ["memory.open"]},
  "transport": {"kind": "http", "base_url": "http://127.0.0.1:8770"}
}
```

Removal is a file deletion and nothing else: no table holds an installed
adapter, so there is nothing left behind to unregister.

Nothing here dials anything. Reading a record is not reaching an adapter, and a
directory of files is not a set of running services.
"""

from __future__ import annotations

import json
import os

from ..ops.configuration import CONFIG_DIRECTORY
from .adapter_contract import validate_adapter_manifest, validate_adapter_transport
from .external import CliChannel, ExternalProvider, HttpChannel, McpChannel
from .transports import CliTransport, HttpTransport, McpTransport, TransportError

ADAPTER_DIRECTORY = "adapters"
RECORD_VERSION = "valkama-adapter-installation"

#: Bounds on a directory anybody can write into. A record is a small document;
#: a hundred of them is already more adapters than an installation has tools.
MAX_ADAPTERS = 100
MAX_RECORD_BYTES = 256 * 1024


def adapters_path(home: str | None = None) -> str:
    base = home if home is not None else os.path.expanduser("~")
    return os.path.join(base, CONFIG_DIRECTORY, ADAPTER_DIRECTORY)


def record_path(adapter_id: str, home: str | None = None) -> str:
    """One file per adapter, named by the id, so removal needs no index.

    The id is validated before it reaches here, so it cannot carry a separator;
    the check stays anyway because the cost of being wrong is a write outside
    the directory.
    """

    if not adapter_id or os.path.basename(adapter_id) != adapter_id:
        raise ValueError(f"{adapter_id!r} is not a usable adapter id")
    return os.path.join(adapters_path(home), f"{adapter_id}.json")


def validate_record(value: object) -> dict:
    """An installation record: exactly a valid manifest and a valid transport."""

    if not isinstance(value, dict):
        raise ValueError("an installation record is an object")
    unknown = set(value) - {"record_version", "manifest", "transport"}
    if unknown:
        raise ValueError(
            f"an installation record has unknown field(s): {', '.join(sorted(unknown))}"
        )
    if value.get("record_version") != RECORD_VERSION:
        raise ValueError(f"record_version must be {RECORD_VERSION}")
    manifest = validate_adapter_manifest(value.get("manifest"))
    transport = validate_adapter_transport(value.get("transport"))
    return {"record_version": RECORD_VERSION, "manifest": manifest, "transport": transport}


def read_records(home: str | None = None) -> tuple[list[dict], list[dict]]:
    """Every installed record, and a typed reason for each one refused.

    Refusals are returned rather than raised. One unreadable file must not stop
    an installation from starting — that is the failure the doctor already met
    when a malformed configuration took the diagnostic down with it.
    """

    directory = adapters_path(home)
    if not os.path.isdir(directory):
        return [], []
    records: list[dict] = []
    refusals: list[dict] = []
    for name in sorted(os.listdir(directory))[:MAX_ADAPTERS]:
        if not name.endswith(".json"):
            continue
        path = os.path.join(directory, name)
        try:
            if os.path.getsize(path) > MAX_RECORD_BYTES:
                raise ValueError(f"over {MAX_RECORD_BYTES} bytes")
            with open(path, encoding="utf-8") as handle:
                records.append(validate_record(json.load(handle)))
        # Anything a file can do wrong is one answer: this record is not usable,
        # and the name plus the reason is what an owner needs.
        except Exception as failure:
            refusals.append({"path": path, "reason": str(failure)[:300]})
    return records, refusals


def channel_for(record: dict) -> CliChannel | HttpChannel | McpChannel | None:
    """The channel a record declares, when it declares a usable one.

    A destination the policy refuses is not a destination. The record stays
    readable and the adapter simply does not become a provider — better than
    half-building one, which would report `unavailable` for a reason nobody
    can act on.
    """

    transport = record.get("transport")
    if not isinstance(transport, dict):
        return None
    try:
        if transport.get("kind") == "http":
            return HttpChannel(
                HttpTransport(
                    base_url=str(transport["base_url"]),
                    timeout_ms=int(transport.get("timeout_ms") or 2_000),
                    max_payload_bytes=int(transport.get("max_payload_bytes") or 131_072),
                    headers=dict(transport.get("headers") or {}),
                )
            )
        if transport.get("kind") == "mcp":
            return McpChannel(
                McpTransport(
                    command=tuple(str(item) for item in transport["command"]),
                    cwd=str(transport.get("cwd") or ""),
                    timeout_ms=int(transport.get("timeout_ms") or 15_000),
                    max_payload_bytes=int(transport.get("max_payload_bytes") or 131_072),
                    environment=dict(transport.get("environment") or {}),
                )
            )
        if transport.get("kind") == "cli":
            return CliChannel(
                CliTransport(
                    command=tuple(str(item) for item in transport["command"]),
                    cwd=str(transport.get("cwd") or ""),
                    timeout_ms=int(transport.get("timeout_ms") or 5_000),
                    max_payload_bytes=int(transport.get("max_payload_bytes") or 131_072),
                    environment=dict(transport.get("environment") or {}),
                )
            )
    except TransportError:
        return None
    return None


def installed_providers(home: str | None = None) -> list[ExternalProvider]:
    """The installed adapters, each as a provider that can be asked for its health."""

    records, _ = read_records(home)
    providers = []
    for record in records:
        channel = channel_for(record)
        if channel is not None:
            providers.append(ExternalProvider(manifest_record=record["manifest"], channel=channel))
    return providers


def install(manifest: dict, transport: dict, home: str | None = None) -> str:
    """Write a validated record into the directory, and say where it went."""

    record = validate_record(
        {"record_version": RECORD_VERSION, "manifest": manifest, "transport": transport}
    )
    directory = adapters_path(home)
    os.makedirs(directory, exist_ok=True)
    path = record_path(str(record["manifest"]["adapter_id"]), home)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(record, handle, ensure_ascii=False, indent=1, sort_keys=True)
        handle.write("\n")
    return path


def remove(adapter_id: str, home: str | None = None) -> bool:
    """Delete one installed record. Returns whether there was one."""

    path = record_path(adapter_id, home)
    if not os.path.isfile(path):
        return False
    os.remove(path)
    return True


__all__ = [
    "ADAPTER_DIRECTORY",
    "MAX_ADAPTERS",
    "MAX_RECORD_BYTES",
    "RECORD_VERSION",
    "adapters_path",
    "channel_for",
    "install",
    "installed_providers",
    "read_records",
    "record_path",
    "remove",
    "validate_record",
]
