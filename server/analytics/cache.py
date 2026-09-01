"""Process-owned caches for the analytics read model, and their keys.

Nothing here is stored in SQLite: analytics is a pure read model, so an entry
is keyed by the source identity that can make it stale — the database
snapshot, a journal file's stat identity, the query scope — rather than by a
TTL guess. `_CACHE` is a shared mutable singleton and is read through this
module, never copied into another one.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

from .timeline import _cache_time


class _AnalyticsCache:
    """Process-owned caches shared by journal providers and projections.

    The cache deliberately lives outside SQLite: analytics remains a pure
    read model and each entry is keyed by the source identity that can make
    it stale.  A single re-entrant lock keeps provider/index/projection
    updates safe when dashboard GET and SSE requests overlap in one process.
    """

    MAX_INDEXES = 64
    MAX_IDENTITY_RECORDS = 4096
    MAX_JOURNALS = 4096
    MAX_PROJECTIONS = 128

    def __init__(self) -> None:
        self.lock = threading.RLock()
        # Journal indexes are process-owned rather than provider-owned:
        # dashboard requests construct short-lived providers, and a fresh
        # provider must reuse the same bounded rglob result.  Each entry is
        # invalidated by the configured root directory stat identity so a
        # newly-created journal is discovered without a TTL guess.
        self.indexes: dict[tuple[str, tuple[str, ...]], dict[str, list[Path]]] = {}
        self.index_signatures: dict[tuple[str, tuple[str, ...]], tuple] = {}
        self.index_directories: dict[tuple[str, tuple[str, ...]], tuple] = {}
        self.identity: dict[tuple, bool] = {}
        self.identity_records: dict[tuple, frozenset[str]] = {}
        self.journal: dict[tuple, dict] = {}
        self.projections: dict[tuple, dict] = {}

    def put_projection(self, key: tuple, value: dict) -> None:
        if len(self.projections) >= self.MAX_PROJECTIONS and key not in self.projections:
            self.projections.pop(next(iter(self.projections)))
        self.projections[key] = value

    def put_index(
        self,
        key: tuple[str, tuple[str, ...]],
        value: dict[str, list[Path]],
        root_signature: tuple,
        directories: tuple,
    ) -> None:
        if len(self.indexes) >= self.MAX_INDEXES and key not in self.indexes:
            evicted = next(iter(self.indexes))
            self.indexes.pop(evicted, None)
            self.index_signatures.pop(evicted, None)
            self.index_directories.pop(evicted, None)
        self.indexes[key] = value
        self.index_signatures[key] = root_signature
        self.index_directories[key] = directories

    def put_bounded(self, mapping: dict, key: tuple, value: object, limit: int) -> None:
        if len(mapping) >= limit and key not in mapping:
            mapping.pop(next(iter(mapping)))
        mapping[key] = value


_CACHE = _AnalyticsCache()


def _canonical_path(path: str | Path) -> str:
    """Return a stable absolute path for cache keys without requiring exist."""

    try:
        return str(Path(path).expanduser().resolve(strict=False))
    except (OSError, RuntimeError, TypeError, ValueError):
        return os.path.abspath(os.fspath(path))


def _path_identity(path: Path) -> tuple[int, int] | None:
    """Return the stat identity used to invalidate one journal file."""

    try:
        stat = path.stat()
    except OSError:
        return None
    mtime_ns = getattr(stat, "st_mtime_ns", None)
    if mtime_ns is None:
        mtime_ns = int(stat.st_mtime * 1_000_000_000)
    return (int(mtime_ns), int(stat.st_size))


def _database_file_fingerprint(path: str) -> tuple:
    """Fingerprint the database and WAL sidecars without mutating SQLite."""

    entries = []
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(path + suffix)
        try:
            stat = candidate.stat()
        except OSError:
            entries.append((suffix, None))
            continue
        mtime_ns = getattr(stat, "st_mtime_ns", None)
        if mtime_ns is None:
            mtime_ns = int(stat.st_mtime * 1_000_000_000)
        ctime_ns = getattr(stat, "st_ctime_ns", None)
        if ctime_ns is None:
            ctime_ns = int(stat.st_ctime * 1_000_000_000)
        entries.append(
            (
                suffix,
                int(getattr(stat, "st_dev", 0)),
                int(getattr(stat, "st_ino", 0)),
                int(getattr(stat, "st_size", 0)),
                int(mtime_ns),
                int(ctime_ns),
            )
        )
    return tuple(entries)


def _connection_identity(conn: sqlite3.Connection) -> tuple:
    """Identify a stable SQLite snapshot without relying on local counters."""

    try:
        database = conn.execute("PRAGMA database_list").fetchone()
        path = str(database[2] or "") if database is not None else ""
    except sqlite3.Error:
        path = ""
    if not path:
        return (f":memory:{id(conn)}",)
    stable_path = _canonical_path(path)
    try:
        version = int(conn.execute("PRAGMA data_version").fetchone()[0])
    except (sqlite3.Error, TypeError, ValueError, IndexError):
        version = 0
    try:
        schema = int(conn.execute("PRAGMA schema_version").fetchone()[0])
    except (sqlite3.Error, TypeError, ValueError, IndexError):
        schema = 0
    # File identity/mtime and WAL sidecars are the stable snapshot marker;
    # data_version is only an additional hint for an open connection. The
    # connection-local total_changes counter is intentionally excluded.
    return (stable_path, _database_file_fingerprint(stable_path), version, schema)


def _provider_scope(provider: object) -> tuple:
    scope = getattr(provider, "cache_scope", None)
    if callable(scope):
        try:
            return scope()
        except (OSError, RuntimeError, TypeError, ValueError):
            pass
    return (provider.__class__.__module__, provider.__class__.__qualname__, id(provider))


def _projection_key(
    conn: sqlite3.Connection,
    space: str | None,
    *,
    as_of: object,
    date_from: object,
    date_to: object,
    epic: int | str | None,
    client: str | None,
    agent: str | None,
    environment: str | None,
    tool: str | None,
    status: str | None,
    provider: object,
) -> tuple:
    """Build a complete read-model key, including journal roots and filters."""

    return (
        "dashboard",
        _connection_identity(conn),
        str(space or ""),
        _cache_time(as_of),
        _cache_time(date_from),
        _cache_time(date_to),
        str(epic) if epic is not None else None,
        str(client or ""),
        str(agent or ""),
        str(environment or ""),
        str(tool or ""),
        str(status or ""),
        _provider_scope(provider),
    )


def clear_analytics_cache() -> None:
    """Clear process-owned analytics caches (primarily for tests/tools)."""

    with _CACHE.lock:
        _CACHE.indexes.clear()
        _CACHE.index_signatures.clear()
        _CACHE.index_directories.clear()
        _CACHE.identity.clear()
        _CACHE.identity_records.clear()
        _CACHE.journal.clear()
        _CACHE.projections.clear()
