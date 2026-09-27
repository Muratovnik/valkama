"""Stdlib-only policy helpers for immutable assets and runtime identity.

The HTTP handler owns path validation and body streaming. This module derives
deterministic response metadata and captures the source/static material that a
long-lived server process serves, so launchers can compare one identity.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"
RUNTIME_INTERFACE_VERSION = "runtime"

# The checkout this process serves from. Every caller passes these into the
# functions below, so they belong with the identity they describe rather than
# with whichever surface happens to read them.
SOURCE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(SOURCE_ROOT, "web", "dist")


def release_version() -> str:
    """Read the one release number shared by the server and packaging."""

    return (Path(SOURCE_ROOT) / "VERSION").read_text(encoding="utf-8").strip()


@dataclass(frozen=True)
class AssetSnapshot:
    """One immutable response representation captured before the server starts."""

    path: str
    stat: object
    body: bytes


@dataclass(frozen=True)
class RuntimeSnapshot:
    """The runtime identity and static bytes owned by one server process."""

    identity: Mapping[str, object]
    assets: Mapping[str, AssetSnapshot]


def canonical_json(value: object) -> str:
    """Serialize identity inputs once for both the HTTP and CLI surfaces."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _canonical_path(path: str | os.PathLike[str]) -> str:
    # The identity deliberately names the checkout roots. Two equal builds in
    # different worktrees must not silently share a long-lived listener.
    return os.path.normcase(os.path.normpath(os.path.abspath(os.fspath(path))))


def _digest_entries(entries: list[dict[str, str]]) -> str:
    representation = canonical_json(entries).encode("utf-8")
    return hashlib.sha256(representation).hexdigest()


def _source_candidates(source_root: str | os.PathLike[str]) -> tuple[Path, list[Path]]:
    """The modules a running process is made of, and the root they are named from."""

    root = Path(source_root)
    if root.is_file():
        return root.parent, [root]
    # Only the deployed backend contributes to its identity. Development
    # dependencies, tests and private recovery copies can change independently
    # of the running service and must not make a reusable listener look stale.
    modules = [
        path
        for path in (root / "server").rglob("*.py")
        if path.is_file() and "__pycache__" not in path.parts and not path.name.startswith("test_")
    ]
    for name in ("valkama.py", "VERSION"):
        runtime_file = root / name
        if runtime_file.is_file():
            modules.append(runtime_file)
    return root, modules


def _source_entries(source_root: str | os.PathLike[str]) -> list[dict[str, str]]:
    relative_root, candidates = _source_candidates(source_root)
    entries: list[dict[str, str]] = []
    for path in sorted(candidates, key=lambda item: os.fspath(item).casefold()):
        try:
            body = path.read_bytes()
            relative = path.relative_to(relative_root).as_posix()
        except (OSError, ValueError):
            continue
        entries.append({"path": relative, "sha256": hashlib.sha256(body).hexdigest()})
    return entries


def _static_entries(
    dist_dir: str | os.PathLike[str],
) -> tuple[list[dict[str, str]], dict[str, AssetSnapshot]]:
    root = Path(dist_dir)
    entries: list[dict[str, str]] = []
    assets: dict[str, AssetSnapshot] = {}
    if not root.is_dir():
        return entries, assets
    try:
        candidates = sorted(
            (path for path in root.rglob("*") if path.is_file()),
            key=lambda item: os.fspath(item).casefold(),
        )
    except OSError:
        return entries, assets
    for path in candidates:
        try:
            body = path.read_bytes()
            file_stat = path.stat()
            relative = path.relative_to(root).as_posix()
        except (OSError, ValueError):
            continue
        digest = hashlib.sha256(body).hexdigest()
        entries.append({"path": relative, "sha256": digest})
        assets[relative] = AssetSnapshot(os.fspath(path), file_stat, body)
    return entries, assets


def _identity_from_material(
    source_root: str | os.PathLike[str],
    source_entries: list[dict[str, str]],
    dist_dir: str | os.PathLike[str],
    static_entries: list[dict[str, str]],
) -> dict[str, object]:
    material = {
        "interface_version": RUNTIME_INTERFACE_VERSION,
        "backend": {
            "root": _canonical_path(source_root),
            "sha256": _digest_entries(source_entries),
        },
        "static": {
            "root": _canonical_path(dist_dir),
            "sha256": _digest_entries(static_entries),
        },
    }
    identity = hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()
    return {**material, "identity": identity}


def capture_runtime_snapshot(
    source_root: str | os.PathLike[str],
    dist_dir: str | os.PathLike[str],
) -> RuntimeSnapshot:
    """Capture source/static identity and immutable static bytes at startup."""

    source_entries = _source_entries(source_root)
    static_entries, assets = _static_entries(dist_dir)
    return RuntimeSnapshot(
        _identity_from_material(source_root, source_entries, dist_dir, static_entries),
        assets,
    )


def runtime_identity(
    source_root: str | os.PathLike[str],
    dist_dir: str | os.PathLike[str],
) -> dict[str, object]:
    """Calculate the exact identity emitted by a newly started server."""

    source_entries = _source_entries(source_root)
    static_entries, _assets = _static_entries(dist_dir)
    return _identity_from_material(source_root, source_entries, dist_dir, static_entries)


def backend_digest(source_root: str | os.PathLike[str]) -> str:
    """The content digest of the modules a process is running.

    The backend half of `runtime_identity`, on its own. An MCP server serves no
    static assets, so hashing `web/dist` to answer a question about its own code
    would cost the most and say the least.
    """

    return _digest_entries(_source_entries(source_root))


def source_stamp(source_root: str | os.PathLike[str]) -> str:
    """A stat-only probe over exactly the files `backend_digest` reads.

    Reading every module to answer "has anything changed?" is affordable once at
    startup and not on every tool call. This costs one stat per file and is a
    reason to go and read, never an answer by itself.
    """

    relative_root, candidates = _source_candidates(source_root)
    entries: list[dict[str, str]] = []
    for path in sorted(candidates, key=lambda item: os.fspath(item).casefold()):
        try:
            info = path.stat()
            relative = path.relative_to(relative_root).as_posix()
        except (OSError, ValueError):
            continue
        entries.append({"path": relative, "stat": f"{info.st_mtime_ns}:{info.st_size}"})
    return _digest_entries(entries)


class SourceWatch:
    """Whether the code this process runs is still the code on disk.

    A stdio MCP server is a long-lived process its client spawned from a working
    tree, and nothing makes it exit when that tree moves: the next session gets a
    new process from the new code while this one keeps answering from the old,
    against the same store. The HTTP listener has refused that mismatch since it
    gained a runtime identity. This asks the same question cheaply enough to ask
    it on every call.

    Two signals, because they answer different questions. The stamp is stat only
    and says something may have happened; the digest reads the modules and says
    whether anything did. A `git checkout` that restores identical bytes moves
    every mtime and changes no code, and crying drift over that would teach the
    reader to ignore the warning that matters.

    Drift is one-way. A process cannot become current again -- only a restart
    does that -- so once this is true it stays true and stops reading the tree.
    """

    def __init__(
        self,
        source_root: str | os.PathLike[str],
        *,
        interval: float = 5.0,
        clock: object = None,
    ) -> None:
        self._root = source_root
        self._interval = interval
        self._clock = clock if callable(clock) else time.monotonic
        self._stamp = source_stamp(source_root)
        self._digest = backend_digest(source_root)
        self._checked = self._clock()
        self._drifted = False

    @property
    def build_id(self) -> str:
        """Short digest of the code this process started with.

        Semver build metadata for the MCP handshake, and the only way a person
        looking at two running servers can tell whether they are the same one.
        """

        return self._digest[:12]

    def drifted(self) -> bool:
        if self._drifted:
            return True
        now = self._clock()
        if now - self._checked < self._interval:
            return False
        self._checked = now
        stamp = source_stamp(self._root)
        if stamp == self._stamp:
            return False
        self._stamp = stamp
        if backend_digest(self._root) == self._digest:
            return False
        self._drifted = True
        return True


def _number(value: object) -> float:
    """Whatever a caller handed over, as a number, or zero if it is not one."""

    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


def _stat_identity(file_stat: object) -> tuple[int, int]:
    """Read (mtime_ns, size) from a stat result, a mapping, or a plain pair.

    Attributes are tried first and that ordering is the point: `os.stat_result`
    is a tuple subclass, so a `isinstance(..., tuple)` branch placed above this
    one claims the documented primary input and reads `st_mode` and `st_ino` as
    the mtime and size. It did, and nothing caught it, because the only caller
    also hashes the representation bytes and so stayed correct by accident.
    """

    mtime: float
    size: float
    if hasattr(file_stat, "st_mtime_ns") or hasattr(file_stat, "st_mtime"):
        exact = getattr(file_stat, "st_mtime_ns", None)
        if exact is None:
            mtime = _number(getattr(file_stat, "st_mtime", 0)) * 1_000_000_000
        else:
            mtime = _number(exact)
        size = _number(getattr(file_stat, "st_size", 0))
    elif isinstance(file_stat, Mapping):
        mtime = _number(file_stat.get("st_mtime_ns", file_stat.get("mtime_ns", 0)))
        size = _number(file_stat.get("st_size", file_stat.get("size", 0)))
    elif isinstance(file_stat, (tuple, list)) and len(file_stat) >= 2:
        mtime, size = _number(file_stat[0]), _number(file_stat[1])
    else:
        mtime, size = 0.0, 0.0
    return int(mtime), int(size)


def _etag(request_path: str | os.PathLike[str], file_stat: object, representation: bytes) -> str:
    canonical = os.path.normcase(os.path.normpath(os.fspath(request_path)))
    mtime_ns, size = _stat_identity(file_stat)
    identity = f"{canonical}\0{mtime_ns}\0{size}".encode()
    digest = hashlib.sha256(identity + b"\0" + representation).hexdigest()
    return f'"{digest}"'


def _matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    # A conditional request can list several validators.  Wildcard is safe
    # for an existing immutable asset; weak validators are not strong matches.
    for token in (part.strip() for part in str(if_none_match).split(",")):
        # `token` here is an HTTP entity-tag validator, not a credential.
        if token == "*" or token == etag:  # noqa: S105
            return True
    return False


def hashed_asset_policy(
    request_path: str | os.PathLike[str],
    file_stat: object | None = None,
    if_none_match: str | None = None,
    *,
    representation: bytes | bytearray | memoryview | None = None,
) -> dict[str, object]:
    """Return immutable cache metadata and the deterministic 304 decision.

    ``file_stat`` may be an ``os.stat_result`` or a simple ``(mtime_ns,
    size)`` pair. Supplying it avoids a second stat in an HTTP handler that
    already validated the file. The ETag is strong (quoted, never ``W/``) and
    hashes the representation bytes authoritatively, with path/stat identity
    included to avoid cross-resource collisions. ``representation`` can be
    supplied when the handler already has the response bytes.
    """

    path = os.fspath(request_path)
    if file_stat is None:
        file_stat = Path(path).stat()
    body = Path(path).read_bytes() if representation is None else bytes(representation)
    etag = _etag(path, file_stat, body)
    return {
        "cache_control": IMMUTABLE_CACHE_CONTROL,
        "etag": etag,
        "not_modified": _matches(if_none_match, etag),
    }


__all__ = [
    "IMMUTABLE_CACHE_CONTROL",
    "RUNTIME_INTERFACE_VERSION",
    "AssetSnapshot",
    "RuntimeSnapshot",
    "SourceWatch",
    "backend_digest",
    "canonical_json",
    "capture_runtime_snapshot",
    "hashed_asset_policy",
    "runtime_identity",
    "source_stamp",
]
