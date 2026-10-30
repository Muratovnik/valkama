"""The ``valkama-modules`` manifest: what one module declares about itself.

Kept apart from the adapter contract because the module gate reads it on every
request and must stay small: a module manifest names its actions by ID only.
"""

from __future__ import annotations

import re

from ..store_identity.primitives import (
    ENTITY_KINDS,
    ContractError,
    InvalidDiscriminantError,
    _enum,
    _identifier,
    _list,
    _object,
    _reject_unsafe_tree,
    _semver,
    _text,
)

MODULES_INTERFACE = "valkama-modules"


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
