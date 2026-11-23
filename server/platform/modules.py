"""The modules this build ships, declared in code: the ``valkama-modules`` wire.

Planning, Analytics, Agent decisions, Volumes, Memory and Settings are the product. Analytics is
where agent work's usage is read -- time, tokens, an API-price estimate, subscription quota.
Its read model `analytics.usage` is `GET /api/analytics/usage`; `analytics.quota`, each
account's quota windows now, is `GET /api/analytics/quota`; `analytics.uses`, how often
each of its surfaces was opened, is `GET /api/analytics/uses`, and the action
`module.analytics.report-use` counts one opening with `POST` there (`analytics.api`).
Which of them exist is decided here, by the build, and nowhere else: no store row
records it and nothing turns one off. The list used to be rows in `platform_modules` that the Kernel seeded
and Settings toggled; that table is still declared in `core` only so an
existing store opens unchanged, and no code reads or writes it.

Agent decisions is where the decisions agents took are read: the summary model
`planning.decisions`, served as `GET /api/planning/decisions`.

Volumes is where a person reads how much work stands in each state, what it took and
what is left: `planning.volumes`, served as `GET /api/planning/volumes`, for a scope and a
period. Planning reads what each goal or stage took through `planning.goal-volumes`,
`GET /api/planning/goal-volumes`, on its list and its card. Volumes reads the store's
states; it is none of the retired flow metrics.

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

from .module_manifest import MODULES_INTERFACE, OPERATING_LEVELS, validate_module_manifest

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
    read_space,
    action_global,
    action_space,
    required_read_models,
    sse_subscriptions,
    supported_entity_kinds,
    secondary_global_kinds,
    secondary_space_kinds,
    feature_capabilities,
    *,
    space_supported_states=None,
    space_unsupported_reason=None,
    space_secondary_behavior="all",
):
    space_state = {
        "supported": list(_ALL_STATES if space_supported_states is None else space_supported_states)
    }
    if space_unsupported_reason is not None:
        space_state["unsupported_reason"] = space_unsupported_reason
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
            "operating_levels": list(OPERATING_LEVELS),
            "semantics": {
                "global": {"read_models": read_global, "action_semantics": action_global},
                "space": {"read_models": read_space, "action_semantics": action_space},
            },
            "secondary_context": {
                "global": {"kinds": secondary_global_kinds, "behavior": "all"},
                "space": {"kinds": secondary_space_kinds, "behavior": space_secondary_behavior},
            },
            "required_read_models": required_read_models,
            "sse_subscriptions": sse_subscriptions,
            "supported_entity_kinds": supported_entity_kinds,
            "primary_actions": action_space,
            "secondary_actions": action_global,
            "inspector_owner": f"module.{module_id}",
            "feature_capabilities": feature_capabilities,
            "states": {
                "global": {"supported": list(_ALL_STATES)},
                "space": space_state,
            },
        }
    )


_MODULES = (
    _module(
        "planning",
        "work",
        "platform.modules.planning",
        "layout-dashboard",
        [
            "query",
            "view",
            "status",
            "chain",
            "chain_scope",
            "closed",
            "group",
            "branch",
            # The order of the views and its direction: web `viewSortRoute.ts`.
            "sort",
            "desc",
            # The Work filter beside the text in `query`: web `workFilter.ts`.
            "ready",
            "held",
            "asked",
            "triage",
            # «Closed in a period», by the keys the period pages write theirs with.
            "period",
            "from",
            "to",
            "elsewhere",
            "cat",
            "kind",
            "pri",
            "labels",
            "holder",
            "proj",
            "goal",
        ],
        ["planning.spaces", "planning.work-items", "planning.goal-volumes"],
        ["planning.space", "planning.work-items", "planning.goal-volumes"],
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
        "analytics",
        "understand",
        "platform.modules.analytics",
        "chart-no-axes-combined",
        # The page's view: web `shared/api/analyticsAddress.ts`.
        ["period", "from", "to", "by", "measure", "filters", "open", "across", "detail"],
        ["analytics.usage", "analytics.quota", "analytics.uses"],
        ["analytics.usage", "analytics.quota", "analytics.uses"],
        ["module.analytics.report-use"],
        ["module.analytics.report-use"],
        ["usage"],
        [],
        # A task's card opens over the page and the address names it, so Back closes it.
        ["project", "work-item"],
        ["work-item"],
        ["work-item"],
        [],
    ),
    _module(
        "decisions",
        "understand",
        "platform.modules.decisions",
        "agent",
        ["point", "period", "from", "to", "open"],
        ["planning.decisions"],
        ["planning.decisions"],
        [],
        [],
        ["decisions"],
        [],
        # As Analytics: a task's card opens over the summary and the address names it.
        ["project", "work-item"],
        ["work-item"],
        ["work-item"],
        [],
    ),
    _module(
        "volumes",
        "understand",
        "platform.modules.volumes",
        "layers",
        # The period, the filter of tasks by kind and label, and the rows of the tree
        # that stand open.
        ["period", "from", "to", "kind", "label", "open"],
        ["planning.volumes"],
        ["planning.volumes"],
        # A commit with no item, attached from the list the page counts.
        ["module.volumes.attach-commit"],
        ["module.volumes.attach-commit"],
        ["volumes"],
        [],
        # As Analytics: a task's card opens over the page and the address names it.
        ["project", "work-item"],
        ["work-item"],
        ["work-item"],
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
        ["space.projects"],
        ["module.settings.open-adapter"],
        ["module.settings.configure-space"],
        ["settings"],
        [],
        # A task's card opens over the section and the address names it, so Back closes it.
        ["project", "work-item"],
        ["work-item"],
        ["work-item"],
        ["settings.configure"],
    ),
)

#: When the module list above last changed. A registration is never changed at
#: runtime any more, so this is the one `updated_at` every registration reports;
#: move it with a change to the list or to a manifest.
DECLARED_AT = "2026-11-20T15:00:00Z"


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
