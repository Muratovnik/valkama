"""How often each analytics surface is used: one count per day and kind, written and read.

The owner reads these counts to tell the surfaces that are used from the ones nobody
opens. A use is counted where it happens, on this machine, and nothing about it leaves
the store: the table (`store`) holds a day, a kind and a count, and nothing else.
"""

from __future__ import annotations

import datetime as dt
import sqlite3

from .store import KINDS


class UseError(ValueError):
    """A use this module does not count, saying why."""


def add(conn: sqlite3.Connection, kind: str, day: dt.date) -> int:
    """Count one use of `kind` on `day`, commit it, and return that day's count of it."""

    if kind not in KINDS:
        raise UseError(f"kind must be one of {', '.join(KINDS)}")
    [(count,)] = conn.execute(
        "INSERT INTO analytics_surface_uses(day, kind, count) VALUES (?, ?, 1)"
        " ON CONFLICT(day, kind) DO UPDATE SET count = count + 1"
        " RETURNING count",
        (day.isoformat(), kind),
    ).fetchall()
    conn.commit()
    return int(count)


__all__ = ["KINDS", "UseError", "add"]
