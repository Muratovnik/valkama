import sqlite3
import unittest
from typing import ClassVar

from server.platform.contracts import (
    ContractError,
    planning_space_entity,
    planning_work_item_entity,
)
from server.platform.registry import PermissionDeniedError, PlatformRegistry
from server.platform.relations import add_adapter_link, read_relations
from server.platform.scope import ensure_store_metadata


class CoreConsumer:
    """Provider-neutral consumer: no adapter IDs or provider implementation."""

    @staticmethod
    def snapshot(conn, card, registry, invocation_scope=None):
        return {
            "modules": registry.list_modules(),
            "actions": registry.list_actions(),
            "contributions": registry.list_contributions(
                slot="entity-relation-resolver", entity_kind="work-item"
            ),
            "relations": read_relations(
                conn,
                card,
                registry=registry,
                invocation_scope=invocation_scope,
            ),
        }


class NotesReferenceProvider:
    """A distinct provider implemented only against public Platform contracts."""

    service_ref: ClassVar[dict[str, str]] = {
        "owner_id": "notes-owner",
        "service_id": "notes-service",
    }
    adapter_id = "notes-reference"
    lineage = "notes-lineage"

    def service_descriptor(self):
        return {
            "service_ref": self.service_ref,
            "service_type": "notes",
            "title_key": "service.notes",
            "configuration_owner": "notes-owner",
            "trust_owner": "notes-owner",
            "discovery_provenance": "black-box",
            "state": "registered",
            "direct_read": False,
        }

    def manifest(self, *, malformed=False):
        return {
            "contract_version": "valkama-adapter",
            "adapter_id": self.adapter_id,
            "version": "3.2.1-beta.2+notes",
            "title_key": "<a>unsafe</a>" if malformed else "adapter.notes",
            "package_id": "notes-package",
            "publisher_id": "notes-publisher",
            "owner_id": "notes-owner",
            "configuration_owner": "notes-owner",
            "trust_owner": "notes-owner",
            "execution": "local_service",
            "supported_service_types": ["notes"],
            "capabilities": ["memory.open"],
            "consumes": ["work-item"],
            "contributions": [
                {
                    "interface_version": "valkama-contributions",
                    "contribution_id": "notes.relation",
                    "owner_kind": "adapter",
                    "owner_id": self.adapter_id,
                    "slot": "entity-relation-resolver",
                    "entity_kinds": ["work-item"],
                    "content": {"kind": "text", "text": "Note pointer"},
                    "actions": [
                        {
                            "interface_version": "valkama-actions",
                            "action_id": f"adapter.{self.adapter_id}.note.open",
                            "owner_kind": "adapter",
                            "owner_id": self.adapter_id,
                            "input_schema_id": "note.open",
                            "target_kind": "adapter-resource",
                            "invocation_scope_schema": "project",
                        }
                    ],
                }
            ],
            "permissions": [
                {
                    "permission_id": "resource.open",
                    "connection_mode": "required",
                    "entity_kinds": ["adapter-resource"],
                    "target_kinds": ["note"],
                }
            ],
            "health_contract": {"timeout_ms": 1000, "max_payload_bytes": 2048},
            "direct_read": False,
        }

    def connection(self, scope, *, health="ready"):
        return {
            "connection_ref": self.connection_ref,
            "applicability": scope,
            "configuration_owner": "notes-owner",
            "trust_owner": "notes-owner",
            "trust": "trusted",
            "health": health,
            "state": "registered",
        }

    @property
    def connection_ref(self):
        return {
            "service_ref": self.service_ref,
            "adapter_lineage_id": self.lineage,
            "connection_id": "workspace-notes",
        }

    def attach(self, conn, card, *, expected_revision=0):
        return add_adapter_link(
            conn,
            card,
            {
                "connection_ref": self.connection_ref,
                "resource_type": "note",
                "external_id": "note-42",
            },
            expected_revision=expected_revision,
            fallback_label="Design note 42",
            provenance={"source_kind": "notes-adapter", "observed_at": "2026-08-13T00:00:00Z"},
        )


def module_manifest():
    return {
        "interface_version": "valkama-modules",
        "module_id": "planning",
        "version": "2.0.0-rc.1+phase0",
        "title_key": "platform.modules.planning",
        "icon_key": "planning",
        "navigation_group": "work",
        "route_namespace": "planning",
        "state_schema": {"schema_id": "planning.state", "allowed_keys": [], "max_bytes": 64},
        "operating_levels": ["global", "project"],
        "semantics": {
            "global": {"read_models": ["cards"], "action_semantics": ["core.card.open"]},
            "project": {"read_models": ["cards"], "action_semantics": ["core.card.open"]},
        },
        "secondary_context": {
            "global": {"kinds": ["planning-space"], "behavior": "all"},
            "project": {"kinds": ["planning-space"], "behavior": "all"},
        },
        "required_read_models": ["cards"],
        "sse_subscriptions": [],
        "supported_entity_kinds": ["work-item"],
        "primary_actions": ["core.card.open"],
        "secondary_actions": [],
        "inspector_owner": "planning",
        "feature_capabilities": [],
        "states": {
            "global": {"supported": ["ready"]},
            "project": {"supported": ["ready"]},
        },
    }


class IndependentProviderBlackBoxTests(unittest.TestCase):
    def make_store(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        # The smallest store the relation reader needs: one space, one item, and
        # the event table it writes an attach into. Deliberately hand-written
        # rather than the real schema, which is the point of a black-box test.
        conn.executescript("""
            CREATE TABLE planning_spaces(planning_space_id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE);
            CREATE TABLE work_items(work_item_id TEXT PRIMARY KEY, planning_space_id TEXT NOT NULL, number INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '');
            CREATE TABLE work_item_events(id INTEGER PRIMARY KEY, work_item_id TEXT NOT NULL, author TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('linked','unlinked')), detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
            INSERT INTO planning_spaces(planning_space_id,key) VALUES ('space-notes','NOTES');
            INSERT INTO work_items(work_item_id,planning_space_id,number,revision) VALUES ('item-7','space-notes',7,0);
        """)
        metadata = ensure_store_metadata(conn, owner_id="valkama-owner")
        item = {
            "space_ref": {"data_scope_id": metadata["data_scope_id"], "space_key": "NOTES"},
            "reference": "NOTES-7",
        }
        return conn, metadata, item

    def install(self, registry, provider, metadata, *, health="ready"):
        project_scope = {"kind": "project", "project_ref": {"project_id": "project-notes"}}
        registry.scope_reader.register_store(
            metadata["data_scope_id"],
            "primary",
            resources=[
                planning_space_entity(
                    {"data_scope_id": metadata["data_scope_id"], "space_key": "NOTES"}
                )
            ],
            registry_revision=1,
        )
        binding = {
            "project_id": "project-notes",
            "resource_ref": planning_space_entity(
                {"data_scope_id": metadata["data_scope_id"], "space_key": "NOTES"}
            ),
            "registry_revision": 1,
            "source_owner": "notes-workspace",
            "source_hash": "c" * 64,
        }
        registry.scope_reader.ingest_projection(
            {
                "interface_version": "project-resource-binding",
                "project_id": "project-notes",
                "source_hash": "c" * 64,
                "bindings": [binding],
            }
        )
        registry.register_module(module_manifest())
        registry.register_service(provider.service_descriptor())
        registered = registry.register_adapter(provider.manifest())
        open_action = registered["contributions"][0]["actions"][0]
        registry.register_action_input(
            {
                "action_id": open_action["action_id"],
                "operation": "open",
                "resource_types": ["note"],
                "fields": [
                    {
                        "key": "external_id",
                        "kind": "stable-id",
                        "required": True,
                        "max_length": 128,
                    }
                ],
                "confirmation": "required",
                "title_key": "platform.actions.note.open",
            }
        )
        registry.register_connection(provider.connection(project_scope, health=health))
        registry.register_assignment(
            {
                "assignment_id": "notes-project-assignment",
                "capability_id": "memory.open",
                "scope": {"kind": "project", "project_id": "project-notes"},
                "connection_ids": [
                    ":".join(
                        (
                            provider.connection_ref["service_ref"]["owner_id"],
                            provider.connection_ref["service_ref"]["service_id"],
                            provider.connection_ref["adapter_lineage_id"],
                            provider.connection_ref["connection_id"],
                        )
                    )
                ],
                "state": "enabled",
                "changed_by": "project-owner",
            }
        )
        registry.grant_permission(
            {
                "grant_id": "notes-open-grant",
                "adapter_lineage_id": provider.lineage,
                "connection_ref": provider.connection_ref,
                "permission_id": "resource.open",
                "applicability": project_scope,
                "entity_kinds": ["adapter-resource"],
                "data_scope_ids": [metadata["data_scope_id"]],
                "granted_by": "project-owner",
                "granted_at": "2026-08-13T00:00:00Z",
                "revision": 1,
            }
        )
        return project_scope, registered

    def test_success_path_needs_no_provider_branch_in_core_consumer(self):
        conn, metadata, card = self.make_store()
        provider = NotesReferenceProvider()
        registry = PlatformRegistry(lineage_factory=lambda bound=provider: bound.lineage)
        scope, registered = self.install(registry, provider, metadata)
        invocation = {
            "view_scope": {"kind": "global"},
            "invocation_scope": scope,
            "target": {
                "connection_ref": provider.connection_ref,
                "resource_type": "note",
                "external_id": "note-42",
            },
        }
        registry.authorize(invocation, "resource.open", connection_ref=provider.connection_ref)
        provider.attach(conn, card)
        snapshot = CoreConsumer.snapshot(conn, card, registry, scope)
        self.assertEqual(1, len(snapshot["modules"]))
        self.assertEqual("adapter.notes-lineage.note.open", snapshot["actions"][0]["action_id"])
        self.assertEqual("notes-lineage", snapshot["contributions"][0]["owner_id"])
        self.assertEqual("resolved", snapshot["relations"][0]["state"])
        self.assertEqual(
            "3.2.1-beta.2+notes", snapshot["relations"][0]["provider"]["adapter_version"]
        )
        self.assertEqual(registered["contributions"], snapshot["contributions"])
        conn.close()

    def test_malformed_provider_isolated_without_partial_registry_state(self):
        provider = NotesReferenceProvider()
        registry = PlatformRegistry(lineage_factory=lambda bound=provider: bound.lineage)
        registry.register_service(provider.service_descriptor())
        with self.assertRaises(ContractError):
            registry.register_adapter(provider.manifest(malformed=True))
        self.assertEqual([], registry.list_actions())
        self.assertEqual([], registry.list_contributions())
        self.assertEqual({}, registry.adapters)

    def test_degraded_and_removed_provider_keep_relation_unavailable(self):
        for health in ("degraded", "unavailable"):
            with self.subTest(health=health):
                conn, metadata, card = self.make_store()
                provider = NotesReferenceProvider()
                registry = PlatformRegistry(lineage_factory=lambda bound=provider: bound.lineage)
                scope, _ = self.install(registry, provider, metadata, health=health)
                provider.attach(conn, card)
                invocation = {
                    "view_scope": scope,
                    "invocation_scope": scope,
                    "target": planning_work_item_entity(card),
                }
                with self.assertRaises(PermissionDeniedError):
                    registry.authorize(
                        invocation,
                        "resource.open",
                        connection_ref=provider.connection_ref,
                    )
                self.assertEqual(
                    "unavailable",
                    CoreConsumer.snapshot(conn, card, registry, scope)["relations"][0]["state"],
                )
                conn.close()

        conn, metadata, card = self.make_store()
        provider = NotesReferenceProvider()
        registry = PlatformRegistry(lineage_factory=lambda bound=provider: bound.lineage)
        scope, _ = self.install(registry, provider, metadata)
        provider.attach(conn, card)
        registry.remove_adapter(provider.lineage)
        self.assertEqual(
            "unavailable",
            CoreConsumer.snapshot(conn, card, registry, scope)["relations"][0]["state"],
        )
        conn.close()


if __name__ == "__main__":
    unittest.main()
