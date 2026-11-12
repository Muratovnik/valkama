"""`valkama statusline`: Claude Code's status line command, and the `statusline` quota source.

Claude Code runs its status line command with a JSON object on stdin, on every
refresh of the status line. Once a session has had a response on a subscription
account, the object carries `rate_limits`: the five-hour window, the week and, behind
a gateway, a spend limit, each with the share used and when it resets. This command
records them as a `statusline` reading of that session, through `quota.samples.record`,
straight into the store; when the store cannot take it now (missing, busy, at another
schema), the reading goes to the spool beside it and is delivered with the hook events
there.

When it replaced a status line command the user already had, it runs that command with
the same stdin through the same shell and prints exactly what that command printed;
otherwise it prints nothing. `--previous` carries that command, as base64 of its UTF-8
bytes, so the setting that registers this command holds everything it runs and gives
the original back unchanged. The contract is a hook's: exit status 0, nothing on
stdout of its own, a diagnostic on stderr.

What it costs is paid on every refresh, so it imports what `light` and the lean JSON
scanner in `notify` need and nothing else: not the store module, which costs more than
all of this work, nor `json`, `re`, `dataclasses` or `subprocess` unless it chains.
"""

from __future__ import annotations

import os
import sys

TYPE_CHECKING = False
if TYPE_CHECKING:
    import datetime as dt
    import subprocess
    from collections.abc import Mapping
    from typing import BinaryIO

    from ..quota.samples import Reading, Window

#: `store.STORE_SCHEMA_VERSION`, held equal by a test: importing the store module costs
#: this command more than everything else it does.
SCHEMA_VERSION = 17

#: The most stdin read as a reading; a status line input is a few kilobytes.
MAX_INPUT_BYTES = 1024 * 1024
#: How long the previous command may run before its process tree is stopped. Claude
#: Code states no timeout of its own; it cancels a command still running when the next
#: refresh comes, and a refresh can come no oftener than once a second.
PREVIOUS_SECONDS = 10.0
#: The longest previous command taken, decoded.
MAX_PREVIOUS_BYTES = 64 * 1024
PREVIOUS_OPTION = "--previous="

#: What marks a spool line as a quota reading, and its version.
SPOOL_KEY = "quota"
SPOOL_VERSION = 1
_SPOOL_FIELDS = frozenset(
    {SPOOL_KEY, "source", "at", "session_id", "seat", "windows", "spooled_at", "spool_reason"}
)
_WINDOW_TEXT = ("kind", "resets_at", "model", "currency")
_WINDOW_NUMBERS = ("percent", "amount")
_WINDOW_FIELDS = frozenset(_WINDOW_TEXT + _WINDOW_NUMBERS)

#: The shells Claude Code runs a status line command with, by program name.
_BASH = frozenset({"bash.exe", "sh.exe", "bash", "sh"})
_POWERSHELL = frozenset({"pwsh.exe", "powershell.exe"})

HELP = """\
usage: valkama statusline [--previous=<base64>]

Claude Code's status line command. It reads the status line JSON on stdin and,
when it carries `rate_limits`, records a `statusline` quota reading of that
session into the store, or into the spool beside the store when the store cannot
take it now. It prints nothing of its own and always exits 0.

  --previous=<base64>  the status line command this one replaced: the standard
                       base64 (RFC 4648, with padding) of its UTF-8 bytes. It runs
                       with the same stdin through the shell that runs this
                       command, and its stdout is printed exactly when it exits 0;
                       nothing is printed when it fails or runs past 10 seconds.

Without --previous the status line shows nothing.
"""


def main(
    argv: list[str] | None = None,
    stdin: BinaryIO | None = None,
    stdout: BinaryIO | None = None,
) -> int:
    """Run the status line command once; always 0."""

    arguments = sys.argv[2:] if argv is None else argv
    output = stdout if stdout is not None else sys.stdout.buffer
    if arguments in (["--help"], ["-h"]):
        output.write(HELP.encode("utf-8"))
        output.flush()
        return 0
    try:
        _run(arguments, stdin if stdin is not None else sys.stdin.buffer, output)
    # A status line command never fails its client: whatever went wrong goes where the
    # client does not show it.
    except Exception as error:  # noqa: BLE001
        _note(f"{type(error).__name__}: {error}")
    return 0


def _note(message: str) -> None:
    from .entry import note

    note(message, "statusline")


def _run(arguments: list[str], stdin: BinaryIO, stdout: BinaryIO) -> None:
    previous = previous_command(arguments)
    raw = stdin.read(MAX_INPUT_BYTES + 1)
    child = None
    if previous is not None:
        try:
            child = _start(previous)
        except Exception as error:  # noqa: BLE001 -- the reading is still recorded
            _note(f"the previous command did not start: {type(error).__name__}: {error}")
    if len(raw) <= MAX_INPUT_BYTES:
        try:
            _record(raw)
        except Exception as error:  # noqa: BLE001 -- the previous command still shows
            _note(f"{type(error).__name__}: {error}")
    elif child is not None:
        raw += stdin.read()
    if child is not None:
        printed = _finish(child, raw)
        if printed:
            stdout.write(printed)
            stdout.flush()


def previous_command(arguments: list[str]) -> str | None:
    """The command `--previous` carries, or None; a malformed one is reported and dropped."""

    if not arguments:
        return None
    if len(arguments) != 1 or not arguments[0].startswith(PREVIOUS_OPTION):
        _note(f"unknown arguments {arguments!r}; {HELP.splitlines()[0]}")
        return None
    import binascii

    encoded = arguments[0][len(PREVIOUS_OPTION) :]
    try:
        decoded = binascii.a2b_base64(encoded, strict_mode=True)
        command = decoded.decode("utf-8")
    except (binascii.Error, ValueError):
        _note("--previous is not base64 of UTF-8 text")
        return None
    if not command.strip() or len(decoded) > MAX_PREVIOUS_BYTES:
        _note("--previous names no command to run")
        return None
    return command


# --- the reading -------------------------------------------------------------


def reading(payload: object, now: dt.datetime) -> Reading | None:
    """The reading a status line input carries, as the store keeps it, or None.

    A window that is absent or does not carry its share as a number is left out, as
    Claude Code leaves out a window whose reset has passed. A reading the store refuses
    raises `samples.SampleError`.
    """

    from ..quota import samples

    if not isinstance(payload, dict):
        return None
    limits = payload.get("rate_limits")
    session = payload.get("session_id")
    if not isinstance(limits, dict) or not isinstance(session, str):
        return None
    windows = []
    for name, kind in samples.SOURCE_WINDOWS["statusline"].items():
        window = _window(kind, limits.get(name))
        if window is not None:
            windows.append(window)
    if not windows:
        return None
    found = samples.Reading(
        "statusline",
        now.isoformat(),
        tuple(windows),
        samples.seat_of(windows),
        session_id=session,
    )
    return samples.validated(found, now)


def _number(value: object) -> float | None:
    import math

    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _window(kind: str, value: object) -> Window | None:
    import datetime as dt

    from ..quota import samples

    if not isinstance(value, dict):
        return None
    percent = _number(value.get("used_percentage"))
    if percent is None:
        return None
    resets = _number(value.get("resets_at"))
    resets_at = None
    if resets is not None:
        try:
            resets_at = dt.datetime.fromtimestamp(resets, dt.UTC).isoformat()
        except (OverflowError, OSError, ValueError):
            resets_at = None
    amount = _number(value.get("used_usd")) if kind == "spend_limit" else None
    currency = "USD" if amount is not None else None
    return samples.Window(kind, percent, resets_at, amount=amount, currency=currency)


def _record(raw: bytes) -> str:
    """Write the reading `raw` carries, or spool it; returns where it went."""

    import datetime as dt
    import time

    from . import light, notify

    payload = notify.parse(raw)
    now_ns = time.time_ns()
    now = dt.datetime.fromtimestamp(now_ns / 1_000_000_000, dt.UTC)
    found = reading(payload, now)
    if found is None:
        return "nothing"
    path = notify.settings()[0]
    if path is None:
        _note("the store is protected in this environment; nothing recorded")
        return "protected"
    import _sqlite3

    from ..quota import samples

    try:
        conn = light.open_light(path, SCHEMA_VERSION, timeout=0)
    except light.UnwritableError as refusal:
        _spool(path, found, now_ns, refusal.reason)
        return refusal.reason
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            samples.record(conn, found, now=now)
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
    except _sqlite3.Error as error:  # the store would not take it now: busy, or full
        _spool(path, found, now_ns, light.reason(error))
        return light.reason(error)
    finally:
        conn.close()
    return "direct"


# --- the spool ---------------------------------------------------------------


def _spool(path: str, found: Reading, now_ns: int, reason: str) -> None:
    from . import spool

    line = spool_line(found, spooled_at=found.at, reason=reason)
    spool.write_line(spool.directory(path), line, occurred_ns=now_ns, uid=os.urandom(16).hex())


def _json(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, str):
        try:
            from _json import encode_basestring_ascii
        except ImportError:
            import json

            return json.dumps(value)
        return str(encode_basestring_ascii(value))
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, int):
        return str(value)
    raise TypeError(f"a spool line holds no {type(value).__name__}")


def spool_line(found: Reading, *, spooled_at: str, reason: str) -> bytes:
    """One spool line for a reading the store could not take: the reading as validated."""

    windows = ",".join(
        "{"
        + ",".join(
            f'"{name}":{_json(getattr(window, name))}' for name in _WINDOW_TEXT + _WINDOW_NUMBERS
        )
        + "}"
        for window in found.windows
    )
    fields = (
        f'"{SPOOL_KEY}":{SPOOL_VERSION}',
        f'"source":{_json(found.source)}',
        f'"at":{_json(found.at)}',
        f'"session_id":{_json(found.session_id)}',
        f'"seat":{_json(found.seat)}',
        f'"windows":[{windows}]',
        f'"spooled_at":{_json(spooled_at)}',
        f'"spool_reason":{_json(reason)}',
    )
    return ("{" + ",".join(fields) + "}\n").encode("ascii")


def read_spool_line(line: dict) -> tuple[Reading, str] | None:
    """A spooled reading back, with its `spooled_at`, or None when the line is not one.

    The file is read back from disk, so the line is held to the shape `spool_line`
    writes and the reading to what `samples.validated` keeps.
    """

    from ..quota import samples

    if line.get(SPOOL_KEY) != SPOOL_VERSION or type(line.get(SPOOL_KEY)) is not int:
        return None
    if not set(line) <= _SPOOL_FIELDS or line.get("source") != "statusline":
        return None
    texts = (line.get("at"), line.get("session_id"), line.get("spooled_at"))
    if not all(isinstance(text, str) for text in texts):
        return None
    if not isinstance(line.get("spool_reason"), str):
        return None
    seat = line.get("seat")
    raw_windows = line.get("windows")
    if (seat is not None and not isinstance(seat, str)) or not isinstance(raw_windows, list):
        return None
    windows = []
    for raw in raw_windows:
        if not isinstance(raw, dict) or not set(raw) <= _WINDOW_FIELDS:
            return None
        if not all(raw.get(name) is None or isinstance(raw[name], str) for name in _WINDOW_TEXT):
            return None
        numbers = [raw.get(name) for name in _WINDOW_NUMBERS]
        if not all(number is None or _number(number) is not None for number in numbers):
            return None
        windows.append(
            samples.Window(
                str(raw.get("kind")),
                raw.get("percent"),
                raw.get("resets_at"),
                raw.get("model"),
                raw.get("amount"),
                raw.get("currency"),
            )
        )
    import datetime as dt

    found = samples.Reading(
        "statusline", str(line["at"]), tuple(windows), seat, session_id=str(line["session_id"])
    )
    try:
        kept = samples.validated(found, dt.datetime.now(dt.UTC))
    except samples.SampleError:
        return None
    return kept, str(line["spooled_at"])


# --- the previous command ----------------------------------------------------


def shell_argv(
    command: str,
    *,
    platform: str | None = None,
    parent: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> list[str]:
    """How the previous command runs: through the shell Claude Code runs this one with.

    On Windows that is the process that started this one, when it is Git Bash or
    PowerShell, which it is whenever Claude Code started it; otherwise the shell Claude
    Code's documentation names, Git Bash when it is installed and PowerShell when it is
    not. Elsewhere it is `sh -c`, as for a hook in shell form.
    """

    if (platform or sys.platform) != "win32":
        return ["/bin/sh", "-c", command]
    shell = parent if parent is not None and _kind(parent) else _documented_shell(environ)
    if _kind(shell) == "powershell":
        return [shell, "-NoProfile", "-NonInteractive", "-Command", command]
    return [shell, "-c", command]


def _kind(path: str) -> str:
    name = os.path.basename(path.replace("\\", "/")).lower()
    return "bash" if name in _BASH else "powershell" if name in _POWERSHELL else ""


def _documented_shell(environ: Mapping[str, str] | None) -> str:
    """Git Bash by `CLAUDE_CODE_GIT_BASH_PATH` or beside `git`, else PowerShell."""

    import shutil

    source = os.environ if environ is None else environ
    named = source.get("CLAUDE_CODE_GIT_BASH_PATH", "")
    if named and _kind(named) == "bash" and os.path.isfile(named):
        return named
    candidates = []
    git = shutil.which("git", path=source.get("PATH"))
    if git:
        folder = os.path.dirname(git)
        candidates += [os.path.join(folder, "..", "bin", "bash.exe")]
        candidates += [os.path.join(folder, "..", "..", "bin", "bash.exe")]
    for root in (source.get("ProgramFiles", ""), source.get("ProgramW6432", "")):
        if root:
            candidates.append(os.path.join(root, "Git", "bin", "bash.exe"))
    for candidate in candidates:
        if os.path.isfile(candidate):
            return os.path.normpath(candidate)
    return shutil.which("pwsh", path=source.get("PATH")) or "powershell.exe"


def parent_program() -> str | None:
    """The program of the process that started this one, on Windows; None elsewhere."""

    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.QueryFullProcessImageNameW.argtypes = (
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    )
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    query_limited_information = 0x1000
    handle = kernel32.OpenProcess(query_limited_information, False, os.getppid())
    if not handle:
        return None
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buffer))
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return None
        return buffer.value
    finally:
        kernel32.CloseHandle(handle)


def _start(command: str) -> subprocess.Popen[bytes]:
    import subprocess

    argv = shell_argv(command, parent=parent_program())
    return subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        # The previous command's diagnostics stay on stderr, where `claude --debug`
        # reads them, as they did before this command replaced it.
        stderr=None,
        shell=False,
        # Left in this command's process group: Claude Code cancels a run still going
        # when the next refresh comes, far more often than the time limit below
        # stops one, and a stop it sends to the group then reaches this child too.
        start_new_session=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _finish(child: subprocess.Popen[bytes], raw: bytes) -> bytes:
    """What the previous command printed, when it exited 0 in time; otherwise nothing.

    Claude Code shows nothing for a command that exits with another status, so the
    output of one that failed is not printed either.
    """

    import subprocess

    try:
        printed, _ = child.communicate(raw, timeout=PREVIOUS_SECONDS)
    except subprocess.TimeoutExpired:
        from .. import processes

        # The whole tree on Windows; on POSIX the child alone, its group being ours.
        processes.stop_process_tree(child)
        _note(f"the previous command ran past {PREVIOUS_SECONDS:g} seconds and was stopped")
        return b""
    if child.returncode != 0:
        return b""
    return printed or b""
