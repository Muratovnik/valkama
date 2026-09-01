from __future__ import annotations

import glob
import json
import os
import pathlib
import re
import shutil
import sqlite3
import tempfile
import threading
import unittest
from unittest import mock

from server import mcp_surface, store, watchers
from server.improvements import improvements_integration
from server.planning import service as planning_service
from server.platform import core as platform_core
from server.platform import migrations as platform_migrations
from server.platform import modules as platform_modules
from server.platform.contracts import planning_space_entity
from server.platform.scope import read_store_metadata
from tests import board_era
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

_EXPECTED_SECONDARY_CONTEXTS = {
    "planning": {
        "global": ["project", "planning-space"],
        "project": ["planning-space", "work-item"],
    },
    "sessions": {"global": ["execution", "session"], "project": []},
    "analytics": {
        "global": [],
        "project": ["planning-space", "work-item", "artifact"],
    },
    "improvements": {"global": ["work-item", "improvement-case"], "project": []},
    "skills": {"global": ["skill"], "project": ["skill"]},
    "memory": {
        "global": ["memory-resource"],
        "project": ["memory-resource", "work-item"],
    },
    "settings": {
        "global": ["connection", "registry"],
        "project": ["connection", "registry"],
    },
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

    manifest = next(
        item for item in platform_modules.module_manifests() if item["module_id"] == "skills"
    )
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

    def platform(self) -> platform_core.Platform:
        return platform_core.Platform(self.conn, self.path)

    def module_row(self, module_id: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT state,mutable,revision FROM platform_modules WHERE module_id=?", (module_id,)
        ).fetchone()

    def registrations(self) -> dict[str, dict]:
        return {
            item["manifest"]["module_id"]: item
            for item in self.platform().modules_payload()["modules"]
        }

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

    def test_skills_route_state_is_the_canonical_search_filter_and_view(self) -> None:
        manifest = next(
            item for item in platform_modules.module_manifests() if item["module_id"] == "skills"
        )
        self.assertEqual(["query", "status", "view"], manifest["state_schema"]["allowed_keys"])

    def test_first_install_defaults_and_response_are_persisted_rows(self) -> None:
        registrations = self.registrations()
        self.assertEqual(
            {
                "planning",
                "sessions",
                "analytics",
                "improvements",
                "skills",
                "memory",
                "settings",
            },
            set(registrations),
        )
        self.assertTrue(all(item["state"] == "enabled" for item in registrations.values()))
        self.assertFalse(registrations["settings"]["mutable"])
        self.assertTrue(registrations["planning"]["mutable"])

        row = self.conn.execute(
            "SELECT record_json FROM platform_modules WHERE module_id='analytics'"
        ).fetchone()
        manifest = json.loads(row[0])
        manifest["title_key"] = "platform.modules.analytics-persisted"
        self.conn.execute(
            "UPDATE platform_modules SET record_json=? WHERE module_id='analytics'",
            (json.dumps(manifest, sort_keys=True),),
        )
        self.conn.commit()
        self.assertEqual(
            "platform.modules.analytics-persisted",
            self.registrations()["analytics"]["manifest"]["title_key"],
        )

    def test_settings_immutability_optimistic_revision_and_restart_persistence(self) -> None:
        platform = self.platform()
        before = self.registrations()["settings"]
        audit_before = self.conn.execute(
            "SELECT COUNT(*) FROM platform_registry_audit WHERE entity_kind='module'"
        ).fetchone()[0]
        with self.assertRaises(platform_core.PlatformHttpError):
            platform.module_state_command(
                {"module_id": "settings", "state": "disabled", "expected_revision": 1}
            )
        with self.assertRaises(platform_core.PlatformHttpError):
            platform.module_state_command(
                {"module_id": "settings", "state": "enabled", "expected_revision": 1}
            )
        self.assertEqual(before, self.registrations()["settings"])
        self.assertEqual(
            audit_before,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_registry_audit WHERE entity_kind='module'"
            ).fetchone()[0],
        )
        changed = platform.module_state_command(
            {"module_id": "planning", "state": "disabled", "expected_revision": 1}
        )["module"]
        self.assertEqual("disabled", changed["state"])
        self.assertEqual(2, changed["revision"])
        mcp = mcp_surface.call_tool(self.conn, "list_platform_modules", {})
        planning = next(
            item for item in mcp["modules"] if item["manifest"]["module_id"] == "planning"
        )
        self.assertEqual("disabled", planning["state"])
        with self.assertRaises(platform_core.PlatformHttpError):
            platform.module_state_command(
                {"module_id": "planning", "state": "enabled", "expected_revision": 1}
            )
        self.conn.close()
        self.conn = store.connect()
        self.assertEqual("disabled", self.registrations()["planning"]["state"])

    def test_disabled_module_refuses_server_actions_without_deleting_data(self) -> None:
        planning_service.create_planning_space(self.conn, project_id="preserved", name="Preserved")
        item = planning_service.create_work_item(self.conn, space="PRE", title="Still here")
        self.conn.commit()
        self.platform().module_state_command(
            {"module_id": "planning", "state": "disabled", "expected_revision": 1}
        )
        with self.assertRaises(platform_core.PlatformHttpError):
            platform_core.handle_get(
                self.conn,
                self.path,
                "/api/platform/planning",
                {"scope_kind": ["global"]},
            )
        self.assertEqual(
            item["reference"],
            planning_service.get_work_item(self.conn, item["reference"])["reference"],
        )

    def test_deleted_runtime_rows_remain_absent_and_are_not_reseeded(self) -> None:
        self.conn.execute("DELETE FROM platform_modules WHERE module_id='analytics'")
        self.conn.commit()
        self.assertNotIn("analytics", self.registrations())
        self.conn.close()
        self.conn = store.connect()
        self.assertIsNone(
            self.conn.execute(
                "SELECT 1 FROM platform_modules WHERE module_id='analytics'"
            ).fetchone()
        )
        with self.assertRaises(platform_core.PlatformHttpError):
            self.platform().module_state_command(
                {"module_id": "analytics", "state": "enabled", "expected_revision": 1}
            )

    def test_a_module_added_after_an_installation_exists_appears_on_the_next_open(self) -> None:
        """The gap that made a seventh module a schema change instead of a build.

        Seeding ran for a store being created, so an installation that already
        existed never gained a row for a module added later: it was in the
        registry source and invisible in the product. The store here is stripped
        of every trace of Memory — the row and the audit history both — because
        an absent row alone is a removal, and a removal is honoured.
        """

        self.conn.execute("DELETE FROM platform_modules WHERE module_id='memory'")
        self.conn.execute(
            "DELETE FROM platform_registry_audit WHERE entity_kind='module' AND entity_id='memory'"
        )
        self.conn.commit()
        # Read the row, not the payload: building a Platform is what reconciles,
        # so asking it whether Memory is absent is what makes it present.
        self.assertIsNone(self.module_row("memory"))
        before = self.registrations()["planning"]

        self.conn.close()
        self.conn = store.connect()

        memory = self.registrations()["memory"]
        self.assertEqual("enabled", memory["state"])
        self.assertTrue(memory["mutable"])
        self.assertEqual(1, memory["revision"])
        # Reconciling adds; it never restates what the store already holds.
        self.assertEqual(before["revision"], self.registrations()["planning"]["revision"])
        self.assertEqual(before["updated_at"], self.registrations()["planning"]["updated_at"])

    def test_a_module_the_operator_removed_is_not_restored_by_reconciling(self) -> None:
        """The audit is what tells a removal apart from a module that is new."""

        self.conn.execute("DELETE FROM platform_modules WHERE module_id='memory'")
        self.conn.commit()
        self.conn.close()
        self.conn = store.connect()
        self.assertIsNone(self.module_row("memory"))

    def test_valid_future_registration_is_persisted_runtime_authority(self) -> None:
        row = self.conn.execute(
            "SELECT record_json,updated_at FROM platform_modules WHERE module_id='planning'"
        ).fetchone()
        manifest = json.loads(row["record_json"])
        manifest.update(
            {
                "module_id": "future-module",
                "route_namespace": "future-module",
                "title_key": "platform.modules.future-module",
                "state_schema": {
                    **manifest["state_schema"],
                    "schema_id": "module.future-module.state",
                },
                "inspector_owner": "module.future-module",
            }
        )
        self.conn.execute(
            "INSERT INTO platform_modules"
            "(module_id,record_json,state,mutable,revision,updated_at) VALUES(?,?,?,?,?,?)",
            (
                "future-module",
                json.dumps(manifest, sort_keys=True),
                "enabled",
                1,
                1,
                row["updated_at"],
            ),
        )
        self.conn.commit()
        registration = self.registrations()["future-module"]
        self.assertEqual("enabled", registration["state"])
        self.assertEqual("future-module", registration["manifest"]["module_id"])
        saved = self.platform().save_ui_prefs(
            {
                "interface_version": "valkama-ui-prefs",
                "module_id": "future-module",
                "scope": {"kind": "global"},
            }
        )
        self.assertEqual("future-module", saved["prefs"]["module_id"])

    def test_inconsistent_registry_refuses_state_change_without_mutation(self) -> None:
        before = self.registrations()["planning"]
        audit_before = self.conn.execute(
            "SELECT COUNT(*) FROM platform_registry_audit WHERE entity_kind='module'"
        ).fetchone()[0]
        self.conn.execute(
            "UPDATE platform_modules SET record_json='{}' WHERE module_id='analytics'"
        )
        self.conn.commit()
        with self.assertRaises(platform_core.RegistryError):
            platform_core.require_module_enabled(self.conn, "planning")
        with self.assertRaises(platform_core.RegistryError):
            self.platform().module_state_command(
                {"module_id": "planning", "state": "disabled", "expected_revision": 1}
            )
        planning = self.conn.execute(
            "SELECT state,revision,updated_at FROM platform_modules WHERE module_id='planning'"
        ).fetchone()
        self.assertEqual(
            (before["state"], before["revision"], before["updated_at"]), tuple(planning)
        )
        self.assertEqual(
            audit_before,
            self.conn.execute(
                "SELECT COUNT(*) FROM platform_registry_audit WHERE entity_kind='module'"
            ).fetchone()[0],
        )

    def test_missing_settings_refuses_state_change_without_mutation(self) -> None:
        before = self.registrations()["planning"]
        self.conn.execute("DELETE FROM platform_modules WHERE module_id='settings'")
        self.conn.commit()
        with self.assertRaisesRegex(platform_core.RegistryError, "Settings"):
            self.platform().module_state_command(
                {"module_id": "planning", "state": "disabled", "expected_revision": 1}
            )
        row = self.conn.execute(
            "SELECT state,revision,updated_at FROM platform_modules WHERE module_id='planning'"
        ).fetchone()
        self.assertEqual((before["state"], before["revision"], before["updated_at"]), tuple(row))

    def test_improvements_runtime_checks_module_before_queueing(self) -> None:
        runtime = improvements_integration.ImprovementsRuntime(module_enabled=lambda _path: False)
        with self.assertRaisesRegex(
            improvements_integration.ImprovementError, "Improvements module is disabled"
        ):
            runtime.queue_analysis(self.path, "personal", "manual")

    def test_sessions_disable_suppresses_and_reenable_resumes_reaper(self) -> None:
        platform = self.platform()
        platform.module_state_command(
            {"module_id": "sessions", "state": "disabled", "expected_revision": 1}
        )
        with mock.patch.object(watchers, "reap_launches", return_value=True) as reaper:
            self.assertFalse(watchers.reap_sessions_if_enabled(self.conn))
            reaper.assert_not_called()
            platform.module_state_command(
                {"module_id": "sessions", "state": "enabled", "expected_revision": 2}
            )
            self.assertTrue(watchers.reap_sessions_if_enabled(self.conn))
            reaper.assert_called_once_with(self.conn)

    def test_empty_sessions_reap_closes_admission_transaction_and_repeats(self) -> None:
        with mock.patch.object(watchers, "reap_launches", return_value=[]) as reaper:
            self.assertFalse(watchers.reap_sessions_if_enabled(self.conn))
            self.assertFalse(self.conn.in_transaction)
            self.assertFalse(watchers.reap_sessions_if_enabled(self.conn))
            self.assertFalse(self.conn.in_transaction)
        self.assertEqual(2, reaper.call_count)

    def test_improvements_disable_requests_owned_cancellation_once(self) -> None:
        runtime = improvements_integration.ImprovementsRuntime()
        runtime._bindings["personal:analysis:1"] = {
            "primary_db": self.path,
            "sidecar_job_id": 1,
        }
        runtime._supervisor.cancel = mock.Mock()  # type: ignore[method-assign]
        runtime.module_state_changed(self.path, "disabled")
        runtime.module_state_changed(self.path, "disabled")
        runtime._supervisor.cancel.assert_called_once_with("personal:analysis:1")

    def test_observer_failure_cannot_report_a_committed_transition_as_rolled_back(self) -> None:
        def fail_observer(_path: str, _module_id: str, _state: str) -> None:
            raise RuntimeError("observer failed")

        with (
            mock.patch.object(platform_modules, "_STATE_OBSERVERS", [fail_observer]),
            self.assertLogs("server.platform.modules", level="ERROR"),
        ):
            result = self.platform().module_state_command(
                {"module_id": "sessions", "state": "disabled", "expected_revision": 1}
            )
        self.assertEqual("disabled", result["module"]["state"])
        self.assertEqual(
            ("disabled", 2),
            tuple(
                self.conn.execute(
                    "SELECT state,revision FROM platform_modules WHERE module_id='sessions'"
                ).fetchone()
            ),
        )

    def test_sessions_reaper_and_disable_share_one_check_use_fence(self) -> None:
        entered = threading.Event()
        release = threading.Event()
        disabled = threading.Event()
        reaper_conn = sqlite3.connect(self.path, timeout=2, check_same_thread=False)
        reaper_conn.row_factory = sqlite3.Row
        state_conn = sqlite3.connect(self.path, timeout=2, check_same_thread=False)
        state_conn.row_factory = sqlite3.Row
        self.addCleanup(reaper_conn.close)
        self.addCleanup(state_conn.close)
        platform = platform_core.Platform(state_conn, self.path)

        def reap_under_lock(conn: sqlite3.Connection) -> bool:
            entered.set()
            release.wait(2)
            conn.commit()
            return True

        def disable() -> None:
            platform.module_state_command(
                {"module_id": "sessions", "state": "disabled", "expected_revision": 1}
            )
            disabled.set()

        with mock.patch.object(watchers, "reap_launches", side_effect=reap_under_lock) as reaper:
            reaper_thread = threading.Thread(
                target=watchers.reap_sessions_if_enabled, args=(reaper_conn,)
            )
            disable_thread = threading.Thread(target=disable)
            reaper_thread.start()
            self.assertTrue(entered.wait(2))
            disable_thread.start()
            self.assertFalse(disabled.wait(0.1), "disable crossed an active reaper fence")
            release.set()
            reaper_thread.join(2)
            disable_thread.join(2)
            self.assertFalse(reaper_thread.is_alive())
            self.assertFalse(disable_thread.is_alive())
            self.assertTrue(disabled.is_set())
            self.assertFalse(watchers.reap_sessions_if_enabled(reaper_conn))
            self.assertEqual(1, reaper.call_count)


class SkillsRouteStateMigrationTests(unittest.TestCase):
    """The schema-6 ratchet replaces the released Skills route vocabulary."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

        conn = store.connect()
        row = conn.execute(
            "SELECT record_json,state,mutable,revision,updated_at"
            " FROM platform_modules WHERE module_id='skills'"
        ).fetchone()
        manifest = json.loads(row["record_json"])
        manifest["title_key"] = "platform.modules.skills-persisted"
        manifest["state_schema"]["allowed_keys"] = [
            "query",
            "source_scope",
            "activation",
        ]
        conn.execute(
            "UPDATE platform_modules SET record_json=? WHERE module_id='skills'",
            (json.dumps(manifest, sort_keys=True),),
        )
        conn.execute("PRAGMA user_version=5")
        conn.commit()
        self.lifecycle = tuple(row[key] for key in ("state", "mutable", "revision", "updated_at"))
        conn.close()

    def backups(self) -> list[str]:
        return glob.glob(
            os.path.join(self.directory.name, "backups", "*-preproductmodel-*.sqlite3")
        )

    def test_rewrites_only_route_keys_then_stamps_once(self) -> None:
        migrated = store.connect()
        row = migrated.execute(
            "SELECT record_json,state,mutable,revision,updated_at"
            " FROM platform_modules WHERE module_id='skills'"
        ).fetchone()
        manifest = json.loads(row["record_json"])

        self.assertEqual(["query", "status", "view"], manifest["state_schema"]["allowed_keys"])
        self.assertEqual("platform.modules.skills-persisted", manifest["title_key"])
        self.assertEqual(
            self.lifecycle,
            tuple(row[key] for key in ("state", "mutable", "revision", "updated_at")),
        )
        self.assertEqual(6, migrated.execute("PRAGMA user_version").fetchone()[0])
        migrated.close()
        self.assertEqual(1, len(self.backups()))

        store.connect().close()
        self.assertEqual(1, len(self.backups()))

    def test_unknown_route_generation_refuses_before_snapshot_or_stamp(self) -> None:
        conn = sqlite3.connect(self.path)
        manifest = json.loads(
            conn.execute(
                "SELECT record_json FROM platform_modules WHERE module_id='skills'"
            ).fetchone()[0]
        )
        manifest["state_schema"]["allowed_keys"] = ["query", "activation"]
        conn.execute(
            "UPDATE platform_modules SET record_json=? WHERE module_id='skills'",
            (json.dumps(manifest, sort_keys=True),),
        )
        conn.commit()
        conn.close()

        with self.assertRaisesRegex(
            platform_core.RegistryError, "Skills route state generation is unrecognized"
        ):
            store.connect()

        self.assertEqual([], self.backups())
        check = sqlite3.connect(self.path)
        try:
            self.assertEqual(5, check.execute("PRAGMA user_version").fetchone()[0])
            saved = json.loads(
                check.execute(
                    "SELECT record_json FROM platform_modules WHERE module_id='skills'"
                ).fetchone()[0]
            )
            self.assertEqual(["query", "activation"], saved["state_schema"]["allowed_keys"])
        finally:
            check.close()


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
            "SELECT module_id,record_json,updated_at FROM platform_modules ORDER BY module_id"
        ).fetchall()
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
                            else row["record_json"]
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
        self.assertEqual(
            ["mutable", "revision"],
            sorted(
                {row[1] for row in migrated.execute("PRAGMA table_info(platform_modules)")}
                & {"mutable", "revision"}
            ),
        )
        current_planning = json.loads(
            migrated.execute(
                "SELECT record_json FROM platform_modules WHERE module_id='planning'"
            ).fetchone()[0]
        )
        self.assertIn("planning-space", current_planning["supported_entity_kinds"])
        self.assertNotIn("board", current_planning["supported_entity_kinds"])
        self.assertEqual(
            {item["module_id"]: item for item in platform_modules.module_manifests()},
            {
                row["module_id"]: json.loads(row["record_json"])
                for row in migrated.execute("SELECT module_id,record_json FROM platform_modules")
            },
        )
        self.assertTrue(
            {
                "claude-code-execution",
                "codex-execution",
                "claude-journal-telemetry",
                "codex-rollout-telemetry",
                "agentmemory-reference-v1",
                "codex-skills",
                "claude-skills",
                "git-artifacts",
            }
            <= {
                row[0]
                for row in migrated.execute(
                    "SELECT json_extract(record_json,'$.connection_ref.adapter_lineage_id')"
                    " FROM platform_connections"
                )
            }
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

    def test_exact_released_schema2_skills_manifest_uses_broad_normalization(self) -> None:
        migrated = store.connect()
        self.addCleanup(migrated.close)
        manifest = json.loads(
            migrated.execute(
                "SELECT record_json FROM platform_modules WHERE module_id='skills'"
            ).fetchone()[0]
        )
        self.assertEqual(
            next(
                item
                for item in platform_modules.module_manifests()
                if item["module_id"] == "skills"
            ),
            manifest,
        )
        self.assertEqual(["query", "status", "view"], manifest["state_schema"]["allowed_keys"])

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

        with self.assertRaises(platform_core.RegistryError):
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

        with self.assertRaises(platform_core.RegistryError):
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
