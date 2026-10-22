"""Bounded process-owned caches for read-only client journal observations."""

from __future__ import annotations

import os
import threading
from pathlib import Path


class _JournalCache:
    """Process-owned caches shared by short-lived journal providers.

    The cache deliberately lives outside SQLite: journal telemetry remains a pure
    read model and each entry is keyed by the source identity that can make
    it stale.  A single re-entrant lock keeps provider/index/projection
    updates safe when execution usage requests overlap in one process.
    """

    MAX_INDEXES = 64
    MAX_IDENTITY_RECORDS = 4096
    MAX_JOURNALS = 4096

    def __init__(self) -> None:
        self.lock = threading.RLock()
        # Journal indexes are process-owned rather than provider-owned:
        # usage requests construct short-lived providers, and a fresh
        # provider must reuse the same bounded rglob result.  Each entry is
        # invalidated by the configured root directory stat identity so a
        # newly-created journal is discovered without a TTL guess.
        self.indexes: dict[tuple[str, tuple[str, ...]], dict[str, list[Path]]] = {}
        self.index_signatures: dict[tuple[str, tuple[str, ...]], tuple] = {}
        self.index_directories: dict[tuple[str, tuple[str, ...]], tuple] = {}
        self.identity: dict[tuple, bool] = {}
        self.identity_records: dict[tuple, frozenset[str]] = {}
        self.journal: dict[tuple, dict] = {}

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


JOURNAL_CACHE = _JournalCache()


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
