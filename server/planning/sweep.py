"""The planning sweep: what Planning releases by time, pass after pass.

Of Planning's work rules only these wait for nobody's call: a lease lapses while
its session is silent or gone, and what the session follows lapses with it. A
pass of this sweep is what releases them. `housekeeping` runs the first pass when
a long-lived process starts, inside its start-up budget, and then repeats it on
its own connection in a background thread of both processes that start up, the
MCP loop and the listener. Two processes passing at once need no agreement: a
step is idempotent, and every write compares the revision it read.

The steps are `STEPS`, in order. A step is `Step(name, pending, apply)`:

- `pending(conn)` reads, without the write lock, whether there is anything to do;
- `apply(conn)` does it inside the `BEGIN IMMEDIATE` the pass opened and commits,
  and answers how many rows it changed.

What every step promises, because the steps added later lean on it:

1. it is idempotent: a second pass in a row changes nothing;
2. it writes as Valkama's own call, so the history says who and why: the pass
   binds `calls.valkama()` with the step's name as the tool, and a step whose
   writes are recorded under a name of their own binds that one inside
   (the lease expiry's `leases.EXPIRY_TOOL`, one call per item);
3. it changes at most `LIMIT` items in one pass and leaves the rest to the next;
4. it reads the time from `leases.utc_now`, which tests replace.

A step with nothing pending takes no write lock. A store another writer holds is
given up after the connection's busy timeout, which the caller keeps short, and
the step waits for the next pass. A step that fails is rolled back and reported,
and the next step still runs.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from ..hooks import light
from . import calls, service, subscriptions

#: The most items one step changes in one pass; the next pass takes the rest.
LIMIT = 200

LEASES = "leases"
SUBSCRIPTIONS = "subscriptions"


@dataclass(frozen=True)
class Step:
    """One step of a pass: its name, whether it has work, and the work."""

    name: str
    pending: Callable[[sqlite3.Connection], bool]
    apply: Callable[[sqlite3.Connection], int]


@dataclass
class Pass:
    """What one pass did, by step name."""

    #: How many rows each step that had work changed.
    changed: dict[str, int] = field(default_factory=dict)
    #: The steps that gave up a store another writer held; they run at the next pass.
    busy: list[str] = field(default_factory=list)
    #: The steps not started because the caller's deadline had passed.
    left: list[str] = field(default_factory=list)
    #: The steps that failed, with the error; each was rolled back.
    failures: dict[str, Exception] = field(default_factory=dict)


def run_pass(
    conn: sqlite3.Connection,
    *,
    steps: Sequence[Step] | None = None,
    deadline: float | None = None,
) -> Pass:
    """Run `steps`, `STEPS` unless given, in order, each in its own transaction.

    `conn` must be outside any transaction; how long a step waits for the write
    lock is its busy timeout. With `deadline`, a `time.monotonic()` value, a step
    not started by then is left for the next pass.
    """

    done = Pass()
    for step in STEPS if steps is None else steps:
        if deadline is not None and time.monotonic() >= deadline:
            done.left.append(step.name)
            continue
        try:
            if step.pending(conn):
                done.changed[step.name] = _apply(conn, step)
        except sqlite3.OperationalError as error:
            if light.reason(error) == "busy":
                done.busy.append(step.name)
            else:
                done.failures[step.name] = error
        except Exception as error:  # noqa: BLE001 -- reported; the next step still runs
            done.failures[step.name] = error
    return done


def _apply(conn: sqlite3.Connection, step: Step) -> int:
    conn.execute("BEGIN IMMEDIATE")
    try:
        with calls.bind(calls.valkama(), step.name):
            changed = step.apply(conn)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return changed


def _leases_pending(conn: sqlite3.Connection) -> bool:
    return next(service.lapsed_holds(conn), None) is not None


def _leases(conn: sqlite3.Connection) -> int:
    return service.expire_leases(conn, limit=LIMIT)


def _subscriptions_pending(conn: sqlite3.Connection) -> bool:
    return next(subscriptions.lapsed(conn), None) is not None


def _subscriptions(conn: sqlite3.Connection) -> int:
    return subscriptions.expire(conn, limit=LIMIT)


#: The steps of a pass, in order. The leases go first: the subscriptions of a
#: session lapse by the same rule, and a later step may ask who still holds what.
STEPS: tuple[Step, ...] = (
    Step(LEASES, _leases_pending, _leases),
    Step(SUBSCRIPTIONS, _subscriptions_pending, _subscriptions),
)
