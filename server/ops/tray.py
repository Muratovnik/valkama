"""The tray icon a live session shows on Windows, and the handles that keep it.

This exists only because the host is Windows, and it is an operational concern
rather than a protocol one: which process gets to draw an icon says nothing
about what a client may ask for. It lived inside the MCP surface, where a reader
looking for the message loop found a hundred lines of Win32 mutexes first.

The two environment variables read here are deliberate exceptions to the single
configuration resolution: `VALKAMA_NO_TRAY` and `VALKAMA_TRAY_MUTEX` are switches
for a test and for a machine with no desktop, not settings a user configures.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import uuid
from typing import NamedTuple

from .. import static_assets

# Overridable so a test can run in its own namespace instead of fighting the
# real sessions for the one icon slot.
MUTEX = os.environ.get("VALKAMA_TRAY_MUTEX", "Local\\ValkamaTrayIcon")


class _Icon(NamedTuple):
    """The icon this process shows: the handle its tray watches, and the tray."""

    session: object
    # None when the tray could not be started; the slot stays this session's.
    tray: subprocess.Popen[bytes] | None


# What this process holds. Kept on the module rather than handed back to the
# caller because keeping the handles alive IS the whole job: closing the session
# handle is what tells the tray this session is over, and closing the shared one
# gives the slot away, so they have to outlive every frame that started them.
_SLOT: object | None = None
_ICON: _Icon | None = None
# The release an icon comes from once this session has switched away from the one
# it started on; None until then.
_ROOT: str | None = None
_LOCK = threading.Lock()


def _create_mutex(name: str) -> object | None:
    """A named mutex this process holds, or None when the name is already taken."""
    import ctypes

    # ctypes may clobber the thread's last error between calls, so the error
    # has to be read through use_last_error rather than a second Win32 call.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.CreateMutexW(None, True, name)
    if not handle:
        return None
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle(handle)
        return None
    return handle


def _close_mutex(handle: object) -> None:
    import ctypes

    ctypes.WinDLL("kernel32").CloseHandle(handle)


def _new_session_mutex() -> tuple[object, str] | None:
    """A handle proving this session lives, and the name the tray watches it by."""
    name = f"Local\\ValkamaSession-{uuid.uuid4().hex}"
    handle = _create_mutex(name)
    return None if handle is None else (handle, name)


def _claim_slot() -> tuple[object, object, str] | None:
    """Claim the right to show the icon, and a handle proving this session lives.

    Two mutexes, because they answer different questions. The shared one decides
    which session owns the icon. The per-session one is what the tray watches:
    watching the shared mutex kept an old icon alive once a newer session had
    claimed it, which is how the user ended up with two.

    Both handles are returned and must outlive the process; closing either is
    what tells the tray this session is over.
    """
    shared = _create_mutex(MUTEX)
    if shared is None:
        return None
    session = _new_session_mutex()
    if session is None:  # a fresh uuid cannot collide; treat it as no icon
        _close_mutex(shared)
        return None
    return shared, session[0], session[1]


def _spawn(script: str, icon: str, session_mutex: str) -> subprocess.Popen[bytes]:
    # VS Code exports ELECTRON_RUN_AS_NODE to every child, and it reaches here
    # through the agent. Left in place it makes the board app run as plain Node
    # and exit without a window, so clicking the icon appeared to do nothing.
    environment = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    # These two parameters are a contract between releases: a session started on
    # one release starts the script of the release it switched to.
    return subprocess.Popen(
        [
            "pwsh",
            "-NoLogo",
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-File",
            script,
            "-IconPath",
            icon,
            "-SessionMutex",
            session_mutex,
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=environment,
        creationflags=0x08000000,  # CREATE_NO_WINDOW
    )


def assets(root: str | None = None) -> tuple[str, str]:
    """The tray script and its icon, which live in `windows/`.

    Resolved from `SOURCE_ROOT`, not from this module's own directory, and this
    is the one place in the server that has to know where those two files sit.
    The surfaces once moved down into `server/` while the assets stayed put, and
    joining them onto `server/` still produced a path -- just not one that
    exists, so `start` took its missing-asset exit every time and the icon
    silently stopped appearing. `TrayAssetTests` exists because of that day: it
    asserts these paths against the real files rather than trusting them.

    `root` names another release's directory, for a session that switched to it.
    """
    base = root or static_assets.SOURCE_ROOT
    return (
        os.path.join(base, "windows", "tray.ps1"),
        os.path.join(base, "windows", "valkama.ico"),
    )


def _start_tray(root: str | None, session_mutex: str) -> subprocess.Popen[bytes] | None:
    """One release's tray, or None when it has none or it cannot be started."""
    script, icon = assets(root)
    if not (os.path.isfile(script) and os.path.isfile(icon)):
        return None
    try:
        return _spawn(script, icon, session_mutex)
    except OSError:
        return None  # no pwsh: the board still works, it just has no icon


def _show(shared: object, session: object, session_mutex: str) -> None:
    """Start the tray for a slot just claimed, from the release in force now."""
    global _SLOT, _ICON
    with _LOCK:
        _SLOT = shared
        _ICON = _Icon(session, _start_tray(_ROOT, session_mutex))


def start() -> None:
    """Show a tray icon for as long as any MCP session is holding the board.

    The first session to claim the mutex owns the icon. Later sessions keep
    retrying in the background, so when the owner exits while they are still
    working, one of them picks the icon up instead of leaving the user without
    it.
    """
    if os.environ.get("VALKAMA_NO_TRAY") or sys.platform != "win32":
        return
    script, icon = assets()
    if not (os.path.isfile(script) and os.path.isfile(icon)):
        return

    claim = _claim_slot()
    if claim is not None:
        _show(*claim)
        return

    def take_over() -> None:
        while True:
            time.sleep(10)
            claimed = _claim_slot()
            if claimed is not None:
                _show(*claimed)
                return

    threading.Thread(target=take_over, daemon=True).start()


def follow(root: str) -> None:
    """Move the icon to the release this session has just switched to.

    A session outlives the release it started on and the tray is a process of that
    release, so without this a click keeps running the old script until the client
    restarts. The shared slot stays with this session throughout. The new tray
    starts before the old one is told to go, so a release whose tray will not start
    leaves the working icon up; the old one looks for its mutex every two seconds,
    and the two can stand side by side for that long.

    A tray that has already exited stays gone: that is the operator's "Hide this
    icon", and a new release is no reason to overrule it.
    """
    global _ICON, _ROOT
    with _LOCK:
        _ROOT = root  # where a session still waiting for the slot takes its icon from
        current = _ICON
        if current is None or current.tray is None or current.tray.poll() is not None:
            return
        session = _new_session_mutex()
        if session is None:
            return
        tray = _start_tray(root, session[1])
        if tray is None:
            _close_mutex(session[0])
            return
        _close_mutex(current.session)
        _ICON = _Icon(session[0], tray)
