"""Connection, assignment, grant, and the invocation they permit.

Registration alone creates no assignment, an assignment alone grants no
capability, and a connection never becomes a permission. These are the four
object kinds the platform contract insists are not each other, plus the action
and open-target shapes that carry an authorized call.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from .primitives import (
    _ACTION_NAME_RE,
    _MODULE_ID_SET,
    _URI_SCHEME,
    ACTIONS_INTERFACE,
    ASSIGNMENT_STATES,
    AUTHORIZATION_TARGET_KINDS,
    CAPABILITY_IDS,
    ENTITY_KINDS,
    HEALTH_STATES,
    TRUST_STATES,
    ContractError,
    InvalidDiscriminantError,
    UnsafePayloadError,
    _enum,
    _identifier,
    _list,
    _object,
    _reject_unsafe_tree,
    _revision,
    _schema_id,
    _text,
    _timestamp,
    _uuid,
)
from .refs import (
    validate_adapter_resource_ref,
    validate_assignment_scope,
    validate_connection_ref,
    validate_entity_ref,
    validate_operating_scope,
)


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


def validate_permission_grant(value):
    obj = _object(
        value,
        (
            "grant_id",
            "adapter_lineage_id",
            "connection_ref",
            "permission_id",
            "applicability",
            "entity_kinds",
            "data_scope_ids",
            "granted_by",
            "granted_at",
            "revision",
        ),
        optional=("active",),
        where="permission_grant",
    )
    connection_ref = obj["connection_ref"]
    if connection_ref is not None:
        connection_ref = validate_connection_ref(connection_ref)
    scopes = _list(
        obj["data_scope_ids"],
        "permission_grant.data_scope_ids",
        item=lambda item, where: _uuid(item, where),
    )
    result = {
        "grant_id": _identifier(obj["grant_id"], "permission_grant.grant_id"),
        "adapter_lineage_id": _identifier(
            obj["adapter_lineage_id"], "permission_grant.adapter_lineage_id"
        ),
        "connection_ref": connection_ref,
        "permission_id": _identifier(obj["permission_id"], "permission_grant.permission_id"),
        "applicability": validate_operating_scope(obj["applicability"]),
        "entity_kinds": _list(
            obj["entity_kinds"],
            "permission_grant.entity_kinds",
            item=lambda item, where: _enum(item, AUTHORIZATION_TARGET_KINDS, where),
        ),
        "data_scope_ids": scopes,
        "granted_by": _identifier(obj["granted_by"], "permission_grant.granted_by"),
        "granted_at": _timestamp(obj["granted_at"], "permission_grant.granted_at"),
        "revision": _revision(obj["revision"], "permission_grant.revision"),
    }
    if "active" in obj:
        if not isinstance(obj["active"], bool):
            raise ContractError("permission_grant.active must be boolean")
        result["active"] = obj["active"]
    return result


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
    """Validate the declarative semantics a generic consumer needs for an action."""

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


def validate_invocation_context(value):
    obj = _object(value, ("view_scope", "invocation_scope", "target"), where="invocation_context")
    target = obj["target"]
    try:
        target = validate_entity_ref(target)
    except ContractError:
        target = validate_adapter_resource_ref(target)
    return {
        "view_scope": validate_operating_scope(obj["view_scope"]),
        "invocation_scope": validate_operating_scope(obj["invocation_scope"]),
        "target": target,
    }


def validate_open_target(value, *, allowed_kinds=None, allowed_schemes=None):
    """Validate a bounded external target; paths, HTML, JS and bad schemes fail."""
    obj = _object(value, ("target_kind", "uri"), optional=("connection_ref",), where="open_target")
    if not allowed_kinds or not allowed_schemes:
        raise ContractError(
            "open_target requires explicit non-empty target-kind and scheme allowlists"
        )
    kind = _identifier(obj["target_kind"], "open_target.target_kind")
    if kind not in set(allowed_kinds):
        raise InvalidDiscriminantError(f"open_target.target_kind {kind!r} is not allowed")
    uri = obj["uri"]
    if not isinstance(uri, str) or len(uri) > 2048 or any(ch.isspace() for ch in uri):
        raise ContractError("open_target.uri must be a bounded URI")
    parsed = urlsplit(uri)
    if (
        not parsed.scheme
        or not _URI_SCHEME.fullmatch(parsed.scheme.lower())
        or parsed.scheme.lower() in {"file", "javascript", "data", "vbscript", "smb"}
    ):
        raise UnsafePayloadError("open_target.uri uses a disallowed or malformed scheme")
    if parsed.username or parsed.password:
        raise UnsafePayloadError("open_target.uri cannot contain credentials")
    if parsed.scheme.lower() in {"http", "https"} and not parsed.netloc:
        raise ContractError("HTTP open target must include a host")
    result = {"target_kind": kind, "uri": uri}
    if "connection_ref" in obj:
        if obj["connection_ref"] is None:
            raise ContractError("open_target.connection_ref cannot be null")
        result["connection_ref"] = validate_connection_ref(obj["connection_ref"])
    if parsed.scheme.lower() not in {str(s).lower() for s in allowed_schemes}:
        raise UnsafePayloadError("open_target.uri scheme is not allowed for this connection")
    return result
