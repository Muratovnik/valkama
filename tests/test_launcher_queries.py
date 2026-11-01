"""The launcher's read-only answers, given before the command line is imported.

Two guarantees. The early answer is the one `cli` gives -- the same bytes, so
the tray and the desktop app cannot tell which path answered -- and the entry
point really does skip `cli` for exactly these command lines, which is the
whole saving. Anything else is left to `cli`, including every error.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import cli, launcher, launcher_queries

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def git(checkout: Path, *arguments: str) -> None:
    subprocess.run(["git", *arguments], cwd=checkout, check=True, capture_output=True)


class LauncherQueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name).resolve()
        checkout = root / "checkout"
        checkout.mkdir()
        git(checkout, "init", "-q")
        git(checkout, "config", "user.email", "queries@test")
        git(checkout, "config", "user.name", "queries")
        (checkout / "valkama.py").write_text("print('entry')\n", encoding="utf-8")
        git(checkout, "add", "-A")
        git(checkout, "commit", "-qm", "seed")
        self.directory = root / "bin"
        launcher.install(
            self.directory,
            python=sys.executable,
            checkout=checkout,
            releases=root / "releases",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def early(self, argv: list[str]) -> tuple[int | None, str]:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            answered = launcher_queries.main(argv)
        return answered, output.getvalue()

    def full(self, argv: list[str]) -> str:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(argv)
        return output.getvalue()

    def test_runtime_and_launcher_status_print_what_the_command_line_prints(self) -> None:
        directory = str(self.directory)
        for argv in (
            ["runtime"],
            ["launcher", "status", "--directory", directory],
            ["launcher", "status", f"--directory={directory}"],
        ):
            with self.subTest(argv=argv):
                answered, early = self.early(argv)
                self.assertEqual(0, answered)
                self.assertEqual(self.full(argv), early)
                self.assertIsInstance(json.loads(early), dict)

    @unittest.skipUnless(os.name == "nt", "listener ownership is read only on Windows")
    def test_listener_status_prints_what_the_command_line_prints(self) -> None:
        argv = [
            "launcher",
            "listener",
            "status",
            "--port",
            "8765",
            "--directory",
            str(self.directory),
        ]
        with mock.patch.object(launcher, "_windows_listener_processes", return_value=[]):
            answered, early = self.early(argv)
            full = self.full(argv)
        self.assertEqual(0, answered)
        self.assertEqual(full, early)
        self.assertEqual("free", json.loads(early)["state"])

    def test_every_other_command_line_is_left_to_the_full_command_line(self) -> None:
        directory = str(self.directory)
        for argv in (
            [],
            ["runtime", "--verbose"],
            ["launcher"],
            ["launcher", "install", "--directory", directory],
            ["launcher", "status", "--force"],
            ["launcher", "status", "--directory"],
            ["launcher", "status", "--directory", directory, "--directory", directory],
            ["launcher", "listener", "stop", "--directory", directory],
            ["launcher", "listener", "status", "--port", "not-a-port"],
            ["launcher", "listener", "status", "--port", "--directory", directory],
            ["serve", "--port", "8642"],
        ):
            with self.subTest(argv=argv):
                self.assertEqual((None, ""), self.early(argv))

    def test_an_error_is_left_to_the_command_line_that_words_it(self) -> None:
        refusal = launcher.LauncherError("managed launcher ownership is unavailable")
        with mock.patch.object(launcher, "status", side_effect=refusal):
            self.assertEqual((None, ""), self.early(["launcher", "status"]))
        with mock.patch.object(launcher, "listener_status", side_effect=refusal):
            self.assertEqual(
                (None, ""),
                self.early(["launcher", "listener", "status", "--port", "8642"]),
            )
        self.assertEqual(
            (None, ""),
            self.early(["launcher", "listener", "status", "--port", "0"]),
        )


class EntryPointTests(unittest.TestCase):
    def run_entry(self, *argv: str) -> tuple[str, list[str]]:
        """Run `valkama.py` as its own process; what it printed and loaded."""
        script = (
            "import json, runpy, sys\n"
            f"sys.argv = ['valkama.py', *{list(argv)!r}]\n"
            "try:\n"
            "    runpy.run_path('valkama.py', run_name='__main__')\n"
            "except SystemExit:\n"
            "    pass\n"
            "loaded = sorted(m for m in sys.modules if m.startswith('server.'))\n"
            "sys.stderr.write('\\n' + json.dumps(loaded))\n"
        )
        done = subprocess.run(
            [sys.executable, "-X", "utf8", "-c", script],
            cwd=ROOT,
            capture_output=True,
            timeout=120,
            check=True,
        )
        loaded = json.loads(done.stderr.decode("utf-8").rsplit("\n", 1)[-1])
        return done.stdout.decode("utf-8"), loaded

    def test_runtime_is_answered_without_loading_any_surface(self) -> None:
        printed, loaded = self.run_entry("runtime")
        self.assertEqual("runtime", json.loads(printed)["interface_version"])
        for surface in ("server.cli", "server.mcp_surface", "server.http_surface", "server.store"):
            self.assertNotIn(surface, loaded)

    def test_a_command_it_does_not_answer_still_reaches_the_command_line(self) -> None:
        printed, loaded = self.run_entry("capabilities")
        self.assertEqual("valkama", json.loads(printed)["component"])
        self.assertIn("server.cli", loaded)


if __name__ == "__main__":
    unittest.main()
