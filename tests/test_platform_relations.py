import sqlite3
import unittest

from server.platform.registry import PlatformRegistry
from server.platform.relations import (
    RelationConflictError,
    RelationError,
    RelationMigrationError,
    RelationRevisionConflictError,
    add_adapter_link,
    ensure_relation_schema,
    links_need_work_items,
    migrate_links_to_work_items,
    read_adapter_links,
    read_relations,
    remove_adapter_link,
)
from server.platform.scope import ensure_store_metadata


def service_ref():
    return {"owner_id": "provider-owner", "service_id": "provider"}


def resource_ref(lineage="provider-lineage", connection_id="connection-1", external_id="record-1"):
    return {
        "connection_ref": {
            "service_ref": service_ref(),
            "adapter_lineage_id": lineage,
            "connection_id": connection_id,
        },
        "resource_type": "record",
        "external_id": external_id,
    }


def manifest():
    return {
        "contract_version": "valkama-adapter",
        "adapter_id": "provider-reference",
        "version": "1.0.0",
        "title_key": "adapter.provider",
        "package_id": "provider-package",
        "publisher_id": "provider-publisher",
        "owner_id": "provider-owner",
        "configuration_owner": "provider-owner",
        "trust_owner": "provider-owner",
        "execution": "local_service",
        "supported_service_types": ["knowledge"],
        "capabilities": ["memory.open"],
        "consumes": ["work-item"],
        "contributions": [
            {
                "interface_version": "valkama-contributions",
                "contribution_id": "provider.relation",
                "owner_kind": "adapter",
                "owner_id": "provider-reference",
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
        "health_contract": {"timeout_ms": 1000, "max_payload_bytes": 1000},
        "direct_read": False,
    }


def registry(*, trust="trusted", health="ready", state="registered"):
    result = PlatformRegistry(lineage_factory=lambda: "provider-lineage")
    result.register_service(
        {
            "service_ref": service_ref(),
            "service_type": "knowledge",
            "title_key": "service.provider",
            "configuration_owner": "provider-owner",
            "trust_owner": "provider-owner",
            "discovery_provenance": "test",
            "state": "registered",
            "direct_read": False,
        }
    )
    result.register_adapter(manifest())
    result.register_connection(
        {
            "connection_ref": resource_ref()["connection_ref"],
            "applicability": {"kind": "global"},
            "configuration_owner": "provider-owner",
            "trust_owner": "provider-owner",
            "trust": trust,
            "health": health,
            "state": state,
        }
    )
    return result


class RelationTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        # The minimum a link needs to point at: one space, one item, and the
        # event log a write appends to.
        self.conn.executescript("""
            CREATE TABLE planning_spaces(
                planning_space_id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL
            );
            CREATE TABLE work_items(
                work_item_id TEXT PRIMARY KEY,
                planning_space_id TEXT NOT NULL,
                number INTEGER NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE work_item_events(
                id INTEGER PRIMARY KEY,
                work_item_id TEXT NOT NULL,
                author TEXT NOT NULL,
                action TEXT NOT NULL CHECK(action IN ('linked','unlinked')),
                detail TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            );
            INSERT INTO planning_spaces VALUES ('space-1','MAIN','Main');
            INSERT INTO work_items(work_item_id,planning_space_id,number,revision)
              VALUES ('item-1','space-1',1,0);
        """)
        self.metadata = ensure_store_metadata(self.conn, owner_id="valkama-owner")
        self.item = {
            "space_ref": {
                "data_scope_id": self.metadata["data_scope_id"],
                "space_key": "MAIN",
            },
            "reference": "MAIN-1",
        }
        self.registry = registry()
        ensure_relation_schema(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_helpers_require_explicit_connection_and_are_additive(self):
        with self.assertRaises(TypeError):
            ensure_relation_schema(None)
        tables = {
            row[0] for row in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertIn("platform_adapter_links", tables)
        self.assertNotIn("hub_adapter_tombstones", tables)

    def test_a_link_naming_a_card_the_migration_did_not_carry_is_refused(self):
        """The conversion never guesses which item an unmapped card became."""

        self.conn.executescript("""
            DROP TABLE platform_adapter_links;
            CREATE TABLE platform_adapter_links(
                id INTEGER PRIMARY KEY,
                data_scope_id TEXT NOT NULL,
                board_name TEXT NOT NULL,
                card_id INTEGER NOT NULL,
                service_owner_id TEXT NOT NULL,
                service_id TEXT NOT NULL,
                adapter_lineage_id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                external_id TEXT NOT NULL,
                fallback_label TEXT NOT NULL DEFAULT '',
                provenance_json TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'resolved',
                created_at TEXT NOT NULL
            );
        """)
        self.conn.execute(
            "INSERT INTO platform_adapter_links VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                7,
                self.metadata["data_scope_id"],
                "Main",
                999,
                "provider-owner",
                "provider",
                "provider-lineage",
                "connection-1",
                "record",
                "orphan",
                "Orphan",
                '{"source_kind":"test","observed_at":"2026-08-13T00:00:00Z"}',
                "resolved",
                "2026-08-13T00:00:00Z",
            ),
        )
        self.conn.commit()
        self.assertTrue(links_need_work_items(self.conn))
        with self.assertRaises(RelationMigrationError):
            migrate_links_to_work_items(self.conn, {}, {})
        # Refused before mutation: the row is exactly as it was written.
        self.assertEqual(
            (7, 999, "orphan"),
            tuple(
                self.conn.execute(
                    "SELECT id,card_id,external_id FROM platform_adapter_links"
                ).fetchone()
            ),
        )

    def test_a_mapped_link_moves_with_its_item(self):
        self.conn.executescript("""
            DROP TABLE platform_adapter_links;
            CREATE TABLE platform_adapter_links(
                id INTEGER PRIMARY KEY,
                data_scope_id TEXT NOT NULL,
                board_name TEXT NOT NULL,
                card_id INTEGER NOT NULL,
                service_owner_id TEXT NOT NULL,
                service_id TEXT NOT NULL,
                adapter_lineage_id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                external_id TEXT NOT NULL,
                fallback_label TEXT NOT NULL DEFAULT '',
                provenance_json TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'resolved',
                created_at TEXT NOT NULL
            );
        """)
        self.conn.execute(
            "INSERT INTO platform_adapter_links VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                7,
                self.metadata["data_scope_id"],
                "Main",
                42,
                "provider-owner",
                "provider",
                "provider-lineage",
                "connection-1",
                "record",
                "carried",
                "Carried",
                '{"source_kind":"test","observed_at":"2026-08-13T00:00:00Z"}',
                "resolved",
                "2026-08-13T00:00:00Z",
            ),
        )
        self.conn.commit()
        moved = migrate_links_to_work_items(self.conn, {42: "item-1"}, {42: "MAIN"})
        self.assertEqual(1, moved)
        row = self.conn.execute(
            "SELECT space_key, work_item_id, external_id FROM platform_adapter_links"
        ).fetchone()
        self.assertEqual(("MAIN", "item-1", "carried"), tuple(row))
        self.assertFalse(links_need_work_items(self.conn))

    def test_link_round_trip_is_atomic_and_preserves_exact_provider_identity(self):
        link = add_adapter_link(
            self.conn,
            self.item,
            resource_ref(),
            expected_revision=0,
            fallback_label="Provider record",
            provenance={
                "source_kind": "independent-provider",
                "observed_at": "2026-08-13T00:00:00Z",
            },
        )
        self.assertEqual("provider-lineage", link["target"]["connection_ref"]["adapter_lineage_id"])
        self.assertEqual(1, link["work_item_revision"])
        self.assertEqual(1, len(read_adapter_links(self.conn, self.item, registry=self.registry)))
        self.assertEqual(1, self.conn.execute("SELECT revision FROM work_items").fetchone()[0])
        self.assertEqual(
            "linked", self.conn.execute("SELECT action FROM work_item_events").fetchone()[0]
        )
        with self.assertRaises(RelationConflictError):
            add_adapter_link(self.conn, self.item, resource_ref(), expected_revision=1)
        self.assertEqual(1, self.conn.execute("SELECT revision FROM work_items").fetchone()[0])
        self.assertEqual(
            1, self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        )

    def test_removed_adapter_keeps_pointer_but_explicit_registry_makes_it_unavailable(self):
        adapter_registry = registry()
        add_adapter_link(self.conn, self.item, resource_ref(), expected_revision=0)
        adapter_registry.remove_adapter("provider-lineage")
        links = read_adapter_links(self.conn, self.item, registry=adapter_registry)
        self.assertEqual("unavailable", links[0]["state"])
        self.assertEqual(
            "provider-lineage", links[0]["target"]["connection_ref"]["adapter_lineage_id"]
        )
        relation = read_relations(self.conn, self.item, registry=adapter_registry)[0]
        self.assertEqual("provider-reference", relation["provider"]["adapter_id"])
        self.assertEqual("1.0.0", relation["provider"]["adapter_version"])

    def test_relation_resolution_requires_explicit_registry_state(self):
        with self.assertRaises(TypeError):
            read_relations(self.conn, self.item)

    def test_relation_output_matches_frontend_grammar_and_preserves_core_refs(self):
        self.conn.execute(
            "CREATE TABLE work_item_refs(id INTEGER PRIMARY KEY, work_item_id TEXT,"
            " kind TEXT, value TEXT, label TEXT, author TEXT, created_at TEXT)"
        )
        self.conn.execute(
            "INSERT INTO work_item_refs(work_item_id,kind,value,label,author,created_at)"
            " VALUES ('item-1','memory','memory-record-1','Memory pointer','agent',"
            " '2026-08-13T00:00:00Z')"
        )
        self.conn.commit()
        adapter_registry = registry()
        add_adapter_link(
            self.conn,
            self.item,
            resource_ref(external_id="independent-1"),
            expected_revision=0,
            fallback_label="Independent",
        )
        adapter_registry.bind_core_ref_resolver(
            "memory", service_ref(), "provider-lineage", "connection-1"
        )
        relations = read_relations(self.conn, self.item, registry=adapter_registry)
        self.assertEqual({"external-resource", "reference"}, {item["kind"] for item in relations})
        memory = next(item for item in relations if item["kind"] == "reference")
        self.assertEqual("valkama-ref-memory", memory["provenance"]["source_kind"])
        self.assertEqual("unavailable", memory["state"])
        self.assertEqual([], memory["actions"])
        self.assertEqual(1, self.conn.execute("SELECT COUNT(*) FROM work_item_refs").fetchone()[0])

    def test_core_memory_resolution_requires_live_safe_registry_binding(self):
        self.conn.execute(
            "CREATE TABLE work_item_refs(id INTEGER PRIMARY KEY, work_item_id TEXT,"
            " kind TEXT, value TEXT, label TEXT, author TEXT, created_at TEXT)"
        )
        self.conn.execute(
            "INSERT INTO work_item_refs(work_item_id,kind,value,label,author,created_at)"
            " VALUES ('item-1','memory','memory-record-1','Memory pointer','agent',"
            " '2026-08-13T00:00:00Z')"
        )
        self.conn.commit()
        self.assertEqual(
            "unavailable", read_relations(self.conn, self.item, registry=self.registry)[0]["state"]
        )
        for trust, health, state in (
            ("restricted", "ready", "registered"),
            ("trusted", "degraded", "registered"),
            ("trusted", "ready", "invalid"),
        ):
            with self.subTest(trust=trust, health=health, state=state):
                candidate = registry(trust=trust, health=health, state=state)
                candidate.bind_core_ref_resolver(
                    "memory", service_ref(), "provider-lineage", "connection-1"
                )
                relation = read_relations(self.conn, self.item, registry=candidate)[0]
                self.assertEqual("unavailable", relation["state"])
        removed = registry()
        removed.bind_core_ref_resolver("memory", service_ref(), "provider-lineage", "connection-1")
        removed.remove_adapter("provider-lineage")
        self.assertEqual(
            "unavailable", read_relations(self.conn, self.item, registry=removed)[0]["state"]
        )

    def test_delete_requires_exact_revision_and_records_activity(self):
        add_adapter_link(self.conn, self.item, resource_ref(), expected_revision=0)
        result = remove_adapter_link(self.conn, self.item, resource_ref(), expected_revision=1)
        self.assertEqual({"removed": True, "work_item_revision": 2}, result)
        self.assertEqual([], read_adapter_links(self.conn, self.item, registry=self.registry))
        self.assertEqual(
            ["linked", "unlinked"],
            [
                row[0]
                for row in self.conn.execute("SELECT action FROM work_item_events ORDER BY id")
            ],
        )

    def test_wrong_scope_missing_item_and_stale_revision_fail_closed(self):
        wrong_scope = {
            "space_ref": {
                **self.item["space_ref"],
                "data_scope_id": "abcdefab-cdef-4abc-8def-abcdefabcdef",
            },
            "reference": "MAIN-1",
        }
        with self.assertRaises(RelationError):
            add_adapter_link(self.conn, wrong_scope, resource_ref(), expected_revision=0)
        missing = {**self.item, "reference": "MAIN-999"}
        with self.assertRaises(RelationError):
            add_adapter_link(self.conn, missing, resource_ref(), expected_revision=0)
        with self.assertRaises(RelationRevisionConflictError):
            add_adapter_link(self.conn, self.item, resource_ref(), expected_revision=9)
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM platform_adapter_links").fetchone()[0]
        )

    def test_activity_failure_rolls_back_link_and_revision(self):
        self.conn.execute("""CREATE TRIGGER reject_platform_activity BEFORE INSERT ON work_item_events
            WHEN NEW.detail LIKE 'adapter-resource %'
            BEGIN SELECT RAISE(ABORT, 'activity refused'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            add_adapter_link(self.conn, self.item, resource_ref(), expected_revision=0)
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM platform_adapter_links").fetchone()[0]
        )
        self.assertEqual(0, self.conn.execute("SELECT revision FROM work_items").fetchone()[0])
        self.assertEqual(
            0, self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0]
        )


if __name__ == "__main__":
    unittest.main()
