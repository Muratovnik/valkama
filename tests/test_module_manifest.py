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
            "operating_levels": ["global", "space"],
            "semantics": {
                "global": {
                    "read_models": ["planning.work-items"],
                    "action_semantics": ["module.planning.open-work-item"],
                },
                "space": {
                    "read_models": ["planning.work-items"],
                    "action_semantics": ["module.planning.open-work-item"],
                },
            },
            "secondary_context": {
                "global": {"kinds": ["project", "planning-space"], "behavior": "all"},
                "space": {"kinds": ["planning-space", "work-item"], "behavior": "all"},
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
                "space": {"supported": ["loading", "ready", "empty"]},
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

    def test_a_module_works_globally_or_in_a_space_and_a_former_manifest_reads_as_written(self):
        """The levels are `global` and `space`; a migration still reads a `project` one."""

        def at(level: str) -> dict:
            return {
                "interface_version": "valkama-modules",
                "module_id": "planning",
                "version": "2.0.0",
                "title_key": "platform.modules.planning",
                "icon_key": "layout-dashboard",
                "navigation_group": "work",
                "route_namespace": "planning",
                "state_schema": {"schema_id": "s", "allowed_keys": [], "max_bytes": 2048},
                "operating_levels": ["global", level],
                "semantics": {
                    name: {"read_models": [], "action_semantics": []} for name in ("global", level)
                },
                "secondary_context": {
                    name: {"kinds": [], "behavior": "all"} for name in ("global", level)
                },
                "required_read_models": [],
                "sse_subscriptions": [],
                "supported_entity_kinds": [],
                "primary_actions": [],
                "secondary_actions": [],
                "inspector_owner": "module.planning",
                "feature_capabilities": [],
                "states": {name: {"supported": ["ready"]} for name in ("global", level)},
            }

        self.assertEqual(
            ["global", "space"], validate_module_manifest(at("space"))["operating_levels"]
        )
        with self.assertRaises(ContractError):
            validate_module_manifest(at("project"))
        former = validate_module_manifest(at("project"), levels=("global", "project"))
        self.assertEqual(["global", "project"], former["operating_levels"])
        self.assertEqual({"global", "project"}, set(former["semantics"]))


if __name__ == "__main__":
    unittest.main()
