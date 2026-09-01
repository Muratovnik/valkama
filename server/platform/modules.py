"""Canonical built-in ``valkama-modules`` registry.

This is the server wire owner. The browser validates this registry at runtime;
it does not carry a second canonical manifest table.
"""

from __future__ import annotations

import contextlib
import logging
import os
import threading
from collections.abc import Callable
from copy import deepcopy

from .contracts import MODULES_INTERFACE, validate_module_manifest

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
        "sessions",
        "work",
        "platform.modules.sessions",
        "activity",
        ["query", "view"],
        ["sessions.fleet", "sessions.attention", "sessions.unlinked"],
        ["sessions.project-linked", "sessions.attention"],
        ["module.sessions.attach-orphan"],
        ["module.sessions.open"],
        ["sessions", "session-links"],
        ["sessions.changed"],
        ["project", "execution", "session", "work-item"],
        ["execution", "session"],
        [],
        ["session.observe"],
    ),
    _module(
        "analytics",
        "understand",
        "platform.modules.analytics",
        "chart-no-axes-combined",
        ["query", "metric", "date_from", "date_to"],
        ["analytics.portfolio", "analytics.compare"],
        ["analytics.project", "analytics.sources"],
        ["module.analytics.drill-down"],
        ["module.analytics.open-source"],
        ["analytics"],
        ["analytics.changed"],
        ["project", "planning-space", "work-item", "execution", "session", "artifact"],
        [],
        ["planning-space", "work-item", "artifact"],
        ["telemetry.query"],
    ),
    _module(
        "improvements",
        "understand",
        "platform.modules.improvements",
        "sparkles",
        ["query", "status"],
        ["improvements.cross-scope", "improvements.unassigned"],
        [],
        ["module.improvements.open"],
        [],
        ["improvements"],
        ["improvements.changed"],
        ["project", "work-item", "improvement-case"],
        ["work-item", "improvement-case"],
        [],
        [],
        project_supported_states=["unavailable"],
        project_unsupported_reason="improvements_project_scope_unsupported",
        project_secondary_behavior="unavailable",
    ),
    _module(
        "skills",
        "capabilities",
        "platform.modules.skills",
        "key-round",
        ["query", "status", "view"],
        ["skills.catalog", "skills.assignments"],
        ["skills.applicability", "skills.activation"],
        ["module.skills.assign"],
        ["module.skills.activate"],
        ["skills"],
        ["skills.changed"],
        ["project", "skill", "registry"],
        ["skill"],
        ["skill"],
        ["skills.catalog", "skills.activate"],
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
        [
            "registry.modules",
            "registry.adapters",
            "registry.services",
            "registry.connections",
            "registry.grants",
        ],
        [
            "project.assignments",
            "project.connections",
            "project.grants",
            "project.bindings",
        ],
        ["module.settings.open-adapter"],
        ["module.settings.configure-project"],
        ["registry", "settings"],
        ["registry.changed"],
        ["project", "service", "connection", "registry"],
        ["connection", "registry"],
        ["connection", "registry"],
        ["settings.configure"],
    ),
)

_STATE_OBSERVERS: list[Callable[[str, str, str], None]] = []
_STATE_FENCES: dict[tuple[str, str], threading.RLock] = {}
_STATE_FENCES_LOCK = threading.Lock()
_LOGGER = logging.getLogger(__name__)


@contextlib.contextmanager
def module_state_fence(primary_db: str, module_id: str):
    """Serialize one module's state transition with its final work admission."""

    key = (os.path.abspath(primary_db), module_id)
    with _STATE_FENCES_LOCK:
        fence = _STATE_FENCES.setdefault(key, threading.RLock())
    with fence:
        yield


def register_state_observer(observer: Callable[[str, str, str], None]) -> None:
    if observer not in _STATE_OBSERVERS:
        _STATE_OBSERVERS.append(observer)


def notify_state_changed(primary_db: str, module_id: str, state: str) -> tuple[str, ...]:
    diagnostics = []
    for observer in tuple(_STATE_OBSERVERS):
        try:
            observer(primary_db, module_id, state)
        except Exception as error:
            diagnostic = f"{type(error).__name__}: {error}"
            diagnostics.append(diagnostic)
            _LOGGER.exception(
                "module state observer failed after commit",
                extra={"module_id": module_id, "state": state},
            )
    return tuple(diagnostics)


def modules_payload() -> dict:
    """Return a defensive copy of the sole built-in module registry."""

    return {
        "interface_version": MODULES_INTERFACE,
        "modules": deepcopy(list(_MODULES)),
    }


def module_manifests() -> list[dict]:
    return modules_payload()["modules"]


def module_ids() -> frozenset[str]:
    return frozenset(manifest["module_id"] for manifest in _MODULES)


__all__ = [
    "module_ids",
    "module_manifests",
    "module_state_fence",
    "modules_payload",
    "notify_state_changed",
    "register_state_observer",
]
