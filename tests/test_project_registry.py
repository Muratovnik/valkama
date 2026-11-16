from __future__ import annotations

import inspect
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server.projects import project_registry
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes, registry_reader


class ProjectRegistryTests(unittest.TestCase):
    def test_default_path_is_the_single_valkama_registry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(
                os.environ,
                {
                    "LOCALAPPDATA": directory,
                    "VALKAMA_PROJECTS_REGISTRY": os.path.join(directory, "ignored.json"),
                },
            ):
                self.assertEqual(
                    os.path.join(directory, "Valkama", "projects.json"),
                    project_registry.registry_path(),
                )
        self.assertEqual(0, len(inspect.signature(project_registry.registry_path).parameters))

    def test_exact_owner_schema_is_returned_as_one_complete_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source_hash = "a" * 64
            binding = {
                "project_id": "sample",
                "resource_ref": planning_space_entity(
                    {
                        "data_scope_id": "22222222-2222-4222-8222-222222222222",
                        "space_key": "SAMPLE",
                    }
                ),
                "registry_revision": 1,
                "source_owner": "sample",
                "source_hash": source_hash,
            }
            raw = registry_bytes(
                [
                    project_entry(
                        "sample",
                        directory,
                        board="Sample",
                        bindings=[binding],
                        source_hash=source_hash,
                    )
                ]
            )
            listing = project_registry.read_registry(reader=lambda: raw)
            self.assertEqual("available", listing["status"])
            self.assertEqual(["sample"], [item["project_id"] for item in listing["projects"]])
            self.assertEqual(directory, listing["projects"][0]["canonical_root"])
            self.assertEqual("Sample", listing["projects"][0]["display_name"])
            self.assertEqual(
                {**binding["resource_ref"], "default": True},
                listing["projects"][0]["planning_binding"],
            )

    def test_v4_fixture_is_read_with_two_projects_of_one_space(self) -> None:
        fixture = Path(__file__).with_name("fixtures") / "valkama-projects-v4.fixture.json"
        listing = project_registry.parse_registry(fixture.read_bytes())
        self.assertEqual("available", listing["status"])
        self.assertEqual(
            ["alpha", "alpha-tool", "beta"], [item["project_id"] for item in listing["projects"]]
        )
        alpha, tool, beta = listing["projects"]
        self.assertTrue(alpha["planning_binding"]["default"])
        self.assertFalse(tool["planning_binding"]["default"])
        self.assertEqual(
            alpha["planning_binding"]["resource_id"], tool["planning_binding"]["resource_id"]
        )
        self.assertIsNone(beta["planning_binding"])

    def test_a_projection_of_schema_3_is_malformed(self) -> None:
        fixture = Path(__file__).with_name("fixtures") / "valkama-projects-v4.fixture.json"
        former = fixture.read_bytes().replace(b'"schema_version": 4', b'"schema_version": 3')
        listing = project_registry.parse_registry(former)
        self.assertEqual("malformed", listing["status"])
        self.assertEqual([], listing["projects"])
        self.assertIn("registry.schema_version must be 4", listing["reason"])

    def test_each_bound_space_needs_exactly_one_default_project(self) -> None:
        resource_ref = planning_space_entity(
            {"data_scope_id": "22222222-2222-4222-8222-222222222222", "space_key": "SAMPLE"}
        )
        base = Path(tempfile.gettempdir()) / "made-up"
        for defaults, status in (
            ((True, False), "available"),
            ((True, True), "malformed"),
            ((False, False), "malformed"),
        ):
            projects = []
            for index, default in enumerate(defaults):
                entry = project_entry(f"p{index}", base / f"p{index}")
                entry["planning_binding"] = {**resource_ref, "default": default}
                projects.append(entry)
            with self.subTest(defaults=defaults):
                result = project_registry.parse_registry(registry_bytes(projects))
                self.assertEqual(status, result["status"])
                if status == "malformed":
                    self.assertIn("exactly one default project", result["reason"])

    def test_a_binding_without_a_boolean_default_is_malformed(self) -> None:
        resource_ref = planning_space_entity(
            {"data_scope_id": "22222222-2222-4222-8222-222222222222", "space_key": "SAMPLE"}
        )
        entry = project_entry("sample", Path(tempfile.gettempdir()) / "sample")
        for binding, reason in (
            ({**resource_ref, "default": 1}, "default must be true or false"),
            ({**resource_ref, "default": True, "extra": 1}, "unknown extra"),
        ):
            entry["planning_binding"] = binding
            with self.subTest(binding=binding):
                result = project_registry.parse_registry(registry_bytes([entry]))
                self.assertEqual("malformed", result["status"])
                self.assertIn(reason, result["reason"])
        # The fixture writer marks a bare binding default, so this one is written by hand.
        entry["planning_binding"] = resource_ref
        raw = json.dumps({"schema_version": 4, "projects": [entry]}).encode("utf-8")
        result = project_registry.parse_registry(raw)
        self.assertEqual("malformed", result["status"])
        self.assertIn("missing default", result["reason"])

    def test_the_space_root_is_the_root_of_its_default_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            outer = Path(directory) / "outer"
            inner = outer / "inner"
            inner.mkdir(parents=True)
            resource_ref = planning_space_entity(
                {"data_scope_id": "22222222-2222-4222-8222-222222222222", "space_key": "SAMPLE"}
            )
            projects = [project_entry("outer", outer), project_entry("inner", inner)]
            for default, project in zip((False, True), projects, strict=True):
                project["planning_binding"] = {**resource_ref, "default": default}
            answer = project_registry.resolve_space_root(
                resource_ref, reader=lambda: registry_bytes(projects)
            )
            self.assertEqual("mapped", answer["status"])
            self.assertEqual(str(inner), answer["canonical_root"])
            self.assertEqual(resource_ref, answer["resource_ref"])
            self.assertNotIn("source", answer)

    def test_absent_and_malformed_are_distinct_typed_empty_results(self) -> None:
        absent = project_registry.parse_registry(None)
        malformed = project_registry.parse_registry(b"{")
        bom = project_registry.parse_registry(bytes((0xEF, 0xBB, 0xBF)) + registry_bytes([]))
        self.assertEqual("absent", absent["status"])
        self.assertEqual("malformed", malformed["status"])
        self.assertEqual("malformed", bom["status"])
        self.assertEqual([], absent["projects"])
        self.assertEqual([], malformed["projects"])
        self.assertEqual([], bom["projects"])

    def test_one_bad_entry_rejects_the_whole_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            valid = project_entry("valid", Path(directory) / "valid", board="Valid")
            broken = project_entry("broken", Path(directory) / "broken", board="Broken")
            del broken["display_name"]
            listing = project_registry.parse_registry(registry_bytes([valid, broken]))
            self.assertEqual("malformed", listing["status"])
            self.assertEqual([], listing["projects"])
            self.assertIn("display_name", listing["reason"])

    def test_duplicate_identity_root_and_resource_ref_reject_the_whole_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = project_entry("first", Path(directory) / "first", board="First")
            for field, value in (
                ("project_id", "first"),
                ("canonical_root", first["canonical_root"]),
            ):
                second = project_entry("second", Path(directory) / "second", board="Second")
                second[field] = value
                with self.subTest(field=field):
                    result = project_registry.parse_registry(registry_bytes([first, second]))
                    self.assertEqual("malformed", result["status"])
                    self.assertEqual([], result["projects"])

            resource_ref = planning_space_entity(
                {
                    "data_scope_id": "22222222-2222-4222-8222-222222222222",
                    "space_key": "SAMPLE",
                }
            )
            # One space may hold several projects, but only one of them is its default.
            first["planning_binding"] = resource_ref
            second = project_entry("second", Path(directory) / "second", board="Second")
            second["planning_binding"] = resource_ref
            result = project_registry.parse_registry(registry_bytes([first, second]))
            self.assertEqual("malformed", result["status"])
            self.assertIn("exactly one default project", result["reason"])

    def test_opaque_registry_identity_is_not_interpreted_or_migrated_on_read(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source_hash = "a" * 64
            legacy = {
                "project_id": "sample",
                "resource_ref": {
                    "kind": "planning-space",
                    "resource_id": "eyJib2FyZF9uYW1lIjoiU2FtcGxlIiwiZGF0YV9zY29wZV9pZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiJ9",
                },
                "registry_revision": 1,
                "source_owner": "sample",
                "source_hash": source_hash,
            }
            result = project_registry.parse_registry(
                registry_bytes(
                    [
                        project_entry(
                            "sample",
                            directory,
                            board="Sample",
                            bindings=[legacy],
                            source_hash=source_hash,
                        )
                    ]
                )
            )
            self.assertEqual("available", result["status"])
            self.assertEqual(
                {**legacy["resource_ref"], "default": True},
                result["projects"][0]["planning_binding"],
            )
            resolved = project_registry.resolve_space_root(
                legacy["resource_ref"], reader=lambda: registry_bytes([])
            )
            self.assertEqual("malformed", resolved["status"])

    def test_exact_mapping_reads_bytes_without_rewriting_or_normalizing_the_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "projects.json"
            root = Path(directory) / "repo"
            root.mkdir()
            source_hash = "a" * 64
            resource_ref = planning_space_entity(
                {
                    "data_scope_id": "22222222-2222-4222-8222-222222222222",
                    "space_key": "SAMPLE",
                }
            )
            binding = {
                "project_id": "sample",
                "resource_ref": resource_ref,
                "registry_revision": 1,
                "source_owner": "sample",
                "source_hash": source_hash,
            }
            original = registry_bytes(
                [
                    project_entry(
                        "sample",
                        root,
                        board="Same presentation title",
                        bindings=[binding],
                        source_hash=source_hash,
                    )
                ]
            )
            registry.write_bytes(original)
            answer = project_registry.resolve_space_root(
                resource_ref, reader=registry_reader(registry)
            )
            self.assertEqual("mapped", answer["status"])
            self.assertEqual(str(root), answer["canonical_root"])
            self.assertEqual(resource_ref, answer["resource_ref"])
            self.assertNotIn("registry_path", answer)
            self.assertEqual(original, registry.read_bytes())
            self.assertEqual(
                "missing",
                project_registry.resolve_space_root(
                    planning_space_entity(
                        {
                            "data_scope_id": "22222222-2222-4222-8222-222222222222",
                            "space_key": "OTHER",
                        }
                    ),
                    reader=registry_reader(registry),
                )["status"],
            )

    def test_matching_presentation_title_without_a_binding_is_never_inferred(self) -> None:
        resource_ref = planning_space_entity(
            {
                "data_scope_id": "22222222-2222-4222-8222-222222222222",
                "space_key": "SAMPLE",
            }
        )
        result = project_registry.resolve_space_root(
            resource_ref,
            reader=lambda: registry_bytes(
                [project_entry("sample", tempfile.gettempdir(), board="SAMPLE")]
            ),
        )
        self.assertEqual("missing", result["status"])
        self.assertIsNone(result["canonical_root"])

    def test_missing_or_malformed_resource_identity_is_typed_without_inference(self) -> None:
        self.assertEqual("missing", project_registry.resolve_space_root(None)["status"])
        malformed = project_registry.resolve_space_root("SAMPLE")
        self.assertEqual("malformed", malformed["status"])
        self.assertIsNone(malformed["resource_ref"])

    def test_observed_session_cwd_never_replaces_a_missing_owner_binding(self) -> None:
        context = project_registry.session_space_context(
            None,
            "C:\\observed\\checkout",
            reader=lambda: registry_bytes([]),
        )
        self.assertEqual("missing", context["status"])
        self.assertEqual("", context["effective_cwd"])
        self.assertEqual("C:\\observed\\checkout", context["session_cwd"])
        self.assertFalse(context["fallback"])
        self.assertNotIn("source", context)

    def test_owned_sources_have_no_compatibility_reader_or_path_seam(self) -> None:
        root = Path(__file__).resolve().parents[1]
        sources = [
            root / "server" / "projects" / "project_registry.py",
            root / "server" / "platform" / "core.py",
            root / "server" / "memory" / "service.py",
        ]
        forbidden = (
            "list_platform_projects",
            "list_registered_projects",
            "normalise_legacy_planning_ref",
            "registry_file",
            "registry_path=",
            "VALKAMA_PROJECTS_REGISTRY",
        )
        for source in sources:
            text = source.read_text(encoding="utf-8")
            for marker in forbidden:
                with self.subTest(source=source.name, marker=marker):
                    self.assertNotIn(marker, text)
        resolver_source = sources[0].read_text(encoding="utf-8")
        self.assertNotIn('project["board"]', resolver_source)
        for retired in (
            "manifest_path",
            "allowed_hook_events",
            "index_commands",
            "memory_namespace",
            "source_hash",
        ):
            self.assertNotIn(retired, resolver_source)

        exact_identity_sources = [
            root / "server" / "store.py",
            root / "server" / "sessions.py",
            root / "server" / "executions" / "api.py",
            root / "desktop" / "session_opener.js",
            root / "web" / "src" / "features" / "session-open" / "openPlan.ts",
        ]
        identity_aliases = (
            "_project_for_board",
            "_bound_board_name",
            "resolveBoardRoot",
            "board_root",
            "project_for_board",
            "_slug(",
        )
        for source in exact_identity_sources:
            text = source.read_text(encoding="utf-8")
            for marker in identity_aliases:
                with self.subTest(source=source.name, marker=marker):
                    self.assertNotIn(marker, text)

        session_sources = [
            root / "server" / "sessions.py",
            root / "server" / "refs.py",
            root / "web" / "src" / "app" / "App.vue",
            root / "web" / "src" / "features" / "session-open" / "openPlan.ts",
            root / "web" / "src" / "features" / "session-open" / "sessionWorkItemRoute.ts",
            root / "web" / "src" / "features" / "session-open" / "SessionContext.vue",
        ]
        session_aliases = ('"planning_space":', "planning_space:", "session.planning_space")
        for source in session_sources:
            text = source.read_text(encoding="utf-8")
            for marker in session_aliases:
                with self.subTest(source=source.name, marker=marker):
                    self.assertNotIn(marker, text)

        retired_copy_sources = [
            root / "web" / "src" / "shared" / "i18n" / "locales" / "en.ts",
            root / "web" / "src" / "shared" / "i18n" / "locales" / "ru.ts",
            root / "web" / "tests" / "browser" / "doctorFixtures.ts",
            root / "web" / "tests" / "i18n.test.ts",
        ]
        for source in retired_copy_sources:
            text = source.read_text(encoding="utf-8")
            for marker in ("project-titles-", "board-root-unavailable"):
                with self.subTest(source=source.name, marker=marker):
                    self.assertNotIn(marker, text)


class ProjectHoldingTests(unittest.TestCase):
    def test_the_deepest_root_holding_a_folder_names_its_project(self) -> None:
        base = Path(tempfile.gettempdir()) / "made-up"
        projects = [
            project_entry("outer", base / "work"),
            project_entry("inner", base / "work" / "inner"),
            project_entry("sibling", base / "work-two"),
        ]
        for folder, expected in (
            (base / "work" / "inner" / "src", "inner"),
            (base / "work" / "inner", "inner"),
            (base / "work" / "other", "outer"),
            # A root is a folder, not a prefix of a name.
            (base / "work-two-and-more", None),
            (base / "work-two" / "a", "sibling"),
            (base / "elsewhere", None),
            ("", None),
        ):
            with self.subTest(folder=str(folder)):
                self.assertEqual(expected, project_registry.project_holding(str(folder), projects))


if __name__ == "__main__":
    unittest.main()
