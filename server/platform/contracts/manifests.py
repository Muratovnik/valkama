"""Declaration contracts: what exists, described by its owner.

A module manifest, an adapter manifest, a service descriptor, a contribution.
A declaration says what a thing is and what it may offer; it neither enables
nor authorizes it, which is the boundary the platform contract draws between
these and the objects in `authorization`.
"""

from __future__ import annotations

import re

from .authorization import validate_action_ref
from .primitives import (
    _MODULE_ID_SET,
    ADAPTER_INTERFACE,
    AUTHORIZATION_TARGET_KINDS,
    CAPABILITY_IDS,
    CONNECTION_MODES,
    CONTRIBUTION_SLOTS,
    CONTRIBUTIONS_INTERFACE,
    ENTITY_KINDS,
    EXECUTION_MODES,
    HEALTH_STATES,
    MODULES_INTERFACE,
    ContractError,
    InvalidDiscriminantError,
    MissingFieldError,
    _enum,
    _identifier,
    _list,
    _local_text,
    _object,
    _provider_version,
    _reject_unsafe_tree,
    _semver,
    _text,
)
from .refs import validate_entity_ref, validate_service_ref


def validate_service_descriptor(value):
    obj = _object(
        value,
        (
            "service_ref",
            "service_type",
            "title_key",
            "configuration_owner",
            "trust_owner",
            "discovery_provenance",
            "state",
            "direct_read",
        ),
        where="service_descriptor",
    )
    _reject_unsafe_tree(obj, "service_descriptor")
    if not isinstance(obj["direct_read"], bool):
        raise ContractError("service_descriptor.direct_read must be boolean")
    return {
        "service_ref": validate_service_ref(obj["service_ref"]),
        "service_type": _identifier(obj["service_type"], "service_descriptor.service_type"),
        "title_key": _identifier(obj["title_key"], "service_descriptor.title_key"),
        "configuration_owner": _identifier(
            obj["configuration_owner"], "service_descriptor.configuration_owner"
        ),
        "trust_owner": _identifier(obj["trust_owner"], "service_descriptor.trust_owner"),
        "discovery_provenance": _identifier(
            obj["discovery_provenance"], "service_descriptor.discovery_provenance"
        ),
        "state": _enum(
            obj["state"], {"registered", "invalid", "tombstoned"}, "service_descriptor.state"
        ),
        "direct_read": obj["direct_read"],
    }


def validate_health_contract(value):
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


def validate_permission_declaration(value):
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


def validate_contribution(value):
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
            "adapter_version": _provider_version(
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


def validate_adapter_manifest(value):
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
            item=lambda item, _where: validate_contribution(item),
        ),
        "permissions": _list(
            obj["permissions"],
            "adapter_manifest.permissions",
            item=lambda item, _where: validate_permission_declaration(item),
        ),
        "health_contract": validate_health_contract(obj["health_contract"]),
    }
    if "direct_read" in obj:
        if not isinstance(obj["direct_read"], bool):
            raise ContractError("adapter_manifest.direct_read must be boolean")
        result["direct_read"] = obj["direct_read"]
    return result


#: How an adapter is reached, by execution mode. `built_in` is absent on
#: purpose: it runs inside this process, so a destination for it would be a
#: second and contradictory claim about where it lives.
#:
#: This is *not* a manifest field, and the attempt to make it one is why. A
#: manifest is published to the browser, and `_reject_unsafe_tree` refuses a
#: `command` key or a path-shaped string anywhere in one — correctly, because
#: an argv naming an absolute interpreter is local configuration rather than a
#: declaration about what an adapter is. §18.4 says it from the other side: a
#: manifest may be discovered *from* an endpoint, so the address is known
#: before the manifest is, and can hardly live inside the document it fetches.
#:
#: It lives in the installation record instead, beside the manifest and never
#: published with it.
TRANSPORT_KINDS = {
    "local_service": frozenset({"http"}),
    # `mcp` sits with the processes because the stdio transport is one. MCP
    # over HTTP is a different destination with a session and a stream, and
    # putting the name here now would promise something nothing implements.
    "local_process": frozenset({"cli", "mcp"}),
}


def validate_adapter_transport(value, execution):
    """Where an adapter is, checked against how its manifest says it runs.

    Only the shape is checked here. Whether a destination may actually be
    reached is `transports`' decision and stays there: an installation record
    is validated long before anyone chooses to call it, and a contracts module
    that reasoned about loopback or PATH would be the wrong owner for both.

    `_reject_unsafe_tree` is deliberately not applied. This is the half that
    never reaches the browser, and it is the half that has to hold an argv.
    """

    kinds = TRANSPORT_KINDS.get(execution)
    if kinds is None:
        raise ContractError(f"a {execution} adapter declares no transport")
    obj = _object(
        value,
        ("kind",),
        optional=("base_url", "command", "timeout_ms", "max_payload_bytes", "headers"),
        where="adapter_transport",
    )
    kind = _enum(obj["kind"], kinds, "adapter_transport.kind")
    result = {"kind": kind}
    if kind in ("cli", "mcp"):
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
        # stored in a manifest or printed with one.
        result["headers"] = {
            _local_text(name, "adapter_transport.headers key", max_length=128): _local_text(
                item, "adapter_transport.headers value", max_length=2048
            )
            for name, item in obj["headers"].items()
        }
    return result


def validate_module_manifest(value):
    """Validate the backend half of the frozen ``valkama-modules`` wire."""
    obj = _object(
        value,
        (
            "interface_version",
            "module_id",
            "version",
            "title_key",
            "icon_key",
            "navigation_group",
            "route_namespace",
            "state_schema",
            "operating_levels",
            "semantics",
            "secondary_context",
            "required_read_models",
            "sse_subscriptions",
            "supported_entity_kinds",
            "primary_actions",
            "secondary_actions",
            "inspector_owner",
            "feature_capabilities",
            "states",
        ),
        where="module_manifest",
    )
    _reject_unsafe_tree(obj, "module_manifest")
    if obj["interface_version"] != MODULES_INTERFACE:
        raise InvalidDiscriminantError(
            f"module_manifest.interface_version must be {MODULES_INTERFACE}"
        )
    module_id = _validate_module_id(obj["module_id"], "module_manifest.module_id")
    if obj["route_namespace"] != module_id:
        raise ContractError("module_manifest.route_namespace must equal module_id")
    if obj["operating_levels"] != ["global", "project"]:
        raise ContractError(
            "module_manifest.operating_levels must be exactly ['global', 'project']"
        )
    state_schema = _object(
        obj["state_schema"],
        ("schema_id", "allowed_keys", "max_bytes"),
        where="module_manifest.state_schema",
    )
    max_bytes = state_schema["max_bytes"]
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or not 64 <= max_bytes <= 8192:
        raise ContractError("module_manifest.state_schema.max_bytes must be bounded")
    semantics_obj = _object(
        obj["semantics"], ("global", "project"), where="module_manifest.semantics"
    )
    secondary_obj = _object(
        obj["secondary_context"], ("global", "project"), where="module_manifest.secondary_context"
    )
    states_obj = _object(obj["states"], ("global", "project"), where="module_manifest.states")
    return {
        "interface_version": MODULES_INTERFACE,
        "module_id": module_id,
        "version": _semver(obj["version"], "module_manifest.version"),
        "title_key": _identifier(obj["title_key"], "module_manifest.title_key"),
        "icon_key": _identifier(obj["icon_key"], "module_manifest.icon_key"),
        "navigation_group": _enum(
            obj["navigation_group"],
            {"work", "understand", "capabilities", "system"},
            "module_manifest.navigation_group",
        ),
        "route_namespace": module_id,
        "state_schema": {
            "schema_id": _identifier(
                state_schema["schema_id"], "module_manifest.state_schema.schema_id"
            ),
            "allowed_keys": _list(
                state_schema["allowed_keys"],
                "module_manifest.state_schema.allowed_keys",
                item=lambda item, where: _identifier(item, where),
            ),
            "max_bytes": max_bytes,
        },
        "operating_levels": ["global", "project"],
        "semantics": {
            level: _validate_module_level(
                semantics_obj[level], f"module_manifest.semantics.{level}"
            )
            for level in ("global", "project")
        },
        "secondary_context": {
            level: _validate_secondary_context(
                secondary_obj[level], f"module_manifest.secondary_context.{level}"
            )
            for level in ("global", "project")
        },
        "required_read_models": _list(
            obj["required_read_models"],
            "module_manifest.required_read_models",
            item=lambda item, where: _identifier(item, where),
        ),
        "sse_subscriptions": _list(
            obj["sse_subscriptions"],
            "module_manifest.sse_subscriptions",
            item=lambda item, where: _identifier(item, where),
        ),
        "supported_entity_kinds": _list(
            obj["supported_entity_kinds"],
            "module_manifest.supported_entity_kinds",
            item=lambda item, where: _enum(item, ENTITY_KINDS | {"adapter-resource"}, where),
        ),
        "primary_actions": _list(
            obj["primary_actions"],
            "module_manifest.primary_actions",
            item=lambda item, where: _validate_action_id(item, where),
        ),
        "secondary_actions": _list(
            obj["secondary_actions"],
            "module_manifest.secondary_actions",
            item=lambda item, where: _validate_action_id(item, where),
        ),
        "inspector_owner": _identifier(obj["inspector_owner"], "module_manifest.inspector_owner"),
        "feature_capabilities": _list(
            obj["feature_capabilities"],
            "module_manifest.feature_capabilities",
            item=lambda item, where: _identifier(item, where),
        ),
        "states": {
            level: _validate_module_state_support(
                states_obj[level], f"module_manifest.states.{level}"
            )
            for level in ("global", "project")
        },
    }


def _validate_action_id(value, where):
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 192
        or not re.fullmatch(
            r"^[a-z][a-z0-9-]{0,31}(?:\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159})+$", value
        )
    ):
        raise ContractError(f"{where} must be a bounded action ID")
    return value


def _validate_module_id(value, where):
    if not isinstance(value, str) or not re.fullmatch(r"^[a-z][a-z0-9-]{0,63}$", value):
        raise ContractError(f"{where} must be a bounded module ID")
    return value


def _validate_module_level(value, where):
    obj = _object(value, ("read_models", "action_semantics"), where=where)
    return {
        "read_models": _list(
            obj["read_models"],
            f"{where}.read_models",
            item=lambda item, path: _identifier(item, path),
        ),
        "action_semantics": _list(
            obj["action_semantics"],
            f"{where}.action_semantics",
            item=lambda item, path: _validate_action_id(item, path),
        ),
    }


def _validate_secondary_context(value, where):
    obj = _object(value, ("kinds", "behavior"), where=where)
    return {
        "kinds": _list(
            obj["kinds"],
            f"{where}.kinds",
            item=lambda item, path: _enum(item, ENTITY_KINDS | {"adapter-resource"}, path),
        ),
        "behavior": _enum(obj["behavior"], {"all", "none", "unavailable"}, f"{where}.behavior"),
    }


def _validate_module_state_support(value, where):
    obj = _object(value, ("supported",), optional=("unsupported_reason",), where=where)
    supported = _list(
        obj["supported"],
        f"{where}.supported",
        item=lambda item, path: _enum(
            item,
            {"loading", "ready", "empty", "error", "unavailable", "permission-denied", "degraded"},
            path,
        ),
    )
    result = {"supported": supported}
    if "unsupported_reason" in obj:
        if len(supported) >= 7:
            raise ContractError(
                f"{where}.unsupported_reason is invalid when every state is supported"
            )
        result["unsupported_reason"] = _text(
            obj["unsupported_reason"], f"{where}.unsupported_reason", max_length=240
        )
    return result
