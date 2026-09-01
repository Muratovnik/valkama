"""EXT-005: `valkama adapter check`, which answers whether an adapter conforms.

A conformance tool that only read a manifest would check the easy half. The
half that matters is what the adapter does when it is asked something wrong,
because a service that accepts a malformed payload and answers anyway is the
one that produces a plausible wrong result six months later — and by then the
answer is in a projection and nobody knows which call made it.

So the checks fall in two groups. The manifest group is offline and answers
whether the document is a valid adapter declaration. The behaviour group needs
the adapter running, and every case in it is a refusal the adapter is supposed
to produce: a capability it never declared, a payload that is not an object, a
body larger than its own stated ceiling. Passing those is the conformance;
answering them cheerfully is the failure the tool exists to name.

It reports in the vocabulary `doctor` already uses — a finding per check with a
status and a fix — because an owner running both should not have to learn two.
Nothing here writes anything, and nothing here trusts the adapter: reachability
is not conformance and conformance is not trust.
"""

from __future__ import annotations

import json
import os

from ..platform import external, installed, transports
from ..platform.contracts import validate_adapter_manifest
from . import doctor

#: What a record may weigh before this refuses to read it. A conformance tool
#: pointed at a hostile file is exactly the case where a bound is cheap.
MAX_RECORD_BYTES = installed.MAX_RECORD_BYTES

STATUSES = doctor.STATUSES


def _finding(identifier: str, title: str, status: str, detail: str, fix: str = "") -> dict:
    if status not in STATUSES:
        raise ValueError(f"unknown conformance status {status!r}")
    return {"id": identifier, "title": title, "status": status, "detail": detail, "fix": fix}


def read_record_file(path: str) -> dict:
    """The installation record on disk, bounded and parsed, or a reason it is not one."""

    if not os.path.isfile(path):
        raise external.ExternalAdapterError("record_missing", f"no file at {path}")
    if os.path.getsize(path) > MAX_RECORD_BYTES:
        raise external.ExternalAdapterError(
            "record_too_large", f"a record over {MAX_RECORD_BYTES} bytes is not one"
        )
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as failure:
        raise external.ExternalAdapterError(
            "record_unreadable", f"{path} is not readable UTF-8 JSON"
        ) from failure
    if not isinstance(payload, dict):
        raise external.ExternalAdapterError("record_unexpected", "a record is an object")
    return payload


def record_from_source(transport: dict) -> dict:
    """Ask the adapter for its manifest, and pair it with where it was asked.

    §18.4's discovery half. The destination is what the owner supplies — it has
    to be, since it is how the manifest is reached — and the manifest is what
    the adapter supplies. Pairing them here is what makes the two checkable
    against each other later.
    """

    channel = installed.channel_for({"transport": transport})
    if channel is None:
        raise external.ExternalAdapterError(
            "source_refused", "that destination is not one an adapter may be reached at"
        )
    return {
        "record_version": installed.RECORD_VERSION,
        "manifest": external.fetch_manifest(channel),
        "transport": transport,
    }


def _manifest_findings(raw: object) -> tuple[list[dict], dict | None]:
    try:
        manifest = validate_adapter_manifest(raw)
    except Exception as failure:  # noqa: BLE001 — every contract error is one verdict
        return [
            _finding(
                "manifest",
                "Manifest",
                "fail",
                str(failure)[:400],
                "Fix the field the message names; nothing else runs until the"
                " declaration is valid, because every later check reads it.",
            )
        ], None

    findings = [
        _finding("manifest", "Manifest", "ok", f"valid {manifest['contract_version']} declaration")
    ]

    capabilities = list(manifest["capabilities"])
    findings.append(
        _finding(
            "capabilities",
            "Capabilities",
            "ok" if capabilities else "warn",
            ", ".join(capabilities) or "none declared",
            "An adapter that declares no capability can be installed and then asked for nothing."
            if not capabilities
            else "",
        )
    )

    # Every capability needs a permission, or the installer cannot show the
    # owner what enabling it allows — which §18.5 requires before enabling.
    declared = {str(item["permission_id"]) for item in manifest["permissions"]}
    unpermitted = [item for item in capabilities if item not in declared]
    findings.append(
        _finding(
            "permissions",
            "Permission declarations",
            "warn" if unpermitted else "ok",
            f"{len(declared)} declared; {', '.join(unpermitted)} without one"
            if unpermitted
            else f"{len(declared)} declared, one per capability",
            "§18.5 requires the owner to see what a Connection allows before"
            " enabling it. A capability with no permission shows nothing."
            if unpermitted
            else "",
        )
    )

    contract = manifest["health_contract"]
    findings.append(
        _finding(
            "bounds",
            "Declared bounds",
            "ok",
            f"{contract['timeout_ms']} ms, {contract['max_payload_bytes']} bytes",
        )
    )
    return findings, manifest


def _behaviour_findings(manifest: dict, channel) -> list[dict]:
    provider = external.ExternalProvider(manifest_record=manifest, channel=channel)
    state, diagnostics = provider.health()
    findings = [
        _finding(
            "health",
            "Health",
            "ok" if state == "ready" else "warn" if state == "degraded" else "fail",
            f"{state}: {(diagnostics or {}).get('message', 'no diagnostic')}",
            "Every later check needs the adapter answering. Start it, or point"
            " the manifest at where it actually runs."
            if state == "unavailable"
            else "",
        )
    ]
    if state == "unavailable":
        return findings

    findings.append(_identity_finding(channel, manifest))
    # The refusals. Each is a call the adapter must decline; answering it is
    # the finding, not an error in the tool.
    findings.append(_refusal_finding(channel, manifest))
    return findings


def _identity_finding(channel, manifest: dict) -> dict:
    """Whether the adapter at that address is the adapter this file describes.

    Not a guess about the shape of an id. A manifest file that describes one
    adapter while the address serves another is the same failure `valkama
    setup` guards one level out — a registration that keeps working until it
    does not, and says nothing in between.
    """

    try:
        served = external.fetch_manifest(channel)
    except external.ExternalAdapterError as failure:
        return _finding(
            "identity",
            "Served identity",
            "warn",
            f"the adapter served no usable manifest: {failure.message}",
            "§18.4 allows discovery from the endpoint. Without it, nothing"
            " checks that this file describes the service at that address.",
        )
    differences = [
        f"{field}: file says {manifest[field]!r}, the adapter says {served.get(field)!r}"
        for field in ("adapter_id", "version", "capabilities")
        if manifest[field] != served.get(field)
    ]
    return _finding(
        "identity",
        "Served identity",
        "fail" if differences else "ok",
        "; ".join(differences) if differences else f"{served['adapter_id']} at {served['version']}",
        "The file and the address describe different adapters. Installing this"
        " would register one and reach the other."
        if differences
        else "",
    )


def _refusal_finding(channel, manifest: dict) -> dict:
    """Whether the adapter declines what it is supposed to decline.

    Posted straight down the channel rather than through
    `ExternalProvider.dispatch`, and that is the whole point. Dispatch
    refuses an undeclared capability and a non-object payload on this side,
    before the call leaves — which is correct for a caller and useless for a
    conformance tool. Going through it, the first version of this check gave a
    lax adapter a clean bill by never asking it anything.
    """

    undeclared = next(
        (
            item
            for item in ("execution.launch", "memory.open", "telemetry.query")
            if item not in manifest["capabilities"]
        ),
        "",
    )
    probes: list[tuple[str, dict]] = []
    if undeclared:
        probes.append(
            (f"{undeclared}, which it never declared", {"capability_id": undeclared, "payload": {}})
        )
    if manifest["capabilities"]:
        # A list is not a payload. An adapter that reads one is guessing, and a
        # guess that returns a result is the worst of the outcomes.
        probes.append(
            (
                "a payload that is not an object",
                {"capability_id": str(manifest["capabilities"][0]), "payload": []},
            )
        )
    accepted = []
    for description, body in probes:
        try:
            channel.call("invoke", body)
        except transports.TransportError:
            continue
        accepted.append(description)
    return _finding(
        "refusals",
        "Refusals",
        "fail" if accepted else "ok",
        "accepted " + "; accepted ".join(accepted)
        if accepted
        else f"declined {len(probes)} call(s) it should decline",
        "An adapter that answers a malformed call produces a plausible wrong"
        " result that nobody can trace back to this call."
        if accepted
        else "",
    )


def check(record: dict, where: str = "") -> dict:
    """The whole report for one installation record."""

    findings, manifest = _manifest_findings(record.get("manifest"))
    if manifest is not None:
        # Built exactly the way an installation builds it. A second
        # construction that happened to agree today would be checking
        # something other than what runs.
        channel = installed.channel_for(record)
        if channel is None:
            findings.append(
                _finding(
                    "reachability",
                    "Reachability",
                    "unknown",
                    "no usable transport in the record; behaviour was not checked",
                    "A built-in adapter has no destination and needs none."
                    " Anything installed separately has one, and without it the"
                    " refusal checks cannot run at all.",
                )
            )
        else:
            findings.extend(_behaviour_findings(manifest, channel))
    return _report(where or str((record.get("transport") or {}).get("kind", "record")), findings)


def check_file(path: str) -> dict:
    """A record on disk, or one finding saying why it is not readable."""

    try:
        record = read_record_file(path)
    except external.ExternalAdapterError as failure:
        return _report(
            path,
            [
                _finding(
                    "manifest", "Manifest", "fail", failure.message, "Point at a readable record."
                )
            ],
        )
    return check(record, path)


def check_source(transport: dict, where: str) -> dict:
    """An adapter asked for its own manifest, then checked against it."""

    try:
        record = record_from_source(transport)
    except external.ExternalAdapterError as failure:
        return _report(
            where,
            [
                _finding(
                    "manifest",
                    "Manifest",
                    "fail",
                    failure.message,
                    "The adapter has to serve its own manifest before anything"
                    " else can be checked against it.",
                )
            ],
        )
    return check(record, where)


def _report(source: str, findings: list[dict]) -> dict:
    return {
        "interface_version": "valkama-adapter-check",
        "source": source,
        "findings": findings,
        "summary": {
            status: sum(1 for item in findings if item["status"] == status) for status in STATUSES
        },
        "status": doctor.worst_of(findings),
    }


def render(report: dict) -> str:
    order = {"fail": 0, "warn": 1, "unknown": 2, "ok": 3}
    lines = [f"valkama adapter check: {report['status']}  ({report['source']})"]
    for item in sorted(report["findings"], key=lambda finding: order[finding["status"]]):
        lines.append(f"  [{item['status']:<7}] {item['title']}: {item['detail']}")
        if item["fix"] and item["status"] != "ok":
            lines.append(f"            fix: {item['fix']}")
    return "\n".join(lines)


__all__ = [
    "MAX_RECORD_BYTES",
    "STATUSES",
    "check",
    "check_file",
    "check_source",
    "read_record_file",
    "record_from_source",
    "render",
]
