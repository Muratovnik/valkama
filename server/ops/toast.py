"""Showing, removing and checking a Windows toast through Valkama's own helper.

The server imports nothing outside the standard library, and Python reaches the
WinRT toast types only through hand-written COM tables, so a toast is shown by a
small C# program, `windows/toast.cs`. It is not committed as a binary: the first
use compiles it with the C# compiler every Windows carries in .NET Framework 4,
against the WinRT metadata in `System32\\WinMetadata`, into the user's Valkama
directory under a name derived from the source. A release with a changed helper
therefore compiles its own once and never runs an older one.

This module builds no text. It takes a finished `alerts.messages.Message`, hands
it to the helper as base64 JSON -- so no title or question can become an
argument -- and starts the helper detached for `show` and `remove`, which never
make the caller wait. `check` waits up to five seconds for Windows' answer on
whether it would show a toast for Valkama at all.

`VALKAMA_NO_ALERTS` is a switch for the tests and for a machine with no desktop,
like `VALKAMA_NO_TRAY`, not a setting a user configures; with it set, or off
Windows, nothing here starts a process or compiles anything. Every failure is a
line in `%TEMP%\\valkama-alerts.log`, which the helper writes to as well, never
an exception: an alert is never worth a failed write.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict

from .. import processes, static_assets

#: The application identity the desktop installer puts on the Start menu
#: shortcut. Windows shows a toast only for an identity a shortcut carries, and
#: signs it with that shortcut's name.
AUMID = "local.valkama"
SWITCH = "VALKAMA_NO_ALERTS"
HELPER = "valkama-toast.exe"
CHECK_TIMEOUT = 5.0
_COMPILE_TIMEOUT = 60.0
_PLAN_SWITCH = "--print-plan"

#: `ToastNotifier.Setting`, which the helper reports as a number.
SETTINGS = {
    0: "enabled",
    1: "disabled-for-application",
    2: "disabled-for-user",
    3: "disabled-by-group-policy",
    4: "disabled-by-manifest",
}
#: The WinRT metadata the helper is compiled against, and the .NET Framework
#: assemblies that project it.
_WINMD = ("Windows.Data.winmd", "Windows.Foundation.winmd", "Windows.UI.winmd")
_FACADES = (
    "System.Runtime.dll",
    "System.Runtime.WindowsRuntime.dll",
    "System.Runtime.InteropServices.WindowsRuntime.dll",
)


class Check(TypedDict):
    """Whether Windows would show Valkama's toasts, and why not when it would not.

    `state` is a `SETTINGS` value when Windows answered, otherwise `switched-off`
    (`VALKAMA_NO_ALERTS`), `unsupported` (not Windows), `unavailable` (the helper
    could not be built) or `failed` (it did not answer). `setting` is Windows'
    own number, or None when there is none; `reason` says what went wrong.
    """

    state: str
    setting: int | None
    reason: str | None


class HelperUnavailableError(RuntimeError):
    """The helper cannot be built or found on this machine."""


def assets(root: str | None = None) -> tuple[str, str]:
    """The helper's source and the icon a toast shows, both in `windows/`.

    Resolved from `SOURCE_ROOT`, as the tray's are, and checked against the real
    files by a test: a path that is joined but does not exist fails quietly.
    """

    base = root or static_assets.SOURCE_ROOT
    return (
        os.path.join(base, "windows", "toast.cs"),
        os.path.join(base, "windows", "valkama.ico"),
    )


def logo_uri(root: str | None = None) -> str | None:
    """The icon as the `file:` URI a toast's `appLogoOverride` takes, or None."""

    icon = assets(root)[1]
    return Path(icon).resolve().as_uri() if os.path.isfile(icon) else None


def active() -> bool:
    """Whether this process may start the helper at all."""

    return not os.environ.get(SWITCH) and sys.platform == "win32"


def log_path() -> str:
    return os.path.join(tempfile.gettempdir(), "valkama-alerts.log")


def _log(message: str) -> None:
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    with contextlib.suppress(OSError):
        # Python opens a file shared for reading and writing on Windows, which
        # is what lets the helper append to the same log at the same time.
        with open(log_path(), "a", encoding="utf-8") as log:
            log.write(f"{stamp} server {message}\n")


def _framework() -> tuple[Path, Path]:
    """The .NET Framework 4 directory with its compiler, and the WinRT metadata."""

    windows = Path(os.environ.get("SYSTEMROOT") or os.environ.get("WINDIR") or r"C:\Windows")
    metadata = windows / "System32" / "WinMetadata"
    for bits in ("Framework64", "Framework"):
        framework = windows / "Microsoft.NET" / bits / "v4.0.30319"
        if (framework / "csc.exe").is_file():
            return framework, metadata
    raise HelperUnavailableError("the .NET Framework 4 C# compiler is not on this machine")


def compile_command(source: str, output: str, framework: Path, metadata: Path) -> list[str]:
    """The compiler's command line for the helper, with every reference named."""

    return [
        str(framework / "csc.exe"),
        "/nologo",
        "/utf8output",
        "/target:exe",
        "/optimize+",
        f"/out:{output}",
        *(f"/r:{metadata / name}" for name in _WINMD),
        *(f"/r:{framework / name}" for name in _FACADES),
        source,
    ]


def _cache() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise HelperUnavailableError(
            "LOCALAPPDATA is not set, so there is nowhere to build the helper"
        )
    return Path(local) / "Valkama" / "toast"


def helper(root: str | None = None) -> str:
    """The compiled helper for this release's source, built on first use.

    The directory is named by the source's digest, so a changed helper is built
    beside the old one rather than over a file another process may be running.
    Two processes building at once each compile to a private name and the
    second rename finds the first one's result in place, which is the same file.
    """

    source = assets(root)[0]
    try:
        digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()[:16]
    except OSError as error:
        raise HelperUnavailableError(f"the helper source is missing: {source}") from error
    directory = _cache() / digest
    target = directory / HELPER
    if target.is_file():
        return str(target)
    framework, metadata = _framework()
    directory.mkdir(parents=True, exist_ok=True)
    scratch = directory / f"build-{uuid.uuid4().hex}.exe"
    try:
        try:
            built = processes.run_text(
                compile_command(source, str(scratch), framework, metadata),
                # The compiler's own text goes to a person reading the log, and
                # `/utf8output` already asked it for UTF-8.
                errors="replace",
                timeout=_COMPILE_TIMEOUT,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise HelperUnavailableError(f"the C# compiler could not run: {error}") from error
        if built.returncode != 0 or not scratch.is_file():
            detail = " ".join((built.stdout + built.stderr).split())[:400]
            raise HelperUnavailableError(f"the helper did not compile: {detail}")
        try:
            os.replace(scratch, target)
        except OSError:
            if not target.is_file():
                raise
    finally:
        with contextlib.suppress(OSError):
            scratch.unlink()
    _log(f"helper built: {target}")
    return str(target)


def command(
    executable: str, op: str, payload: Mapping[str, object], *, plan: bool = False
) -> list[str]:
    """The helper's command line: the operation and its payload as base64 JSON."""

    encoded = base64.b64encode(
        json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return [executable, op, encoded, *((_PLAN_SWITCH,) if plan else ())]


def _start(op: str, payload: Mapping[str, object]) -> bool:
    try:
        executable = helper()
        processes.start_detached(command(executable, op, payload), cwd=os.path.dirname(executable))
    except (HelperUnavailableError, OSError, subprocess.SubprocessError) as error:
        _log(f"{op} {payload.get('tag', '')} not started: {error}")
        return False
    return True


def show(message: Mapping[str, object]) -> bool:
    """Show a toast without waiting for it; whether the helper was started.

    `message` is an `alerts.messages.Message`. A started helper that then fails
    leaves a line in the log, not an answer here.
    """

    if not active():
        return False
    return _start(
        "show",
        {key: message[key] for key in ("aumid", "tag", "group", "xml", "expires_at")},
    )


def remove(tag: str, group: str) -> bool:
    """Take an item's toast out of the action centre without waiting."""

    if not active():
        return False
    return _start("remove", {"aumid": AUMID, "tag": tag, "group": group})


def check() -> Check:
    """Ask Windows whether it would show Valkama's toasts, waiting up to five seconds."""

    if os.environ.get(SWITCH):
        return {"state": "switched-off", "setting": None, "reason": f"{SWITCH} is set"}
    if sys.platform != "win32":
        return {"state": "unsupported", "setting": None, "reason": "toasts are Windows-only"}
    try:
        executable = helper()
    except (HelperUnavailableError, OSError) as error:
        return {"state": "unavailable", "setting": None, "reason": str(error)}
    try:
        answered = processes.run_text(
            command(executable, "check", {"aumid": AUMID}), timeout=CHECK_TIMEOUT
        )
        reply = json.loads(answered.stdout)
    except subprocess.TimeoutExpired:
        return {"state": "failed", "setting": None, "reason": "Windows did not answer in time"}
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return {"state": "failed", "setting": None, "reason": str(error)}
    setting = reply.get("setting") if isinstance(reply, dict) else None
    if answered.returncode != 0 or not isinstance(setting, int) or isinstance(setting, bool):
        reason = reply.get("error") if isinstance(reply, dict) else None
        return {"state": "failed", "setting": None, "reason": str(reason or answered.stdout)}
    return {
        "state": SETTINGS.get(setting, f"setting-{setting}"),
        "setting": setting,
        "reason": None,
    }
