from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, store
from server.improvements import api as improvements_api
from server.memory import service as memory_service
from server.planning import service as planning_service
from server.platform import core as platform_core
from server.platform.contracts import planning_space_entity, planning_work_item_entity
from server.platform.providers import (
    AgentMemoryReferenceProvider,
    NotesReferenceProvider,
    ProviderCatalog,
    ProviderUnavailableError,
)
from server.platform.registry import (
    PermissionDeniedError,
    RegistryError,
    RevokedPermissionError,
    ScopeMismatchError,
)
from server.platform.scope import read_store_metadata
from server.projects import scopes
from tests import SUITE_STORE
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

SOURCE_HASH = "a" * 64


class ReadyMemoryProvider(AgentMemoryReferenceProvider):
    def health(self):
        return "ready", None


class PlatformTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.directory.name, "valkama.sqlite3")
        self.registry_path = os.path.join(self.directory.name, "projects.json")
        self.previous_db = os.environ.get("VALKAMA_DB")
        os.environ["VALKAMA_DB"] = self.db
        self._write_registry([])
        conn = store.connect()
        planning_service.create_planning_space(
            conn, project_id="example-project", name="Example Space", key="EXA"
        )
        created = planning_service.create_work_item(conn, space="EXA", title="Phase 1 item")
        planning_service.attach_ref(
            conn,
            created["reference"],
            "memory",
            "lsn_example",
            label="Decision pointer",
        )
        conn.commit()
        self.item = planning_service.get_work_item(conn, created["reference"])
        self.data_scope_id = read_store_metadata(conn)["data_scope_id"]
        conn.close()
        self.binding = {
            "project_id": "example-project",
            "resource_ref": planning_space_entity(
                {"data_scope_id": self.data_scope_id, "space_key": "EXA"}
            ),
            "registry_revision": 1,
            "source_owner": "example-project",
            "source_hash": SOURCE_HASH,
        }
        self._write_registry([self.binding])
        self.conn = store.connect()
        self.memory = ReadyMemoryProvider()
        self.notes = NotesReferenceProvider()
        self.providers = ProviderCatalog([self.memory, self.notes])
        self.platform = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        self.item_ref = {
            "space_ref": {"data_scope_id": self.data_scope_id, "space_key": "EXA"},
            "reference": self.item["reference"],
        }
        self.entity_ref = planning_work_item_entity(self.item_ref)
        self.project_scope = {
            "kind": "project",
            "project_ref": {"project_id": "example-project"},
        }

    def tearDown(self) -> None:
        self.conn.close()
        if self.previous_db is None:
            os.environ["VALKAMA_DB"] = SUITE_STORE
        else:
            os.environ["VALKAMA_DB"] = self.previous_db
        self.directory.cleanup()

    def _write_registry(self, bindings) -> None:
        Path(self.registry_path).write_bytes(
            registry_bytes(
                [
                    project_entry(
                        "example-project",
                        self.directory.name,
                        board="Example Board",
                        bindings=bindings,
                        source_hash=SOURCE_HASH,
                    )
                ]
            )
        )

    def _query(self, **extra):
        values = {"scope_kind": ["project"], "project_id": ["example-project"]}
        values.update({key: [str(value)] for key, value in extra.items()})
        return values

    def _resource(self, provider, external_id):
        return {
            "connection_ref": provider.connection_ref,
            "resource_type": provider.resource_type,
            "external_id": external_id,
        }

    def _context(self, resource, *, view_scope=None):
        return {
            "view_scope": view_scope or self.project_scope,
            "invocation_scope": self.project_scope,
            "target": resource,
        }

    def _relation_command(self, operation, provider, external_id, revision):
        resource = self._resource(provider, external_id)
        return {
            "interface_version": "valkama-relation-command",
            "operation": operation,
            "entity_ref": self.entity_ref,
            "resource_ref": resource,
            "invocation_context": self._context(resource),
            "action_ref": provider.action_ref(operation),
            "expected_revision": revision,
            "fallback_label": external_id,
            "confirmation": True,
        }

    def _authorize(
        self,
        platform,
        provider,
        *,
        data_scope_ids=None,
        permissions=("relation.attach", "relation.remove", "resource.open"),
    ):
        data_scope_ids = data_scope_ids or [self.data_scope_id]
        platform.set_connection_trust(provider.connection_ref, "trusted", changed_by="test-owner")
        assignment_id = f"test-{provider.adapter_lineage_id}"
        if (
            self.conn.execute(
                "SELECT 1 FROM platform_assignments WHERE assignment_id=?", (assignment_id,)
            ).fetchone()
            is None
        ):
            platform.register_assignment(
                {
                    "assignment_id": assignment_id,
                    "capability_id": (
                        "memory.health"
                        if provider.adapter_lineage_id == "agentmemory-reference-v1"
                        else "memory.open"
                    ),
                    "scope": {"kind": "project", "project_id": "example-project"},
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
                    "changed_by": "test-owner",
                }
            )
        grant_ids = {}
        for permission in permissions:
            grant_id = f"test-{provider.adapter_lineage_id}-{permission.replace('.', '-')}"
            grant_ids[permission] = grant_id
            if (
                self.conn.execute(
                    "SELECT 1 FROM platform_grants WHERE grant_id=?", (grant_id,)
                ).fetchone()
                is None
            ):
                platform.grant_permission(
                    {
                        "grant_id": grant_id,
                        "adapter_lineage_id": provider.adapter_lineage_id,
                        "connection_ref": provider.connection_ref,
                        "permission_id": permission,
                        "applicability": self.project_scope,
                        "entity_kinds": ["adapter-resource"],
                        "data_scope_ids": sorted(data_scope_ids),
                        "granted_by": "test-owner",
                        "granted_at": "2026-08-13T00:00:00Z",
                        "revision": 1,
                        "active": True,
                    }
                )
        return {"assignment_id": assignment_id, "grant_ids": grant_ids}

    def _authorize_all(self, platform=None):
        platform = platform or self.platform
        return {
            "memory": self._authorize(platform, self.memory),
            "notes": self._authorize(platform, self.notes),
        }

    def test_exact_modules_context_registry_planning_and_card_contracts(self) -> None:
        modules = self.platform.modules_payload()
        self.assertEqual("valkama-modules", modules["interface_version"])
        self.assertEqual(
            ["analytics", "improvements", "memory", "planning", "sessions", "settings", "skills"],
            [item["manifest"]["module_id"] for item in modules["modules"]],
        )
        context = self.platform.context_payload(self._query())
        self.assertEqual("valkama-context", context["interface_version"])
        project = context["state"]["payload"]["projects"][0]
        self.assertEqual("mapped", project["binding_state"])
        self.assertNotIn("binding_reason", project)
        self.assertNotIn("canonical_root", json.dumps(context))

        registry = self.platform.registry_payload(self._query())
        ready = registry["state"]["payload"]
        self.assertEqual(10, len(ready["assignments"]))
        self.assertTrue(
            all(item["scope"] == {"kind": "installation"} for item in ready["assignments"])
        )
        self.assertEqual([], ready["grants"])
        self.assertTrue(all(item["trust"] == "unknown" for item in ready["connections"]))
        self.assertTrue(all("contributions" not in item for item in ready["adapters"]))
        self.assertEqual(
            {"attach", "remove", "open"}, {item["operation"] for item in ready["action_inputs"]}
        )
        self.assertTrue(all("detail" in item for item in ready["audit"]))

        planning = self.platform.planning_payload(
            self._query(data_scope_id=self.data_scope_id, space_key="EXA")
        )
        summary = planning["state"]["payload"]["planning_spaces"][0]["work_items"][0]
        self.assertEqual(self.item_ref, summary["work_item_ref"])
        detail = self.platform.planning_work_item_payload(
            self._query(
                data_scope_id=self.data_scope_id,
                space_key="EXA",
                reference=self.item["reference"],
            ),
            planning_service.get_work_item,
        )
        memory_relation = detail["state"]["payload"]["relations"]["relations"][0]
        self.assertEqual("lsn_example", memory_relation["target"]["external_id"])
        self.assertEqual("unavailable", memory_relation["state"])
        self.assertEqual([], memory_relation["actions"])
        self.assertNotIn("memory_body", json.dumps(detail))

        self._authorize_all()
        configured = self.platform.registry_payload(self._query())["state"]["payload"]
        self.assertTrue(
            all(
                item["scope"] == {"kind": "project", "project_id": "example-project"}
                for item in configured["assignments"]
                if item["changed_by"] == "test-owner"
            )
        )
        self.assertTrue(
            all(item["data_scope_ids"] == [self.data_scope_id] for item in configured["grants"])
        )
        global_ready = self.platform.registry_payload({"scope_kind": ["global"]})["state"][
            "payload"
        ]
        self.assertEqual(10, len(global_ready["assignments"]))
        self.assertEqual(len(configured["grants"]), len(global_ready["grants"]))
        self.assertTrue(all("applicability" in item for item in global_ready["connections"]))

    def test_global_planning_and_memory_share_every_registered_project(self) -> None:
        unbound_root = Path(self.directory.name) / "unbound"
        unbound_root.mkdir()
        Path(self.registry_path).write_bytes(
            registry_bytes(
                [
                    project_entry(
                        "example-project",
                        self.directory.name,
                        board="Example Board",
                        bindings=[self.binding],
                        source_hash=SOURCE_HASH,
                    ),
                    project_entry(
                        "unbound-project",
                        unbound_root,
                        board="Unbound Project",
                        bindings=[
                            project_binding(
                                "unbound-project",
                                planning_work_item_entity(self.item_ref),
                                source_hash="b" * 64,
                            )
                        ],
                        source_hash="b" * 64,
                    ),
                ]
            )
        )
        reader = Path(self.registry_path).read_bytes
        platform = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=reader,
            providers=self.providers,
        )

        planning = platform.planning_payload({"scope_kind": ["global"]})["state"]
        self.assertEqual("ready", planning["status"])
        planning_projects = planning["payload"]["projects"]
        memory_projects = memory_service.providers(registry_reader=reader)["providers"]
        self.assertEqual(
            {"example-project", "unbound-project"},
            {item["project_id"] for item in planning_projects},
        )
        self.assertEqual(
            {item["project_id"] for item in planning_projects},
            {item["project_id"] for item in memory_projects},
        )
        unbound = next(
            item for item in planning_projects if item["project_id"] == "unbound-project"
        )
        self.assertEqual("unbound", unbound["binding_state"])
        self.assertNotIn("binding_reason", unbound)
        self.assertEqual([], unbound["planning_spaces"])

    def test_generic_relation_attach_open_remove_is_atomic(self) -> None:
        self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        attached = self.platform.relation_command(
            self._relation_command("attach", self.notes, "note-42", revision)
        )
        self.assertEqual(revision + 1, attached["work_item_revision"])
        self.assertEqual("note-42", attached["relation"]["target"]["external_id"])
        self.assertIn(self.notes.action_ref("open"), attached["relation"]["actions"])
        resource = self._resource(self.notes, "note-42")
        opened = self.platform.invoke_action(
            {
                "interface_version": "valkama-action-command",
                "action_ref": self.notes.action_ref("open"),
                "invocation_context": self._context(resource, view_scope={"kind": "global"}),
                "input": {"entity_ref": self.entity_ref, "resource_ref": resource},
                "confirmation": True,
            }
        )
        self.assertEqual("https://notes.invalid/resource/note-42", opened["target"]["uri"])
        self.assertEqual(self.entity_ref, opened["entity_ref"])
        removed = self.platform.relation_command(
            self._relation_command("remove", self.notes, "note-42", revision + 1)
        )
        self.assertTrue(removed["removed"])
        detail = planning_service.get_work_item(self.conn, self.item["reference"])
        self.assertEqual(revision + 2, detail["revision"])
        # Planning reports its events oldest first, unlike the board reader it
        # replaced, so the pair under test is the tail.
        self.assertEqual(["linked", "unlinked"], [item["action"] for item in detail["events"][-2:]])

    def test_general_commands_refuse_legacy_item_ref_fields(self) -> None:
        relation = self._relation_command("attach", self.notes, "note-42", 1)
        relation["item_ref"] = relation.pop("entity_ref")
        with self.assertRaises(platform_core.ContractError):
            self.platform.relation_command(relation)

        resource = self._resource(self.notes, "note-42")
        action = {
            "interface_version": "valkama-action-command",
            "action_ref": self.notes.action_ref("open"),
            "invocation_context": self._context(resource),
            "input": {"item_ref": self.item_ref, "resource_ref": resource},
            "confirmation": True,
        }
        with self.assertRaises(platform_core.ContractError):
            self.platform.invoke_action(action)

    def test_open_action_requires_literal_confirmation_before_authorization(self) -> None:
        self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        self.platform.relation_command(
            self._relation_command("attach", self.notes, "confirmed-note", revision)
        )
        resource = self._resource(self.notes, "confirmed-note")
        command = {
            "interface_version": "valkama-action-command",
            "action_ref": self.notes.action_ref("open"),
            "invocation_context": self._context(resource),
            "input": {"entity_ref": self.entity_ref, "resource_ref": resource},
        }
        before_audit = self.conn.execute(
            "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
        ).fetchone()[0]
        with (
            mock.patch.object(
                self.platform,
                "_authorize_provider_action",
                wraps=self.platform._authorize_provider_action,
            ) as authorize,
            mock.patch.object(
                self.notes,
                "open_target",
                wraps=self.notes.open_target,
            ) as open_target,
            mock.patch.object(
                self.platform,
                "_audit",
                wraps=self.platform._audit,
            ) as audit,
        ):
            for label, confirmation in (
                ("missing", None),
                ("false", False),
                ("string", "true"),
                ("number", 1),
            ):
                invalid = dict(command)
                if label != "missing":
                    invalid["confirmation"] = confirmation
                with self.subTest(confirmation=label):
                    with self.assertRaises(platform_core.ContractError):
                        self.platform.invoke_action(invalid)
            self.assertEqual(0, authorize.call_count)
            self.assertEqual(0, open_target.call_count)
            self.assertEqual(0, audit.call_count)

            confirmed = self.platform.invoke_action({**command, "confirmation": True})
            self.assertEqual(1, authorize.call_count)
            self.assertEqual(1, open_target.call_count)
            self.assertEqual(1, audit.call_count)
        self.assertEqual(
            "https://notes.invalid/resource/confirmed-note",
            confirmed["target"]["uri"],
        )
        self.assertEqual(
            before_audit + 1,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
            ).fetchone()[0],
        )

    def test_binding_discovery_is_default_deny_across_restart(self) -> None:
        ready = self.platform.registry_payload(self._query())["state"]["payload"]
        self.assertEqual(10, len(ready["assignments"]))
        self.assertEqual([], ready["grants"])
        self.assertTrue(all(item["trust"] == "unknown" for item in ready["connections"]))
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        with self.assertRaises(PermissionDeniedError):
            self.platform.relation_command(
                self._relation_command("attach", self.notes, "default-deny", revision)
            )
        fresh = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        restarted = fresh.registry_payload(self._query())["state"]["payload"]
        self.assertEqual(10, len(restarted["assignments"]))
        self.assertEqual([], restarted["grants"])
        self.assertTrue(all(item["trust"] == "unknown" for item in restarted["connections"]))

    def test_explicit_owner_configuration_persists_across_restart(self) -> None:
        self._authorize(self.platform, self.notes)
        fresh = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        ready = fresh.registry_payload(self._query())["state"]["payload"]
        connection = next(
            item
            for item in ready["connections"]
            if item["connection_ref"] == self.notes.connection_ref
        )
        self.assertEqual("trusted", connection["trust"])
        self.assertEqual("ready", connection["health"])
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        result = fresh.relation_command(
            self._relation_command("attach", self.notes, "explicit-owner", revision)
        )
        self.assertEqual(revision + 1, result["work_item_revision"])

    def test_confirmation_and_browser_safe_label_fail_before_mutation(self) -> None:
        self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        before_events = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_events e"
            " JOIN work_items w ON w.work_item_id = e.work_item_id"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " WHERE p.key || '-' || w.number = ?",
            (self.item["reference"],),
        ).fetchone()[0]
        before_audit = self.conn.execute(
            "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
        ).fetchone()[0]
        for confirmation in (None, False, "true", 1):
            command = self._relation_command("attach", self.notes, "needs-confirmation", revision)
            if confirmation is None:
                command.pop("confirmation")
            else:
                command["confirmation"] = confirmation
            with self.assertRaises(platform_core.ContractError):
                self.platform.relation_command(command)
        unsafe = self._relation_command("attach", self.notes, "unsafe-label", revision)
        unsafe["fallback_label"] = "<b>unsafe</b>"
        with self.assertRaises(platform_core.ContractError):
            self.platform.relation_command(unsafe)
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_adapter_links"
                " WHERE external_id IN ('needs-confirmation','unsafe-label')"
            ).fetchone()[0],
        )
        self.assertEqual(
            revision, planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        )
        self.assertEqual(
            before_events,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_events e"
                " JOIN work_items w ON w.work_item_id = e.work_item_id"
                " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
                " WHERE p.key || '-' || w.number = ?",
                (self.item["reference"],),
            ).fetchone()[0],
        )
        self.assertEqual(
            before_audit,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
            ).fetchone()[0],
        )
        self.assertEqual(
            "ready",
            self.platform.planning_work_item_payload(
                self._query(
                    data_scope_id=self.data_scope_id,
                    space_key="EXA",
                    reference=self.item["reference"],
                ),
                planning_service.get_work_item,
            )["state"]["status"],
        )

    def test_action_audit_is_scoped_persisted_and_atomic_with_relation(self) -> None:
        configured = self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        self.platform.relation_command(
            self._relation_command("attach", self.notes, "audited-note", revision)
        )
        fresh = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        audit = next(
            item
            for item in fresh.registry_payload(self._query())["state"]["payload"]["audit"]
            if item["event_kind"] == "action.invoked"
        )
        self.assertEqual(self.project_scope, audit["detail"]["invocation_scope"])
        self.assertEqual(self.project_scope, audit["detail"]["view_scope"])
        self.assertNotIn("registry_revision", audit["detail"]["binding"])
        decision = audit["detail"]["decision"]
        self.assertEqual(configured["assignment_id"], decision["assignment_id"])
        self.assertEqual(configured["grant_ids"]["relation.attach"], decision["grant_id"])
        self.assertEqual("trusted", decision["connection_trust"])

        next_revision = revision + 1
        before_events = self.conn.execute(
            "SELECT COUNT(*) FROM work_item_events e"
            " JOIN work_items w ON w.work_item_id = e.work_item_id"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " WHERE p.key || '-' || w.number = ?",
            (self.item["reference"],),
        ).fetchone()[0]
        before_action_audit = self.conn.execute(
            "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
        ).fetchone()[0]
        original_audit = fresh._audit

        def fail_audit(*_args, **_kwargs):
            raise RuntimeError("forced audit failure")

        fresh._audit = fail_audit
        try:
            with self.assertRaises(RuntimeError):
                fresh.relation_command(
                    self._relation_command("attach", self.notes, "rolled-back-note", next_revision)
                )
        finally:
            fresh._audit = original_audit
        self.assertEqual(
            0,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_adapter_links WHERE external_id='rolled-back-note'"
            ).fetchone()[0],
        )
        self.assertEqual(
            next_revision,
            planning_service.get_work_item(self.conn, self.item["reference"])["revision"],
        )
        self.assertEqual(
            before_events,
            self.conn.execute(
                "SELECT COUNT(*) FROM work_item_events e"
                " JOIN work_items w ON w.work_item_id = e.work_item_id"
                " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
                " WHERE p.key || '-' || w.number = ?",
                (self.item["reference"],),
            ).fetchone()[0],
        )
        self.assertEqual(
            before_action_audit,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
            ).fetchone()[0],
        )

    def test_revoke_invalidates_authorization_and_notes_failure_is_typed(self) -> None:
        configured = self._authorize_all()
        grant_id = configured["notes"]["grant_ids"]["relation.attach"]
        revoked = self.platform.revoke_grant(grant_id)
        self.assertEqual("revoked", revoked["state"])
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        with self.assertRaises((PermissionDeniedError, RevokedPermissionError)):
            self.platform.relation_command(
                self._relation_command("attach", self.notes, "note-revoked", revision)
            )

        # A fresh platform sees the persisted tombstone, while another provider
        # remains independently authorized through the same public contract.
        fresh = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        memory_resource = self._resource(self.memory, "lsn_example")
        opened = fresh.invoke_action(
            {
                "interface_version": "valkama-action-command",
                "action_ref": self.memory.action_ref("open"),
                "invocation_context": self._context(memory_resource),
                "input": {"entity_ref": self.entity_ref, "resource_ref": memory_resource},
                "confirmation": True,
            }
        )
        self.assertEqual("agentmemory://memory/lsn_example", opened["target"]["uri"])

    def test_exact_card_data_scope_must_be_present_in_the_grant(self) -> None:
        configured = self._authorize(self.platform, self.notes)
        grant_id = configured["grant_ids"]["relation.attach"]
        row = self.conn.execute(
            "SELECT record_json FROM platform_grants WHERE grant_id=?", (grant_id,)
        ).fetchone()
        record = json.loads(row[0])
        record["data_scope_ids"] = ["22222222-2222-4222-8222-222222222222"]
        record["granted_by"] = "owner"
        self.conn.execute(
            "UPDATE platform_grants SET record_json=? WHERE grant_id=?",
            (json.dumps(record, sort_keys=True), grant_id),
        )
        self.conn.commit()
        fresh = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        with self.assertRaises(ScopeMismatchError):
            fresh.relation_command(
                self._relation_command("attach", self.notes, "wrong-scope", revision)
            )

    def test_schema_v3_project_cannot_authorize_an_unbound_attached_store(self) -> None:
        attached_db = os.path.join(self.directory.name, "attached.sqlite3")
        os.environ["VALKAMA_DB"] = attached_db
        attached = store.connect()
        planning_service.create_planning_space(
            attached, project_id="attached", name="Attached Space", key="ATT"
        )
        planning_service.create_work_item(attached, space="ATT", title="Attached item")
        attached.commit()
        attached_scope_id = read_store_metadata(attached)["data_scope_id"]
        attached.close()
        os.environ["VALKAMA_DB"] = self.db
        scopes.attach(self.db, "attached", attached_db)
        fresh = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        with self.assertRaises(ScopeMismatchError):
            self._authorize(
                fresh,
                self.notes,
                data_scope_ids=[self.data_scope_id, attached_scope_id],
            )

    def test_independent_provider_failure_does_not_change_the_core_contract(self) -> None:
        self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        self.platform.relation_command(
            self._relation_command("attach", self.notes, "fail-note", revision)
        )
        resource = self._resource(self.notes, "fail-note")
        with self.assertRaises(ProviderUnavailableError):
            self.platform.invoke_action(
                {
                    "interface_version": "valkama-action-command",
                    "action_ref": self.notes.action_ref("open"),
                    "invocation_context": self._context(resource),
                    "input": {"entity_ref": self.entity_ref, "resource_ref": resource},
                    "confirmation": True,
                }
            )

    def test_connection_and_adapter_tombstones_preserve_existing_pointer(self) -> None:
        self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        self.platform.relation_command(
            self._relation_command("attach", self.notes, "durable-note", revision)
        )
        removed_connection = self.platform.remove_connection(self.notes.connection_ref)
        self.assertEqual("tombstoned", removed_connection["state"])
        after_connection = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        relation = after_connection.planning_work_item_payload(
            self._query(
                data_scope_id=self.data_scope_id,
                space_key="EXA",
                reference=self.item["reference"],
            ),
            planning_service.get_work_item,
        )["state"]["payload"]["relations"]["relations"][0]
        self.assertEqual("durable-note", relation["target"]["external_id"])
        self.assertEqual("unavailable", relation["state"])
        self.assertEqual([], relation["actions"])
        self.assertEqual(
            1,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_adapter_links WHERE external_id='durable-note'"
            ).fetchone()[0],
        )

        removed_adapter = after_connection.remove_adapter(self.notes.adapter_lineage_id)
        self.assertEqual("tombstoned", removed_adapter["state"])
        after_adapter = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        registry = after_adapter.registry_payload(self._query())["state"]["payload"]
        notes_adapter = next(
            item
            for item in registry["adapters"]
            if item["adapter_lineage_id"] == self.notes.adapter_lineage_id
        )
        self.assertEqual("tombstoned", notes_adapter["state"])
        self.assertFalse(
            any(item["owner_id"] == self.notes.adapter_lineage_id for item in registry["actions"])
        )
        self.assertTrue(
            all(
                item["state"] == "revoked"
                for item in registry["grants"]
                if item["adapter_lineage_id"] == self.notes.adapter_lineage_id
            )
        )
        self.assertEqual(
            1,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_adapter_links WHERE external_id='durable-note'"
            ).fetchone()[0],
        )

    def test_disabled_assignment_and_revoked_grants_hide_forbidden_actions(self) -> None:
        configured = self._authorize(self.platform, self.notes)
        revision = planning_service.get_work_item(self.conn, self.item["reference"])["revision"]
        self.platform.relation_command(
            self._relation_command("attach", self.notes, "stateful-note", revision)
        )
        disabled_result = self.platform.set_assignment_activation(
            configured["assignment_id"], "disabled"
        )
        self.assertEqual(2, disabled_result["revision"])
        disabled = self.platform.planning_work_item_payload(
            self._query(
                data_scope_id=self.data_scope_id,
                space_key="EXA",
                reference=self.item["reference"],
            ),
            planning_service.get_work_item,
        )["state"]["payload"]["relations"]["relations"][0]
        self.assertEqual("unavailable", disabled["state"])
        self.assertEqual([], disabled["actions"])

        enabled_result = self.platform.set_assignment_activation(
            configured["assignment_id"], "enabled"
        )
        self.assertEqual(3, enabled_result["revision"])
        self.platform.revoke_grant(configured["grant_ids"]["resource.open"])
        self.platform.revoke_grant(configured["grant_ids"]["relation.remove"])
        revoked = self.platform.planning_work_item_payload(
            self._query(
                data_scope_id=self.data_scope_id,
                space_key="EXA",
                reference=self.item["reference"],
            ),
            planning_service.get_work_item,
        )["state"]["payload"]["relations"]["relations"][0]
        self.assertEqual("unavailable", revoked["state"])
        self.assertEqual([], revoked["actions"])

    def test_lifecycle_audit_failure_rolls_back_assignment_change(self) -> None:
        configured = self._authorize(self.platform, self.notes)
        original_audit = self.platform._audit

        def fail_audit(*_args, **_kwargs):
            raise RuntimeError("forced lifecycle audit failure")

        self.platform._audit = fail_audit
        try:
            with self.assertRaises(RuntimeError):
                self.platform.set_assignment_activation(configured["assignment_id"], "disabled")
        finally:
            self.platform._audit = original_audit
        record = json.loads(
            self.conn.execute(
                "SELECT record_json FROM platform_assignments WHERE assignment_id=?",
                (configured["assignment_id"],),
            ).fetchone()[0]
        )
        self.assertEqual("enabled", record["state"])
        revision = self.conn.execute(
            "SELECT revision FROM platform_assignments WHERE assignment_id=?",
            (configured["assignment_id"],),
        ).fetchone()[0]
        self.assertEqual(1, revision)

    def test_persisted_core_ref_owner_cannot_be_silently_taken_over(self) -> None:
        row = self.conn.execute(
            "SELECT record_json FROM platform_core_ref_bindings WHERE core_ref_kind='memory'"
        ).fetchone()
        binding = json.loads(row[0])
        binding.update(
            {
                "service_ref": self.notes.service_ref,
                "adapter_lineage_id": self.notes.adapter_lineage_id,
                "connection_id": self.notes.connection_ref["connection_id"],
            }
        )
        self.conn.execute(
            "UPDATE platform_core_ref_bindings SET record_json=? WHERE core_ref_kind='memory'",
            (json.dumps(binding, sort_keys=True),),
        )
        self.conn.commit()
        with self.assertRaises(RegistryError):
            platform_core.Platform(
                self.conn,
                self.db,
                registry_reader=Path(self.registry_path).read_bytes,
                providers=self.providers,
            )

    def test_legacy_platform_api_has_no_second_owner(self) -> None:
        self.assertIsNone(improvements_api.handle_get(self.db, "/api/modules", {}))
        self.assertIsNone(platform_core.handle_get(self.conn, self.db, "/api/integrations", {}))

    def test_context_reports_absent_ui_prefs_as_null(self) -> None:
        payload = self.platform.context_payload({"scope_kind": ["global"]})
        self.assertIsNone(payload["state"]["payload"]["ui_prefs"])

    def test_ui_prefs_round_trip_through_context(self) -> None:
        result = self.platform.save_ui_prefs(
            {
                "interface_version": "valkama-ui-prefs",
                "module_id": "planning",
                "scope": self.project_scope,
                "resource_ref": planning_space_entity(self.item_ref["space_ref"]),
            }
        )
        self.assertEqual(result["interface_version"], "valkama-ui-prefs")
        self.assertEqual(result["prefs"]["module_id"], "planning")
        payload = self.platform.context_payload({"scope_kind": ["global"]})
        prefs = payload["state"]["payload"]["ui_prefs"]
        self.assertEqual(prefs["scope"], self.project_scope)
        self.assertEqual(prefs["resource_ref"], planning_space_entity(self.item_ref["space_ref"]))

    def test_ui_prefs_persist_across_platform_restart(self) -> None:
        self.platform.save_ui_prefs(
            {
                "interface_version": "valkama-ui-prefs",
                "module_id": "skills",
                "scope": {"kind": "global"},
            }
        )
        restarted = platform_core.Platform(
            self.conn,
            self.db,
            registry_reader=Path(self.registry_path).read_bytes,
            providers=self.providers,
        )
        prefs = restarted.ui_prefs_record()
        self.assertEqual(prefs, {"module_id": "skills", "scope": {"kind": "global"}})

    def test_ui_prefs_reject_unknown_module_version_and_fields(self) -> None:
        with self.assertRaises(platform_core.PlatformHttpError):
            self.platform.save_ui_prefs(
                {
                    "interface_version": "valkama-ui-prefs",
                    "module_id": "not-a-module",
                    "scope": {"kind": "global"},
                }
            )
        with self.assertRaises(platform_core.PlatformHttpError):
            self.platform.save_ui_prefs(
                {
                    "interface_version": "valkama-ui-prefs-unknown",
                    "module_id": "planning",
                    "scope": {"kind": "global"},
                }
            )
        with self.assertRaises(platform_core.ContractError):
            self.platform.save_ui_prefs(
                {
                    "interface_version": "valkama-ui-prefs",
                    "module_id": "planning",
                    "scope": {"kind": "global"},
                    "surprise": True,
                }
            )
        with self.assertRaises(platform_core.ContractError):
            self.platform.save_ui_prefs(
                {
                    "interface_version": "valkama-ui-prefs",
                    "module_id": "planning",
                    "scope": self.project_scope,
                    "space_ref": self.item_ref["space_ref"],
                }
            )
        self.assertIsNone(self.platform.ui_prefs_record())

    def test_corrupt_or_stale_ui_prefs_row_reads_as_null(self) -> None:
        self.conn.execute(
            "INSERT INTO platform_ui_prefs(key,record_json,updated_at)"
            " VALUES('last-route','{not json',?)",
            (platform_core._now(),),
        )
        self.conn.commit()
        self.assertIsNone(self.platform.ui_prefs_record())
        self.conn.execute(
            "UPDATE platform_ui_prefs SET record_json=?",
            (json.dumps({"module_id": "gone-module", "scope": {"kind": "global"}}),),
        )
        self.conn.commit()
        self.assertIsNone(self.platform.ui_prefs_record())
        payload = self.platform.context_payload({"scope_kind": ["global"]})
        self.assertIsNone(payload["state"]["payload"]["ui_prefs"])

    def test_http_assignment_activation_and_grant_revoke_commands(self) -> None:
        authorized = self._authorize(self.platform, self.notes)
        grant_ids = authorized["grant_ids"]
        assignment_id = authorized["assignment_id"]
        status, payload = platform_core.handle_post(
            self.conn,
            self.db,
            "/api/platform/assignments/activation",
            {
                "interface_version": "valkama-assignment-activation",
                "assignment_id": assignment_id,
                "state": "disabled",
            },
            providers=self.providers,
        )
        self.assertEqual(200, status)
        self.assertEqual("disabled", payload["assignment"]["state"])
        self.assertEqual(2, payload["assignment"]["revision"])

        activated = self.platform.assignment_activation_command(
            {
                "interface_version": "valkama-assignment-activation",
                "assignment_id": assignment_id,
                "state": "enabled",
            }
        )
        self.assertEqual(3, activated["assignment"]["revision"])

        with self.assertRaises(platform_core.ContractError):
            self.platform.assignment_activation_command(
                {
                    "interface_version": "valkama-assignment-activation",
                    "assignment_id": assignment_id,
                    "state": "enabled",
                    "extra": True,
                }
            )

        grant_id = grant_ids["relation.attach"]
        status, revoked = platform_core.handle_post(
            self.conn,
            self.db,
            "/api/platform/grants/revoke",
            {"interface_version": "valkama-grant-revoke", "grant_id": grant_id},
            providers=self.providers,
        )
        self.assertEqual(200, status)
        self.assertEqual("revoked", revoked["grant"]["state"])
        ready = self.platform.registry_payload(self._query())["state"]["payload"]
        target = next(item for item in ready["grants"] if item["grant_id"] == grant_id)
        self.assertFalse(target["active"])

    def test_handle_post_owns_the_ui_prefs_path(self) -> None:
        status, payload = platform_core.handle_post(
            self.conn,
            self.db,
            "/api/platform/ui-prefs",
            {
                "interface_version": "valkama-ui-prefs",
                "module_id": "planning",
                "scope": {"kind": "global"},
            },
            providers=self.providers,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["prefs"]["module_id"], "planning")


class PlatformHttpBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.directory.name, "http.sqlite3")
        self.registry = os.path.join(self.directory.name, "projects.json")
        self.previous_db = os.environ.get("VALKAMA_DB")
        os.environ["VALKAMA_DB"] = self.db
        with open(self.registry, "w", encoding="utf-8") as handle:
            json.dump({"projects": []}, handle)
        self.registry_reader_patch = mock.patch.object(
            platform_core.project_registry,
            "_read_registry_bytes",
            new=Path(self.registry).read_bytes,
        )
        self.registry_reader_patch.start()
        store.connect().close()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=Path(self.directory.name) / "installation-token",
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.write_headers = {
            "Content-Type": "application/json",
            "Origin": f"http://127.0.0.1:{self.server.server_port}",
            "X-Valkama-Session": self.server.security_context.browser_session_token,
        }

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.registry_reader_patch.stop()
        if self.previous_db is None:
            os.environ["VALKAMA_DB"] = SUITE_STORE
        else:
            os.environ["VALKAMA_DB"] = self.previous_db
        self.directory.cleanup()

    def _get(self, path):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request("GET", path)
            response = client.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            client.close()

    def _post(self, path, payload):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request(
                "POST",
                path,
                body=json.dumps(payload).encode("utf-8"),
                headers=self.write_headers,
            )
            response = client.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            client.close()

    def _put(self, path, payload):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request(
                "PUT",
                path,
                body=json.dumps(payload).encode("utf-8"),
                headers=self.write_headers,
            )
            response = client.getresponse()
            return response.status, response.getheader("Content-Type"), response.read()
        finally:
            client.close()

    def _open_action_fixture(self):
        conn = store.connect()
        try:
            planning_service.create_planning_space(
                conn, project_id="example-project", name="Example Space", key="EXA"
            )
            card = planning_service.create_work_item(
                conn, space="EXA", title="HTTP confirmation item"
            )
            conn.commit()
            data_scope_id = read_store_metadata(conn)["data_scope_id"]
            binding = {
                "project_id": "example-project",
                "resource_ref": planning_space_entity(
                    {"data_scope_id": data_scope_id, "space_key": "EXA"}
                ),
                "registry_revision": 1,
                "source_owner": "example-project",
                "source_hash": SOURCE_HASH,
            }
            Path(self.registry).write_bytes(
                registry_bytes(
                    [
                        project_entry(
                            "example-project",
                            self.directory.name,
                            board="Example Board",
                            bindings=[binding],
                            source_hash=SOURCE_HASH,
                        )
                    ]
                )
            )
            notes = NotesReferenceProvider()
            platform = platform_core.Platform(
                conn,
                self.db,
                registry_reader=Path(self.registry).read_bytes,
                providers=ProviderCatalog([notes]),
            )
            project_scope = {
                "kind": "project",
                "project_ref": {"project_id": "example-project"},
            }
            item_ref = {
                "space_ref": {"data_scope_id": data_scope_id, "space_key": "EXA"},
                "reference": card["reference"],
            }
            resource = {
                "connection_ref": notes.connection_ref,
                "resource_type": notes.resource_type,
                "external_id": "http-confirmed-note",
            }
            context = {
                "view_scope": project_scope,
                "invocation_scope": project_scope,
                "target": resource,
            }
            platform.set_connection_trust(notes.connection_ref, "trusted", changed_by="test-owner")
            platform.register_assignment(
                {
                    "assignment_id": "http-notes-assignment",
                    "capability_id": "memory.open",
                    "scope": {"kind": "project", "project_id": "example-project"},
                    "connection_ids": [
                        ":".join(
                            (
                                notes.connection_ref["service_ref"]["owner_id"],
                                notes.connection_ref["service_ref"]["service_id"],
                                notes.connection_ref["adapter_lineage_id"],
                                notes.connection_ref["connection_id"],
                            )
                        )
                    ],
                    "state": "enabled",
                    "changed_by": "test-owner",
                }
            )
            for permission in ("relation.attach", "resource.open"):
                platform.grant_permission(
                    {
                        "grant_id": f"http-{permission.replace('.', '-')}",
                        "adapter_lineage_id": notes.adapter_lineage_id,
                        "connection_ref": notes.connection_ref,
                        "permission_id": permission,
                        "applicability": project_scope,
                        "entity_kinds": ["adapter-resource"],
                        "data_scope_ids": [data_scope_id],
                        "granted_by": "test-owner",
                        "granted_at": "2026-08-13T00:00:00Z",
                        "revision": 1,
                        "active": True,
                    }
                )
            platform.relation_command(
                {
                    "interface_version": "valkama-relation-command",
                    "operation": "attach",
                    "entity_ref": planning_work_item_entity(item_ref),
                    "resource_ref": resource,
                    "invocation_context": context,
                    "action_ref": notes.action_ref("attach"),
                    "expected_revision": card["revision"],
                    "fallback_label": resource["external_id"],
                    "confirmation": True,
                }
            )
            return conn, {
                "interface_version": "valkama-action-command",
                "action_ref": notes.action_ref("open"),
                "invocation_context": context,
                "input": {
                    "entity_ref": planning_work_item_entity(item_ref),
                    "resource_ref": resource,
                },
            }
        except Exception:
            conn.close()
            raise

    def test_replacement_module_endpoint_and_legacy_integration_404(self) -> None:
        status, content_type, body = self._get("/api/modules")
        self.assertEqual(200, status)
        self.assertEqual("application/json", content_type)
        self.assertEqual("valkama-modules", json.loads(body)["interface_version"])
        self.assertEqual(404, self._get("/api/integrations")[0])
        self.assertEqual(404, self._post("/api/integrations/agentmemory", {})[0])

    def test_platform_get_and_post_boundaries_are_normalized(self) -> None:
        for path, version in (
            ("/api/platform/context?scope_kind=global", "valkama-context"),
            ("/api/platform/registry?scope_kind=global", "valkama-registry"),
            ("/api/platform/planning?scope_kind=global", "valkama-planning"),
        ):
            with self.subTest(path=path):
                status, content_type, body = self._get(path)
                self.assertEqual(200, status)
                self.assertEqual("application/json", content_type)
                self.assertEqual(version, json.loads(body)["interface_version"])
        status, content_type, body = self._post("/api/platform/relations", {})
        self.assertEqual(400, status)
        self.assertEqual("application/json", content_type)
        self.assertEqual("error", json.loads(body)["status"])

    def test_owned_http_reads_put_and_sse_refuse_when_modules_are_disabled(self) -> None:
        conn = store.connect()
        try:
            platform = platform_core.Platform(conn, self.db)
            for module_id in ("planning", "sessions", "analytics", "improvements"):
                platform.module_state_command(
                    {"module_id": module_id, "state": "disabled", "expected_revision": 1}
                )
        finally:
            conn.close()
        for path in (
            "/api/planning",
            "/api/planning/spaces",
            "/api/dashboard",
            "/api/scopes",
            "/api/sessions",
            "/api/events?view=planning",
            "/api/events?view=dashboard",
            "/api/events?view=sessions",
            "/api/events?view=improvements&scope=personal",
        ):
            with self.subTest(path=path):
                self.assertEqual(409, self._get(path)[0])
        self.assertEqual(
            409,
            self._put("/api/modules/improvements/profile", {"scope": "personal"})[0],
        )

    def test_unknown_sse_view_is_rejected(self) -> None:
        self.assertEqual(400, self._get("/api/events?view=not-registered")[0])

    def test_open_sse_stream_terminates_after_module_is_disabled(self) -> None:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            client.request("GET", "/api/events?view=sessions")
            response = client.getresponse()
            self.assertEqual(200, response.status)
            self.assertTrue(response.readline().startswith(b"data: "))
            self.assertEqual(b"\n", response.readline())
            conn = store.connect()
            try:
                platform_core.Platform(conn, self.db).module_state_command(
                    {"module_id": "sessions", "state": "disabled", "expected_revision": 1}
                )
            finally:
                conn.close()
            self.assertEqual(b"", response.readline())
        finally:
            client.close()

    def test_open_action_http_requires_literal_confirmation(self) -> None:
        conn, command = self._open_action_fixture()
        try:
            before_audit = conn.execute(
                "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
            ).fetchone()[0]
            provider_calls = []
            original_open = NotesReferenceProvider.open_target

            def tracked_open(provider, resource):
                provider_calls.append(resource)
                return original_open(provider, resource)

            with mock.patch.object(
                NotesReferenceProvider,
                "open_target",
                new=tracked_open,
            ):
                for label, confirmation in (
                    ("missing", None),
                    ("false", False),
                    ("string", "true"),
                    ("number", 1),
                ):
                    invalid = dict(command)
                    if label != "missing":
                        invalid["confirmation"] = confirmation
                    with self.subTest(confirmation=label):
                        status, content_type, body = self._post(
                            "/api/platform/actions/invoke", invalid
                        )
                        self.assertEqual(400, status)
                        self.assertEqual("application/json", content_type)
                        self.assertEqual("error", json.loads(body)["status"])
                self.assertEqual([], provider_calls)
                self.assertEqual(
                    before_audit,
                    conn.execute(
                        "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
                    ).fetchone()[0],
                )

                status, content_type, body = self._post(
                    "/api/platform/actions/invoke", {**command, "confirmation": True}
                )
                self.assertEqual(200, status)
                self.assertEqual("application/json", content_type)
                result = json.loads(body)
                self.assertEqual(
                    "https://notes.invalid/resource/http-confirmed-note",
                    result["target"]["uri"],
                )
                self.assertEqual(1, len(provider_calls))
            self.assertEqual(
                before_audit + 1,
                conn.execute(
                    "SELECT COUNT(*) FROM platform_registry_audit WHERE event_kind='action.invoked'"
                ).fetchone()[0],
            )
        finally:
            conn.close()

    def test_only_canonical_extensionless_platform_routes_receive_spa_fallback(self) -> None:
        status, content_type, _ = self._get("/modules/planning/global")
        self.assertEqual(200, status)
        self.assertEqual("text/html; charset=utf-8", content_type)
        unknown_status, unknown_type, _ = self._get("/modules/not-a-module/global")
        self.assertEqual(200, unknown_status)
        self.assertEqual("text/html; charset=utf-8", unknown_type)
        self.assertEqual(404, self._get("/modules/not_a_module/global")[0])
        self.assertEqual(404, self._get("/modules/planning/global.js")[0])
        self.assertEqual(404, self._get("/modules/adapter.notes/global")[0])
        self.assertEqual(404, self._get("/modules/../planning/global")[0])
        self.assertEqual(404, self._get("/assets/not-present.js")[0])


if __name__ == "__main__":
    unittest.main()
