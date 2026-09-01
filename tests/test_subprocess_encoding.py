"""The subprocess boundary of the Unicode text and transport contract.

`docs/architecture/unicode-text-transport-contract.md` in the parent workspace
requires each repository to keep its own vector for this boundary, and clause 3
requires a decode failure to propagate rather than turn into something quieter.
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

SERVER = os.path.join(ROOT, "server")
DECODING_KEYWORDS = ("text", "universal_newlines", "encoding")
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
    """Source guards, because the defect is a keyword that reads as harmless.

    Nothing observable changes when one of these reappears, so no test of
    behavior can catch it; what catches it is reading the call itself.
    """

    def test_no_server_module_decodes_what_taskkill_writes(self) -> None:
        calls = 0
        for relative, tree in server_modules():
            for call in taskkill_calls(tree):
                calls += 1
                used = {keyword.arg for keyword in call.keywords}
                for forbidden in DECODING_KEYWORDS:
                    self.assertNotIn(
                        forbidden,
                        used,
                        f"{relative}:{call.lineno} decodes taskkill output,"
                        " which is console OEM text",
                    )
        self.assertGreaterEqual(calls, 1, "the guard found no taskkill call to check")

    def test_a_call_that_decodes_names_both_its_codec_and_its_policy(self) -> None:
        # `text=True` alone follows the locale, so the same line means UTF-8
        # under the gate and CP1251 under a plain shell here. Naming the codec
        # is what makes a call site mean one thing; naming the error policy is
        # what makes a lenient boundary a declaration instead of an accident.
        calls = 0
        for relative, tree in server_modules():
            for call in child_process_calls(tree):
                calls += 1
                used = {keyword.arg for keyword in call.keywords}
                if not used & set(DECODING_KEYWORDS) and "errors" not in used:
                    continue  # captures bytes; nothing is being decoded
                for required in ("encoding", "errors"):
                    self.assertIn(
                        required,
                        used,
                        f"{relative}:{call.lineno} decodes a child's output"
                        f" without naming {required}",
                    )
        self.assertGreaterEqual(calls, 6, "the guard found no child process to check")

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
        used = {keyword.arg for keyword in found[0].keywords}
        self.assertNotIn(
            "errors",
            used,
            "this synthetic call already names errors, so it no longer proves the catch",
        )


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
