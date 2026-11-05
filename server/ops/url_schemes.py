"""What this machine can open by link, and how each link is written.

The browser cannot ask the operating system who handles a scheme, and asking at
click time from the desktop app would give the two a different truth. So the
server reads it: `HKEY_CLASSES_ROOT` is the merged view Windows itself resolves a
scheme through, the per-user classes over the machine's. A scheme counts when its
key carries the `URL Protocol` label. A key with no command is how an MSIX package
registers (its handler is declared in the package manifest), and a key with one
counts only while the program it names exists: an uninstalled editor leaves its
key behind, and a link to it would do nothing and say nothing.

Every link is built here, one function to a route, so a route a client changes is
one line to replace. Paths go through `Path.as_uri`, the standard library's own
percent-encoding: a `#` or a `?` in a folder name must not end the path.
"""

from __future__ import annotations

import importlib
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from urllib.parse import quote

#: The closed list of schemes a plan may name.
SCHEMES = ("vscode", "vscode-insiders", "cursor", "windsurf", "claude", "codex", "claude-cli")
#: The editors, whose product name is also their scheme, and where each keeps extensions.
EDITOR_HOMES = {
    "vscode": ".vscode",
    "vscode-insiders": ".vscode-insiders",
    "cursor": ".cursor",
    "windsurf": ".windsurf",
}

CLAUDE_EXTENSION = "anthropic.claude-code"
CODEX_EXTENSION = "openai.chatgpt"
_EXTENSIONS = (CLAUDE_EXTENSION, CODEX_EXTENSION)

#: Routes and client behaviour no client documents, or that reading could not settle.
#: Each name stays out of `SEEN_LIVE` until it has been watched working on the client
#: versions the release names; until then the planner takes the documented way round.
DESKTOP_CONTINUE = "desktop-continue"
"""`claude://code/continue` opens that very session, not Desktop's start page."""
CLI_RESUME_LINK = "cli-resume-link"
"""`claude-cli://` with `/resume` continues that very session."""
ELSEWHERE_NOTICE = "elsewhere-notice"
"""The extension's "still open somewhere else" notice holds the input until answered."""
CODEX_EXTENSION_ROUTE = "codex-extension-route"
"""`vscode://openai.chatgpt/local/<id>` opens that very thread."""

SEEN_LIVE: frozenset[str] = frozenset()

_TERMINAL_EXECUTABLE = "wt.exe"
_LEADING_EXECUTABLE = re.compile(r'\s*(?:"([^"]+)"|(.+?\.exe)(?=\s|$)|(\S+))', re.IGNORECASE)


@dataclass(frozen=True)
class Installed:
    """One reading of the machine: what a plan may rely on."""

    schemes: frozenset[str] = frozenset()
    #: (editor, extension) pairs found in that editor's extension folder.
    extensions: frozenset[tuple[str, str]] = frozenset()
    #: Whether Windows Terminal can be started.
    terminal: bool = False


def _winreg() -> ModuleType | None:
    """The registry module, or nothing off Windows; a test puts a stand-in here."""

    try:
        return importlib.import_module("winreg")
    except ImportError:
        return None


def command_executable(command: str) -> str:
    """The program a `shell\\open\\command` value starts, with variables expanded."""

    found = _LEADING_EXECUTABLE.match(os.path.expandvars(command))
    return next((part for part in found.groups() if part), "") if found else ""


def _exists(executable: str) -> bool:
    if os.path.isabs(executable):
        return os.path.isfile(executable)
    return shutil.which(executable) is not None


def _registered(winreg: ModuleType, scheme: str) -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, scheme) as key:
            winreg.QueryValueEx(key, "URL Protocol")
    except OSError:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"{scheme}\shell\open\command") as key:
            command = str(winreg.QueryValueEx(key, "")[0])
    except OSError:
        return True
    executable = command_executable(command)
    return not executable or _exists(executable)


def registered_schemes() -> frozenset[str]:
    """The schemes with a live handler. Off Windows nothing says otherwise, so all of them."""

    winreg = _winreg()
    if winreg is None:
        return frozenset(SCHEMES)
    return frozenset(scheme for scheme in SCHEMES if _registered(winreg, scheme))


def installed_extensions(home: str) -> frozenset[tuple[str, str]]:
    """Which editors hold which extension, from folder names alone."""

    found: set[tuple[str, str]] = set()
    for editor, folder in EDITOR_HOMES.items():
        try:
            names = [entry.name.lower() for entry in os.scandir(Path(home, folder, "extensions"))]
        except OSError:
            continue
        found.update(
            (editor, extension)
            for extension in _EXTENSIONS
            if any(name.startswith(f"{extension}-") for name in names)
        )
    return frozenset(found)


def _terminal_available() -> bool:
    if shutil.which(_TERMINAL_EXECUTABLE):
        return True
    local = os.environ.get("LOCALAPPDATA", "")
    return bool(local) and os.path.isfile(
        os.path.join(local, "Microsoft", "WindowsApps", _TERMINAL_EXECUTABLE)
    )


def detect() -> Installed:
    """Read the machine as it is now; nothing is remembered between clicks."""

    return Installed(
        schemes=registered_schemes(),
        extensions=installed_extensions(str(Path.home())),
        terminal=_terminal_available(),
    )


def _part(value: str) -> str:
    return quote(value, safe="")


def _file_path(path: str) -> str:
    return Path(path).as_uri().removeprefix("file:///")


def folder_link(editor: str, folder: str) -> str:
    """Open a folder's window in an editor."""

    return f"{editor}://file/{_file_path(folder)}"


def file_link(editor: str, path: str, line: int | None) -> str:
    """Open a file in an editor, at a line when one is named."""

    place = f":{line}:1" if line else ""
    return f"{editor}://file/{_file_path(path)}{place}"


def claude_extension_link(editor: str, session: str) -> str:
    """Documented: the Claude Code extension's tab for a session."""

    return f"{editor}://anthropic.claude-code/open?session={_part(session)}"


def codex_extension_link(editor: str, session: str) -> str:
    """Undocumented: the Codex extension's view of a thread."""

    return f"{editor}://openai.chatgpt/local/{_part(session)}"


def claude_desktop_link(host_session: str) -> str:
    """Undocumented: a Claude Desktop session, by the id Desktop gave it."""

    return f"claude://code/continue?session={_part(host_session)}"


def codex_app_link(session: str) -> str:
    """Documented: a thread in the Codex app."""

    return f"codex://threads/{_part(session)}"


def claude_cli_resume_link(folder: str, session: str) -> str:
    """Documented parts: a terminal in a folder, with `/resume <id>` typed and waiting for Enter."""

    return f"claude-cli://open?cwd={_part(folder)}&q={_part(f'/resume {session}')}"
