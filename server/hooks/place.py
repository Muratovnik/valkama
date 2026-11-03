"""Where a session is open: the client, the window kind and the host application.

No hook input says where its session runs. The hook process inherits the
environment of the client that runs it, so a few named variables do, and on
Windows so do the names of the processes above the hook. `classify` turns
those into two closed enumerations and, for Claude Desktop, the id Desktop
knows the session by. It is pure, so every environment is one table row in a
test. Nothing else is kept: a variable's value only selects an enumeration
member, and an ancestor contributes its executable name to a lookup, never its
path, its arguments or its process id.

`ancestors` is the one impure reader, and the hook calls it on a session start
only. It imports `ctypes` when called, so the identity transform, which imports
this module on every Valkama tool call, never loads it.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass

TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

#: How a session is open: an IDE extension's panel, a CLI in an IDE's own
#: terminal, a CLI in a terminal of its own, a background session, a desktop
#: application, or no window at all. Unknown is the empty string.
OPENED_IN = ("ide", "ide-terminal", "terminal", "background", "app", "headless")
#: What it is open in, when the window kind has a product. Unknown is empty.
OPENED_HOST = (
    "vscode",
    "vscode-insiders",
    "cursor",
    "windsurf",
    "jetbrains",
    "claude-desktop",
    "codex-app",
)

#: Every environment variable the hook reads to place a session; nothing else
#: is read from the environment.
VARIABLES = (
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_KIND",
    "CLAUDE_CODE_HOST_SESSION_ID",
    "TERM_PROGRAM",
    "TERMINAL_EMULATOR",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
)

#: How many processes above the hook are read.
ANCESTOR_DEPTH = 8

#: The id Claude Desktop gives its own session; the one value kept as it is.
HOST_SESSION_ID = re.compile(r"local_[A-Za-z0-9-]{1,64}")
_WORD = re.compile(r"[a-z0-9-]{1,64}")

_BACKGROUND_KINDS = frozenset({"bg", "daemon-worker"})
_VSCODE_FAMILY = {
    "code.exe": "vscode",
    "code - insiders.exe": "vscode-insiders",
    "cursor.exe": "cursor",
    "windsurf.exe": "windsurf",
}
_JETBRAINS = frozenset(
    {
        "idea64.exe",
        "pycharm64.exe",
        "webstorm64.exe",
        "phpstorm64.exe",
        "goland64.exe",
        "clion64.exe",
        "rider64.exe",
        "rubymine64.exe",
        "datagrip64.exe",
        "rustrover64.exe",
        "dataspell64.exe",
        "aqua64.exe",
        "studio64.exe",
    }
)
_TERMINALS = frozenset({"windowsterminal.exe", "openconsole.exe"})
_CODEX_APP = "chatgpt.exe"


@dataclass(frozen=True)
class Place:
    """Where a session is open; every field is a closed value or empty."""

    opened_in: str = ""
    opened_host: str = ""
    host_session_id: str = ""


def whitelisted(environ: Mapping[str, str]) -> dict[str, str]:
    """The named variables of an environment, empty when unset."""

    return {name: environ.get(name, "") for name in VARIABLES}


def classify(client: str, environment: Mapping[str, str], ancestors: Sequence[str] = ()) -> Place:
    """Where a session of `client` is open, from its variables and ancestors.

    `ancestors` are executable names, nearest first; an empty sequence means
    they were not read. Only the names in `VARIABLES` are looked up.
    """

    names = tuple(os.path.basename(name.replace("\\", "/")).lower() for name in ancestors)
    if client == "claude":
        return _claude(environment, names)
    if client == "codex":
        return _codex(environment, names)
    return Place()


def _claude(environment: Mapping[str, str], ancestors: tuple[str, ...]) -> Place:
    entrypoint = environment.get("CLAUDE_CODE_ENTRYPOINT", "")
    if environment.get("CLAUDE_CODE_SESSION_KIND", "") in _BACKGROUND_KINDS:
        return Place("background")
    if entrypoint.startswith("claude-desktop") and _plain(entrypoint):
        host_id = environment.get("CLAUDE_CODE_HOST_SESSION_ID", "")
        return Place("app", "claude-desktop", host_id if HOST_SESSION_ID.fullmatch(host_id) else "")
    if entrypoint == "claude-vscode":
        return Place("ide", _editor(ancestors))
    if entrypoint.startswith("sdk-") and _plain(entrypoint):
        return Place("headless")
    if entrypoint == "cli":
        return _terminal(environment, ancestors) or Place("terminal")
    return Place()


def _codex(environment: Mapping[str, str], ancestors: tuple[str, ...]) -> Place:
    if environment.get("CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "") == "codex_vscode":
        return Place("ide", _editor(ancestors))
    # The nearest sign decides: an app started from an IDE's terminal is the app.
    for name in ancestors:
        if name == _CODEX_APP:
            return Place("app", "codex-app")
        if name in _TERMINALS:
            return Place("terminal")
        if name in _VSCODE_FAMILY or name in _JETBRAINS:
            # Under an IDE without the extension's override: its terminal when
            # the terminal says so, otherwise the extension itself.
            return _terminal(environment, ancestors) or Place("ide", _editor(ancestors))
    return _terminal(environment, ()) or Place()


def _terminal(environment: Mapping[str, str], ancestors: tuple[str, ...]) -> Place | None:
    """A CLI in an IDE's own terminal, or nothing when the signs say otherwise."""

    if environment.get("TERM_PROGRAM", "") == "vscode":
        return Place("ide-terminal", _editor(ancestors))
    if environment.get("TERMINAL_EMULATOR", "").startswith("JetBrains") or any(
        name in _JETBRAINS for name in ancestors
    ):
        return Place("ide-terminal", "jetbrains")
    return None


def _editor(ancestors: tuple[str, ...]) -> str:
    """The VS Code product above the hook, VS Code itself when none is named."""

    for name in ancestors:
        if name in _VSCODE_FAMILY:
            return _VSCODE_FAMILY[name]
    return "vscode"


def _plain(value: str) -> bool:
    """Whether a variable holds one word of a known form, not text around one."""

    return _WORD.fullmatch(value) is not None


def chain(processes: Mapping[int, tuple[int, str]], pid: int) -> tuple[str, ...]:
    """The executable names above `pid`, nearest first, from `{pid: (parent, name)}`.

    At most `ANCESTOR_DEPTH` names. The walk stops at a parent the table does
    not hold and at a process it has already visited, which a reused process
    id can produce.
    """

    names: list[str] = []
    seen = {pid}
    current = processes.get(pid)
    while current is not None and len(names) < ANCESTOR_DEPTH:
        parent = current[0]
        if parent in seen or parent not in processes:
            break
        seen.add(parent)
        current = processes[parent]
        names.append(current[1])
    return tuple(names)


def ancestors() -> tuple[str, ...]:
    """The executable names of the processes above this one, nearest first.

    Windows only, from one Toolhelp snapshot; elsewhere nothing. A process id
    may have been reused since its process ended, so a name is a hint, as
    every sign here is.
    """

    if sys.platform != "win32":
        return ()
    return chain(_snapshot(), os.getpid())


def _snapshot() -> dict[int, tuple[int, str]]:
    """Every process as `{pid: (parent pid, executable name)}`."""

    import ctypes
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        # PROCESSENTRY32W, field for field.
        _fields_ = (
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        )

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
    kernel32.Process32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
    kernel32.Process32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    snapshot_processes = 0x00000002
    handle = kernel32.CreateToolhelp32Snapshot(snapshot_processes, 0)
    if handle is None or handle == wintypes.HANDLE(-1).value:
        raise OSError(ctypes.get_last_error(), "process snapshot refused")
    processes: dict[int, tuple[int, str]] = {}
    try:
        entry = ProcessEntry(dwSize=ctypes.sizeof(ProcessEntry))
        more = kernel32.Process32FirstW(handle, ctypes.byref(entry))
        while more:
            processes[int(entry.th32ProcessID)] = (int(entry.th32ParentProcessID), entry.szExeFile)
            more = kernel32.Process32NextW(handle, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(handle)
    return processes
