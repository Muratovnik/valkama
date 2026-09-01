from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server.skills import skill_activation


class _Completed:
    def __init__(self, *, stdout: str, stderr: str = "", returncode: int = 0) -> None:
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


class SkillActivationTests(unittest.TestCase):
    def test_codex_requests_use_the_app_server_handshake_and_exact_skill_path(self) -> None:
        calls: list[tuple[list[str], str]] = []

        def runner(argv, **kwargs):
            calls.append((list(argv), kwargs["input"]))
            return _Completed(
                stdout='{"id":0,"result":{}}\n{"id":1,"result":{"effectiveEnabled":false}}\n'
            )

        manifest = Path("C:/workspace/.agents/skills/review/SKILL.md")
        effective = skill_activation.set_codex_skill(
            manifest, False, runner=runner, executable="codex"
        )

        self.assertFalse(effective)
        self.assertEqual(["codex", "app-server", "--stdio"], calls[0][0])
        packets = [json.loads(line) for line in calls[0][1].splitlines()]
        self.assertEqual("initialize", packets[0]["method"])
        self.assertEqual("initialized", packets[1]["method"])
        self.assertEqual("skills/config/write", packets[2]["method"])
        self.assertEqual(str(manifest), packets[2]["params"]["path"])
        self.assertIsNone(packets[2]["params"]["name"])
        self.assertFalse(packets[2]["params"]["enabled"])

    def test_codex_list_is_path_authoritative_and_rejects_malformed_responses(self) -> None:
        manifest = Path("C:/workspace/.agents/skills/review/SKILL.md")

        def request(method, params):
            self.assertEqual("skills/list", method)
            self.assertEqual(
                [skill_activation.canonical_path(Path("C:/workspace"))], params["cwds"]
            )
            return {
                "data": [
                    {"cwd": "C:/workspace", "skills": [{"path": str(manifest), "enabled": True}]}
                ]
            }

        self.assertEqual(
            {skill_activation.canonical_path(manifest): True},
            skill_activation.list_codex_skills([Path("C:/workspace")], request=request),
        )
        with self.assertRaises(skill_activation.SkillActivationError):
            skill_activation.list_codex_skills(
                [Path("C:/workspace")], request=lambda *_: {"data": "broken"}
            )

    def test_claude_project_override_has_precedence_and_write_preserves_unrelated_settings(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "project"
            user_settings = home / ".claude" / "settings.json"
            project_settings = project / ".claude" / "settings.json"
            local_settings = project / ".claude" / "settings.local.json"
            user_settings.parent.mkdir(parents=True)
            project_settings.parent.mkdir(parents=True)
            user_settings.write_text(
                json.dumps({"skillOverrides": {"review": "off"}, "theme": "dark"}), encoding="utf-8"
            )
            project_settings.write_text(
                json.dumps(
                    {"skillOverrides": {"review": "name-only"}, "permissions": {"allow": []}}
                ),
                encoding="utf-8",
            )
            local_settings.write_text(
                json.dumps({"skillOverrides": {"review": "on"}, "env": {"SAFE": "1"}}),
                encoding="utf-8",
            )

            state = skill_activation.claude_skill_state("review", home=home, project_root=project)
            self.assertEqual(
                {"enabled": True, "can_toggle": True, "status": "enabled", "reason": None}, state
            )

            updated = skill_activation.set_claude_skill(
                "review", False, home=home, project_root=project
            )
            self.assertFalse(updated)
            stored = json.loads(local_settings.read_text(encoding="utf-8"))
            self.assertEqual("off", stored["skillOverrides"]["review"])
            self.assertEqual({"SAFE": "1"}, stored["env"])
            self.assertEqual("dark", json.loads(user_settings.read_text(encoding="utf-8"))["theme"])

    def test_malformed_claude_settings_are_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            settings = home / ".claude" / "settings.json"
            settings.parent.mkdir(parents=True)
            settings.write_text("{", encoding="utf-8")

            state = skill_activation.claude_skill_state("review", home=home)
            self.assertEqual("unavailable", state["status"])
            self.assertFalse(state["can_toggle"])
            with self.assertRaises(skill_activation.SkillActivationError):
                skill_activation.set_claude_skill("review", True, home=home)
            self.assertEqual("{", settings.read_text(encoding="utf-8"))

    def test_missing_claude_projection_is_toggleable_and_created_on_enable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "project"
            manifest = project / ".agents" / "skills" / "review" / "SKILL.md"
            manifest.parent.mkdir(parents=True)
            manifest.write_text(
                "---\nname: review\ndescription: Review work.\n---\n", encoding="utf-8"
            )

            self.assertEqual(
                "missing",
                skill_activation.claude_projection_status(
                    manifest, home=home, project_root=project
                ),
            )
            with mock.patch.object(os, "symlink") as create_link:
                skill_activation.ensure_claude_projection(manifest, home=home, project_root=project)
            create_link.assert_called_once_with(
                manifest.parent,
                project / ".claude" / "skills" / "review",
                target_is_directory=True,
            )

    def test_conflicting_claude_projection_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            home = base / "home"
            project = base / "project"
            manifest = project / ".agents" / "skills" / "review" / "SKILL.md"
            manifest.parent.mkdir(parents=True)
            manifest.write_text(
                "---\nname: review\ndescription: Review work.\n---\n", encoding="utf-8"
            )
            conflicting = project / ".claude" / "skills" / "review"
            conflicting.mkdir(parents=True)
            (conflicting / "SKILL.md").write_text("different", encoding="utf-8")

            self.assertEqual(
                "conflict",
                skill_activation.claude_projection_status(
                    manifest, home=home, project_root=project
                ),
            )
            with self.assertRaisesRegex(
                skill_activation.SkillActivationError,
                "claude_skill_projection_conflict",
            ):
                skill_activation.ensure_claude_projection(manifest, home=home, project_root=project)


if __name__ == "__main__":
    unittest.main()
