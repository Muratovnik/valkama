"""The lock that serializes the processes bringing one store up.

A file beside the database rather than a SQLite lock, and taken before SQLite
is opened at all: the first writer creates the database, its WAL and its schema,
and a second process that got as far as opening it would already have written
the files the first one was about to create. What has to be serialized is
therefore the whole of `store.connect()`, which is more than any lock SQLite
itself could hold.

The lock is the operating system's on the file's first byte, so it goes with
the process that held it however that process ends. `try_lock` and `unlock`
are that primitive on its own, and `tests/machine_lock.py` takes the same one
for the heavy test runs of a machine.

`msvcrt` and `fcntl` are both in the standard library and neither is importable
on the other platform, so each is imported at the point it is used.
"""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import BinaryIO


def try_lock(handle: BinaryIO) -> bool:
    """Take the exclusive lock on the file `handle` has open, without waiting.

    The handle is opened `a+b`; on Windows the lock is on the first byte, which
    is written first when the file is empty, so whatever follows that byte stays
    readable to every other process.
    """

    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            if os.fstat(handle.fileno()).st_size == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def unlock(handle: BinaryIO) -> None:
    """Give back the lock `try_lock` took on this handle."""

    if sys.platform == "win32":
        import msvcrt

        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


# How long an open waits for another process's bring-up. A release opening a large
# store for the first time may run a one-time step under the lock, a verified snapshot
# and an index build, for seconds; every process opening the store meanwhile has to wait
# that out. The lock goes with its holder however it ends, so only a holder that is alive
# and stuck is ever waited for this long. Shorter than the two minutes a session's MCP
# front gives a release to start, so this lock, not the front, names what was waited for.
BRING_UP_WAIT_SECONDS = 60.0


@contextmanager
def migration_lock(path: str, *, timeout: float = BRING_UP_WAIT_SECONDS) -> Iterator[None]:
    """Serialize store open/migration writers without touching SQLite first."""

    lock_path = path + ".migration.lock"
    deadline = time.monotonic() + timeout
    with open(lock_path, "a+b") as handle:
        while not try_lock(handle):
            if time.monotonic() >= deadline:
                raise RuntimeError("timed out waiting for the store migration lock")
            time.sleep(0.05)
        try:
            yield
        finally:
            unlock(handle)
