"""`valkama statusline`: the reading it records, where it goes when the store is away, and
the status line it chains.

The input is the status line JSON Claude Code documents (code.claude.com, "Customize your
status line"): `session_id`, and `rate_limits` with `five_hour` and `seven_day`, each a
`used_percentage` and a `resets_at` in Unix epoch seconds, plus a gateway's
`spend_limit` with `used_usd`. A window may be absent, and `rate_limits` is absent until
a session's first response. The expected times are worked out from the epoch by hand,
not by the code under test. Every id, path and number is invented.

The contract is a hook's: exit 0 and nothing on stdout of its own. Chained, stdout is
exactly what the previous command printed when it exited 0, and nothing otherwise.
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.parse
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import store
from server.hooks import ingest, light, spool, statusline
from server.quota import samples

SESSION = "6f1c2a8e-0000-4000-8000-000000000001"
#: 2025-02-01T16:00:00Z and 2025-02-06T16:00:00Z.
FIVE_HOUR_RESET = 1738425600
WEEK_RESET = 1738857600
#: The documented example, trimmed to the fields around the reading.
INPUT = {
    "cwd": "/work/project",
    "session_id": SESSION,
    "transcript_path": "/work/transcripts/x.jsonl",
    "model": {"id": "claude-x", "display_name": "X"},
    "version": "2.1.300",
    "rate_limits": {
        "five_hour": {"used_percentage": 23.5, "resets_at": FIVE_HOUR_RESET},
        "seven_day": {"used_percentage": 41.2, "resets_at": WEEK_RESET},
    },
}


def encoded(payload: object) -> bytes:
    return json.dumps(payload).encode("utf-8")


def previous(command: str) -> str:
    """The argument Host Runtime writes for a status line command that was there before."""

    return "--previous=" + base64.b64encode(command.encode("utf-8")).decode("ascii")


def python_command(script: str) -> list[str]:
    """A previous command run by this interpreter, in place of the shell, for a test."""

    return [sys.executable, "-I", "-X", "utf8", "-c", script]


class StoreCase(unittest.TestCase):
    """A throwaway store at the current schema, and the spool beside it."""

    def setUp(self) -> None:
        home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(home.cleanup)
        self.home = home.name
        self.path = os.path.join(self.home, "store", "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.spool = spool.directory(self.path)

    def run_command(self, stdin: bytes, *arguments: str) -> tuple[bytes, str]:
        """Run the command in-process: what it printed on stdout, and on stderr."""

        stdout = io.BytesIO()
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            status = statusline.main(list(arguments), io.BytesIO(stdin), stdout)
        self.assertEqual(0, status)
        return stdout.getvalue(), errors.getvalue()

    def samples(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT source, session_id, organization, seat, kind, percent, resets_at,"
                " amount, currency FROM quota_samples ORDER BY id"
            )
        ]

    def spooled(self) -> list[str]:
        return spool.pending(self.spool)


class ProcessTests(StoreCase):
    """The entry point in a child process: an exit status, a stdout and an import set."""

    def test_the_entry_point_records_and_prints_nothing(self) -> None:
        done = subprocess.run(
            [sys.executable, "-I", "-X", "utf8", os.path.join(ROOT, "valkama.py"), "statusline"],
            input=encoded(INPUT),
            capture_output=True,
            env={**os.environ, "VALKAMA_DB": self.path},
            timeout=60,
            check=False,
        )
        self.assertEqual((0, b""), (done.returncode, done.stdout), done.stderr[:400])
        self.assertEqual(["five_hour", "week"], [row[4] for row in self.samples()])

    def test_a_refresh_loads_no_store_module_no_surface_and_none_of_the_costly_imports(
        self,
    ) -> None:
        watched = (
            "server.store",
            "server.cli",
            "server.mcp_surface",
            "server.http_surface",
            "server.hooks.ingest",
            "server.hooks.normalize",
            "json",
            "re",
            "dataclasses",
            "typing",
            "subprocess",
            "sqlite3",
            "ctypes",
            "urllib.parse",
        )
        script = (
            "import io, sys\n"
            f"sys.path.insert(0, {ROOT!r})\n"
            "from server.hooks import statusline\n"
            "statusline.main([], io.BytesIO(sys.stdin.buffer.read()), io.BytesIO())\n"
            f"sys.stdout.write(repr([name for name in {watched!r} if name in sys.modules]))\n"
        )
        for name, environment in (
            ("written", {"VALKAMA_DB": self.path}),
            ("spooled", {"VALKAMA_DB": os.path.join(self.home, "store", "missing.sqlite3")}),
        ):
            with self.subTest(case=name):
                done = subprocess.run(
                    [sys.executable, "-I", "-X", "utf8", "-c", script],
                    input=encoded(INPUT),
                    capture_output=True,
                    env={**os.environ, **environment},
                    timeout=60,
                    check=True,
                )
                self.assertEqual("[]", done.stdout.decode(), done.stderr[:400])
        self.assertEqual(2, len(self.samples()))
        self.assertEqual(1, len(self.spooled()))


class ReadingTests(unittest.TestCase):
    NOW = samples.instant("2026-11-12T10:00:00+00:00")

    def reading(self, payload: object) -> samples.Reading | None:
        import datetime as dt

        return statusline.reading(payload, dt.datetime.fromisoformat(self.NOW))

    def test_the_two_windows_become_the_five_hour_window_and_the_week(self) -> None:
        found = self.reading(INPUT)
        assert found is not None
        self.assertEqual(
            ("statusline", self.NOW, SESSION), (found.source, found.at, found.session_id)
        )
        self.assertIsNone(found.organization)
        self.assertEqual(
            (
                samples.Window("five_hour", 23.5, "2025-02-01T16:00:00.000Z"),
                samples.Window("week", 41.2, "2025-02-06T16:00:00.000Z"),
            ),
            found.windows,
        )
        self.assertEqual("week:2025-02-06T16:00Z", found.seat)

    def test_a_gateway_s_spend_limit_keeps_its_dollars(self) -> None:
        found = self.reading(
            {
                "session_id": SESSION,
                "rate_limits": {
                    "spend_limit": {
                        "used_percentage": 62.8,
                        "resets_at": FIVE_HOUR_RESET,
                        "used_usd": 314.12,
                        "limit_usd": 500,
                        "period": "monthly",
                    }
                },
            }
        )
        assert found is not None
        self.assertEqual(
            (samples.Window("spend_limit", 62.8, "2025-02-01T16:00:00.000Z", None, 314.12, "USD"),),
            found.windows,
        )
        self.assertIsNone(found.seat, "a reading without a week names no seat")

    def test_a_window_that_is_absent_or_not_a_share_is_left_out(self) -> None:
        week_only = {
            "five_hour": {"used_percentage": "23"},
            "seven_day": {"used_percentage": 41, "resets_at": "soon"},
            "other": {"used_percentage": 1},
        }
        found = self.reading({"session_id": SESSION, "rate_limits": week_only})
        assert found is not None
        self.assertEqual((samples.Window("week", 41.0, None),), found.windows)
        self.assertIsNone(found.seat, "a week without its reset names no seat")

    def test_input_without_a_reading_gives_none(self) -> None:
        for payload in (
            {"session_id": SESSION},
            {"session_id": SESSION, "rate_limits": None},
            {"session_id": SESSION, "rate_limits": {}},
            {"session_id": SESSION, "rate_limits": {"five_hour": {"used_percentage": True}}},
            {"rate_limits": INPUT["rate_limits"]},
            {"session_id": 7, "rate_limits": INPUT["rate_limits"]},
            [INPUT],
            None,
        ):
            with self.subTest(payload=payload):
                self.assertIsNone(self.reading(payload))

    def test_a_reading_the_store_would_refuse_raises_before_anything_is_written(self) -> None:
        for payload in (
            {"session_id": "a session id with spaces", "rate_limits": INPUT["rate_limits"]},
            {"session_id": SESSION, "rate_limits": {"five_hour": {"used_percentage": -1}}},
        ):
            with self.subTest(payload=payload), self.assertRaises(samples.SampleError):
                self.reading(payload)


class RecordTests(StoreCase):
    def test_a_reading_becomes_samples_of_its_session_and_prints_nothing(self) -> None:
        printed, errors = self.run_command(encoded(INPUT))
        self.assertEqual((b"", ""), (printed, errors))
        seat = "week:2025-02-06T16:00Z"
        self.assertEqual(
            [
                (
                    "statusline",
                    SESSION,
                    None,
                    seat,
                    "five_hour",
                    23.5,
                    "2025-02-01T16:00:00.000Z",
                    None,
                    None,
                ),
                (
                    "statusline",
                    SESSION,
                    None,
                    seat,
                    "week",
                    41.2,
                    "2025-02-06T16:00:00.000Z",
                    None,
                    None,
                ),
            ],
            self.samples(),
        )
        self.assertEqual([], self.spooled())

    def test_input_that_carries_no_reading_writes_nothing_and_prints_nothing(self) -> None:
        oversized = encoded({**INPUT, "padding": "x" * statusline.MAX_INPUT_BYTES})
        for name, stdin in (
            ("before the first response", encoded({"session_id": SESSION, "model": {}})),
            ("malformed", b'{"session_id": "S", "rate_limits": {'),
            ("not UTF-8", b"\xff\xfe" + encoded(INPUT)),
            ("not an object", encoded([INPUT])),
            ("oversized", oversized),
            ("empty", b""),
        ):
            with self.subTest(input=name):
                printed, _errors = self.run_command(stdin)
                self.assertEqual(b"", printed)
                self.assertEqual([], self.samples())
                self.assertEqual([], self.spooled())

    def test_a_reading_the_store_refuses_is_reported_on_stderr_and_not_spooled(self) -> None:
        payload = {**INPUT, "session_id": "a session id with spaces"}
        printed, errors = self.run_command(encoded(payload))
        self.assertEqual(b"", printed)
        self.assertIn("valkama statusline: SampleError", errors)
        self.assertEqual(([], []), (self.samples(), self.spooled()))

    def test_a_protected_store_is_not_written(self) -> None:
        with mock.patch.dict(os.environ, {"VALKAMA_PROTECTED_STORE": self.path}):
            printed, errors = self.run_command(encoded(INPUT))
        self.assertEqual(b"", printed)
        self.assertIn("protected", errors)
        self.assertEqual(([], []), (self.samples(), self.spooled()))

    def test_the_schema_it_writes_for_is_the_store_s(self) -> None:
        self.assertEqual(store.STORE_SCHEMA_VERSION, statusline.SCHEMA_VERSION)


class SpoolTests(StoreCase):
    def deliver(self) -> ingest.DrainResult:
        conn = ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)
        try:
            return ingest.drain(conn, self.spool)
        finally:
            conn.close()

    def assert_spooled_then_delivered(self, reason: str) -> None:
        self.assertEqual([], self.samples())
        [name] = self.spooled()
        with open(os.path.join(self.spool, name), "rb") as handle:
            line = json.loads(handle.read())
        self.assertEqual((1, reason), (line[statusline.SPOOL_KEY], line["spool_reason"]))
        result = self.deliver()
        self.assertEqual((1, 1, 0), (result.files, result.inserted, result.rejected))
        self.assertEqual(["five_hour", "week"], [row[4] for row in self.samples()])
        self.assertEqual({SESSION}, {row[1] for row in self.samples()})
        self.assertEqual([], self.spooled())

    def test_a_busy_store_spools_the_reading_and_a_drain_delivers_it(self) -> None:
        holder = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(holder.close)
        holder.execute("BEGIN IMMEDIATE")
        started = time.monotonic()
        printed, _errors = self.run_command(encoded(INPUT))
        elapsed = time.monotonic() - started
        holder.rollback()
        self.assertEqual(b"", printed)
        self.assertLess(elapsed, light.BUSY_TIMEOUT_SECONDS, "a locked store is not waited for")
        self.assert_spooled_then_delivered("busy")

    def test_a_missing_store_spools_the_reading_until_one_is_brought_up(self) -> None:
        self.conn.close()
        moved = self.path + ".away"
        os.replace(self.path, moved)
        printed, _errors = self.run_command(encoded(INPUT))
        self.assertEqual(b"", printed)
        os.replace(moved, self.path)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.assert_spooled_then_delivered("missing")

    def test_a_store_at_another_schema_spools_the_reading(self) -> None:
        with mock.patch.object(statusline, "SCHEMA_VERSION", store.STORE_SCHEMA_VERSION + 1):
            self.run_command(encoded(INPUT))
        self.assert_spooled_then_delivered("schema")

    def test_the_server_s_start_up_drain_delivers_a_spooled_reading(self) -> None:
        with mock.patch.object(statusline, "SCHEMA_VERSION", store.STORE_SCHEMA_VERSION + 1):
            self.run_command(encoded(INPUT))
        from server import housekeeping

        result = housekeeping.drain_spool(self.conn)
        self.assertEqual((1, 0), (result.files, result.rejected))
        self.assertEqual(["five_hour", "week"], [row[4] for row in self.samples()])
        self.assertEqual([], self.spooled())

    def test_a_spooled_reading_reads_back_as_the_reading_it_was(self) -> None:
        import datetime as dt

        now = dt.datetime(2026, 11, 12, 10, 0, tzinfo=dt.UTC)
        found = statusline.reading(INPUT, now)
        assert found is not None
        line = statusline.spool_line(found, spooled_at=found.at, reason="busy")
        self.assertEqual((found, found.at), statusline.read_spool_line(json.loads(line)))

    def test_a_spool_line_that_is_not_a_reading_as_written_is_set_aside(self) -> None:
        import datetime as dt

        found = statusline.reading(INPUT, dt.datetime.now(dt.UTC))
        assert found is not None
        good = json.loads(statusline.spool_line(found, spooled_at=found.at, reason="busy"))
        window = good["windows"][0]
        for name, line in (
            ("another version", {**good, statusline.SPOOL_KEY: 2}),
            ("a version that is not a number", {**good, statusline.SPOOL_KEY: True}),
            ("an unknown key", {**good, "prompt": "never kept"}),
            ("another source", {**good, "source": "poll"}),
            ("no windows", {**good, "windows": []}),
            ("a window with an unknown key", {**good, "windows": [{**window, "x": 1}]}),
            ("a share as text", {**good, "windows": [{**window, "percent": "23"}]}),
            ("an unknown kind", {**good, "windows": [{**window, "kind": "day"}]}),
            ("a session id that is not one", {**good, "session_id": "two words"}),
        ):
            with self.subTest(line=name):
                self.assertIsNone(statusline.read_spool_line(line))
        os.makedirs(self.spool, exist_ok=True)
        bad = {**good, "windows": [{**window, "kind": "day"}]}
        spool.write_line(self.spool, json.dumps(bad).encode() + b"\n", occurred_ns=1, uid="bad")
        result = self.deliver()
        self.assertEqual((0, 1), (result.files, result.rejected))
        self.assertEqual([], self.samples())


class ChainTests(StoreCase):
    """The status line the user had keeps showing, through this command."""

    def chained(self, script: str, stdin: bytes = b"") -> tuple[bytes, str]:
        with mock.patch.object(statusline, "shell_argv", return_value=python_command(script)):
            return self.run_command(stdin or encoded(INPUT), previous("the user's command"))

    def test_the_previous_command_gets_the_same_stdin_and_its_stdout_is_printed_exactly(
        self,
    ) -> None:
        echo = (
            "import sys\n"
            "data = sys.stdin.buffer.read()\n"
            "sys.stdout.buffer.write(b'\\x1b[32m' + data + b'\\r\\nsecond row \\xe2\\x86\\x92\\n')\n"
        )
        printed, _errors = self.chained(echo)
        self.assertEqual(b"\x1b[32m" + encoded(INPUT) + b"\r\nsecond row \xe2\x86\x92\n", printed)
        self.assertEqual(2, len(self.samples()), "chaining does not cost the reading")

    def test_the_previous_command_runs_before_the_first_response_too(self) -> None:
        printed, _errors = self.chained(
            "import sys; sys.stdin.read(); print('ok')", encoded({"session_id": SESSION})
        )
        self.assertEqual(b"ok" + os.linesep.encode(), printed)
        self.assertEqual([], self.samples())

    def test_an_oversized_input_reaches_the_previous_command_whole(self) -> None:
        big = encoded({**INPUT, "padding": "x" * statusline.MAX_INPUT_BYTES})
        printed, _errors = self.chained("import sys; print(len(sys.stdin.buffer.read()))", big)
        self.assertEqual(str(len(big)).encode(), printed.strip())
        self.assertEqual([], self.samples())

    def test_a_failing_previous_command_prints_nothing_and_its_errors_stay_off_stdout(
        self,
    ) -> None:
        failing = "import sys; print('half a line'); sys.stderr.write('broken\\n'); sys.exit(3)"
        printed, _errors = self.chained(failing)
        self.assertEqual(b"", printed)
        self.assertEqual(2, len(self.samples()))

    def test_a_hanging_previous_command_is_stopped_with_what_it_started(self) -> None:
        marker = os.path.join(self.home, "pids.txt")
        hanging = (
            "import subprocess, sys, time\n"
            "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\n"
            f"open({marker!r}, 'w').write(str(child.pid))\n"
            "print('never shown', flush=True)\n"
            "time.sleep(120)\n"
        )
        started = time.monotonic()
        with mock.patch.object(statusline, "PREVIOUS_SECONDS", 2.0):
            printed, errors = self.chained(hanging)
        self.assertLess(time.monotonic() - started, 15)
        self.assertEqual(b"", printed)
        self.assertIn("ran past", errors)
        with open(marker, encoding="utf-8") as handle:
            grandchild = int(handle.read())
        if sys.platform == "win32":
            self.assertFalse(wait_gone(grandchild), "the previous command's own child was stopped")
        else:
            # On POSIX the previous command shares this command's process group, so only
            # the command itself is stopped; the client's stop of the group reaches the rest.
            with contextlib.suppress(ProcessLookupError):
                os.kill(grandchild, 9)

    def test_a_previous_command_that_cannot_start_leaves_the_reading_and_a_blank_line(
        self,
    ) -> None:
        missing = [os.path.join(self.home, "no-such-shell.exe"), "-c", "true"]
        with mock.patch.object(statusline, "shell_argv", return_value=missing):
            printed, errors = self.run_command(encoded(INPUT), previous("true"))
        self.assertEqual(b"", printed)
        self.assertIn("did not start", errors)
        self.assertEqual(2, len(self.samples()))

    def test_a_malformed_previous_value_runs_nothing_and_still_records(self) -> None:
        for argument in (
            "--previous=not base64!",
            "--previous=" + "//79",
            "--previous=",
            "--then=x",
        ):
            with (
                self.subTest(argument=argument),
                mock.patch.object(
                    statusline, "_start", side_effect=AssertionError("nothing may run")
                ),
            ):
                printed, errors = self.run_command(encoded(INPUT), argument)
                self.assertEqual(b"", printed)
                self.assertTrue(errors)
        self.assertEqual(2, len(self.samples()))

    def test_without_a_previous_command_nothing_runs_and_nothing_is_printed(self) -> None:
        with mock.patch.object(statusline, "_start", side_effect=AssertionError("nothing runs")):
            self.assertEqual((b"", ""), self.run_command(encoded(INPUT)))

    def test_the_help_names_the_interface(self) -> None:
        printed, _errors = self.run_command(b"", "--help")
        self.assertIn(b"--previous=<base64>", printed)
        self.assertEqual([], self.samples())


class PreviousValueTests(unittest.TestCase):
    def test_the_value_gives_back_the_original_command_exactly(self) -> None:
        for command in (
            "~/.claude/statusline.sh",
            "jq -r '\"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)%\"'",
            'powershell -NoProfile -File "D:/status line/statusline.ps1"',
            "echo 'тест → ok' && printf '%s\\n' $HOME\n",
        ):
            with self.subTest(command=command):
                argument = previous(command)
                self.assertTrue(set(argument[len("--previous=") :]) <= set(BASE64))
                self.assertEqual(command, statusline.previous_command([argument]))


BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="


class ShellTests(unittest.TestCase):
    """The previous command runs through the shell Claude Code runs a status line with."""

    def test_elsewhere_it_is_sh_c(self) -> None:
        self.assertEqual(["/bin/sh", "-c", "x"], statusline.shell_argv("x", platform="linux"))

    def test_on_windows_the_shell_that_started_this_command_runs_the_previous_one(self) -> None:
        bash = "C:\\Program Files\\Git\\usr\\bin\\bash.exe"
        pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
        windows_powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        self.assertEqual(
            [bash, "-c", "x"], statusline.shell_argv("x", platform="win32", parent=bash)
        )
        for shell in (pwsh, windows_powershell):
            with self.subTest(shell=shell):
                self.assertEqual(
                    [shell, "-NoProfile", "-NonInteractive", "-Command", "x"],
                    statusline.shell_argv("x", platform="win32", parent=shell),
                )

    def test_on_windows_another_parent_falls_back_to_the_documented_choice(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bash = os.path.join(directory, "bash.exe")
            with open(bash, "wb"):
                pass
            named = {"CLAUDE_CODE_GIT_BASH_PATH": bash, "PATH": directory}
            self.assertEqual(
                [bash, "-c", "x"],
                statusline.shell_argv("x", platform="win32", parent="C:\\cmd.exe", environ=named),
            )
            git_root = os.path.join(directory, "Git")
            os.makedirs(os.path.join(git_root, "cmd"))
            os.makedirs(os.path.join(git_root, "bin"))
            for name in ("cmd/git.exe", "cmd/git", "bin/bash.exe"):
                with open(os.path.join(git_root, name), "wb"):
                    pass
            beside_git = {"PATH": os.path.join(git_root, "cmd"), "PATHEXT": ".EXE"}
            [shell, flag, command] = statusline.shell_argv(
                "x", platform="win32", parent=None, environ=beside_git
            )
            self.assertEqual(
                (os.path.normcase(os.path.join(git_root, "bin", "bash.exe")), "-c", "x"),
                (os.path.normcase(shell), flag, command),
            )
            nothing = {"PATH": os.path.join(directory, "empty")}
            self.assertEqual(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "x"],
                statusline.shell_argv("x", platform="win32", parent=None, environ=nothing),
            )


class RealShellTests(StoreCase):
    """End to end through a real shell, where this machine has one."""

    def run_through(self, shell: str, command: str) -> bytes:
        with mock.patch.object(statusline, "parent_program", return_value=shell):
            printed, _errors = self.run_command(encoded(INPUT), previous(command))
        return printed

    def test_a_posix_shell_passes_stdin_and_stdout_through(self) -> None:
        if sys.platform == "win32" or not os.path.isfile("/bin/sh"):
            self.skipTest("POSIX only")
        self.assertEqual(encoded(INPUT), self.run_through("", "cat"))

    def test_git_bash_passes_stdin_and_stdout_through(self) -> None:
        if sys.platform != "win32":
            self.skipTest("Windows only")
        bash = statusline._documented_shell(os.environ)
        if statusline._kind(bash) != "bash":
            self.skipTest("no Git Bash on this machine")
        self.assertEqual(encoded(INPUT), self.run_through(bash, "cat"))
        self.assertEqual(b'a b|c"d|\n', self.run_through(bash, "printf '%s|' \"a b\" 'c\"d'; echo"))

    def test_powershell_passes_stdin_and_stdout_through(self) -> None:
        if sys.platform != "win32":
            self.skipTest("Windows only")
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if shell is None:
            self.skipTest("no PowerShell on this machine")
        command = "$j = $input | Out-String | ConvertFrom-Json; Write-Output $j.session_id"
        self.assertEqual(SESSION.encode() + b"\r\n", self.run_through(shell, command))


class LightOpenTests(unittest.TestCase):
    def test_the_uri_quotes_a_path_as_urllib_does(self) -> None:
        for path in ("/tmp/a b/c%d?e#f.sqlite3", "/tmp/данные/v.sqlite3", "/tmp/x~y_z-1.2"):
            with self.subTest(path=path):
                absolute = os.path.abspath(path).replace(os.sep, "/")
                if not absolute.startswith("/"):
                    absolute = "/" + absolute
                expected = f"file://{urllib.parse.quote(absolute, safe='/:')}?mode=rw"
                self.assertEqual(expected, light.uri(path))


def wait_gone(pid: int, seconds: float = 10.0) -> bool:
    """Whether a process is still running after waiting up to `seconds` for it to end."""

    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if not running(pid):
            return False
        time.sleep(0.1)
    return running(pid)


def running(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == 259  # STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    with contextlib.suppress(ChildProcessError):
        if os.waitpid(pid, os.WNOHANG) != (0, 0):
            return False
    return True


if __name__ == "__main__":
    unittest.main()
