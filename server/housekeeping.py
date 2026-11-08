"""Maintenance a long-lived process runs on its own store at start-up.

Kept out of `store.connect()` on purpose: bring-up stays bring-up, and every
doctor, export and test that opens a store would otherwise write as a side
effect. A surface that owns a lasting connection -- the MCP loop, `serve` --
calls `start_up` once after it has opened the store, and then `start_sweep`.

`run` is what has to happen before the first request, each step its own
transaction:

- deliver the hook spool: events a hook process could not write because the
  store was busy, missing or at another schema version;
- release the Planning leases past their grace that no write met, and drop the
  subscriptions whose session lapsed by the same rule.

The spool goes first, because a delivered event can move a session's
heartbeat forward and keep its lease from lapsing. Both steps share one budget,
`START_UP_SECONDS`, because a client waits for the MCP server it started and
gives up after its own timeout: the drain stops starting files when its share
is spent, and every lock either step asks for is given up after
`START_UP_BUSY_MS` instead of the connection's own busy timeout. A store
another writer holds is an ordinary state; what was not done runs at the next
start.

The transcript sweep -- the copies a hook left owed, and the ones retention
releases -- does not run before the first request at all. A copy has no size
bound, and a transcript of hundreds of megabytes copied and flushed before
`initialize` is answered makes a server the client has already given up on.
`start_sweep` runs it on its own connection in a background thread, where
nobody waits for it. A process that ends first leaves at most a `*.partial`,
which a later sweep removes, and the copy stays owed.

`start_pulse` says this process is alive once a minute (`telemetry.liveness`), beside
the store rather than in it, until the surface that started it ends. Both surfaces
start it: an on-demand listener loads no server until its first connection, and an
agent at work has an MCP process, so one of them runs whenever work can be observed.

`start_usage` reads transcripts into usage rows (`telemetry.usage_collect`), on its own
connection in the background, a bounded amount per pass. Only the listener runs it: it
alone answers the reads of those rows, and anything an MCP process would do here
another one would be doing too.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

from . import store, transcripts
from .hooks import ingest, spool
from .planning import service as planning_service
from .planning import subscriptions as planning_subscriptions
from .telemetry import liveness, usage_collect

#: The whole budget of what runs before the first request. A client gives an
#: MCP server some seconds to start (Codex ten by default), and interpreter
#: start and the store's own bring-up come out of the same budget.
START_UP_SECONDS = 3.0
#: How long a start-up step waits for a lock another writer holds before it
#: gives up and leaves its work to the next start.
START_UP_BUSY_MS = 250
#: The background sweep's thread, by name, so a test or a diagnosis can find it.
SWEEP_THREAD = "valkama-transcript-sweep"
#: The tick's thread, by name.
PULSE_THREAD = "valkama-liveness-tick"
#: The usage reader's thread, by name.
USAGE_THREAD = "valkama-usage-reader"
#: The usage reader waits this long before its first pass, so a server loading for a
#: waiting connection answers it first.
USAGE_START_SECONDS = 5.0
#: Between its passes: a live item's numbers are at most about this old.
USAGE_PAUSE_SECONDS = 60.0
#: Between its passes while history remains, which keeps it to a small share of the time.
USAGE_BACKLOG_PAUSE_SECONDS = 5.0
#: How long stopping the tick waits for one already under way. A tick gives up a busy
#: liveness file after its own one-second timeout, so this is a bound, not a pause.
PULSE_STOP_SECONDS = 5.0


@dataclass
class Report:
    """What one run did."""

    spool: ingest.DrainResult = field(default_factory=ingest.DrainResult)
    expired_leases: int = 0
    #: The step that could not finish and why; the steps after it still ran.
    failures: list[str] = field(default_factory=list)


def run(conn: sqlite3.Connection, *, seconds: float = START_UP_SECONDS) -> Report:
    """Every step before the first request, in order, within about `seconds` in all.

    `conn` must be outside any transaction. Its busy timeout is lowered for the
    run and restored afterwards.
    """

    report = Report()
    deadline = time.monotonic() + seconds
    # What the lease expiry after the drain may still need: its own lock wait.
    reserve = START_UP_BUSY_MS / 1000 * 2
    with _short_busy_timeout(conn):
        try:
            report.spool = drain_spool(conn, seconds=max(0.0, seconds - reserve))
        except Exception as error:  # noqa: BLE001 -- reported; the next step still runs
            report.failures.append(f"hook spool drain: {_describe(error)}")
        if time.monotonic() >= deadline:
            report.failures.append("lease expiry: no time left; it runs at the next start")
            return report
        try:
            report.expired_leases = expire_leases(conn)
        except Exception as error:  # noqa: BLE001 -- reported; the surface still starts
            report.failures.append(f"lease expiry: {_describe(error)}")
    return report


@contextlib.contextmanager
def _short_busy_timeout(conn: sqlite3.Connection) -> Iterator[None]:
    """Lower the connection's busy timeout for a block, and restore it after."""

    previous: int | None = None
    try:
        previous = int(conn.execute("PRAGMA busy_timeout").fetchone()[0])
        conn.execute(f"PRAGMA busy_timeout = {int(START_UP_BUSY_MS)}")
    except (sqlite3.Error, TypeError, ValueError):
        previous = None
    try:
        yield
    finally:
        if previous is not None:
            with contextlib.suppress(sqlite3.Error):
                conn.execute(f"PRAGMA busy_timeout = {previous}")


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
    return lines


def drain_spool(conn: sqlite3.Connection, *, seconds: float | None = None) -> ingest.DrainResult:
    """Deliver every pending spool file beside this store, oldest first.

    `conn` must not be inside a transaction: each file is its own. With
    `seconds`, the drain stops starting new files once that much time has
    passed, and leaves the rest for the next run.
    """

    return ingest.drain(conn, spool.directory(store.db_path()), seconds=seconds)


def expire_leases(conn: sqlite3.Connection) -> int:
    """Release every stale lease past its grace, in one transaction; how many were released."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        expired = planning_service.expire_leases(conn)
        # What lapses with a session lapses at the same sweep: its subscriptions.
        planning_subscriptions.expire(conn)
    except BaseException:
        conn.rollback()
        raise
    conn.commit()
    return expired


def start_sweep(conn: sqlite3.Connection, report: Callable[[str], None]) -> threading.Thread | None:
    """Start the transcript sweep in the background when the archive may owe or hold anything.

    `conn` is only read, on the caller's thread, to decide whether there is
    anything to do: an archive directory, or a copy still owed. The sweep
    itself opens its own connection in the thread, because a connection
    belongs to the thread that made it, and says what is worth saying through
    `report`. The thread is a daemon: an ending process does not wait for a copy.
    """

    path = store.db_path()
    root = transcripts.directory(path)
    try:
        if not os.path.isdir(root) and not transcripts.pending(conn):
            return None
    except Exception as error:  # noqa: BLE001 -- a surface starts whatever maintenance does
        report(f"transcript sweep not started: {_describe(error)}")
        return None
    thread = threading.Thread(
        target=_sweep, args=(path, root, report), name=SWEEP_THREAD, daemon=True
    )
    thread.start()
    return thread


@dataclass(frozen=True)
class Pulse:
    """The running tick and the event that ends it.

    `stop` sets the event and waits out a tick already under way. Setting the event
    alone let a surface return while a tick still held the liveness file and its
    journal open, and whoever then removed the store's directory -- a test's temporary
    home on Windows -- could not delete the journal.
    """

    event: threading.Event
    thread: threading.Thread

    def stop(self) -> None:
        self.event.set()
        self.thread.join(PULSE_STOP_SECONDS)


def start_pulse(report: Callable[[str], None]) -> Pulse:
    """Tick in the background until the pulse this returns is stopped.

    A failed tick says so once per distinct failure and the thread goes on: the
    next one may well land, and nothing here is worth a surface.
    """

    stop = threading.Event()
    thread = threading.Thread(
        target=_pulse, args=(store.db_path(), stop, report), name=PULSE_THREAD, daemon=True
    )
    thread.start()
    return Pulse(stop, thread)


def _pulse(path: str, stop: threading.Event, report: Callable[[str], None]) -> None:
    said = ""
    while True:
        try:
            liveness.tick(path, time.time())
            said = ""
        except (sqlite3.Error, OSError) as error:
            text = _describe(error)
            if text != said:
                report(f"liveness tick failed: {text}")
                said = text
        if stop.wait(liveness.TICK_SECONDS):
            return


def start_usage(report: Callable[[str], None]) -> threading.Event:
    """Read transcripts into usage rows in the background until the event this returns is set."""

    stop = threading.Event()
    thread = threading.Thread(
        target=_usage, args=(store.db_path(), stop, report), name=USAGE_THREAD, daemon=True
    )
    thread.start()
    return stop


def _usage(path: str, stop: threading.Event, report: Callable[[str], None]) -> None:
    """Pass after pass. A store that cannot be opened or written now is tried again later."""

    if stop.wait(USAGE_START_SECONDS):
        return
    conn: sqlite3.Connection | None = None
    collector: usage_collect.Collector | None = None
    said = ""
    try:
        while True:
            backlog = False
            try:
                if conn is None or collector is None:
                    conn = ingest.open_light(path, store.STORE_SCHEMA_VERSION)
                    # Nobody waits for this thread, so it may wait for a writer.
                    conn.execute("PRAGMA busy_timeout = 5000")
                    collector = usage_collect.Collector(conn, path)
                backlog = collector.run_pass(report)
                said = ""
            except Exception as error:  # noqa: BLE001 -- a background thread has nobody to raise to
                text = _describe(error)
                if text != said:
                    report(f"usage reader did not finish a pass: {text}")
                    said = text
            pause = USAGE_BACKLOG_PAUSE_SECONDS if backlog else USAGE_PAUSE_SECONDS
            if stop.wait(pause):
                return
    finally:
        if conn is not None:
            conn.close()


def _sweep(path: str, root: str, report: Callable[[str], None]) -> None:
    try:
        conn = ingest.open_light(path, store.STORE_SCHEMA_VERSION)
    except ingest.UnwritableError as refusal:
        report(f"transcript sweep not started: {refusal}")
        return
    try:
        # Nobody waits for this thread, so it may wait for a writer longer
        # than a hook does.
        conn.execute("PRAGMA busy_timeout = 5000")
        result = transcripts.sweep(conn, root=root)
    except Exception as error:  # noqa: BLE001 -- a background thread has nobody to raise to
        report(f"transcript sweep did not finish: {_describe(error)}")
        return
    finally:
        conn.close()
    if result.stopped:
        report(f"transcript sweep stopped: {result.stopped}")
