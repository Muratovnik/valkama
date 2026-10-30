"""The module manifest: what a module declares about itself, held strictly."""

import unittest

from server.platform.module_manifest import validate_module_manifest
from server.store_identity.primitives import ContractError, UnknownFieldError

#: Every module id a manifest may carry, retired ones included: a persisted row
#: may still name one.
MODULE_IDS = (
    "planning",
    "sessions",
    "analytics",
    "improvements",
    "skills",
    "memory",
    "settings",
)


class ModuleManifestTests(unittest.TestCase):
    def test_module_manifest_shape_is_strict(self):
        module = {
            "interface_version": "valkama-modules",
            "module_id": "planning",
            "version": "2.0.0",
            "title_key": "platform.modules.planning",
            "icon_key": "layout-dashboard",
            "navigation_group": "work",
            "route_namespace": "planning",
            "state_schema": {
                "schema_id": "module.planning.state",
                "allowed_keys": ["query"],
                "max_bytes": 2048,
            },
            "operating_levels": ["global", "project"],
            "semantics": {
                "global": {
                    "read_models": ["planning.work-items"],
                    "action_semantics": ["module.planning.open-work-item"],
                },
                "project": {
                    "read_models": ["planning.work-items"],
                    "action_semantics": ["module.planning.open-work-item"],
                },
            },
            "secondary_context": {
                "global": {"kinds": ["project", "planning-space"], "behavior": "all"},
                "project": {"kinds": ["planning-space", "work-item"], "behavior": "all"},
            },
            "required_read_models": ["work-items"],
            "sse_subscriptions": ["planning.changed"],
            "supported_entity_kinds": ["project", "planning-space", "work-item"],
            "primary_actions": ["module.planning.open-work-item"],
            "secondary_actions": ["module.planning.create-work-item"],
            "inspector_owner": "module.planning",
            "feature_capabilities": [],
            "states": {
                "global": {"supported": ["loading", "ready", "empty"]},
                "project": {"supported": ["loading", "ready", "empty"]},
            },
        }
        self.assertEqual("planning", validate_module_manifest(module)["module_id"])
        for module_id in MODULE_IDS:
            with self.subTest(contract="module_manifest_id", value=module_id):
                candidate = {
                    **module,
                    "module_id": module_id,
                    "route_namespace": module_id,
                    "title_key": f"platform.modules.{module_id}",
                    "state_schema": {
                        **module["state_schema"],
                        "schema_id": f"module.{module_id}.state",
                    },
                    "inspector_owner": f"module.{module_id}",
                }
                self.assertEqual(module_id, validate_module_manifest(candidate)["module_id"])
        manifest_action_192 = f"core.{'a' * 63}.{'b' * 63}.{'c' * 59}"
        manifest_action_193 = f"core.{'a' * 63}.{'b' * 63}.{'c' * 60}"
        self.assertEqual(192, len(manifest_action_192))
        self.assertEqual(
            manifest_action_192,
            validate_module_manifest({**module, "primary_actions": [manifest_action_192]})[
                "primary_actions"
            ][0],
        )
        with self.assertRaises(ContractError):
            validate_module_manifest({**module, "primary_actions": [manifest_action_193]})
        self.assertEqual(
            "future-module",
            validate_module_manifest(
                {**module, "module_id": "future-module", "route_namespace": "future-module"}
            )["module_id"],
        )
        with self.assertRaises(ContractError):
            validate_module_manifest({**module, "version": "2"})
        with self.assertRaises(UnknownFieldError):
            validate_module_manifest({**module, "legacy": True})


if __name__ == "__main__":
    unittest.main()
