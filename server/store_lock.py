"""The lock that serializes the processes bringing one store up.

A file beside the database rather than a SQLite lock, and taken before SQLite
is opened at all: the first writer creates the database, its WAL and its schema,
and a second process that got as far as opening it would already have written
the files the first one was about to create. What has to be serialized is
therefore the whole of `store.connect()`, which is more than any lock SQLite
itself could hold.

`msvcrt` and `fcntl` are both in the standard library and neither is importable
on the other platform, so each is imported at the point it is used.
"""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager


@contextmanager
def migration_lock(path: str, *, timeout: float = 5.0) -> Iterator[None]:
    """Serialize store open/migration writers without touching SQLite first."""

    lock_path = path + ".migration.lock"
    deadline = time.monotonic() + timeout
    handle = open(lock_path, "a+b")
    acquired = False
    try:
        while True:
            try:
                if sys.platform == "win32":
                    import msvcrt

                    handle.seek(0)
                    if handle.tell() == os.fstat(handle.fileno()).st_size == 0:
                        handle.write(b"0")
                        handle.flush()
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("timed out waiting for the store migration lock") from None
                time.sleep(0.05)
        yield
    finally:
        try:
            if acquired:
                if sys.platform == "win32":
                    import msvcrt

                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
