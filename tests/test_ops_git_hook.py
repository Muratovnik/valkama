"""`valkama git-hook install|status|uninstall`, and what `doctor`, `setup` and
`launcher install` make of the hook.

Every test writes only a global Git file of its own, which `GIT_CONFIG_GLOBAL` names,
beside foreign sections that must come through untouched. The launcher is a real
one, installed once into the class's own `LOCALAPPDATA` from a checkout of one
commit, so the command each hook runs is the one a release would write.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from server import cli, launcher, processes
from server.hooks import commit_records
from server.hooks import git_hook as hook
from server.ops import doctor, git_hook, setup

from .registry_fixtures import project_entry, registry_bytes
from .test_launcher import make_checkout

#: Sections that are not Valkama's: another program's hook, a hook directory, an identity.
FOREIGN = (
    b"[user]\n\tname = Tester\n\temail = tester@example.invalid\n"
    b"[core]\n\thooksPath = C:/elsewhere/hooks\n"
    b'[hook "other"]\n\tcommand = echo other\n\tevent = post-commit\n'
)
#: A launcher install that reads no process on the port: nothing here runs a listener.
NO_PORT = launcher.ListenerEffects(process_reader=lambda _port: [])
SESSION = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
HOUR_NS = 60 * 60 * 1_000_000_000


def _record(at: int, directory: Path) -> Path:
    """One commit record of `SESSION` in `directory`, written at `at` as the hook writes it."""

    record = {
        "format": commit_records.FORMAT,
        "version": commit_records.VERSION,
        "event": "post-commit",
        "rewrite": None,
        "root": "C:/work/alpha",
        "project_id": "alpha",
        "commits": [{"hash": "a" * 40, "parents": [], "subject": "feat: a", "committed_at": None}],
        "rewritten": [],
        "claude": {"session_id": SESSION},
        "codex": None,
        "occurred_at": commit_records.timestamp(at),
    }
    [written] = commit_records.write(
        commit_records.encode(record), [SESSION], [(str(directory), True)], at
    )
    return Path(written)


class GitHookCase(unittest.TestCase):
    """A launcher in the class's `LOCALAPPDATA`, and a global Git file per test."""

    @classmethod
    def setUpClass(cls) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-hook-", ignore_cleanup_errors=True)
        cls.addClassCleanup(directory.cleanup)
        cls.base = Path(directory.name).resolve()
        cls.local = cls.base / "local"
        cls.launcher_directory = cls.local / "Valkama" / "bin"
        cls.checkout = make_checkout(cls.base / "checkout")
        cls.releases = cls.base / "releases"
        with mock.patch.dict(os.environ, {"LOCALAPPDATA": str(cls.local)}):
            launcher.install(
                cls.launcher_directory,
                python=sys.executable,
                checkout=cls.checkout,
                releases=cls.releases,
                effects=NO_PORT,
            )

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="vk-hook-", ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.global_file = self.root / "gitconfig"
        self.global_file.write_bytes(FOREIGN)
        self.store = self.root / "store" / "valkama.sqlite3"
        environment = mock.patch.dict(
            os.environ,
            {
                "GIT_CONFIG_GLOBAL": str(self.global_file),
                "GIT_CONFIG_NOSYSTEM": "1",
                "LOCALAPPDATA": str(self.local),
                "VALKAMA_DB": str(self.store),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        registry = self.local / "Valkama" / "projects.json"
        self.addCleanup(lambda: registry.unlink(missing_ok=True))

    def git(self, *arguments: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
        )

    def write(self, key: str, value: str) -> None:
        """Set one entry as another build or a person would, around Valkama's code."""

        written = self.git("config", "--file", str(self.global_file), "--add", key, value)
        self.assertEqual(0, written.returncode, written.stderr)

    def values(self, key: str) -> list[str]:
        found = self.git("config", "--global", "--get-all", key)
        return found.stdout.decode("utf-8").splitlines()

    def expected(self) -> dict[str, str]:
        commands = git_hook.commands(str(self.launcher_directory))
        assert commands is not None
        return commands

    def previous(self, event: str) -> str:
        """The command a launcher installed elsewhere before wrote."""

        return hook.command(sys.executable, "D:/before/bin/valkama-launcher.py", event)

    def cli(self, *arguments: str) -> tuple[int, str, str]:
        output, errors = io.StringIO(), io.StringIO()
        code = 0
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            try:
                cli.main(list(arguments))
            except SystemExit as stopped:
                code = int(stopped.code or 0)
        return code, output.getvalue(), errors.getvalue()

    def states(self, **options) -> dict[str, str]:
        reading = git_hook.status(str(self.launcher_directory), **options)
        return {entry["name"]: entry["state"] for entry in reading["hooks"]}


class InstallTests(GitHookCase):
    def test_uninstall_leaves_the_global_file_as_it_was(self) -> None:
        """O10: install, status and uninstall through the command line; afterwards no
        entry of Valkama's is left and the file has the bytes it had before."""

        directory = str(self.launcher_directory)
        code, out, _ = self.cli("git-hook", "install", "--json", "--launcher-directory", directory)
        self.assertEqual(0, code)
        installed = json.loads(out)
        self.assertTrue(installed["changed"])
        self.assertEqual(str(self.global_file), installed["global_file"])
        self.assertEqual(
            {"valkama-commit", "valkama-rewrite", "valkama-merge"},
            {entry["name"] for entry in installed["hooks"]},
        )
        for event, name in hook.NAMES.items():
            listed = self.git("hook", "list", "--show-scope", event)
            self.assertEqual(0, listed.returncode, listed.stderr)
            self.assertIn(f"global\t{name}", listed.stdout.decode("utf-8").splitlines())

        code, out, _ = self.cli("git-hook", "status", "--json", "--launcher-directory", directory)
        self.assertEqual(0, code)
        self.assertEqual(["installed"] * 3, [entry["state"] for entry in json.loads(out)["hooks"]])

        code, out, _ = self.cli("git-hook", "uninstall", "--json")
        self.assertEqual(0, code)
        removed = json.loads(out)
        self.assertEqual(sorted(hook.NAMES.values()), sorted(removed["removed"]))
        left = self.git("config", "--global", "--get-regexp", r"^hook\.valkama-")
        self.assertEqual((1, b""), (left.returncode, left.stdout))
        self.assertEqual(FOREIGN, self.global_file.read_bytes())

    def test_install_takes_the_names_over_and_then_changes_nothing(self) -> None:
        self.write("hook.valkama-commit.command", "echo another build")
        self.write("hook.valkama-commit.event", "post-commit")
        self.write("hook.valkama-commit.event", "post-merge")

        first = git_hook.install(str(self.launcher_directory))
        self.assertTrue(first["changed"])
        self.assertEqual(
            [self.expected()["post-commit"]], self.values("hook.valkama-commit.command")
        )
        self.assertEqual(["post-commit"], self.values("hook.valkama-commit.event"))
        after = self.global_file.read_bytes()

        second = git_hook.install(str(self.launcher_directory))
        self.assertFalse(second["changed"])
        self.assertEqual(after, self.global_file.read_bytes())
        self.assertEqual(["echo other"], self.values("hook.other.command"))

    def test_install_refuses_without_a_launcher(self) -> None:
        nowhere = str(self.root / "no-launcher")
        with self.assertRaises(git_hook.GitHookError) as refused:
            git_hook.install(nowhere)
        self.assertEqual(git_hook.INSTALL_FIRST, str(refused.exception))
        code, _, errors = self.cli("git-hook", "install", "--launcher-directory", nowhere)
        self.assertEqual(2, code)
        self.assertIn("install the launcher first: valkama launcher install", errors)
        self.assertEqual(FOREIGN, self.global_file.read_bytes())

    def test_uninstall_without_hooks_changes_nothing(self) -> None:
        self.write("hook.valkama-elsewhere.command", "echo not one of the three")
        removed = git_hook.uninstall()
        self.assertEqual(([], False), (removed["removed"], removed["changed"]))
        self.assertEqual(
            ["echo not one of the three"], self.values("hook.valkama-elsewhere.command")
        )

    def test_the_command_runs_the_shim_on_the_base_interpreter(self) -> None:
        python = git_hook.base_interpreter(sys.executable)
        if sys.prefix != sys.base_prefix:
            # Python's own answer for the interpreter a virtualenv was made from.
            base = getattr(sys, "_base_executable", sys.executable)
            self.assertEqual(os.path.normcase(base), os.path.normcase(python))
        else:
            self.assertEqual(sys.executable, python)
        shim = (self.launcher_directory / launcher.SHIM_NAME).as_posix()
        for event, command in self.expected().items():
            with self.subTest(event=event):
                self.assertTrue(command.startswith(hook.GUARD + "; exec "))
                self.assertIn(shim, command)
                self.assertIn(Path(python).as_posix(), command)
                self.assertTrue(command.endswith(f" -I -S {shim} git-hook run {event}"))


class StatusTests(GitHookCase):
    def test_nothing_installed_is_missing(self) -> None:
        self.assertEqual(dict.fromkeys(hook.NAMES.values(), "missing"), self.states())

    def test_installed(self) -> None:
        git_hook.install(str(self.launcher_directory))
        self.assertEqual(dict.fromkeys(hook.NAMES.values(), "installed"), self.states())

    def test_a_previous_launcher_s_command_or_another_event_is_stale(self) -> None:
        git_hook.install(str(self.launcher_directory))
        self.git("config", "--global", "hook.valkama-commit.command", self.previous("post-commit"))
        self.write("hook.valkama-merge.event", "post-checkout")
        states = self.states()
        self.assertEqual("stale", states["valkama-commit"])
        self.assertEqual("stale", states["valkama-merge"])
        self.assertEqual("installed", states["valkama-rewrite"])

    def test_with_no_launcher_a_hook_that_is_there_is_stale(self) -> None:
        git_hook.install(str(self.launcher_directory))
        reading = git_hook.status(str(self.root / "no-launcher"))
        self.assertEqual(["stale"] * 3, [entry["state"] for entry in reading["hooks"]])

    def test_disabled_in_the_global_file(self) -> None:
        git_hook.install(str(self.launcher_directory))
        self.git("config", "--global", "hook.valkama-merge.enabled", "false")
        states = self.states()
        self.assertEqual("disabled", states["valkama-merge"])
        self.assertEqual("installed", states["valkama-commit"])

    def test_a_git_that_does_not_list_it_is_unsupported(self) -> None:
        """What a Git from before hooks in its configuration answers `git hook list` with."""

        git_hook.install(str(self.launcher_directory))

        def older_git(argv: list[str]) -> processes.TextResult:
            if argv[3:5] == ["hook", "list"]:
                return processes.TextResult(129, "", "usage: git hook run [<args>] <hook-name>")
            return processes.run_text(argv, errors="replace")

        self.assertEqual(
            dict.fromkeys(hook.NAMES.values(), "unsupported"), self.states(run=older_git)
        )

    def test_overall_reads_the_first_state_one_of_them_has(self) -> None:
        def hooks(*states: str) -> list[dict]:
            return [{"name": str(n), "event": "", "state": s} for n, s in enumerate(states)]

        self.assertEqual("installed", git_hook.overall(hooks("installed", "installed")))
        self.assertEqual("missing", git_hook.overall(hooks("installed", "stale", "missing")))
        self.assertEqual("stale", git_hook.overall(hooks("disabled", "stale")))
        self.assertEqual("unsupported", git_hook.overall(hooks("installed", "unsupported")))

    def test_records_and_the_directories_they_wait_in(self) -> None:
        """`records` counts every record waiting and names the oldest; `record_directories`
        names the places that exist: beside the store, and in the Git directory of each
        registered project with a `.git` of its own."""

        reading = git_hook.status(str(self.launcher_directory))
        self.assertEqual({"count": 0, "oldest": None}, reading["records"])
        self.assertEqual([], reading["record_directories"])

        alpha, beta, linked = self.root / "alpha", self.root / "beta", self.root / "linked"
        for root in (alpha, beta):
            (root / ".git").mkdir(parents=True)
        linked.mkdir()
        (linked / ".git").write_text("gitdir: elsewhere\n", encoding="utf-8")
        (self.local / "Valkama").mkdir(parents=True, exist_ok=True)
        (self.local / "Valkama" / "projects.json").write_bytes(
            registry_bytes(
                [
                    project_entry("alpha", alpha),
                    project_entry("beta", beta),
                    project_entry("linked", linked),
                ]
            )
        )
        now = time.time_ns()
        beside = self.store.parent / "commits"
        in_alpha = alpha / ".git" / "valkama" / "commits"
        _record(now - 3 * HOUR_NS, beside)
        _record(now - HOUR_NS, beside)
        _record(now, in_alpha)

        reading = git_hook.status(str(self.launcher_directory))
        self.assertEqual(
            {"count": 3, "oldest": commit_records.timestamp(now - 3 * HOUR_NS)},
            reading["records"],
        )
        self.assertEqual(
            [os.path.normcase(str(beside)), os.path.normcase(str(in_alpha))],
            [os.path.normcase(path) for path in reading["record_directories"]],
        )

    def test_the_command_line_says_it_for_a_person(self) -> None:
        git_hook.install(str(self.launcher_directory))
        code, out, _ = self.cli(
            "git-hook", "status", "--launcher-directory", str(self.launcher_directory)
        )
        self.assertEqual(0, code)
        self.assertIn(f"global Git file: {self.global_file}", out)
        self.assertIn("valkama-rewrite", out)
        self.assertIn("commit records waiting: 0", out)


class DoctorTests(GitHookCase):
    def doctor(self) -> dict[str, dict]:
        code, out, _ = self.cli("doctor", "--json", "--no-probe")
        report = json.loads(out)
        self.assertIn(code, (0, 1))
        [installation] = [level for level in report["levels"] if level["id"] == "installation"]
        return {check["id"]: check for check in installation["checks"]}

    def test_doctor_reports_the_commit_hook(self) -> None:
        """O18: without the hook, with the hook of a previous launcher, with the hook,
        and a record older than an hour."""

        checks = self.doctor()
        missing = checks["commit-hook"]
        self.assertEqual(("warn", "commit-hook-missing"), self.outcome(missing))
        self.assertIn("valkama git-hook install", missing["fix"])
        self.assertEqual(("ok", "commit-records-current"), self.outcome(checks["commit-records"]))

        for event, name in hook.NAMES.items():
            self.write(f"hook.{name}.command", self.previous(event))
            self.write(f"hook.{name}.event", event)
        stale = self.doctor()["commit-hook"]
        self.assertEqual(("warn", "commit-hook-stale"), self.outcome(stale))
        self.assertIn("valkama git-hook install", stale["fix"])

        git_hook.install()
        installed = self.doctor()["commit-hook"]
        self.assertEqual(("ok", "commit-hook-installed"), self.outcome(installed))
        self.assertEqual("", installed["fix"])

        at = time.time_ns() - 2 * HOUR_NS
        _record(at, self.store.parent / "commits")
        _record(time.time_ns(), self.store.parent / "commits")
        records = self.doctor()["commit-records"]
        self.assertEqual(("warn", "commit-records-waiting"), self.outcome(records))
        parameters = records["presentation"]["parameters"]
        self.assertEqual(
            (1, commit_records.timestamp(at)), (parameters["count"], parameters["oldest"])
        )

    def test_doctor_names_the_records_set_aside(self) -> None:
        rejected = self.store.parent / "commits" / commit_records.REJECTED
        rejected.mkdir(parents=True)
        (rejected / f"{SESSION}--1-{'b' * 16}.json").write_bytes(b"{not a record")
        records = doctor._commit_checks()[1]
        self.assertEqual(("warn", "commit-records-rejected"), self.outcome(records))
        self.assertIn(str(rejected), records["detail"])
        self.assertIn("commits/rejected/", records["fix"])

    def test_disabled_and_unsupported_say_what_to_do(self) -> None:
        git_hook.install()
        self.git("config", "--global", "hook.valkama-commit.enabled", "false")
        disabled = doctor._commit_checks()[0]
        self.assertEqual(("warn", "commit-hook-disabled"), self.outcome(disabled))
        self.assertIn("--unset hook.<name>.enabled", disabled["fix"])
        self.git("config", "--global", "--unset", "hook.valkama-commit.enabled")
        with mock.patch.object(git_hook, "_listed", return_value=None):
            unsupported = doctor._commit_checks()[0]
        self.assertEqual(("warn", "commit-hook-unsupported"), self.outcome(unsupported))

    @staticmethod
    def outcome(check: dict) -> tuple[str, str]:
        return check["status"], check["presentation"]["code"]


class SetupTests(GitHookCase):
    def finding(self) -> dict:
        def no_client(name: str) -> str:
            return "" if name in setup.CLIENT_ENVIRONMENTS else shutil.which(name) or ""

        with mock.patch.object(setup, "_tool", side_effect=no_client):
            reading = setup.inspect()
        [found] = [item for item in reading["findings"] if item["id"] == "git-hook"]
        self.assertEqual(found["commands"], [c for c in reading["commands"] if "git-hook" in c])
        return found

    def test_setup_offers_the_hook_and_applying_it_installs_it(self) -> None:
        offered = self.finding()
        install = [sys.executable, setup.entry_point_path(), "git-hook", "install"]
        self.assertEqual(("warn", [install]), (offered["status"], offered["commands"]))

        applied = setup.apply({"commands": offered["commands"]})
        self.assertEqual(1, applied["changed"], applied["applied"])
        self.assertEqual(dict.fromkeys(hook.NAMES.values(), "installed"), self.states())
        self.assertEqual(("ok", []), self.outcome(self.finding()))

    def test_a_stale_hook_is_offered_again_and_a_disabled_one_is_not(self) -> None:
        for event, name in hook.NAMES.items():
            self.write(f"hook.{name}.command", self.previous(event))
            self.write(f"hook.{name}.event", event)
        install = [sys.executable, setup.entry_point_path(), "git-hook", "install"]
        self.assertEqual(("warn", [install]), self.outcome(self.finding()))
        git_hook.install()
        self.git("config", "--global", "hook.valkama-merge.enabled", "false")
        disabled = self.finding()
        self.assertEqual(("warn", []), self.outcome(disabled))
        self.assertIn("valkama-merge", disabled["detail"])

    @staticmethod
    def outcome(finding: dict) -> tuple[str, list]:
        return finding["status"], finding["commands"]


class LauncherInstallTests(GitHookCase):
    def launcher_install(self) -> tuple[int, dict]:
        """`launcher install` through the command line, reading no process on the port."""

        real = launcher.install

        def install(*arguments, **options):
            return real(*arguments, effects=NO_PORT, **options)

        with mock.patch.object(cli.launcher, "install", side_effect=install):
            code, out, _ = self.cli(
                "launcher",
                "install",
                "--directory",
                str(self.launcher_directory),
                "--checkout",
                str(self.checkout),
                "--releases",
                str(self.releases),
            )
        return code, json.loads(out)

    def test_launcher_install_rewrites_the_command_of_a_hook_that_is_there(self) -> None:
        self.write("hook.valkama-commit.command", self.previous("post-commit"))
        self.write("hook.valkama-commit.event", "post-commit")
        self.write("hook.valkama-merge.command", self.previous("post-merge"))
        self.write("hook.valkama-merge.event", "post-merge")
        self.write("hook.valkama-merge.enabled", "false")

        code, answer = self.launcher_install()

        self.assertEqual(0, code)
        self.assertEqual("installed", answer["state"])
        self.assertNotIn("git_hook_error", answer)
        self.assertTrue(answer["git_hook"]["changed"])
        expected = self.expected()
        self.assertEqual([expected["post-commit"]], self.values("hook.valkama-commit.command"))
        self.assertEqual([expected["post-merge"]], self.values("hook.valkama-merge.command"))
        # What the owner set stays: the switch, and a hook that was not there.
        self.assertEqual(["false"], self.values("hook.valkama-merge.enabled"))
        self.assertEqual([], self.values("hook.valkama-rewrite.command"))

    def test_without_a_hook_launcher_install_writes_none(self) -> None:
        code, answer = self.launcher_install()
        self.assertEqual(0, code)
        self.assertEqual(
            {"hooks": [], "changed": False},
            {key: answer["git_hook"][key] for key in ("hooks", "changed")},
        )
        self.assertEqual(FOREIGN, self.global_file.read_bytes())

    def test_a_failed_rewrite_leaves_the_launcher_installed_and_says_so(self) -> None:
        self.write("hook.valkama-commit.command", self.previous("post-commit"))
        self.write("hook.valkama-commit.event", "post-commit")
        before = self.global_file.read_bytes()
        real = git_hook._run

        def locked(argv: list[str]) -> processes.TextResult:
            if "--replace-all" in argv:
                return processes.TextResult(255, "", "error: could not lock config file")
            return real(argv)

        with mock.patch.object(git_hook, "_run", side_effect=locked):
            code, answer = self.launcher_install()

        self.assertEqual(0, code)
        self.assertEqual("installed", answer["state"])
        self.assertNotIn("git_hook", answer)
        self.assertIn("could not lock config file", answer["git_hook_error"])
        self.assertEqual("installed", launcher.status(self.launcher_directory)["state"])
        self.assertEqual(before, self.global_file.read_bytes())


class LauncherUninstallTests(GitHookCase):
    def setUp(self) -> None:
        super().setUp()
        # Every test removes the launcher the class installed, so each one installs it again.
        if launcher.status(self.launcher_directory)["state"] != "installed":
            launcher.install(
                self.launcher_directory,
                python=sys.executable,
                checkout=self.checkout,
                releases=self.releases,
                effects=NO_PORT,
            )

    def own_launcher(self) -> Path:
        """A launcher of this test's own, which a test may spoil without touching the class's."""

        directory = self.root / "launcher"
        launcher.install(
            directory,
            python=sys.executable,
            checkout=self.checkout,
            releases=self.releases,
            effects=NO_PORT,
        )
        return directory

    def launcher_uninstall(self, *options: str, directory: Path | None = None) -> tuple[int, dict]:
        """`launcher uninstall` through the command line, reading no process on the port."""

        real = launcher.uninstall

        def uninstall(*arguments, **keywords):
            return real(*arguments, effects=NO_PORT, **keywords)

        with mock.patch.object(cli.launcher, "uninstall", side_effect=uninstall):
            code, out, _ = self.cli(
                "launcher",
                "uninstall",
                "--directory",
                str(directory or self.launcher_directory),
                *options,
            )
        return code, json.loads(out)

    def assert_refused_keeps_hooks(
        self, directory: Path, state: str, expected: dict[str, str]
    ) -> None:
        """Without `--force`, `launcher uninstall` of a launcher in `state` is refused and
        takes no hook out: the global file stays as it was and every hook keeps its command.
        `expected` is the installed commands, read while the launcher was still whole."""

        for event, name in hook.NAMES.items():
            self.assertEqual([expected[event]], self.values(f"hook.{name}.command"))
        before = self.global_file.read_bytes()

        code, _, errors = self.cli("launcher", "uninstall", "--directory", str(directory))

        self.assertEqual(2, code)
        self.assertIn(f"refusing to remove {state} launcher", errors)
        self.assertEqual(before, self.global_file.read_bytes())
        for event, name in hook.NAMES.items():
            self.assertEqual([expected[event]], self.values(f"hook.{name}.command"))
        self.assertNotEqual("missing", launcher.status(directory)["state"])

    def test_launcher_uninstall_takes_the_hooks_out_and_then_the_launcher(self) -> None:
        git_hook.install(str(self.launcher_directory))

        code, answer = self.launcher_uninstall()

        self.assertEqual(0, code)
        self.assertEqual("missing", answer["state"])
        self.assertNotIn("git_hook_error", answer)
        self.assertTrue(answer["git_hook"]["changed"])
        self.assertEqual(sorted(hook.NAMES.values()), sorted(answer["git_hook"]["removed"]))
        for name in hook.NAMES.values():
            self.assertEqual([], self.values(f"hook.{name}.command"))
        self.assertEqual(FOREIGN, self.global_file.read_bytes())
        self.assertEqual("missing", launcher.status(self.launcher_directory)["state"])

    def test_a_failed_hook_removal_is_named_and_the_launcher_is_still_removed(self) -> None:
        git_hook.install(str(self.launcher_directory))
        expected = self.expected()  # read while the launcher is still there
        before = self.global_file.read_bytes()
        real = git_hook._run

        def refused(argv: list[str]) -> processes.TextResult:
            if "--remove-section" in argv:
                return processes.TextResult(255, "", "error: could not lock config file")
            return real(argv)

        with mock.patch.object(git_hook, "_run", side_effect=refused):
            code, answer = self.launcher_uninstall()

        self.assertEqual(0, code)
        self.assertEqual("missing", answer["state"])
        self.assertNotIn("git_hook", answer)
        self.assertIn("could not lock config file", answer["git_hook_error"])
        self.assertEqual("missing", launcher.status(self.launcher_directory)["state"])
        self.assertEqual(before, self.global_file.read_bytes())
        self.assertEqual([expected["post-commit"]], self.values("hook.valkama-commit.command"))

    def test_without_a_hook_launcher_uninstall_removes_none(self) -> None:
        code, answer = self.launcher_uninstall()

        self.assertEqual(0, code)
        self.assertEqual("missing", answer["state"])
        self.assertNotIn("git_hook_error", answer)
        self.assertEqual(
            {"removed": [], "changed": False},
            {key: answer["git_hook"][key] for key in ("removed", "changed")},
        )
        self.assertEqual(FOREIGN, self.global_file.read_bytes())

    def test_an_unmanaged_launcher_is_refused_and_keeps_its_hooks(self) -> None:
        directory = self.own_launcher()
        git_hook.install(str(directory))
        expected = git_hook.commands(str(directory))
        assert expected is not None
        (directory / launcher.MANIFEST_NAME).unlink()

        self.assert_refused_keeps_hooks(directory, "unmanaged", expected)

    def test_a_drifted_launcher_is_refused_and_keeps_its_hooks(self) -> None:
        directory = self.own_launcher()
        git_hook.install(str(directory))
        expected = git_hook.commands(str(directory))
        assert expected is not None
        with (directory / launcher.SHIM_NAME).open("ab") as shim:
            shim.write(b"# changed by hand\n")

        self.assert_refused_keeps_hooks(directory, "drifted", expected)

    def test_a_drifted_launcher_taken_out_with_force_takes_its_hooks_too(self) -> None:
        directory = self.own_launcher()
        git_hook.install(str(directory))
        with (directory / launcher.SHIM_NAME).open("ab") as shim:
            shim.write(b"# changed by hand\n")

        code, answer = self.launcher_uninstall("--force", directory=directory)

        self.assertEqual(0, code)
        self.assertEqual("missing", answer["state"])
        self.assertTrue(answer["git_hook"]["changed"])
        for name in hook.NAMES.values():
            self.assertEqual([], self.values(f"hook.{name}.command"))


if __name__ == "__main__":
    unittest.main()
