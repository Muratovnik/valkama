"""What the toast executor owes: the right command line, silence when switched off, a real helper.

`ops.toast` hands a finished toast to a C# helper compiled on first use from
`windows/toast.cs`. These tests never show or remove a toast. The command line
is checked with the process start replaced; the helper itself is compiled into a
temporary directory and driven through `--print-plan`, which decodes and loads
everything a real run does and reports it instead of acting. `check` is the one
real call: it only reads whether Windows would show Valkama's toasts.

What is held: under `VALKAMA_NO_ALERTS` or off Windows nothing is compiled or
started; the payload travels as base64 JSON and decodes back to exactly the
message; the helper carries the identity, tag, group, expiry and click target
it was given and refuses input it cannot read; and the files the release must
carry exist where the module looks for them.
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from server import processes
from server.alerts import messages
from server.ops import toast

EXECUTABLE = os.path.join("C:\\", "cache", "valkama-toast.exe")
SETTINGS = {"enabled": True, "content": "prompt", "locale": "ru"}


def message(**fields: object) -> messages.Message:
    values: dict = {
        "reference": "MAIN-12",
        "title": "Порядок & <выкатки>",
        "settings": SETTINGS,
        "prompt": "Какой порядок?",
        "expires_at": "2099-01-01T09:30:00Z",
        "logo": "file:///C:/Valkama/windows/valkama.ico",
    }
    values.update(fields)
    return messages.build("question", **values)


def decoded(argument: str) -> dict:
    return json.loads(base64.b64decode(argument, validate=True).decode("utf-8"))


def refuse(*_: object, **__: object) -> None:
    raise AssertionError("nothing may be compiled or started here")


class ExecutorTestCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.log = self.root / "valkama-alerts.log"
        for patch in (
            mock.patch.object(toast, "log_path", return_value=str(self.log)),
            mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.root / "local")}),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        os.environ.pop(toast.SWITCH, None)

    def on_windows(self) -> None:
        patch = mock.patch.object(toast.sys, "platform", "win32")
        patch.start()
        self.addCleanup(patch.stop)


class SwitchTests(ExecutorTestCase):
    def assert_nothing_runs(self) -> None:
        with (
            mock.patch.object(toast, "helper", side_effect=refuse),
            mock.patch.object(processes, "start_detached", side_effect=refuse),
            mock.patch.object(processes, "run_text", side_effect=refuse),
        ):
            self.assertFalse(toast.show(message()))
            self.assertFalse(toast.remove("MAIN-12", "valkama"))
            self.state = toast.check()

    def test_the_switch_starts_nothing(self) -> None:
        self.on_windows()
        with mock.patch.dict(os.environ, {toast.SWITCH: "1"}):
            self.assertFalse(toast.active())
            self.assert_nothing_runs()
        self.assertEqual("switched-off", self.state["state"])
        self.assertIsNone(self.state["setting"])

    def test_off_windows_nothing_starts(self) -> None:
        with mock.patch.object(toast.sys, "platform", "linux"):
            self.assertFalse(toast.active())
            self.assert_nothing_runs()
        self.assertEqual("unsupported", self.state["state"])


class CommandLineTests(ExecutorTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.on_windows()
        patch = mock.patch.object(toast, "helper", return_value=EXECUTABLE)
        patch.start()
        self.addCleanup(patch.stop)

    def started(self, action) -> tuple[list[str], dict]:
        with mock.patch.object(processes, "start_detached", return_value=4242) as start:
            self.assertTrue(action())
        [(argv,), keywords] = start.call_args
        return argv, keywords

    def test_show_starts_the_helper_detached_with_the_message_as_base64(self) -> None:
        shown = message()
        argv, keywords = self.started(lambda: toast.show({**shown, "extra": "dropped"}))
        self.assertEqual([EXECUTABLE, "show"], argv[:2])
        self.assertEqual(3, len(argv))
        # Only the base64 alphabet reaches the command line, whatever the title says.
        self.assertRegex(argv[2], r"^[A-Za-z0-9+/]+=*$")
        self.assertEqual(dict(shown), decoded(argv[2]))
        self.assertEqual({"cwd": os.path.dirname(EXECUTABLE)}, keywords)

    def test_remove_names_valkama_and_the_item(self) -> None:
        argv, _ = self.started(lambda: toast.remove("MAIN-12", "valkama"))
        self.assertEqual([EXECUTABLE, "remove"], argv[:2])
        self.assertEqual(
            {"aumid": "local.valkama", "tag": "MAIN-12", "group": "valkama"}, decoded(argv[2])
        )

    def test_the_plan_switch_is_the_last_argument(self) -> None:
        argv = toast.command(EXECUTABLE, "check", {"aumid": toast.AUMID}, plan=True)
        self.assertEqual([EXECUTABLE, "check"], argv[:2])
        self.assertEqual("--print-plan", argv[3])

    def test_a_helper_that_cannot_be_built_or_started_is_a_log_line(self) -> None:
        with mock.patch.object(toast, "helper", side_effect=toast.HelperUnavailableError("no csc")):
            self.assertFalse(toast.show(message()))
        with mock.patch.object(processes, "start_detached", side_effect=OSError("denied")):
            self.assertFalse(toast.remove("MAIN-12", "valkama"))
        lines = self.log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(2, len(lines))
        self.assertRegex(
            lines[0], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ server show MAIN-12 .*no csc$"
        )
        self.assertIn("remove MAIN-12 not started: denied", lines[1])

    def test_check_waits_at_most_five_seconds_and_reads_the_setting(self) -> None:
        answer = processes.TextResult(0, '{"op":"check","aumid":"local.valkama","setting":1}', "")
        with mock.patch.object(processes, "run_text", return_value=answer) as run:
            self.assertEqual(
                {"state": "disabled-for-application", "setting": 1, "reason": None}, toast.check()
            )
        [(argv,), keywords] = run.call_args
        self.assertEqual({"aumid": "local.valkama"}, decoded(argv[2]))
        self.assertEqual([EXECUTABLE, "check"], argv[:2])
        self.assertEqual({"timeout": 5.0}, keywords)

    def test_check_names_why_windows_did_not_answer(self) -> None:
        cases = {
            "timeout": subprocess.TimeoutExpired("helper", 5),
            "refusal": processes.TextResult(3, '{"error":"COMException: element not found"}', ""),
            "garbage": processes.TextResult(0, "not json", ""),
            "a boolean": processes.TextResult(0, '{"setting": true}', ""),
        }
        for name, outcome in cases.items():
            with self.subTest(name):
                effect = (
                    {"side_effect": outcome} if name == "timeout" else {"return_value": outcome}
                )
                with mock.patch.object(processes, "run_text", **effect):
                    state = toast.check()
                self.assertEqual("failed", state["state"])
                self.assertIsNone(state["setting"])
                self.assertTrue(state["reason"])
        with mock.patch.object(processes, "run_text", return_value=cases["refusal"]):
            self.assertIn("element not found", toast.check()["reason"] or "")

    def test_check_reports_a_helper_that_cannot_be_built(self) -> None:
        with mock.patch.object(toast, "helper", side_effect=toast.HelperUnavailableError("no csc")):
            self.assertEqual(
                {"state": "unavailable", "setting": None, "reason": "no csc"}, toast.check()
            )


class HelperBuildTests(ExecutorTestCase):
    """Where the helper is built and when it is not built again, without a compiler."""

    def test_the_built_helper_is_reused_without_compiling(self) -> None:
        source = Path(toast.assets()[0]).read_bytes()
        import hashlib

        directory = self.root / "local" / "Valkama" / "toast"
        built = directory / hashlib.sha256(source).hexdigest()[:16] / "valkama-toast.exe"
        built.parent.mkdir(parents=True)
        built.write_bytes(b"MZ")
        with mock.patch.object(processes, "run_text", side_effect=refuse):
            self.assertEqual(str(built), toast.helper())

    def test_a_compiler_failure_leaves_no_helper_and_says_why(self) -> None:
        failed = processes.TextResult(1, "toast.cs(1,1): error CS1002: ; expected", "")
        with (
            mock.patch.object(toast, "_framework", return_value=(self.root, self.root)),
            mock.patch.object(processes, "run_text", return_value=failed),
            self.assertRaisesRegex(toast.HelperUnavailableError, "CS1002"),
        ):
            toast.helper()
        self.assertEqual([], list((self.root / "local").rglob("*.exe")))

    def test_without_a_profile_directory_there_is_nowhere_to_build(self) -> None:
        with (
            mock.patch.dict(os.environ, {"LOCALAPPDATA": ""}),
            self.assertRaises(toast.HelperUnavailableError),
        ):
            toast.helper()

    def test_the_compiler_is_given_every_reference_and_utf8_output(self) -> None:
        framework, metadata = Path("F"), Path("M")
        argv = toast.compile_command("toast.cs", "out.exe", framework, metadata)
        self.assertEqual(str(framework / "csc.exe"), argv[0])
        self.assertEqual("toast.cs", argv[-1])
        for flag in ("/nologo", "/utf8output", "/target:exe", "/out:out.exe"):
            self.assertIn(flag, argv)
        references = {item.removeprefix("/r:") for item in argv if item.startswith("/r:")}
        self.assertEqual(
            {
                str(metadata / "Windows.Data.winmd"),
                str(metadata / "Windows.Foundation.winmd"),
                str(metadata / "Windows.UI.winmd"),
                str(framework / "System.Runtime.dll"),
                str(framework / "System.Runtime.WindowsRuntime.dll"),
                str(framework / "System.Runtime.InteropServices.WindowsRuntime.dll"),
            },
            references,
        )


class ToastAssetTests(unittest.TestCase):
    """The helper source and the logo must exist where the release carries them.

    A release is a copy of the committed tree, and a missing source would only
    show as alerts that never arrive, the way the tray once lost its script.
    """

    def test_the_helper_source_and_logo_resolve_to_files_that_exist(self) -> None:
        source, icon = toast.assets()
        for path in (source, icon):
            self.assertTrue(os.path.isfile(path), f"toast asset is missing: {path}")
        self.assertEqual(("windows", "toast.cs"), Path(source).parts[-2:])

    def test_the_logo_is_a_file_uri_of_the_shipped_icon(self) -> None:
        uri = toast.logo_uri()
        assert uri is not None
        self.assertRegex(uri, r"^file:///.+/windows/valkama\.ico$")
        self.assertIsNone(toast.logo_uri(root=tempfile.gettempdir()))


def _compiler_present() -> bool:
    if sys.platform != "win32":
        return False
    try:
        toast._framework()
    except toast.HelperUnavailableError:
        return False
    return True


@unittest.skipUnless(_compiler_present(), "the helper is compiled with .NET Framework 4 on Windows")
class HelperDryRunTests(unittest.TestCase):
    """The real helper, compiled once for the class and driven only through `--print-plan`."""

    @classmethod
    def setUpClass(cls) -> None:
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        patch = mock.patch.dict(os.environ, {"LOCALAPPDATA": directory.name})
        patch.start()
        cls.addClassCleanup(patch.stop)
        # Nothing in this class shows or removes a toast: `check` only reads an answer.
        os.environ.pop(toast.SWITCH, None)
        log = mock.patch.object(toast, "log_path", return_value=str(Path(directory.name) / "log"))
        log.start()
        cls.addClassCleanup(log.stop)
        cls.executable = toast.helper()

    def run_helper(self, argv: list[str]) -> tuple[int, dict]:
        done = processes.run_text(argv, timeout=30)
        self.assertEqual("", done.stderr)
        return done.returncode, json.loads(done.stdout)

    def plan(self, op: str, payload: dict) -> dict:
        code, answer = self.run_helper(toast.command(self.executable, op, payload, plan=True))
        self.assertEqual(0, code, answer)
        return answer

    def test_show_carries_identity_tag_group_expiry_and_click(self) -> None:
        shown = message()
        self.assertEqual(
            {
                "op": "show",
                "aumid": "local.valkama",
                "tag": "MAIN-12",
                "group": "valkama",
                "expires_at": "2099-01-01T09:30:00Z",
                "expired": False,
                "launch": "valkama://open/MAIN-12?reveal=question",
                "activation": "protocol",
                "texts": [
                    "Valkama: нужен ваш ответ",
                    "MAIN-12 · Порядок & <выкатки>",
                    "Какой порядок?",
                ],
                "logo": "file:///C:/Valkama/windows/valkama.ico",
                "shown": False,
            },
            self.plan("show", dict(shown)),
        )

    def test_an_expiry_already_past_is_not_shown_and_none_is_carried_as_none(self) -> None:
        past = self.plan("show", dict(message(expires_at="2001-01-01T00:00:00Z")))
        self.assertEqual((True, None), (past["expired"], past["expires_at"]))
        self.assertIsNone(self.plan("show", dict(message(expires_at=None)))["expires_at"])

    def test_remove_and_check_plans_name_valkama(self) -> None:
        self.assertEqual(
            {"op": "remove", "aumid": "local.valkama", "tag": "MAIN-12", "group": "valkama"},
            self.plan("remove", {"aumid": toast.AUMID, "tag": "MAIN-12", "group": "valkama"}),
        )
        self.assertEqual(
            {"op": "check", "aumid": "local.valkama"}, self.plan("check", {"aumid": toast.AUMID})
        )

    def test_input_it_cannot_read_is_refused(self) -> None:
        good = dict(message())
        encoded = toast.command(self.executable, "show", good)[2]
        cases = {
            "not base64": [self.executable, "show", "%%%", "--print-plan"],
            "not JSON": [
                self.executable,
                "show",
                base64.b64encode(b"[1]").decode(),
                "--print-plan",
            ],
            "no tag": toast.command(self.executable, "show", {**good, "tag": None}, plan=True),
            "markup that does not load": toast.command(
                self.executable, "show", {**good, "xml": "<toast>"}, plan=True
            ),
            "an expiry in another shape": toast.command(
                self.executable, "show", {**good, "expires_at": "2099-01-01"}, plan=True
            ),
            "an unknown operation": [self.executable, "update", encoded, "--print-plan"],
            "a stray argument": [self.executable, "show", encoded, "--force"],
            "no payload": [self.executable, "show"],
        }
        for name, argv in cases.items():
            with self.subTest(name):
                code, answer = self.run_helper(argv)
                self.assertEqual(2, code, answer)
                self.assertEqual(["error"], list(answer))

    def test_a_second_request_reuses_the_build(self) -> None:
        with mock.patch.object(processes, "run_text", side_effect=refuse):
            self.assertEqual(self.executable, toast.helper())

    def test_check_answers_windows_setting_in_time(self) -> None:
        started = time.monotonic()
        state = toast.check()
        self.assertLess(time.monotonic() - started, toast.CHECK_TIMEOUT + 1)
        if state["setting"] is None:
            self.assertEqual("failed", state["state"])
            self.assertTrue(state["reason"])
        else:
            self.assertEqual(toast.SETTINGS[state["setting"]], state["state"])
            self.assertIsNone(state["reason"])
        self.assertTrue(re.fullmatch(r"[a-z-]+", state["state"]))


if __name__ == "__main__":
    unittest.main()
