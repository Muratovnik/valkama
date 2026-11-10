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

The price stage is held the same way, against a hand-written document in the
shape of LiteLLM's list and never the network: an equal price passes, a
different one fails naming both values, and a list that cannot be read is
refused rather than passed.
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
from types import ModuleType, SimpleNamespace
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


def link_directory(link: Path, target: Path) -> None:
    """A junction on Windows, which takes no privilege, and a symbolic link elsewhere."""

    if sys.platform == "win32":
        import _winapi

        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


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

    def checked_commands(self, checkout: Path) -> list:
        """Every stage `check` ran in `checkout`, none of them for real."""

        (self.root / "local" / "Temp").mkdir(parents=True, exist_ok=True)
        with (
            mock.patch.object(release, "ROOT", checkout),
            mock.patch.object(release.subprocess, "run") as run,
            mock.patch.object(release, "version"),
            mock.patch.object(release, "require_version"),
            mock.patch.object(release.sys, "stdout", io.StringIO()),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.root / "local")}),
        ):
            release.check(self.environment.interpreter(), PINS)
        return run.call_args_list

    def test_check_runs_each_python_stage_from_the_interpreters_environment(self) -> None:
        calls = self.checked_commands(self.root / "checkout")
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
        checkout = self.root / "checkout"
        calls = self.checked_commands(checkout)

        stages = [(call.args[0], call.kwargs["cwd"]) for call in calls]
        npm = [(command[1:], cwd) for command, cwd in stages if command[0] == release.NPM]
        self.assertEqual(
            [
                (("ci",), checkout / "web"),
                (("ci",), checkout / "desktop"),
                (("test",), checkout / "web"),
                (("run", "typecheck"), checkout / "web"),
                (("run", "build"), checkout / "web"),
                (("test",), checkout / "desktop"),
            ],
            npm,
        )
        # Ahead of the Python stages too: a release once ran 1102 s and then failed here.
        self.assertEqual([release.NPM, release.NPM], [command[0] for command, _ in stages[:2]])

    def test_check_compares_prices_right_after_the_installs(self) -> None:
        # A price source that cannot be reached is a network failure like a registry's,
        # so it is met before the suite rather than after it.
        checkout = self.root / "checkout"
        third = self.checked_commands(checkout)[2]
        command, cwd = third.args[0], third.kwargs["cwd"]
        self.assertEqual(
            (str(self.environment.executable), str(checkout / "windows" / "release.py"), "prices"),
            command,
        )
        self.assertEqual(checkout, cwd)

    def test_a_failed_install_stops_the_check_before_any_other_stage(self) -> None:
        failure = release.subprocess.CalledProcessError(1, "npm ci")
        checkout = self.root / "checkout"
        with (
            mock.patch.object(release, "ROOT", checkout),
            mock.patch.object(release.subprocess, "run", side_effect=failure) as run,
            mock.patch.object(release, "version"),
            mock.patch.object(release, "require_version"),
            mock.patch.object(release.sys, "stdout", io.StringIO()),
            self.assertRaises(release.subprocess.CalledProcessError),
        ):
            release.check(self.environment.interpreter(), PINS)
        run.assert_called_once()

    def test_check_refuses_modules_linked_from_elsewhere_before_any_stage_runs(self) -> None:
        # `npm ci` through the link would empty the other checkout's modules.
        checkout = self.root / "worktree"
        for package in ("web", "desktop"):
            with self.subTest(package=package):
                shared = self.root / "main" / package / "node_modules"
                shared.mkdir(parents=True)
                (shared / "dependency").mkdir()
                (checkout / package).mkdir(parents=True)
                link_directory(checkout / package / "node_modules", shared)
                with (
                    mock.patch.object(release, "ROOT", checkout),
                    mock.patch.object(release.subprocess, "run") as run,
                    self.assertRaises(release.ToolchainError) as refused,
                ):
                    release.check(self.environment.interpreter(), PINS)
                run.assert_not_called()
                self.assertIn(str(checkout / package / "node_modules"), str(refused.exception))
                self.assertIn(str(shared.resolve()), str(refused.exception))
                self.assertIn("Remove the link", str(refused.exception))
                self.assertTrue((shared / "dependency").is_dir())
                (checkout / package / "node_modules").unlink()

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


if __name__ == "__main__":
    unittest.main()
