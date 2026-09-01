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

import contextlib
import os
import subprocess
import sys
import threading
import time

from .. import static_assets

# Overridable so a test can run in its own namespace instead of fighting the
# real sessions for the one icon slot.
MUTEX = os.environ.get("VALKAMA_TRAY_MUTEX", "Local\\ValkamaTrayIcon")

# The handles this process holds. Kept on the module rather than handed back to
# the caller because keeping them alive IS the whole job: closing either one is
# what tells the tray this session is over, so they have to outlive every frame
# that started them.
_HELD: object | None = None


def _claim_slot() -> tuple[object, object, str] | None:
    """Claim the right to show the icon, and a handle proving this session lives.

    Two mutexes, because they answer different questions. The shared one decides
    which session owns the icon. The per-session one is what the tray watches:
    watching the shared mutex kept an old icon alive once a newer session had
    claimed it, which is how the user ended up with two.

    Both handles are returned and must outlive the process; closing either is
    what tells the tray this session is over.
    """
    import ctypes
    import uuid

    # ctypes may clobber the thread's last error between calls, so the error
    # has to be read through use_last_error rather than a second Win32 call.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    def create(name: str) -> object | None:
        handle = kernel32.CreateMutexW(None, True, name)
        if not handle:
            return None
        if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(handle)
            return None
        return handle

    shared = create(MUTEX)
    if shared is None:
        return None
    session_name = f"Local\\ValkamaSession-{uuid.uuid4().hex}"
    session = create(session_name)
    if session is None:  # a fresh uuid cannot collide; treat it as no icon
        kernel32.CloseHandle(shared)
        return None
    return shared, session, session_name


def _spawn(script: str, icon: str, session_mutex: str) -> None:
    # VS Code exports ELECTRON_RUN_AS_NODE to every child, and it reaches here
    # through the agent. Left in place it makes the board app run as plain Node
    # and exit without a window, so clicking the icon appeared to do nothing.
    environment = {k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"}
    subprocess.Popen(
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


def assets() -> tuple[str, str]:
    """The tray script and its icon, which live in `windows/`.

    Resolved from `SOURCE_ROOT`, not from this module's own directory, and this
    is the one place in the server that has to know where those two files sit.
    The surfaces once moved down into `server/` while the assets stayed put, and
    joining them onto `server/` still produced a path -- just not one that
    exists, so `start` took its missing-asset exit every time and the icon
    silently stopped appearing. `TrayAssetTests` exists because of that day: it
    asserts these paths against the real files rather than trusting them.
    """
    return (
        os.path.join(static_assets.SOURCE_ROOT, "windows", "tray.ps1"),
        os.path.join(static_assets.SOURCE_ROOT, "windows", "valkama.ico"),
    )


def start() -> None:
    """Show a tray icon for as long as any MCP session is holding the board.

    The first session to claim the mutex owns the icon. Later sessions keep
    retrying in the background, so when the owner exits while they are still
    working, one of them picks the icon up instead of leaving the user without
    it.
    """
    global _HELD
    if os.environ.get("VALKAMA_NO_TRAY") or sys.platform != "win32":
        return
    script, icon = assets()
    if not (os.path.isfile(script) and os.path.isfile(icon)):
        return

    claim = _claim_slot()
    if claim is not None:
        try:
            _spawn(script, icon, claim[2])
        except OSError:
            pass  # no pwsh: the board still works, it just has no icon
        _HELD = claim
        return

    holder: list[object] = []

    def take_over() -> None:
        while True:
            time.sleep(10)
            claimed = _claim_slot()
            if claimed is not None:
                holder.append(claimed)  # keep the handles alive for this session
                with contextlib.suppress(OSError):
                    _spawn(script, icon, claimed[2])
                return

    threading.Thread(target=take_over, daemon=True).start()
    _HELD = holder
