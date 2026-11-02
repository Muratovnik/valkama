"""Install and verify the stable command agent clients use to start Valkama.

The launcher is service-owned user state. Client configuration names the stable
launcher path; only its managed shim records what that command runs.

What it runs is a pinned release: a copy of one commit of the checkout, written
once under the releases directory and never edited. Every client session spawns
its own server, and each new one opens the live store, so a shim that ran the
working tree directly made every unfinished edit -- an import error, a raised
schema ratchet -- the next session's problem and, for a ratchet, a migration of
the live store nobody chose. Pinning moves that moment to one explicit
`launcher install`, which is also how the checkout's newer commits reach clients
and how a relocated checkout is picked up.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib
import io
import itertools
import json
import ntpath
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import NamedTuple

from . import listener_owners, processes
from .ops import configuration

SCHEMA_VERSION = 1
MANIFEST_NAME = "valkama-launcher.json"
SHIM_NAME = "valkama-launcher.py"
RELEASE_RECORD = "valkama-release.json"
RELEASE_SCHEMA_VERSION = 1
#: Set by the shim for the process it starts, so that process can tell when the
#: launcher has since been pinned to another release.
LAUNCHER_ENV = "VALKAMA_LAUNCHER_DIR"
#: The command-line word that makes a `serve` an on-demand listener (`on_demand.py`).
ON_DEMAND_FLAG = "--on-demand"
#: The interpreter beside `python.exe` that opens no console window.
WINDOWED_PYTHON = "pythonw.exe"
#: The name autostart keeps its command under, in the current user's Run key.
AUTOSTART_VALUE = "Valkama"
_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

_PROCESS_TERMINATE = 0x0001
_SYNCHRONIZE = 0x00100000
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


class LauncherError(RuntimeError):
    """The launcher cannot be changed without risking an unmanaged file."""


def source_script() -> Path:
    return (Path(__file__).resolve().parents[1] / "valkama.py").resolve()


def default_checkout() -> Path:
    """The checkout an install pins from when none is named.

    A pinned release has no `.git`, so a release that runs `launcher install`
    -- which is what the stable command does -- pins from the checkout it was
    itself copied from.
    """

    root = source_script().parent
    record = _read_release_record(root)
    if record is not None and isinstance(record.get("checkout"), str):
        return Path(record["checkout"])
    return root


def default_releases(platform_name: str | None = None) -> Path:
    platform = platform_name or os.name
    if platform == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            raise LauncherError("LOCALAPPDATA is required to install the Windows launcher")
        return (Path(local) / "Valkama" / "releases").resolve()
    configured = os.environ.get("XDG_DATA_HOME")
    base = Path(configured).expanduser() if configured else Path.home() / ".local" / "share"
    return (base / "valkama" / "releases").resolve()


def default_directory(platform_name: str | None = None) -> Path:
    platform = platform_name or os.name
    if platform == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            raise LauncherError("LOCALAPPDATA is required to install the Windows launcher")
        return (Path(local) / "Valkama" / "bin").resolve()
    configured = os.environ.get("XDG_BIN_HOME")
    target = Path(configured).expanduser() if configured else Path.home() / ".local" / "bin"
    return target.resolve()


def command_name(platform_name: str | None = None) -> str:
    return "valkama.cmd" if (platform_name or os.name) == "nt" else "valkama"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _paths(directory: Path, platform_name: str) -> dict[str, Path]:
    return {
        "command": directory / command_name(platform_name),
        "shim": directory / SHIM_NAME,
        "manifest": directory / MANIFEST_NAME,
    }


#: The module a release answers `valkama hook` with. A release pinned from a
#: commit before hooks existed lacks it.
HOOK_ENTRY = ("server", "hooks", "entry.py")


def _shim_bytes(script: Path) -> bytes:
    """The shim both commands run: it starts the pinned release with the caller's arguments.

    One exception is written into it, because it is the only code that runs
    no matter which release is pinned. A client hook calls `valkama hook` on
    every prompt and tool call, and a release from before hooks hands `hook`
    to its argument parser, which exits 2 -- which Claude Code reads from a
    prompt or tool hook as "block". So rolling the pin back while the hooks
    are still registered would block every prompt. For such a release the shim
    answers a hook itself: nothing on stdout, exit status 0, the release not
    started. A release that has the hook entry receives the call unchanged.
    """

    encoded = json.dumps(str(script), ensure_ascii=False)
    hook_entry = ", ".join(json.dumps(part) for part in HOOK_ENTRY)
    text = (
        '"""Generated by `valkama.py launcher install`; do not edit."""\n\n'
        "from __future__ import annotations\n\n"
        "import os\n"
        "import runpy\n"
        "import sys\n"
        "from pathlib import Path\n\n"
        f"SOURCE = Path({encoded})\n"
        "# A release from before `valkama hook` would refuse it with exit 2, which a\n"
        "# client reads as blocking the prompt or the tool call.\n"
        'if sys.argv[1:2] == ["hook"] and not SOURCE.parent.joinpath('
        f"{hook_entry}).is_file():\n"
        "    raise SystemExit(0)\n"
        "if not SOURCE.is_file():\n"
        '    raise SystemExit(f"Valkama source entry point is missing: {SOURCE}")\n'
        f'os.environ["{LAUNCHER_ENV}"] = str(Path(__file__).resolve().parent)\n'
        "sys.path.insert(0, str(SOURCE.parent))\n"
        'runpy.run_path(str(SOURCE), run_name="__main__")\n'
    )
    return text.encode("utf-8")


def _git(checkout: Path, *arguments: str) -> str:
    try:
        result = processes.run_text(["git", "-C", str(checkout), *arguments], timeout=60)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LauncherError(f"git could not read {checkout}: {error}") from error
    if result.returncode != 0:
        detail = result.stderr.strip() or f"git exited {result.returncode}"
        raise LauncherError(f"git could not read {checkout}: {detail}")
    return result.stdout.strip()


def checkout_revision(checkout: str | os.PathLike[str], revision: str = "HEAD") -> str:
    """The full commit a revision names in a checkout, refusing anything else."""

    root = Path(checkout).expanduser().resolve()
    if not (root / "valkama.py").is_file():
        raise LauncherError(f"not a Valkama checkout: {root}")
    top = Path(_git(root, "rev-parse", "--show-toplevel")).resolve()
    if top != root:
        raise LauncherError(f"{root} is inside the Git work tree {top}, not its root")
    return _git(root, "rev-parse", "--verify", "--end-of-options", f"{revision}^{{commit}}")


def _read_release_record(root: Path) -> dict | None:
    try:
        document = json.loads((root / RELEASE_RECORD).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return document if isinstance(document, dict) else None


def _tree_hashes(root: Path) -> dict[str, str]:
    # Bytecode is what running a release writes into it, so it is not an edit.
    return {
        path.relative_to(root).as_posix(): _sha256(path.read_bytes())
        for path in sorted(root.rglob("*"))
        if path.is_file()
        and path.name != RELEASE_RECORD
        and "__pycache__" not in path.relative_to(root).parts
    }


def _release_problem(root: Path, revision: str) -> str | None:
    record = _read_release_record(root)
    if record is None:
        return "it has no readable release record"
    if record.get("schema_version") != RELEASE_SCHEMA_VERSION or record.get("revision") != revision:
        return "its release record names another revision"
    if _tree_hashes(root) != record.get("files"):
        return "its files differ from the ones it was written with"
    return None


def pin_release(checkout: Path, revision: str, releases: Path) -> Path:
    """Write one commit of the checkout as an immutable release, or reuse it.

    The copy comes from `git archive`, so it holds exactly what the commit
    holds: uncommitted edits cannot reach it, and neither can ignored files. It
    is staged beside its final name and renamed into place whole, so a release
    directory either exists complete or not at all. An existing one is reused
    only after every file is checked against the hashes it was written with;
    one that has been edited is refused rather than repaired, because a process
    may be running from it.
    """

    target = releases / revision
    if target.exists():
        problem = _release_problem(target, revision)
        if problem is not None:
            raise LauncherError(
                f"refusing to reuse the release at {target}: {problem}. Remove that"
                " directory once no Valkama process runs from it, then install again."
            )
        return target
    releases.mkdir(parents=True, exist_ok=True)
    try:
        archive = subprocess.run(
            ["git", "-C", str(checkout), "archive", "--format=tar", revision],
            capture_output=True,
            check=False,
            timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LauncherError(f"git could not archive {revision}: {error}") from error
    if archive.returncode != 0:
        detail = archive.stderr.decode("utf-8", "replace").strip()
        raise LauncherError(f"git could not archive {revision}: {detail}")
    staging = Path(tempfile.mkdtemp(prefix=f".{revision[:12]}.", dir=releases))
    try:
        try:
            with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as bundle:
                bundle.extractall(staging, filter="data")
        except tarfile.TarError as error:
            raise LauncherError(f"commit {revision} could not be unpacked: {error}") from error
        if not (staging / "valkama.py").is_file():
            raise LauncherError(f"commit {revision} has no valkama.py at its root")
        record = {
            "schema_version": RELEASE_SCHEMA_VERSION,
            "revision": revision,
            "checkout": str(checkout),
            "files": _tree_hashes(staging),
        }
        (staging / RELEASE_RECORD).write_bytes(
            (json.dumps(record, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode(
                "utf-8"
            )
        )
        os.rename(staging, target)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return target


def pinned_source_reader() -> Callable[[], str | None] | None:
    """How a process the shim started notices that the shim has moved on.

    The release a pinned process runs never changes on disk, so watching its own
    files would never report drift. What changes is the manifest: after the next
    `launcher install` it names another release, and a session opened from then
    on gets that one. A process that is not the release the launcher currently
    names -- a test, a development run of the checkout -- gets no reader.
    """

    directory = os.environ.get(LAUNCHER_ENV)
    if not directory:
        return None
    manifest = Path(directory) / MANIFEST_NAME

    def current() -> str | None:
        document, _ = _read_manifest(manifest)
        value = document.get("source_script") if document else None
        return value if isinstance(value, str) else None

    started = current()
    if started is None or Path(started).resolve() != source_script():
        return None
    return current


def _command_bytes(platform_name: str, python: Path) -> tuple[bytes, int]:
    if platform_name == "nt":
        interpreter = subprocess.list2cmdline([str(python)])
        text = f'@echo off\r\n{interpreter} "%~dp0{SHIM_NAME}" %*\r\n'
        return text.encode("utf-8"), stat.S_IREAD | stat.S_IWRITE
    interpreter = shlex.quote(str(python))
    text = (
        '#!/bin/sh\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\n'
        f'exec {interpreter} "$SCRIPT_DIR/{SHIM_NAME}" "$@"\n'
    )
    return text.encode("utf-8"), 0o755


def _atomic_write(path: Path, data: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _read_manifest(path: Path) -> tuple[dict[str, object] | None, str | None]:
    if not path.is_file():
        return None, None
    try:
        document = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return None, str(error)
    if not isinstance(document, dict):
        return None, "manifest must be a JSON object"
    return document, None


def _file_problem(path: Path, expected: object) -> str | None:
    if not isinstance(expected, str):
        return f"manifest does not own {path.name}"
    if not path.is_file():
        return f"managed file is missing: {path.name}"
    try:
        digest = _sha256(path.read_bytes())
    except OSError as error:
        return f"managed file is unreadable: {path.name}: {error}"
    if digest != expected:
        return f"managed file was modified: {path.name}"
    return None


def status(
    directory: str | os.PathLike[str] | None = None,
    *,
    platform_name: str | None = None,
) -> dict[str, object]:
    platform = platform_name or os.name
    root = Path(directory).expanduser().resolve() if directory else default_directory(platform)
    paths = _paths(root, platform)
    present = {name: path.is_file() for name, path in paths.items()}
    base = {
        "schema_version": SCHEMA_VERSION,
        "directory": str(root),
        "command": str(paths["command"]),
        "shim": str(paths["shim"]),
        "manifest": str(paths["manifest"]),
        "args": ["mcp"],
    }
    if not any(present.values()):
        return {**base, "state": "missing"}

    manifest, error = _read_manifest(paths["manifest"])
    if manifest is None:
        state = "unmanaged" if error is None else "drifted"
        return {**base, "state": state, "detail": error or "managed manifest is missing"}
    if manifest.get("schema_version") != SCHEMA_VERSION:
        return {**base, "state": "drifted", "detail": "unsupported launcher manifest schema"}
    if manifest.get("platform") != platform:
        return {**base, "state": "drifted", "detail": "launcher platform does not match"}
    files = manifest.get("files")
    if not isinstance(files, dict):
        return {**base, "state": "drifted", "detail": "launcher manifest has no file hashes"}

    problems = [
        problem
        for name in ("command", "shim")
        if (problem := _file_problem(paths[name], files.get(paths[name].name))) is not None
    ]
    source_value = manifest.get("source_script")
    source = Path(source_value) if isinstance(source_value, str) else None
    source_available = source is not None and source.is_file()
    if source is None:
        problems.append("manifest has no source_script")
        source_detail = None
    elif not source_available:
        source_detail = f"source entry point is missing: {source}"
    else:
        source_detail = None

    return {
        **base,
        "state": "installed" if not problems else "drifted",
        "source_script": str(source) if source is not None else None,
        "source_available": source_available,
        "revision": manifest.get("revision"),
        "checkout": manifest.get("checkout"),
        "python": manifest.get("python"),
        "detail": "; ".join([*problems, *([source_detail] if source_detail else [])]) or None,
    }


def _managed_status(
    directory: str | os.PathLike[str] | None,
    platform_name: str,
) -> dict[str, object]:
    current = status(directory, platform_name=platform_name)
    if current["state"] != "installed":
        detail = current.get("detail") or "the launcher is not installed"
        raise LauncherError(f"managed launcher ownership is unavailable: {detail}")
    return current


def _windows_listener_processes(port: int, *, query=None) -> list[dict[str, object]]:
    """The processes listening on `port`, as `listener_owners` reads them from Windows."""

    read = query or listener_owners.listener_processes
    try:
        rows = read(port)
    except listener_owners.ListenerQueryError as error:
        raise LauncherError(f"could not inspect the process listening on port {port}") from error
    owners: list[dict[str, object]] = []
    for row in rows:
        pid = row.get("pid") if isinstance(row, dict) else None
        if (
            not isinstance(row, dict)
            or not isinstance(pid, int)
            or isinstance(pid, bool)
            or pid <= 0
        ):
            raise LauncherError("Windows returned malformed listener ownership data")
        command_line = row.get("command_line")
        executable_path = row.get("executable_path")
        identity_token = row.get("identity_token")
        if (
            not isinstance(command_line, str)
            or not isinstance(executable_path, str)
            or not isinstance(identity_token, str)
        ):
            raise LauncherError("Windows returned malformed listener ownership data")
        owners.append(
            {
                "pid": pid,
                "command_line": command_line,
                "executable_path": executable_path,
                "identity_token": identity_token,
            }
        )
    return owners


def _normalized_windows_path(value: str | os.PathLike[str]) -> str:
    """Normalize with Windows' non-expanding case semantics."""

    return ntpath.normcase(ntpath.normpath(os.fspath(value)))


def _same_windows_path(
    left: str | os.PathLike[str],
    right: str | os.PathLike[str],
) -> bool:
    return bool(left and right) and _normalized_windows_path(left) == _normalized_windows_path(
        right
    )


def _command_line_names_shim(command_line: str, shim: str | os.PathLike[str]) -> bool:
    """Whether the managed shim is the script argument of one Python process."""

    try:
        arguments = shlex.split(command_line, posix=False)
    except ValueError:
        return False
    if len(arguments) < 2:
        return False
    script = arguments[1]
    if len(script) >= 2 and script.startswith('"') and script.endswith('"'):
        script = script[1:-1]
    return _same_windows_path(script, shim)


def _names_on_demand(command_line: str) -> bool:
    """Whether this listener was started to hold the port until someone connects."""

    try:
        return ON_DEMAND_FLAG in shlex.split(command_line, posix=False)[2:]
    except ValueError:
        return False


def _classify_listener_processes(
    port: int,
    python: str | os.PathLike[str],
    shim: str | os.PathLike[str],
    owners: list[dict[str, object]],
) -> dict[str, object]:
    unique: dict[int, dict[str, object]] = {}
    uncertain = False
    for owner in owners:
        pid = owner.get("pid")
        command_line = owner.get("command_line")
        executable_path = owner.get("executable_path")
        identity_token = owner.get("identity_token")
        if (
            isinstance(pid, int)
            and not isinstance(pid, bool)
            and pid > 0
            and isinstance(command_line, str)
            and bool(command_line)
            and isinstance(executable_path, str)
            and bool(executable_path)
            and isinstance(identity_token, str)
            and bool(identity_token)
        ):
            normalized = {
                "pid": pid,
                "command_line": command_line,
                "executable_path": executable_path,
                "identity_token": identity_token,
            }
            if pid in unique and unique[pid] != normalized:
                uncertain = True
            unique[pid] = normalized
        else:
            uncertain = True
    if uncertain:
        return {
            "state": "foreign",
            "port": port,
            "pid": None,
            "detail": (
                f"port {port} has listener ownership Windows could not verify; "
                "Valkama left it untouched. Stop that process or choose another port, "
                "then try again."
            ),
        }
    if not unique:
        return {
            "state": "free",
            "port": port,
            "pid": None,
            "executable_path": None,
            "process_identity": None,
            "detail": None,
        }
    # Autostart runs the windowed interpreter that sits beside the recorded one, so
    # a listener started at login has no console window. That is the same Python.
    interpreters = (python, ntpath.join(ntpath.dirname(os.fspath(python)), WINDOWED_PYTHON))
    managed = [
        pid
        for pid, owner in unique.items()
        if any(_same_windows_path(str(owner["executable_path"]), path) for path in interpreters)
        and _command_line_names_shim(str(owner["command_line"]), shim)
    ]
    if len(unique) == 1 and len(managed) == 1:
        pid = managed[0]
        owner = unique[pid]
        return {
            "state": "managed",
            "port": port,
            "pid": pid,
            "executable_path": owner["executable_path"],
            "process_identity": owner["identity_token"],
            "detail": f"port {port} is owned by managed launcher process {pid}",
            **({"on_demand": True} if _names_on_demand(str(owner["command_line"])) else {}),
        }
    listed = ", ".join(str(pid) for pid in sorted(unique))
    return {
        "state": "foreign",
        "port": port,
        "pid": next(iter(unique)) if len(unique) == 1 else None,
        "detail": (
            f"port {port} is held by process {listed} that was not started by the managed "
            "Valkama launcher; Valkama left it untouched. Stop that process or choose "
            "another port, then try again."
        ),
    }


def listener_status(
    directory: str | os.PathLike[str] | None = None,
    *,
    port: int = 8642,
    platform_name: str | None = None,
    process_reader=None,
) -> dict[str, object]:
    """Classify a listener from its process identity, never its HTTP payload."""

    if not 1 <= port <= 65535:
        raise LauncherError(f"invalid listener port {port}")
    platform = platform_name or os.name
    if platform != "nt" and process_reader is None:
        raise LauncherError("managed listener inspection is currently available only on Windows")
    current = _managed_status(directory, platform)
    python = current.get("python")
    if not isinstance(python, str) or not ntpath.isabs(python):
        raise LauncherError("managed launcher manifest has no absolute Python identity")
    read = process_reader or _windows_listener_processes
    owners = read(port)
    return _classify_listener_processes(port, python, str(current["shim"]), owners)


@contextlib.contextmanager
def _windows_process_handle(pid: int) -> Iterator[int]:
    """Hold the Windows process object so its PID cannot be substituted."""

    winapi = importlib.import_module("_winapi")
    access = _PROCESS_TERMINATE | _SYNCHRONIZE | _PROCESS_QUERY_LIMITED_INFORMATION
    try:
        handle = winapi.OpenProcess(access, False, pid)
    except OSError as error:
        if getattr(error, "winerror", None) in {87, 1168}:
            raise ProcessLookupError(pid) from error
        raise
    try:
        yield handle
    finally:
        winapi.CloseHandle(handle)


def _terminate_windows_process_handle(handle: int) -> None:
    winapi = importlib.import_module("_winapi")
    winapi.TerminateProcess(handle, 1)


def _same_listener_process(first: dict[str, object], second: dict[str, object]) -> bool:
    first_executable = first.get("executable_path")
    second_executable = second.get("executable_path")
    return bool(
        isinstance(first.get("pid"), int)
        and first["pid"] == second.get("pid")
        and isinstance(first_executable, str)
        and isinstance(second_executable, str)
        and _same_windows_path(first_executable, second_executable)
        and isinstance(first.get("process_identity"), str)
        and first["process_identity"] == second.get("process_identity")
    )


def _refused_stop(port: int, detail: str, *, pid: object = None) -> dict[str, object]:
    message = detail.strip()
    if "left it untouched" not in message.lower():
        message = f"{message} Valkama left it untouched."
    return {
        "state": "refused",
        "port": port,
        "pid": pid if isinstance(pid, int) and not isinstance(pid, bool) else None,
        "detail": message,
    }


def stop_listener(
    directory: str | os.PathLike[str] | None = None,
    *,
    port: int = 8642,
    platform_name: str | None = None,
    process_reader=None,
    process_guard=None,
    stopper=None,
) -> dict[str, object]:
    """Stop one listener only while holding and re-verifying its process object."""

    if not 1 <= port <= 65535:
        raise LauncherError(f"invalid listener port {port}")
    try:
        current = listener_status(
            directory,
            port=port,
            platform_name=platform_name,
            process_reader=process_reader,
        )
    except LauncherError as error:
        return _refused_stop(port, str(error))
    if current["state"] == "free":
        return {**current, "detail": f"port {port} is already free"}
    if current["state"] != "managed":
        return {**current, "state": "refused"}
    pid = current["pid"]
    if not isinstance(pid, int):
        return _refused_stop(port, "managed listener status had no process id")
    manager = (
        process_guard(pid)
        if process_guard is not None
        else _windows_process_handle(pid)
        if stopper is None
        else contextlib.nullcontext(pid)
    )
    try:
        with manager as handle:
            try:
                confirmed = listener_status(
                    directory,
                    port=port,
                    platform_name=platform_name,
                    process_reader=process_reader,
                )
            except LauncherError as error:
                return _refused_stop(port, f"listener identity could not be re-verified: {error}")
            if confirmed["state"] == "free":
                return {
                    **confirmed,
                    "detail": "listener exited before it could be stopped",
                }
            if confirmed["state"] != "managed":
                return _refused_stop(
                    port,
                    str(confirmed.get("detail") or "listener ownership changed before stop"),
                    pid=confirmed.get("pid"),
                )
            if not _same_listener_process(current, confirmed):
                return _refused_stop(
                    port,
                    "listener process identity changed before stop",
                    pid=confirmed.get("pid"),
                )
            terminate = stopper or _terminate_windows_process_handle
            terminate(handle)
    except ProcessLookupError:
        return {"state": "free", "port": port, "pid": None, "detail": "listener exited"}
    except OSError as error:
        return _refused_stop(port, f"could not safely stop managed listener process {pid}: {error}")
    return {
        "state": "stopped",
        "port": port,
        "pid": pid,
        "detail": f"stopped managed launcher process {pid}",
    }


class WindowsRunKey:
    """The one value this launcher keeps under the current user's Run key.

    Real machine state, and no redirected home directory isolates it, so the test
    suite replaces `AUTOSTART_STORE` as it imports (`tests/__init__.py`).
    """

    @staticmethod
    def _winreg():
        return importlib.import_module("winreg")

    def read(self) -> str | None:
        winreg = self._winreg()
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
                value, _kind = winreg.QueryValueEx(key, AUTOSTART_VALUE)
        except FileNotFoundError:
            return None
        return str(value)

    def write(self, command: str) -> None:
        winreg = self._winreg()
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, AUTOSTART_VALUE, 0, winreg.REG_SZ, command)

    def delete(self) -> None:
        winreg = self._winreg()
        with (
            contextlib.suppress(FileNotFoundError),
            winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key,
        ):
            winreg.DeleteValue(key, AUTOSTART_VALUE)


#: Where autostart is recorded. Read through this module: the tests swap it.
AUTOSTART_STORE = WindowsRunKey()


class ListenerEffects(NamedTuple):
    """What touching the machine means to the listener steps; a test passes its own."""

    process_reader: Callable[[int], list[dict[str, object]]] | None = None
    process_guard: Callable[[int], contextlib.AbstractContextManager] | None = None
    stopper: Callable[[int], None] | None = None
    spawner: Callable[[list[str], Path], int] | None = None
    #: How long a stopped listener gets to release the port, in checks 200 ms apart.
    release_checks: int = 25


def _spawn_detached(arguments: list[str], directory: Path) -> int:
    """Start a process that outlives this one, with no window and no inherited pipes."""

    process = subprocess.Popen(
        arguments,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        cwd=directory,
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
    )
    return process.pid


def _on_demand_arguments(current: dict[str, object], port: int) -> list[str]:
    python = current.get("python")
    if not isinstance(python, str) or not ntpath.isabs(python):
        raise LauncherError("managed launcher manifest has no absolute Python identity")
    windowed = ntpath.join(ntpath.dirname(python), WINDOWED_PYTHON)
    if not Path(windowed).is_file():
        raise LauncherError(f"{WINDOWED_PYTHON} is missing beside {python}")
    return [windowed, str(current["shim"]), "serve", ON_DEMAND_FLAG, "--port", str(port)]


def start_on_demand_listener(
    directory: str | os.PathLike[str] | None,
    port: int,
    *,
    platform_name: str | None = None,
    effects: ListenerEffects | None = None,
) -> int:
    """Start the listener that holds `port` through the managed shim; its process id."""

    current = _managed_status(directory, platform_name or os.name)
    spawn = (effects or ListenerEffects()).spawner or _spawn_detached
    return spawn(_on_demand_arguments(current, port), Path(str(current["directory"])))


def _value_port(command: str) -> int | None:
    """The port an autostart command names, when it names one."""

    try:
        arguments = shlex.split(command, posix=False)
    except ValueError:
        return None
    for name, value in itertools.pairwise(arguments):
        if name == "--port" and value.isdecimal():
            return int(value)
    return None


def autostart_status(
    directory: str | os.PathLike[str] | None = None,
    *,
    platform_name: str | None = None,
) -> dict[str, object]:
    """Whether login starts the listener: `disabled` unless the owner turned it on.

    `enabled` is the exact command this launcher would write, `stale` a command of
    this launcher that differs from it, `foreign` a value under this name that
    names another command, which is not this launcher's to change.
    """

    platform = platform_name or os.name
    base: dict[str, object] = {"value": AUTOSTART_VALUE, "command": None, "port": None}
    if platform != "nt":
        return {**base, "state": "unsupported"}
    root = Path(directory).expanduser().resolve() if directory else default_directory(platform)
    command = AUTOSTART_STORE.read()
    if command is None:
        return {**base, "state": "disabled"}
    base = {**base, "command": command, "port": _value_port(command)}
    if not _command_line_names_shim(command, _paths(root, platform)["shim"]):
        return {**base, "state": "foreign"}
    current = status(root, platform_name=platform)
    if current["state"] != "installed" or not isinstance(base["port"], int):
        return {**base, "state": "stale"}
    try:
        expected = subprocess.list2cmdline(_on_demand_arguments(current, base["port"]))
    except LauncherError:
        return {**base, "state": "stale"}
    return {**base, "state": "enabled" if command == expected else "stale"}


def _refuse_foreign_autostart(found: dict[str, object], force: bool) -> None:
    if found["state"] == "foreign" and not force:
        raise LauncherError(
            f"refusing to replace the {AUTOSTART_VALUE} autostart value, which runs"
            f" another command: {found['command']}"
        )


def enable_autostart(
    directory: str | os.PathLike[str] | None = None,
    *,
    port: int | None = None,
    force: bool = False,
    platform_name: str | None = None,
    effects: ListenerEffects | None = None,
) -> dict[str, object]:
    """Start the listener at every login, and now, so a link works before the next one."""

    platform = platform_name or os.name
    if platform != "nt":
        raise LauncherError("autostart is currently available only on Windows")
    chosen = configuration.listener_port() if port is None else port
    if not 1 <= chosen <= 65535:
        raise LauncherError(f"invalid listener port {chosen}")
    current = _managed_status(directory, platform)
    _refuse_foreign_autostart(autostart_status(directory, platform_name=platform), force)
    AUTOSTART_STORE.write(subprocess.list2cmdline(_on_demand_arguments(current, chosen)))
    used = effects or ListenerEffects()
    reading = listener_status(
        directory, port=chosen, platform_name=platform, process_reader=used.process_reader
    )
    listener: dict[str, object] = {"state": str(reading["state"]), "pid": reading.get("pid")}
    if reading["state"] == "free":
        listener = {
            "state": "started",
            "pid": start_on_demand_listener(
                directory, chosen, platform_name=platform, effects=used
            ),
        }
    return {**autostart_status(directory, platform_name=platform), "listener": listener}


def disable_autostart(
    directory: str | os.PathLike[str] | None = None,
    *,
    force: bool = False,
    platform_name: str | None = None,
) -> dict[str, object]:
    """Stop starting the listener at login. One already running ends with the session."""

    platform = platform_name or os.name
    if platform != "nt":
        raise LauncherError("autostart is currently available only on Windows")
    found = autostart_status(directory, platform_name=platform)
    _refuse_foreign_autostart(found, force)
    if found["state"] != "disabled":
        AUTOSTART_STORE.delete()
    return autostart_status(directory, platform_name=platform)


def _on_demand_reading(
    root: Path, platform: str, port: int, used: ListenerEffects
) -> dict[str, object] | None:
    """The listener on `port` when this launcher can prove it is an on-demand one."""

    if used.process_reader is None and (platform != "nt" or os.name != "nt"):
        return None
    try:
        reading = listener_status(
            root, port=port, platform_name=platform, process_reader=used.process_reader
        )
    except LauncherError:
        return None
    return reading if reading["state"] == "managed" and reading.get("on_demand") else None


def _stop_on_demand(
    root: Path, platform: str, port: int, used: ListenerEffects
) -> dict[str, object]:
    """Stop it through `stop_listener`'s proof of ownership, and wait for the port."""

    stopped = stop_listener(
        root,
        port=port,
        platform_name=platform,
        process_reader=used.process_reader,
        process_guard=used.process_guard,
        stopper=used.stopper,
    )
    if stopped["state"] != "stopped":
        return stopped
    for _check in range(used.release_checks):
        reading = listener_status(
            root, port=port, platform_name=platform, process_reader=used.process_reader
        )
        if reading["state"] == "free":
            break
        time.sleep(0.2)
    return stopped


def install(
    directory: str | os.PathLike[str] | None = None,
    *,
    force: bool = False,
    platform_name: str | None = None,
    python: str | os.PathLike[str] | None = None,
    checkout: str | os.PathLike[str] | None = None,
    revision: str = "HEAD",
    releases: str | os.PathLike[str] | None = None,
    effects: ListenerEffects | None = None,
) -> dict[str, object]:
    """Pin one commit of a checkout and point the stable command at it.

    A listener holding the port on demand has code of the release it started from,
    and would load it on the next connection. So it stops before the pin moves and
    starts again after, proved by `stop_listener` as any stop is. A plain `serve` and
    a foreign listener are left alone, and nothing starts where nothing was running,
    unless the owner turned autostart on.
    """

    platform = platform_name or os.name
    root = Path(directory).expanduser().resolve() if directory else default_directory(platform)
    paths = _paths(root, platform)
    current = status(root, platform_name=platform)
    used = effects or ListenerEffects()
    autostart = autostart_status(root, platform_name=platform)
    autostart_on = autostart["state"] in {"enabled", "stale"}
    port = autostart["port"] if autostart_on and isinstance(autostart["port"], int) else None
    port = configuration.listener_port() if port is None else port
    holding = _on_demand_reading(root, platform, port, used)
    if current["state"] in {"unmanaged", "drifted"} and not force:
        raise LauncherError(
            f"refusing to replace {current['state']} launcher at {root}: {current.get('detail')}"
        )

    origin = Path(checkout).expanduser().resolve() if checkout else default_checkout()
    commit = checkout_revision(origin, revision)
    interpreter = Path(python).expanduser().resolve() if python else Path(sys.executable).resolve()
    if not interpreter.is_file():
        raise LauncherError(f"Python interpreter is missing: {interpreter}")
    release_root = Path(releases).expanduser().resolve() if releases else default_releases(platform)
    source = pin_release(origin, commit, release_root) / "valkama.py"

    shim = _shim_bytes(source)
    command, command_mode = _command_bytes(platform, interpreter)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "platform": platform,
        "source_script": str(source),
        "revision": commit,
        "checkout": str(origin),
        "python": str(interpreter),
        "files": {
            paths["command"].name: _sha256(command),
            paths["shim"].name: _sha256(shim),
        },
    }
    manifest_bytes = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")

    # Before the pin moves: a new interpreter in the manifest would make the running
    # listener unprovable, and an unprovable listener is one nobody may stop.
    stopped = _stop_on_demand(root, platform, port, used) if holding else None

    _atomic_write(paths["shim"], shim, stat.S_IREAD | stat.S_IWRITE)
    _atomic_write(paths["command"], command, command_mode)
    _atomic_write(paths["manifest"], manifest_bytes, stat.S_IREAD | stat.S_IWRITE)
    result = status(root, platform_name=platform)
    if result["state"] != "installed":
        raise LauncherError(f"installed launcher failed verification: {result.get('detail')}")
    return {
        **result,
        "on_demand_listener": _settle_on_demand(root, platform, port, stopped, autostart_on, used),
    }


def _settle_on_demand(
    root: Path,
    platform: str,
    port: int,
    stopped: dict[str, object] | None,
    autostart_on: bool,
    used: ListenerEffects,
) -> dict[str, object]:
    """What the new pin means for the listener: never a reason to fail the install."""

    try:
        if autostart_on:
            # The interpreter may have moved, and login runs what this value says.
            AUTOSTART_STORE.write(
                subprocess.list2cmdline(
                    _on_demand_arguments(status(root, platform_name=platform), port)
                )
            )
        if stopped is not None and stopped["state"] == "refused":
            return {"state": "refused", "port": port, "detail": stopped.get("detail")}
        was_running = stopped is not None
        if not was_running:
            if not autostart_on:
                return {"state": "none", "port": port}
            reading = listener_status(
                root, port=port, platform_name=platform, process_reader=used.process_reader
            )
            if reading["state"] != "free":
                return {"state": "none", "port": port, "detail": reading.get("detail")}
        pid = start_on_demand_listener(root, port, platform_name=platform, effects=used)
    except (OSError, LauncherError) as error:
        return {"state": "failed", "port": port, "detail": str(error)}
    return {"state": "restarted" if was_running else "started", "port": port, "pid": pid}


def uninstall(
    directory: str | os.PathLike[str] | None = None,
    *,
    force: bool = False,
    platform_name: str | None = None,
    effects: ListenerEffects | None = None,
) -> dict[str, object]:
    platform = platform_name or os.name
    root = Path(directory).expanduser().resolve() if directory else default_directory(platform)
    paths = _paths(root, platform)
    current = status(root, platform_name=platform)
    if current["state"] == "missing":
        return current
    if current["state"] in {"unmanaged", "drifted"} and not force:
        raise LauncherError(
            f"refusing to remove {current['state']} launcher at {root}: {current.get('detail')}"
        )
    # Only a value naming this launcher's shim is this launcher's to remove, and a
    # listener holding the port on demand cannot be proved once the manifest is gone.
    used = effects or ListenerEffects()
    autostart = autostart_status(root, platform_name=platform)
    if autostart["state"] in {"enabled", "stale"}:
        AUTOSTART_STORE.delete()
    port = autostart["port"] if isinstance(autostart["port"], int) else None
    port = configuration.listener_port() if port is None else port
    if current["state"] == "installed" and _on_demand_reading(root, platform, port, used):
        _stop_on_demand(root, platform, port, used)
    for name in ("command", "shim", "manifest"):
        with contextlib.suppress(FileNotFoundError):
            paths[name].unlink()
    with contextlib.suppress(OSError):
        root.rmdir()
    return status(root, platform_name=platform)
