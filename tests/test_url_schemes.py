"""Who handles a scheme and what each link looks like, against a stand-in registry.

The registry shapes are the three a machine really has: an installer's key with a
command, an MSIX package's key with only the `URL Protocol` label, and the key an
uninstalled editor left behind, whose command names a program that is gone.
"""

from __future__ import annotations

import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from server.ops import url_schemes


class _Key:
    def __init__(self, path: str) -> None:
        self.path = path

    def __enter__(self) -> _Key:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def registry(keys: dict[str, dict[str, str]]) -> types.SimpleNamespace:
    """A stand-in `winreg` holding one hive, the merged one a scheme is resolved through."""

    hive = object()

    def open_key(root: object, path: str) -> _Key:
        if root is not hive or path not in keys:
            raise FileNotFoundError(path)
        return _Key(path)

    def query(key: _Key, name: str) -> tuple[str, int]:
        values = keys[key.path]
        if name not in values:
            raise FileNotFoundError(name)
        return values[name], 1

    return types.SimpleNamespace(HKEY_CLASSES_ROOT=hive, OpenKey=open_key, QueryValueEx=query)


class WhoHandlesASchemeTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.program = self.root / "Program Files" / "Editor.exe"
        self.program.parent.mkdir()
        self.program.write_bytes(b"")

    def schemes(self, keys: dict[str, dict[str, str]]) -> frozenset[str]:
        with mock.patch.object(url_schemes, "_winreg", return_value=registry(keys)):
            return url_schemes.registered_schemes()

    def test_an_installer_key_with_its_program_counts(self) -> None:
        keys = {
            "vscode": {"URL Protocol": ""},
            r"vscode\shell\open\command": {"": f'"{self.program}" --open-url -- "%1"'},
        }
        self.assertEqual(frozenset({"vscode"}), self.schemes(keys))

    def test_a_package_key_with_only_the_label_counts(self) -> None:
        self.assertEqual(frozenset({"claude"}), self.schemes({"claude": {"URL Protocol": ""}}))

    def test_a_key_an_uninstalled_editor_left_behind_does_not_count(self) -> None:
        keys = {
            "cursor": {"URL Protocol": ""},
            r"cursor\shell\open\command": {"": f'"{self.root / "gone" / "Cursor.exe"}" "%1"'},
        }
        self.assertEqual(frozenset(), self.schemes(keys))

    def test_a_key_without_the_label_is_no_url_scheme(self) -> None:
        keys = {"codex": {}, r"codex\shell\open\command": {"": f'"{self.program}" "%1"'}}
        self.assertEqual(frozenset(), self.schemes(keys))

    def test_a_scheme_nothing_registered_does_not_count(self) -> None:
        self.assertEqual(frozenset(), self.schemes({}))

    def test_a_key_outside_the_closed_list_is_never_asked_for(self) -> None:
        self.assertEqual(frozenset(), self.schemes({"http": {"URL Protocol": ""}}))

    def test_off_windows_nothing_says_a_scheme_is_missing(self) -> None:
        with mock.patch.object(url_schemes, "_winreg", return_value=None):
            self.assertEqual(frozenset(url_schemes.SCHEMES), url_schemes.registered_schemes())

    def test_the_real_module_is_found_or_reported_absent(self) -> None:
        with mock.patch.object(url_schemes.importlib, "import_module", side_effect=ImportError):
            self.assertIsNone(url_schemes._winreg())


class ReadingACommandTests(unittest.TestCase):
    def test_the_program_is_read_however_the_command_is_written(self) -> None:
        for command, expected in (
            (r'"C:\Program Files\x\Code.exe" --open-url "%1"', r"C:\Program Files\x\Code.exe"),
            (r"C:\Program Files\x\Code.exe --open-url %1", r"C:\Program Files\x\Code.exe"),
            (r"C:\tools\run.exe", r"C:\tools\run.exe"),
            ("rundll32 url.dll,FileProtocolHandler %1", "rundll32"),
            ("", ""),
        ):
            with self.subTest(command=command):
                self.assertEqual(expected, url_schemes.command_executable(command))

    def test_a_variable_in_the_command_is_expanded(self) -> None:
        with mock.patch.dict(os.environ, {"EDITOR_HOME": "somewhere"}):
            found = url_schemes.command_executable(os.path.join("$EDITOR_HOME", "Code.exe") + " %1")
        self.assertTrue(found.startswith("somewhere"))

    def test_a_program_named_without_a_folder_is_looked_for_on_the_path(self) -> None:
        with mock.patch.object(url_schemes.shutil, "which", return_value="found") as which:
            self.assertTrue(url_schemes._exists("rundll32"))
        which.assert_called_once_with("rundll32")


class ExtensionsAndTerminalTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name).resolve()

    def test_an_extension_counts_in_the_editor_whose_folder_holds_it(self) -> None:
        (self.home / ".cursor" / "extensions" / "Anthropic.claude-code-2.1.3").mkdir(parents=True)
        (self.home / ".vscode" / "extensions" / "openai.chatgpt-26.1").mkdir(parents=True)
        (self.home / ".vscode-insiders" / "extensions" / "other.thing-1.0").mkdir(parents=True)
        self.assertEqual(
            frozenset(
                {
                    ("cursor", url_schemes.CLAUDE_EXTENSION),
                    ("vscode", url_schemes.CODEX_EXTENSION),
                }
            ),
            url_schemes.installed_extensions(str(self.home)),
        )

    def test_a_name_that_only_begins_the_same_is_another_extension(self) -> None:
        (self.home / ".vscode" / "extensions" / "anthropic.claude-codex-1.0").mkdir(parents=True)
        self.assertEqual(frozenset(), url_schemes.installed_extensions(str(self.home)))

    def test_windows_terminal_is_found_on_the_path_or_where_windows_puts_it(self) -> None:
        alias = self.home / "Microsoft" / "WindowsApps" / "wt.exe"
        with (
            mock.patch.object(url_schemes.shutil, "which", return_value=None),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.home)}),
        ):
            self.assertFalse(url_schemes._terminal_available())
            alias.parent.mkdir(parents=True)
            alias.write_bytes(b"")
            self.assertTrue(url_schemes._terminal_available())
        with mock.patch.object(url_schemes.shutil, "which", return_value="wt.exe"):
            self.assertTrue(url_schemes._terminal_available())

    def test_detect_reads_the_machine_it_is_given(self) -> None:
        (self.home / ".vscode" / "extensions" / "anthropic.claude-code-1").mkdir(parents=True)
        keys = {"vscode": {"URL Protocol": ""}}
        with (
            mock.patch.object(url_schemes, "_winreg", return_value=registry(keys)),
            mock.patch.object(url_schemes.Path, "home", return_value=self.home),
            mock.patch.object(url_schemes.shutil, "which", return_value="wt.exe"),
        ):
            found = url_schemes.detect()
        self.assertEqual(frozenset({"vscode"}), found.schemes)
        self.assertEqual(frozenset({("vscode", url_schemes.CLAUDE_EXTENSION)}), found.extensions)
        self.assertTrue(found.terminal)


class LinkTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()

    def encoded_root(self) -> str:
        return self.root.as_uri().removeprefix("file:///")

    def test_each_route_is_spelled_as_its_client_takes_it(self) -> None:
        self.assertEqual(
            "cursor://anthropic.claude-code/open?session=abc",
            url_schemes.claude_extension_link("cursor", "abc"),
        )
        self.assertEqual(
            "vscode://openai.chatgpt/local/abc", url_schemes.codex_extension_link("vscode", "abc")
        )
        self.assertEqual(
            "claude://code/continue?session=local_1", url_schemes.claude_desktop_link("local_1")
        )
        self.assertEqual("codex://threads/abc", url_schemes.codex_app_link("abc"))

    def test_the_cli_link_carries_the_folder_and_the_typed_resume(self) -> None:
        link = url_schemes.claude_cli_resume_link("C:\\work\\a b", "abc")
        self.assertEqual("claude-cli://open?cwd=C%3A%5Cwork%5Ca%20b&q=%2Fresume%20abc", link)

    def test_a_value_cannot_end_the_part_of_the_link_it_is_in(self) -> None:
        self.assertEqual("codex://threads/a%2Fb%3Fc", url_schemes.codex_app_link("a/b?c"))
        self.assertEqual(
            "vscode://anthropic.claude-code/open?session=a%26b",
            url_schemes.claude_extension_link("vscode", "a&b"),
        )

    def test_a_hash_or_a_question_mark_in_a_path_stays_in_the_path(self) -> None:
        folder = self.root / "a b#c%d"
        self.assertEqual(
            f"vscode://file/{self.encoded_root()}/a%20b%23c%25d",
            url_schemes.folder_link("vscode", str(folder)),
        )

    def test_a_file_link_names_its_line_when_it_has_one(self) -> None:
        path = self.root / "plan.md"
        bare = f"cursor://file/{self.encoded_root()}/plan.md"
        self.assertEqual(bare, url_schemes.file_link("cursor", str(path), None))
        self.assertEqual(f"{bare}:42:1", url_schemes.file_link("cursor", str(path), 42))
