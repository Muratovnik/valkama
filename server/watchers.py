"""Change fan-out shared by every surface.

One watcher registry, and the improvements runtime bound to it. All three
surfaces publish through the same instance, so this cannot live inside any one
of them without making the other two import it.
"""

from __future__ import annotations

import os
import queue
import sys
import threading
import time

from .executions.lifecycle import reap_launches
from .improvements import improvements_integration
from .platform import core as platform_core
from .platform import modules as platform_modules
from .store import connect


def reap_sessions_if_enabled(conn) -> bool:
    database_row = next(row for row in conn.execute("PRAGMA database_list") if row[1] == "main")
    primary_db = os.path.abspath(database_row[2]) if database_row[2] else ":memory:"
    with platform_modules.module_state_fence(primary_db, "sessions"):
        try:
            conn.execute("BEGIN IMMEDIATE")
            if not platform_core.is_module_enabled(conn, "sessions"):
                conn.rollback()
                return False
            changed = bool(reap_launches(conn))
            if conn.in_transaction:
                conn.commit()
            return changed
        except Exception:
            conn.rollback()
            raise


class Watchers:
    """Fan out board changes to open event streams.

    Agents write to the database from their own processes, so this server
    cannot be told about their changes directly. SQLite's data_version counter
    bumps whenever *another* connection commits, which makes noticing a change
    an O(1) pragma rather than a query, and the board is only rebuilt and
    pushed when something actually happened.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queues: list[queue.SimpleQueue] = []
        #: The last reap failure reported, so a fault that repeats every two
        #: seconds is one line rather than a console full of copies.
        self._reported_reap_failure = ""

    def subscribe(self) -> queue.SimpleQueue:
        stream: queue.SimpleQueue = queue.SimpleQueue()
        with self._lock:
            self._queues.append(stream)
        return stream

    def unsubscribe(self, stream: queue.SimpleQueue) -> None:
        with self._lock:
            if stream in self._queues:
                self._queues.remove(stream)

    def publish(self, message: str) -> None:
        with self._lock:
            listeners = list(self._queues)
        for stream in listeners:
            stream.put(message)

    def _report_reap_failure(self, failure: BaseException) -> None:
        """Say a reap cycle failed, once per distinct failure.

        This thread has no caller to return to and no logger, and its own
        channel carries board changes rather than diagnostics, so stderr is
        where it says what it found — the same place the listener reports a
        missing build. Deduplicated because the interesting fact is that reaping
        broke, and a locked store would otherwise repeat it every two seconds
        for as long as the platform runs.
        """

        text = f"{type(failure).__name__}: {failure}"
        if text == self._reported_reap_failure:
            return
        self._reported_reap_failure = text
        print(f"warning: reaping finished launches failed: {text}", file=sys.stderr)  # noqa: T201

    def run(self, interval: float = 0.4, cycles: int | None = None) -> None:
        """Watch for change until the process ends.

        `cycles` bounds the loop so a test can run it to completion; the server
        passes nothing and this never returns.
        """

        conn = connect()
        version = conn.execute("PRAGMA data_version").fetchone()[0]
        ticks = 0
        while cycles is None or ticks < cycles:
            time.sleep(interval)
            ticks += 1
            # A launch that ended has to be noticed even when nobody is looking:
            # its card owes a session status, a comment and a move to review.
            # One failed cycle must not end the thread that owes every later
            # one — reaping, the move to review, and every change notification
            # a stream is waiting on all live here — so a failure is reported
            # and the loop goes on. The helper keeps its own rollback-and-raise
            # contract; the isolation belongs to the thing that must not die.
            if ticks % 5 == 0:
                try:
                    reaped = reap_sessions_if_enabled(conn)
                except Exception as failure:  # noqa: BLE001 -- this loop is the boundary
                    self._report_reap_failure(failure)
                else:
                    self._reported_reap_failure = ""
                    if reaped:
                        version = conn.execute("PRAGMA data_version").fetchone()[0]
                        self.publish("changed")
                        continue
            with self._lock:
                idle = not self._queues
            if idle:
                continue
            current = conn.execute("PRAGMA data_version").fetchone()[0]
            if current != version:
                version = current
                self.publish("changed")


WATCHERS = Watchers()


def _improvements_enabled(_primary_db: str) -> bool:
    conn = connect()
    try:
        platform_core.require_module_enabled(conn, "improvements")
        return True
    except platform_core.PlatformHttpError:
        return False
    finally:
        conn.close()


IMPROVEMENTS_RUNTIME = improvements_integration.ImprovementsRuntime(
    WATCHERS.publish, _improvements_enabled
)


def _module_state_changed(primary_db: str, module_id: str, state: str) -> None:
    if module_id == "improvements":
        IMPROVEMENTS_RUNTIME.module_state_changed(primary_db, state)


platform_modules.register_state_observer(_module_state_changed)
