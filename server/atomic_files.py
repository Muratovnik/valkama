"""Putting a file in place whole, and waiting out a holder Windows refuses that for.

A file is written under a name of its own beside its target and then takes the
target's name in one rename, so a reader finds the previous file or the new one,
never half of one.

On Windows that rename is refused while another handle has the target open
without sharing its deletion, and Python's `open()` opens exactly such a handle:
a thread or a process reading the file at that moment, a scanner or an indexer
reading what was just written. Each of them lets go by itself, so the refusal is
waited out for about two seconds and then raised as it came. A write that gave
up at once lost the state it carried. Any other failure is raised at once, and
POSIX, which renames over an open file, never waits.

The hooks import this module, so it imports nothing beyond the standard
library's C parts.
"""

from __future__ import annotations

import os
import time

# As in `hooks.notify`: `typing` is a cost the hooks do not spend; the checker reads the name.
TYPE_CHECKING = False
if TYPE_CHECKING:
    from collections.abc import Callable

# Access denied and sharing violation: what Windows answers while something has
# the file, or a file in the directory, open.
_PASSING_WINERRORS = frozenset({5, 32})
# A reader in a tight loop holds the file most of the time, so the rename is tried
# often rather than a few times: each try is cheap, and one in many lands.
_WAIT_SECONDS = 0.01
# A file being replaced is waited for about two seconds: a reader of it lets go
# within that. A store or a release renamed into place, about one, so that a holder
# that does not let go is refused promptly.
_REPLACE_ATTEMPTS = 200
_RENAME_ATTEMPTS = 100

_FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)


def _when_free(move: Callable[[str, str], None], source: str, target: str, attempts: int) -> None:
    for _ in range(attempts - 1):
        try:
            move(source, target)
        except OSError as error:
            if getattr(error, "winerror", None) not in _PASSING_WINERRORS:
                raise
            time.sleep(_WAIT_SECONDS)
        else:
            return
    move(source, target)


def rename_when_free(source: str, target: str) -> None:
    """`os.rename`, waiting out a holder that lets go by itself; for a directory too."""

    _when_free(os.rename, source, target, _RENAME_ATTEMPTS)


def replace_when_free(source: str, target: str) -> None:
    """`os.replace`, waiting out a reader that has the target open."""

    _when_free(os.replace, source, target, _REPLACE_ATTEMPTS)


def write(
    path: str | os.PathLike[str], data: bytes, *, mode: int | None = None, durable: bool = True
) -> None:
    """Replace the file at `path` with `data` whole, or leave it as it was.

    The directory must exist: creating it is the caller's decision, and for a store's
    directory a wrong one. The scratch file is `.<name>.<random>.tmp` beside the target and
    is gone when this returns or raises. `mode` is given to the file before it takes the
    target's name. `durable` forces the bytes to disk before the rename, a few milliseconds
    a caller whose file may be lost without harm need not spend.
    """

    target = os.fspath(path)
    folder, name = os.path.split(target)
    scratch = os.path.join(folder, f".{name}.{os.urandom(6).hex()}.tmp")
    descriptor = os.open(scratch, _FLAGS, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            if durable:
                os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(scratch, mode)
        replace_when_free(scratch, target)
    finally:
        try:
            os.remove(scratch)
        except FileNotFoundError:
            pass
