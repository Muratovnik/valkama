"""The subprocess boundary of the Unicode text and transport contract.

`.agents/rules/subprocess-encoding.md` requires a decode failure to propagate.
Capturing a child's output as text does the opposite: the failure lands in a
reader thread, that thread dies, and the stream comes back as None with the
exit code intact. Nothing raises, so nothing is noticed.

The Windows process-tree kill is where this repository meets that: `taskkill`
writes its diagnostics in the console OEM code page, which is not UTF-8 on a
localized Windows. It runs from one place — `processes.stop_process_tree` — and
reads only the exit code, so it captures bytes and decodes nothing. The guard
counted three call sites when the launch runner, the evaluation sandbox and the
job supervisor each kept their own copy of that kill.
"""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import threading
import unittest
from unittest import mock

from server import processes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SERVER = os.path.join(ROOT, "server")
DECODING_KEYWORDS = ("text", "universal_newlines", "encoding", "errors")
# The first bytes of taskkill's "process not found" message on a Russian
# Windows, in CP866. Written by a child this test controls, because pointing a
# real taskkill at a PID to provoke the message means guessing a PID.
OEM_BYTES = b"\x8e\xe8\xa8\xa1\xaa\xa0: \x8d\xa5 \xe3\xa4\xa0\xa5\xe2\xe1\xef"


def child_process_calls(tree: ast.AST) -> list[ast.Call]:
    """Every `subprocess.run(...)`, `subprocess.Popen(...)`, and lookalike.

    A decoding call does not have to spell `subprocess` at its call site: an
    injectable `runner(...)` parameter can forward the exact same keywords into
    a real `subprocess.run` one frame down, and the attribute check above never
    sees it. `capture_output` is subprocess.run's own keyword-only argument
    name and nothing else in this codebase uses it (checked by grep before
    writing this), so its presence marks the shape even when the callable is a
    local name rather than the `subprocess` module. This is what caught
    `skills/skill_activation.py`'s injected-runner call missing `errors=`.
    """
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        function = node.func
        is_subprocess_attr = (
            isinstance(function, ast.Attribute)
            and function.attr in ("run", "Popen")
            and isinstance(function.value, ast.Name)
            and function.value.id == "subprocess"
        )
        has_capture_output = any(keyword.arg == "capture_output" for keyword in node.keywords)
        if is_subprocess_attr or has_capture_output:
            found.append(node)
    return found


def taskkill_calls(tree: ast.AST) -> list[ast.Call]:
    """Every `subprocess.run(["taskkill", ...], ...)` in one parsed module."""
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        function = node.func
        if not isinstance(function, ast.Attribute) or function.attr != "run":
            continue
        argv = node.args[0]
        if not isinstance(argv, ast.List) or not argv.elts:
            continue
        first = argv.elts[0]
        if isinstance(first, ast.Constant) and first.value == "taskkill":
            found.append(node)
    return found


def subprocess_text_problem(call: ast.Call) -> str | None:
    for keyword in call.keywords:
        if keyword.arg not in DECODING_KEYWORDS:
            continue
        value = keyword.value
        if isinstance(value, ast.Constant) and (
            value.value is None
            or (keyword.arg in ("text", "universal_newlines") and not value.value)
        ):
            continue
        return (
            f"{keyword.arg} enables subprocess decoding; capture bytes and use processes.run_text"
        )
    return None


def output_decode_problem(call: ast.Call) -> str | None:
    for index, name in enumerate(("encoding", "errors")):
        value = (
            call.args[index]
            if len(call.args) > index
            else next((keyword.value for keyword in call.keywords if keyword.arg == name), None)
        )
        if value is None or (isinstance(value, ast.Constant) and not value.value):
            return f"output decode does not name {name}"
    return None


def server_modules():
    """Every server source file, parsed, with the path it came from."""
    for directory, _folders, names in os.walk(SERVER):
        for name in sorted(names):
            if not name.endswith(".py"):
                continue
            path = os.path.join(directory, name)
            with open(path, encoding="utf-8") as handle:
                yield os.path.relpath(path, ROOT), ast.parse(handle.read(), filename=path)


class SourceGuardTests(unittest.TestCase):
    """Keep byte capture and explicit caller decoding at the source boundary."""

    def test_no_server_module_decodes_what_taskkill_writes(self) -> None:
        calls = 0
        for relative, tree in server_modules():
            for call in taskkill_calls(tree):
                calls += 1
                self.assertIsNone(
                    subprocess_text_problem(call),
                    f"{relative}:{call.lineno} decodes taskkill output, which is console OEM text",
                )
        self.assertGreaterEqual(calls, 1, "the guard found no taskkill call to check")

    def test_a_call_that_decodes_names_both_its_codec_and_its_policy(self) -> None:
        calls = 0
        decoded_outputs = 0
        scanned = set()
        for relative, tree in server_modules():
            scanned.add(relative.replace(os.sep, "/"))
            child_calls = child_process_calls(tree)
            for call in child_calls:
                calls += 1
                self.assertIsNone(
                    subprocess_text_problem(call),
                    f"{relative}:{call.lineno}: {subprocess_text_problem(call)}",
                )
            captured = {
                target.id
                for node in ast.walk(tree)
                if isinstance(node, ast.Assign)
                and isinstance(node.value, ast.Call)
                and node.value in child_calls
                for target in node.targets
                if isinstance(target, ast.Name)
            }
            for call in ast.walk(tree):
                if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Attribute):
                    continue
                stream = call.func.value
                if (
                    call.func.attr == "decode"
                    and isinstance(stream, ast.Attribute)
                    and stream.attr in ("stdout", "stderr")
                    and isinstance(stream.value, ast.Name)
                    and stream.value.id in captured
                ):
                    decoded_outputs += 1
                    self.assertIsNone(
                        output_decode_problem(call),
                        f"{relative}:{call.lineno}: {output_decode_problem(call)}",
                    )
        self.assertIn("server/processes.py", scanned, "the subprocess boundary was not scanned")
        self.assertGreater(calls, 0, "the guard found no child process to check")
        self.assertGreater(decoded_outputs, 0, "the guard found no captured-output decode to check")

    def test_the_guard_distinguishes_bytes_from_text_mode_values(self) -> None:
        accepted = (
            "subprocess.run(['x'], capture_output=True)",
            "subprocess.run(['x'], capture_output=True, text=False)",
            "subprocess.Popen(['x'], stdout=subprocess.PIPE, universal_newlines=None)",
            "runner(['x'], capture_output=True, text=None, encoding=None, errors=None)",
        )
        rejected = (
            "subprocess.run(['x'], capture_output=True, text=True)",
            "subprocess.run(['x'], capture_output=True, text=True, encoding='utf-8', errors='strict')",
            "subprocess.run(['x'], capture_output=True, text=False, encoding='utf-8')",
            "subprocess.Popen(['x'], stdout=subprocess.PIPE, universal_newlines=True)",
            "runner(['x'], capture_output=True, encoding=None, errors='strict')",
            "runner(['x'], capture_output=True, text=choose_mode)",
        )
        for source in accepted + rejected:
            with self.subTest(source=source):
                found = child_process_calls(ast.parse(source))
                self.assertEqual(1, len(found))
                self.assertEqual(source in accepted, subprocess_text_problem(found[0]) is None)

    def test_output_decoding_names_codec_and_error_policy(self) -> None:
        accepted = (
            "done.stdout.decode('utf-8', 'strict')",
            "done.stdout.decode('utf-8', errors='replace')",
            "done.stderr.decode(encoding=encoding, errors=errors)",
        )
        rejected = (
            "done.stdout.decode()",
            "done.stdout.decode('utf-8')",
            "done.stderr.decode(errors='strict')",
            "done.stdout.decode(encoding=None, errors='strict')",
        )
        for source in accepted + rejected:
            with self.subTest(source=source):
                call = ast.parse(source).body[0].value
                self.assertEqual(source in accepted, output_decode_problem(call) is None)

    def test_the_guard_catches_a_decoding_call_routed_through_a_callable_parameter(self) -> None:
        """The exact shape `skill_activation._codex_request` had before its fix.

        `runner(...)` is a local parameter, not `subprocess.run`, so the plain
        attribute check above never saw it; only `capture_output` gave it away.
        Parsed here from a synthetic module rather than found live in the tree,
        because a call missing `errors` may not be left in the source to prove
        the point -- this is the assertion that stands in for that.
        """
        tree = ast.parse(
            "def call(runner):\n"
            '    return runner(["x"], text=True, capture_output=True, encoding="utf-8")\n'
        )
        found = child_process_calls(tree)
        self.assertEqual(1, len(found), "a capture_output call through a callable was missed")
        self.assertIsNotNone(subprocess_text_problem(found[0]))


class ChildOutputDecodingTests(unittest.TestCase):
    """What each capture mode does with a child that is not writing UTF-8."""

    def child(self, **kwargs) -> subprocess.CompletedProcess:
        program = f"import sys; sys.stdout.buffer.write({OEM_BYTES!r})"
        return subprocess.run(
            [sys.executable, "-c", program], capture_output=True, **kwargs, check=False
        )

    def test_captured_bytes_arrive_exactly_as_written(self) -> None:
        done = self.child()
        self.assertEqual(0, done.returncode)
        self.assertEqual(OEM_BYTES, done.stdout)

    def test_run_text_honours_the_callers_timeout(self) -> None:
        with self.assertRaises(subprocess.TimeoutExpired):
            processes.run_text(
                [sys.executable, "-c", "import time; time.sleep(10)"],
                encoding="utf-8",
                errors="strict",
                timeout=0.05,
            )

    def test_run_text_writes_the_callers_bytes_to_the_child(self) -> None:
        program = "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())"
        done = processes.run_text(
            [sys.executable, "-c", program],
            encoding="utf-8",
            errors="surrogateescape",
            stdin=OEM_BYTES,
        )
        self.assertEqual(OEM_BYTES, done.stdout.encode("utf-8", "surrogateescape"))

    def test_a_strict_text_capture_loses_the_stream_without_raising(self) -> None:
        # The reason the three call sites take bytes. The exit code survives, so
        # a caller reading only that keeps working while the output disappears;
        # a caller reading the text gets None where it expects a string.
        #
        # The thread hook is replaced rather than left alone because this call
        # deliberately produces the failure, and the traceback it prints is the
        # subject of this file rather than something going wrong in it.
        failures: list[threading.ExceptHookArgs] = []
        with mock.patch.object(threading, "excepthook", failures.append):
            done = self.child(text=True, encoding="utf-8")
        self.assertEqual([UnicodeDecodeError], [type(entry.exc_value) for entry in failures])
        self.assertEqual(0, done.returncode)
        self.assertIsNone(done.stdout, "a strict UTF-8 capture delivered the stream after all")


if __name__ == "__main__":
    unittest.main()
