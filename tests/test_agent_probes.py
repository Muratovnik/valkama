"""What `tests/agent_probes.py run` owes: a working profile, a recorded session, the user's files untouched.

The user here is a directory this test builds and names through the environment
the runner starts from: instruction files, client settings with hooks of a
memory service and of an installed Valkama release, skills, plugins, a project
registry and a store as Valkama 2.9 leaves one. The clients are
`tests/agent_probes/fake_client.py`, which runs what the profile registered and
makes the calls its prompt lists; no model and no network are involved.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
import threading
import time
import tomllib
import unittest
from pathlib import Path
from typing import Any, ClassVar
from unittest import mock

from server import store
from server.store_identity.refs import planning_space_entity
from tests import agent_probes, agent_probes_judge, machine_lock
from tests import test_planning_work_model_migration as work_model
from tests.test_registry_owner import _former_inventory as former_inventory
from tests.test_registry_owner import _former_projection as former_projection

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "tests" / "agent_probes"
FAKE = SAMPLES / "fake_client.py"

#: What a coordinator hook of the user's does: print one file, for the main agent only.
PRINT_FILE = (
    "import json, sys\n"
    "agent = json.loads(sys.stdin.buffer.read() or b'{}').get('agent_id')\n"
    "if not agent:\n"
    "    sys.stdout.buffer.write(open(sys.argv[1], 'rb').read())\n"
)
#: The launcher of an installed release that writes for the store schema before
#: this one, as a 2.9 install does: its hook spools what a newer store refuses.
OLD_RELEASE = """\
import sys
sys.path.insert(0, {root!r})
from server import store
store.STORE_SCHEMA_VERSION = {schema}
from server.hooks import entry
sys.exit(entry.main(sys.argv[2:]))
"""


def tree_digest(root: Path) -> dict[str, str]:
    """Every file under `root` by its path, with the SHA-256 of its bytes.

    A store's `-shm` and `-wal` files are left out: SQLite makes them for any
    reader of a store in WAL mode, a read-only one included, and a live store has
    them already, kept by the service it runs under. `new_sidecars` checks what a
    read left there.
    """

    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file() and not path.name.endswith(SIDECARS)
    }


SIDECARS = (".sqlite3-shm", ".sqlite3-wal")


def new_sidecars(root: Path, before: dict[str, str]) -> dict[str, int]:
    """The WAL files a read made beside a store, by path, with their sizes."""

    return {
        path.relative_to(root).as_posix(): path.stat().st_size
        for path in root.rglob("*.sqlite3-wal")
        if path.relative_to(root).as_posix() not in before
    }


def make_user(root: Path) -> dict[str, Path]:
    """The user's side of a run, as a client user's home holds it."""

    claude, codex, local = root / ".claude", root / ".codex", root / "AppData" / "Local"
    coordinator = claude / "coordinator"
    for directory in (coordinator, codex, local / "Valkama" / "bin", root / ".valkama"):
        directory.mkdir(parents=True)
    (claude / "CLAUDE.md").write_text(
        "# Instructions\n\n## Reading\n\nRead the range you need.\n\n"
        "## Planning\n\nOld planning text.\n\n## Responses\n\nBe brief.\n",
        encoding="utf-8",
    )
    (codex / "AGENTS.md").write_text(
        "# Instructions\n\n## Planning\n\nOld planning text.\n\n"
        "## Coordination\n\nOld coordination text.\n",
        encoding="utf-8",
    )
    (coordinator / "coordination.md").write_text(
        "## Coordination\n\nOld coordination text.\n", encoding="utf-8"
    )
    (coordinator / "questions.md").write_text("## Questions\n\nAsk the caller.\n", "utf-8")
    launcher = local / "Valkama" / "bin" / "valkama-launcher.py"
    launcher.write_text(OLD_RELEASE.format(root=str(ROOT), schema=17), encoding="utf-8")

    def release(event: str, client: str = "claude") -> dict[str, Any]:
        return {
            "type": "command",
            "command": sys.executable,
            "args": ["-I", "-S", str(launcher), "hook", client, event],
            "timeout": 5,
        }

    memory = {"type": "command", "command": sys.executable, "args": ["-c", "pass"]}
    printer = {
        "type": "command",
        "command": sys.executable,
        "args": ["-I", "-S", "-c", PRINT_FILE, str(coordinator / "coordination.md")],
    }
    settings = {
        "model": "a-model",
        "env": {"VALKAMA_DB": str(root / "elsewhere.sqlite3"), "KEPT": "1"},
        "statusLine": {"type": "command", "command": str(launcher)},
        "hooks": {
            "SessionStart": [
                {"matcher": "*", "hooks": [memory]},
                {"matcher": "*", "hooks": [release("session-start")]},
                {"matcher": "*", "hooks": [printer]},
            ],
            "PreToolUse": [{"matcher": "^mcp__valkama__", "hooks": [release("pre-tool-use")]}],
            "PostToolUse": [{"matcher": "*", "hooks": [release("post-tool-use")]}],
            "MessageDisplay": [
                {"matcher": "*", "hooks": [{"type": "http", "url": "http://127.0.0.1:8642/x"}]}
            ],
        },
    }
    (claude / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
    codex_line = f'"{sys.executable}" -I -S "{launcher}" hook codex session-start'
    codex_hooks = {
        "hooks": {
            "SessionStart": [
                {
                    "hooks": [
                        {"type": "command", "command": codex_line, "commandWindows": codex_line}
                    ]
                },
                {"hooks": [{"type": "command", "command": "memory-capture"}]},
            ]
        }
    }
    (codex / "hooks.json").write_text(json.dumps(codex_hooks), encoding="utf-8")
    (codex / "config.toml").write_text(
        'model = "a-model"\n\n[mcp_servers.memory]\ncommand = "memory"\n\n'
        '[mcp_servers.valkama]\ncommand = "valkama.cmd"\n\n[mcp_servers.valkama.env]\n'
        'VALKAMA_AUTHOR = "codex"\n\n[windows]\nsandbox = "elevated"\n',
        encoding="utf-8",
    )
    for skills in (claude / "skills", root / ".agents" / "skills", codex / "skills"):
        for name, text in (("valkama", "an installed release's skill"), ("helper", "help")):
            (skills / name).mkdir(parents=True)
            (skills / name / "SKILL.md").write_text(f"{text}\n", encoding="utf-8")
    plugins = claude / "plugins"
    (plugins / "cache" / "tool").mkdir(parents=True)
    (plugins / "cache" / "tool" / "plugin.json").write_text("{}", encoding="utf-8")
    (plugins / "installed_plugins.json").write_text(
        json.dumps({"tool": {"installPath": str(plugins / "cache" / "tool")}}), encoding="utf-8"
    )
    entries = [
        {
            "project_id": project,
            "display_name": project.title(),
            "canonical_root": str(root / "roots" / project),
            "planning_binding": planning_space_entity(
                {"data_scope_id": work_model.DATA_SCOPE, "space_key": key}
            ),
        }
        for key, project in sorted(work_model.SPACE_PROJECTS.items())
    ]
    # The registry as 2.9 leaves it: an inventory of format 1 beside a projection of 3.
    (local / "Valkama" / "project-registry.toml").write_bytes(former_inventory(entries))
    (local / "Valkama" / "projects.json").write_bytes(former_projection(entries))
    work_model.build(str(root / ".valkama" / "valkama.sqlite3"))
    # A session of the user's that ended before its transcript could be copied: the
    # copy's sweep finds it owed and would read the user's client file it names.
    live = claude / "projects" / "app" / f"{LIVE_SESSION}.jsonl"
    live.parent.mkdir(parents=True)
    live.write_bytes(b'{"type": "user"}\n')
    with contextlib.closing(sqlite3.connect(root / ".valkama" / "valkama.sqlite3")) as conn:
        conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " client, session_id, transcript_path) VALUES (?,?,?,?,?,?,?)",
            (
                str(LIVE_SESSION),
                "session_end",
                "confirmed",
                "hook",
                "claude",
                LIVE_SESSION,
                str(live),
            ),
        )
        conn.commit()
    return {"claude": claude, "codex": codex, "coordinator": coordinator}


#: The user's own session whose transcript a probe's servers must never read.
LIVE_SESSION = "0c0ffee0-0000-4000-8000-00000000live"


class RunCase(unittest.TestCase):
    """A user, a home and an output directory, and one run over them."""

    directory: ClassVar[tempfile.TemporaryDirectory]
    user: ClassVar[Path]
    home: ClassVar[Path]
    out: ClassVar[Path]
    paths: ClassVar[dict[str, Path]]
    before: ClassVar[dict[str, str]]
    said: ClassVar[str]
    code: ClassVar[int]

    @classmethod
    def run_probes(cls, *arguments: str) -> None:
        cls.directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.addClassCleanup(cls.directory.cleanup)
        base = Path(cls.directory.name)
        cls.user, cls.home, cls.out = base / "user", base / "home", base / "out"
        cls.paths = make_user(cls.user)
        cls.home.mkdir()
        (cls.home / ".claude").mkdir()
        (cls.home / ".claude" / ".credentials.json").write_text('{"login": 1}', "utf-8")
        (cls.home / "leftover.txt").write_text("from an earlier run", encoding="utf-8")
        kept_read_only = cls.home / ".codex" / "plugins" / "objects" / "pack"
        kept_read_only.parent.mkdir(parents=True)
        kept_read_only.write_bytes(b"written read-only, as Git writes its objects")
        kept_read_only.chmod(stat.S_IREAD)
        cls.before = tree_digest(cls.user)
        cls.code, cls.said = cls.main(
            "--client-home", str(cls.home), "--out", str(cls.out), *arguments
        )

    @classmethod
    def environment(cls) -> dict[str, str]:
        """What the runner starts from besides the user's locations."""

        return {}

    @classmethod
    def main(cls, *arguments: str) -> tuple[int, str]:
        user = cls.user
        patched = {
            "USERPROFILE": str(user),
            "HOME": str(user),
            "LOCALAPPDATA": str(user / "AppData" / "Local"),
            "APPDATA": str(user / "AppData" / "Roaming"),
            **cls.environment(),
        }
        argv = [
            "run",
            "--cases",
            str(SAMPLES / "cases"),
            "--sections",
            str(SAMPLES / "sections.md"),
            "--claude-md",
            str(cls.paths["claude"] / "CLAUDE.md"),
            "--claude-coordinator",
            str(cls.paths["coordinator"]),
            "--codex-agents",
            str(cls.paths["codex"] / "AGENTS.md"),
            "--client-program",
            f"claude={FAKE}",
            "--client-program",
            f"codex={FAKE}",
            *arguments,
        ]
        output = io.StringIO()
        with (
            mock.patch.dict(os.environ, patched),
            # The home Codex takes `.agents/skills` from whatever the profile sets.
            mock.patch.object(agent_probes, "codex_user_home", lambda: user),
            contextlib.redirect_stdout(output),
        ):
            for name in ("VALKAMA_DB", "CLAUDE_CONFIG_DIR", "CODEX_HOME"):
                os.environ.pop(name, None)
            code = agent_probes.main(argv)
        return code, output.getvalue()

    def record(self, scenario: str, client: str) -> agent_probes_judge.Record:
        return agent_probes_judge.Record.read(self.out / scenario / client)

    def start_verdict(self, scenario: str, client: str) -> dict[str, Any]:
        loaded = agent_probes.load_scenario(SAMPLES / "cases" / f"{scenario}.json")
        judged = agent_probes_judge.judge_session(
            self.record(scenario, client),
            loaded,
            self.out / agent_probes_judge.WORK / scenario / client,
            self.out / agent_probes_judge.REVIEW / scenario / client,
        )
        return next(probe for probe in judged["probes"] if probe["probe"] == "start")


class RunTests(RunCase):
    """Both sample scenarios on both clients, with the user's own store copied by default."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.run_probes("--client", "both", "--store-copy")

    def test_the_run_ends_without_an_environment_failure(self) -> None:
        self.assertEqual(0, self.code, self.said)
        run = json.loads((self.out / "run.json").read_text(encoding="utf-8"))
        self.assertEqual(
            {("A1", "claude"), ("A1", "codex"), ("B1", "claude"), ("B1", "codex")},
            {(item["scenario"], item["client"]) for item in run["sessions"]},
        )
        self.assertEqual("migrated", run["store"]["migration"])
        self.assertEqual({"claude": "fake-client 1", "codex": "fake-client 1"}, run["versions"])

    def test_each_turn_runs_and_the_second_resumes_the_session_of_the_first(self) -> None:
        for client in agent_probes.CLIENTS:
            with self.subTest(client=client):
                session = self.record("alpha", client).session
                self.assertEqual([], session["failures"])
                self.assertEqual([1, 2], [turn["index"] for turn in session["turns"]])
                self.assertEqual([0, 0], [turn["exit"] for turn in session["turns"]])
                second = (self.out / "alpha" / client / "turn-2.jsonl").read_text("utf-8")
                self.assertIn(session["session_id"], second)
                self.assertIn(f"Commented on {session['bindings']['n']}", second)

    def test_the_setup_and_the_other_session_write_through_confirmed_sessions(self) -> None:
        record = self.record("alpha", "claude")
        roles = record.session["roles"]
        with contextlib.closing(record.store()) as conn:
            rows = conn.execute(
                "SELECT tool, identity_state, session_id FROM execution_events"
                " WHERE tool IS NOT NULL ORDER BY id"
            ).fetchall()
        sessions = {row[2]: row[1] for row in rows}
        self.assertEqual("confirmed", sessions[roles["setup"]])
        self.assertEqual("confirmed", sessions[roles["other"]])
        self.assertEqual("confirmed", sessions[record.session["session_id"]])

    def test_the_start_probe_passes_on_the_hooks_of_this_checkout(self) -> None:
        for scenario in ("alpha", "beta"):
            for client in agent_probes.CLIENTS:
                with self.subTest(scenario=scenario, client=client):
                    verdict = self.start_verdict(scenario, client)
                    self.assertEqual("passed", verdict["verdict"], verdict)

    def test_the_failing_registration_answers_no_handshake(self) -> None:
        handshake = json.loads((self.out / "beta" / "claude" / "handshake.json").read_text())
        self.assertIn("error", handshake)
        answer = (self.out / "beta" / "codex" / "turn-1.jsonl").read_text("utf-8")
        self.assertIn("Valkama is unavailable", answer)

    def test_the_workspace_takes_the_overlay_and_each_repository_one_commit(self) -> None:
        workspace = self.out / "alpha" / "claude" / "workspace"
        self.assertIn("printed on start", (workspace / "app" / "README.md").read_text("utf-8"))
        for repo in ("app", "lib"):
            self.assertTrue((workspace / repo / ".git").is_dir(), repo)
        self.assertFalse((workspace / ".git").exists())
        self.assertTrue((self.out / "beta" / "claude" / "workspace" / ".git").is_dir())

    def test_the_instructions_carry_the_new_sections_and_keep_the_rest(self) -> None:
        claude_md = (self.home / ".claude" / "CLAUDE.md").read_text(encoding="utf-8")
        self.assertIn("Replaced planning text", claude_md)
        self.assertNotIn("Old planning text", claude_md)
        self.assertIn("## Reading\n\nRead the range you need.\n\n## Planning", claude_md)
        self.assertTrue(claude_md.endswith("## Responses\n\nBe brief.\n"))
        agents = (self.home / ".codex" / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("Replaced planning text", agents)
        self.assertIn("Replaced coordination text", agents)
        self.assertNotIn("Old", agents)
        coordinator = self.home / ".claude" / "coordinator"
        self.assertIn("Replaced coordination", (coordinator / "coordination.md").read_text())
        self.assertEqual(
            (self.paths["coordinator"] / "questions.md").read_bytes(),
            (coordinator / "questions.md").read_bytes(),
        )

    def test_the_hooks_run_this_checkout_and_leave_other_services_out(self) -> None:
        settings = json.loads((self.home / ".claude" / "settings.json").read_text("utf-8"))
        hooks = settings["hooks"]
        found = {
            event: [hook for group in groups for hook in group["hooks"]]
            for event, groups in hooks.items()
        }
        entry = str(agent_probes.ENTRY)
        self.assertEqual(
            [
                [sys.executable, entry, "hook", "claude", "session-start"],
                [
                    sys.executable,
                    "-I",
                    "-S",
                    "-c",
                    PRINT_FILE,
                    str(self.home / ".claude" / "coordinator" / "coordination.md"),
                ],
            ],
            [[hook["command"], *hook["args"]] for hook in found["SessionStart"]],
        )
        self.assertEqual(
            {"PostToolUse", "PostToolUseFailure"},
            {event for event in found if event.startswith("PostToolUse")},
        )
        self.assertEqual(["*"], [group["matcher"] for group in hooks["PostToolUse"]])
        self.assertEqual("Bash|PowerShell", hooks["PostToolUseFailure"][0]["matcher"])
        self.assertEqual(
            ["hook", "claude", "post-tool-use-failure"], found["PostToolUseFailure"][0]["args"][1:]
        )
        port = self.record("beta", "codex").session["port"]
        self.assertEqual(
            [f"http://127.0.0.1:{port}/api/hooks/message-display"],
            [hook["url"] for hook in found["MessageDisplay"]],
        )
        self.assertNotIn("statusLine", settings)
        self.assertEqual({"KEPT": "1"}, settings["env"])
        self.assertEqual("a-model", settings["model"])
        codex = json.loads((self.home / ".codex" / "hooks.json").read_text("utf-8"))["hooks"]
        self.assertEqual(
            [["hook", "codex", "session-start"], ["hook", "codex", "post-tool-use"]],
            [
                hook["command"].split()[-3:]
                for group in codex["SessionStart"] + codex["PostToolUse"]
                for hook in group["hooks"]
            ],
        )
        self.assertEqual("Bash", codex["PostToolUse"][0]["matcher"])
        self.assertIn(entry, codex["SessionStart"][0]["hooks"][0]["commandWindows"])

    def test_the_mcp_registration_launcher_skill_plugins_and_git(self) -> None:
        claude = json.loads((self.home / ".claude" / ".claude.json").read_text("utf-8"))
        self.assertEqual(["mcp_servers", "model", "skills", "windows"], sorted(self.codex_config()))
        servers = {"claude": claude["mcpServers"], "codex": self.codex_config()["mcp_servers"]}
        for client, registered in servers.items():
            with self.subTest(client=client):
                # The last session written is the one whose registration fails.
                self.assertEqual(["valkama"], list(registered))
                self.assertEqual(sys.executable, registered["valkama"]["command"])
                self.assertEqual("-c", registered["valkama"]["args"][0])
        for client in agent_probes.CLIENTS:
            record = self.record("alpha", client)
            registration = agent_probes.mcp_registration(
                mock.Mock(python=sys.executable, environment={"VALKAMA_X": "1"}),
                "tip",
                Path(record.session["environment"]["VALKAMA_DB"]),
                client,
            )
            self.assertEqual([str(agent_probes.ENTRY), "mcp"], registration["args"])
            self.assertEqual(
                record.session["environment"]["VALKAMA_DB"], registration["env"]["VALKAMA_DB"]
            )
            handshake = json.loads((record.directory / "handshake.json").read_text("utf-8"))
            self.assertEqual("valkama", handshake["answer"]["serverInfo"]["name"])
        path = self.record("alpha", "claude").session["environment"]["PATH"]
        launcher = self.home / "AppData" / "Local" / "Valkama" / "bin"
        self.assertEqual(str(launcher), path.split(os.pathsep)[0])
        self.assertIn(str(agent_probes.ENTRY), (launcher / "valkama.cmd").read_text("utf-8"))
        head_skill = (ROOT / "server" / "skill" / "valkama" / "SKILL.md").read_bytes()
        for skills in (
            self.home / ".claude" / "skills",
            self.home / ".agents" / "skills",
            self.home / ".codex" / "skills",
        ):
            with self.subTest(skills=skills):
                self.assertEqual(head_skill, (skills / "valkama" / "SKILL.md").read_bytes())
                self.assertEqual("help\n", (skills / "helper" / "SKILL.md").read_text("utf-8"))
        installed = json.loads(
            (self.home / ".claude" / "plugins" / "installed_plugins.json").read_text("utf-8")
        )
        self.assertEqual(
            str(self.home / ".claude" / "plugins" / "cache" / "tool"),
            installed["tool"]["installPath"],
        )
        git = (self.home / ".gitconfig").read_text(encoding="utf-8")
        self.assertIn("event = post-commit", git)
        self.assertIn("git-hook run post-merge", git)
        self.assertEqual(
            str(self.home / ".gitconfig"),
            self.record("alpha", "codex").session["environment"]["GIT_CONFIG_GLOBAL"],
        )

    def test_codex_reads_the_profiles_skills_and_none_of_the_users(self) -> None:
        # Codex 0.166 reads `$CODEX_HOME/skills`, and `.agents/skills` under the home
        # Windows names whatever HOME says: there it found the user's installed skill.
        users = self.user / ".agents" / "skills"
        self.assertEqual(
            [
                {"path": str(users / "helper" / "SKILL.md"), "enabled": False},
                {"path": str(users / "valkama" / "SKILL.md"), "enabled": False},
            ],
            self.codex_config()["skills"]["config"],
        )
        self.assertEqual(
            (ROOT / "server" / "skill" / "valkama" / "SKILL.md").read_bytes(),
            (self.home / ".codex" / "skills" / "valkama" / "SKILL.md").read_bytes(),
        )

    def codex_config(self) -> dict[str, Any]:
        return tomllib.loads((self.home / ".codex" / "config.toml").read_text(encoding="utf-8"))

    def test_the_store_copy_is_migrated_and_holds_the_scenarios_space(self) -> None:
        record = self.record("alpha", "codex")
        with contextlib.closing(record.store()) as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            keys = {row[0] for row in conn.execute("SELECT key FROM planning_spaces")}
        self.assertEqual(store.STORE_SCHEMA_VERSION, version)
        self.assertLessEqual({"ALPHA", *work_model.SPACE_PROJECTS}, keys)
        self.assertRegex(record.session["bindings"]["n"], r"^ALPHA-\d+$")

    def test_only_the_logins_survive_from_an_earlier_run(self) -> None:
        self.assertEqual(
            '{"login": 1}', (self.home / ".claude" / ".credentials.json").read_text("utf-8")
        )
        self.assertFalse((self.home / "leftover.txt").exists())
        self.assertFalse((self.home / ".codex" / "plugins" / "objects").exists())

    def test_the_users_files_registrations_and_store_are_unchanged(self) -> None:
        self.assertEqual(self.before, tree_digest(self.user))
        self.assertEqual([0], list(set(new_sidecars(self.user, self.before).values()) or {0}))

    def test_no_server_of_the_run_archives_a_transcript_of_the_users(self) -> None:
        # The copy owes the user's session a copy of a transcript in the user's own
        # client directory; every server of the run is kept to the profile's.
        roots = os.pathsep.join([str(self.home / ".claude"), str(self.home / ".codex")])
        self.assertEqual(
            {"transcript_roots": roots},
            json.loads((self.home / ".valkama" / "config.json").read_text("utf-8")),
        )
        for scenario in ("alpha", "beta"):
            for client in agent_probes.CLIENTS:
                with self.subTest(scenario=scenario, client=client):
                    record = self.record(scenario, client)
                    self.assertEqual([], record.session["foreign_transcripts"])
                    with contextlib.closing(record.store()) as conn:
                        rows = conn.execute(
                            "SELECT kind FROM execution_events WHERE session_id = ?",
                            (LIVE_SESSION,),
                        ).fetchall()
                    self.assertEqual([("session_end",)], rows)


class OldReleaseHookTests(RunCase):
    """The start probe on the hooks an installed release for the older schema registers."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.run_probes("--client", "claude", "--store-copy", "--only", "A1")

    @classmethod
    def environment(cls) -> dict[str, str]:
        # The fake client runs the Valkama hooks the user's own registration names.
        return {"PROBE_FAKE_VALKAMA_HOOKS": str(cls.paths["claude"] / "settings.json")}

    def test_the_session_start_lands_in_the_spool_and_the_probe_fails_on_it(self) -> None:
        self.assertEqual(0, self.code, self.said)
        verdict = self.start_verdict("alpha", "claude")

        self.assertEqual("failed", verdict["verdict"])
        self.assertEqual(
            ["session"],
            [check["check"] for check in verdict["checks"] if check["result"] != "passed"],
        )
        # The release spooled each turn's start, and the MCP server the client then
        # started drained it into the copy.
        record = self.record("alpha", "claude")
        with contextlib.closing(record.store()) as conn:
            deliveries = conn.execute(
                "SELECT delivery FROM execution_events WHERE kind = 'session_start'"
                " AND session_id = ?",
                (record.session["session_id"],),
            ).fetchall()
        self.assertEqual([("spooled",), ("spooled",)], deliveries)

    def test_the_users_files_registrations_and_store_are_unchanged(self) -> None:
        self.assertEqual(self.before, tree_digest(self.user))
        self.assertEqual([0], list(set(new_sidecars(self.user, self.before).values()) or {0}))


class ScenarioFormatTests(unittest.TestCase):
    """A scenario is refused for what the runner would otherwise pass over in silence."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.cases = Path(directory.name) / "cases"
        shutil.copytree(SAMPLES / "cases", self.cases)
        self.alpha = json.loads((self.cases / "alpha.json").read_text(encoding="utf-8"))

    def write(self, scenario: dict[str, Any]) -> Path:
        path = self.cases / "alpha.json"
        path.write_text(json.dumps(scenario), encoding="utf-8")
        return path

    def test_the_setup_keys_are_read(self) -> None:
        loaded = agent_probes.load_scenario(self.write(self.alpha))

        self.assertEqual((self.cases.parent / "overlay").resolve(), loaded.overlay)
        self.assertEqual(("app", "lib"), loaded.repos)
        self.assertEqual(
            {"space": "ALPHA", "projects": ["app", "lib"], "default": "app"}, loaded.registry
        )
        self.assertEqual("tip", loaded.mcp)
        beta = agent_probes.load_scenario(self.cases / "beta.json")
        self.assertEqual((None, None, "failing"), (beta.overlay, beta.registry, beta.mcp))

    def test_an_unknown_key_is_refused(self) -> None:
        cases = (
            ({**self.alpha, "fixtures": []}, "unknown key(s) fixtures"),
            (
                {**self.alpha, "registry": {**self.alpha["registry"], "scope": "x"}},
                "registry has unknown key(s) scope",
            ),
            ({**self.alpha, "mcp": "remote"}, "mcp is 'remote'"),
            (
                {**self.alpha, "setup": [{**self.alpha["setup"][0], "session": "third"}]},
                "unknown session 'third'",
            ),
        )
        for scenario, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(agent_probes.ProbeError, re.escape(message)):
                    agent_probes.load_scenario(self.write(scenario))

    def test_an_unknown_kind_of_check_is_refused_also_inside_any(self) -> None:
        bad = {"check": "looks_fine"}
        for checks in ([bad], [{"check": "any", "of": [{"check": "file", "path": "x"}, bad]}]):
            with self.subTest(checks=checks):
                scenario = {**self.alpha, "expect": {"start": checks}}
                with self.assertRaisesRegex(agent_probes.ProbeError, "'looks_fine'"):
                    agent_probes.load_scenario(self.write(scenario))

    def test_a_run_is_refused_before_it_builds_anything(self) -> None:
        self.write({**self.alpha, "fixtures": []})
        home = self.cases.parent / "home"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = agent_probes.main(
                [
                    "run",
                    "--cases",
                    str(self.cases),
                    "--sections",
                    "s",
                    "--claude-md",
                    "c",
                    "--claude-coordinator",
                    "d",
                    "--codex-agents",
                    "a",
                    "--client",
                    "both",
                    "--client-home",
                    str(home),
                    "--out",
                    str(self.cases.parent / "out"),
                ]
            )
        self.assertEqual(2, code)
        self.assertIn("unknown key(s) fixtures", output.getvalue())
        self.assertFalse(home.exists())

    def test_only_picks_scenarios_by_their_id_or_a_probe_they_hold(self) -> None:
        self.assertEqual(["A1"], [item.id for item in agent_probes.load_cases(self.cases, ["A1"])])
        self.assertEqual(
            ["A1"], [item.id for item in agent_probes.load_cases(self.cases, ["seeded"])]
        )
        with self.assertRaisesRegex(agent_probes.ProbeError, "no scenario"):
            agent_probes.load_cases(self.cases, ["Z9"])


class HomeLockTests(unittest.TestCase):
    """A run waits for another run on the same home instead of clearing it under that run.

    Each run clears the home before it builds its profile, so a second run started
    beside the first took the profile from under the first one's clients.
    """

    def test_a_second_run_waits_for_the_first_and_leaves_its_home_alone(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as name:
            base = Path(name)
            home = base / "home"
            marker = home / agent_probes.WORK_DIR / "profile.txt"
            marker.parent.mkdir(parents=True)
            marker.write_text("the first run's profile", encoding="utf-8")
            options = argparse.Namespace(
                client="claude",
                cases=SAMPLES / "cases",
                only=["A1"],
                sections=SAMPLES / "sections.md",
                claude_md=base / "CLAUDE.md",
                codex_agents=base / "AGENTS.md",
                claude_coordinator=base / "coordinator",
                client_home=home,
                out=base / "second",
                client_program=None,
            )
            said: list[str] = []
            built: list[tuple[Path, bool]] = []

            def build(target: Path, _inputs: object) -> agent_probes.Profile:
                built.append((target, marker.is_file()))
                raise agent_probes.ProbeError("stopped after the profile would be built")

            def second() -> None:
                with contextlib.suppress(agent_probes.ProbeError):
                    agent_probes.run(options, None)

            waiter = threading.Thread(target=second, daemon=True, name="second-probe-run")
            with (
                mock.patch.object(agent_probes, "_say", said.append),
                mock.patch.object(agent_probes, "build_profile", build),
            ):
                with machine_lock.held(
                    "the first probe run",
                    path=agent_probes.home_lock(home),
                    say=lambda _line: None,
                ):
                    waiter.start()
                    deadline = time.monotonic() + 15.0
                    while not said and time.monotonic() < deadline:
                        time.sleep(0.05)
                    time.sleep(0.3)
                    self.assertEqual([], built)
                    self.assertTrue(marker.is_file())
                waiter.join(15.0)

            self.assertRegex(
                said[0],
                r"^waiting for the probe-home lock .*home\.lock: it is held by the first probe run"
                r" in .*, process \d+, since ",
            )
            self.assertEqual([(home.resolve(), True)], built)


class ProgramTests(unittest.TestCase):
    def test_a_client_program_named_relative_to_the_caller_runs_from_any_workspace(self) -> None:
        relative = os.path.relpath(FAKE, Path.cwd())

        programs = agent_probes._programs(["claude"], [f"claude={relative}"], "")

        self.assertEqual([sys.executable, str(FAKE)], programs["claude"])
        with self.assertRaisesRegex(agent_probes.ProbeError, "CLIENT=PATH"):
            agent_probes._programs(["claude"], ["claude"], "")


class HeadlessHookTests(unittest.TestCase):
    """A probe session runs without the hook that waits to wake an idle session.

    Claude Code under `-p` waited for the `asyncRewake` watcher on `UserPromptSubmit`
    before the turn started, and the first turn of a real probe stood until its limit.
    """

    def test_the_watcher_is_left_out_and_counted_and_the_prompt_hook_stays(self) -> None:
        def valkama(event: str, **extra: object) -> dict[str, Any]:
            words = ["-I", "-S", "valkama-launcher.py", "hook", "claude", event]
            return {"type": "command", "command": "python", "args": words, **extra}

        live = {
            "hooks": {
                "UserPromptSubmit": [
                    {"matcher": "*", "hooks": [valkama("user-prompt-submit", timeout=5)]},
                    {"matcher": "*", "hooks": [valkama("watch", asyncRewake=True)]},
                ],
                "Stop": [{"matcher": "*", "hooks": [valkama("watch", asyncRewake=True)]}],
            }
        }

        plan = agent_probes.profile_hooks(
            "claude", live, python=sys.executable, coordinator=None, port=None
        )

        kept = [
            hook["args"][-1]
            for groups in plan.hooks.values()
            for group in groups
            for hook in group["hooks"]
            if "args" in hook
        ]
        self.assertIn("user-prompt-submit", kept)
        self.assertNotIn("watch", kept)
        self.assertEqual({"UserPromptSubmit": 1, "Stop": 1}, plan.dropped)


class SandboxRefusalTests(unittest.TestCase):
    """A Codex turn whose sandbox started no command is the environment's failure.

    The elevated sandbox asked an administrator to set itself up in every cleared
    profile; unwatched, every command failed and the agent worked on without a shell.
    """

    REFUSED = (
        "Failed to create unified exec process: orchestrator_helper_launch_canceled:"
        " ShellExecuteExW failed to launch setup helper: 1223"
    )

    def output(self, *items: dict[str, Any]) -> Path:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "turn-1.jsonl"
        lines = [json.dumps({"type": "thread.started", "thread_id": "T"}), "not json"]
        lines += [json.dumps({"type": "item.completed", "item": item}) for item in items]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def command(self, said: str, code: int) -> dict[str, Any]:
        return {
            "type": "command_execution",
            "command": "pwsh -Command Get-Content README.md",
            "aggregated_output": said,
            "exit_code": code,
            "status": "failed",
        }

    def test_a_command_the_sandbox_did_not_start_names_the_refusal(self) -> None:
        output = self.output(self.command("ok", 0), self.command(self.REFUSED, -1))

        self.assertEqual(self.REFUSED, agent_probes.sandbox_refusal("codex", output))

    def test_a_command_that_ran_and_failed_is_the_agents_own(self) -> None:
        output = self.output(
            self.command("Get-Content: Cannot find path 'README.md'", 1),
            {"type": "agent_message", "text": self.REFUSED},
        )

        self.assertIsNone(agent_probes.sandbox_refusal("codex", output))
        self.assertIsNone(agent_probes.sandbox_refusal("claude", output))

    def test_codex_turns_ask_for_the_sandbox_that_needs_no_setup(self) -> None:
        argv = agent_probes.client_argv("codex", ["codex"], "go", Path("W"), None)

        self.assertIn('windows.sandbox="mxc"', argv)


def _rows(path: Path) -> list[tuple[Any, ...]]:
    with contextlib.closing(sqlite3.connect(path)) as conn:
        return conn.execute("SELECT value FROM kept").fetchall()


class StoreCopyTests(unittest.TestCase):
    """The run's store and a session's kept store are copies of the store each names.

    `isolated.copy_store` takes the profile home a store goes in, not the file: given
    the file, it copied into a directory of that name, and the run served a path that
    held no store.
    """

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.source = self.base / "source.sqlite3"
        with contextlib.closing(sqlite3.connect(self.source)) as conn, conn:
            conn.execute("CREATE TABLE kept (value)")
            conn.execute("INSERT INTO kept VALUES ('copied')")

    def test_the_run_serves_a_copy_of_the_store_it_was_given(self) -> None:
        registry = self.base / "registry"
        registry.mkdir()
        with mock.patch.object(agent_probes, "_valkama", return_value='"status": "migrated"'):
            served, prepared = agent_probes.prepare_store(self.source, self.base / "work", registry)

        self.assertTrue(served.is_file(), served)
        self.assertEqual([("copied",)], _rows(served))
        self.assertEqual("migrated", prepared["migration"])

    def test_a_session_keeps_its_store_under_the_name_the_judge_reads(self) -> None:
        directory = self.base / "record"
        (self.base / "registry").mkdir()
        directory.mkdir()
        runner = mock.Mock(
            store_file=self.source,
            directory=directory,
            profile=mock.Mock(registry=self.base / "registry"),
        )

        agent_probes.SessionRunner._keep_store(runner)

        runner.record.fail.assert_not_called()
        self.assertEqual([("copied",)], _rows(directory / "store.sqlite3"))
        self.assertEqual(["registry", "store.sqlite3"], sorted(p.name for p in directory.iterdir()))


class StoreCopyRegistryTests(unittest.TestCase):
    """The registry a store copy migrates with is the caller's, not the suite's.

    Run as a script, the runner imports the `tests` package after `main` has started,
    and that import moves `LOCALAPPDATA` into the suite's directory. The copy then
    found no registry, skipped its upgrade, and the migration refused the owner's
    store with «Valkama project registry is absent».
    """

    def test_the_migration_takes_the_registry_main_found_before_the_package_moved_it(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as name:
            base = Path(name)
            caller, moved, work = base / "caller", base / "moved", base / "work"
            files = {"projects.json": b'{"projects": []}', "project-registry.toml": b"# list"}
            (caller / "Valkama").mkdir(parents=True)
            for file, content in files.items():
                (caller / "Valkama" / file).write_bytes(content)
            moved.mkdir()
            source = base / "source.sqlite3"
            with contextlib.closing(sqlite3.connect(source)) as conn:
                conn.execute("CREATE TABLE kept (value)")
            calls: list[tuple[str, ...]] = []
            prepared: dict[str, Any] = {}

            def valkama(_environment: object, *arguments: str, **_options: object) -> str:
                calls.append(arguments)
                return '"status": "migrated"'

            def run(_options: object, store: Path, registry: Path) -> int:
                # What importing the `tests` package does to a script's environment.
                os.environ["LOCALAPPDATA"] = str(moved)
                prepared.update(agent_probes.prepare_store(store, work, registry)[1])
                return 0

            argv = ["run", "--cases", "c", "--sections", "s", "--claude-md", "m"]
            argv += ["--claude-coordinator", "k", "--codex-agents", "a", "--client", "both"]
            argv += ["--client-home", "h", "--out", "o", "--store-copy", str(source)]
            with (
                mock.patch.dict(os.environ, {"LOCALAPPDATA": str(caller)}),
                mock.patch.object(agent_probes, "_valkama", valkama),
                mock.patch.object(agent_probes, "run", run),
            ):
                self.assertEqual(0, agent_probes.main(argv))

            copied = work / "migration" / "AppData" / "Local" / "Valkama"
            for file, content in files.items():
                self.assertEqual(content, (copied / file).read_bytes(), file)
            self.assertIn(("projects", "upgrade"), calls)
            self.assertEqual("migrated", prepared["migration"])


class CodexSkillConfigTests(unittest.TestCase):
    """The user's skills stay off, or the run is refused, whatever the user's own configuration."""

    REGISTRATION: ClassVar[dict[str, Any]] = {"command": "python", "args": [], "env": {}}

    def test_a_later_rule_of_the_users_cannot_turn_a_skill_back_on(self) -> None:
        hidden = Path("C:/user/.agents/skills/valkama/SKILL.md")
        live = f'[[skills.config]]\npath = "{hidden.as_posix()}"\nenabled = true\n'

        text = agent_probes.codex_config(live, self.REGISTRATION, [hidden])

        entries = tomllib.loads(text)["skills"]["config"]
        self.assertEqual({"path": str(hidden), "enabled": False}, entries[-1])

    def test_a_skills_table_that_cannot_take_the_rules_refuses_the_run(self) -> None:
        live = "skills = { config = [] }\n"

        with self.assertRaisesRegex(agent_probes.ProbeError, "does not take the profile's"):
            agent_probes.codex_config(live, self.REGISTRATION, [Path("C:/u/SKILL.md")])


class SectionTests(unittest.TestCase):
    def test_a_section_replaces_its_namesake_and_nothing_else(self) -> None:
        text = "# Top\n\n## One\n\nold\n```\n## Not a heading\n```\n\n## Two\n\nkept\n"
        replaced, used = agent_probes.replace_sections(text, {"One": "## One\n\nnew\n"})

        self.assertEqual({"One"}, used)
        self.assertEqual("# Top\n\n## One\n\nnew\n\n## Two\n\nkept\n", replaced)

    def test_front_matter_is_not_a_section(self) -> None:
        sections = agent_probes.read_sections(SAMPLES / "sections.md")

        self.assertEqual(["Planning", "Coordination"], list(sections))
        self.assertTrue(sections["Planning"].startswith("## Planning\n"))


if __name__ == "__main__":
    unittest.main()
