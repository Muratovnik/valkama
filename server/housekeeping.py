"""Maintenance a long-lived process runs on its own store at start-up.

Kept out of `store.connect()` on purpose: bring-up stays bring-up, and every
doctor, export and test that opens a store would otherwise write as a side
effect. A surface that owns a lasting connection -- the MCP loop, `serve` --
calls `start_up` once after it has opened the store, and then starts the
background loops below.

`run` is what has to happen before the first request, each step its own
transaction:

- deliver the hook spool: events a hook process could not write because the
  store was busy, missing or at another schema version;
- the first pass of the planning sweep (`planning.sweep.run_pass`): release the
  Planning leases past their grace that no write met, drop the subscriptions
  whose session lapsed by the same rule, and whatever else its steps retire by
  time;
- delete the quota samples past their year (`quota.samples.prune`).

The spool goes first, because a delivered event can move a session's
heartbeat forward and keep its lease from lapsing. The steps share one budget,
`START_UP_SECONDS`, because a client waits for the MCP server it started and
gives up after its own timeout: the drain stops starting files when its share
is spent, and every lock a step asks for is given up after
`START_UP_BUSY_MS` instead of the connection's own busy timeout. A store
another writer holds is an ordinary state; what was not done runs at the next
start, and a step of the planning sweep at its next pass.

`start_planning_sweep` repeats the planning sweep every `PLANNING_SWEEP_SECONDS`
on its own connection, in both surfaces, as `start_pulse` runs: a lease lapses
while nobody calls, and a process that runs for days must not wait for its next
start to release it. Ten minutes is a margin against terms of twelve hours and
three days, and a pass with nothing to do is a few reads that take no lock.

The transcript sweep -- the copies a hook left owed, and the ones retention
releases -- does not run before the first request at all. A copy has no size
bound, and a transcript of hundreds of megabytes copied and flushed before
`initialize` is answered makes a server the client has already given up on.
`start_transcript_sweep` runs it on its own connection in a background thread, where
nobody waits for it. A process that ends first leaves at most a `*.partial`,
which a later sweep removes, and the copy stays owed.

`start_pulse` says this process is alive once a minute (`telemetry.liveness`), beside
the store rather than in it, until the surface that started it ends. Both surfaces
start it: an on-demand listener loads no server until its first connection, and an
agent at work has an MCP process, so one of them runs whenever work can be observed.

`start_usage` reads transcripts into usage rows (`telemetry.usage_reread`: what is new
first, then the runs an older reading left stale), on its own connection in the
background, a bounded amount per pass. Only the listener runs it: it
alone answers the reads of those rows, and anything an MCP process would do here
another one would be doing too. After each pass the listener on the owner's port also
decides the quota alerts (`alerts.quota`): a pass is what learns the organization a
session's quota reading belongs to, and the listener runs with no window open.
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
from .alerts import quota as quota_alerts
from .hooks import ingest, spool
from .planning import sweep as planning_sweep
from .quota import samples as quota_samples
from .telemetry import liveness, usage_reread

#: The whole budget of what runs before the first request. A client gives an
#: MCP server some seconds to start (Codex ten by default), and interpreter
#: start and the store's own bring-up come out of the same budget.
START_UP_SECONDS = 3.0
#: How long a start-up step waits for a lock another writer holds before it
#: gives up and leaves its work to the next start.
START_UP_BUSY_MS = 250
#: The transcript sweep's thread, by name, so a test or a diagnosis can find it.
TRANSCRIPT_SWEEP_THREAD = "valkama-transcript-sweep"
#: The planning sweep's thread, by name.
PLANNING_SWEEP_THREAD = "valkama-planning-sweep"
#: Between the planning sweep's passes.
PLANNING_SWEEP_SECONDS = 600.0
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
#: How long stopping a background loop waits for a round already under way. A tick
#: gives up a busy liveness file after its own one-second timeout, and a sweep step a
#: held store after `START_UP_BUSY_MS`, so this is a bound, not a pause.
STOP_SECONDS = 5.0


@dataclass
class Report:
    """What one run did."""

    spool: ingest.DrainResult = field(default_factory=ingest.DrainResult)
    planning: planning_sweep.Pass = field(default_factory=planning_sweep.Pass)
    pruned_samples: int = 0
    #: The step that could not finish and why; the steps after it still ran.
    failures: list[str] = field(default_factory=list)

    @property
    def expired_leases(self) -> int:
        """On how many items the planning sweep released a lapsed hold."""

        return self.planning.changed.get(planning_sweep.LEASES, 0)


def run(conn: sqlite3.Connection, *, seconds: float = START_UP_SECONDS) -> Report:
    """Every step before the first request, in order, within about `seconds` in all.

    `conn` must be outside any transaction. Its busy timeout is lowered for the
    run and restored afterwards.
    """

    report = Report()
    deadline = time.monotonic() + seconds
    # What the steps after the drain may still need: the sweep's lock wait and the quota
    # retention's, each with as much again to spare. A sweep step the deadline meets is
    # left to the background pass.
    reserve = START_UP_BUSY_MS / 1000 * 4
    with _short_busy_timeout(conn):
        try:
            report.spool = drain_spool(conn, seconds=max(0.0, seconds - reserve))
        except Exception as error:  # noqa: BLE001 -- reported; the next step still runs
            report.failures.append(f"hook spool drain: {_describe(error)}")
        report.planning = planning_sweep.run_pass(conn, deadline=deadline)
        report.failures.extend(_sweep_failures(report.planning))
        if time.monotonic() >= deadline:
            report.failures.append("quota retention: no time left; it runs at the next start")
            return report
        try:
            report.pruned_samples = prune_quota_samples(conn)
        except Exception as error:  # noqa: BLE001 -- reported; the surface still starts
            report.failures.append(f"quota retention: {_describe(error)}")
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


def _sweep_failures(done: planning_sweep.Pass) -> list[str]:
    """What a pass of the planning sweep left undone, a line for each step."""

    later = "it runs at the next pass"
    return [
        *(f"planning sweep {name}: {_describe(error)}" for name, error in done.failures.items()),
        *(f"planning sweep {name}: the store is busy; {later}" for name in done.busy),
        *(f"planning sweep {name}: no time left; {later}" for name in done.left),
    ]


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
        lines.append(f"released expired Planning claims on {report.expired_leases} work item(s)")
    return lines


def drain_spool(conn: sqlite3.Connection, *, seconds: float | None = None) -> ingest.DrainResult:
    """Deliver every pending spool file beside this store, oldest first.

    `conn` must not be inside a transaction: each file is its own. With
    `seconds`, the drain stops starting new files once that much time has
    passed, and leaves the rest for the next run.
    """

    return ingest.drain(conn, spool.directory(store.db_path()), seconds=seconds)


def prune_quota_samples(conn: sqlite3.Connection) -> int:
    """Delete the quota samples past their retention, in one transaction; how many."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        pruned = quota_samples.prune(conn)
    except BaseException:
        conn.rollback()
        raise
    conn.commit()
    return pruned


def start_transcript_sweep(
    conn: sqlite3.Connection, report: Callable[[str], None]
) -> threading.Thread | None:
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
        target=_sweep, args=(path, root, report), name=TRANSCRIPT_SWEEP_THREAD, daemon=True
    )
    thread.start()
    return thread


@dataclass(frozen=True)
class Background:
    """A running background loop -- the tick, the planning sweep -- and the event that ends it.

    `stop` sets the event and waits out a round already under way. Setting the event
    alone let a surface return while a tick still held the liveness file and its
    journal open, and whoever then removed the store's directory -- a test's temporary
    home on Windows -- could not delete the journal.
    """

    event: threading.Event
    thread: threading.Thread

    def stop(self) -> None:
        self.event.set()
        self.thread.join(STOP_SECONDS)


def start_pulse(report: Callable[[str], None]) -> Background:
    """Tick in the background until the pulse this returns is stopped.

    A failed tick says so once per distinct failure and the thread goes on: the
    next one may well land, and nothing here is worth a surface.
    """

    stop = threading.Event()
    thread = threading.Thread(
        target=_pulse, args=(store.db_path(), stop, report), name=PULSE_THREAD, daemon=True
    )
    thread.start()
    return Background(stop, thread)


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


def start_planning_sweep(report: Callable[[str], None]) -> Background:
    """Repeat the planning sweep in the background until the loop this returns is stopped.

    The first pass is the start-up one, so the thread waits out an interval before
    each of its own. A step that fails says so once per distinct failure, and again
    only after a pass it got through; a store another writer holds is said nothing
    of, because the next pass is the retry.
    """

    stop = threading.Event()
    thread = threading.Thread(
        target=_planning_sweep,
        args=(store.db_path(), stop, report),
        name=PLANNING_SWEEP_THREAD,
        daemon=True,
    )
    thread.start()
    return Background(stop, thread)


def _planning_sweep(path: str, stop: threading.Event, report: Callable[[str], None]) -> None:
    conn: sqlite3.Connection | None = None
    said: dict[str, str] = {}
    try:
        while not stop.wait(PLANNING_SWEEP_SECONDS):
            try:
                if conn is None:
                    conn = _sweep_connection(path)
                done = planning_sweep.run_pass(conn)
            except Exception as error:  # noqa: BLE001 -- a background thread has nobody to raise to
                _say_once(said, "", f"planning sweep did not run: {_describe(error)}", report)
                continue
            said.pop("", None)
            for step in planning_sweep.STEPS:
                if step.name in done.failures:
                    text = f"planning sweep {step.name}: {_describe(done.failures[step.name])}"
                    _say_once(said, step.name, text, report)
                elif step.name not in done.busy:
                    said.pop(step.name, None)
    finally:
        if conn is not None:
            conn.close()


def _sweep_connection(path: str) -> sqlite3.Connection:
    """The planning sweep's own connection: rows by name, a held store given up quickly."""

    conn = ingest.open_light(path, store.STORE_SCHEMA_VERSION)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {int(START_UP_BUSY_MS)}")
    return conn


def _say_once(said: dict[str, str], key: str, text: str, report: Callable[[str], None]) -> None:
    """Report `text` unless it is what was last said for `key`."""

    if said.get(key) != text:
        report(text)
        said[key] = text


def start_usage(report: Callable[[str], None], *, alerts: bool = False) -> threading.Event:
    """Read transcripts into usage rows in the background until the event this returns is set.

    `alerts` is whether each pass is followed by the quota alerts: only on the owner's
    listener, as for the alerts of a launch that ended (`watchers`).
    """

    stop = threading.Event()
    thread = threading.Thread(
        target=_usage,
        args=(store.db_path(), stop, report, alerts),
        name=USAGE_THREAD,
        daemon=True,
    )
    thread.start()
    return stop


def _usage(
    path: str, stop: threading.Event, report: Callable[[str], None], alerts: bool = False
) -> None:
    """Pass after pass. A store that cannot be opened or written now is tried again later."""

    if stop.wait(USAGE_START_SECONDS):
        return
    conn: sqlite3.Connection | None = None
    collector: usage_reread.Reader | None = None
    said = ""
    try:
        while True:
            backlog = False
            try:
                if conn is None or collector is None:
                    conn = ingest.open_light(path, store.STORE_SCHEMA_VERSION)
                    # Nobody waits for this thread, so it may wait for a writer.
                    conn.execute("PRAGMA busy_timeout = 5000")
                    collector = usage_reread.Reader(conn, path)
                backlog = collector.run_pass(report)
                said = ""
            except Exception as error:  # noqa: BLE001 -- a background thread has nobody to raise to
                text = _describe(error)
                if text != said:
                    report(f"usage reader did not finish a pass: {text}")
                    said = text
            if alerts and conn is not None:
                # Never raises: a failure is a line in the alerts log.
                quota_alerts.after_pass(conn)
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
