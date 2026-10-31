"""Installing the Valkama skill where each client finds its user's skills.

Every case runs in a throwaway home: `HOME`, `USERPROFILE`, `LOCALAPPDATA`,
`CLAUDE_CONFIG_DIR` and `CODEX_HOME` all point inside it, and the launcher's
answer is a fixture, so nothing here can read or write a real client's skills,
configuration or launcher. The release a copy is compared with is a directory
the test writes, standing for the one the launcher pins.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli
from server.ops import doctor, skills

SKILL = b"---\nname: valkama\ndescription: Track work in Valkama.\n---\n\n# Valkama\n"
REFERENCE = b"# Tools\n"


class SkillTestCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.home = self.root / "home"
        self.home.mkdir()
        patch = mock.patch.dict(
            os.environ,
            {
                "HOME": str(self.home),
                "USERPROFILE": str(self.home),
                "LOCALAPPDATA": str(self.root / "local"),
                "XDG_BIN_HOME": str(self.root / "bin"),
                "CLAUDE_CONFIG_DIR": str(self.home / ".claude"),
                "CODEX_HOME": str(self.home / ".codex"),
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.release = self.pin("rev-one", {"SKILL.md": SKILL, "references/tools.md": REFERENCE})

    def pin(self, revision: str, files: dict[str, bytes]) -> Path:
        """A release with this skill, and the launcher naming it as the pinned one."""

        release = self.root / "releases" / revision
        release.mkdir(parents=True)
        for name, data in files.items():
            path = release.joinpath("server", "skill", "valkama", name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (release / "valkama.py").write_text("", encoding="utf-8")
        state = {
            "state": "installed",
            "source_available": True,
            "source_script": str(release / "valkama.py"),
            "revision": revision,
        }
        patch = mock.patch.object(skills.launcher, "status", return_value=state)
        patch.start()
        self.addCleanup(patch.stop)
        return release

    def client(self, name: str) -> None:
        """Set the client up for this user, as its own first run would."""

        (self.home / (".claude" if name == "claude" else ".codex")).mkdir(exist_ok=True)

    def state(self, client: str) -> str:
        return str(skills.status(client, skills.source())["state"])

    def files_under(self, path: Path) -> set[str]:
        return {p.relative_to(path).as_posix() for p in path.rglob("*") if p.is_file()}


class TargetTests(SkillTestCase):
    def test_each_client_is_given_the_directory_it_reads_by_itself(self) -> None:
        self.assertEqual(self.home / ".claude" / "skills" / "valkama", skills.target("claude"))
        self.assertEqual(self.home / ".agents" / "skills" / "valkama", skills.target("codex"))
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": str(self.root / "elsewhere")}):
            self.assertEqual(
                self.root / "elsewhere" / "skills" / "valkama", skills.target("claude")
            )
        with self.assertRaises(skills.SkillError):
            skills.target("cursor")

    def test_the_source_is_the_pinned_release_or_else_the_running_code(self) -> None:
        pinned = skills.source()
        self.assertEqual(("pinned", "rev-one"), (pinned.origin, pinned.revision))
        self.assertEqual({"SKILL.md": SKILL, "references/tools.md": REFERENCE}, pinned.files)
        with mock.patch.object(skills.launcher, "status", return_value={"state": "missing"}):
            running = skills.source()
        self.assertEqual(("running", None), (running.origin, running.revision))
        # The running code is this checkout, whose skill is the one it ships.
        self.assertIn("SKILL.md", running.files)


class InstallTests(SkillTestCase):
    def test_install_writes_the_skill_for_the_clients_this_user_has(self) -> None:
        self.client("claude")
        answer = skills.install()
        [entry] = answer["clients"]
        self.assertEqual(
            ("claude", "installed", "installed"), (entry["client"], entry["action"], entry["state"])
        )
        target = skills.target("claude")
        self.assertEqual(SKILL, (target / "SKILL.md").read_bytes())
        self.assertEqual(REFERENCE, (target / "references" / "tools.md").read_bytes())
        manifest = json.loads((target / skills.MANIFEST_NAME).read_text(encoding="utf-8"))
        self.assertEqual("rev-one", manifest["revision"])
        # Codex was never set up here, so nothing was written for it.
        self.assertFalse((self.home / ".agents").exists())
        # And no client configuration exists that this could have touched.
        self.assertFalse((self.home / ".claude.json").exists())
        self.assertEqual({"skills"}, {p.name for p in (self.home / ".claude").iterdir()})

    def test_install_is_idempotent(self) -> None:
        skills.install(["codex"])
        target = skills.target("codex")
        stamps = {name: (target / name).stat().st_mtime_ns for name in self.files_under(target)}
        [again] = skills.install(["codex"])["clients"]
        self.assertEqual(("unchanged", "installed"), (again["action"], again["state"]))
        self.assertEqual(
            stamps, {name: (target / name).stat().st_mtime_ns for name in self.files_under(target)}
        )

    def test_a_new_pin_makes_a_copy_outdated_and_install_brings_it_up(self) -> None:
        skills.install(["claude"])
        self.pin("rev-two", {"SKILL.md": SKILL + b"\nMore.\n"})
        self.assertEqual("outdated", self.state("claude"))
        [entry] = skills.install(["claude"])["clients"]
        self.assertEqual(("replaced", "installed"), (entry["action"], entry["state"]))
        target = skills.target("claude")
        # The file the old release had and the new one does not is gone, and so is
        # the directory it left empty.
        self.assertEqual({"SKILL.md", skills.MANIFEST_NAME}, self.files_under(target))
        self.assertFalse((target / "references").exists())

    def test_an_edited_copy_is_drifted_and_kept_without_force(self) -> None:
        skills.install(["claude"])
        target = skills.target("claude")
        (target / "SKILL.md").write_bytes(b"my own notes\n")
        status = skills.status("claude", skills.source())
        self.assertEqual("drifted", status["state"])
        self.assertIn("SKILL.md was edited", str(status["detail"]))
        [refused] = skills.install(["claude"])["clients"]
        self.assertEqual("refused", refused["action"])
        self.assertEqual(b"my own notes\n", (target / "SKILL.md").read_bytes())
        [forced] = skills.install(["claude"], force=True)["clients"]
        self.assertEqual(("replaced", "installed"), (forced["action"], forced["state"]))
        self.assertEqual(SKILL, (target / "SKILL.md").read_bytes())

    def test_a_skill_valkama_did_not_write_is_never_taken_or_removed_unasked(self) -> None:
        target = skills.target("codex")
        target.mkdir(parents=True)
        (target / "SKILL.md").write_bytes(b"someone else's\n")
        (target / "notes.md").write_bytes(b"theirs\n")
        self.assertEqual("unmanaged", self.state("codex"))
        [refused] = skills.install(["codex"])["clients"]
        self.assertEqual("refused", refused["action"])
        [removal] = skills.uninstall(["codex"], force=True)["clients"]
        self.assertEqual("refused", removal["action"])
        self.assertEqual(b"someone else's\n", (target / "SKILL.md").read_bytes())
        [forced] = skills.install(["codex"], force=True)["clients"]
        self.assertEqual(["notes.md"], forced["foreign"])
        self.assertEqual(b"theirs\n", (target / "notes.md").read_bytes())

    def test_a_release_without_a_skill_is_refused(self) -> None:
        self.pin("rev-bare", {})
        with self.assertRaisesRegex(skills.SkillError, "there is no skill"):
            skills.install(["claude"])


class UninstallTests(SkillTestCase):
    def test_uninstall_removes_what_valkama_wrote_and_nothing_else(self) -> None:
        skills.install(["claude", "codex"])
        claude = skills.target("claude")
        (claude / "mine.md").write_bytes(b"added by hand\n")
        answer = skills.uninstall()
        by_client = {entry["client"]: entry for entry in answer["clients"]}
        # A copy with a file added by hand is drifted, so it stays without force.
        self.assertEqual("refused", by_client["claude"]["action"])
        self.assertEqual("removed", by_client["codex"]["action"])
        self.assertFalse(skills.target("codex").exists())
        self.assertTrue((self.home / ".agents" / "skills").is_dir())
        skills.uninstall(["claude"], force=True)
        self.assertEqual({"mine.md"}, self.files_under(claude))
        [again] = skills.uninstall(["codex"])["clients"]
        self.assertEqual("unchanged", again["action"])


class RefreshTests(SkillTestCase):
    def test_a_launcher_install_moves_only_the_copies_valkama_manages(self) -> None:
        self.client("claude")
        self.client("codex")
        skills.install(["claude"])
        self.pin("rev-two", {"SKILL.md": SKILL + b"\nMore.\n"})
        refreshed = skills.refresh()
        self.assertEqual([("claude", "replaced")], [(e["client"], e["action"]) for e in refreshed])
        self.assertEqual("installed", self.state("claude"))
        self.assertEqual("missing", self.state("codex"))

    def test_the_cli_reports_the_refresh_beside_the_launcher_install(self) -> None:
        skills.install(["codex"])
        self.pin("rev-two", {"SKILL.md": SKILL + b"\nMore.\n"})
        output = io.StringIO()
        with (
            mock.patch.object(cli.launcher, "install", return_value={"state": "installed"}),
            contextlib.redirect_stdout(output),
        ):
            cli.main(["launcher", "install"])
        answer = json.loads(output.getvalue())
        self.assertEqual(["codex"], [entry["client"] for entry in answer["skills"]])
        self.assertEqual("installed", self.state("codex"))


class CommandTests(SkillTestCase):
    def run_cli(self, *arguments: str) -> tuple[int, dict]:
        output = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(output):
            try:
                cli.main(["skill", *arguments])
            except SystemExit as stopped:
                code = int(stopped.code or 0)
        return code, json.loads(output.getvalue())

    def test_install_status_and_uninstall_from_the_command_line(self) -> None:
        code, installed = self.run_cli("install", "--client", "codex")
        self.assertEqual(0, code)
        self.assertEqual(["codex"], [entry["client"] for entry in installed["clients"]])
        code, status = self.run_cli("status")
        self.assertEqual(
            {"claude": "missing", "codex": "installed"},
            {entry["client"]: entry["state"] for entry in status["clients"]},
        )
        (skills.target("codex") / "SKILL.md").write_bytes(b"edited\n")
        code, refused = self.run_cli("install", "--client", "codex")
        self.assertEqual(1, code)
        self.assertEqual("refused", refused["clients"][0]["action"])
        code, removed = self.run_cli("uninstall", "--client", "codex", "--force")
        self.assertEqual((0, "removed"), (code, removed["clients"][0]["action"]))


class DoctorSkillTests(SkillTestCase):
    def checks(self) -> list[dict]:
        return doctor._skill_checks()

    def test_no_client_needs_no_skill(self) -> None:
        [check] = self.checks()
        self.assertEqual(
            ("ok", "skill-no-client"), (check["status"], check["presentation"]["code"])
        )

    def test_each_state_reads_as_a_finding_with_its_fix(self) -> None:
        self.client("claude")
        [missing] = self.checks()
        self.assertEqual(
            ("warn", "skill-missing"), (missing["status"], missing["presentation"]["code"])
        )
        self.assertIn("valkama skill install --client claude", missing["fix"])
        skills.install(["claude"])
        [installed] = self.checks()
        self.assertEqual(
            ("ok", "skill-installed"), (installed["status"], installed["presentation"]["code"])
        )
        self.pin("rev-two", {"SKILL.md": SKILL + b"\nMore.\n"})
        [outdated] = self.checks()
        self.assertEqual("skill-outdated", outdated["presentation"]["code"])
        (skills.target("claude") / "SKILL.md").write_bytes(b"edited\n")
        [drifted] = self.checks()
        self.assertEqual("skill-drifted", drifted["presentation"]["code"])
        self.assertIn("--force", drifted["fix"])

    def test_the_check_sits_in_the_installation_level(self) -> None:
        report = doctor.diagnose(probe=False)
        installation = next(level for level in report["levels"] if level["id"] == "installation")
        self.assertIn("skill", [check["id"] for check in installation["checks"]])


if __name__ == "__main__":
    unittest.main()
