"""A place where commits are made as an agent's shell makes them, for the commit tests.

A space root W with a `.git` of its own, a repository R nested in it with its own,
R registered as `alpha` in a registry of format 4 that `LOCALAPPDATA` names, a fresh
store `VALKAMA_DB` names, and the Git hooks written into a global configuration file
of the place's own, which `GIT_CONFIG_GLOBAL` names: no test reads or writes the
global configuration of whoever runs it. The hooks run this checkout's `valkama.py`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.hooks import git_hook

from .registry_fixtures import project_entry, registry_bytes

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = str(ROOT / "valkama.py")
#: The variables a client puts in its shell's environment; a test runs inside one.
SESSION_VARIABLES = (
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CODEX_TOOL_CALL_ID",
)
PROJECT = "alpha"
CLAUDE = "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"
CODEX = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
CALL = "call_7Hq2vX"


def short_form(path: Path) -> str:
    """`path` in its 8.3 short form (`LONG-N~1` for `long-name`) where the volume keeps
    one, and as it is elsewhere; Git prints the long form of the same directory."""

    if os.name != "nt":
        return str(path)
    import ctypes
    from ctypes import wintypes

    shorten = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
    shorten.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.DWORD]
    shorten.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    size = shorten(str(path), buffer, len(buffer))
    return buffer.value if 0 < size < len(buffer) else str(path)


def _respelled(path: Path) -> str:
    """`path` as a registry may hold it: on Windows in its short form where the volume
    keeps one, and in other case than Git prints it."""

    return short_form(path).upper() if os.name == "nt" else str(path)


class CommitPlace:
    """W, R in it, the registry, a fresh store and a global Git file, under one directory."""

    def __init__(self, case: unittest.TestCase, *, python: str = sys.executable) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        case.addCleanup(directory.cleanup)
        self.base = Path(directory.name)
        self.space = self.base / "W"
        self.repository = self.space / "R"
        self.home = self.base / "home"
        self.local = self.base / "local"
        self.store = self.base / "store" / "valkama.sqlite3"
        self.global_file = self.base / "gitconfig"
        for folder in (self.repository, self.home, self.local / "Valkama", self.store.parent):
            folder.mkdir(parents=True)
        self.global_file.write_bytes(b"")
        self.environ = {
            name: value
            for name, value in os.environ.items()
            if name not in SESSION_VARIABLES and not name.startswith("GIT_")
        }
        self.environ.update(
            {
                "GIT_CONFIG_GLOBAL": str(self.global_file),
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_AUTHOR_NAME": "Tester",
                "GIT_AUTHOR_EMAIL": "tester@example.invalid",
                "GIT_COMMITTER_NAME": "Tester",
                "GIT_COMMITTER_EMAIL": "tester@example.invalid",
                "HOME": str(self.home),
                "USERPROFILE": str(self.home),
                "LOCALAPPDATA": str(self.local),
                "VALKAMA_DB": str(self.store),
            }
        )
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.store)}):
            store.connect().close()
        # Registered by another spelling than Git's: backslashes, the case changed and,
        # where the volume keeps them, the 8.3 short names.
        (self.local / "Valkama" / "projects.json").write_bytes(
            registry_bytes([project_entry(PROJECT, _respelled(self.repository))])
        )
        for folder in (self.space, self.repository):
            self.git(folder, "init", "-q", "-b", "main")
            (folder / "README.md").write_text(folder.name, encoding="utf-8")
            self.git(folder, "add", "README.md")
            self.git(folder, "commit", "-qm", "start")
        self.install(python)

    def install(self, python: str) -> None:
        """The three hooks, in the place's global file, as the release writes them."""

        for event, name in git_hook.NAMES.items():
            self.git(
                self.base,
                "config",
                "--file",
                str(self.global_file),
                f"hook.{name}.command",
                git_hook.command(python, SCRIPT, event),
            )
            self.git(
                self.base, "config", "--file", str(self.global_file), f"hook.{name}.event", event
            )

    def git(
        self, cwd: Path, *arguments: str, environ: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess:
        result = subprocess.run(
            ["git", *arguments],
            cwd=cwd,
            env=environ or self.environ,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise AssertionError(result.stderr.decode("utf-8", "replace"))
        return result

    def sessions(self, **variables: str) -> dict[str, str]:
        """The place's environment with these client variables, as a client's shell has it."""

        return {**self.environ, **variables}

    def commit(
        self, cwd: Path, name: str, *, environ: dict[str, str] | None = None, git_c: str = ""
    ) -> subprocess.CompletedProcess:
        """Change one file and commit it from `cwd`, into `git_c` when it names a repository."""

        target = cwd / git_c if git_c else cwd
        (target / f"{name}.txt").write_text(name, encoding="utf-8")
        prefix = ("-C", git_c) if git_c else ()
        self.git(cwd, *prefix, "add", f"{name}.txt", environ=environ)
        return self.git(cwd, *prefix, "commit", "-qm", f"feat: {name}", environ=environ)

    def head(self, repository: Path | None = None) -> str:
        found = self.git(repository or self.repository, "rev-parse", "HEAD")
        return found.stdout.decode("ascii").strip()

    def beside_the_store(self) -> list[Path]:
        folder = self.store.parent / "commits"
        return sorted(folder.glob("*.json")) if folder.is_dir() else []

    def in_the_git_directory(self, repository: Path | None = None) -> list[Path]:
        folder = (repository or self.repository) / ".git" / "valkama" / "commits"
        return sorted(folder.glob("*.json")) if folder.is_dir() else []

    def everywhere(self) -> list[Path]:
        return [
            *self.beside_the_store(),
            *self.in_the_git_directory(),
            *self.in_the_git_directory(self.space),
        ]
