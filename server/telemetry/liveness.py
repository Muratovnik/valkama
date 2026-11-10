"""When this machine was seen running: a tick, and the intervals it leaves.

A gap between two transcript records may be a long script or a machine that was off,
and the transcript cannot tell. So a long-lived process writes down that it is alive
once a minute. Ticks no further apart than `BREAK_SECONDS` extend one interval, and a
longer silence starts the next. A silence means the machine was off, asleep or no
Valkama process ran: in every case the work was not observed. ActivityWatch merges its
heartbeats the same way, while they come no rarer than its `pulsetime`.

The intervals live in their own small database beside the store and not in the store.
Any commit to the store moves `PRAGMA data_version`, which wakes `watchers.Watchers`
and every open event stream to rebuild the board, so a tick there would rebuild it
twice a minute with nothing changed. The price of the separate file: it is not in the
store's recovery points, and an ordinary query needs `ATTACH` to reach it. Losing it
costs little, since segments already read keep their numbers, and only what is read
after that counts as `estimated` until the next tick.

The connection is opened for each tick and closed after it, so a process holds no file
between ticks, and the defaults of SQLite's rollback journal apply: each new interval
and extension is on disk before the commit returns, which is what a power cut needs.
Several processes tick at once and only the first in `_LEAST_ADVANCE` writes.

A recovery point that reads usage again needs the file as it was, so `copy_beside` puts
a verified copy next to a snapshot of the store, under the name a store restored from
that snapshot looks for. Restoring is copying both. The schema-15 upgrade and a rebuild
of every run take one; the copies this process made are what `recovery_point` answers.
"""

from __future__ import annotations

import bisect
import contextlib
import datetime as dt
import os
import sqlite3
from collections.abc import Sequence

from .. import store_backups

TICK_SECONDS = 60.0
#: A tick this much later than the last one starts a new interval: two missed ticks, so
#: a busy machine or a process restart is not taken for a machine that was off. A hole
#: shorter than this is therefore never seen, and a gap this short always counts.
BREAK_SECONDS = 180.0
#: How long a gap with no tick to judge it by may count, for time before the first tick.
#: Of 162,157 recorded foreground tool calls the longest took 858 s, and of the model
#: waits over 100 s none fell between 600 s and 900 s, so a longer silence is not one call.
HISTORY_LIMIT_SECONDS = 900.0

OBSERVED = "observed"
ESTIMATED = "estimated"

#: Ticks closer than this to the last one write nothing, however many processes tick.
_LEAST_ADVANCE = 30.0
_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS liveness("
    " id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, last_at TEXT NOT NULL)"
)
_STAMP = "%Y-%m-%dT%H:%M:%SZ"


def path_for(store_path: str) -> str:
    """Where one store's intervals are: beside it, under its name."""

    return f"{store_path}.liveness"


#: What a copy is called until it is verified.
_PARTIAL = ".partial"
#: The snapshots this process put a verified liveness copy beside, by the store's path.
_TAKEN: dict[str, str] = {}


def _key(store_path: str) -> str:
    return os.path.normcase(os.path.abspath(store_path))


def copy_beside(store_path: str, snapshot_path: str, prefix: str) -> bool:
    """Put a verified copy of the store's liveness file beside one of its snapshots.

    False, and nothing copied, when the store has no liveness file. A copy whose
    snapshot retention has removed goes too: `prefix` is the one the snapshots' names
    start with, and only a `.liveness` file beside such a name is touched.
    """

    source = path_for(store_path)
    if not os.path.isfile(source):
        return False
    _copy(source, path_for(snapshot_path))
    _TAKEN[_key(store_path)] = snapshot_path
    directory = os.path.dirname(snapshot_path)
    for name in os.listdir(directory):
        if not (name.startswith(f"{prefix}-") and name.endswith(".sqlite3.liveness")):
            continue
        copy = os.path.join(directory, name)
        if not os.path.isfile(copy.removesuffix(".liveness")):
            with contextlib.suppress(FileNotFoundError):
                os.remove(copy)
    return True


def recovery_point(store_path: str) -> str | None:
    """The newest snapshot this process took of the store with its liveness copy, if still there."""

    snapshot = _TAKEN.get(_key(store_path))
    if snapshot is None or not (os.path.isfile(snapshot) and os.path.isfile(path_for(snapshot))):
        return None
    return snapshot


def _copy(source: str, destination: str) -> None:
    """Copy the liveness database whole, and refuse a copy that does not hold the same rows.

    The copy is made under a name of its own and takes `destination` only once verified,
    so a restore never finds a copy that failed beside a good snapshot. A tick waits while
    it is copied: the read lock is held from the hash to the end of the copy, and a tick
    gives up after a second, which the next tick makes good.
    """

    partial = destination + _PARTIAL
    try:
        with (
            contextlib.closing(sqlite3.connect(source, timeout=1.0, isolation_level=None)) as held,
            contextlib.closing(sqlite3.connect(partial)) as copy,
        ):
            held.execute("BEGIN")
            try:
                identity = store_backups.logical_identity(held)
                held.backup(copy)
            finally:
                held.execute("COMMIT")
        if store_backups.snapshot_identity(partial) != identity:
            raise RuntimeError("the liveness copy does not hold what the liveness file holds")
        os.replace(partial, destination)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.remove(partial)


def _text(moment: float) -> str:
    return dt.datetime.fromtimestamp(moment, dt.UTC).strftime(_STAMP)


def _moment(text: str) -> float:
    return dt.datetime.strptime(text, _STAMP).replace(tzinfo=dt.UTC).timestamp()


def tick(store_path: str, now: float) -> None:
    """Say this process is alive at `now`, unless a store with no directory has nowhere to say it.

    A store's directory may not be created here: `store_adoption` reads an existing
    directory as a store already adopted.
    """

    if not os.path.isdir(os.path.dirname(os.path.abspath(store_path))):
        return
    conn = sqlite3.connect(path_for(store_path), timeout=1.0, isolation_level=None)
    try:
        conn.execute(_SCHEMA)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT id, last_at FROM liveness ORDER BY id DESC LIMIT 1").fetchone()
        if row is None or now - _moment(row[1]) > BREAK_SECONDS:
            conn.execute(
                "INSERT INTO liveness(started_at, last_at) VALUES (?, ?)",
                (_text(now), _text(now)),
            )
        elif now - _moment(row[1]) >= _LEAST_ADVANCE:
            conn.execute("UPDATE liveness SET last_at = ? WHERE id = ?", (_text(now), row[0]))
        conn.execute("COMMIT")
    finally:
        conn.close()


def intervals(store_path: str) -> list[tuple[float, float]]:
    """Every interval, oldest first; none when no tick was ever written."""

    path = path_for(store_path)
    if not os.path.isfile(path):
        return []
    conn = sqlite3.connect(path, timeout=1.0, isolation_level=None)
    try:
        conn.execute(_SCHEMA)
        return [
            (_moment(row[0]), _moment(row[1]))
            for row in conn.execute("SELECT started_at, last_at FROM liveness ORDER BY id")
        ]
    finally:
        conn.close()


class Coverage:
    """What the intervals say about one stretch of time."""

    def __init__(self, seen: Sequence[tuple[float, float]]) -> None:
        self._first = seen[0][0] if seen else None
        self._holes = [(seen[i][1], seen[i + 1][0]) for i in range(len(seen) - 1)]
        if seen:
            self._holes.append((seen[-1][1], float("inf")))
        self._ends = [hole[1] for hole in self._holes]

    def split(self, start: float, end: float) -> tuple[list[tuple[float, float, str]], float]:
        """The parts of `start`..`end` that may hold work, each with its quality, and the rest.

        Before the first tick nothing can judge a gap, so it counts up to
        `HISTORY_LIMIT_SECONDS` and is `estimated`. From then on what lies in a hole
        between intervals does not count. A hole as short as `BREAK_SECONDS` inside the
        stretch is not a hole: the two records around it are alive themselves.
        """

        total = end - start
        if total <= 0:
            return [], 0.0
        parts: list[tuple[float, float, str]] = []
        cursor = start
        if self._first is None or cursor < self._first:
            before = end if self._first is None else min(end, self._first)
            parts.append((cursor, cursor + min(before - cursor, HISTORY_LIMIT_SECONDS), ESTIMATED))
            cursor = before
        if cursor < end:
            parts.extend(self._observed(cursor, end))
        return parts, total - sum(part[1] - part[0] for part in parts)

    def holes_within(self, start: float, end: float) -> float:
        """How much of a stretch lies in holes. Before the first tick none is known of."""

        if self._first is None or end <= self._first:
            return 0.0
        start = max(start, self._first)
        return (end - start) - sum(part[1] - part[0] for part in self._observed(start, end))

    def quality_at(self, moment: float) -> str:
        """Whether a tick can speak for this moment."""

        return OBSERVED if self._first is not None and moment >= self._first else ESTIMATED

    def _observed(self, start: float, end: float) -> list[tuple[float, float, str]]:
        if end - start <= BREAK_SECONDS:
            return [(start, end, OBSERVED)]
        parts: list[tuple[float, float, str]] = []
        cursor = start
        index = bisect.bisect_right(self._ends, start)
        for hole_start, hole_end in self._holes[index:]:
            if hole_start >= end:
                break
            dark_start, dark_end = max(hole_start, start), min(hole_end, end)
            if dark_end - dark_start <= BREAK_SECONDS:
                continue
            if dark_start > cursor:
                parts.append((cursor, dark_start, OBSERVED))
            cursor = dark_end
        if cursor < end:
            parts.append((cursor, end, OBSERVED))
        return parts
