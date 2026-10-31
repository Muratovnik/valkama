"""What `windows/release.py check` owes: the tools of the interpreter running it, or a refusal.

Release Kit substitutes `{python}` with its own interpreter, so the check runs
under whichever Python launched the release. It used to find half its tools on
`PATH` instead: a shared interpreter without ruff failed with "No module named
ruff", and a venv whose `Scripts` was not on `PATH` ran a shared semgrep whose
dependencies had drifted. Each failure surfaced one stage at a time, minutes in.

These tests hold the two halves of the fix against a fake environment, never
the real one: every tool resolves inside the running interpreter's own
environment, and an environment that lacks a pinned tool is refused before the
first stage with a message saying what to run.
"""

from __future__ import annotations

import importlib.util
import io
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "valkama_release", ROOT / "windows" / "release.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # A dataclass resolves its annotations through the module's sys.modules entry.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


release = _load()

PINS = """\
# a comment, then the pins
ruff==0.17.3
typos==1.51.1
vulture==2.16
mypy==2.4.1
import-linter==2.15
semgrep==1.183.0

coverage==7.17.0
hypothesis==6.170.14
"""


def _script(directory: Path, name: str) -> Path:
    """A console script as pip lays one down on this platform."""

    path = directory / (f"{name}.exe" if sys.platform == "win32" else name)
    path.write_bytes(b"")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


class FakeEnvironment:
    """An interpreter's environment on disk: its executable, its scripts, its installs."""

    SCRIPTS = ("typos", "lint-imports", "semgrep")

    def __init__(self, root: Path, installed: dict[str, str] | None = None) -> None:
        self.scripts = root / ("Scripts" if sys.platform == "win32" else "bin")
        self.scripts.mkdir(parents=True)
        self.executable = _script(self.scripts, "python")
        self.installed = dict(release.pins(PINS) if installed is None else installed)
        for name in self.SCRIPTS:
            _script(self.scripts, name)

    def interpreter(self) -> object:
        return release.Interpreter(self.executable, self.scripts, self.installed.get)


class ReleaseToolchainTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.environment = FakeEnvironment(self.root / "venv")
        # A second environment on PATH holding every script, as a shared
        # install does: nothing may be taken from it.
        self.shared = self.root / "shared"
        self.shared.mkdir()
        for name in (*FakeEnvironment.SCRIPTS, "pysemgrep", "ruff", "mypy"):
            _script(self.shared, name)
        path = mock.patch.dict(os.environ, {"PATH": str(self.shared)})
        path.start()
        self.addCleanup(path.stop)

    def refusal(self, interpreter: object) -> str:
        with self.assertRaises(release.ToolchainError) as refused:
            release.require_toolchain(interpreter, release.pins(PINS))
        return str(refused.exception)

    # -- resolution ---------------------------------------------------------

    def test_every_tool_resolves_inside_the_running_interpreters_environment(self) -> None:
        commands = release.require_toolchain(self.environment.interpreter(), release.pins(PINS))
        self.assertEqual(set(release.TOOLS), set(commands))
        executable = str(self.environment.executable)
        for name in ("ruff", "vulture", "mypy", "coverage"):
            self.assertEqual((executable, "-m", name), commands[name], name)
        for name in ("typos", "lint-imports", "semgrep"):
            [found] = commands[name]
            self.assertEqual(self.environment.scripts, Path(found).parent, name)

    def test_a_script_on_path_does_not_stand_in_for_a_missing_one(self) -> None:
        semgrep = next(self.environment.scripts.glob("semgrep*"))
        semgrep.unlink()
        message = self.refusal(self.environment.interpreter())
        self.assertIn("semgrep", message)
        self.assertIn(str(self.environment.scripts), message)

    def test_a_script_in_the_current_directory_does_not_stand_in_either(self) -> None:
        # shutil.which searches the current directory first on Windows, even
        # when it is handed a path of its own.
        next(self.environment.scripts.glob("semgrep*")).unlink()
        here = self.root / "checkout"
        here.mkdir()
        _script(here, "semgrep")
        previous = Path.cwd()
        os.chdir(here)
        self.addCleanup(os.chdir, previous)
        message = self.refusal(self.environment.interpreter())
        self.assertIn(f"no semgrep console script in {self.environment.scripts}", message)

    def test_the_tool_environment_puts_the_interpreters_scripts_first(self) -> None:
        # semgrep's launcher finds pysemgrep through PATH and only appends its
        # own directory, so a shared copy earlier on PATH would win.
        for key in ("PATH", "Path"):
            with self.subTest(key=key):
                found = release.tool_environment(
                    self.environment.interpreter(), {key: str(self.shared), "OTHER": "kept"}
                )
                self.assertEqual(
                    [str(self.environment.scripts), str(self.shared)],
                    found[key].split(os.pathsep),
                )
                self.assertEqual("kept", found["OTHER"])
                self.assertEqual(2, len(found))

    # -- the early refusal ----------------------------------------------------

    def test_a_missing_or_mismatched_pin_is_refused_with_what_to_run(self) -> None:
        installed = release.pins(PINS)
        del installed["ruff"]
        installed["semgrep"] = "1.150.0"
        environment = FakeEnvironment(self.root / "shared-python", installed)
        message = self.refusal(environment.interpreter())
        self.assertIn(str(environment.executable), message)
        self.assertIn("ruff: not installed; requirements-dev.txt pins 0.17.3", message)
        self.assertIn("semgrep: 1.150.0 installed; requirements-dev.txt pins 1.183.0", message)
        self.assertNotIn("mypy", message)
        # uv's venv holds no pip, so each way of creating one names its own installer.
        self.assertIn("uv venv .venv --python 3.11, then uv pip install --python", message)
        self.assertIn("python -m venv .venv, then .venv/Scripts/python -m pip install", message)
        self.assertIn(".github/relkit.pyz release prepare", message)

    def test_a_pin_the_suite_imports_counts_although_no_stage_runs_it(self) -> None:
        installed = release.pins(PINS)
        del installed["hypothesis"]
        message = self.refusal(FakeEnvironment(self.root / "other", installed).interpreter())
        self.assertIn("hypothesis: not installed", message)

    def test_check_refuses_before_any_stage_runs(self) -> None:
        installed = release.pins(PINS)
        del installed["ruff"]
        interpreter = FakeEnvironment(self.root / "bare", installed).interpreter()
        with (
            mock.patch.object(release.subprocess, "run") as run,
            mock.patch.object(release, "require_version") as version,
            self.assertRaises(release.ToolchainError),
        ):
            release.check(interpreter, PINS)
        run.assert_not_called()
        version.assert_not_called()

    def test_check_runs_each_python_stage_from_the_interpreters_environment(self) -> None:
        interpreter = self.environment.interpreter()
        with (
            mock.patch.object(release.subprocess, "run") as run,
            mock.patch.object(release, "require_version"),
            mock.patch.object(release.sys, "stdout", io.StringIO()),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.root / "local")}),
        ):
            (self.root / "local" / "Temp").mkdir(parents=True)
            release.check(interpreter, PINS)
        inside = (str(self.environment.executable), str(self.environment.scripts))
        python_stages = [call for call in run.call_args_list if call.args[0][0] != release.NPM]
        self.assertEqual(9, len(python_stages))
        for call in run.call_args_list:
            command = call.args[0]
            if command[0] != release.NPM:
                self.assertTrue(command[0].startswith(inside), command)
            path = call.kwargs["env"]["PATH"].split(os.pathsep)
            self.assertEqual(str(self.environment.scripts), path[0], command)

    # -- the pins -------------------------------------------------------------

    def test_pins_are_read_exactly_and_a_loose_one_is_refused(self) -> None:
        self.assertEqual(
            {"ruff": "0.17.3", "import-linter": "2.15"},
            release.pins("ruff==0.17.3\n  # note\n\nimport-linter==2.15  # inline\n"),
        )
        for loose in ("ruff>=0.17", "ruff", "ruff==0.17.3; python_version>'3'"):
            with self.subTest(loose=loose), self.assertRaises(ValueError):
                release.pins(loose + "\n")

    def test_every_tool_the_check_runs_is_pinned_in_the_repository(self) -> None:
        pinned = release.pins((ROOT / "requirements-dev.txt").read_text(encoding="utf-8"))
        for name, tool in release.TOOLS.items():
            self.assertIn(tool.distribution, pinned, name)


if __name__ == "__main__":
    unittest.main()
