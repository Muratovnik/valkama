from __future__ import annotations

import os
import pathlib
import re
import sqlite3
import tempfile
import unittest
from unittest import mock

from server import app_shell, mcp_surface, store, watchers
from server.analytics import api as analytics_api
from server.platform import modules as platform_modules
from server.ui_state import PlatformHttpError

_EXPECTED_SECONDARY_CONTEXTS = {
    "planning": {
        "global": ["project", "planning-space"],
        "space": ["planning-space", "work-item"],
    },
    "analytics": {"global": ["work-item"], "space": ["work-item"]},
    "decisions": {"global": ["work-item"], "space": ["work-item"]},
    "memory": {"global": ["memory-resource"], "space": ["memory-resource", "work-item"]},
    "settings": {"global": ["work-item"], "space": ["work-item"]},
}


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
            for scope in ("global", "space"):
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
                "readSpace",
                "actionGlobal",
                "actionSpace",
                "required_read_models",
                "secondaryGlobal",
                "secondarySpace",
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
            self.assertEqual(values["readSpace"], manifest["semantics"]["space"]["read_models"])
            self.assertEqual(
                values["actionGlobal"], manifest["semantics"]["global"]["action_semantics"]
            )
            self.assertEqual(
                values["actionSpace"], manifest["semantics"]["space"]["action_semantics"]
            )
            self.assertEqual(values["actionSpace"], manifest["primary_actions"])
            self.assertEqual(values["actionGlobal"], manifest["secondary_actions"])
            self.assertEqual(values["required_read_models"], manifest["required_read_models"])
            self.assertEqual(
                values["secondaryGlobal"], manifest["secondary_context"]["global"]["kinds"]
            )
            self.assertEqual(
                values["secondarySpace"], manifest["secondary_context"]["space"]["kinds"]
            )
            self.assertEqual(values["sse_subscriptions"], manifest["sse_subscriptions"])
            self.assertEqual(values["supported_entity_kinds"], manifest["supported_entity_kinds"])
            self.assertEqual(values["feature_capabilities"], manifest["feature_capabilities"])

    def test_planning_state_admits_every_key_the_work_filter_writes(self) -> None:
        """A reload keeps the filter only if the manifest admits its keys.

        The browser drops a whole route state that names a key the manifest does
        not list, so a filter the bar wrote into the address came back empty.
        The keys are read from the module that writes them.
        """

        source = (
            pathlib.Path(__file__).parents[1]
            / "web"
            / "src"
            / "entities"
            / "work-item"
            / "utils"
            / "workFilter.ts"
        ).read_text(encoding="utf-8")
        block = re.search(r"WORK_FILTER_STATE_KEYS = \{(.*?)\}", source, flags=re.DOTALL)
        self.assertIsNotNone(block)
        written = re.findall(r"'([^']+)'", block.group(1))
        self.assertEqual(
            ["query", "ready", "held", "cat", "kind", "pri", "labels", "holder"], written
        )
        planning = next(
            item for item in platform_modules.module_manifests() if item["module_id"] == "planning"
        )
        allowed = planning["state_schema"]["allowed_keys"]
        self.assertLessEqual(set(written), set(allowed))
        self.assertEqual(len(allowed), len(set(allowed)))

    def test_analytics_state_admits_every_key_the_page_address_writes(self) -> None:
        """A reload keeps the Analytics view only if the manifest admits its keys.

        The browser drops a whole route state that names a key the manifest does
        not list, so a section or a filter written into the address would come
        back as the plain page. The keys are read from the one writer of that
        address.
        """

        source = (
            pathlib.Path(__file__).parents[1]
            / "web"
            / "src"
            / "shared"
            / "api"
            / "analyticsAddress.ts"
        ).read_text(encoding="utf-8")
        writer = re.search(r"export function writeAddress\(.*?\n\}", source, flags=re.DOTALL)
        self.assertIsNotNone(writer)
        written = re.findall(r"\bstate\.(\w+) =", writer.group(0))
        self.assertEqual(
            ["period", "from", "to", "by", "measure", "filters", "open", "across"], written
        )
        analytics = next(
            item for item in platform_modules.module_manifests() if item["module_id"] == "analytics"
        )
        allowed = analytics["state_schema"]["allowed_keys"]
        self.assertLessEqual(set(written), set(allowed))
        self.assertEqual(len(allowed), len(set(allowed)))

    def test_each_analytics_read_model_is_a_read_its_api_serves(self) -> None:
        """Analytics declares the usage, the quota and the uses reads, at both levels.

        A read model is `analytics.<name>` for the route `/api/analytics/<name>`, so a
        read the page asks is declared, and a declared one is answered.
        """

        analytics = next(
            item for item in platform_modules.module_manifests() if item["module_id"] == "analytics"
        )
        served = [analytics_api.USAGE_PATH, analytics_api.QUOTA_PATH, analytics_api.USES_PATH]
        declared = ["analytics.usage", "analytics.quota", "analytics.uses"]
        for scope in ("global", "space"):
            with self.subTest(scope=scope):
                self.assertEqual(declared, analytics["semantics"][scope]["read_models"])
        self.assertEqual(
            [f"/api/analytics/{name.removeprefix('analytics.')}" for name in declared], served
        )

    def test_every_surface_answers_the_one_list_this_build_declares(self) -> None:
        """The five modules, enabled and fixed, the same from every door."""

        payload = platform_modules.modules_payload()
        self.assertEqual("valkama-modules", payload["interface_version"])
        self.assertEqual(
            ["analytics", "decisions", "memory", "planning", "settings"],
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
        # Neither door reads the store for it: a closed connection gets the same answer.
        closed = sqlite3.connect(":memory:")
        closed.close()
        self.assertEqual(payload, mcp_surface.call_tool(closed, "list_platform_modules", {}))
        self.assertEqual(
            (200, payload), app_shell.handle_get(closed, self.path, "/api/modules", {})
        )
        # A caller holding the answer cannot change the list behind it.
        payload["modules"][0]["manifest"]["title_key"] = "changed"
        payload["modules"].clear()
        self.assertEqual(5, len(platform_modules.modules_payload()["modules"]))
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


if __name__ == "__main__":
    unittest.main()
