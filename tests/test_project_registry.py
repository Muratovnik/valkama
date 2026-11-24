from __future__ import annotations

import inspect
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import sessions, store
from server.projects import project_registry
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes, registry_reader


class ProjectRegistryTests(unittest.TestCase):
    def test_foreign_bindings_name_the_space_a_store_is_missing_for(self) -> None:
        known_scope = "22222222-2222-4222-8222-222222222222"
        known_space = planning_space_entity({"data_scope_id": known_scope, "space_key": "EX"})
        projects = [
            {"project_id": "free", "planning_binding": None},
            {"project_id": "known", "planning_binding": {**known_space, "default": True}},
            {
                "project_id": "garbled",
                "planning_binding": {
                    "kind": "planning-space",
                    "resource_id": "not-a-space",
                    "default": True,
                },
            },
            {
                "project_id": "stray",
                "planning_binding": {
                    **planning_space_entity(
                        {
                            "data_scope_id": "9b1c3f0e-6d2a-4e8b-8f57-2c4a1d0e7b93",
                            "space_key": "ZZ",
                        }
                    ),
                    "default": True,
                },
            },
        ]
        self.assertEqual(
            [
                {"project_id": "garbled", "space_key": None, "data_scope_id": None},
                {
                    "project_id": "stray",
                    "space_key": "ZZ",
                    "data_scope_id": "9b1c3f0e-6d2a-4e8b-8f57-2c4a1d0e7b93",
                },
            ],
            project_registry.foreign_bindings(projects, frozenset({known_scope})),
        )

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

    def test_a_projection_of_schema_3_is_refused_as_older_not_as_broken(self) -> None:
        fixture = Path(__file__).with_name("fixtures") / "valkama-projects-v4.fixture.json"
        former = fixture.read_bytes().replace(b'"schema_version": 4', b'"schema_version": 3')
        listing = project_registry.parse_registry(former)
        self.assertEqual("malformed", listing["status"])
        self.assertEqual([], listing["projects"])
        self.assertEqual(
            "Valkama project registry has the older schema 3; this build reads schema 4",
            listing["reason"],
        )

    def test_a_schema_that_is_not_an_older_number_is_still_malformed(self) -> None:
        fixture = Path(__file__).with_name("fixtures") / "valkama-projects-v4.fixture.json"
        for version in (b"5", b'"3"', b"0", b"true"):
            with self.subTest(version=version):
                raw = fixture.read_bytes().replace(
                    b'"schema_version": 4', b'"schema_version": ' + version
                )
                listing = project_registry.parse_registry(raw)
                self.assertEqual("malformed", listing["status"])
                self.assertIn("is malformed: registry.schema_version must be 4", listing["reason"])

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


#: The projects of one space, each by its root's place in the workspace.
SPACE_PROJECTS = {
    "example-project": (),
    "atlas": ("libs", "atlas"),
    "games": ("libs", "games"),
    "event-relay-service": ("libs", "event-relay-service"),
    "publisher": ("libs", "tools", "publisher"),
    "valkama": ("libs", "services", "valkama"),
}
OTHER_SCOPE = "9b1c3f0e-6d2a-4e8b-8f57-2c4a1d0e7b93"


class PlaceCase(unittest.TestCase):
    """A workspace of nested projects: six projects in one space, one in another.

    `example-project` is the space's default project and holds the other five; an
    unbound project lies inside it, and one is bound to a space of another store.
    """

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.base = Path(directory.name)
        self.scope = self.store_scope()
        self.workspace = self.base / "example-project"
        self.roots = {
            project: self.workspace.joinpath(*parts) for project, parts in SPACE_PROJECTS.items()
        }
        self.roots["rover"] = self.base / "rover"
        self.roots["scratch"] = self.workspace / "projects" / "scratch"
        self.roots["foreign"] = self.workspace / "libs" / "foreign"
        projects = []
        for project, root in self.roots.items():
            entry = project_entry(project, root)
            if project in SPACE_PROJECTS:
                entry["planning_binding"] = self.binding("MAIN", project == "example-project")
            elif project == "rover":
                entry["planning_binding"] = self.binding("ROVER", True)
            elif project == "foreign":
                entry["planning_binding"] = self.binding("FX", True, scope=OTHER_SCOPE)
            projects.append(entry)
        self.listing = project_registry.parse_registry(registry_bytes(projects))
        self.assertEqual("available", self.listing["status"], self.listing["reason"])

    def store_scope(self) -> str:
        """The store the places are asked about."""

        return "22222222-2222-4222-8222-222222222222"

    def binding(self, key: str, default: bool, *, scope: str | None = None) -> dict:
        space = planning_space_entity({"data_scope_id": scope or self.scope, "space_key": key})
        return {**space, "default": default}

    def place(self, folder: str | Path) -> dict | None:
        found = project_registry.place_of_folder(str(folder), self.listing, self.scope)
        return None if found is None else dict(found)

    def expected(self, project: str, key: str | None) -> dict:
        return {
            "project_id": project,
            "canonical_root": str(self.roots[project]),
            "space_key": key,
        }


class PlaceOfFolderTests(PlaceCase):
    def test_the_root_of_each_project_of_the_space_finds_it_in_the_space(self) -> None:
        for project in SPACE_PROJECTS:
            with self.subTest(project=project):
                self.assertEqual(self.expected(project, "MAIN"), self.place(self.roots[project]))

    def test_a_folder_inside_a_nested_root_is_that_project_not_the_one_around_it(self) -> None:
        self.assertEqual(
            self.expected("valkama", "MAIN"), self.place(self.roots["valkama"] / "server")
        )
        self.assertEqual(
            self.expected("example-project", "MAIN"), self.place(self.workspace / "docs")
        )

    def test_the_root_of_a_project_of_another_space_finds_that_space(self) -> None:
        self.assertEqual(self.expected("rover", "ROVER"), self.place(self.roots["rover"]))

    def test_an_unbound_root_inside_a_bound_one_is_in_no_space(self) -> None:
        # The project around it is bound to MAIN; the place does not fall back to it.
        self.assertEqual(self.expected("scratch", None), self.place(self.roots["scratch"] / "src"))

    def test_a_project_bound_in_another_store_is_in_no_space_of_this_one(self) -> None:
        self.assertEqual(self.expected("foreign", None), self.place(self.roots["foreign"]))
        self.assertEqual(
            self.expected("foreign", "FX"),
            dict(
                project_registry.place_of_folder(
                    str(self.roots["foreign"]), self.listing, OTHER_SCOPE
                )
                or {}
            ),
        )

    def test_a_folder_under_no_root_has_no_place(self) -> None:
        for folder in (
            self.base / "elsewhere",
            # A root is a folder, not the prefix of a name.
            self.base / "rover-two",
            "",
        ):
            with self.subTest(folder=str(folder)):
                self.assertIsNone(self.place(folder))

    @unittest.skipUnless(os.path.normcase("A") == "a", "the platform compares paths with case")
    def test_case_does_not_tell_one_folder_from_another(self) -> None:
        self.assertEqual(
            self.expected("valkama", "MAIN"),
            self.place(str(self.roots["valkama"] / "server").upper()),
        )

    def test_a_link_is_not_followed(self) -> None:
        link = self.base / "link-to-valkama"
        self.roots["valkama"].mkdir(parents=True)
        try:
            os.symlink(self.roots["valkama"], link, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"this account cannot make a link: {error}")
        self.assertIsNone(self.place(link / "server"))

    def test_a_registry_that_was_not_read_places_nothing(self) -> None:
        for listing in (
            project_registry.parse_registry(None),
            project_registry.parse_registry(b"not json"),
        ):
            with self.subTest(status=listing["status"]):
                self.assertIsNone(
                    project_registry.place_of_folder(
                        str(self.roots["valkama"]), listing, self.scope
                    )
                )


class SessionPlaceTests(PlaceCase):
    """`sessions.session_place`: a session's first folder that is not empty, placed."""

    def store_scope(self) -> str:
        """A throwaway store at the current schema: the spaces are bound in it."""

        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.base / "store" / "valkama.sqlite3"),
                "HOME": str(self.base),
                "USERPROFILE": str(self.base),
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        return str(read_store_metadata(self.conn)["data_scope_id"])

    def session(
        self,
        session: str,
        client: str,
        *,
        transcript_names: Path | None = None,
        opened_folder: Path | None = None,
        cwd: Path | None = None,
    ) -> None:
        """A session row; a Claude Code transcript lies in the directory its client names
        after the folder the session started in."""

        directory = (
            "unnamed"
            if transcript_names is None
            else re.sub(r"[^0-9A-Za-z]", "-", str(transcript_names))
        )
        self.conn.execute(
            "INSERT INTO sessions(id, client, cwd, opened_folder, transcript_path)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                session,
                client,
                "" if cwd is None else str(cwd),
                "" if opened_folder is None else str(opened_folder),
                str(self.base / "transcripts" / directory / f"{session}.jsonl"),
            ),
        )

    def place_of(self, session: str) -> dict | None:
        found = sessions.session_place(self.conn, session, self.listing)
        return None if found is None else dict(found)

    def test_a_claude_session_stands_where_its_transcript_names(self) -> None:
        # Started in the workspace, it was opened in Valkama's server and its shell is
        # in Rover now: the transcript's folder decides.
        self.session(
            "claude-1",
            "claude-code",
            transcript_names=self.workspace,
            opened_folder=self.roots["valkama"] / "server",
            cwd=self.roots["rover"] / "web",
        )
        self.assertEqual(self.expected("example-project", "MAIN"), self.place_of("claude-1"))

    def test_a_codex_session_stands_in_its_opened_folder(self) -> None:
        self.session(
            "codex-1",
            "codex",
            opened_folder=self.roots["publisher"],
            cwd=self.roots["rover"],
        )
        self.assertEqual(self.expected("publisher", "MAIN"), self.place_of("codex-1"))

    def test_each_client_takes_its_folders_in_its_own_order(self) -> None:
        valkama, atlas, rover = (self.roots[name] for name in ("valkama", "atlas", "rover"))
        cases = (
            # Claude Code: the transcript's folder, then opened_folder, then cwd.
            (
                "claude",
                {"transcript_names": valkama, "opened_folder": atlas, "cwd": valkama},
                "valkama",
            ),
            ("claude", {"opened_folder": atlas, "cwd": rover}, "atlas"),
            ("claude", {"cwd": rover}, "rover"),
            # Codex keeps no folder in its journal: a transcript that would name one is not read.
            (
                "codex",
                {"transcript_names": valkama, "opened_folder": atlas, "cwd": valkama},
                "atlas",
            ),
            ("codex", {"cwd": rover}, "rover"),
        )
        for number, (client, folders, project) in enumerate(cases):
            with self.subTest(client=client, folders=sorted(folders), project=project):
                session = f"{client}-{number}"
                self.session(session, client, **folders)
                key = "ROVER" if project == "rover" else "MAIN"
                self.assertEqual(self.expected(project, key), self.place_of(session))

    def test_a_session_with_no_row_or_no_folder_has_no_place(self) -> None:
        self.session("empty", "claude")
        self.assertIsNone(self.place_of("empty"))
        self.assertIsNone(self.place_of("never-seen"))

    def test_places_of_many_sessions_are_one_read(self) -> None:
        self.session("a", "codex", opened_folder=self.roots["valkama"])
        self.session("b", "codex", cwd=self.base / "elsewhere")
        statements: list[str] = []
        self.conn.set_trace_callback(statements.append)
        self.addCleanup(self.conn.set_trace_callback, None)
        places = sessions.session_places(self.conn, ["a", "b", "a", "never-seen"], self.listing)
        self.conn.set_trace_callback(None)
        self.assertEqual({"a": self.expected("valkama", "MAIN"), "b": None}, places)
        self.assertEqual(1, sum("FROM sessions" in statement for statement in statements))


if __name__ == "__main__":
    unittest.main()
