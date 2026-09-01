from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface
from server.improvements import api as improvements_api
from server.skills import manifests, skills_inventory
from server.skills import matrix as skills_matrix
from tests.registry_fixtures import project_entry as registry_project_entry
from tests.registry_fixtures import registry_bytes

VALID_SKILL = """---
name: {name}
description: {description}
version: 1.2.3
license: MIT
---

SECRET BODY THAT MUST NEVER CROSS THE API
"""


class SkillsInventoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.activation_patch = mock.patch.object(
            skills_inventory,
            "_activation_states",
            side_effect=lambda skills, _specs, _home: {
                item["key"]: {
                    "codex": {
                        "enabled": True,
                        "can_toggle": True,
                        "status": "enabled",
                        "reason": None,
                    },
                    "claude": {
                        "enabled": False,
                        "can_toggle": True,
                        "status": "disabled",
                        "reason": None,
                    },
                }
                for item in skills
            },
        )
        self.activation_patch.start()

    def tearDown(self) -> None:
        self.activation_patch.stop()

    def write_skill(
        self,
        root: Path,
        directory: str,
        *,
        name: str | None = None,
        description: str = "Use this when a bounded workflow needs review.",
    ) -> Path:
        skill = root / directory
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            VALID_SKILL.format(name=name or directory, description=description),
            encoding="utf-8",
        )
        return skill

    def registry(self, path: Path, projects: list[dict]) -> Path:
        path.write_bytes(
            registry_bytes(
                [
                    registry_project_entry(
                        str(project["project_id"]),
                        str(project["canonical_root"]),
                        board=str(project["board"]),
                        source_hash=str(project["source_hash"]),
                    )
                    for project in projects
                ]
            )
        )
        return path

    def test_inventory_keeps_personal_and_project_variants_distinct_without_leaking_bodies_or_absolute_paths(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            personal = home / ".agents" / "skills"
            project = base / "project"
            project_skills = project / ".agents" / "skills"
            self.write_skill(personal, "review", description="Review personal workflows.")
            project_skill = self.write_skill(
                project_skills, "review", description="Review this project."
            )
            (project_skill / "scripts").mkdir()
            (project_skill / "scripts" / "check.py").write_text(
                "raise SystemExit(99)", encoding="utf-8"
            )
            registry = self.registry(
                base / "projects.json",
                [
                    {
                        "project_id": "sample",
                        "board": "Sample Board",
                        "canonical_root": str(project),
                        "source_hash": "a" * 64,
                    }
                ],
            )

            before = sorted(str(path.relative_to(base)) for path in base.rglob("*"))
            payload = skills_inventory.inventory_payload(
                registry_reader=registry.read_bytes,
                user_home=str(home),
                observed_at="2026-08-11T00:00:00Z",
            )
            after = sorted(str(path.relative_to(base)) for path in base.rglob("*"))

            self.assertEqual(before, after, "inventory must not mutate skill or registry roots")
            self.assertEqual("skills", payload["interface_version"])
            self.assertEqual("available", payload["registry"]["status"])
            self.assertEqual([{"id": "codex"}, {"id": "claude"}], payload["clients"])
            self.assertEqual(2, payload["summary"]["skills"])
            self.assertEqual(2, payload["summary"]["duplicates"])
            self.assertEqual(
                ["global:review", "project:sample:review"],
                [item["key"] for item in payload["skills"]],
            )
            project_entry = payload["skills"][1]
            self.assertTrue(project_entry["clients"]["codex"]["enabled"])
            self.assertFalse(project_entry["clients"]["claude"]["enabled"])
            self.assertTrue(project_entry["capabilities"]["scripts"])
            self.assertEqual(1, project_entry["capabilities"]["script_entries"])
            self.assertEqual(".agents/skills/review/SKILL.md", project_entry["location"])
            encoded = json.dumps(payload)
            self.assertNotIn(directory, encoded)
            self.assertNotIn("SECRET BODY", encoded)
            self.assertNotIn("raise SystemExit", encoded)

    def test_private_project_projection_is_not_consumed_or_attributed_publicly(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "example-project"
            self.write_skill(home / ".agents" / "skills", "route-subagents")
            self.write_skill(project / ".agents" / "user-scoped" / "skills", "route-subagents")
            registry = self.registry(
                base / "projects.json",
                [
                    {
                        "project_id": "example-project",
                        "board": "Example Board",
                        "canonical_root": str(project),
                        "source_hash": "a" * 64,
                    }
                ],
            )

            payload = skills_inventory.inventory_payload(
                registry_reader=registry.read_bytes, user_home=str(home)
            )

            self.assertEqual(1, payload["summary"]["skills"])
            entry = payload["skills"][0]
            self.assertIsNone(entry["owner_project_id"])
            self.assertIsNone(entry["owner_project_title"])
            self.assertEqual("global:route-subagents", entry["key"])
            project_row = payload["projects"][0]
            self.assertEqual(0, project_row["skill_count"])
            self.assertEqual("missing", project_row["root_status"])
            self.assertFalse(
                any(root["source"] == "project-user-source" for root in payload["roots"])
            )
            self.assertEqual(entry["root_id"], entry["skill_ref"]["root_id"])
            self.assertEqual(entry["directory_name"], entry["skill_ref"]["skill_id"])
            self.assertEqual(
                entry["provenance"]["content_hash"], entry["skill_ref"]["content_hash"]
            )

    def test_activation_target_does_not_infer_owner_from_private_projection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "example-project"
            global_skill = self.write_skill(home / ".agents" / "skills", "route-subagents")
            self.write_skill(project / ".agents" / "user-scoped" / "skills", "route-subagents")
            registry = self.registry(
                base / "projects.json",
                [
                    {
                        "project_id": "example-project",
                        "board": "Example Board",
                        "canonical_root": str(project),
                        "source_hash": "a" * 64,
                    }
                ],
            )

            entry, spec, manifest = skills_inventory._activation_target(
                key="global:route-subagents",
                registry_reader=registry.read_bytes,
                user_home=str(home),
            )

            self.assertEqual("valid", entry["validation"]["status"])
            self.assertIsNone(entry["owner_project_id"])
            self.assertEqual("user-canonical", spec["source"])
            self.assertEqual(global_skill / "SKILL.md", manifest)

    def test_missing_or_malformed_registry_does_not_hide_personal_skills(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            self.write_skill(home / ".agents" / "skills", "personal")
            missing = skills_inventory.inventory_payload(
                registry_reader=(base / "missing.json").read_bytes, user_home=str(home)
            )
            self.assertEqual("absent", missing["registry"]["status"])
            self.assertEqual(1, missing["summary"]["skills"])

            broken = base / "broken.json"
            broken.write_text("{", encoding="utf-8")
            malformed = skills_inventory.inventory_payload(
                registry_reader=broken.read_bytes, user_home=str(home)
            )
            self.assertEqual("malformed", malformed["registry"]["status"])
            self.assertEqual(1, malformed["summary"]["skills"])

    def test_invalid_oversized_and_unsafe_entries_are_typed_instead_of_aborting_the_snapshot(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            root = home / ".agents" / "skills"
            invalid = root / "invalid"
            invalid.mkdir(parents=True)
            (invalid / "SKILL.md").write_text("no frontmatter", encoding="utf-8")
            oversized = root / "oversized"
            oversized.mkdir()
            (oversized / "SKILL.md").write_bytes(b"x" * (manifests.MAX_SKILL_BYTES + 1))
            outside = base / "outside"
            self.write_skill(outside, "escaped")

            with mock.patch.object(
                manifests,
                "skill_directories",
                return_value=([invalid, oversized, outside / "escaped"], False),
            ):
                payload = skills_inventory.inventory_payload(
                    registry_reader=(base / "missing.json").read_bytes, user_home=str(home)
                )

            by_name = {item["directory_name"]: item for item in payload["skills"]}
            self.assertEqual("invalid", by_name["invalid"]["validation"]["status"])
            self.assertEqual("frontmatter_missing", by_name["invalid"]["validation"]["code"])
            self.assertEqual("skill_file_too_large", by_name["oversized"]["validation"]["code"])
            self.assertEqual("unsafe", by_name["escaped"]["availability"])
            self.assertEqual("path_escape", by_name["escaped"]["validation"]["code"])

    def test_manifest_read_is_bounded_before_content_is_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            root = home / ".agents" / "skills"
            oversized = root / "oversized"
            oversized.mkdir(parents=True)
            manifest = oversized / "SKILL.md"
            manifest.write_bytes(b"x" * (manifests.MAX_SKILL_BYTES + 4096))
            observed_reads: list[int] = []
            real_open = Path.open

            class RecordingReader:
                def __init__(self, handle):
                    self.handle = handle

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return self.handle.__exit__(*args)

                def read(self, size=-1):
                    observed_reads.append(size)
                    return self.handle.read(size)

            def bounded_open(path: Path, *args, **kwargs):
                handle = real_open(path, *args, **kwargs)
                if path == manifest:
                    return RecordingReader(handle)
                return handle

            with mock.patch.object(Path, "open", bounded_open):
                payload = skills_inventory.inventory_payload(
                    registry_reader=(base / "missing.json").read_bytes, user_home=str(home)
                )

            self.assertEqual([manifests.MAX_SKILL_BYTES + 1], observed_reads)
            self.assertEqual("skill_file_too_large", payload["skills"][0]["validation"]["code"])
            self.assertIsNone(payload["skills"][0]["provenance"]["content_hash"])

    def test_root_and_registry_caps_are_explicit_partial_states(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            root = home / ".agents" / "skills"
            for index in range(3):
                self.write_skill(root, f"skill-{index}")
            projects = [
                {
                    "project_id": f"project-{index}",
                    "board": f"Project {index}",
                    "canonical_root": str(base / f"project-{index}"),
                    "source_hash": "a" * 64,
                }
                for index in range(3)
            ]
            registry = self.registry(base / "projects.json", projects)

            with (
                mock.patch.object(manifests, "MAX_SKILLS_PER_ROOT", 2),
                mock.patch.object(skills_inventory, "MAX_PROJECTS", 2),
            ):
                payload = skills_inventory.inventory_payload(
                    registry_reader=registry.read_bytes, user_home=str(home)
                )

            self.assertTrue(payload["registry"]["truncated"])
            self.assertEqual(2, payload["registry"]["project_count"])
            self.assertEqual(3, payload["registry"]["total_project_count"])
            self.assertEqual("project_limit_reached", payload["registry"]["reason"])
            global_root = payload["roots"][0]
            self.assertTrue(global_root["truncated"])
            self.assertEqual("partial", global_root["availability"])
            self.assertEqual("partial", global_root["validation"])
            self.assertEqual("skill_limit_reached", global_root["reason"])

    def test_frontmatter_values_and_root_counts_are_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            root = home / ".agents" / "skills"
            self.write_skill(root, "bounded", description="x" * 1000)
            payload = skills_inventory.inventory_payload(
                registry_reader=(base / "missing.json").read_bytes, user_home=str(home)
            )
            self.assertLessEqual(
                len(payload["skills"][0]["description"]), manifests.MAX_DESCRIPTION
            )
            self.assertLessEqual(payload["roots"][0]["skill_count"], manifests.MAX_SKILLS_PER_ROOT)

    def test_root_outside_its_declared_boundary_is_reported_as_unsafe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            project = base / "project"
            project.mkdir()
            outside = base / "outside" / ".agents" / "skills"
            self.write_skill(outside, "escaped")
            spec = skills_inventory._root_spec(
                root_id="project:sample",
                root=outside,
                boundary=project,
                scope="project",
                source="project-local",
                project_id="sample",
                project_title="Sample",
            )

            root, entries = skills_inventory._scan_root(spec, "2026-08-11T00:00:00Z")

            self.assertEqual("unsafe", root["availability"])
            self.assertEqual("root_path_escape", root["reason"])
            self.assertEqual([], entries)

    def test_root_enumeration_failure_is_not_reported_as_an_empty_valid_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root_path = base / ".agents" / "skills"
            root_path.mkdir(parents=True)
            spec = skills_inventory._root_spec(
                root_id="global-agent-skills",
                root=root_path,
                boundary=base,
                scope="global",
                source="user-canonical",
            )
            with mock.patch.object(manifests, "skill_directories", side_effect=PermissionError):
                root, entries = skills_inventory._scan_root(spec, "2026-08-11T00:00:00Z")

            self.assertEqual("unavailable", root["availability"])
            self.assertEqual("root_unreadable", root["reason"])
            self.assertEqual([], entries)

    def test_http_route_returns_the_read_only_snapshot_without_entering_improvements_dispatch(
        self,
    ) -> None:
        handler = object.__new__(http_surface.Handler)
        handler.path = "/api/modules/skills"
        handler._require_host = mock.Mock(return_value=True)
        handler._module_gate = mock.Mock(return_value=True)
        handler._send_json = mock.Mock()
        expected = {"interface_version": "skills", "skills": []}
        with (
            mock.patch.object(http_surface, "connect", return_value=mock.Mock()),
            mock.patch.object(http_surface.platform_core, "Platform"),
            mock.patch.object(
                skills_inventory, "inventory_payload", return_value=expected
            ) as inventory,
            mock.patch.object(improvements_api, "handle_get") as improvements,
        ):
            handler.do_GET()
        inventory.assert_called_once_with()
        improvements.assert_not_called()
        handler._send_json.assert_called_once_with(200, expected)

    def test_skill_detail_returns_bounded_markdown_without_frontmatter_or_absolute_paths(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            self.write_skill(home / ".agents" / "skills", "review")

            detail = skills_inventory.skill_detail(
                key="global:review",
                registry_reader=(base / "missing.json").read_bytes,
                user_home=str(home),
            )

            self.assertEqual("skill-detail", detail["interface_version"])
            self.assertEqual("global:review", detail["key"])
            self.assertEqual("review", detail["name"])
            self.assertEqual(".agents/skills/review/SKILL.md", detail["location"])
            self.assertEqual(64, len(detail["content_hash"]))
            self.assertIn("SECRET BODY", detail["markdown"])
            self.assertNotIn("name: review", detail["markdown"])
            self.assertNotIn(directory, json.dumps(detail))

    def test_skill_detail_rejects_missing_and_oversized_manifests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            root = home / ".agents" / "skills"
            oversized = root / "oversized"
            oversized.mkdir(parents=True)
            (oversized / "SKILL.md").write_bytes(b"x" * (manifests.MAX_SKILL_BYTES + 1))

            with self.assertRaisesRegex(Exception, "skill_file_too_large"):
                skills_inventory.skill_detail(
                    key="global:oversized",
                    registry_reader=(base / "missing.json").read_bytes,
                    user_home=str(home),
                )
            with self.assertRaisesRegex(Exception, "skill_not_found"):
                skills_inventory.skill_detail(
                    key="global:missing",
                    registry_reader=(base / "missing.json").read_bytes,
                    user_home=str(home),
                )

    def test_skill_detail_reads_owner_junction_projections(self) -> None:
        """Junction/symlink-projected skill folders are a legitimate layout."""

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            root = home / ".agents" / "skills"
            root.mkdir(parents=True)
            canonical = self.write_skill(base / "canonical", "review")
            link = root / "review"
            try:
                os.symlink(canonical, link, target_is_directory=True)
            except OSError:
                completed = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(link), str(canonical)],
                    capture_output=True,
                    check=False,
                )
                if completed.returncode != 0:
                    self.skipTest("no symlink or junction support in this environment")

            detail = skills_inventory.skill_detail(
                key="global:review",
                registry_reader=(base / "missing.json").read_bytes,
                user_home=str(home),
            )

            self.assertEqual("global:review", detail["key"])
            self.assertIn("SECRET BODY", detail["markdown"])

    def test_http_route_returns_one_explicit_skill_detail(self) -> None:
        handler = object.__new__(http_surface.Handler)
        handler.path = "/api/modules/skills/detail?key=global%3Areview"
        handler._require_host = mock.Mock(return_value=True)
        handler._module_gate = mock.Mock(return_value=True)
        handler._send_json = mock.Mock()
        expected = {
            "interface_version": "skill-detail",
            "key": "global:review",
            "name": "review",
            "location": ".agents/skills/review/SKILL.md",
            "content_hash": "a" * 64,
            "markdown": "# Review",
        }
        with (
            mock.patch.object(http_surface, "connect", return_value=mock.Mock()),
            mock.patch.object(http_surface.platform_core, "Platform"),
            mock.patch.object(skills_inventory, "skill_detail", return_value=expected) as detail,
        ):
            handler.do_GET()
        detail.assert_called_once_with(key="global:review")
        handler._send_json.assert_called_once_with(200, expected)

    def test_http_route_updates_one_client_activation_and_returns_a_fresh_snapshot(self) -> None:
        handler = object.__new__(http_surface.Handler)
        handler.path = "/api/modules/skills/activation"
        handler._require_host = mock.Mock(return_value=True)
        handler._module_gate = mock.Mock(return_value=True)
        handler.server = mock.Mock(security_context=mock.Mock())
        handler.headers = mock.Mock()
        handler._read_json = mock.Mock(
            return_value={"key": "global:review", "client": "codex", "enabled": False}
        )
        handler._send_json = mock.Mock()
        expected = {"interface_version": "skills", "skills": []}
        with (
            mock.patch.object(http_surface.http_security, "require_write_authorization"),
            mock.patch.object(http_surface, "connect", return_value=mock.Mock()),
            mock.patch.object(http_surface.platform_core, "Platform"),
            mock.patch.object(
                skills_inventory, "update_skill_activation", return_value=expected
            ) as update,
        ):
            handler.do_POST()
        # `project=None` is the owner's own answer, stated rather than absent:
        # the route always says which scope it means.
        update.assert_called_once_with(
            key="global:review", client="codex", enabled=False, project=None
        )
        handler._send_json.assert_called_once_with(200, expected)

    def test_claude_activation_refuses_name_collisions_and_conflicting_client_projection(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "project"
            self.write_skill(home / ".agents" / "skills", "review")
            self.write_skill(project / ".agents" / "skills", "review")
            registry = self.registry(
                base / "projects.json",
                [
                    {
                        "project_id": "sample",
                        "board": "Sample",
                        "canonical_root": str(project),
                        "source_hash": "a" * 64,
                    }
                ],
            )

            with self.assertRaisesRegex(Exception, "claude_skill_name_collision"):
                skills_inventory.update_skill_activation(
                    key="project:sample:review",
                    client="claude",
                    enabled=False,
                    registry_reader=registry.read_bytes,
                    user_home=str(home),
                )

            global_manifest = home / ".agents" / "skills" / "review" / "SKILL.md"
            global_manifest.unlink()
            global_manifest.parent.rmdir()
            conflicting = project / ".claude" / "skills" / "review"
            conflicting.mkdir(parents=True)
            (conflicting / "SKILL.md").write_text("different", encoding="utf-8")
            with self.assertRaisesRegex(Exception, "claude_skill_projection_conflict"):
                skills_inventory.update_skill_activation(
                    key="project:sample:review",
                    client="claude",
                    enabled=False,
                    registry_reader=registry.read_bytes,
                    user_home=str(home),
                )

    def test_enabling_a_missing_claude_projection_connects_it_before_setting_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "project"
            self.write_skill(project / ".agents" / "skills", "review")
            registry = self.registry(
                base / "projects.json",
                [
                    {
                        "project_id": "sample",
                        "board": "Sample",
                        "canonical_root": str(project),
                        "source_hash": "a" * 64,
                    }
                ],
            )

            with (
                mock.patch.object(
                    skills_inventory.skill_activation,
                    "claude_projection_status",
                    return_value="missing",
                ),
                mock.patch.object(
                    skills_inventory.skill_activation, "ensure_claude_projection"
                ) as connect,
                mock.patch.object(
                    skills_inventory.skill_activation, "set_claude_skill", return_value=True
                ) as update,
            ):
                skills_inventory.update_skill_activation(
                    key="project:sample:review",
                    client="claude",
                    enabled=True,
                    registry_reader=registry.read_bytes,
                    user_home=str(home),
                )

            connect.assert_called_once()
            update.assert_called_once()


class ActivationMatrixTests(unittest.TestCase):
    """Skill x Project x Client, and the client that has no per-project answer.

    The rule the plan states in one line is the whole of these cases: the
    interface must not invent universality. A cell has to say whether its
    client can hold a per-project answer at all, because "off here" and "this
    client has no here" look identical otherwise.
    """

    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.root = Path(self._dir.name)
        self.home = self.root / "home"
        (self.home / ".agents" / "skills" / "review").mkdir(parents=True)
        (self.home / ".agents" / "skills" / "review" / "SKILL.md").write_text(
            "---\nname: review\ndescription: Review bounded work.\n---\n\nUse it.\n",
            encoding="utf-8",
            newline="\n",
        )
        self.alpha = self.root / "alpha"
        self.beta = self.root / "beta"
        for project in (self.alpha, self.beta):
            project.mkdir()
        self.registry = self.root / "projects.json"
        self.registry.write_bytes(
            registry_bytes(
                [
                    registry_project_entry("alpha", self.alpha, board="Alpha"),
                    registry_project_entry("beta", self.beta, board="Beta", source_hash="b" * 64),
                ]
            )
        )

    def matrix(self) -> dict:
        # No codex app-server in a test: its cells are unavailable, which is a
        # different fact from unsupported and both must survive the matrix.
        with mock.patch.object(
            skills_inventory.skill_activation,
            "list_codex_skills",
            side_effect=skills_inventory.skill_activation.SkillActivationError(
                "codex_app_server_unavailable", status=503
            ),
        ):
            return skills_matrix.activation_matrix(
                registry_reader=self.registry.read_bytes, user_home=str(self.home)
            )

    def override(self, project: Path, value: str) -> None:
        settings = project / ".claude" / "settings.local.json"
        settings.parent.mkdir(parents=True, exist_ok=True)
        settings.write_text(
            json.dumps({"skillOverrides": {"review": value}}), encoding="utf-8", newline="\n"
        )

    def test_a_client_declares_whether_it_has_a_per_project_answer_at_all(self) -> None:
        answer = self.matrix()
        scopes = {client["id"]: client["project_scope"] for client in answer["clients"]}
        self.assertTrue(scopes["claude"])
        self.assertFalse(scopes["codex"])

    def test_one_global_skill_can_be_off_in_one_project_and_on_in_another(self) -> None:
        """The fact the reading could not express before.

        Claude's overrides may be set in any settings file and a project's
        outranks the user's, so this is the client's own behaviour rather than
        something Valkama keeps a record of.
        """

        self.override(self.alpha, "off")
        (skill,) = self.matrix()["skills"]
        cells = {cell["project_id"]: cell["clients"] for cell in skill["cells"]}
        self.assertFalse(cells["alpha"]["claude"]["enabled"])
        self.assertTrue(cells["beta"]["claude"]["enabled"])

    def test_a_client_without_project_scope_repeats_one_value_and_says_why(self) -> None:
        # Repeating is honest. Recomputing per project would invent a
        # difference the client cannot hold, and offering a toggle would let
        # one project's control change every project.
        self.override(self.alpha, "off")
        (skill,) = self.matrix()["skills"]
        codex = [cell["clients"]["codex"] for cell in skill["cells"]]
        self.assertEqual([False, False], [cell["project_scope"] for cell in codex])
        self.assertEqual([False, False], [cell["can_toggle"] for cell in codex])
        self.assertEqual(
            ["codex_app_server_unavailable", "codex_app_server_unavailable"],
            [cell["reason"] for cell in codex],
        )

    def test_every_registered_project_is_a_column_even_with_no_answer(self) -> None:
        answer = self.matrix()
        self.assertEqual(["alpha", "beta"], [row["project_id"] for row in answer["projects"]])
        self.assertFalse(answer["truncated"])
        for skill in answer["skills"]:
            self.assertEqual(["alpha", "beta"], [cell["project_id"] for cell in skill["cells"]])

    def test_a_project_named_for_a_client_without_project_scope_is_refused(self) -> None:
        """Refused, not ignored.

        Ignoring it would write the owner-wide value under a project's name:
        the caller asked about one project and every project would change.
        """

        with self.assertRaises(skills_inventory.skill_activation.SkillActivationError) as raised:
            skills_inventory.update_skill_activation(
                key="global:review",
                client="codex",
                enabled=False,
                project="alpha",
                registry_reader=self.registry.read_bytes,
                user_home=str(self.home),
            )
        self.assertEqual("client_activation_is_not_project_scoped", raised.exception.code)

    def test_a_named_project_writes_that_project_and_leaves_the_others_alone(self) -> None:
        with mock.patch.object(
            skills_inventory.skill_activation, "list_codex_skills", return_value={}
        ):
            skills_inventory.update_skill_activation(
                key="global:review",
                client="claude",
                enabled=False,
                project="alpha",
                registry_reader=self.registry.read_bytes,
                user_home=str(self.home),
            )
        stored = json.loads(
            (self.alpha / ".claude" / "settings.local.json").read_text(encoding="utf-8")
        )
        self.assertEqual("off", stored["skillOverrides"]["review"])
        self.assertFalse((self.beta / ".claude").exists())
        self.assertFalse((self.home / ".claude" / "settings.json").exists())

    def test_an_unmapped_project_is_refused_by_name(self) -> None:
        with self.assertRaises(skills_inventory.skill_activation.SkillActivationError) as raised:
            skills_inventory.update_skill_activation(
                key="global:review",
                client="claude",
                enabled=False,
                project="nowhere",
                registry_reader=self.registry.read_bytes,
                user_home=str(self.home),
            )
        self.assertEqual("project_root_unavailable", raised.exception.code)


if __name__ == "__main__":
    unittest.main()
