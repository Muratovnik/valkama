"""Reading a run again from its transcript, and putting what it gives in place of what was.

A later change to how segments are made (a new column, a new price) reaches the history
only through this. So it is built not to lose what is already counted, and the one way
it still can is named below:

- It reads the same bytes the reader already read, from the start to the run's
  `read_offset`, through the reader's own path (`Collector.read_more`, which feeds
  `Collector.parse` the chunks the reader takes). The command reads a run in one go; the
  background reader passes a deadline and resumes the reading on its next pass. The run's former claims in
  `usage_requests` are not taken as seen: only what this reading counted is, and a
  request another run counts goes as `usage_claims` says.
- Parsing happens outside the write transaction. The transaction only deletes the run's
  segments and claims, inserts the new ones and moves the run's row, and the move names
  the `read_offset` the rebuild started from, as the reader's does. A reader pass that
  moved the run meanwhile, or marked it, or a run that claimed one of its requests
  meanwhile, makes the rebuild of that run write nothing and say so. A claim the run no
  longer makes is released (`usage_claims.release`), unless a run that left a request to
  another can no longer be read: the request could then end up counted in no run, so the
  rebuild of this run writes nothing and is refused as `stranded`. `usage_claims` says
  what that refusal still leaves open.
- A rebuilt run is current: its `reading` becomes `READING`, and a refusal it carried
  goes.
- Only a run being read, whose transcript (its own path, else the archive, as the reader
  resolves it) is there and no shorter than what was read, is rebuilt. Every other run is
  left as it is and named with the reason, and so is every run when the liveness file is
  missing: without it observed time would come back as estimated.
- Rebuilding every run first takes a verified snapshot of the store, labelled
  `usagerebuild`, and copies the liveness file beside it under the snapshot's name, which
  is where a store restored from that snapshot looks for it. The store's snapshot does
  not hold it.

Where its passes ended does not shape what the reader makes (`usage_ledger` says how a
turn with no write is placed), so a rebuild gives other numbers than the reader only
through what lies outside the transcript and arrived after the reader passed: liveness,
writes and permission requests in `execution_events`, and the holds, steps and labels
behind the fallback item. Whether a subagent keeps a transcript of its own is not one of
them: its archived copy or its run's segments still say so after the client deleted the
file, so its time is never counted in its parent's run as well. The report shows the
difference: per run, the totals before and after, and the time, tokens and cost each work
item (and no item) had before and after.
"""

from __future__ import annotations

import math
import os
import sqlite3
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .. import store, store_backups
from . import liveness, usage_claims, usage_collect
from .usage_clock import EXTERNAL, GAP, HUMAN, SUBAGENT
from .usage_collect import Collector, Reading, Rereading
from .usage_ledger import SEGMENT_COLUMNS, TOKEN_COLUMNS, segment_values, stamp, write_rows
from .usage_prices import PRICE_BOOK
from .usage_store import READING
from .usage_targets import Finder, Target

#: The label of the snapshot taken before every run is rebuilt.
SNAPSHOT_LABEL = "usagerebuild"

REBUILT = "rebuilt"
WOULD_REBUILD = "would-rebuild"
REFUSED = "refused"
#: Read in part before the caller's deadline: `RunReport.rereading` goes on from there.
UNFINISHED = "unfinished"

#: Why a run, or the whole operation, was refused, with what to tell a person. The first
#: three are the statuses the reader gives a run it cannot read.
REASONS = {
    "missing": "its transcript is gone",
    "truncated": "the reader found its transcript shorter than what it had read",
    "unreadable": "the reader could not read its transcript",
    "shorter": "its transcript is now shorter than what was read",
    "changed": "its transcript no longer ends a line where reading stopped",
    "moved": "a reader pass moved it meanwhile; nothing was written, run the rebuild again",
    "claimed": "another run claimed one of its requests meanwhile; nothing was written, run"
    " the rebuild again",
    "stranded": "it no longer holds a request it counted, and a run that left a request to"
    " another can no longer be read, so that request could end up counted in no run;"
    " nothing was written",
    "no-transcript": "no transcript is known for it",
    "failed": "the rebuild failed; nothing was written",
    "no-liveness": "no liveness file beside the store: observed time would come back as"
    " estimated; nothing was read or written",
    "no-run": "no usage run for that session and agent",
}

_RUN_SECONDS = {
    "human_seconds": HUMAN,
    "subagent_seconds": SUBAGENT,
    "external_seconds": EXTERNAL,
    "gap_seconds": GAP,
}
_COST = "estimated_api_cost_usd"
#: Refusals that say only that something moved meanwhile: tried again, never recorded.
RETRIED = frozenset({"moved", "claimed"})

#: A row as the store gives it or as a reading makes it: read by column name either way.
_Record = Mapping[str, Any] | sqlite3.Row


@dataclass
class RunReport:
    """What happened to one run, or would have."""

    run_id: int
    session_id: str
    agent_id: str
    client: str
    outcome: str = REFUSED
    reason: str | None = None
    #: Totals before and after: each left-out class, the segments' seconds and the part
    #: of them that is estimated, each token column and the cost.
    before: dict | None = None
    after: dict | None = None
    #: How many segments the run had and has.
    segments: tuple[int, int] | None = None
    #: Per work item, `None` for the time no item took: the same figures as `before` and
    #: `after` but the left-out classes, before and after, one entry for every item either
    #: side names.
    items: list[dict] = field(default_factory=list)
    #: The kind of error behind a `failed` refusal.
    error: str | None = None
    #: An `unfinished` reading, to hand back to `rebuild_run` as `resume`.
    rereading: Rereading | None = None


@dataclass
class Report:
    dry_run: bool
    #: Why nothing at all was rebuilt, when the whole operation refused.
    refused: str | None = None
    snapshot: str | None = None
    runs: list[RunReport] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        """Whether anything was refused, which makes the command exit non-zero."""

        return self.refused is not None or any(run.outcome == REFUSED for run in self.runs)

    def as_dict(self) -> dict:
        return {
            "dry_run": self.dry_run,
            "refused": self.refused,
            "snapshot": self.snapshot,
            "runs": [
                {
                    **{key: value for key, value in vars(run).items() if key != "rereading"},
                    "segments": list(run.segments) if run.segments else None,
                }
                for run in self.runs
            ],
        }


class _RefusedError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def rebuild(
    conn: sqlite3.Connection,
    store_path: str,
    *,
    session: str | None = None,
    agent: str = "",
    dry_run: bool = False,
) -> Report:
    """Rebuild one run (`session` and `agent`) or, with no `session`, every run.

    `conn` must be in autocommit mode, as the reader's is: each run is a transaction
    of its own. With `dry_run` nothing is written and no snapshot is taken.
    """

    report = Report(dry_run)
    if not os.path.isfile(liveness.path_for(store_path)):
        report.refused = "no-liveness"
        return report
    collector = Collector(conn, store_path)
    if session is None:
        runs = conn.execute("SELECT * FROM usage_runs ORDER BY id").fetchall()
    else:
        runs = conn.execute(
            "SELECT * FROM usage_runs WHERE session_id = ? AND agent_id = ?", (session, agent)
        ).fetchall()
        if not runs:
            report.refused = "no-run"
            return report
    if session is None and not dry_run:
        report.snapshot = take_snapshot(conn, store_path)
    targets = {
        (target.session, target.agent): target
        # The collector's own finder, whose archives its `_keeps` reads.
        for target in collector.finder.targets(set())
    }
    coverage = liveness.Coverage(liveness.intervals(store_path))
    for run in runs:
        target = targets.get((str(run["session_id"]), str(run["agent_id"])))
        line = rebuild_run(collector, run, target, coverage, dry_run=dry_run)
        if not dry_run:
            record_refusal(conn, line)
        report.runs.append(line)
    return report


def record_refusal(conn: sqlite3.Connection, line: RunReport) -> None:
    """Keep with a stale run why it cannot be read again, for the current reading.

    So neither the background reader nor `valkama doctor` takes it for one still waiting.
    A refusal in `RETRIED` says only that something moved meanwhile and is not kept.
    """

    if line.outcome == REFUSED and line.reason not in RETRIED:
        conn.execute(
            "UPDATE usage_runs SET reread_refused = ?, refused_reading = ?"
            " WHERE id = ? AND reading < ?",
            (line.reason, READING, line.run_id, READING),
        )


def rebuild_run(
    collector: Collector,
    run: sqlite3.Row,
    target: Target | None,
    coverage: liveness.Coverage,
    *,
    dry_run: bool = False,
    deadline: float = math.inf,
    resume: Rereading | None = None,
) -> RunReport:
    """Rebuild one run, or say why not. Takes no snapshot: the caller owns the recovery point.

    The reading stops between chunks once `deadline` has passed, and the run is then
    `unfinished`: `resume` with its `rereading` goes on from there. The run must still
    stand where the reading started (`_stands`), else it moved and the reading is
    dropped: a reading begun anew then finds what the run is read from now, or says why
    it cannot be read.
    """

    line = RunReport(int(run["id"]), str(run["session_id"]), str(run["agent_id"]), run["client"])
    try:
        if resume is None:
            again = _start(run, target, coverage)
        elif not _stands(run, resume):
            raise _RefusedError("moved")
        else:
            again = resume
        try:
            whole_lines = collector.read_more(again, deadline)
        except OSError:
            if resume is None:
                raise
            # The file went between the check and the read: as moved as any other.
            raise _RefusedError("moved") from None
        if not whole_lines:
            raise _RefusedError("changed")
        if not again.done:
            line.outcome, line.rereading = UNFINISHED, again
            return line
        target, reading = again.target, again.reading()
        before = _segments(collector.conn, line.run_id)
        after = [
            dict(zip(SEGMENT_COLUMNS, segment_values(row), strict=True)) for row in reading.rows
        ]
        line.before = _totals(run, before)
        line.after = _totals(_run_after(run, reading), after)
        line.segments = (len(before), len(after))
        line.items = _by_item(before, after)
        if not dry_run:
            _replace(collector, run, target, reading)
        line.outcome = WOULD_REBUILD if dry_run else REBUILT
    except _RefusedError as refusal:
        _refuse(line, refusal.reason)
    except Exception as error:  # noqa: BLE001 -- one run must not cost the others; it is reported
        _refuse(line, "failed")
        line.error = type(error).__name__
    return line


def _refuse(line: RunReport, reason: str) -> None:
    line.outcome, line.reason = REFUSED, reason
    line.before = line.after = line.segments = None
    line.items = []


def _start(run: sqlite3.Row, target: Target | None, coverage: liveness.Coverage) -> Rereading:
    """A reading again of the run to its `read_offset`, not begun, or the reason it may not be."""

    if run["status"] != "reading":
        raise _RefusedError(str(run["status"]))
    if target is None:
        raise _RefusedError("no-transcript")
    path = usage_collect.source(target)
    if path is None:
        raise _RefusedError("missing")
    end = int(run["read_offset"])
    if os.path.getsize(path) < end:
        raise _RefusedError("shorter")
    return Rereading.start(target, path, end, coverage, int(run["id"]))


#: The statuses the reader gives a run whose bytes are gone; `unreadable` may pass.
_BYTES_GONE = frozenset({"missing", "truncated"})


def _strands(collector: Collector, yielders: Sequence[sqlite3.Row]) -> bool:
    """Whether a run that left a request to another has lost the bytes it was read from.

    Such a run cannot take a request back, so a holder that gives one up would strand it.
    The bytes decide, own file or archive: a refusal kept with the run for another reason
    (a failure, or this very one) and a status that may pass say nothing of them; only
    `changed` does, which reading alone finds. Asked inside the holder's transaction, and
    only when the holder gives a claim up and some run yielded: rarely.

    The targets come from a finder of its own: the collector's has been walked already,
    and one walked before leaves out every session that ended.
    """

    if not yielders:
        return False
    finder = Finder(collector.conn, collector.finder.archive_root)
    targets = {(target.session, target.agent): target for target in finder.targets(set())}
    for run in yielders:
        if run["status"] in _BYTES_GONE:
            return True
        if run["reread_refused"] == "changed" and (run["refused_reading"] or 0) >= READING:
            return True
        target = targets.get((str(run["session_id"]), str(run["agent_id"])))
        path = None if target is None else usage_collect.source(target)
        try:
            if path is None or os.path.getsize(path) < int(run["read_offset"]):
                return True
        except OSError:
            return True
    return False


def _stands(run: sqlite3.Row, again: Rereading) -> bool:
    """Whether a run still stands where a reading in part started.

    It is still being read, to the same place, from the same file (not its archive
    since, nor nothing), and that file is still as long.
    """

    if run["status"] != "reading" or int(run["read_offset"]) != again.end:
        return False
    if usage_collect.source(again.target) != again.path:
        return False
    try:
        return os.path.getsize(again.path) >= again.end
    except OSError:
        return False


def _replace(collector: Collector, run: sqlite3.Row, target: Target, reading: Reading) -> None:
    """Put the new rows in place of the run's as one transaction, or write nothing."""

    conn = collector.conn
    run_id = int(run["id"])
    conn.execute("BEGIN IMMEDIATE")
    try:
        status = conn.execute(
            "SELECT status FROM usage_runs WHERE id = ? AND read_offset = ?",
            (run_id, run["read_offset"]),
        ).fetchone()
        # The read place stays where it was: the same bytes were read again. With nothing
        # read before either, there is nothing to put back, and the run is current.
        if (
            status is None
            or status[0] != "reading"
            or (
                reading.last is not None
                and not collector.record(
                    run_id, run["read_offset"], int(run["read_offset"]), reading.last
                )
            )
        ):
            conn.execute("ROLLBACK")
            raise _RefusedError("moved")
        if reading.last is not None:
            former = usage_claims.held(conn, run_id)
            if _strands(collector, usage_claims.yielders(conn, run_id, former, reading.requests)):
                conn.execute("ROLLBACK")
                raise _RefusedError("stranded")
            conn.execute("DELETE FROM usage_segments WHERE run_id = ?", (run_id,))
            conn.execute("DELETE FROM usage_requests WHERE run_id = ?", (run_id,))
            write_rows(conn, run_id, target.session, target.agent, reading.rows)
            if not usage_claims.write(
                conn, reading.last.claimant, reading.requests, reading.yielded, whole=True
            ):
                conn.execute("ROLLBACK")
                raise _RefusedError("claimed")
            usage_claims.release(conn, run_id, former, reading.requests)
        conn.execute(
            "UPDATE usage_runs SET reading = ?, reread_refused = NULL, refused_reading = NULL,"
            " reread_at = ?, priced_with = ? WHERE id = ?",
            (READING, stamp(time.time()), PRICE_BOOK, run_id),
        )
        conn.execute("COMMIT")
    except BaseException:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


# -- the report ---------------------------------------------------------------


def _segments(conn: sqlite3.Connection, run_id: int) -> list[_Record]:
    return conn.execute(
        "SELECT * FROM usage_segments WHERE run_id = ? ORDER BY id", (run_id,)
    ).fetchall()


def _run_after(run: sqlite3.Row, reading: Reading) -> _Record:
    if reading.last is None:
        return run
    left_out = reading.last.clock.left_out
    return {column: left_out[name] for column, name in _RUN_SECONDS.items()}


def _totals(run: _Record, segments: Sequence[_Record]) -> dict:
    return {
        **{column: round(float(run[column]), 3) for column in _RUN_SECONDS},
        **_spent(segments),
    }


def _spent(segments: Sequence[_Record]) -> dict:
    """The seconds, the estimated part of them, each token column and the cost of some rows."""

    spent: dict = {
        "seconds": round(sum((float(row["seconds"]) for row in segments), 0.0), 3),
        "estimated_seconds": round(
            sum(
                (float(row["seconds"]) for row in segments if row["quality"] == liveness.ESTIMATED),
                0.0,
            ),
            3,
        ),
    }
    for column in TOKEN_COLUMNS.values():
        spent[column] = sum(int(row[column]) for row in segments if row[column] is not None)
    costs = [float(row[_COST]) for row in segments if row[_COST] is not None]
    spent[_COST] = round(sum(costs), 6) if costs else None
    return spent


def _by_item(before: Sequence[_Record], after: Sequence[_Record]) -> list[dict]:
    """What each work item had and has, no item last: where work moved between items."""

    items = sorted(
        {row["work_item_id"] for row in [*before, *after]},
        key=lambda item: (item is None, item or ""),
    )
    return [
        {
            "work_item_id": item,
            "before": _spent([row for row in before if row["work_item_id"] == item]),
            "after": _spent([row for row in after if row["work_item_id"] == item]),
        }
        for item in items
    ]


def render(report: Report) -> str:
    """The report for a person: one line per run, with what changed."""

    if report.refused is not None:
        return f"usage rebuild: refused ({report.refused}): {REASONS[report.refused]}"
    done = sum(run.outcome != REFUSED for run in report.runs)
    refused = len(report.runs) - done
    verb = "would rebuild" if report.dry_run else "rebuilt"
    lines = [f"usage rebuild: {verb} {done} run(s), refused {refused}"]
    if report.dry_run:
        lines.append("dry run: nothing was rebuilt")
    if report.snapshot is not None:
        lines.append(f"snapshot: {report.snapshot} (the liveness file is copied beside it)")
    for run in report.runs:
        name = f"run {run.run_id} {run.client} {run.session_id}"
        if run.agent_id:
            name += f" agent {run.agent_id}"
        if run.outcome == REFUSED:
            reason = run.reason or "failed"
            error = f" ({run.error})" if run.error else ""
            lines.append(f"{name}: refused ({reason}): {REASONS[reason]}{error}")
            continue
        moved = [
            f"  item {entry['work_item_id'] or '(none)'}: "
            + _changes(entry["before"], entry["after"])
            for entry in run.items
            if entry["before"] != entry["after"]
        ]
        changed = _changes(run.before or {}, run.after or {})
        if run.segments is not None and run.segments[0] != run.segments[1]:
            changed = "; ".join(
                filter(None, (changed, f"segments {run.segments[0]} -> {run.segments[1]}"))
            )
        if not changed and not moved:
            changed = "totals unchanged"
        elif not changed:
            changed = "totals unchanged, work moved between items"
        lines.append(f"{name}: {run.outcome}, {changed}")
        lines.extend(moved)
    return "\n".join(lines)


def _changes(before: dict, after: dict) -> str:
    """Each figure that differs, as `name before -> after`; empty when none does."""

    return "; ".join(
        f"{name} {before[name]} -> {after[name]}" for name in after if before[name] != after[name]
    )


# -- the recovery point -------------------------------------------------------


def take_snapshot(conn: sqlite3.Connection, store_path: str) -> str:
    """A verified snapshot of the store, with a verified copy of its liveness file beside it.

    The snapshot is the store's own kind (`store_backups.verified_snapshot`, in the
    place and under the retention its recovery points have). The liveness copy is named
    as a store at the snapshot's path would look for its liveness file, so restoring one
    is copying both.
    """

    location = store.backup_location
    path, _identity = store_backups.verified_snapshot(conn, SNAPSHOT_LABEL, locate=location)
    liveness.copy_beside(store_path, path, location().prefix)
    return path
