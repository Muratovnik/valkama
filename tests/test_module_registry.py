from __future__ import annotations

import glob
import json
import os
import pathlib
import re
import shutil
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import app_shell, mcp_surface, store, watchers
from server.platform import migrations as platform_migrations
from server.platform import modules as platform_modules
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from server.ui_state import PlatformHttpError
from tests import board_era, registry_rows
from tests.registry_fixtures import project_binding, project_entry, registry_bytes
from tests.retired_modules import FORMER_MODULES

_EXPECTED_SECONDARY_CONTEXTS = {
    "planning": {
        "global": ["project", "planning-space"],
        "project": ["planning-space", "work-item"],
    },
    "memory": {"global": ["memory-resource"], "project": ["memory-resource", "work-item"]},
    "settings": {"global": [], "project": []},
}


def _released_schema2_planning_manifest() -> dict:
    """The manifest as schema 2 actually shipped it, `card` kinds and all.

    This is history, not current vocabulary. The migration's job is to normalise
    `card` into `work-item`, so a fixture written in the current words would
    assert nothing: it would already be the answer.
    """

    manifest = next(
        item for item in platform_modules.module_manifests() if item["module_id"] == "planning"
    )
    manifest["semantics"] = {
        "global": {
            "read_models": ["portfolio.cards", "portfolio.boards"],
            "action_semantics": ["core.card.create", "core.card.open"],
        },
        "project": {
            "read_models": ["project.boards", "project.cards"],
            "action_semantics": ["core.card.create", "core.card.open"],
        },
    }
    manifest["secondary_context"] = {
        "global": {"kinds": ["project", "board"], "behavior": "all"},
        "project": {"kinds": ["board", "card"], "behavior": "all"},
    }
    manifest["required_read_models"] = ["cards", "boards"]
    manifest["sse_subscriptions"] = ["cards.changed"]
    manifest["supported_entity_kinds"] = ["project", "board", "card"]
    manifest["primary_actions"] = ["core.card.create", "core.card.open"]
    manifest["secondary_actions"] = ["core.card.create", "core.card.open"]
    manifest["feature_capabilities"] = ["planning.create", "planning.lifecycle"]
    return manifest


def _released_schema2_skills_manifest() -> dict:
    """The exact Skills manifest persisted by the released schema-2 store."""

    manifest = next(item for item in FORMER_MODULES.values() if item["module_id"] == "skills")
    manifest["state_schema"]["allowed_keys"] = ["query", "source_scope", "activation"]
    manifest["secondary_context"] = {
        "global": {"kinds": ["project", "board"], "behavior": "all"},
        "project": {"kinds": ["board", "card"], "behavior": "all"},
    }
    manifest["feature_capabilities"] = ["skills.read", "skills.assign"]
    return manifest


class ModuleRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(lambda: self.conn.close())

    def test_secondary_contexts_are_coherent_and_match_offline_fallback(self) -> None:
        manifests = {item["module_id"]: item for item in platform_modules.module_manifests()}
        self.assertEqual(set(_EXPECTED_SECONDARY_CONTEXTS), set(manifests))
        for module_id, expected in _EXPECTED_SECONDARY_CONTEXTS.items():
            manifest = manifests[module_id]
            supported = set(manifest["supported_entity_kinds"])
            for scope in ("global", "project"):
                kinds = manifest["secondary_context"][scope]["kinds"]
                self.assertEqual(expected[scope], kinds)
                self.assertEqual(len(kinds), len(set(kinds)))
                self.assertLessEqual(set(kinds), supported)

        source = (
            pathlib.Path(__file__).parents[1]
            / "web"
            / "src"
            / "shared"
            / "api"
            / "platformModules.ts"
        ).read_text(encoding="utf-8")
        blocks = re.findall(r"MODULE\(\{(.*?)\n  \}\)", source, flags=re.DOTALL)
        offline = {}
        for block in blocks:
            module_match = re.search(r"module_id: '([^']+)'", block)
            self.assertIsNotNone(module_match)
            values = {}
            for field in (
                "allowed_keys",
                "readGlobal",
                "readProject",
                "actionGlobal",
                "actionProject",
                "required_read_models",
                "secondaryGlobal",
                "secondaryProject",
                "sse_subscriptions",
                "supported_entity_kinds",
                "feature_capabilities",
            ):
                match = re.search(rf"{field}: \[(.*?)\]", block, flags=re.DOTALL)
                self.assertIsNotNone(match, field)
                values[field] = re.findall(r"'([^']+)'", match.group(1))
            for field in ("navigation_group", "title_key", "icon_key"):
                match = re.search(rf"{field}: '([^']+)'", block)
                self.assertIsNotNone(match, field)
                values[field] = match.group(1)
            offline[module_match.group(1)] = values
        self.assertEqual(set(manifests), set(offline))
        for module_id, manifest in manifests.items():
            values = offline[module_id]
            self.assertEqual(values["navigation_group"], manifest["navigation_group"])
            self.assertEqual(values["title_key"], manifest["title_key"])
            self.assertEqual(values["icon_key"], manifest["icon_key"])
            self.assertEqual(values["allowed_keys"], manifest["state_schema"]["allowed_keys"])
            self.assertEqual(values["readGlobal"], manifest["semantics"]["global"]["read_models"])
            self.assertEqual(values["readProject"], manifest["semantics"]["project"]["read_models"])
            self.assertEqual(
                values["actionGlobal"], manifest["semantics"]["global"]["action_semantics"]
            )
            self.assertEqual(
                values["actionProject"], manifest["semantics"]["project"]["action_semantics"]
            )
            self.assertEqual(values["actionProject"], manifest["primary_actions"])
            self.assertEqual(values["actionGlobal"], manifest["secondary_actions"])
            self.assertEqual(values["required_read_models"], manifest["required_read_models"])
            self.assertEqual(
                values["secondaryGlobal"], manifest["secondary_context"]["global"]["kinds"]
            )
            self.assertEqual(
                values["secondaryProject"], manifest["secondary_context"]["project"]["kinds"]
            )
            self.assertEqual(values["sse_subscriptions"], manifest["sse_subscriptions"])
            self.assertEqual(values["supported_entity_kinds"], manifest["supported_entity_kinds"])
            self.assertEqual(values["feature_capabilities"], manifest["feature_capabilities"])

    def test_every_surface_answers_the_one_list_this_build_declares(self) -> None:
        """Planning, Memory and Settings, enabled and fixed, the same from every door."""

        payload = platform_modules.modules_payload()
        self.assertEqual("valkama-modules", payload["interface_version"])
        self.assertEqual(
            ["memory", "planning", "settings"],
            [item["manifest"]["module_id"] for item in payload["modules"]],
        )
        for item in payload["modules"]:
            with self.subTest(module=item["manifest"]["module_id"]):
                self.assertEqual(
                    {"manifest", "state", "mutable", "revision", "updated_at"}, set(item)
                )
                self.assertEqual(
                    ("enabled", False, 1, platform_modules.DECLARED_AT),
                    (item["state"], item["mutable"], item["revision"], item["updated_at"]),
                )
        self.assertEqual(payload, mcp_surface.call_tool(self.conn, "list_platform_modules", {}))
        self.assertEqual(
            (200, payload), app_shell.handle_get(self.conn, self.path, "/api/modules", {})
        )
        # A caller holding the answer cannot change the list behind it.
        payload["modules"][0]["manifest"]["title_key"] = "changed"
        payload["modules"].clear()
        self.assertEqual(3, len(platform_modules.modules_payload()["modules"]))
        self.assertNotEqual(
            "changed", platform_modules.modules_payload()["modules"][0]["manifest"]["title_key"]
        )

    def test_the_last_route_names_only_a_module_this_build_declares(self) -> None:
        saved = app_shell.save_ui_prefs(
            self.conn,
            {
                "interface_version": "valkama-ui-prefs",
                "module_id": "memory",
                "scope": {"kind": "global"},
            },
        )
        self.assertEqual("memory", saved["prefs"]["module_id"])
        for module_id in ("future-module", "skills"):
            with self.subTest(module_id=module_id), self.assertRaises(PlatformHttpError):
                app_shell.save_ui_prefs(
                    self.conn,
                    {
                        "interface_version": "valkama-ui-prefs",
                        "module_id": module_id,
                        "scope": {"kind": "global"},
                    },
                )
        self.assertEqual("memory", app_shell.ui_prefs_record(self.conn)["module_id"])

    def test_empty_reap_closes_its_transaction_and_repeats(self) -> None:
        with mock.patch.object(watchers, "reap_launches", return_value=[]) as reaper:
            self.assertFalse(watchers.reap_finished_launches(self.conn))
            self.assertFalse(self.conn.in_transaction)
            self.assertFalse(watchers.reap_finished_launches(self.conn))
            self.assertFalse(self.conn.in_transaction)
        self.assertEqual(2, reaper.call_count)

    def test_a_reap_that_changed_something_says_so_and_commits(self) -> None:
        with mock.patch.object(watchers, "reap_launches", return_value=["exec-1"]) as reaper:
            self.assertTrue(watchers.reap_finished_launches(self.conn))
        self.assertFalse(self.conn.in_transaction)
        reaper.assert_called_once_with(self.conn)

    def test_a_failed_reap_rolls_back_and_raises(self) -> None:
        with (
            mock.patch.object(watchers, "reap_launches", side_effect=RuntimeError("boom")),
            self.assertRaisesRegex(RuntimeError, "boom"),
        ):
            watchers.reap_finished_launches(self.conn)
        self.assertFalse(self.conn.in_transaction)


class ProductModelMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        # This suite builds a pre-4 store on purpose, so the conversion is a
        # deliberate act and says so: `connect()` refuses one otherwise.
        cutover = mock.patch.dict(os.environ, {store.CUTOVER_ENV: "1"})
        cutover.start()
        self.addCleanup(cutover.stop)
        conn = store.connect()
        # The registry rows the last build that had a registry seeded on start.
        registry_rows.seed(conn)
        resource_ref = planning_space_entity(
            {
                "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                "space_key": "LEG",
            }
        )
        registry = registry_bytes(
            [
                project_entry(
                    "legacy",
                    self.directory.name,
                    board="Presentation only",
                    bindings=[project_binding("legacy", resource_ref)],
                )
            ]
        )
        registry_patch = mock.patch.object(
            store.project_registry, "_read_registry_bytes", return_value=registry
        )
        registry_patch.start()
        self.addCleanup(registry_patch.stop)
        # Seeded from the Board-era fixture: the module that owned these tables
        # is gone, and what this suite needs is a legacy row the conversion has
        # to carry, not a live board API.
        board_id = board_era.seed(conn, "Legacy")
        self.card = {"id": board_era.add_card(conn, board_id, "Preserve me")}
        rows = conn.execute(
            "SELECT module_id,updated_at FROM platform_modules ORDER BY module_id"
        ).fetchall()
        # Every module but the two given as released below carries the manifest
        # this build declares, which a schema-2 row may hold as it is.
        current = {item["module_id"]: item for item in platform_modules.module_manifests()}
        conn.execute("ALTER TABLE platform_modules RENAME TO platform_modules_current")
        conn.execute(
            """CREATE TABLE platform_modules(
                   module_id TEXT PRIMARY KEY,
                   record_json TEXT NOT NULL,
                   state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
                   updated_at TEXT NOT NULL
               )"""
        )
        conn.executemany(
            "INSERT INTO platform_modules VALUES(?,?,'registered',?)",
            [
                (
                    row["module_id"],
                    (
                        json.dumps(_released_schema2_planning_manifest(), sort_keys=True)
                        if row["module_id"] == "planning"
                        else (
                            json.dumps(_released_schema2_skills_manifest(), sort_keys=True)
                            if row["module_id"] == "skills"
                            else json.dumps(current[row["module_id"]], sort_keys=True)
                        )
                    ),
                    row["updated_at"],
                )
                for row in rows
            ],
        )
        conn.execute("DROP TABLE platform_modules_current")
        conn.execute("DROP TABLE platform_assignments")
        conn.execute(
            """CREATE TABLE platform_assignments(
                   assignment_id TEXT PRIMARY KEY,
                   record_json TEXT NOT NULL,
                   state TEXT NOT NULL CHECK(state IN ('enabled','disabled','tombstoned')),
                   updated_at TEXT NOT NULL
               )"""
        )
        known_store = conn.execute(
            "SELECT data_scope_id,alias,registry_revision,is_primary,is_attached,is_writable,updated_at"
            " FROM platform_known_stores"
        ).fetchone()
        conn.execute("DROP TABLE platform_known_stores")
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
                json.dumps(["Legacy"]),
                known_store["registry_revision"],
                known_store["is_primary"],
                known_store["is_attached"],
                known_store["is_writable"],
                known_store["updated_at"],
            ),
        )
        conn.execute("PRAGMA user_version=2")
        conn.commit()
        conn.close()

    def backups(self) -> list[str]:
        return glob.glob(
            os.path.join(self.directory.name, "backups", "*-preproductmodel-*.sqlite3")
        )

    def test_snapshot_rewrite_integrity_idempotence_and_restore(self) -> None:
        migrated = store.connect()
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, migrated.execute("PRAGMA user_version").fetchone()[0]
        )
        # The row survives as the work item it became: the identity changed,
        # the record did not.
        self.assertEqual(
            "Preserve me",
            migrated.execute("SELECT title FROM work_items").fetchone()[0],
        )
        # The module rows the rewrite carried and the registry's rows went with
        # their tables at schema 9; the recovery point below still holds them.
        self.assertEqual(
            ["platform_store_metadata", "platform_ui_prefs"],
            [
                row[0]
                for row in migrated.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                    " AND name LIKE 'platform%' ORDER BY name"
                )
            ],
        )
        migrated.close()
        self.assertEqual(1, len(self.backups()))
        backup = self.backups()[0]
        check = sqlite3.connect(backup)
        try:
            self.assertEqual("ok", check.execute("PRAGMA integrity_check").fetchone()[0])
            self.assertEqual(
                "registered",
                check.execute("SELECT state FROM platform_modules LIMIT 1").fetchone()[0],
            )
            self.assertEqual(
                _released_schema2_planning_manifest(),
                json.loads(
                    check.execute(
                        "SELECT record_json FROM platform_modules WHERE module_id='planning'"
                    ).fetchone()[0]
                ),
            )
        finally:
            check.close()
        store.connect().close()
        self.assertEqual(1, len(self.backups()))

        for suffix in ("-wal", "-shm"):
            sidecar = self.path + suffix
            if os.path.exists(sidecar):
                os.remove(sidecar)
        shutil.copyfile(backup, self.path)
        restored = sqlite3.connect(self.path)
        try:
            self.assertEqual(2, restored.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(
                self.card["id"],
                restored.execute("SELECT id FROM cards WHERE title='Preserve me'").fetchone()[0],
            )
        finally:
            restored.close()

    def test_near_match_released_manifest_refuses_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        manifest = _released_schema2_planning_manifest()
        manifest["supported_entity_kinds"].append("registry")
        conn.execute(
            "UPDATE platform_modules SET record_json=? WHERE module_id='planning'",
            (json.dumps(manifest, sort_keys=True),),
        )
        conn.commit()
        conn.close()

        with self.assertRaises(platform_migrations.CatalogMigrationError):
            store.connect()
        self.assertEqual([], self.backups())
        check = sqlite3.connect(self.path)
        try:
            self.assertEqual(2, check.execute("PRAGMA user_version").fetchone()[0])
            self.assertNotIn(
                "mutable",
                {row[1] for row in check.execute("PRAGMA table_info(platform_modules)")},
            )
        finally:
            check.close()

    def test_schema_valid_current_manifest_near_match_refuses_before_snapshot(self) -> None:
        conn = sqlite3.connect(self.path)
        manifest = next(
            item for item in platform_modules.module_manifests() if item["module_id"] == "planning"
        )
        manifest["title_key"] = "platform.modules.planning-near-match"
        conn.execute(
            "UPDATE platform_modules SET record_json=? WHERE module_id='planning'",
            (json.dumps(manifest, sort_keys=True),),
        )
        conn.commit()
        before_rows = conn.execute(
            "SELECT module_id,record_json,state,updated_at FROM platform_modules ORDER BY module_id"
        ).fetchall()
        before_catalog = conn.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
        ).fetchall()
        conn.close()

        with self.assertRaises(platform_migrations.CatalogMigrationError):
            store.connect()

        self.assertEqual([], self.backups())
        check = sqlite3.connect(self.path)
        try:
            self.assertEqual(2, check.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(
                before_rows,
                check.execute(
                    "SELECT module_id,record_json,state,updated_at"
                    " FROM platform_modules ORDER BY module_id"
                ).fetchall(),
            )
            self.assertEqual(
                before_catalog,
                check.execute(
                    "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
                ).fetchall(),
            )
        finally:
            check.close()

    def test_mid_migration_failure_rolls_back_without_stamp_or_second_backup(self) -> None:
        original = platform_migrations.migrate_module_registry

        def fail(conn: sqlite3.Connection) -> bool:
            return original(conn, after_rewrite=lambda: (_ for _ in ()).throw(RuntimeError("boom")))

        with mock.patch.object(platform_migrations, "migrate_module_registry", side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                store.connect()
            with self.assertRaisesRegex(RuntimeError, "boom"):
                store.connect()
        self.assertEqual(1, len(self.backups()))
        conn = sqlite3.connect(self.path)
        try:
            self.assertEqual(2, conn.execute("PRAGMA user_version").fetchone()[0])
            columns = {row[1] for row in conn.execute("PRAGMA table_info(platform_modules)")}
            self.assertNotIn("mutable", columns)
            self.assertEqual(
                _released_schema2_planning_manifest(),
                json.loads(
                    conn.execute(
                        "SELECT record_json FROM platform_modules WHERE module_id='planning'"
                    ).fetchone()[0]
                ),
            )
            self.assertIsNone(
                conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table'"
                    " AND name='platform_modules_product_model'"
                ).fetchone()
            )
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
