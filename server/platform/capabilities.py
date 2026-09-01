"""Kernel-owned Layer-0 capability definitions and deterministic resolution."""

from __future__ import annotations

from copy import deepcopy

from .contracts import ContractError, validate_assignment, validate_connection


class CapabilityError(ContractError):
    pass


def _definition(
    capability_id: str,
    cardinality: str,
    operation_character: str,
    result_type: str,
) -> dict:
    if operation_character not in {"read", "write"}:
        raise CapabilityError("capability operation_character must be read or write")
    if result_type not in {
        "execution",
        "session",
        "telemetry",
        "skill",
        "memory-resource",
        "artifact",
        "health",
    }:
        raise CapabilityError("capability result_type is not normalized")
    return {
        "capability_id": capability_id,
        "cardinality": cardinality,
        "operation_character": operation_character,
        "result_type": result_type,
        "assignment_scopes": ["installation", "project"],
        "permissions": [capability_id],
        "unavailable_state": "unavailable",
    }


CAPABILITY_DEFINITIONS = {
    capability_id: _definition(capability_id, cardinality, operation_character, result_type)
    for capability_id, cardinality, operation_character, result_type in (
        ("execution.launch", "one", "write", "execution"),
        ("execution.resume", "one", "write", "execution"),
        ("execution.stop", "one", "write", "execution"),
        ("session.observe", "one-or-more", "read", "session"),
        ("telemetry.query", "one-or-more", "read", "telemetry"),
        ("skills.catalog", "one-or-more", "read", "skill"),
        ("skills.activate", "one-or-more", "write", "skill"),
        ("memory.open", "one", "read", "memory-resource"),
        ("memory.health", "one", "read", "health"),
        ("artifact.inspect", "one", "read", "artifact"),
    )
}


def _scope_matches(scope: dict, *, project_id: str | None) -> bool:
    if project_id is None:
        return scope == {"kind": "installation"}
    return scope == {"kind": "project", "project_id": project_id}


def resolve_capability(
    capability_id: str,
    *,
    project_id: str | None = None,
    assignments: list[dict] | tuple[dict, ...] = (),
    connections: list[dict] | tuple[dict, ...] = (),
) -> dict:
    """Resolve exact project override, then installation default, or unavailable."""

    definition = CAPABILITY_DEFINITIONS.get(capability_id)
    if definition is None:
        raise CapabilityError("capability is not defined by the Kernel")
    normalized_assignments = [validate_assignment(item) for item in assignments]
    normalized_connections = [validate_connection(item) for item in connections]
    by_id: dict[str, list[dict]] = {}
    for connection in normalized_connections:
        ref = connection["connection_ref"]
        identifier = ":".join(
            (
                ref["service_ref"]["owner_id"],
                ref["service_ref"]["service_id"],
                ref["adapter_lineage_id"],
                ref["connection_id"],
            )
        )
        by_id.setdefault(identifier, []).append(connection)

    levels = (
        (("project", project_id), ("installation", None))
        if project_id is not None
        else (("installation", None),)
    )
    assignment = None
    source = None
    for kind, target_project in levels:
        candidates = [
            item
            for item in normalized_assignments
            if item["capability_id"] == capability_id
            and _scope_matches(item["scope"], project_id=target_project)
        ]
        if len(candidates) > 1:
            return _unavailable(definition, "duplicate-assignment", kind)
        if candidates:
            assignment = candidates[0]
            source = kind
            break
    if assignment is None:
        return _unavailable(definition, "assignment-missing", None)
    if assignment["state"] != "enabled":
        return _unavailable(definition, "assignment-disabled", source, assignment)

    selected = []
    for connection_id in assignment["connection_ids"]:
        matches = by_id.get(connection_id, [])
        if len(matches) != 1:
            reason = "connection-missing" if not matches else "connection-id-ambiguous"
            return _unavailable(definition, reason, source, assignment)
        connection = matches[0]
        if connection["state"] != "registered":
            return _unavailable(definition, "connection-inactive", source, assignment)
        if connection["health"] not in {"ready", "not-observed"}:
            return _unavailable(definition, "connection-unhealthy", source, assignment)
        selected.append(connection)

    cardinality = definition["cardinality"]
    if cardinality == "one" and len(selected) != 1:
        return _unavailable(definition, "cardinality-one-required", source, assignment)
    if cardinality == "one-or-more" and not selected:
        return _unavailable(definition, "cardinality-one-or-more-required", source, assignment)
    return {
        "state": "ready",
        "capability": deepcopy(definition),
        "assignment": deepcopy(assignment),
        "connections": deepcopy(selected),
        "health": [item["health"] for item in selected],
        "permissions": list(definition["permissions"]),
        "source": source,
    }


def _unavailable(
    definition: dict,
    reason: str,
    source: str | None,
    assignment: dict | None = None,
) -> dict:
    return {
        "state": "unavailable",
        "capability": deepcopy(definition),
        "connections": [],
        "health": [],
        "permissions": list(definition["permissions"]),
        "reason": reason,
        "source": source,
        **({"assignment": deepcopy(assignment)} if assignment is not None else {}),
    }


__all__ = ["CAPABILITY_DEFINITIONS", "CapabilityError", "resolve_capability"]
