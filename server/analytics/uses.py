"""How often each analytics surface is used: one count per day and kind, written and read.

The owner reads these counts to tell the surfaces that are used from the ones nobody
opens. A use is counted where it happens, on this machine, and nothing about it leaves
the store: the table (`store`) holds a day, a kind and a count, and nothing else. The
day is the caller's, at the offset from UTC it states, checked as the usage read checks
its own (`usage.caller_zone`).
"""

from __future__ import annotations

import datetime as dt
import re
import sqlite3

from . import usage
from .store import KINDS

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class UseError(ValueError):
    """A use this module does not count, or a read of the counts it cannot answer."""


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


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


def record(conn: sqlite3.Connection, kind: str, utc_offset: int) -> dict:
    """Count one use of `kind` today, the day it is now at the caller's `utc_offset`."""

    day = _now().astimezone(usage.caller_zone(utc_offset)).date()
    return {"day": day.isoformat(), "kind": kind, "count": add(conn, kind, day)}


def _date(text: str, name: str) -> dt.date:
    try:
        if _DATE.fullmatch(text):
            return dt.date.fromisoformat(text)
    except ValueError:
        pass
    raise UseError(f"{name} must be a date, such as 2030-03-04")


def read(conn: sqlite3.Connection, start: str, end: str) -> dict:
    """The counts of the days from `start` up to `end`, which is not included.

    `total` holds every kind, 0 for one never counted; `days` holds each day with a count,
    oldest first, with every kind.
    """

    first, after = _date(start, "from"), _date(end, "to")
    if after <= first:
        raise UseError("to must be later than from")
    days: dict[str, dict[str, int]] = {}
    for day, kind, count in conn.execute(
        "SELECT day, kind, count FROM analytics_surface_uses WHERE day >= ? AND day < ?",
        (first.isoformat(), after.isoformat()),
    ):
        days.setdefault(day, dict.fromkeys(KINDS, 0))[kind] = count
    return {
        "from": first.isoformat(),
        "to": after.isoformat(),
        "total": {kind: sum(counts[kind] for counts in days.values()) for kind in KINDS},
        "days": [{"day": day, "counts": days[day]} for day in sorted(days)],
    }


__all__ = ["KINDS", "UseError", "add", "read", "record"]
