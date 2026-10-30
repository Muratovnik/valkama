"""Reference contracts: the exact identity of one neutral Kernel entity."""

from __future__ import annotations

import base64
import binascii
import json

from .primitives import (
    ASSIGNMENT_SCOPE_KINDS,
    ENTITY_KINDS,
    SCOPE_KINDS,
    ContractError,
    InvalidDiscriminantError,
    MissingFieldError,
    UnknownFieldError,
    _enum,
    _identifier,
    _object,
    _project_id,
    _space_key,
    _text,
    _uuid,
    _work_item_reference,
)


def validate_project_ref(value):
    obj = _object(value, ("project_id",), where="project_ref")
    return {"project_id": _project_id(obj["project_id"], "project_ref.project_id")}


def validate_operating_scope(value):
    obj = _object(value, ("kind",), optional=("project_ref",), where="operating_scope")
    kind = _enum(obj["kind"], SCOPE_KINDS, "operating_scope.kind")
    if kind == "global":
        if set(obj) != {"kind"}:
            raise UnknownFieldError("global operating_scope cannot carry project_ref")
        return {"kind": "global"}
    if set(obj) != {"kind", "project_ref"}:
        raise MissingFieldError("project operating_scope requires exactly project_ref")
    return {"kind": "project", "project_ref": validate_project_ref(obj["project_ref"])}


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


def validate_data_scope_id(value):
    """One store's identity, on its own.

    Three callers used to reach this through `validate_board_ref` with a
    placeholder board name, which made a store's identity look as though it
    needed a board in order to exist.
    """

    return _uuid(value, "data_scope_id")


def validate_planning_space_ref(value):
    """One planning space, named by its key rather than by a board's display name.

    The Board era identified a space by the text a person typed at the top of a
    column wall, so renaming the board broke every binding, every route and
    every stored relation pointing at it. A key is short, uppercase and stable,
    and the name above it is free to change.
    """

    if isinstance(value, dict) and "board_name" in value and "space_key" not in value:
        raise MissingFieldError("planning_space_ref requires space_key; board_name is obsolete")
    obj = _object(value, ("data_scope_id", "space_key"), where="planning_space_ref")
    return {
        "data_scope_id": _uuid(obj["data_scope_id"], "planning_space_ref.data_scope_id"),
        "space_key": _space_key(obj["space_key"], "planning_space_ref.space_key"),
    }


def validate_work_item_ref(value):
    """One work item, named by the reference a person types and a commit carries."""

    obj = _object(value, ("space_ref", "reference"), where="work_item_ref")
    space_ref = validate_planning_space_ref(obj["space_ref"])
    reference = _work_item_reference(obj["reference"], "work_item_ref.reference")
    if reference.split("-", 1)[0] != space_ref["space_key"]:
        raise ContractError("work_item_ref.reference must belong to its own space")
    return {"space_ref": space_ref, "reference": reference}


def _planning_resource_id(value: dict) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _planning_resource(value: str, where: str) -> dict:
    resource_id = _text(value, where, max_length=512)
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    if not resource_id or any(ch not in alphabet for ch in resource_id):
        raise ContractError(f"{where} must be canonical base64url")
    padded = resource_id + "=" * (-len(resource_id) % 4)
    try:
        payload = base64.b64decode(padded, altchars=b"-_", validate=True)
        decoded = json.loads(payload.decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ContractError(f"{where} must contain canonical JSON") from error
    if not isinstance(decoded, dict) or _planning_resource_id(decoded) != resource_id:
        raise ContractError(f"{where} must contain canonical JSON")
    return decoded


def planning_space_entity(space_ref):
    space = validate_planning_space_ref(space_ref)
    return {"kind": "planning-space", "resource_id": _planning_resource_id(space)}


def planning_space_ref(entity_ref):
    entity = validate_entity_ref(entity_ref)
    if entity["kind"] != "planning-space":
        raise InvalidDiscriminantError("entity_ref.kind must be planning-space")
    return validate_planning_space_ref(
        _planning_resource(entity["resource_id"], "entity_ref.resource_id")
    )


def planning_work_item_entity(work_item_ref):
    item = validate_work_item_ref(work_item_ref)
    return {"kind": "work-item", "resource_id": _planning_resource_id(item)}


def planning_work_item_ref(entity_ref):
    entity = validate_entity_ref(entity_ref)
    if entity["kind"] != "work-item":
        raise InvalidDiscriminantError("entity_ref.kind must be work-item")
    return validate_work_item_ref(
        _planning_resource(entity["resource_id"], "entity_ref.resource_id")
    )


def validate_session_ref(value):
    obj = _object(value, ("client_family", "session_id"), where="session_ref")
    return {
        "client_family": _identifier(obj["client_family"], "session_ref.client_family"),
        "session_id": _identifier(obj["session_id"], "session_ref.session_id"),
    }


def validate_skill_ref(value):
    obj = _object(value, ("skill_key", "source_scope"), optional=("project_id",), where="skill_ref")
    source_scope = _enum(obj["source_scope"], {"global", "project"}, "skill_ref.source_scope")
    if source_scope == "global" and "project_id" in obj:
        raise UnknownFieldError("global skill_ref cannot carry project_id")
    result = {
        "skill_key": _text(obj["skill_key"], "skill_ref.skill_key", max_length=160),
        "source_scope": source_scope,
    }
    if source_scope == "project":
        if "project_id" not in obj:
            raise MissingFieldError("project skill_ref requires project_id")
        result["project_id"] = _project_id(obj["project_id"], "skill_ref.project_id")
    return result


def validate_service_ref(value):
    obj = _object(value, ("owner_id", "service_id"), where="service_ref")
    return {
        "owner_id": _identifier(obj["owner_id"], "service_ref.owner_id"),
        "service_id": _identifier(obj["service_id"], "service_ref.service_id"),
    }


def validate_connection_ref(value):
    obj = _object(
        value, ("service_ref", "adapter_lineage_id", "connection_id"), where="connection_ref"
    )
    return {
        "service_ref": validate_service_ref(obj["service_ref"]),
        "adapter_lineage_id": _identifier(
            obj["adapter_lineage_id"], "connection_ref.adapter_lineage_id"
        ),
        "connection_id": _identifier(obj["connection_id"], "connection_ref.connection_id"),
    }


def validate_registry_ref(value):
    obj = _object(value, ("registry_id",), where="registry_ref")
    return {"registry_id": _identifier(obj["registry_id"], "registry_ref.registry_id")}


def validate_adapter_resource_ref(value):
    obj = _object(
        value, ("connection_ref", "resource_type", "external_id"), where="adapter_resource_ref"
    )
    return {
        "connection_ref": validate_connection_ref(obj["connection_ref"]),
        "resource_type": _identifier(obj["resource_type"], "adapter_resource_ref.resource_type"),
        "external_id": _identifier(obj["external_id"], "adapter_resource_ref.external_id"),
    }


def validate_entity_ref(value):
    obj = _object(
        value,
        ("kind",),
        optional=(
            "project_id",
            "resource_id",
            "data_scope_id",
            "space_key",
            "space_ref",
            "reference",
            "client_family",
            "session_id",
            "skill_key",
            "source_scope",
            "service_ref",
            "owner_id",
            "service_id",
            "connection_ref",
            "adapter_lineage_id",
            "connection_id",
            "registry_id",
        ),
        where="entity_ref",
    )
    kind = _enum(obj["kind"], ENTITY_KINDS, "entity_ref.kind")
    expected = {
        "project": {"kind", "project_id"},
        "planning-space": {"kind", "resource_id"},
        "workflow": {"kind", "resource_id"},
        "work-item": {"kind", "resource_id"},
        "execution": {"kind", "resource_id"},
        "session": {"kind", "client_family", "session_id"},
        "skill": {"kind", "skill_key", "source_scope"},
        "memory-resource": {"kind", "resource_id"},
        "artifact": {"kind", "resource_id"},
        "improvement-case": {"kind", "resource_id"},
        "service": {"kind", "owner_id", "service_id"},
        "connection": {"kind", "service_ref", "adapter_lineage_id", "connection_id"},
        "registry": {"kind", "registry_id"},
    }[kind]
    actual = set(obj)
    # ``project_id`` is an optional key for project-scoped skills.  It is
    # nevertheless rejected for global skills and every other entity kind.
    if kind == "skill" and actual == expected | {"project_id"}:
        pass
    elif actual != expected:
        required_fields = sorted(expected - {"kind"})
        raise UnknownFieldError(f"entity_ref.{kind} requires exactly {required_fields}")
    if kind == "project":
        return {"kind": kind, "project_id": _project_id(obj["project_id"], "entity_ref.project_id")}
    if kind in {
        "planning-space",
        "workflow",
        "work-item",
        "execution",
        "memory-resource",
        "artifact",
        "improvement-case",
    }:
        return {
            "kind": kind,
            "resource_id": _text(obj["resource_id"], "entity_ref.resource_id", max_length=512),
        }
    if kind == "session":
        return {
            "kind": kind,
            **validate_session_ref(
                {"client_family": obj["client_family"], "session_id": obj["session_id"]}
            ),
        }
    if kind == "skill":
        skill = validate_skill_ref(
            {key: obj[key] for key in ("skill_key", "source_scope", "project_id") if key in obj}
        )
        return {"kind": kind, **skill}
    if kind == "service":
        service = validate_service_ref(
            {"owner_id": obj["owner_id"], "service_id": obj["service_id"]}
        )
        return {"kind": kind, **service}
    if kind == "connection":
        connection = validate_connection_ref(
            {
                "service_ref": obj["service_ref"],
                "adapter_lineage_id": obj["adapter_lineage_id"],
                "connection_id": obj["connection_id"],
            }
        )
        return {"kind": kind, **connection}
    return {"kind": kind, "registry_id": _identifier(obj["registry_id"], "entity_ref.registry_id")}
