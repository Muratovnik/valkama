"""The light open: a read-write connection to a store that exists and is current.

No migration lock, no adoption, no integrity check, and never a new file. A hook
process does not bring a store up; the next full `store.connect()` does, and until
then what a hook would have written waits in the spool.

It imports only `os` and the C module under `sqlite3`, because the status line
command opens the store this way on every refresh of the client's status line and
the `sqlite3` package, with the `urllib.parse` a URI would otherwise be quoted by,
costs that command a measurable share of its budget. The classes are the same
either way: `_sqlite3.Error` is `sqlite3.Error`.
"""

from __future__ import annotations

import os

TYPE_CHECKING = False
if TYPE_CHECKING:
    import sqlite3

#: How long a hook waits for a writer before it spools: far under the shortest
#: client hook timeout (Codex gives `SessionEnd` three seconds).
BUSY_TIMEOUT_SECONDS = 1.0

#: What a path keeps unquoted in a URI: `urllib.parse.quote(path, safe="/:")`.
_UNQUOTED = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~/:")


class UnwritableError(Exception):
    """The store cannot take a direct write now; `reason` says why, for the spool line."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


def uri(path: str, mode: str = "rw") -> str:
    """A URI for an existing file, read-write or `ro`: SQLite refuses rather than creating one."""

    absolute = os.path.abspath(path).replace(os.sep, "/")
    if not absolute.startswith("/"):
        absolute = "/" + absolute
    quoted = "".join(
        chr(byte) if byte in _UNQUOTED else f"%{byte:02X}" for byte in absolute.encode("utf-8")
    )
    return f"file://{quoted}?mode={mode}"


def reason(error: Exception) -> str:
    """`busy` for a store another writer holds, `error` for anything else."""

    text = str(error).lower()
    return "busy" if "locked" in text or "busy" in text else "error"


def open_light(
    path: str, schema_version: int, *, timeout: float = BUSY_TIMEOUT_SECONDS
) -> sqlite3.Connection:
    """Open a store that exists and is at `schema_version`, or raise `UnwritableError`."""

    import _sqlite3

    if not os.path.isfile(path):
        raise UnwritableError("missing")
    try:
        conn = _sqlite3.connect(uri(path), uri=True, timeout=timeout, isolation_level=None)
    except _sqlite3.Error as error:
        raise UnwritableError("error", str(error)) from error
    try:
        stored = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if stored != schema_version:
            raise UnwritableError("schema", f"store {stored}, hook {schema_version}")
        conn.execute("PRAGMA foreign_keys=ON")
    except _sqlite3.Error as error:
        conn.close()
        raise UnwritableError(reason(error), str(error)) from error
    except UnwritableError:
        conn.close()
        raise
    return conn
