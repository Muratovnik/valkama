"""The modules this build ships, declared in code: the ``valkama-modules`` wire.

Planning, Memory and Settings are the product. Which of them exist is decided
here, by the build, and nowhere else: no store row records it and nothing turns
one off. The list used to be rows in `platform_modules` that the Kernel seeded
and Settings toggled; that table is still declared in `core` only so an
existing store opens unchanged, and no code reads or writes it.

`modules_payload` keeps the wire it replaced. Each module is a registration --
its manifest plus `state`, `mutable`, `revision` and `updated_at` -- because
the MCP tool `list_platform_modules` and the shell's `/api/modules` publish that
shape. The values are fixed now: every module is enabled, none can be changed,
and the registration was last changed when the list was.

The browser validates this answer at runtime; it does not carry a second
canonical manifest table.
"""

from __future__ import annotations

from copy import deepcopy

from .module_manifest import MODULES_INTERFACE, validate_module_manifest

_ALL_STATES = [
    "loading",
    "ready",
    "empty",
    "error",
    "unavailable",
    "permission-denied",
    "degraded",
]


def _module(
    module_id,
    navigation_group,
    title_key,
    icon_key,
    allowed_keys,
    read_global,
    read_project,
    action_global,
    action_project,
    required_read_models,
    sse_subscriptions,
    supported_entity_kinds,
    secondary_global_kinds,
    secondary_project_kinds,
    feature_capabilities,
    *,
    project_supported_states=None,
    project_unsupported_reason=None,
    project_secondary_behavior="all",
):
    project_state = {
        "supported": list(
            _ALL_STATES if project_supported_states is None else project_supported_states
        )
    }
    if project_unsupported_reason is not None:
        project_state["unsupported_reason"] = project_unsupported_reason
    return validate_module_manifest(
        {
            "interface_version": MODULES_INTERFACE,
            "module_id": module_id,
            "version": "2.0.0",
            "title_key": title_key,
            "icon_key": icon_key,
            "navigation_group": navigation_group,
            "route_namespace": module_id,
            "state_schema": {
                "schema_id": f"module.{module_id}.state",
                "allowed_keys": allowed_keys,
                "max_bytes": 2048,
            },
            "operating_levels": ["global", "project"],
            "semantics": {
                "global": {"read_models": read_global, "action_semantics": action_global},
                "project": {"read_models": read_project, "action_semantics": action_project},
            },
            "secondary_context": {
                "global": {"kinds": secondary_global_kinds, "behavior": "all"},
                "project": {
                    "kinds": secondary_project_kinds,
                    "behavior": project_secondary_behavior,
                },
            },
            "required_read_models": required_read_models,
            "sse_subscriptions": sse_subscriptions,
            "supported_entity_kinds": supported_entity_kinds,
            "primary_actions": action_project,
            "secondary_actions": action_global,
            "inspector_owner": f"module.{module_id}",
            "feature_capabilities": feature_capabilities,
            "states": {
                "global": {"supported": list(_ALL_STATES)},
                "project": project_state,
            },
        }
    )


_MODULES = (
    _module(
        "planning",
        "work",
        "platform.modules.planning",
        "layout-dashboard",
        ["query", "view", "status"],
        ["planning.spaces", "planning.work-items"],
        ["planning.project-spaces", "planning.work-items"],
        ["module.planning.create-work-item", "module.planning.open-work-item"],
        ["module.planning.create-work-item", "module.planning.open-work-item"],
        ["planning-spaces", "work-items"],
        ["planning.changed"],
        ["project", "planning-space", "workflow", "work-item"],
        ["project", "planning-space"],
        ["planning-space", "work-item"],
        [],
    ),
    _module(
        "memory",
        "capabilities",
        "platform.modules.memory",
        "book-open",
        ["query", "provider"],
        ["memory.providers", "memory.recent"],
        ["memory.search", "memory.linked"],
        ["module.memory.attach"],
        ["module.memory.open"],
        ["memory"],
        [],
        ["project", "memory-resource", "work-item"],
        ["memory-resource"],
        ["memory-resource", "work-item"],
        ["memory.open", "memory.health"],
    ),
    _module(
        "settings",
        "system",
        "platform.modules.settings",
        "settings-2",
        ["section", "query"],
        [],
        ["project.bindings"],
        ["module.settings.open-adapter"],
        ["module.settings.configure-project"],
        ["settings"],
        [],
        ["project"],
        [],
        [],
        ["settings.configure"],
    ),
)

#: When the module list above last changed. A registration is never changed at
#: runtime any more, so this is the one `updated_at` every registration reports;
#: move it with a change to the list or to a manifest.
DECLARED_AT = "2026-10-30T00:00:00Z"


def _registration(manifest: dict) -> dict:
    return {
        "manifest": deepcopy(manifest),
        "state": "enabled",
        "mutable": False,
        "revision": 1,
        "updated_at": DECLARED_AT,
    }


def modules_payload() -> dict:
    """Every module this build ships, as the registrations the wire carries.

    Ordered by module id, the order the rows this list replaced were read in.
    """

    return {
        "interface_version": MODULES_INTERFACE,
        "modules": [
            _registration(manifest)
            for manifest in sorted(_MODULES, key=lambda item: item["module_id"])
        ],
    }


def module_manifests() -> list[dict]:
    """A defensive copy of every manifest this build declares."""

    return deepcopy(list(_MODULES))


def module_ids() -> frozenset[str]:
    return frozenset(manifest["module_id"] for manifest in _MODULES)


__all__ = [
    "DECLARED_AT",
    "module_ids",
    "module_manifests",
    "modules_payload",
]
