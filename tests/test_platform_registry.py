import unittest

from server.platform.contracts import (
    ContractError,
    planning_space_entity,
    planning_work_item_entity,
)
from server.platform.registry import (
    ActionCollisionError,
    DuplicateRegistrationError,
    MissingConnectionError,
    PermissionDeniedError,
    PlatformRegistry,
    ResolverCollisionError,
    RevokedPermissionError,
    ScopeMismatchError,
    TombstonedIdentityError,
)

UUID = "abcdefab-cdef-4abc-8def-abcdefabcdef"
UUID_2 = "fedcbafe-dcba-4fed-8cba-fedcbafedcba"


def service_ref(service_id="memory"):
    return {"owner_id": "provider-owner", "service_id": service_id}


def conn_ref(lineage="memory-lineage", connection_id="singleton", service_id="memory"):
    return {
        "service_ref": service_ref(service_id),
        "adapter_lineage_id": lineage,
        "connection_id": connection_id,
    }


def work_item_ref(scope=UUID, key="MAIN", number=1):
    return {
        "space_ref": {"data_scope_id": scope, "space_key": key},
        "reference": f"{key}-{number}",
    }


def work_item_entity(scope=UUID, key="MAIN", number=1):
    return planning_work_item_entity(work_item_ref(scope, key, number))


def manifest(adapter_id="memory-reference", permission_mode="required", direct_read=False):
    return {
        "contract_version": "valkama-adapter",
        "adapter_id": adapter_id,
        "version": "1.0.0",
        "title_key": "adapter.memory",
        "package_id": "package-memory",
        "publisher_id": "publisher",
        "owner_id": "provider-owner",
        "configuration_owner": "provider",
        "trust_owner": "provider",
        "execution": "local_service",
        "supported_service_types": ["knowledge"],
        "capabilities": ["memory.open"],
        "consumes": ["work-item"],
        "contributions": [
            {
                "interface_version": "valkama-contributions",
                "contribution_id": "memory-relation",
                "owner_kind": "adapter",
                "owner_id": adapter_id,
                "slot": "entity-relation-resolver",
                "entity_kinds": ["work-item"],
                "content": {"kind": "text", "text": "pointer"},
                "actions": [],
            }
        ],
        "permissions": [
            {
                "permission_id": "memory.open",
                "connection_mode": permission_mode,
                "entity_kinds": ["work-item", "registry"],
            }
        ],
        "health_contract": {"timeout_ms": 5000, "max_payload_bytes": 10000},
        "direct_read": direct_read,
    }


def descriptor(service_id="memory"):
    return {
        "service_ref": service_ref(service_id),
        "service_type": "knowledge",
        "title_key": "service.memory",
        "configuration_owner": "provider",
        "trust_owner": "provider",
        "discovery_provenance": "test",
        "state": "registered",
        "direct_read": False,
    }


def connection(ref, applicability=None, *, trust="trusted", health="ready", state="registered"):
    return {
        "connection_ref": ref,
        "applicability": applicability or {"kind": "global"},
        "configuration_owner": "provider",
        "trust_owner": "provider",
        "trust": trust,
        "health": health,
        "state": state,
    }


def assignment(lineage, ref_list, scope=None, assignment_id="assignment-1"):
    operating_scope = scope or {"kind": "global"}
    return {
        "assignment_id": assignment_id,
        "capability_id": "memory.open",
        "scope": (
            {"kind": "installation"}
            if operating_scope["kind"] == "global"
            else {
                "kind": "project",
                "project_id": operating_scope["project_ref"]["project_id"],
            }
        ),
        "connection_ids": [
            ":".join(
                (
                    ref["service_ref"]["owner_id"],
                    ref["service_ref"]["service_id"],
                    lineage,
                    ref["connection_id"],
                )
            )
            for ref in ref_list
        ],
        "state": "enabled",
        "changed_by": "owner",
    }


def grant(lineage, ref, scope=None, grant_id="grant-1", data_scope_ids=None, entity_kinds=None):
    return {
        "grant_id": grant_id,
        "adapter_lineage_id": lineage,
        "connection_ref": ref,
        "permission_id": "memory.open",
        "applicability": scope or {"kind": "global"},
        "entity_kinds": entity_kinds or ["work-item"],
        "data_scope_ids": data_scope_ids or [],
        "granted_by": "owner",
        "granted_at": "2026-08-13T00:00:00Z",
        "revision": 1,
    }


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.registry = PlatformRegistry(lineage_factory=lambda: "memory-lineage")
        self.registry.register_service(descriptor())
        self.adapter = self.registry.register_adapter(manifest())

    def test_duplicate_and_tombstoned_identity_cannot_be_taken_over(self):
        with self.assertRaises(DuplicateRegistrationError):
            self.registry.register_adapter(manifest())
        self.registry.remove_adapter("memory-lineage")
        with self.assertRaises(TombstonedIdentityError):
            self.registry.register_adapter(manifest("other-id"))
        takeover = manifest("memory-reference")
        takeover["package_id"] = "takeover-package"
        with self.assertRaises(TombstonedIdentityError):
            self.registry.register_adapter(takeover)
        restored = self.registry.register_adapter(manifest("memory-reference"))
        self.assertEqual("memory-lineage", restored["adapter_lineage_id"])
        self.assertEqual("memory-lineage", restored["contributions"][0]["owner_id"])

    def test_connection_and_assignment_scope_checks(self):
        global_ref = conn_ref()
        project_ref = conn_ref(connection_id="project", service_id="memory")
        self.registry.register_connection(connection(global_ref))
        self.registry.register_connection(
            connection(project_ref, {"kind": "project", "project_ref": {"project_id": "project-a"}})
        )
        with self.assertRaises(ScopeMismatchError):
            self.registry.register_assignment(
                assignment("memory-lineage", [project_ref], assignment_id="global-assignment")
            )
        self.registry.register_assignment(
            assignment("memory-lineage", [global_ref], assignment_id="global-assignment")
        )
        self.registry.register_assignment(
            assignment(
                "memory-lineage",
                [global_ref, project_ref],
                {"kind": "project", "project_ref": {"project_id": "project-a"}},
                assignment_id="project-assignment",
            )
        )

    def test_multi_connection_resolution_never_picks_first(self):
        first = conn_ref(connection_id="one")
        second = conn_ref(connection_id="two")
        self.registry.register_connection(connection(first))
        self.registry.register_connection(connection(second))
        self.registry.register_assignment(assignment("memory-lineage", [first, second]))
        resolution = self.registry.resolve_capability("memory.open")
        self.assertEqual("unavailable", resolution["state"])
        self.assertEqual("cardinality-one-required", resolution["reason"])

    def test_capability_definitions_declare_operation_and_normalized_result(self):
        expected = {
            "execution.launch": ("write", "execution"),
            "execution.resume": ("write", "execution"),
            "execution.stop": ("write", "execution"),
            "session.observe": ("read", "session"),
            "telemetry.query": ("read", "telemetry"),
            "skills.catalog": ("read", "skill"),
            "skills.activate": ("write", "skill"),
            "memory.open": ("read", "memory-resource"),
            "memory.health": ("read", "health"),
        }
        for capability_id, (operation, result_type) in expected.items():
            with self.subTest(capability_id=capability_id):
                resolution = self.registry.resolve_capability(capability_id)
                self.assertEqual(operation, resolution["capability"]["operation_character"])
                self.assertEqual(result_type, resolution["capability"]["result_type"])
                self.assertEqual(
                    [capability_id],
                    resolution["permissions"],
                )

    def test_permission_is_declared_exact_and_revocation_blocks(self):
        ref = conn_ref()
        self.registry.register_connection(connection(ref))
        self.registry.register_assignment(assignment("memory-lineage", [ref]))
        with self.assertRaises(MissingConnectionError):
            self.registry.grant_permission(grant("memory-lineage", None))
        with self.assertRaises(ContractError):
            self.registry.grant_permission(
                {**grant("memory-lineage", ref), "permission_id": "not-declared"}
            )
        self.registry.grant_permission(grant("memory-lineage", ref, entity_kinds=["registry"]))
        context = {
            "view_scope": {"kind": "global"},
            "invocation_scope": {"kind": "global"},
            "target": {"kind": "registry", "registry_id": "permission-test"},
        }
        self.registry.authorize(context, "memory.open", connection_ref=ref)
        self.registry.revoke_permission("grant-1")
        with self.assertRaises(RevokedPermissionError):
            self.registry.authorize(context, "memory.open", connection_ref=ref)

    def test_project_authorization_requires_current_exact_binding(self):
        ref = conn_ref()
        self.registry.register_connection(connection(ref))
        project_scope = {"kind": "project", "project_ref": {"project_id": "project-a"}}
        self.registry.register_assignment(assignment("memory-lineage", [ref], project_scope))
        self.registry.grant_permission(
            grant("memory-lineage", ref, project_scope, data_scope_ids=[UUID])
        )
        resource_ref = planning_space_entity({"data_scope_id": UUID, "space_key": "MAIN"})
        self.registry.scope_reader.register_store(
            UUID, "store-a", resources=[resource_ref], registry_revision=3
        )
        binding = {
            "project_id": "project-a",
            "resource_ref": resource_ref,
            "registry_revision": 3,
            "source_owner": "workspace",
            "source_hash": "a" * 64,
        }
        self.registry.scope_reader.ingest_projection(
            {
                "interface_version": "project-resource-binding",
                "project_id": "project-a",
                "source_hash": "a" * 64,
                "bindings": [binding],
            }
        )
        context = {
            "view_scope": {"kind": "global"},
            "invocation_scope": project_scope,
            "target": work_item_entity(),
        }
        self.registry.authorize(context, "memory.open", connection_ref=ref)
        with self.assertRaises(ScopeMismatchError):
            self.registry.authorize(
                {**context, "target": work_item_entity(UUID_2)},
                "memory.open",
                connection_ref=ref,
            )

    def test_connection_independent_permission_still_needs_explicit_lineage(self):
        independent = PlatformRegistry(lineage_factory=lambda: "independent-lineage")
        independent.register_service(descriptor("independent"))
        independent.register_adapter(manifest("independent", permission_mode="none"))
        independent.register_assignment(
            assignment("independent-lineage", [], assignment_id="independent-assignment")
        )
        independent.grant_permission(
            grant(
                "independent-lineage", None, grant_id="independent-grant", entity_kinds=["registry"]
            )
        )
        context = {
            "view_scope": {"kind": "global"},
            "invocation_scope": {"kind": "global"},
            "target": {"kind": "registry", "registry_id": "independent"},
        }
        with self.assertRaises(MissingConnectionError):
            independent.authorize(context, "memory.open")
        with self.assertRaises(PermissionDeniedError):
            independent.authorize(context, "memory.open", adapter_lineage_id="independent-lineage")

    def test_core_ref_binding_is_unique_and_pointer_only(self):
        ref = conn_ref()
        self.registry.register_connection(connection(ref))
        self.registry.bind_core_ref_resolver("memory", service_ref(), "memory-lineage", "singleton")
        self.registry.register_connection(connection(conn_ref(connection_id="other")))
        with self.assertRaises(ResolverCollisionError):
            self.registry.bind_core_ref_resolver("memory", service_ref(), "memory-lineage", "other")
        direct = PlatformRegistry(lineage_factory=lambda: "direct-lineage")
        direct.register_service(descriptor("direct"))
        direct.register_adapter(manifest("direct", direct_read=True))
        direct_ref = conn_ref("direct-lineage", service_id="direct")
        direct.register_connection(connection(direct_ref))
        with self.assertRaises(PermissionDeniedError):
            direct.bind_core_ref_resolver(
                "memory", service_ref("direct"), "direct-lineage", "singleton"
            )

        service_direct = PlatformRegistry(lineage_factory=lambda: "service-direct-lineage")
        direct_descriptor = descriptor("service-direct")
        direct_descriptor["direct_read"] = True
        service_direct.register_service(direct_descriptor)
        service_manifest = manifest("service-direct")
        service_manifest["supported_service_types"] = ["knowledge"]
        service_direct.register_adapter(service_manifest)
        service_ref_value = conn_ref("service-direct-lineage", service_id="service-direct")
        service_direct.register_connection(connection(service_ref_value))
        with self.assertRaises(PermissionDeniedError):
            service_direct.bind_core_ref_resolver(
                "memory", service_ref("service-direct"), "service-direct-lineage", "singleton"
            )

    def test_action_collision_and_exact_owner_namespace(self):
        action = {
            "interface_version": "valkama-actions",
            "action_id": "adapter.memory-lineage.open",
            "owner_kind": "adapter",
            "owner_id": "memory-lineage",
            "input_schema_id": "input-v1",
            "target_kind": "adapter-resource",
            "invocation_scope_schema": "global",
        }
        # The owner lineage must exist first; after registration duplicate IDs
        # remain collisions even when the payload is identical.
        ref = conn_ref()
        self.registry.register_connection(connection(ref))
        self.registry.register_action(action)
        with self.assertRaises(ActionCollisionError):
            self.registry.register_action(action)

        descriptor = {
            "action_id": action["action_id"],
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
            "title_key": "platform.actions.memory.open",
        }
        self.registry.register_action_input(descriptor)
        self.assertEqual("open", self.registry.operation_for_action(action["action_id"]))
        with self.assertRaises(DuplicateRegistrationError):
            self.registry.register_action_input(descriptor)

    def test_adapter_registration_atomically_registers_contributions_and_actions(self):
        candidate = PlatformRegistry(lineage_factory=lambda: "atomic-lineage")
        candidate.register_service(descriptor())
        adapter = manifest("atomic-adapter")
        contribution = adapter["contributions"][0]
        contribution["actions"] = [
            {
                "interface_version": "valkama-actions",
                "action_id": "adapter.atomic-adapter.memory.open",
                "owner_kind": "adapter",
                "owner_id": "atomic-adapter",
                "input_schema_id": "memory.open",
                "target_kind": "work-item",
                "invocation_scope_schema": "project",
            }
        ]
        registered = candidate.register_adapter(adapter)
        self.assertEqual("atomic-lineage", registered["contributions"][0]["owner_id"])
        self.assertEqual(
            "adapter.atomic-lineage.memory.open", candidate.list_actions()[0]["action_id"]
        )
        self.assertEqual(
            registered["contributions"][0], candidate.get_contribution("memory-relation")
        )
        self.assertEqual(
            1,
            len(
                candidate.list_contributions(
                    slot="entity-relation-resolver", entity_kind="work-item"
                )
            ),
        )

    def test_adapter_registration_collision_has_no_partial_state(self):
        candidate = PlatformRegistry(lineage_factory=lambda: "atomic-lineage")
        candidate.register_service(descriptor())
        adapter = manifest("atomic-adapter")
        duplicate = {
            **adapter["contributions"][0],
            "content": {"kind": "text", "text": "different"},
        }
        adapter["contributions"].append(duplicate)
        with self.assertRaises(DuplicateRegistrationError):
            candidate.register_adapter(adapter)
        self.assertEqual([], candidate.list_actions())
        self.assertEqual([], candidate.list_contributions())
        self.assertEqual({}, candidate.adapters)

        action_collision = manifest("atomic-adapter")
        action = {
            "interface_version": "valkama-actions",
            "action_id": "adapter.atomic-adapter.memory.open",
            "owner_kind": "adapter",
            "owner_id": "atomic-adapter",
            "input_schema_id": "memory.open",
            "target_kind": "work-item",
            "invocation_scope_schema": "project",
        }
        action_collision["contributions"][0]["actions"] = [
            action,
            {**action, "input_schema_id": "memory.other"},
        ]
        with self.assertRaises(ActionCollisionError):
            candidate.register_adapter(action_collision)
        self.assertEqual([], candidate.list_actions())
        self.assertEqual([], candidate.list_contributions())
        self.assertEqual({}, candidate.adapters)

    def test_registered_contribution_id_cannot_be_taken_by_second_adapter(self):
        lineages = iter(("first-lineage", "second-lineage"))
        candidate = PlatformRegistry(lineage_factory=lambda: next(lineages))
        candidate.register_service(descriptor())
        candidate.register_adapter(manifest("first-adapter"))
        with self.assertRaises(DuplicateRegistrationError):
            candidate.register_adapter(manifest("second-adapter"))
        self.assertEqual(
            ["first-adapter"], [item["adapter_id"] for item in candidate.adapters.values()]
        )
        self.assertEqual(1, len(candidate.list_contributions()))

    def test_authorization_requires_assignment_connection_health_trust_and_grant_kind(self):
        ref = conn_ref()
        context = {
            "view_scope": {"kind": "global"},
            "invocation_scope": {"kind": "global"},
            "target": {"kind": "registry", "registry_id": "item"},
        }
        broad = manifest()
        broad["permissions"][0]["entity_kinds"] = ["work-item", "registry"]
        registry = PlatformRegistry(lineage_factory=lambda: "memory-lineage")
        registry.register_service(descriptor())
        registry.register_adapter(broad)
        registry.register_connection(connection(ref))
        registry.grant_permission(grant("memory-lineage", ref, entity_kinds=["work-item"]))
        with self.assertRaises(PermissionDeniedError):
            registry.authorize(context, "memory.open", connection_ref=ref)
        registry.register_assignment(assignment("memory-lineage", [ref]))
        with self.assertRaises(PermissionDeniedError):
            registry.authorize(context, "memory.open", connection_ref=ref)

        for trust, health, state in (
            ("restricted", "ready", "registered"),
            ("trusted", "degraded", "registered"),
            ("trusted", "ready", "invalid"),
        ):
            with self.subTest(trust=trust, health=health, state=state):
                candidate = PlatformRegistry(lineage_factory=lambda: "memory-lineage")
                candidate.register_service(descriptor())
                candidate.register_adapter(manifest())
                candidate.register_connection(
                    connection(ref, trust=trust, health=health, state=state)
                )
                candidate.register_assignment(assignment("memory-lineage", [ref]))
                candidate.grant_permission(grant("memory-lineage", ref))
                card_context = {
                    "view_scope": {"kind": "global"},
                    "invocation_scope": {"kind": "global"},
                    "target": work_item_entity(),
                }
                with self.assertRaises(PermissionDeniedError):
                    candidate.authorize(card_context, "memory.open", connection_ref=ref)

    def test_global_scope_cannot_authorize_project_owned_card_and_target_cannot_be_replaced(self):
        ref = conn_ref()
        self.registry.register_connection(connection(ref))
        self.registry.register_assignment(assignment("memory-lineage", [ref]))
        self.registry.grant_permission(grant("memory-lineage", ref))
        context = {
            "view_scope": {"kind": "global"},
            "invocation_scope": {"kind": "global"},
            "target": work_item_entity(),
        }
        with self.assertRaises(ScopeMismatchError):
            self.registry.authorize(context, "memory.open", connection_ref=ref)
        with self.assertRaises(PermissionDeniedError):
            self.registry.authorize(
                {**context, "target": {"kind": "registry", "registry_id": "safe"}},
                "memory.open",
                entity_ref=work_item_entity(),
                connection_ref=ref,
            )

    def test_disabled_and_removed_assignment_connection_fail_closed(self):
        ref = conn_ref()
        self.registry.register_connection(connection(ref))
        disabled = assignment("memory-lineage", [ref])
        disabled["state"] = "disabled"
        self.registry.register_assignment(disabled)
        self.registry.grant_permission(grant("memory-lineage", ref, entity_kinds=["registry"]))
        context = {
            "view_scope": {"kind": "global"},
            "invocation_scope": {"kind": "global"},
            "target": {"kind": "registry", "registry_id": "item"},
        }
        with self.assertRaises(PermissionDeniedError):
            self.registry.authorize(context, "memory.open", connection_ref=ref)

        removed = PlatformRegistry(lineage_factory=lambda: "memory-lineage")
        removed.register_service(descriptor())
        removed.register_adapter(manifest())
        removed.register_connection(connection(ref))
        removed.register_assignment(assignment("memory-lineage", [ref]))
        removed.grant_permission(grant("memory-lineage", ref, entity_kinds=["registry"]))
        removed.remove_connection(ref)
        with self.assertRaises((PermissionDeniedError, MissingConnectionError)):
            removed.authorize(context, "memory.open", connection_ref=ref)


if __name__ == "__main__":
    unittest.main()
