from __future__ import annotations

import glob
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import unittest
from unittest import mock

from server import store, store_backups, store_lock
from server.platform import capabilities
from server.platform import core as platform_core
from server.platform import migrations as platform_migrations
from server.platform.contracts import (
    CAPABILITY_IDS,
    ENTITY_KINDS,
    ContractError,
    planning_space_entity,
    planning_space_ref,
    validate_assignment,
    validate_entity_ref,
)
from server.platform.scope import read_store_metadata
from tests import board_era
from tests.registry_fixtures import project_binding, project_entry, registry_bytes


def _connection_id(ref: dict) -> str:
    return ":".join(
        (
            ref["service_ref"]["owner_id"],
            ref["service_ref"]["service_id"],
            ref["adapter_lineage_id"],
            ref["connection_id"],
        )
    )


def _reference_connection(owner_id: str, adapter_lineage_id: str) -> dict:
    return {
        "connection_ref": {
            "service_ref": {"owner_id": owner_id, "service_id": "svc"},
            "adapter_lineage_id": adapter_lineage_id,
            "connection_id": "singleton",
        },
        "applicability": {"kind": "global"},
        "state": "registered",
        "trust": "trusted",
        "health": "ready",
        "trust_owner": owner_id,
        "configuration_owner": owner_id,
    }


class ProductModelMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")
        # This suite builds a pre-4 store and migrates it, so the conversion is
        # a deliberate act and says so: `connect()` refuses one otherwise.
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path, store.CUTOVER_ENV: "1"})
        patch.start()
        self.addCleanup(patch.stop)
        conn = store.connect()
        resource_ref = planning_space_entity(
            {
                "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                "space_key": "MIG",
            }
        )
        registry = registry_bytes(
            [
                project_entry(
                    "migration",
                    self.directory.name,
                    board="Presentation only",
                    bindings=[project_binding("migration", resource_ref)],
                )
            ]
        )
        registry_patch = mock.patch.object(
            store.project_registry, "_read_registry_bytes", return_value=registry
        )
        registry_patch.start()
        self.addCleanup(registry_patch.stop)
        board_id = board_era.seed(conn, "Migration")
        card = {"id": board_era.add_card(conn, board_id, "Preserved")}
        conn.execute(
            "INSERT INTO refs(card_id,kind,value) VALUES(?,?,?)",
            (card["id"], "url", "https://example.invalid/evidence"),
        )
        connection = json.loads(
            conn.execute(
                "SELECT record_json FROM platform_connections"
                " WHERE connection_key LIKE 'agentmemory:%'"
            ).fetchone()[0]
        )
        legacy_assignment = {
            "assignment_id": "memory-default",
            "adapter_lineage_id": "agentmemory-reference-v1",
            "applicability": {"kind": "global"},
            "connection_refs": [connection["connection_ref"]],
            "activation": "enabled",
            "revision": 7,
            "changed_by": "owner",
            "default_connection_ref": connection["connection_ref"],
        }
        conn.execute("ALTER TABLE platform_assignments RENAME TO assignments_schema4")
        conn.execute(
            """CREATE TABLE platform_assignments(
                   assignment_id TEXT PRIMARY KEY,
                   record_json TEXT NOT NULL,
                   state TEXT NOT NULL CHECK(state IN ('enabled','disabled','tombstoned')),
                   updated_at TEXT NOT NULL
               )"""
        )
        conn.execute(
            "INSERT INTO platform_assignments VALUES(?,?,?,?)",
            (
                legacy_assignment["assignment_id"],
                json.dumps(legacy_assignment, sort_keys=True),
                "enabled",
                "2026-08-20T00:00:00Z",
            ),
        )
        conn.execute("DROP TABLE assignments_schema4")
        known_store = conn.execute(
            "SELECT data_scope_id,alias,registry_revision,is_primary,is_attached,is_writable,updated_at"
            " FROM platform_known_stores"
        ).fetchone()
        self.known_store_scope = known_store["data_scope_id"]
        conn.execute("ALTER TABLE platform_known_stores RENAME TO known_stores_schema4")
        conn.execute(
            """CREATE TABLE platform_known_stores(
                   data_scope_id TEXT PRIMARY KEY,
                   alias TEXT NOT NULL,
                   boards_json TEXT NOT NULL,
                   registry_revision INTEGER NOT NULL,
                   is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
                   is_attached INTEGER NOT NULL CHECK(is_attached IN (0,1)),
                   is_writable INTEGER NOT NULL CHECK(is_writable IN (0,1)),
                   updated_at TEXT NOT NULL
               )"""
        )
        conn.execute(
            "INSERT INTO platform_known_stores VALUES(?,?,?,?,?,?,?,?)",
            (
                known_store["data_scope_id"],
                known_store["alias"],
                json.dumps(["Migration"]),
                known_store["registry_revision"],
                known_store["is_primary"],
                known_store["is_attached"],
                known_store["is_writable"],
                known_store["updated_at"],
            ),
        )
        conn.execute("DROP TABLE known_stores_schema4")
        # A released schema-3 store knew only the two reference providers.
        # Fresh schema-4 initialization now seeds additional built-ins, so
        # remove those rows before freezing this connection back to the exact
        # released source generation. The migration must add them again.
        reference_lineages = {"agentmemory-reference-v1", "notes-reference-v1"}
        for row in conn.execute("SELECT adapter_lineage_id FROM platform_adapters"):
            if row["adapter_lineage_id"] not in reference_lineages:
                conn.execute(
                    "DELETE FROM platform_adapters WHERE adapter_lineage_id=?",
                    (row["adapter_lineage_id"],),
                )
        for row in conn.execute("SELECT connection_key,record_json FROM platform_connections"):
            descriptor = json.loads(row["record_json"])
            if descriptor["connection_ref"]["adapter_lineage_id"] not in reference_lineages:
                conn.execute(
                    "DELETE FROM platform_connections WHERE connection_key=?",
                    (row["connection_key"],),
                )
        reference_services = {"agentmemory", "notes"}
        for row in conn.execute("SELECT service_key,record_json FROM platform_services"):
            descriptor = json.loads(row["record_json"])
            if descriptor["service_ref"]["service_id"] not in reference_services:
                conn.execute(
                    "DELETE FROM platform_services WHERE service_key=?", (row["service_key"],)
                )
        reference_packages = {"agentmemory.reference-adapter", "valkama.notes-reference-adapter"}
        for row in conn.execute("SELECT package_key,record_json FROM platform_packages"):
            descriptor = json.loads(row["record_json"])
            if descriptor["package_id"] not in reference_packages:
                conn.execute(
                    "DELETE FROM platform_packages WHERE package_key=?", (row["package_key"],)
                )
        legacy_capabilities = ["stable-pointer", "allowlisted-open", "generic-relation"]
        for row in conn.execute("SELECT adapter_lineage_id,record_json FROM platform_adapters"):
            manifest = json.loads(row["record_json"])
            manifest["capabilities"] = legacy_capabilities
            conn.execute(
                "UPDATE platform_adapters SET record_json=? WHERE adapter_lineage_id=?",
                (json.dumps(manifest, sort_keys=True), row["adapter_lineage_id"]),
            )
        conn.execute(
            "INSERT INTO platform_ui_prefs(key,record_json,updated_at) VALUES(?,?,?)",
            (
                "last-route",
                json.dumps(
                    {
                        "module_id": "planning",
                        "scope": {"kind": "global"},
                        # Deliberately the Board-era spelling: this is a
                        # preference a real disk holds from before the
                        # conversion, and reading it is what the migration has
                        # to do without guessing.
                        "board_ref": {
                            "data_scope_id": known_store["data_scope_id"],
                            "board_name": "Migration",
                        },
                    },
                    sort_keys=True,
                ),
                "2026-08-20T00:00:00Z",
            ),
        )
        action_input = conn.execute(
            "SELECT action_id,record_json FROM platform_action_inputs ORDER BY action_id LIMIT 1"
        ).fetchone()
        descriptor = json.loads(action_input["record_json"])
        descriptor["fields"].append(
            {"key": "card_ref", "kind": "stable-id", "required": True, "max_length": 512}
        )
        conn.execute(
            "UPDATE platform_action_inputs SET record_json=? WHERE action_id=?",
            (json.dumps(descriptor, sort_keys=True), action_input["action_id"]),
        )
        # Prove schema-4 rewrites stored manifests rather than accepting the old
        # common Board/Card vocabulary at runtime.
        for row in conn.execute("SELECT module_id,record_json FROM platform_modules"):
            manifest = json.loads(row["record_json"])
            text = (
                json.dumps(manifest).replace("planning-space", "board").replace("work-item", "card")
            )
            conn.execute(
                "UPDATE platform_modules SET record_json=? WHERE module_id=?",
                (text, row["module_id"]),
            )
        conn.execute("PRAGMA user_version=3")
        conn.commit()
        self.card_id = card["id"]
        self.connection_id = _connection_id(connection["connection_ref"])
        conn.close()

    def backups(self) -> list[str]:
        return glob.glob(
            os.path.join(self.directory.name, "backups", "*-preproductmodel-*.sqlite3")
        )

    def test_forward_only_rewrite_preserves_rows_refs_and_has_one_schema(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(
            ("Preserved", "https://example.invalid/evidence"),
            tuple(
                conn.execute(
                    "SELECT w.title,r.value FROM work_items w"
                    " JOIN work_item_refs r ON r.work_item_id=w.work_item_id"
                    " WHERE w.title='Preserved'"
                ).fetchone()
            ),
        )
        assignment = json.loads(
            conn.execute(
                "SELECT record_json FROM platform_assignments WHERE assignment_id='memory-default'"
            ).fetchone()[0]
        )
        self.assertEqual(
            {
                "assignment_id": "memory-default",
                "capability_id": "memory.open",
                "scope": {"kind": "installation"},
                "connection_ids": [self.connection_id],
                "state": "enabled",
                "changed_by": "owner",
            },
            assignment,
        )
        capabilities_by_lineage = {
            row["adapter_lineage_id"]: json.loads(row["record_json"])["capabilities"]
            for row in conn.execute("SELECT adapter_lineage_id,record_json FROM platform_adapters")
        }
        self.assertEqual(
            ["memory.open", "memory.health"],
            capabilities_by_lineage["agentmemory-reference-v1"],
        )
        self.assertTrue(
            {
                "claude-code-execution",
                "codex-execution",
                "claude-journal-telemetry",
                "codex-rollout-telemetry",
                "codex-skills",
                "claude-skills",
                "git-artifacts",
            }
            <= capabilities_by_lineage.keys()
        )
        prefs = json.loads(
            conn.execute(
                "SELECT record_json FROM platform_ui_prefs WHERE key='last-route'"
            ).fetchone()[0]
        )
        self.assertNotIn("space_ref", prefs)
        # The stored pref carried a board name; the cutover re-encoded it as the
        # key of the space that board became.
        self.assertEqual(
            {"data_scope_id": self.known_store_scope, "space_key": "MIG"},
            planning_space_ref(prefs["resource_ref"]),
        )
        fields = [
            field
            for row in conn.execute("SELECT record_json FROM platform_action_inputs")
            for field in json.loads(row[0])["fields"]
        ]
        self.assertNotIn("work_item_ref", {field["key"] for field in fields})
        self.assertIn("entity_ref", {field["key"] for field in fields})
        names = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertNotIn("platform_assignments_legacy", names)
        self.assertFalse(any(name.endswith("_v2") for name in names))
        conn.close()
        self.assertEqual(1, len(self.backups()))
        store.connect().close()
        self.assertEqual(1, len(self.backups()))

    def test_migrated_assignments_are_unique_per_capability_and_scope(self) -> None:
        """The registry loads exactly one assignment per capability and scope.

        A store that carries two refuses to load at all, so this is not a
        cosmetic uniqueness claim: it is the difference between a Settings
        registry the owner can read and one that fails whole.
        """

        conn = store.connect()
        self.addCleanup(conn.close)
        keys = []
        for row in conn.execute("SELECT record_json FROM platform_assignments"):
            record = validate_assignment(json.loads(row[0]))
            scope = record["scope"]
            keys.append(
                (
                    record["capability_id"],
                    "installation"
                    if scope["kind"] == "installation"
                    else f"project:{scope['project_id']}",
                )
            )
        self.assertEqual(sorted(set(keys)), sorted(keys))
        payload = platform_core.Platform(conn, self.path).registry_payload(
            {"scope_kind": ["global"]}
        )
        self.assertEqual("ready", payload["state"]["status"])
        self.assertIn("assignments", payload["state"]["payload"])

    def test_snapshot_is_integral_and_executable_restore_replays_once(self) -> None:
        store.connect().close()
        backup = self.backups()[0]
        snapshot = sqlite3.connect(f"file:{backup}?mode=ro", uri=True)
        try:
            self.assertEqual("ok", snapshot.execute("PRAGMA integrity_check").fetchone()[0])
            self.assertEqual(3, snapshot.execute("PRAGMA user_version").fetchone()[0])
        finally:
            snapshot.close()
        restored = os.path.join(self.directory.name, "restored.sqlite3")
        shutil.copyfile(backup, restored)
        with mock.patch.dict(os.environ, {"VALKAMA_DB": restored}):
            reopened = store.connect()
            self.assertEqual(
                store.STORE_SCHEMA_VERSION,
                reopened.execute("PRAGMA user_version").fetchone()[0],
            )
            self.assertEqual(
                "Preserved",
                reopened.execute("SELECT title FROM work_items WHERE title='Preserved'").fetchone()[
                    0
                ],
            )
            reopened.close()

    def test_after_rename_and_pre_stamp_failures_roll_back_without_second_backup(self) -> None:
        original_migrate = platform_migrations.migrate_product_model

        def fail_after_rename(conn: sqlite3.Connection) -> bool:
            return original_migrate(
                conn,
                after_rename=lambda: (_ for _ in ()).throw(RuntimeError("after rename")),
            )

        with mock.patch.object(
            platform_migrations, "migrate_product_model", side_effect=fail_after_rename
        ):
            with self.assertRaisesRegex(RuntimeError, "after rename"):
                store.connect()
        self._assert_schema3_rolled_back()
        self.assertEqual(1, len(self.backups()))

    def test_exact_legacy_shape_is_refused_before_snapshot_or_mutation(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("ALTER TABLE platform_assignments ADD COLUMN surprise TEXT")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "source shape is not exact"):
            store.connect()
        self.assertEqual([], self.backups())
        check = sqlite3.connect(self.path)
        try:
            self.assertEqual(3, check.execute("PRAGMA user_version").fetchone()[0])
            self.assertIn(
                "surprise",
                [row[1] for row in check.execute("PRAGMA table_info(platform_assignments)")],
            )
        finally:
            check.close()

    def test_unexpected_adapter_column_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("ALTER TABLE platform_adapters ADD COLUMN surprise TEXT")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "source shape is not exact"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_widened_assignment_check_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.executescript(
            "ALTER TABLE platform_assignments RENAME TO assignment_exact;"
            "CREATE TABLE platform_assignments("
            " assignment_id TEXT PRIMARY KEY, record_json TEXT NOT NULL,"
            " state TEXT NOT NULL CHECK(state IN ('enabled','disabled','tombstoned','other')),"
            " updated_at TEXT NOT NULL);"
            "INSERT INTO platform_assignments SELECT * FROM assignment_exact;"
            "DROP TABLE assignment_exact;"
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "catalog signature"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_widened_module_check_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.executescript(
            "ALTER TABLE platform_modules RENAME TO modules_exact;"
            "CREATE TABLE platform_modules("
            " module_id TEXT PRIMARY KEY, record_json TEXT NOT NULL,"
            " state TEXT NOT NULL CHECK(state IN ('enabled','disabled','other')),"
            " mutable INTEGER NOT NULL CHECK(mutable IN (0,1)),"
            " revision INTEGER NOT NULL CHECK(revision > 0), updated_at TEXT NOT NULL);"
            "INSERT INTO platform_modules SELECT * FROM modules_exact;"
            "DROP TABLE modules_exact;"
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "catalog signature"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_missing_required_index_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("DROP INDEX platform_adapter_links_item")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "catalog signature"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_altered_required_index_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("DROP INDEX platform_adapter_links_item")
        conn.execute(
            "CREATE INDEX platform_adapter_links_item"
            " ON platform_adapter_links(data_scope_id,space_key,external_id)"
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "catalog signature"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_extra_migration_owned_index_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("CREATE INDEX platform_surprise ON platform_assignments(state)")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "catalog signature"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_mixed_former_and_current_catalog_is_refused_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute("CREATE TABLE hub_adapters AS SELECT * FROM platform_adapters")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "mixes former and current"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_unmapped_adapter_capability_refuses_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        row = conn.execute(
            "SELECT adapter_lineage_id,record_json FROM platform_adapters LIMIT 1"
        ).fetchone()
        record = json.loads(row[1])
        record["capabilities"] = ["legacy.unknown"]
        conn.execute(
            "UPDATE platform_adapters SET record_json=? WHERE adapter_lineage_id=?",
            (json.dumps(record, sort_keys=True), row[0]),
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "capability values are unmapped"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_unmappable_legacy_ui_preference_refuses_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        record = json.loads(
            conn.execute(
                "SELECT record_json FROM platform_ui_prefs WHERE key='last-route'"
            ).fetchone()[0]
        )
        record["board_ref"]["guessed"] = True
        conn.execute(
            "UPDATE platform_ui_prefs SET record_json=? WHERE key='last-route'",
            (json.dumps(record, sort_keys=True),),
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(platform_core.RegistryError, "UI preference"):
            store.connect()
        self.assertEqual([], self.backups())

    def test_exact_current_adapter_capability_is_preserved(self) -> None:
        conn = sqlite3.connect(self.path)
        row = conn.execute(
            "SELECT adapter_lineage_id,record_json FROM platform_adapters LIMIT 1"
        ).fetchone()
        record = json.loads(row[1])
        record["capabilities"] = ["telemetry.query"]
        conn.execute(
            "UPDATE platform_adapters SET record_json=? WHERE adapter_lineage_id=?",
            (json.dumps(record, sort_keys=True), row[0]),
        )
        conn.commit()
        conn.close()
        migrated = store.connect()
        persisted = json.loads(
            migrated.execute(
                "SELECT record_json FROM platform_adapters WHERE adapter_lineage_id=?", (row[0],)
            ).fetchone()[0]
        )
        migrated.close()
        self.assertEqual(["telemetry.query"], persisted["capabilities"])

    def test_planning_only_schema_zero_seeds_usable_module_registry(self) -> None:
        path = os.path.join(self.directory.name, "planning-only.sqlite3")
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE boards(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE)")
        conn.execute("INSERT INTO boards(name) VALUES ('Planning only')")
        conn.commit()
        conn.close()
        with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
            migrated = store.connect()
            modules = platform_core.modules_payload(migrated)["modules"]
            self.assertEqual(
                store.STORE_SCHEMA_VERSION, migrated.execute("PRAGMA user_version").fetchone()[0]
            )
            self.assertIn("settings", {item["manifest"]["module_id"] for item in modules})
            self.assertTrue(all(item["state"] == "enabled" for item in modules))
            migrated.close()
            store.connect().close()

    def test_current_shaped_unstamped_store_reopens_without_rewrite(self) -> None:
        path = os.path.join(self.directory.name, "current-unstamped.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
            current = store.connect()
            before = current.execute(
                "SELECT module_id,record_json,revision FROM platform_modules ORDER BY module_id"
            ).fetchall()
            current.execute("PRAGMA user_version=0")
            current.commit()
            current.close()
            reopened = store.connect()
            after = reopened.execute(
                "SELECT module_id,record_json,revision FROM platform_modules ORDER BY module_id"
            ).fetchall()
            self.assertEqual([tuple(row) for row in before], [tuple(row) for row in after])
            reopened.close()
            store.connect().close()

    def test_source_drift_after_verified_snapshot_is_refused(self) -> None:
        original_snapshot = store_backups.verified_snapshot

        def drift_after_snapshot(conn: sqlite3.Connection, label: str, *, locate):
            result = original_snapshot(conn, label, locate=locate)
            conn.execute("UPDATE cards SET title='Concurrent drift' WHERE id=?", (self.card_id,))
            conn.commit()
            return result

        with mock.patch.object(
            store_backups, "verified_snapshot", side_effect=drift_after_snapshot
        ):
            with self.assertRaisesRegex(RuntimeError, "source store drifted"):
                store.connect()
        self._assert_schema3_rolled_back()
        self.assertEqual(1, len(self.backups()))

    def test_migration_lock_serializes_writers(self) -> None:
        entered = threading.Event()
        release = threading.Event()

        def hold_lock() -> None:
            with store_lock.migration_lock(self.path):
                entered.set()
                release.wait(2)

        holder = threading.Thread(target=hold_lock)
        holder.start()
        self.assertTrue(entered.wait(2))
        try:
            with self.assertRaisesRegex(RuntimeError, "migration lock"):
                with store_lock.migration_lock(self.path, timeout=0.05):
                    self.fail("a concurrent migration writer entered the lock")
        finally:
            release.set()
            holder.join(2)
        self.assertFalse(holder.is_alive())

        with mock.patch.object(platform_core, "initialize", side_effect=RuntimeError("pre stamp")):
            with self.assertRaisesRegex(RuntimeError, "pre stamp"):
                store.connect()
        self._assert_schema3_rolled_back()
        self.assertEqual(1, len(self.backups()))

    def _append_detail_json_to_audit(self) -> None:
        """Rebuild the audit table the way its history actually produced it.

        `detail_json` reached every store that predates it through ALTER TABLE
        ADD COLUMN, which appends. Building the fixture from the current schema
        instead would test a store shape no installation has.
        """

        conn = sqlite3.connect(self.path)
        try:
            conn.execute("DROP TABLE platform_registry_audit")
            conn.execute(platform_migrations._PRE_DETAIL_AUDIT_SQL)
            conn.execute(
                "CREATE INDEX platform_registry_audit_entity"
                " ON platform_registry_audit(entity_kind, entity_id, sequence)"
            )
            conn.execute(
                "INSERT INTO platform_registry_audit(sequence,event_kind,entity_kind,entity_id,at)"
                " VALUES(1,'registered','module','planning','2026-08-01T00:00:00Z')"
            )
            conn.execute(platform_migrations._AUDIT_DETAIL_COLUMN_SQL)
            conn.commit()
        finally:
            conn.close()

    def test_audit_columns_appended_by_alter_migrate_into_one_order(self) -> None:
        self._append_detail_json_to_audit()
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(
            list(platform_migrations._CURRENT_PLATFORM_COLUMNS["platform_registry_audit"]),
            [row[1] for row in conn.execute("PRAGMA table_info(platform_registry_audit)")],
        )
        self.assertEqual(
            ("registered", "module", "planning", "2026-08-01T00:00:00Z", "{}"),
            conn.execute(
                "SELECT event_kind,entity_kind,entity_id,at,detail_json"
                " FROM platform_registry_audit WHERE sequence=1"
            ).fetchone()[:5],
        )
        self.assertEqual(
            ["platform_registry_audit_entity"],
            [
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='index'"
                    " AND tbl_name='platform_registry_audit'"
                )
            ],
        )
        self.assertIsNone(
            conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='platform_registry_audit_legacy'"
            ).fetchone()
        )

    def test_recovery_point_of_a_refused_attempt_is_not_reused_after_the_store_moves(self) -> None:
        with mock.patch.object(
            platform_migrations, "migrate_product_model", side_effect=RuntimeError("refused")
        ):
            with self.assertRaisesRegex(RuntimeError, "refused"):
                store.connect()
        self._assert_schema3_rolled_back()
        self.assertEqual(1, len(self.backups()))
        stale = self.backups()[0]

        # The owner keeps working with the previous build between the two
        # attempts, so the first recovery point no longer names this store.
        moved = sqlite3.connect(self.path)
        try:
            moved.execute("UPDATE cards SET title=? WHERE id=?", ("Written after", self.card_id))
            moved.commit()
        finally:
            moved.close()

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(
            "Written after",
            conn.execute("SELECT title FROM work_items").fetchone()[0],
        )
        remaining = self.backups()
        self.assertEqual(2, len(remaining))
        fresh = sorted(remaining, key=os.path.getmtime)[-1]
        self.assertNotEqual(stale, fresh)
        for path, expected in ((stale, "Preserved"), (fresh, "Written after")):
            snapshot = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            try:
                self.assertEqual(
                    expected,
                    snapshot.execute("SELECT title FROM cards").fetchone()[0],
                )
                self.assertEqual(3, snapshot.execute("PRAGMA user_version").fetchone()[0])
            finally:
                snapshot.close()

    def _assert_schema3_rolled_back(self) -> None:
        conn = sqlite3.connect(self.path)
        try:
            self.assertEqual(3, conn.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(
                ["assignment_id", "record_json", "state", "updated_at"],
                [row[1] for row in conn.execute("PRAGMA table_info(platform_assignments)")],
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE name='platform_assignments_legacy'"
                ).fetchone()
            )
        finally:
            conn.close()


class NeutralKernelContractTests(unittest.TestCase):
    def test_exact_vocabulary_and_assignment_shape(self) -> None:
        self.assertEqual(
            {
                "project",
                "planning-space",
                "workflow",
                "work-item",
                "execution",
                "session",
                "skill",
                "memory-resource",
                "artifact",
                "improvement-case",
                "service",
                "connection",
                "registry",
            },
            set(ENTITY_KINDS),
        )
        self.assertEqual(set(capabilities.CAPABILITY_DEFINITIONS), set(CAPABILITY_IDS))
        assignment = {
            "assignment_id": "telemetry-default",
            "capability_id": "telemetry.query",
            "scope": {"kind": "installation"},
            "connection_ids": ["owner:service:adapter:connection"],
            "state": "enabled",
            "changed_by": "owner",
        }
        self.assertEqual(assignment, validate_assignment(assignment))
        with self.assertRaises(ContractError):
            validate_assignment(assignment | {"activation": "enabled"})
        with self.assertRaises(ContractError):
            validate_entity_ref({"kind": "card", "resource_id": "1"})

    def test_one_capability_and_scope_keeps_one_assignment_when_history_had_two(self) -> None:
        """History assigned per adapter; the neutral record assigns per capability.

        A store could therefore hold two legacy assignments that both mean
        `memory.open` at one scope. Registered as a pair they are refused and
        the whole registry fails to load, so the migration reduces them to one
        record holding both Connections — and chooses neither, because
        `memory.open` takes one and the owner is the one who picks.
        """

        scope = {"kind": "project", "project_id": "example-workspace"}
        first = validate_assignment(
            {
                "assignment_id": "owner:agentmemory-reference-v1",
                "capability_id": "memory.open",
                "scope": scope,
                "connection_ids": ["agentmemory:svc:agentmemory-reference-v1:singleton"],
                "state": "enabled",
                "changed_by": "owner",
            }
        )
        second = validate_assignment(
            {
                "assignment_id": "owner:notes-reference-v1",
                "capability_id": "memory.open",
                "scope": scope,
                "connection_ids": ["valkama-notes:svc:notes-reference-v1:singleton"],
                "state": "disabled",
                "changed_by": "owner",
            }
        )

        merged = platform_migrations._merge_assignments_by_capability_and_scope(
            [(first, 3, "2026-08-20T00:00:00Z"), (second, 7, "2026-08-20T00:00:01Z")]
        )
        self.assertEqual(1, len(merged))
        record, revision, updated_at = merged[0]
        self.assertEqual("memory.open", record["capability_id"])
        self.assertEqual(scope, record["scope"])
        self.assertEqual(
            first["connection_ids"] + second["connection_ids"], record["connection_ids"]
        )
        self.assertEqual("enabled", record["state"])
        self.assertEqual(7, revision)
        self.assertEqual("2026-08-20T00:00:01Z", updated_at)

        # What the owner then sees: a named conflict, not a Connection picked
        # for them.
        resolved = capabilities.resolve_capability(
            "memory.open",
            project_id="example-workspace",
            assignments=[record],
            connections=[
                _reference_connection("agentmemory", "agentmemory-reference-v1"),
                _reference_connection("valkama-notes", "notes-reference-v1"),
            ],
        )
        self.assertEqual("unavailable", resolved["state"])
        self.assertEqual("cardinality-one-required", resolved["reason"])

    def test_project_override_and_cardinality_never_select_first(self) -> None:
        def connection(identifier: str) -> dict:
            return {
                "connection_ref": {
                    "service_ref": {"owner_id": "owner", "service_id": identifier},
                    "adapter_lineage_id": f"adapter-{identifier}",
                    "connection_id": "main",
                },
                "applicability": {"kind": "global"},
                "configuration_owner": "owner",
                "trust_owner": "owner",
                "trust": "trusted",
                "health": "ready",
                "state": "registered",
            }

        first, second = connection("first"), connection("second")
        first_id = _connection_id(first["connection_ref"])
        second_id = _connection_id(second["connection_ref"])
        assignments = [
            {
                "assignment_id": "installation",
                "capability_id": "telemetry.query",
                "scope": {"kind": "installation"},
                "connection_ids": [first_id],
                "state": "enabled",
                "changed_by": "owner",
            },
            {
                "assignment_id": "project",
                "capability_id": "telemetry.query",
                "scope": {"kind": "project", "project_id": "valkama"},
                "connection_ids": [first_id, second_id],
                "state": "enabled",
                "changed_by": "owner",
            },
        ]
        resolved = capabilities.resolve_capability(
            "telemetry.query",
            project_id="valkama",
            assignments=assignments,
            connections=[first, second],
        )
        self.assertEqual("project", resolved["source"])
        self.assertEqual([first, second], resolved["connections"])
        one = [
            dict(assignments[0], capability_id="memory.open", connection_ids=[first_id, second_id])
        ]
        unavailable = capabilities.resolve_capability(
            "memory.open", assignments=one, connections=[first, second]
        )
        self.assertEqual("unavailable", unavailable["state"])
        self.assertEqual("cardinality-one-required", unavailable["reason"])


if __name__ == "__main__":
    unittest.main()
