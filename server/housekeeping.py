"""Maintenance a long-lived process runs on its own store at start-up.

Kept out of `store.connect()` on purpose: bring-up stays bring-up, and every
doctor, export and test that opens a store would otherwise write as a side
effect. A surface that owns a lasting connection -- the MCP loop, `serve` --
calls this once after it has opened the store.

Today it delivers the hook spool: events a hook process could not write
because the store was busy, missing or at another schema version.
"""

from __future__ import annotations

import sqlite3

from . import store
from .hooks import ingest, spool


def drain_spool(conn: sqlite3.Connection, *, seconds: float | None = None) -> ingest.DrainResult:
    """Deliver every pending spool file beside this store, oldest first.

    `conn` must not be inside a transaction: each file is its own. With
    `seconds`, the drain stops starting new files once that much time has
    passed, and leaves the rest for the next run.
    """

    return ingest.drain(conn, spool.directory(store.db_path()), seconds=seconds)
