"""The background reader: what is new first, then the stale runs, while the pass has time.

A run is stale when an older reading wrote its rows (`usage_store.READING`), when a
request it counted moved to another run, or when a price arrived for tokens it holds
without a cost. `Reader.run_pass` reads what is new (`Collector.run_pass`) and only when
nothing new is left reads stale runs again, one run per transaction, through the rebuild
(`usage_rebuild.rebuild_run`). It starts none after the pass's deadline, so live reading
never waits for history, and it says there is more to do while any run waits, so the
next pass comes as soon as one after a backlog does.

- No liveness file, no reading again: observed time would come back as estimated.
- Before the first run of a process is read again there is a verified snapshot of the
  store with its liveness copy that this process took: the schema upgrade's own recovery
  point, or else one `usage_rebuild.take_snapshot`, once.
- At its first pass a reader makes stale, once per price table, every run holding tokens
  without a cost of a model this table prices (`mark_priced`).
- A run that cannot be read again (its transcript is gone, shorter, changed, unreadable,
  unknown, or the rebuild failed) is tried once per staleness: the refusal is kept with
  the run, for the reading it was refused for, and the run waits until it is stale anew.
  A run that something moved meanwhile is simply tried on a later pass.

What the runs say is the summary `valkama doctor` prints: how many are current, how many
wait, how many were read again, and how many were refused, by reason.
"""

from __future__ import annotations

import os
import sqlite3
import time
from collections.abc import Callable

from . import liveness, usage_prices, usage_rebuild
from .usage_collect import PASS_SECONDS, Collector
from .usage_prices import PRICE_BOOK
from .usage_store import READING, UNPRICED_RUNS

#: The runs waiting to be read again, newest first: stale, and not refused for the current
#: reading. Both take `READING` twice.
_WAITING = (
    "SELECT id FROM usage_runs WHERE reading < ?"
    " AND (refused_reading IS NULL OR refused_reading < ?) ORDER BY id DESC"
)
_WAITING_RUN = (
    "SELECT * FROM usage_runs WHERE id = ? AND reading < ?"
    " AND (refused_reading IS NULL OR refused_reading < ?)"
)


def mark_priced(conn: sqlite3.Connection) -> int:
    """Make stale every run with tokens of a model this table now prices and no cost for them.

    Once per price table: a run checked against this one is not marked again, so a run
    that is refused, or whose cost stays unknown for another reason, is not read again
    at every start. How many runs it marked.
    """

    runs = sorted(
        {
            int(run_id)
            for run_id, model in conn.execute(UNPRICED_RUNS)
            if model and usage_prices.priced(str(model))
        }
    )
    if not runs:
        return 0
    marked = 0
    conn.execute("BEGIN IMMEDIATE")
    try:
        for run_id in runs:
            marked += conn.execute(
                "UPDATE usage_runs SET reading = 0, reread_refused = NULL, refused_reading = NULL,"
                " priced_with = ? WHERE id = ? AND COALESCE(priced_with, '') != ?",
                (PRICE_BOOK, run_id, PRICE_BOOK),
            ).rowcount
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")
    return marked


class Reader:
    """One store's background reader."""

    def __init__(self, conn: sqlite3.Connection, store_path: str) -> None:
        self.collector = Collector(conn, store_path)
        self.conn = conn
        self.store_path = store_path
        self._priced = False

    def run_pass(self, report: Callable[[str], None], seconds: float = PASS_SECONDS) -> bool:
        """Read what is new, then stale runs, for about `seconds`; whether anything is left."""

        deadline = time.monotonic() + seconds
        if not self._priced:
            mark_priced(self.conn)
            self._priced = True
        if self.collector.run_pass(report, seconds):
            return True
        return self._reread(report, deadline)

    def _waiting(self) -> list[int]:
        return [int(row[0]) for row in self.conn.execute(_WAITING, (READING, READING))]

    def _reread(self, report: Callable[[str], None], deadline: float) -> bool:
        if not os.path.isfile(liveness.path_for(self.store_path)):
            return False
        waiting = self._waiting()
        if not waiting:
            return False
        if time.monotonic() >= deadline:
            return True
        if liveness.recovery_point(self.store_path) is None:
            snapshot = usage_rebuild.take_snapshot(self.conn, self.store_path)
            report(f"usage reader: recovery point before reading runs again: {snapshot}")
        # A collector of its own: the targets it finds settle nothing for the live one.
        history = Collector(self.conn, self.store_path)
        targets = {
            (target.session, target.agent): target for target in history.finder.targets(set())
        }
        coverage = liveness.Coverage(liveness.intervals(self.store_path))
        for run_id in waiting:
            if time.monotonic() >= deadline:
                return True
            run = self.conn.execute(_WAITING_RUN, (run_id, READING, READING)).fetchone()
            if run is None:
                continue
            target = targets.get((str(run["session_id"]), str(run["agent_id"])))
            line = usage_rebuild.rebuild_run(history, run, target, coverage)
            if line.outcome == usage_rebuild.REFUSED and line.reason not in usage_rebuild.RETRIED:
                self.conn.execute(
                    "UPDATE usage_runs SET reread_refused = ?, refused_reading = ?"
                    " WHERE id = ? AND reading < ?",
                    (line.reason, READING, run_id, READING),
                )
        return bool(self._waiting())
