"""Reading a run again from its transcript, and putting what it gives in place of what was.

A later change to how segments are made (a new column, a new price) reaches the history
only through this. So it never loses what is already counted:

- It reads the same bytes the reader already read, from the start to the run's
  `read_offset`, through the reader's own path (`Collector.read_again`, which feeds
  `Collector.parse` the chunks the reader takes). The run's former `usage_requests` are
  not taken as seen: only what this reading counted is.
- Parsing happens outside the write transaction. The transaction only deletes the run's
  segments and requests, inserts the new ones and moves the run's row, and the move names
  the `read_offset` the rebuild started from, as the reader's does. A reader pass that
  moved the run meanwhile, or marked it, makes the rebuild of that run write nothing and
  say so.
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

import contextlib
import os
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .. import store, store_backups
from . import liveness, usage_collect
from .usage_clock import EXTERNAL, GAP, HUMAN, SUBAGENT
from .usage_collect import Collector, Reading
from .usage_ledger import SEGMENT_COLUMNS, TOKEN_COLUMNS, segment_values, write_rows
from .usage_targets import Target

#: The label of the snapshot taken before every run is rebuilt.
SNAPSHOT_LABEL = "usagerebuild"

REBUILT = "rebuilt"
WOULD_REBUILD = "would-rebuild"
REFUSED = "refused"

#: Why a run, or the whole operation, was refused, with what to tell a person. The first
#: three are the statuses the reader gives a run it cannot read.
REASONS = {
    "missing": "its transcript is gone",
    "truncated": "the reader found its transcript shorter than what it had read",
    "unreadable": "the reader could not read its transcript",
    "shorter": "its transcript is now shorter than what was read",
    "changed": "its transcript no longer ends a line where reading stopped",
    "moved": "a reader pass moved it meanwhile; nothing was written, run the rebuild again",
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
#: What a liveness copy is called until it is verified.
_PARTIAL = ".partial"

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
                {**vars(run), "segments": list(run.segments) if run.segments else None}
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
        report.runs.append(_one(collector, run, target, coverage, dry_run))
    return report


def _one(
    collector: Collector,
    run: sqlite3.Row,
    target: Target | None,
    coverage: liveness.Coverage,
    dry_run: bool,
) -> RunReport:
    line = RunReport(int(run["id"]), str(run["session_id"]), str(run["agent_id"]), run["client"])
    try:
        target, reading = _read(collector, run, target, coverage)
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


def _read(
    collector: Collector, run: sqlite3.Row, target: Target | None, coverage: liveness.Coverage
) -> tuple[Target, Reading]:
    """The run read again to its `read_offset`, or the reason it may not be."""

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
    reading = collector.read_again(target, path, end, coverage)
    if reading is None:
        raise _RefusedError("changed")
    return target, reading


def _replace(collector: Collector, run: sqlite3.Row, target: Target, reading: Reading) -> None:
    """Put the new rows in place of the run's as one transaction, or write nothing."""

    if reading.last is None:
        # Nothing was read before either, so there is nothing to put back.
        return
    conn = collector.conn
    run_id = int(run["id"])
    conn.execute("BEGIN IMMEDIATE")
    try:
        status = conn.execute(
            "SELECT status FROM usage_runs WHERE id = ? AND read_offset = ?",
            (run_id, run["read_offset"]),
        ).fetchone()
        # The read place stays where it was: the same bytes were read again.
        if (
            status is None
            or status[0] != "reading"
            or not collector.record(
                run_id, run["read_offset"], int(run["read_offset"]), reading.last
            )
        ):
            conn.execute("ROLLBACK")
            raise _RefusedError("moved")
        conn.execute("DELETE FROM usage_segments WHERE run_id = ?", (run_id,))
        conn.execute("DELETE FROM usage_requests WHERE run_id = ?", (run_id,))
        write_rows(conn, run_id, target.session, target.agent, reading.rows, reading.requests)
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

    path, _identity = store_backups.verified_snapshot(
        conn, SNAPSHOT_LABEL, locate=store.backup_location
    )
    _copy_liveness(liveness.path_for(store_path), liveness.path_for(path))
    _drop_stale_copies(os.path.dirname(path))
    return path


def _copy_liveness(source: str, destination: str) -> None:
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


def _drop_stale_copies(directory: str) -> None:
    """Remove a liveness copy whose snapshot retention has removed."""

    prefix = f"{store.backup_location().prefix}-{SNAPSHOT_LABEL}-"
    for name in os.listdir(directory):
        path = os.path.join(directory, name)
        if not name.startswith(prefix) or not name.endswith(".liveness"):
            continue
        snapshot = path.removesuffix(".liveness")
        if liveness.path_for(snapshot) == path and not os.path.isfile(snapshot):
            os.remove(path)
