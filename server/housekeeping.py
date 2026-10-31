"""Maintenance a long-lived process runs on its own store at start-up.

Kept out of `store.connect()` on purpose: bring-up stays bring-up, and every
doctor, export and test that opens a store would otherwise write as a side
effect. A surface that owns a lasting connection -- the MCP loop, `serve` --
calls `run` once after it has opened the store.

`run` is a plain sequence of steps, each its own transaction:

- deliver the hook spool: events a hook process could not write because the
  store was busy, missing or at another schema version;
- release the Planning leases that went stale while no write met them;
- sweep the transcript archive: make the copies a hook left owed, and purge
  the ones retention releases.

The spool goes first, because a delivered event can move a session's
heartbeat forward and keep its lease from lapsing, and a delivered session
end is a copy the sweep then owes. The sweep is bounded in time, because a
client waits for the MCP server it started; what it does not reach waits for
the next start.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from . import store, transcripts
from .hooks import ingest, spool
from .planning import service as planning_service

#: How long the start-up sweep may keep starting new archive steps. A copy
#: already under way still finishes, so this bounds the wait, not the copy.
TRANSCRIPT_SWEEP_SECONDS = 2.0


@dataclass
class Report:
    """What one run did."""

    spool: ingest.DrainResult = field(default_factory=ingest.DrainResult)
    expired_leases: int = 0
    transcripts: transcripts.SweepResult = field(default_factory=transcripts.SweepResult)
    #: The step that could not finish and why; the steps after it still ran.
    failures: list[str] = field(default_factory=list)


def run(conn: sqlite3.Connection) -> Report:
    """Every start-up step, in order, on a connection outside any transaction."""

    report = Report()
    try:
        report.spool = drain_spool(conn)
    except Exception as error:  # noqa: BLE001 -- reported; the next step still runs
        report.failures.append(f"hook spool drain: {_describe(error)}")
    try:
        report.expired_leases = expire_leases(conn)
    except Exception as error:  # noqa: BLE001 -- reported; the next step still runs
        report.failures.append(f"lease expiry: {_describe(error)}")
    try:
        report.transcripts = transcripts.sweep(conn, seconds=TRANSCRIPT_SWEEP_SECONDS)
    except Exception as error:  # noqa: BLE001 -- reported; the surface still starts
        report.failures.append(f"transcript sweep: {_describe(error)}")
    return report


def _describe(error: Exception) -> str:
    """A store error says enough by its text; anything else also names its type."""

    if isinstance(error, sqlite3.Error | OSError):
        return str(error)
    return f"{type(error).__name__}: {error}"


def start_up(conn: sqlite3.Connection) -> list[str]:
    """Run every step for a surface that is starting, and say what is worth saying.

    A surface must start even when maintenance cannot finish -- a store locked
    by another writer is an ordinary state, not a reason to refuse an agent its
    tools -- so a failure is reported, never raised, whatever it is. The answer
    is lines for the process's stderr; stdout belongs to a protocol in the MCP
    case.
    """

    try:
        report = run(conn)
    except Exception as error:  # noqa: BLE001 -- a surface starts whatever maintenance does
        return [f"start-up maintenance did not finish: {_describe(error)}"]
    lines = [f"start-up maintenance: {failure}" for failure in report.failures]
    if report.spool.stopped:
        lines.append(f"hook spool drain stopped: {report.spool.stopped}")
    if report.expired_leases:
        lines.append(f"released {report.expired_leases} expired Planning lease(s)")
    if report.transcripts.stopped:
        lines.append(f"transcript sweep stopped: {report.transcripts.stopped}")
    return lines


def drain_spool(conn: sqlite3.Connection, *, seconds: float | None = None) -> ingest.DrainResult:
    """Deliver every pending spool file beside this store, oldest first.

    `conn` must not be inside a transaction: each file is its own. With
    `seconds`, the drain stops starting new files once that much time has
    passed, and leaves the rest for the next run.
    """

    return ingest.drain(conn, spool.directory(store.db_path()), seconds=seconds)


def expire_leases(conn: sqlite3.Connection) -> int:
    """Release every stale lease in the store, in one transaction; how many were released."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        expired = planning_service.expire_leases(conn)
    except BaseException:
        conn.rollback()
        raise
    conn.commit()
    return expired
