"""The two cross-process locks one Improvements sidecar is held by.

Both are advisory OS file locks taken without waiting, so a caller that cannot
have the sidecar is told so immediately rather than blocking a request thread.
They answer different questions and are therefore separate locks:

* `RuntimeScopeLease` is held for the whole lifetime of a scope's jobs, and its
  release by the operating system on process death is what lets recovery tell an
  orphaned running job from one another live process still owns.
* `maintenance_lease` excludes concurrent writers for one mutation, migration or
  restore.

`runtime_quiescence` is the read of the first from the point of view of
maintenance: migration and restore may proceed only when no runtime owns the
scope.  Nothing here knows what a sidecar contains; it only knows the path.

The platform test is spelled `sys.platform == "win32"` rather than
`os.name == "nt"`.  The two select the same branch on CPython, but only the
first is one a type checker narrows on, and without narrowing every `fcntl`
constant reads as missing on Windows and every `msvcrt` one as missing
elsewhere.  The alternative was four suppressions that would themselves be
reported as unused on the other platform.
"""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import IO

from .contract import ImprovementError


class RuntimeScopeLease:
    """OS-released cross-process lock shared by jobs and maintenance."""

    def __init__(self, handle: IO[bytes]) -> None:
        self.handle: IO[bytes] | None = handle

    @classmethod
    def acquire(cls, sidecar: str | os.PathLike[str]) -> RuntimeScopeLease | None:
        lock_path = Path(str(Path(sidecar).resolve()) + ".runtime.lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(lock_path, "a+b")
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            handle.close()
            return None
        return cls(handle)

    def close(self) -> None:
        handle, self.handle = self.handle, None
        if handle is None:
            return
        handle.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        finally:
            handle.close()


@contextmanager
def runtime_quiescence(path: str | os.PathLike[str]):
    lease = RuntimeScopeLease.acquire(path)
    if lease is None:
        raise ImprovementError("store_busy", "active Improvements jobs prevent maintenance", 409)
    try:
        yield
    finally:
        lease.close()


@contextmanager
def maintenance_lease(path: str | os.PathLike[str]):
    """Cross-process writer exclusion shared by mutation, migration, and restore."""
    lock_path = Path(str(Path(path)) + ".maintenance.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = open(lock_path, "a+b")
    locked = False
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except (OSError, BlockingIOError) as exc:
            raise ImprovementError(
                "store_busy", "Improvements sidecar is held by another writer", 409
            ) from exc
        yield
    finally:
        if locked:
            handle.seek(0)
            try:
                if sys.platform == "win32":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        handle.close()
