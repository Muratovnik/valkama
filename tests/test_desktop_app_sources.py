"""Whether the installed desktop app packs the desktop sources of the pinned release.

`launcher install` publishes the server and the web build and leaves the window as it
was, and the window's version stays the same while its sources change, so an app built
from an old commit looks current. These cases build an app archive and a release tree
from made-up files and hold the reading, `launcher status` and `doctor` to what an
owner needs: the same sources read as current, any other bytes as a warning naming the
reinstall, no app as nothing to fix, and a damaged archive as a warning, never a crash.

The archives are written here from the asar layout itself -- a four-byte size of the
next field, the header's size, then the header as a length-prefixed JSON string, then
the files' bytes at the offsets that header gives -- rather than by the reader.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import re
import struct
import tempfile
import unittest
from unittest import mock

from server import cli, launcher
from server.ops import desktop_app, doctor

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: A made-up desktop app: the build configuration names what it packs.
SOURCE_MANIFEST = {
    "name": "example-desktop",
    "version": "1.0.0",
    "private": True,
    "main": "main.js",
    "scripts": {"dist": "electron-builder"},
    "devDependencies": {"electron": "^1.0.0"},
    "build": {"files": ["main.js", "pages/*.js", "package.json"]},
}
SOURCES = {
    "main.js": b"require('./pages/start.js')\n",
    "pages/start.js": b"module.exports = 'first launch'\n",
    "main.test.js": b"// a test the build leaves out\n",
}


def packed_manifest(manifest: dict) -> bytes:
    """`package.json` as electron-builder packs it: build keys dropped, its own layout."""

    kept = {
        key: value
        for key, value in manifest.items()
        if key not in {"scripts", "devDependencies", "build"}
    }
    return json.dumps(kept, indent=2).encode("utf-8")


def asar(files: dict[str, bytes], *, unpacked: frozenset[str] | set[str] = frozenset()) -> bytes:
    """An asar archive holding `files`, by their `/`-separated paths.

    A path in `unpacked` is only marked, as the build marks a file it leaves beside the
    archive; its bytes are not in this one.
    """

    tree: dict = {"files": {}}
    body = b""
    for path, content in files.items():
        node = tree
        *folders, name = path.split("/")
        for folder in folders:
            node = node["files"].setdefault(folder, {"files": {}})
        if path in unpacked:
            node["files"][name] = {"size": len(content), "unpacked": True}
            continue
        node["files"][name] = {"size": len(content), "offset": str(len(body))}
        body += content
    text = json.dumps(tree).encode("utf-8")
    padded = text + b"\0" * (-len(text) % 4)
    header = struct.pack("<2I", 4 + len(padded), len(text)) + padded
    return struct.pack("<2I", 4, len(header)) + header + body


def packed_files(sources: dict[str, bytes], manifest: dict) -> dict[str, bytes]:
    """What the build would pack from `sources`: everything but the test, and the manifest."""

    files = {path: content for path, content in sources.items() if ".test." not in path}
    return {**files, "package.json": packed_manifest(manifest)}


class Machine:
    """A made-up `%LOCALAPPDATA%` with an installed app and one release."""

    def __init__(self, root: pathlib.Path) -> None:
        self.local = root / "local"
        self.app = self.local / "Programs" / "valkama-desktop" / "Valkama.exe"
        self.archive = self.app.parent / "resources" / "app.asar"
        self.release = self.local / "Valkama" / "releases" / ("ab" * 20)

    def write_release(self, sources: dict[str, bytes], manifest: dict) -> None:
        desktop = self.release / "desktop"
        for path, content in {
            **sources,
            "package.json": json.dumps(manifest).encode("utf-8"),
        }.items():
            (desktop / path).parent.mkdir(parents=True, exist_ok=True)
            (desktop / path).write_bytes(content)

    def install_app(self, archive: bytes) -> None:
        self.archive.parent.mkdir(parents=True, exist_ok=True)
        self.app.write_bytes(b"MZ")
        self.archive.write_bytes(archive)


class PackedSourcesTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.machine = Machine(pathlib.Path(directory.name))
        self.machine.write_release(SOURCES, SOURCE_MANIFEST)
        for patch in (
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.machine.local)}),
            mock.patch.object(desktop_app.sys, "platform", "win32"),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def read(self) -> dict:
        return desktop_app.packed_sources(self.machine.release)

    def test_an_app_built_from_the_release_is_current(self) -> None:
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST)))
        reading = self.read()
        self.assertEqual("current", reading["state"], reading)
        self.assertEqual(str(self.machine.app), reading["app"])
        self.assertNotIn("fix", reading)

    def test_one_changed_file_is_named_with_the_reinstall(self) -> None:
        older = {**SOURCES, "pages/start.js": b"module.exports = 'no skeleton yet'\n"}
        self.machine.install_app(asar(packed_files(older, SOURCE_MANIFEST)))
        reading = self.read()
        self.assertEqual("differs", reading["state"])
        self.assertEqual(["pages/start.js"], reading["differs"])
        self.assertIn("windows/install-desktop.ps1 -Build", reading["fix"])
        self.assertIn("Valkama-Setup-<version>.exe", reading["fix"])

    def test_a_file_on_one_side_only_is_a_difference(self) -> None:
        cases = {
            "a file the release added": (
                {"main.js": SOURCES["main.js"]},
                ["pages/start.js"],
            ),
            "a file the release removed": (
                {**SOURCES, "pages/gone.js": b"module.exports = 0\n"},
                ["pages/gone.js"],
            ),
        }
        for case, (built_from, differs) in cases.items():
            with self.subTest(case):
                self.machine.install_app(asar(packed_files(built_from, SOURCE_MANIFEST)))
                reading = self.read()
                self.assertEqual(("differs", differs), (reading["state"], reading["differs"]))

    def test_the_manifest_counts_without_the_keys_the_build_drops(self) -> None:
        # The build rewrites package.json, so its bytes never match; what it keeps does.
        bumped = {**SOURCE_MANIFEST, "version": "0.9.0"}
        self.machine.install_app(asar(packed_files(SOURCES, bumped)))
        self.assertEqual(["package.json"], self.read()["differs"])
        rescripted = {**SOURCE_MANIFEST, "scripts": {"dist": "something else"}}
        self.machine.install_app(asar(packed_files(SOURCES, rescripted)))
        self.assertEqual("current", self.read()["state"])

    def test_no_app_no_release_and_another_platform_are_not_faults(self) -> None:
        self.assertEqual({"state": "absent"}, self.read())
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST)))
        reading = desktop_app.packed_sources(None)
        self.assertEqual("no-release", reading["state"])
        self.assertIn("launcher install", reading["fix"])
        with mock.patch.object(desktop_app.sys, "platform", "linux"):
            self.assertEqual({"state": "unsupported"}, self.read())

    def test_a_damaged_archive_is_a_warning_rather_than_a_crash(self) -> None:
        whole = asar(packed_files(SOURCES, SOURCE_MANIFEST))
        cases = {
            "empty": b"",
            "not an archive": b"PK\x03\x04" + b"\0" * 40,
            "cut short": whole[:-5],
            "a header that is not JSON": whole[:16] + b"!" + whole[17:],
            "an entry that climbs out": asar({"../main.js": b"x"}),
            "an entry named from a drive": asar({"C:main.js": b"x"}),
        }
        for case, archive in cases.items():
            with self.subTest(case):
                self.machine.install_app(archive)
                reading = self.read()
                self.assertEqual("unreadable", reading["state"], reading)
                self.assertIn("app.asar", reading["detail"])
                self.assertIn("install-desktop.ps1", reading["fix"])
        with self.subTest("an archive that cannot be opened"):
            self.machine.archive.unlink()
            self.machine.archive.mkdir()
            self.assertEqual("unreadable", self.read()["state"])

    def test_a_file_kept_outside_the_archive_is_read_beside_it(self) -> None:
        # electron-builder's asarUnpack leaves a file in `app.asar.unpacked` and marks it.
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST), unpacked={"main.js"}))
        outside = self.machine.archive.with_name("app.asar.unpacked") / "main.js"
        outside.parent.mkdir()
        outside.write_bytes(SOURCES["main.js"])
        self.assertEqual("current", self.read()["state"])
        outside.write_bytes(b"// another build\n")
        self.assertEqual(["main.js"], self.read()["differs"])

    def test_a_release_without_a_build_configuration_cannot_be_compared(self) -> None:
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST)))
        (self.machine.release / "desktop" / "package.json").write_text("{}", encoding="utf-8")
        reading = self.read()
        self.assertEqual("unreadable", reading["state"])
        self.assertIn("release", reading["detail"])


class WhereTheOwnerSeesItTests(unittest.TestCase):
    """`launcher status` carries the reading for the pinned release, and `doctor` words it."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.machine = Machine(pathlib.Path(directory.name))
        self.machine.write_release(SOURCES, SOURCE_MANIFEST)
        pinned = {
            "state": "installed",
            "source_available": True,
            "source_script": str(self.machine.release / "valkama.py"),
        }
        for patch in (
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.machine.local)}),
            mock.patch.object(desktop_app.sys, "platform", "win32"),
            mock.patch.object(launcher, "status", return_value=pinned),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def line(self) -> dict:
        [check] = doctor._desktop_app_check()
        return check

    def test_launcher_status_reads_the_pinned_release(self) -> None:
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST)))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(["launcher", "status"])
        printed = json.loads(output.getvalue())
        self.assertEqual("current", printed["desktop_app"]["state"])
        self.assertEqual(str(self.machine.release), printed["desktop_app"]["release"])

    def test_an_unpinned_launcher_compares_with_nothing(self) -> None:
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST)))
        with mock.patch.object(launcher, "status", return_value={"state": "missing"}):
            self.assertEqual("no-release", launcher.report()["desktop_app"]["state"])
            check = self.line()
        self.assertEqual(
            ("unknown", "desktop-app-no-release"), (check["status"], check["presentation"]["code"])
        )

    def test_doctor_says_ok_for_the_same_sources_and_warns_with_the_fix_for_others(self) -> None:
        self.machine.install_app(asar(packed_files(SOURCES, SOURCE_MANIFEST)))
        check = self.line()
        self.assertEqual(
            ("ok", "desktop-app-current"), (check["status"], check["presentation"]["code"])
        )
        self.assertEqual("ab" * 6, check["presentation"]["parameters"]["revision"])
        older = {**SOURCES, "main.js": b"// older\n"}
        self.machine.install_app(asar(packed_files(older, SOURCE_MANIFEST)))
        check = self.line()
        self.assertEqual(
            ("warn", "desktop-app-differs"), (check["status"], check["presentation"]["code"])
        )
        self.assertIn("main.js", check["detail"])
        self.assertIn("windows/install-desktop.ps1 -Build", check["fix"])
        self.assertEqual(1, check["presentation"]["parameters"]["count"])

    def test_doctor_names_a_damaged_archive_and_says_nothing_without_an_app(self) -> None:
        self.machine.install_app(b"not an archive")
        check = self.line()
        self.assertEqual(
            ("warn", "desktop-app-unreadable"), (check["status"], check["presentation"]["code"])
        )
        self.assertTrue(check["fix"])
        self.machine.app.unlink()
        check = self.line()
        self.assertEqual(
            ("ok", "desktop-app-absent"), (check["status"], check["presentation"]["code"])
        )
        with mock.patch.object(desktop_app.sys, "platform", "linux"):
            self.assertEqual([], doctor._desktop_app_check())

    def test_the_line_is_one_of_the_installation_checks(self) -> None:
        with (
            mock.patch.object(doctor, "_autostart_check", return_value=[]),
            mock.patch.object(doctor, "_alerts_check", return_value=[]),
        ):
            checks = doctor._runtime_checks(8642, probe=False)
        self.assertIn("desktop-app", [check["id"] for check in checks])

    def test_each_line_has_words_in_both_languages_and_they_match_the_parameters(self) -> None:
        codes = {
            "desktop-app-absent": (),
            "desktop-app-current": ("{revision}",),
            "desktop-app-differs": ("{revision}", "{count}"),
            "desktop-app-unreadable": ("{revision}",),
            "desktop-app-no-release": (),
        }
        i18n = ROOT / "web/src/shared/i18n"
        source = (i18n / "doctorDesktopMessages.ts").read_text(encoding="utf-8")
        english, _ru, russian = source.partition("\n  ru: {\n")
        self.assertTrue(russian, "the module has a Russian half")
        for language, half in (("en", english), ("ru", russian)):
            locale = (i18n / f"locales/{language}.ts").read_text(encoding="utf-8")
            self.assertIn(f"...doctorDesktopMessages.{language},", locale)
            for code, parameters in codes.items():
                with self.subTest(language=language, code=code):
                    found = re.search(rf"'{code}': \{{(.*?)\}},\n", half, flags=re.DOTALL)
                    assert found is not None, code
                    for parameter in parameters:
                        self.assertIn(parameter, found.group(1))
                    if code == "desktop-app-differs":
                        self.assertIn("windows/install-desktop.ps1 -Build", found.group(1))


if __name__ == "__main__":
    unittest.main()
