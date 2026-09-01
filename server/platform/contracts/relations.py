"""Relation rows, their provenance, and the project bindings behind them.

A relation carries a pointer with lineage and resolution state rather than a
copy of the provider's data, and a project binding is what a Project-scoped
action must prove before it acts. Presentation travels with the row because a
client may not invent one for an adapter it does not know.
"""

from __future__ import annotations

from .authorization import validate_action_ref
from .primitives import (
    OPERATING_SCOPE_INTERFACE,
    RELATION_STATES,
    RELATIONS_INTERFACE,
    ContractError,
    InvalidDiscriminantError,
    _enum,
    _identifier,
    _list,
    _nonempty_text,
    _object,
    _positive_revision,
    _project_id,
    _provider_version,
    _reject_unsafe_tree,
    _relation_kind,
    _sha256,
    _utc_timestamp,
)
from .refs import (
    validate_adapter_resource_ref,
    validate_entity_ref,
    validate_service_ref,
)


def validate_provenance(value):
    obj = _object(value, ("source_kind", "observed_at"), optional=("author",), where="provenance")
    result = {
        "source_kind": _identifier(obj["source_kind"], "provenance.source_kind"),
        "observed_at": _utc_timestamp(obj["observed_at"], "provenance.observed_at"),
    }
    if "author" in obj:
        result["author"] = _identifier(obj["author"], "provenance.author")
    return result


def validate_presentation(value):
    obj = _object(value, ("label",), optional=("secondary_text", "icon_key"), where="presentation")
    result = {"label": _nonempty_text(obj["label"], "presentation.label", max_length=160)}
    if "secondary_text" in obj:
        result["secondary_text"] = _nonempty_text(
            obj["secondary_text"], "presentation.secondary_text", max_length=240
        )
    if "icon_key" in obj:
        result["icon_key"] = _identifier(obj["icon_key"], "presentation.icon_key")
    return result


def validate_relation(value):
    obj = _object(
        value,
        (
            "interface_version",
            "relation_id",
            "source",
            "kind",
            "target",
            "provider",
            "state",
            "provenance",
            "presentation",
            "actions",
        ),
        where="platform_relation",
    )
    _reject_unsafe_tree(obj, "platform_relation")
    if obj["interface_version"] != RELATIONS_INTERFACE:
        raise InvalidDiscriminantError(
            f"platform_relation.interface_version must be {RELATIONS_INTERFACE}"
        )
    provider = obj["provider"]
    provider_obj = _object(
        provider,
        (
            "service_ref",
            "adapter_id",
            "adapter_lineage_id",
            "adapter_version",
            "connection_id",
        ),
        where="platform_relation.provider",
    )
    provider = {
        "service_ref": validate_service_ref(provider_obj["service_ref"]),
        "adapter_id": _identifier(
            provider_obj["adapter_id"], "platform_relation.provider.adapter_id"
        ),
        "adapter_lineage_id": _identifier(
            provider_obj["adapter_lineage_id"], "platform_relation.provider.adapter_lineage_id"
        ),
        "adapter_version": _provider_version(
            provider_obj["adapter_version"], "platform_relation.provider.adapter_version"
        ),
        "connection_id": _identifier(
            provider_obj["connection_id"], "platform_relation.provider.connection_id"
        ),
    }
    target = obj["target"]
    try:
        target = validate_entity_ref(target)
    except ContractError:
        target = validate_adapter_resource_ref(target)
    return {
        "interface_version": RELATIONS_INTERFACE,
        "relation_id": _identifier(obj["relation_id"], "platform_relation.relation_id"),
        "source": validate_entity_ref(obj["source"]),
        "kind": _relation_kind(obj["kind"], "platform_relation.kind"),
        "target": target,
        "provider": provider,
        "state": _enum(obj["state"], RELATION_STATES, "platform_relation.state"),
        "provenance": validate_provenance(obj["provenance"]),
        "presentation": validate_presentation(obj["presentation"]),
        "actions": _list(
            obj["actions"],
            "platform_relation.actions",
            item=lambda item, _where: validate_action_ref(item),
            max_items=32,
        ),
    }


def validate_project_resource_binding(value):
    obj = _object(
        value,
        (
            "project_id",
            "resource_ref",
            "registry_revision",
            "source_owner",
            "source_hash",
        ),
        where="project_resource_binding",
    )
    resource = validate_entity_ref(obj["resource_ref"])
    if set(resource) != {"kind", "resource_id"}:
        raise ContractError("project_resource_binding.resource_ref requires kind and resource_id")
    return {
        "project_id": _project_id(obj["project_id"], "project_resource_binding.project_id"),
        "resource_ref": resource,
        "registry_revision": _positive_revision(
            obj["registry_revision"], "project_resource_binding.registry_revision"
        ),
        "source_owner": _identifier(obj["source_owner"], "project_resource_binding.source_owner"),
        "source_hash": _sha256(obj["source_hash"], "project_resource_binding.source_hash"),
    }


def validate_project_registry_projection(value):
    obj = _object(
        value,
        ("interface_version", "project_id", "source_hash", "bindings"),
        where="project_registry_projection",
    )
    if obj["interface_version"] != OPERATING_SCOPE_INTERFACE:
        raise InvalidDiscriminantError(
            f"project_registry_projection.interface_version must be {OPERATING_SCOPE_INTERFACE}"
        )
    project_id = _project_id(obj["project_id"], "project_registry_projection.project_id")
    source_hash = _sha256(obj["source_hash"], "project_registry_projection.source_hash")
    bindings = _list(
        obj["bindings"],
        "project_registry_projection.bindings",
        item=lambda item, _where: validate_project_resource_binding(item),
    )
    resource_refs = set()
    for binding in bindings:
        if binding["project_id"] != project_id:
            raise ContractError("binding project_id must match its registry projection")
        if binding["source_hash"] != source_hash:
            raise ContractError("binding source_hash must match its registry projection")
        resource_key = (binding["resource_ref"]["kind"], binding["resource_ref"]["resource_id"])
        if resource_key in resource_refs:
            raise ContractError("project registry projection contains a duplicate resource_ref")
        resource_refs.add(resource_key)
    return {
        "interface_version": OPERATING_SCOPE_INTERFACE,
        "project_id": project_id,
        "source_hash": source_hash,
        "bindings": bindings,
    }
