"""The records the extension registry persisted, kept for the migrations alone.

The registry is gone from the runtime: nothing reads or writes its rows, and the
migration that drops its tables removes them. Until then a store may still be
carried forward from an older generation, and the migrations in `migrations`
check and rewrite those rows exactly as the registry defined them -- an
assignment, a connection, an action input descriptor, an adapter manifest with
its contributions, permissions and health contract. This module is that
definition, moved here unchanged so the migrations keep refusing what they
refused before.

`migrations` is its only reader. It is not a contract anything may accept
input with: the current adapter contract is `adapter_contract`, and it is much
smaller. This module goes when the migrations that read these rows are folded.
"""

from __future__ import annotations

import re

from ..store_identity.primitives import (
    ENTITY_KINDS,
    ContractError,
    InvalidDiscriminantError,
    MissingFieldError,
    UnknownFieldError,
    _enum,
    _identifier,
    _list,
    _object,
    _project_id,
    _reject_unsafe_tree,
    _semver,
    _text,
)
from ..store_identity.refs import (
    validate_connection_ref,
    validate_entity_ref,
    validate_operating_scope,
)
from .adapter_contract import ADAPTER_INTERFACE, HEALTH_STATES

ACTIONS_INTERFACE = "valkama-actions"
CONTRIBUTIONS_INTERFACE = "valkama-contributions"
#: The modules an action or contribution could name while the registry existed,
#: retired ones included: a persisted row may name any of them.
_MODULE_ID_SET = frozenset(
    {"planning", "sessions", "analytics", "improvements", "skills", "memory", "settings"}
)
AUTHORIZATION_TARGET_KINDS = ENTITY_KINDS | {"adapter-resource"}
ASSIGNMENT_STATES = frozenset({"enabled", "disabled"})
ASSIGNMENT_SCOPE_KINDS = frozenset({"installation", "project"})
#: Every capability an assignment or a manifest could name.
CAPABILITY_IDS = frozenset(
    {
        "execution.launch",
        "execution.resume",
        "execution.stop",
        "session.observe",
        "telemetry.query",
        "skills.catalog",
        "skills.activate",
        "memory.open",
        "memory.health",
        "artifact.inspect",
    }
)
CONNECTION_MODES = frozenset({"required", "none"})
EXECUTION_MODES = frozenset({"built_in", "local_service", "local_process"})
TRUST_STATES = frozenset({"trusted", "restricted", "blocked", "unknown"})
CONTRIBUTION_SLOTS = frozenset(
    {
        "entity-relation-resolver",
        "entity-action",
        "inspector-section",
        "normalized-event-source",
        "settings-connection-entry",
        "read-model-provider",
        "status-diagnostics",
    }
)
_ACTION_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})*$")
_SCHEMA_ID_RE = re.compile(r"^[a-z][a-z0-9._-]{0,95}$")


def _schema_id(value, where):
    if not isinstance(value, str) or not _SCHEMA_ID_RE.fullmatch(value):
        raise ContractError(f"{where} must match the frontend schema ID grammar")
    return value


def validate_assignment_scope(value):
    obj = _object(value, ("kind",), optional=("project_id",), where="assignment_scope")
    kind = _enum(obj["kind"], ASSIGNMENT_SCOPE_KINDS, "assignment_scope.kind")
    if kind == "installation":
        if set(obj) != {"kind"}:
            raise UnknownFieldError("installation assignment_scope cannot carry project_id")
        return {"kind": "installation"}
    if set(obj) != {"kind", "project_id"}:
        raise MissingFieldError("project assignment_scope requires exactly project_id")
    return {
        "kind": "project",
        "project_id": _project_id(obj["project_id"], "assignment_scope.project_id"),
    }


def validate_connection(value):
    obj = _object(
        value,
        (
            "connection_ref",
            "applicability",
            "configuration_owner",
            "trust_owner",
            "trust",
            "health",
            "state",
        ),
        optional=("diagnostics",),
        where="connection",
    )
    _reject_unsafe_tree(obj, "connection")
    result = {
        "connection_ref": validate_connection_ref(obj["connection_ref"]),
        "applicability": validate_operating_scope(obj["applicability"]),
        "configuration_owner": _identifier(
            obj["configuration_owner"], "connection.configuration_owner"
        ),
        "trust_owner": _identifier(obj["trust_owner"], "connection.trust_owner"),
        "trust": _enum(obj["trust"], TRUST_STATES, "connection.trust"),
        "health": _enum(obj["health"], HEALTH_STATES, "connection.health"),
        "state": _enum(obj["state"], {"registered", "invalid", "tombstoned"}, "connection.state"),
    }
    if "diagnostics" in obj:
        diagnostics = _object(
            obj["diagnostics"], ("code", "message"), where="connection.diagnostics"
        )
        result["diagnostics"] = {
            "code": _identifier(diagnostics["code"], "connection.diagnostics.code"),
            "message": _text(
                diagnostics["message"], "connection.diagnostics.message", max_length=512
            ),
        }
    return result


def validate_assignment(value):
    obj = _object(
        value,
        (
            "assignment_id",
            "capability_id",
            "scope",
            "connection_ids",
            "state",
            "changed_by",
        ),
        where="assignment",
    )
    connection_ids = _list(
        obj["connection_ids"],
        "assignment.connection_ids",
        item=lambda item, where: _identifier(item, where),
    )
    return {
        "assignment_id": _identifier(obj["assignment_id"], "assignment.assignment_id"),
        "capability_id": _enum(obj["capability_id"], CAPABILITY_IDS, "assignment.capability_id"),
        "scope": validate_assignment_scope(obj["scope"]),
        "connection_ids": connection_ids,
        "state": _enum(obj["state"], ASSIGNMENT_STATES, "assignment.state"),
        "changed_by": _identifier(obj["changed_by"], "assignment.changed_by"),
    }


def _action_namespace(action_id, owner_kind, owner_id, where="action_ref"):
    if not isinstance(action_id, str) or not action_id or len(action_id) > 192:
        raise ContractError(f"{where}.action_id must be bounded text")
    parts = action_id.split(".")
    if owner_kind == "kernel":
        # Kernel actions share the literal ``core`` namespace; ``owner_id``
        # is therefore the exact kernel owner token, not the action name.
        if (
            owner_id != "kernel"
            or len(parts) < 2
            or parts[0] != "core"
            or not _ACTION_NAME_RE.fullmatch(".".join(parts[1:]))
        ):
            raise ContractError("kernel ActionRef namespace must be core.<name>")
    elif owner_kind == "module":
        if (
            owner_id not in _MODULE_ID_SET
            or len(parts) < 3
            or parts[0] != "module"
            or parts[1] != owner_id
            or not _ACTION_NAME_RE.fullmatch(".".join(parts[2:]))
        ):
            raise ContractError("module ActionRef namespace must be module.<owner_id>.<name>")
    elif owner_kind == "adapter":
        if (
            len(parts) < 3
            or parts[0] != "adapter"
            or parts[1] != owner_id
            or not _ACTION_NAME_RE.fullmatch(".".join(parts[2:]))
        ):
            raise ContractError("adapter ActionRef namespace must be adapter.<lineage>.<name>")
    else:
        raise InvalidDiscriminantError("action_ref.owner_kind must be kernel, module, or adapter")
    return action_id


def validate_action_ref(value):
    obj = _object(
        value,
        (
            "interface_version",
            "action_id",
            "owner_kind",
            "owner_id",
            "input_schema_id",
            "target_kind",
            "invocation_scope_schema",
        ),
        where="action_ref",
    )
    if obj["interface_version"] != ACTIONS_INTERFACE:
        raise InvalidDiscriminantError(f"action_ref.interface_version must be {ACTIONS_INTERFACE}")
    owner_kind = _enum(obj["owner_kind"], {"kernel", "module", "adapter"}, "action_ref.owner_kind")
    owner_id = _identifier(obj["owner_id"], "action_ref.owner_id")
    action_id = _action_namespace(obj["action_id"], owner_kind, owner_id)
    target_kind = _enum(
        obj["target_kind"], ENTITY_KINDS | {"adapter-resource"}, "action_ref.target_kind"
    )
    scope_schema = _enum(
        obj["invocation_scope_schema"],
        {"global", "project", "either"},
        "action_ref.invocation_scope_schema",
    )
    return {
        "interface_version": ACTIONS_INTERFACE,
        "action_id": action_id,
        "owner_kind": owner_kind,
        "owner_id": owner_id,
        "input_schema_id": _schema_id(obj["input_schema_id"], "action_ref.input_schema_id"),
        "target_kind": target_kind,
        "invocation_scope_schema": scope_schema,
    }


def validate_action_input_descriptor(value):
    """Validate the declarative semantics a generic consumer needed for an action."""

    obj = _object(
        value,
        (
            "action_id",
            "operation",
            "resource_types",
            "fields",
            "confirmation",
            "title_key",
        ),
        where="action_input_descriptor",
    )

    def field(item, where):
        record = _object(item, ("key", "kind", "required", "max_length"), where=where)
        if record["key"] not in {"entity_ref", "external_id"}:
            raise InvalidDiscriminantError(f"{where}.key is not a current action input field")
        if record["kind"] != "stable-id":
            raise InvalidDiscriminantError(f"{where}.kind must be stable-id")
        if not isinstance(record["required"], bool):
            raise ContractError(f"{where}.required must be boolean")
        maximum = record["max_length"]
        if not isinstance(maximum, int) or isinstance(maximum, bool) or not 1 <= maximum <= 512:
            raise ContractError(f"{where}.max_length must be between 1 and 512")
        return {
            "key": _identifier(record["key"], f"{where}.key"),
            "kind": "stable-id",
            "required": record["required"],
            "max_length": maximum,
        }

    confirmation = obj["confirmation"]
    if confirmation != "required":
        raise InvalidDiscriminantError("action_input_descriptor.confirmation must be required")
    return {
        "action_id": _identifier(obj["action_id"], "action_input_descriptor.action_id"),
        "operation": _enum(
            obj["operation"],
            {"attach", "open", "remove"},
            "action_input_descriptor.operation",
        ),
        "resource_types": _list(
            obj["resource_types"],
            "action_input_descriptor.resource_types",
            item=lambda item, where: _identifier(item, where),
        ),
        "fields": _list(
            obj["fields"],
            "action_input_descriptor.fields",
            item=field,
            max_items=16,
        ),
        "confirmation": "required",
        "title_key": _identifier(obj["title_key"], "action_input_descriptor.title_key"),
    }


def _validate_health_contract(value):
    obj = _object(
        value, ("timeout_ms", "max_payload_bytes"), optional=("states",), where="health_contract"
    )
    timeout = obj["timeout_ms"]
    payload = obj["max_payload_bytes"]
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 120_000:
        raise ContractError("health_contract.timeout_ms must be bounded")
    if not isinstance(payload, int) or isinstance(payload, bool) or not 1 <= payload <= 10_000_000:
        raise ContractError("health_contract.max_payload_bytes must be bounded")
    result = {"timeout_ms": timeout, "max_payload_bytes": payload}
    if "states" in obj:
        result["states"] = _list(
            obj["states"],
            "health_contract.states",
            item=lambda item, where: _enum(item, HEALTH_STATES, where),
        )
    return result


def _validate_permission_declaration(value):
    obj = _object(
        value,
        ("permission_id", "connection_mode", "entity_kinds"),
        optional=("target_kinds",),
        where="permission_declaration",
    )
    permission_id = _identifier(obj["permission_id"], "permission_declaration.permission_id")
    mode = _enum(obj["connection_mode"], CONNECTION_MODES, "permission_declaration.connection_mode")
    kinds = _list(
        obj["entity_kinds"],
        "permission_declaration.entity_kinds",
        item=lambda item, where: _enum(item, AUTHORIZATION_TARGET_KINDS, where),
    )
    if not kinds:
        raise ContractError("permission_declaration.entity_kinds cannot be empty")
    result = {"permission_id": permission_id, "connection_mode": mode, "entity_kinds": kinds}
    if "target_kinds" in obj:
        result["target_kinds"] = _list(
            obj["target_kinds"],
            "permission_declaration.target_kinds",
            item=lambda item, where: _identifier(item, where),
        )
    return result


def _validate_contribution(value):
    obj = _object(
        value,
        (
            "interface_version",
            "contribution_id",
            "owner_kind",
            "owner_id",
            "slot",
            "entity_kinds",
            "content",
            "actions",
        ),
        optional=("module_id", "provenance"),
        where="contribution",
    )
    _reject_unsafe_tree(obj, "contribution")
    if obj["interface_version"] != CONTRIBUTIONS_INTERFACE:
        raise InvalidDiscriminantError(
            f"contribution.interface_version must be {CONTRIBUTIONS_INTERFACE}"
        )
    owner_kind = _enum(obj["owner_kind"], {"adapter", "module"}, "contribution.owner_kind")
    owner_id = _identifier(obj["owner_id"], "contribution.owner_id")
    module_id = obj.get("module_id")
    if module_id is not None:
        module_id = _enum(module_id, _MODULE_ID_SET, "contribution.module_id")
    if owner_kind == "module" and module_id != owner_id:
        raise ContractError("module contribution owner_id must match module_id")
    result = {
        "interface_version": CONTRIBUTIONS_INTERFACE,
        "contribution_id": _identifier(obj["contribution_id"], "contribution.contribution_id"),
        "owner_kind": owner_kind,
        "owner_id": owner_id,
        "slot": _enum(obj["slot"], CONTRIBUTION_SLOTS, "contribution.slot"),
        "entity_kinds": _list(
            obj["entity_kinds"],
            "contribution.entity_kinds",
            item=lambda item, where: _enum(item, ENTITY_KINDS, where),
        ),
    }
    if module_id is not None:
        result["module_id"] = module_id
    result["content"] = _validate_contribution_content(obj["content"])
    result["actions"] = _list(
        obj["actions"], "contribution.actions", item=lambda item, _where: validate_action_ref(item)
    )
    if "provenance" in obj:
        if owner_kind != "adapter":
            raise ContractError("only adapter contributions may carry provider provenance")
        provider = _object(
            obj["provenance"],
            ("adapter_id", "adapter_lineage_id", "adapter_version", "connection_id"),
            where="contribution.provenance",
        )
        result["provenance"] = {
            "adapter_id": _identifier(provider["adapter_id"], "contribution.provenance.adapter_id"),
            "adapter_lineage_id": _identifier(
                provider["adapter_lineage_id"], "contribution.provenance.adapter_lineage_id"
            ),
            "adapter_version": _semver(
                provider["adapter_version"], "contribution.provenance.adapter_version"
            ),
            "connection_id": _identifier(
                provider["connection_id"], "contribution.provenance.connection_id"
            ),
        }
    return result


def _validate_contribution_content(value):
    obj = _object(
        value,
        (),
        optional=(
            "kind",
            "text",
            "items",
            "status",
            "label",
            "target",
            "action",
            "columns",
            "rows",
        ),
        where="contribution.content",
    )
    if "kind" not in obj:
        raise MissingFieldError("contribution.content is missing: kind")
    kind = _enum(
        obj["kind"],
        {"text", "definition-list", "status", "link", "table"},
        "contribution.content.kind",
    )
    if kind == "text":
        _object(obj, ("kind", "text"), where="contribution.content")
        return {
            "kind": kind,
            "text": _text(obj["text"], "contribution.content.text", max_length=5000),
        }
    if kind == "definition-list":
        _object(obj, ("kind", "items"), where="contribution.content")
        items = _list(
            obj["items"],
            "contribution.content.items",
            max_items=64,
            item=lambda item, where: _validate_definition_item(item, where),
        )
        return {"kind": kind, "items": items}
    if kind == "status":
        _object(obj, ("kind", "status", "label"), where="contribution.content")
        return {
            "kind": kind,
            "status": _enum(
                obj["status"],
                {"ready", "degraded", "unavailable", "error", "permission-denied"},
                "contribution.content.status",
            ),
            "label": _text(obj["label"], "contribution.content.label", max_length=240),
        }
    if kind == "link":
        _object(
            obj, ("kind", "label", "target"), optional=("action",), where="contribution.content"
        )
        result = {
            "kind": kind,
            "label": _text(obj["label"], "contribution.content.label", max_length=240),
            "target": validate_entity_ref(obj["target"]),
        }
        if "action" in obj:
            result["action"] = validate_action_ref(obj["action"])
        return result
    _object(obj, ("kind", "columns", "rows"), where="contribution.content")
    columns = _list(
        obj["columns"],
        "contribution.content.columns",
        max_items=32,
        item=lambda item, where: _text(item, where, max_length=80),
    )
    if len(set(columns)) != len(columns) or not columns:
        raise ContractError("contribution.content.columns must be unique and non-empty")
    rows = _list(
        obj["rows"],
        "contribution.content.rows",
        max_items=256,
        item=lambda item, where: _validate_table_row(item, where, columns),
    )
    return {"kind": kind, "columns": columns, "rows": rows}


def _validate_definition_item(value, where):
    obj = _object(value, ("label", "value"), where=where)
    return {
        "label": _text(obj["label"], f"{where}.label", max_length=240),
        "value": _text(obj["value"], f"{where}.value", max_length=2000),
    }


def _validate_table_row(value, where, columns):
    obj = _object(value, columns, where=where)
    result: dict[str, str | int | float | None] = {}
    for column in columns:
        cell = obj[column]
        if cell is None:
            result[column] = None
        elif isinstance(cell, bool):
            raise ContractError(f"{where}.{column} must be text, finite number, or null")
        elif isinstance(cell, (int, float)):
            if isinstance(cell, float) and (cell != cell or cell in (float("inf"), float("-inf"))):
                raise ContractError(f"{where}.{column} must be finite")
            result[column] = cell
        else:
            result[column] = _text(cell, f"{where}.{column}", max_length=500)
    return result


def validate_adapter_record(value):
    """An adapter manifest as the registry stored it, which is not today's manifest."""

    obj = _object(
        value,
        (
            "contract_version",
            "adapter_id",
            "version",
            "title_key",
            "package_id",
            "publisher_id",
            "owner_id",
            "configuration_owner",
            "trust_owner",
            "execution",
            "supported_service_types",
            "capabilities",
            "consumes",
            "contributions",
            "permissions",
            "health_contract",
        ),
        optional=("direct_read",),
        where="adapter_manifest",
    )
    _reject_unsafe_tree(obj, "adapter_manifest")
    if obj["contract_version"] != ADAPTER_INTERFACE:
        raise InvalidDiscriminantError(
            f"adapter_manifest.contract_version must be {ADAPTER_INTERFACE}"
        )
    result = {
        "contract_version": ADAPTER_INTERFACE,
        "adapter_id": _identifier(obj["adapter_id"], "adapter_manifest.adapter_id"),
        "version": _semver(obj["version"], "adapter_manifest.version"),
        "title_key": _identifier(obj["title_key"], "adapter_manifest.title_key"),
        "package_id": _identifier(obj["package_id"], "adapter_manifest.package_id"),
        "publisher_id": _identifier(obj["publisher_id"], "adapter_manifest.publisher_id"),
        "owner_id": _identifier(obj["owner_id"], "adapter_manifest.owner_id"),
        "configuration_owner": _identifier(
            obj["configuration_owner"], "adapter_manifest.configuration_owner"
        ),
        "trust_owner": _identifier(obj["trust_owner"], "adapter_manifest.trust_owner"),
        "execution": _enum(obj["execution"], EXECUTION_MODES, "adapter_manifest.execution"),
        "supported_service_types": _list(
            obj["supported_service_types"],
            "adapter_manifest.supported_service_types",
            item=lambda item, where: _identifier(item, where),
        ),
        "capabilities": _list(
            obj["capabilities"],
            "adapter_manifest.capabilities",
            item=lambda item, where: _enum(item, CAPABILITY_IDS, where),
        ),
        "consumes": _list(
            obj["consumes"],
            "adapter_manifest.consumes",
            item=lambda item, where: _enum(item, ENTITY_KINDS, where),
        ),
        "contributions": _list(
            obj["contributions"],
            "adapter_manifest.contributions",
            item=lambda item, _where: _validate_contribution(item),
        ),
        "permissions": _list(
            obj["permissions"],
            "adapter_manifest.permissions",
            item=lambda item, _where: _validate_permission_declaration(item),
        ),
        "health_contract": _validate_health_contract(obj["health_contract"]),
    }
    if "direct_read" in obj:
        if not isinstance(obj["direct_read"], bool):
            raise ContractError("adapter_manifest.direct_read must be boolean")
        result["direct_read"] = obj["direct_read"]
    return result


__all__ = [
    "CAPABILITY_IDS",
    "validate_action_input_descriptor",
    "validate_adapter_record",
    "validate_assignment",
    "validate_connection",
]
