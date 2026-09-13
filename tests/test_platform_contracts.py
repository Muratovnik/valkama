import unittest

from server.platform import modules as platform_modules
from server.platform.contracts import (
    ADAPTER_INTERFACE,
    PLATFORM_MODULE_IDS,
    ContractError,
    InvalidDiscriminantError,
    UnknownFieldError,
    UnsafePayloadError,
    validate_action_input_descriptor,
    validate_action_ref,
    validate_adapter_manifest,
    validate_adapter_resource_ref,
    validate_contribution,
    validate_entity_ref,
    validate_invocation_context,
    validate_module_manifest,
    validate_open_target,
    validate_operating_scope,
    validate_planning_space_ref,
    validate_project_ref,
    validate_project_registry_projection,
    validate_relation,
    validate_semver,
    validate_work_item_ref,
)

UUID = "abcdefab-cdef-4abc-8def-abcdefabcdef"
UUID_2 = "22222222-2222-4222-8222-222222222222"

GOLDEN_CONTRACT_VECTORS = {
    "project": {
        "accept": ["a", "project-1", "a" + "b" * 159],
        "reject": ["", "Project", "1project", "project_name", "a" + "b" * 160],
    },
    "semver": {
        "accept": [
            "0.0.0",
            "1.2.3",
            "1.0.0-alpha",
            "1.0.0-alpha.1+build.5",
            "10.20.30-rc.1+sha-abc",
        ],
        "reject": ["1", "1.2", "01.2.3", "1.02.3", "1.2.03", "1.0.0-01", "1.0.0-", "1.0.0+"],
    },
    "action_owner": {
        "accept": ["a", "lineage-1", "a" * 128],
        "reject": ["", "-lineage", "a" * 129],
    },
    "uuid": {
        "accept": [
            "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
            "abcdefab-cdef-4abc-8def-abcdefabcdef",
            "6ba7b811-9dad-51d1-80b4-00c04fd430c8",
        ],
        "reject": [
            "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
            "abcdefab-cdef-0abc-8def-abcdefabcdef",
            "abcdefab-cdef-6abc-8def-abcdefabcdef",
            "abcdefab-cdef-4abc-7def-abcdefabcdef",
            "not-a-uuid",
        ],
    },
    "module_id": {
        # Seven, in the order the browser's copy of this list declares them.
        # `memory` was the seventh module and reached the registry, the page and
        # the web contract without reaching the server's closed set, so the
        # action its own manifest names — `module.memory.attach` — was refused
        # by the contract that publishes it. This vector is what pinned the
        # drift in place, so it moves deliberately rather than being widened.
        "accept": [
            "planning",
            "sessions",
            "analytics",
            "improvements",
            "skills",
            "memory",
            "settings",
        ],
        "reject": ["", "notes", "Planning", "planning-v2"],
    },
}


def service_ref():
    return {"owner_id": "owner", "service_id": "memory"}


def connection_ref(lineage="adapter-lineage", connection_id="singleton"):
    return {
        "service_ref": service_ref(),
        "adapter_lineage_id": lineage,
        "connection_id": connection_id,
    }


def work_item_ref(scope=UUID, key="MAIN", number=1):
    return {
        "space_ref": {"data_scope_id": scope, "space_key": key},
        "reference": f"{key}-{number}",
    }


def action(
    action_id="adapter.adapter-lineage.open", owner_kind="adapter", owner_id="adapter-lineage"
):
    return {
        "interface_version": "valkama-actions",
        "action_id": action_id,
        "owner_kind": owner_kind,
        "owner_id": owner_id,
        "input_schema_id": "input-v1",
        "target_kind": "work-item",
        "invocation_scope_schema": "either",
    }


class ContractTests(unittest.TestCase):
    def test_shared_golden_identity_and_version_vectors(self):
        for value in GOLDEN_CONTRACT_VECTORS["project"]["accept"]:
            with self.subTest(contract="project", value=value):
                self.assertEqual(value, validate_project_ref({"project_id": value})["project_id"])
        for value in GOLDEN_CONTRACT_VECTORS["project"]["reject"]:
            with self.subTest(contract="project", value=value), self.assertRaises(ContractError):
                validate_project_ref({"project_id": value})
        for value in GOLDEN_CONTRACT_VECTORS["semver"]["accept"]:
            with self.subTest(contract="semver", value=value):
                self.assertEqual(value, validate_semver(value))
        for value in GOLDEN_CONTRACT_VECTORS["semver"]["reject"]:
            with self.subTest(contract="semver", value=value), self.assertRaises(ContractError):
                validate_semver(value)
        for value in GOLDEN_CONTRACT_VECTORS["action_owner"]["accept"]:
            with self.subTest(contract="action_owner", value=value):
                candidate = action(f"adapter.{value}.open", "adapter", value)
                self.assertEqual(value, validate_action_ref(candidate)["owner_id"])
        for value in GOLDEN_CONTRACT_VECTORS["action_owner"]["reject"]:
            with (
                self.subTest(contract="action_owner", value=value),
                self.assertRaises(ContractError),
            ):
                validate_action_ref(action(f"adapter.{value}.open", "adapter", value))
        for value in GOLDEN_CONTRACT_VECTORS["uuid"]["accept"]:
            with self.subTest(contract="uuid", value=value):
                self.assertEqual(
                    value,
                    validate_planning_space_ref({"data_scope_id": value, "space_key": "MAIN"})[
                        "data_scope_id"
                    ],
                )
        for value in GOLDEN_CONTRACT_VECTORS["uuid"]["reject"]:
            with self.subTest(contract="uuid", value=value), self.assertRaises(ContractError):
                validate_planning_space_ref({"data_scope_id": value, "space_key": "MAIN"})

        self.assertEqual(tuple(GOLDEN_CONTRACT_VECTORS["module_id"]["accept"]), PLATFORM_MODULE_IDS)
        for value in GOLDEN_CONTRACT_VECTORS["module_id"]["accept"]:
            with self.subTest(contract="module_action_owner", value=value):
                candidate = action(f"module.{value}.open", "module", value)
                self.assertEqual(value, validate_action_ref(candidate)["owner_id"])
        for value in GOLDEN_CONTRACT_VECTORS["module_id"]["reject"]:
            with (
                self.subTest(contract="module_action_owner", value=value),
                self.assertRaises(ContractError),
            ):
                validate_action_ref(action(f"module.{value}.open", "module", value))

    def test_action_ref_total_length_has_exact_shared_boundary(self):
        action_name_192 = ".".join(("a" * 60, "b" * 60, "c" * 60))
        action_name_193 = ".".join(("a" * 60, "b" * 60, "c" * 61))
        accepted = f"adapter.a.{action_name_192}"
        rejected = f"adapter.a.{action_name_193}"
        self.assertEqual(192, len(accepted))
        self.assertEqual(193, len(rejected))
        self.assertEqual(
            accepted, validate_action_ref(action(accepted, "adapter", "a"))["action_id"]
        )
        with self.assertRaises(ContractError):
            validate_action_ref(action(rejected, "adapter", "a"))

    def test_project_registry_projection_is_exact_shared_standalone_wire(self):
        binding = {
            "project_id": "project-a",
            "resource_ref": {
                "kind": "planning-space",
                "resource_id": "eyJib2FyZF9uYW1lIjoibWFpbiIsImRhdGFfc2NvcGVfaWQiOiIxMjNlNDU2Ny1lODliLTQyZDMtYTQ1Ni00MjY2MTQxNzQwMDAifQ",
            },
            "registry_revision": 7,
            "source_owner": "workspace",
            "source_hash": "a" * 64,
        }
        envelope = {
            "interface_version": "project-resource-binding",
            "project_id": "project-a",
            "source_hash": "a" * 64,
            "bindings": [binding],
        }
        self.assertEqual(envelope, validate_project_registry_projection(envelope))
        self.assertEqual(
            [],
            validate_project_registry_projection({**envelope, "bindings": []})["bindings"],
        )
        with self.assertRaises(UnknownFieldError):
            validate_project_registry_projection({**envelope, "registry_revision": 7})
        with self.assertRaises(UnknownFieldError):
            validate_project_registry_projection({**envelope, "source_owner": "workspace"})
        with self.assertRaises(ContractError):
            validate_project_registry_projection(
                {**envelope, "bindings": [{**binding, "project_id": "project-b"}]}
            )
        with self.assertRaises(ContractError):
            validate_project_registry_projection(
                {**envelope, "bindings": [{**binding, "source_hash": "b" * 64}]}
            )

        allowed = {
            "planning-space",
            "workflow",
            "work-item",
            "execution",
            "memory-resource",
            "artifact",
            "improvement-case",
        }
        for kind in allowed:
            candidate = {
                **binding,
                "resource_ref": {"kind": kind, "resource_id": "resource-1"},
            }
            with self.subTest(kind=kind):
                self.assertEqual(
                    kind,
                    validate_project_registry_projection({**envelope, "bindings": [candidate]})[
                        "bindings"
                    ][0]["resource_ref"]["kind"],
                )
        for kind in {"project", "session", "skill", "service", "connection", "registry"}:
            candidate = {
                **binding,
                "resource_ref": {"kind": kind, "resource_id": "resource-1"},
            }
            with self.subTest(kind=kind):
                with self.assertRaises(ContractError):
                    validate_project_registry_projection({**envelope, "bindings": [candidate]})

    def test_operating_scope_is_exact_discriminated_wire(self):
        self.assertEqual({"kind": "global"}, validate_operating_scope({"kind": "global"}))
        self.assertEqual(
            {"kind": "project", "project_ref": {"project_id": "project-a"}},
            validate_operating_scope(
                {"kind": "project", "project_ref": {"project_id": "project-a"}}
            ),
        )
        with self.assertRaises(UnknownFieldError):
            validate_operating_scope({"kind": "global", "project_ref": {"project_id": "project-a"}})
        with self.assertRaises(UnknownFieldError):
            validate_operating_scope(
                {"kind": "project", "project_ref": {"project_id": "project-a", "alias": "a"}}
            )

    def test_entity_discriminants_and_ref_shapes_are_strict(self):
        self.assertEqual(
            "work-item",
            validate_entity_ref({"kind": "work-item", "resource_id": "planning-card-1"})["kind"],
        )
        self.assertEqual(
            "service", validate_entity_ref({"kind": "service", **service_ref()})["kind"]
        )
        with self.assertRaises(UnknownFieldError):
            validate_entity_ref(
                {"kind": "work-item", "resource_id": "planning-card-1", "project_id": "project-a"}
            )
        with self.assertRaises(ContractError):
            validate_planning_space_ref({"data_scope_id": UUID.upper(), "space_key": "MAIN"})
        # A key is uppercase, two to eight characters, and carries no
        # separator: the reference splits on the hyphen, so a key holding one
        # would make `QA-1-2` two readings of the same text.
        for space_key in ("main", "M", "MAIN-2", "TOOLONGKEY", "MA IN", " MAIN"):
            with self.subTest(space_key=space_key), self.assertRaises(ContractError):
                validate_planning_space_ref({"data_scope_id": UUID, "space_key": space_key})
        with self.assertRaises(ContractError):
            validate_work_item_ref({"space_ref": work_item_ref()["space_ref"], "reference": "X-0"})
        with self.assertRaises(ContractError):
            # The reference must belong to the space it is paired with.
            validate_work_item_ref(
                {"space_ref": work_item_ref()["space_ref"], "reference": "OTH-1"}
            )

    def test_adapter_resource_has_exact_connection_identity(self):
        resource = validate_adapter_resource_ref(
            {
                "connection_ref": connection_ref(),
                "resource_type": "record",
                "external_id": "record-1",
            }
        )
        self.assertEqual("record-1", resource["external_id"])
        with self.assertRaises(UnknownFieldError):
            validate_adapter_resource_ref(
                {
                    "connection_ref": connection_ref(),
                    "resource_type": "record",
                    "external_id": "record-1",
                    "path": "/tmp",
                }
            )

    def test_manifest_unknown_and_malformed_fields_fail_closed(self):
        manifest = {
            "contract_version": ADAPTER_INTERFACE,
            "adapter_id": "memory-reference",
            "version": "1.0.0",
            "title_key": "adapter.memory",
            "package_id": "pkg-memory",
            "publisher_id": "publisher",
            "owner_id": "owner",
            "configuration_owner": "provider",
            "trust_owner": "provider",
            "execution": "local_service",
            "supported_service_types": ["knowledge"],
            "capabilities": ["memory.open", "memory.health"],
            "consumes": ["work-item"],
            "contributions": [
                {
                    "interface_version": "valkama-contributions",
                    "contribution_id": "memory-relation",
                    "owner_kind": "adapter",
                    "owner_id": "memory-reference",
                    "slot": "entity-relation-resolver",
                    "entity_kinds": ["work-item"],
                    "content": {"kind": "text", "text": "pointer"},
                    "actions": [],
                }
            ],
            "permissions": [
                {
                    "permission_id": "memory.open",
                    "connection_mode": "required",
                    "entity_kinds": ["work-item"],
                }
            ],
            "health_contract": {"timeout_ms": 5000, "max_payload_bytes": 10000},
            "direct_read": False,
        }
        self.assertEqual("memory-reference", validate_adapter_manifest(manifest)["adapter_id"])
        with self.assertRaises(UnknownFieldError):
            validate_adapter_manifest({**manifest, "secret": "never"})
        with self.assertRaises(UnsafePayloadError):
            validate_adapter_manifest({**manifest, "title_key": "<script>"})
        with self.assertRaises(UnknownFieldError):
            validate_adapter_manifest({**manifest, "adapter_lineage_id": "self-authored"})

    def test_action_namespaces_bind_to_exact_owner(self):
        self.assertEqual(
            "core.work-item.open",
            validate_action_ref({**action("core.work-item.open", "kernel", "kernel")})["action_id"],
        )
        self.assertEqual(
            "module.planning.work-item.open",
            validate_action_ref(action("module.planning.work-item.open", "module", "planning"))[
                "action_id"
            ],
        )
        self.assertEqual(
            "adapter.adapter-lineage.memory.open",
            validate_action_ref(action("adapter.adapter-lineage.memory.open"))["action_id"],
        )
        with self.assertRaises(ContractError):
            validate_action_ref(action("adapter.other.open", "adapter", "adapter-lineage"))

    def test_action_input_semantics_are_declarative_and_strict(self):
        descriptor = {
            "action_id": "adapter.adapter-lineage.resource.open",
            "operation": "open",
            "resource_types": ["memory"],
            "fields": [
                {
                    "key": "external_id",
                    "kind": "stable-id",
                    "required": True,
                    "max_length": 128,
                }
            ],
            "confirmation": "required",
            "title_key": "platform.actions.resource.open",
        }
        self.assertEqual("open", validate_action_input_descriptor(descriptor)["operation"])
        with self.assertRaises(InvalidDiscriminantError):
            validate_action_input_descriptor({**descriptor, "operation": "execute"})
        with self.assertRaises(UnknownFieldError):
            validate_action_input_descriptor({**descriptor, "provider": "agentmemory"})
        with self.assertRaises(ContractError):
            validate_action_input_descriptor(
                {
                    **descriptor,
                    "fields": [
                        {
                            "key": "external_id",
                            "kind": "stable-id",
                            "required": True,
                            "max_length": 0,
                        }
                    ],
                }
            )

    def test_invocation_scope_and_target_are_typed(self):
        context = validate_invocation_context(
            {
                "view_scope": {"kind": "global"},
                "invocation_scope": {"kind": "project", "project_ref": {"project_id": "project-a"}},
                "target": {"kind": "work-item", "resource_id": "planning-card-1"},
            }
        )
        self.assertEqual("global", context["view_scope"]["kind"])
        self.assertEqual("project", context["invocation_scope"]["kind"])

    def test_relation_states_and_unsafe_payloads(self):
        relation = {
            "interface_version": "valkama-relations",
            "relation_id": "relation-1",
            "source": {"kind": "work-item", "resource_id": "planning-card-1"},
            "kind": "external-resource",
            "target": {
                "connection_ref": connection_ref(),
                "resource_type": "record",
                "external_id": "record-1",
            },
            "provider": {
                "service_ref": service_ref(),
                "adapter_id": "memory-reference",
                "adapter_lineage_id": "adapter-lineage",
                "adapter_version": "1.0.0",
                "connection_id": "singleton",
            },
            "state": "unavailable",
            "provenance": {"source_kind": "test", "observed_at": "2026-08-13T00:00:00Z"},
            "presentation": {"label": "Record"},
            "actions": [],
        }
        self.assertEqual("unavailable", validate_relation(relation)["state"])
        with self.assertRaises(UnsafePayloadError):
            validate_relation({**relation, "presentation": {"label": "<script>alert(1)</script>"}})
        with self.assertRaises(UnsafePayloadError):
            validate_relation({**relation, "presentation": {"label": "click <a href='x'>here</a>"}})
        with self.assertRaises(UnsafePayloadError):
            validate_relation(
                {**relation, "provider": {**relation["provider"], "raw_body": "secret"}}
            )

    def test_open_target_allows_declared_https_only(self):
        self.assertEqual(
            "https",
            validate_open_target(
                {"target_kind": "record", "uri": "https://example.test/r/1"},
                allowed_kinds={"record"},
                allowed_schemes={"https"},
            )["uri"].split(":")[0],
        )
        for uri in (
            "file:///etc/passwd",
            "data:text/plain,x",
            "javascript:alert(1)",
            "smb://host/share",
        ):
            with self.subTest(uri=uri), self.assertRaises(UnsafePayloadError):
                validate_open_target(
                    {"target_kind": "record", "uri": uri},
                    allowed_kinds={"record"},
                    allowed_schemes={"https"},
                )
        with self.assertRaises(ContractError):
            validate_open_target({"target_kind": "record", "uri": "https://example.test/r/1"})
        with self.assertRaises(ContractError):
            validate_open_target(
                {"target_kind": "record", "uri": "https://example.test/r/1"},
                allowed_kinds={"record"},
                allowed_schemes=set(),
            )
        with self.assertRaises(InvalidDiscriminantError):
            validate_open_target(
                {"target_kind": "command", "uri": "https://example.test"},
                allowed_kinds={"record"},
                allowed_schemes={"https"},
            )

    def test_module_and_contribution_v1_shapes_are_strict(self):
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
        for module_id in GOLDEN_CONTRACT_VECTORS["module_id"]["accept"]:
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
        contribution = {
            "interface_version": "valkama-contributions",
            "contribution_id": "provider.relation",
            "owner_kind": "adapter",
            "owner_id": "adapter-lineage",
            "slot": "entity-relation-resolver",
            "entity_kinds": ["work-item"],
            "content": {"kind": "text", "text": "bounded pointer"},
            "actions": [],
            "provenance": {
                "adapter_id": "provider",
                "adapter_lineage_id": "adapter-lineage",
                "adapter_version": "1.0.0",
                "connection_id": "one",
            },
        }
        self.assertEqual("adapter", validate_contribution(contribution)["owner_kind"])
        bad_module_contribution = {
            key: value for key, value in contribution.items() if key != "provenance"
        }
        bad_module_contribution.update(owner_kind="module", owner_id="notes", module_id="notes")
        with self.assertRaises(ContractError):
            validate_contribution(bad_module_contribution)
        with self.assertRaises(UnknownFieldError):
            validate_module_manifest({**module, "legacy": True})

    def test_the_memory_module_owns_the_action_and_contribution_it_declares(self):
        # The seventh module reached the registry, the page and the browser's
        # copy of the module vocabulary without reaching the server's, so the
        # primary action its own registered manifest names was refused by the
        # contract that publishes that manifest.
        registered = next(
            manifest
            for manifest in platform_modules.module_manifests()
            if manifest["module_id"] == "memory"
        )
        declared = registered["primary_actions"] + registered["secondary_actions"]
        self.assertIn("module.memory.attach", declared)
        for action_id in declared:
            with self.subTest(action_id=action_id):
                self.assertEqual(
                    "memory",
                    validate_action_ref(action(action_id, "module", "memory"))["owner_id"],
                )
        self.assertEqual(
            "memory",
            validate_contribution(
                {
                    "interface_version": "valkama-contributions",
                    "contribution_id": "memory.pointer",
                    "owner_kind": "module",
                    "owner_id": "memory",
                    "module_id": "memory",
                    "slot": "inspector-section",
                    "entity_kinds": ["memory-resource"],
                    "content": {"kind": "text", "text": "bounded pointer"},
                    "actions": [],
                }
            )["module_id"],
        )


if __name__ == "__main__":
    unittest.main()
