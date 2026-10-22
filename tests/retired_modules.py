"""Frozen descriptors persisted before feature retirement; migration inputs only."""

FORMER_MODULES = {
    "sessions": {
        "interface_version": "valkama-modules",
        "module_id": "sessions",
        "version": "2.0.0",
        "title_key": "platform.modules.sessions",
        "icon_key": "activity",
        "navigation_group": "work",
        "route_namespace": "sessions",
        "state_schema": {
            "schema_id": "module.sessions.state",
            "allowed_keys": ["query", "view"],
            "max_bytes": 2048,
        },
        "operating_levels": ["global", "project"],
        "semantics": {
            "global": {
                "read_models": ["sessions.fleet", "sessions.attention", "sessions.unlinked"],
                "action_semantics": ["module.sessions.attach-orphan"],
            },
            "project": {
                "read_models": ["sessions.project-linked", "sessions.attention"],
                "action_semantics": ["module.sessions.open"],
            },
        },
        "secondary_context": {
            "global": {"kinds": ["execution", "session"], "behavior": "all"},
            "project": {"kinds": [], "behavior": "all"},
        },
        "required_read_models": ["sessions", "session-links"],
        "sse_subscriptions": ["sessions.changed"],
        "supported_entity_kinds": ["project", "execution", "session", "work-item"],
        "primary_actions": ["module.sessions.open"],
        "secondary_actions": ["module.sessions.attach-orphan"],
        "inspector_owner": "module.sessions",
        "feature_capabilities": ["session.observe"],
        "states": {
            "global": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
            "project": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
        },
    },
    "analytics": {
        "interface_version": "valkama-modules",
        "module_id": "analytics",
        "version": "2.0.0",
        "title_key": "platform.modules.analytics",
        "icon_key": "chart-no-axes-combined",
        "navigation_group": "understand",
        "route_namespace": "analytics",
        "state_schema": {
            "schema_id": "module.analytics.state",
            "allowed_keys": ["query", "metric", "date_from", "date_to"],
            "max_bytes": 2048,
        },
        "operating_levels": ["global", "project"],
        "semantics": {
            "global": {
                "read_models": ["analytics.portfolio", "analytics.compare"],
                "action_semantics": ["module.analytics.drill-down"],
            },
            "project": {
                "read_models": ["analytics.project", "analytics.sources"],
                "action_semantics": ["module.analytics.open-source"],
            },
        },
        "secondary_context": {
            "global": {"kinds": [], "behavior": "all"},
            "project": {"kinds": ["planning-space", "work-item", "artifact"], "behavior": "all"},
        },
        "required_read_models": ["analytics"],
        "sse_subscriptions": ["analytics.changed"],
        "supported_entity_kinds": [
            "project",
            "planning-space",
            "work-item",
            "execution",
            "session",
            "artifact",
        ],
        "primary_actions": ["module.analytics.open-source"],
        "secondary_actions": ["module.analytics.drill-down"],
        "inspector_owner": "module.analytics",
        "feature_capabilities": ["telemetry.query"],
        "states": {
            "global": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
            "project": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
        },
    },
    "improvements": {
        "interface_version": "valkama-modules",
        "module_id": "improvements",
        "version": "2.0.0",
        "title_key": "platform.modules.improvements",
        "icon_key": "sparkles",
        "navigation_group": "understand",
        "route_namespace": "improvements",
        "state_schema": {
            "schema_id": "module.improvements.state",
            "allowed_keys": ["query", "status"],
            "max_bytes": 2048,
        },
        "operating_levels": ["global", "project"],
        "semantics": {
            "global": {
                "read_models": ["improvements.cross-scope", "improvements.unassigned"],
                "action_semantics": ["module.improvements.open"],
            },
            "project": {"read_models": [], "action_semantics": []},
        },
        "secondary_context": {
            "global": {"kinds": ["work-item", "improvement-case"], "behavior": "all"},
            "project": {"kinds": [], "behavior": "unavailable"},
        },
        "required_read_models": ["improvements"],
        "sse_subscriptions": ["improvements.changed"],
        "supported_entity_kinds": ["project", "work-item", "improvement-case"],
        "primary_actions": [],
        "secondary_actions": ["module.improvements.open"],
        "inspector_owner": "module.improvements",
        "feature_capabilities": [],
        "states": {
            "global": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
            "project": {
                "supported": ["unavailable"],
                "unsupported_reason": "improvements_project_scope_unsupported",
            },
        },
    },
    "skills": {
        "interface_version": "valkama-modules",
        "module_id": "skills",
        "version": "2.0.0",
        "title_key": "platform.modules.skills",
        "icon_key": "key-round",
        "navigation_group": "capabilities",
        "route_namespace": "skills",
        "state_schema": {
            "schema_id": "module.skills.state",
            "allowed_keys": ["query", "status", "view"],
            "max_bytes": 2048,
        },
        "operating_levels": ["global", "project"],
        "semantics": {
            "global": {
                "read_models": ["skills.catalog", "skills.assignments"],
                "action_semantics": ["module.skills.assign"],
            },
            "project": {
                "read_models": ["skills.applicability", "skills.activation"],
                "action_semantics": ["module.skills.activate"],
            },
        },
        "secondary_context": {
            "global": {"kinds": ["skill"], "behavior": "all"},
            "project": {"kinds": ["skill"], "behavior": "all"},
        },
        "required_read_models": ["skills"],
        "sse_subscriptions": ["skills.changed"],
        "supported_entity_kinds": ["project", "skill", "registry"],
        "primary_actions": ["module.skills.activate"],
        "secondary_actions": ["module.skills.assign"],
        "inspector_owner": "module.skills",
        "feature_capabilities": ["skills.catalog", "skills.activate"],
        "states": {
            "global": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
            "project": {
                "supported": [
                    "loading",
                    "ready",
                    "empty",
                    "error",
                    "unavailable",
                    "permission-denied",
                    "degraded",
                ]
            },
        },
    },
}
