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

The npm stages are held against a checkout made here, with npm played by a fake
that touches a disk the way npm does: `npm ci` empties the `node_modules` it
finds, through a link too. A release check once did that to the modules every
worktree on the machine shared. The check now runs npm only in a temporary copy
of the checkout's sources, so the checkout's own modules, a directory or a link,
come through unchanged, and the copy is gone when the check ends.

The price stage is held the same way, against a hand-written document in the
shape of LiteLLM's list and never the network: an equal price passes, a
different one fails naming both values, and a list that cannot be read is
refused rather than passed.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

from tests.worktree import link_directory

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


#: The real `subprocess.run`, for the Git calls a fake stage runner lets through, and Git
#: found before a test narrows PATH to the scripts it lays down.
_real_run = subprocess.run
_GIT = shutil.which("git") or "git"


def files(top: Path) -> dict[str, bytes]:
    """Every file below `top`, read through a link at the top, by its path relative to it."""

    found = {}
    for parent, _directories, names in os.walk(top):
        for name in names:
            path = Path(parent) / name
            found[path.relative_to(top).as_posix()] = path.read_bytes()
    return found


#: The checkout's working tree as Git reports it, which is what the npm stages check:
#: committed files, a file edited since, and one not yet added. Nothing ignored.
SOURCES = {
    ".gitignore": b"node_modules/\ntest-results/\n",
    "web/package.json": b'{"name": "web"}\n',
    "web/package-lock.json": b'{"lockfileVersion": 3}\n',
    "web/src/main.ts": b"edited in the working tree\n",
    "web/src/new.ts": b"not added yet\n",
    "web/dist/index.html": b"the committed bundle\n",
    "web/dist/stale.js": b"a chunk the next build no longer writes\n",
    "desktop/package.json": b'{"name": "desktop"}\n',
    "desktop/package-lock.json": b'{"lockfileVersion": 3}\n',
    "desktop/main.js": b"main\n",
    # The desktop tests read their samples beside the package, not inside it.
    "tests/fixtures/samples.json": b"[]\n",
}


def make_checkout(checkout: Path) -> Path:
    """A Git checkout holding `SOURCES` in its working tree, an ignored file, and no modules."""

    for name, content in SOURCES.items():
        path = checkout / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"committed\n" if name == "web/src/main.ts" else content)
    git = (_GIT, "-C", str(checkout))
    # Staged, never committed: a commit would run whatever hooks this machine installs.
    _real_run((*git, "init", "-q"), check=True, capture_output=True)
    added = (name for name in SOURCES if name != "web/src/new.ts")
    _real_run((*git, "add", "--", *added), check=True, capture_output=True)
    (checkout / "web/src/main.ts").write_bytes(SOURCES["web/src/main.ts"])
    (checkout / "web/test-results").mkdir()
    (checkout / "web/test-results/report.txt").write_bytes(b"ignored output\n")
    return checkout


class FakeStages:
    """`subprocess.run` for `check`: Git runs for real, every other call is recorded and faked.

    npm is played as it touches a disk. `ci` empties the `node_modules` it finds,
    through a link as well, which is what emptied the shared modules, and installs
    one that holds a link out of the package, as an install may. `run build`
    empties `dist` and writes a bundle there. `fail` names the npm arguments that
    exit non-zero instead, before touching anything.
    """

    def __init__(self, outside: Path, fail: tuple[str, ...] | None = None) -> None:
        self.outside = outside
        self.fail = fail
        self.calls: list = []
        self.copied: dict[str, bytes] | None = None

    def __call__(self, command: tuple[str, ...], **kwargs: object) -> object:
        if command[0] == "git":
            return _real_run((_GIT, *command[1:]), **kwargs)
        self.calls.append(mock.call(command, **kwargs))
        if command[0] == release.NPM:
            cwd = Path(str(kwargs["cwd"]))
            if command[1:] == self.fail:
                raise subprocess.CalledProcessError(1, command)
            if self.copied is None:
                # What the first npm stage found beside it is what every one checks.
                self.copied = files(cwd.parent)
            if command[1:] == ("ci",):
                self.install(cwd / "node_modules")
            elif command[1:] == ("run", "build"):
                shutil.rmtree(cwd / "dist", ignore_errors=True)
                (cwd / "dist").mkdir()
                (cwd / "dist" / "index.html").write_bytes(b"built from " + cwd.name.encode())
        return subprocess.CompletedProcess(command, 0, b"", b"")

    def install(self, modules: Path) -> None:
        if modules.exists():
            for entry in list(modules.iterdir()):
                if entry.is_dir():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
        else:
            modules.mkdir()
        (modules / ".package-lock.json").write_bytes(b"{}")
        link_directory(modules / "linked", self.outside)


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

    def outside(self) -> Path:
        """A directory outside every checkout and copy, which nothing the check removes enters."""

        outside = self.root / "outside"
        if not outside.is_dir():
            outside.mkdir()
            (outside / "kept").write_bytes(b"kept")
        return outside

    @property
    def temporary(self) -> Path:
        """Where `check` makes its temporary directories, under the temporary root set here."""

        return (self.root / "local" / "Temp" / "codex").resolve()

    def checked(self, checkout: Path, stages: FakeStages) -> None:
        """Run `check` on `checkout`, `stages` standing in for every process but Git."""

        (self.root / "local" / "Temp").mkdir(parents=True, exist_ok=True)
        with (
            mock.patch.object(release, "ROOT", checkout),
            mock.patch.object(release.subprocess, "run", side_effect=stages),
            mock.patch.object(release, "version"),
            mock.patch.object(release, "require_version"),
            mock.patch.object(release.sys, "stdout", io.StringIO()),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.root / "local")}),
            mock.patch.object(release.tempfile, "tempdir", str(self.root / "local" / "Temp")),
        ):
            release.check(self.environment.interpreter(), PINS)

    def checked_commands(self, checkout: Path | None = None) -> list:
        """Every call but Git's that `check` made on a checkout of `SOURCES`, none for real."""

        stages = FakeStages(self.outside())
        self.checked(checkout or make_checkout(self.root / "checkout"), stages)
        return stages.calls

    def test_check_runs_each_python_stage_from_the_interpreters_environment(self) -> None:
        calls = self.checked_commands()
        inside = (str(self.environment.executable), str(self.environment.scripts))
        python_stages = [call for call in calls if call.args[0][0] != release.NPM]
        self.assertEqual(10, len(python_stages))
        for call in calls:
            command = call.args[0]
            if command[0] != release.NPM:
                self.assertTrue(command[0].startswith(inside), command)
            path = call.kwargs["env"]["PATH"].split(os.pathsep)
            self.assertEqual(str(self.environment.scripts), path[0], command)

    # -- the modules the npm stages run on ------------------------------------

    def test_check_installs_from_each_lockfile_before_any_stage_uses_it(self) -> None:
        calls = self.checked_commands()

        stages = [(call.args[0], Path(call.kwargs["cwd"])) for call in calls]
        npm = [(command[1:], cwd) for command, cwd in stages if command[0] == release.NPM]
        copy = npm[0][1].parent
        self.assertEqual(
            [
                (("ci",), copy / "web"),
                (("ci",), copy / "desktop"),
                (("test",), copy / "web"),
                (("run", "build"), copy / "web"),
                (("test",), copy / "desktop"),
            ],
            npm,
        )
        self.assertEqual(self.temporary, copy.parent.resolve())
        # Ahead of the Python stages too: a release once ran 1102 s and then failed here.
        self.assertEqual([release.NPM, release.NPM], [command[0] for command, _ in stages[:2]])

    def test_check_compares_prices_right_after_the_installs(self) -> None:
        # A price source that cannot be reached is a network failure like a registry's,
        # so it is met before the suite rather than after it.
        checkout = make_checkout(self.root / "checkout")
        third = self.checked_commands(checkout)[2]
        command, cwd = third.args[0], third.kwargs["cwd"]
        self.assertEqual(
            (str(self.environment.executable), str(checkout / "windows" / "release.py"), "prices"),
            command,
        )
        self.assertEqual(checkout, cwd)

    def test_a_failed_install_stops_the_check_before_any_other_stage(self) -> None:
        stages = FakeStages(self.outside(), fail=("ci",))
        with self.assertRaises(subprocess.CalledProcessError):
            self.checked(make_checkout(self.root / "checkout"), stages)
        self.assertEqual(1, len(stages.calls))
        self.assertEqual([], list(self.temporary.iterdir()))

    def test_the_checkouts_own_modules_come_through_the_npm_stages_unchanged(self) -> None:
        # npm ci empties the node_modules it runs on, through a link as well. Run in
        # the checkout other worktrees link their modules to, it emptied theirs.
        layouts = {
            "directories": ("directory", "directory"),
            "web linked": ("link", "directory"),
            "desktop linked": ("directory", "link"),
        }
        for name, kinds in layouts.items():
            with self.subTest(layout=name):
                checkout = make_checkout(self.root / name / "checkout")
                links = {}
                for package, kind in zip(release.NPM_PACKAGES, kinds, strict=True):
                    modules = checkout / package / "node_modules"
                    if kind == "link":
                        target = self.root / name / "shared" / package
                        target.mkdir(parents=True)
                        link_directory(modules, target)
                        links[package] = target.resolve()
                    else:
                        modules.mkdir()
                    (modules / "sentinel").write_bytes(f"{package} modules".encode())
                packages = release.NPM_PACKAGES
                before = {
                    package: files(checkout / package / "node_modules") for package in packages
                }
                stages = FakeStages(self.outside())

                self.checked(checkout, stages)

                after = {
                    package: files(checkout / package / "node_modules") for package in packages
                }
                self.assertEqual(before, after)
                for package, target in links.items():
                    self.assertEqual(target, release.linked_modules(checkout / package), package)
                npm = [
                    Path(call.kwargs["cwd"]).resolve()
                    for call in stages.calls
                    if call.args[0][0] == release.NPM
                ]
                self.assertEqual(5, len(npm))
                for cwd in npm:
                    self.assertTrue(cwd.is_relative_to(self.temporary), cwd)
                    self.assertFalse(cwd.is_relative_to(checkout.resolve()), cwd)
                # What they ran on is the working tree's sources, an edit and a file not yet
                # added included; ignored output and every node_modules left out.
                self.assertEqual(SOURCES, stages.copied)
                # The copy is gone, and the link the install left in it was not entered.
                self.assertEqual([], list(self.temporary.iterdir()))
                self.assertEqual({"kept": b"kept"}, files(self.outside()))

    def test_the_web_build_replaces_the_checkouts_bundle_and_nothing_else(self) -> None:
        # Release Kit's clean-tree check after the checks is what finds a committed bundle
        # that its sources no longer build, so what the copy built lands in the checkout.
        checkout = make_checkout(self.root / "checkout")
        before = files(checkout)

        self.checked(checkout, FakeStages(self.outside()))

        self.assertEqual({"index.html": b"built from web"}, files(checkout / "web" / "dist"))
        after = files(checkout)
        for tree in (before, after):
            for name in [name for name in tree if name.startswith(("web/dist/", ".git/"))]:
                del tree[name]
        self.assertEqual(before, after)

    def test_a_failed_npm_stage_still_removes_the_copy(self) -> None:
        checkout = make_checkout(self.root / "checkout")
        with self.assertRaises(subprocess.CalledProcessError):
            self.checked(checkout, FakeStages(self.outside(), fail=("test",)))
        self.assertEqual([], list(self.temporary.iterdir()))
        self.assertEqual({"kept": b"kept"}, files(self.outside()))
        self.assertEqual(
            SOURCES["web/dist/index.html"], (checkout / "web" / "dist" / "index.html").read_bytes()
        )

    def test_a_copy_that_cannot_be_removed_is_named_and_a_stage_failure_kept(self) -> None:
        remove = shutil.rmtree

        def held(path: str, *args: object, **kwargs: object) -> None:
            if Path(path).name.startswith("valkama-npm-"):
                raise PermissionError(13, "in use", str(path))
            remove(path, *args, **kwargs)

        for fail in (("test",), None):
            with self.subTest(fail=fail):
                checkout = make_checkout(self.root / f"checkout-{bool(fail)}")
                stages = FakeStages(self.outside(), fail=fail)
                errors = io.StringIO()
                expected = subprocess.CalledProcessError if fail else RuntimeError
                with (
                    mock.patch.object(release.shutil, "rmtree", side_effect=held),
                    mock.patch.object(release.sys, "stderr", errors),
                    self.assertRaises(expected) as raised,
                ):
                    self.checked(checkout, stages)
                [left] = list(self.temporary.iterdir())
                said = errors.getvalue() if fail else str(raised.exception)
                self.assertIn(str(left), said)
                self.assertIn("in use", said)
                remove(left)

    def test_modules_are_linked_only_when_they_are_somewhere_else(self) -> None:
        package = self.root / "package"
        package.mkdir()
        self.assertIsNone(release.linked_modules(package), "none at all")

        (package / "node_modules").mkdir()
        self.assertIsNone(release.linked_modules(package), "a directory of its own")

        # A link above the package moves nothing out of it.
        linked_parent = self.root / "linked-parent"
        link_directory(linked_parent, package)
        self.assertIsNone(release.linked_modules(linked_parent), "through a link above it")

        (package / "node_modules").rmdir()
        shared = self.root / "other-checkout"
        shared.mkdir()
        link_directory(package / "node_modules", shared)
        self.assertEqual(shared.resolve(), release.linked_modules(package))

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


#: A hand-written document in the shape of LiteLLM's price list: USD per token, a
#: vendor's longer cache write named by its length, long prices by the prompt length
#: they start above, and fields the check has no use for. Not a copy of their file.
LITELLM = {
    "claude-opus-5-5": {
        "litellm_provider": "anthropic",
        "input_cost_per_token": 4e-06,
        "input_cost_per_token_batches": 2e-06,
        "cache_read_input_token_cost": 2e-07,
        "cache_creation_input_token_cost": 5e-06,
        "cache_creation_input_token_cost_above_1hr": 8e-06,
        "output_cost_per_token": 2e-05,
        "supports_fast_mode": True,
    },
    "claude-haiku-5-5-20261001": {
        "litellm_provider": "anthropic",
        "input_cost_per_token": 1e-07,
        "cache_read_input_token_cost": 1e-08,
        "cache_creation_input_token_cost": 1.25e-07,
        "cache_creation_input_token_cost_above_1hr": 2e-07,
        "output_cost_per_token": 5e-07,
        "input_cost_per_token_above_100k_tokens": 5e-07,
        "cache_read_input_token_cost_above_100k_tokens": 5e-08,
        "cache_creation_input_token_cost_above_100k_tokens": 6.25e-07,
        "cache_creation_input_token_cost_above_1hr_above_100k_tokens": 1e-06,
        "output_cost_per_token_above_100k_tokens": 2.5e-06,
    },
    "gpt-6.1-sol": {
        "litellm_provider": "openai",
        "input_cost_per_token": 2e-06,
        "input_cost_per_token_priority": 4e-06,
        "cache_read_input_token_cost": 1e-07,
        "cache_creation_input_token_cost": 2.5e-06,
        "cache_creation_input_token_cost_above_12hr": 5e-06,
        "output_cost_per_token": 1e-05,
        "input_cost_per_token_above_272k_tokens": 4e-06,
        "cache_read_input_token_cost_above_272k_tokens": 2e-07,
        "cache_creation_input_token_cost_above_272k_tokens": 5e-06,
        "cache_creation_input_token_cost_above_12hr_above_272k_tokens": 1e-05,
        "output_cost_per_token_above_272k_tokens": 1.5e-05,
    },
    # Another vendor's listing of a model with the same name is not this model.
    "gpt-model": {"litellm_provider": "azure", "input_cost_per_token": 1.0},
    "sample_spec": {"input_cost_per_token": 0.0},
}


def price_table(**overrides: object) -> SimpleNamespace:
    """A price table holding the three models above at the prices above, and one more."""

    from server.telemetry.usage_prices import PRICED_KINDS, Listing, Rates

    listings = {
        "claude-opus-5-5": Listing("anthropic", Rates(4, 0.20, 5, 8, 20)),
        "claude-haiku-5-5": Listing(
            "anthropic",
            Rates(0.10, 0.01, 0.125, 0.20, 0.50),
            Rates(0.50, 0.05, 0.625, 1, 2.50),
            100_000,
        ),
        "gpt-6.1-sol": Listing(
            "openai", Rates(2, 0.10, 2.5, 5, 10), Rates(4, 0.20, 5, 10, 15), 272_000
        ),
        "gpt-model": Listing("openai", Rates(1, 0.1, None, None, 2)),
        "claude-newest-1": Listing("anthropic", Rates(1, 0.1, 1.25, 2, 5)),
        **overrides,
    }
    return SimpleNamespace(PRICED_KINDS=PRICED_KINDS, listings=lambda: dict(listings))


class ReleasePriceTests(unittest.TestCase):
    """The price stage compares the server's table with LiteLLM's list and copies nothing."""

    def refusal(self, table: SimpleNamespace, document: dict | None = None) -> str:
        with self.assertRaises(release.PriceCheckError) as refused:
            release.check_prices(lambda: LITELLM if document is None else document, table)
        return str(refused.exception)

    def test_equal_prices_pass_and_say_how_many_models_were_compared(self) -> None:
        lines = release.check_prices(lambda: LITELLM, price_table())
        self.assertIn("the prices of 3 model(s) agree", lines[0])

    def test_a_model_litellm_does_not_list_is_reported_without_failing(self) -> None:
        lines = release.check_prices(lambda: LITELLM, price_table())
        # The model with a name only another vendor uses there is not listed either.
        self.assertEqual(
            ["claude-newest-1: not listed there", "gpt-model: not listed there"], lines[1:]
        )

    def test_a_wrong_price_fails_naming_the_model_the_rate_and_both_values(self) -> None:
        from server.telemetry.usage_prices import Listing, Rates

        message = self.refusal(
            price_table(**{"claude-opus-5-5": Listing("anthropic", Rates(4, 0.20, 5, 8, 25))})
        )
        self.assertIn("1 price(s) differ", message)
        self.assertIn(
            "claude-opus-5-5 output: Valkama 25 USD per million tokens,"
            " LiteLLM (claude-opus-5-5) 20 USD per million tokens",
            message,
        )
        # What does not differ is not named as a difference.
        self.assertNotIn("claude-opus-5-5 input", message)

    def test_a_long_price_and_a_dated_id_are_compared_too(self) -> None:
        from server.telemetry.usage_prices import Listing, Rates

        haiku = Listing(
            "anthropic",
            Rates(0.10, 0.01, 0.125, 0.20, 0.50),
            Rates(0.50, 0.05, 0.625, 1.5, 2.50),
            100_000,
        )
        message = self.refusal(price_table(**{"claude-haiku-5-5": haiku}))
        self.assertIn(
            "claude-haiku-5-5 cache_write_1h over 100000 prompt tokens: Valkama 1.5 USD per million"
            " tokens, LiteLLM (claude-haiku-5-5-20261001) 1 USD per million tokens",
            message,
        )

    def test_a_price_only_litellm_has_is_a_difference(self) -> None:
        from server.telemetry.usage_prices import Listing, Rates

        sol = Listing("openai", Rates(2, 0.10, 2.5, None, 10), Rates(4, 0.20, 5, 10, 15), 272_000)
        message = self.refusal(price_table(**{"gpt-6.1-sol": sol}))
        self.assertIn(
            "gpt-6.1-sol cache_write_1h: Valkama no price, LiteLLM (gpt-6.1-sol) 5 USD per million"
            " tokens",
            message,
        )

    def test_long_prices_valkama_does_not_model_are_a_difference(self) -> None:
        from server.telemetry.usage_prices import Listing, Rates

        message = self.refusal(
            price_table(**{"gpt-6.1-sol": Listing("openai", Rates(2, 0.10, 2.5, 5, 10))})
        )
        self.assertIn("gpt-6.1-sol: LiteLLM (gpt-6.1-sol) prices prompts over 272k tokens", message)

    def test_a_rate_litellm_does_not_list_is_reported_without_failing(self) -> None:
        document = {
            "claude-opus-5-5": {
                key: value
                for key, value in LITELLM["claude-opus-5-5"].items()
                if key != "cache_creation_input_token_cost_above_1hr"
            }
        }
        lines = release.check_prices(lambda: document, price_table())
        self.assertIn(
            "claude-opus-5-5 cache_write_1h: claude-opus-5-5 lists no"
            " cache_creation_input_token_cost_above_1hr",
            lines,
        )

    def test_an_unreachable_source_is_refused_and_nothing_passes(self) -> None:
        unreachable = release.urllib.error.URLError("no route to host")
        with (
            mock.patch.object(release.urllib.request, "urlopen", side_effect=unreachable),
            self.assertRaises(release.PriceCheckError) as refused,
        ):
            release.check_prices(table=price_table())
        message = str(refused.exception)
        self.assertIn(release.LITELLM_PRICES, message)
        self.assertIn("no route to host", message)
        self.assertIn("does not pass", message)

    def test_an_answer_that_is_not_a_price_list_is_refused(self) -> None:
        for body in (b"<html>rate limited</html>", b"[]"):
            answer = mock.MagicMock()
            answer.__enter__.return_value.read.return_value = body
            with (
                self.subTest(body=body),
                mock.patch.object(release.urllib.request, "urlopen", return_value=answer),
                self.assertRaises(release.PriceCheckError),
            ):
                release.fetch_price_list()

    def test_a_list_that_names_none_of_the_models_is_refused_not_passed(self) -> None:
        for document in ({}, {"some-other-model": {"litellm_provider": "anthropic"}}):
            with self.subTest(document=document):
                message = self.refusal(price_table(), document)
                self.assertIn("No price was compared", message)

    def test_the_stage_exits_with_the_refusal(self) -> None:
        refusal = release.PriceCheckError("release check: nothing was compared")
        with (
            mock.patch.object(release, "check_prices", side_effect=refusal),
            mock.patch.object(release.sys, "argv", ["release.py", "prices"]),
            self.assertRaises(SystemExit) as stopped,
        ):
            release.main()
        self.assertEqual("release check: nothing was compared", stopped.exception.code)

    def test_the_servers_own_table_loads_from_its_file(self) -> None:
        table = release.price_table()
        self.assertEqual("anthropic", table.listings()["claude-fable-5-2"].vendor)


#: A made-up commit id of the full length Git writes.
COMMIT = "0123456789abcdef0123456789abcdef01234567"


class SourceArchiveTests(unittest.TestCase):
    """The source archive carries the record `launcher install` pins it by.

    The archive has no Git history, so a directory it was unpacked into could not
    be installed. Build now writes the commit it was built from, the version and
    the digest of each file; the record has to list exactly the files the archive
    holds, or the install would check something other than what it copies.
    """

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.tree = self.root / "tree"
        self.contents = {
            "valkama.py": b"print('entry')\n",
            "VERSION": b"9.9.9\n",
            "server/cli.py": b"# a module\n",
            "web/dist/assets/app.js": bytes(range(256)),
            "docs/guides/установка.md": "текст\n".encode(),
        }
        for name, data in self.contents.items():
            path = self.tree / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.target = self.root / "valkama-9.9.9-source.zip"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, commit: str = COMMIT) -> None:
        files = sorted(path for path in self.tree.rglob("*") if path.is_file())
        release.write_source_archive(self.target, self.tree, files, commit, "9.9.9")

    def test_the_record_lists_every_file_the_archive_holds_and_nothing_else(self) -> None:
        self.write()
        with zipfile.ZipFile(self.target) as archive:
            held = {name: archive.read(name) for name in archive.namelist()}
        record = json.loads(held.pop("valkama-source.json"))
        self.assertEqual(self.contents, held)
        self.assertEqual(
            {name: hashlib.sha256(data).hexdigest() for name, data in held.items()},
            record["files"],
        )
        # Only what any public archive may hold: no checkout path, no host, no account.
        self.assertEqual({"schema_version", "commit", "version", "files"}, set(record))
        self.assertEqual(
            (1, COMMIT, "9.9.9"), (record["schema_version"], record["commit"], record["version"])
        )

    def test_an_archive_whose_commit_is_not_a_full_id_is_not_left_behind(self) -> None:
        for commit in ("HEAD", COMMIT[:12], COMMIT.upper()):
            with self.subTest(commit=commit):
                with self.assertRaisesRegex(ValueError, "not a full commit id"):
                    self.write(commit)
                self.assertFalse(self.target.exists())

    def test_build_and_smoke_require_the_commit(self) -> None:
        for action in ("build", "smoke"):
            argv = ["release.py", action, "--assets", "a", "--version", "9.9.9", "--work-dir", "w"]
            with self.subTest(action=action):
                with (
                    mock.patch.object(release.sys, "argv", argv),
                    mock.patch.object(release, action) as called,
                    mock.patch("sys.stderr", io.StringIO()) as said,
                    self.assertRaises(SystemExit),
                ):
                    release.main()
                called.assert_not_called()
                self.assertIn("--commit", said.getvalue())


#: A Release Kit snapshot as build reads it: committed files and no Git. The desktop
#: build reads its package, the NSIS include inside it and the icon beside it.
SNAPSHOT = {
    "VERSION": b"9.9.9\n",
    "valkama.py": b"print('entry')\n",
    "desktop/package.json": b'{"name": "valkama-desktop", "version": "9.9.9"}\n',
    "desktop/package-lock.json": b'{"version": "9.9.9"}\n',
    "desktop/main.js": b"main\n",
    "desktop/build/installer.nsh": b"; include\n",
    "windows/valkama.ico": b"icon",
    "windows/tray.ps1": b"# tray\n",
}


class FakeDist:
    """`subprocess.run` for `build`: npm played as it touches a disk, every call recorded.

    `ci` installs a `node_modules` beside the package it runs in, with a read-only
    file as some packages carry. `run dist` records the tree it found around its
    package, then writes the installer into the output directory it was given.
    """

    INSTALLER = b"an installer"

    def __init__(self) -> None:
        self.calls: list = []
        self.found: dict[str, bytes] | None = None

    def __call__(self, command: tuple[str, ...], **kwargs: object) -> object:
        self.calls.append(mock.call(command, **kwargs))
        cwd = Path(str(kwargs["cwd"]))
        if command[1:] == ("ci",):
            (cwd / "node_modules").mkdir(exist_ok=True)
            held = cwd / "node_modules" / "read-only.js"
            held.write_bytes(b"module")
            held.chmod(stat.S_IREAD)
        elif command[1:3] == ("run", "dist"):
            self.found = files(cwd.parent)
            output = Path(command[-1].removeprefix("--config.directories.output="))
            output.mkdir(parents=True)
            (output / "Valkama Setup 9.9.9.exe").write_bytes(self.INSTALLER)
        return subprocess.CompletedProcess(command, 0, b"", b"")


class ReleaseBuildTests(unittest.TestCase):
    """Build leaves Release Kit's snapshot as it found it.

    Release Kit removes from the snapshot only the files it wrote, so a `npm ci`
    run there left the desktop `node_modules` behind after every release
    preparation, reported as retained temporary files. Build now installs and
    packs in a copy inside its work directory, which Release Kit discards whole.
    """

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.snapshot = self.root / "source"
        for name, data in SNAPSHOT.items():
            path = self.snapshot / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        # The record format, loaded from the snapshot as build loads it.
        record = self.snapshot / "server" / "source_archive.py"
        record.parent.mkdir()
        shutil.copyfile(ROOT / "server" / "source_archive.py", record)
        self.assets = self.root / "assets"
        self.work = self.root / "temp"
        self.work.mkdir()

    def built(self) -> FakeDist:
        npm = FakeDist()
        with (
            mock.patch.object(release, "ROOT", self.snapshot),
            mock.patch.object(release.subprocess, "run", side_effect=npm),
            mock.patch.object(release.sys, "platform", "win32"),
            mock.patch.object(release, "require_version"),
            mock.patch.object(release.sys, "stdout", io.StringIO()),
            # Release Kit runs build with PYTHONDONTWRITEBYTECODE, so loading the
            # record from the snapshot writes no bytecode beside it.
            mock.patch.object(release.sys, "dont_write_bytecode", True),
        ):
            release.build(self.assets, "9.9.9", self.work, COMMIT)
        return npm

    def test_the_snapshot_comes_through_the_build_unchanged(self) -> None:
        before = files(self.snapshot)

        npm = self.built()

        self.assertFalse((self.snapshot / "desktop" / "node_modules").exists())
        self.assertEqual(before, files(self.snapshot))
        output = self.work / "desktop-build"
        commands = [call.args[0][1:] for call in npm.calls]
        self.assertEqual(
            [("ci",), ("run", "dist", "--", f"--config.directories.output={output}")], commands
        )
        for call in npm.calls:
            cwd = Path(str(call.kwargs["cwd"])).resolve()
            self.assertTrue(cwd.is_relative_to(self.work), cwd)
            self.assertEqual("desktop", cwd.name)

    def test_the_build_reads_the_desktop_package_with_its_icon_beside_it(self) -> None:
        stale = self.snapshot / "desktop" / "release" / "Valkama Setup 9.9.8.exe"
        stale.parent.mkdir()
        stale.write_bytes(b"an earlier build")
        (self.snapshot / "desktop" / "node_modules").mkdir()
        (self.snapshot / "desktop" / "node_modules" / "left.js").write_bytes(b"a local install")

        npm = self.built()

        # What dist found around its package: the desktop sources and `windows/` as
        # siblings, the install `ci` made, and nothing else of the snapshot.
        expected = {
            name: data
            for name, data in SNAPSHOT.items()
            if name.startswith(("desktop/", "windows/"))
        }
        expected["desktop/node_modules/read-only.js"] = b"module"
        self.assertEqual(expected, npm.found)

    def test_the_installer_and_the_checksums_are_published_as_before(self) -> None:
        self.built()

        source = "valkama-9.9.9-source.zip"
        installer = "Valkama-Setup-9.9.9.exe"
        self.assertEqual(
            {source, installer, "SHA256SUMS"}, {path.name for path in self.assets.iterdir()}
        )
        self.assertEqual(FakeDist.INSTALLER, (self.assets / installer).read_bytes())
        zipped = (self.assets / source).read_bytes()
        self.assertEqual(
            f"{hashlib.sha256(zipped).hexdigest()}  {source}\n"
            f"{hashlib.sha256(FakeDist.INSTALLER).hexdigest()}  {installer}\n",
            (self.assets / "SHA256SUMS").read_text(encoding="utf-8"),
        )
        with zipfile.ZipFile(self.assets / source) as archive:
            held = set(archive.namelist()) - {"valkama-source.json"}
        self.assertEqual({*SNAPSHOT, "server/source_archive.py"}, held)


if __name__ == "__main__":
    unittest.main()
