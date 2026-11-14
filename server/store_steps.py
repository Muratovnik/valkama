"""A forward-only migration as named steps in one transaction: timed, checked, reported.

A migration that changes what rows mean is a sequence of steps, and each step
answers three questions: is it needed here, what does it do, and does what it did
hold. After the last step the store takes its new schema number and every
postcondition is checked against it, still inside the same transaction, so a step
that fails or a postcondition that does not hold leaves the store as it was: the
caller rolls the transaction back.

Every step and every postcondition is timed with a monotonic clock and recorded in
one report, a plain dict that serializes as JSON. A postcondition that does not hold
does not stop the others: the report carries every result, so one run says
everything that is wrong rather than the first thing.

What the steps share -- the facts the caller established before the first write and
whatever one step leaves for the next -- travels in one `Context`. This module knows
nothing about any table; the steps do.
"""

from __future__ import annotations

import contextlib
import sqlite3
import time
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any


class UnmetError(RuntimeError):
    """A check that does not hold, saying what it found."""


class RunFailedError(RuntimeError):
    """A run that did not finish: a step failed or a postcondition did not hold.

    Carries the report, which names what failed. The transaction is the caller's to
    roll back.
    """

    def __init__(self, report: dict[str, Any], message: str) -> None:
        super().__init__(message)
        self.report = report


def _always(conn: sqlite3.Connection, context: Context) -> bool:
    del conn, context
    return True


def _nothing(conn: sqlite3.Connection, context: Context) -> None:
    del conn, context


@dataclass(frozen=True)
class Step:
    """One step: `needed` decides whether `run` runs, and `check` runs either way.

    `run` answers what it did, as counts or names for the report, or None.
    """

    name: str
    title: str
    run: Callable[[sqlite3.Connection, Context], Mapping[str, Any] | None]
    needed: Callable[[sqlite3.Connection, Context], bool] = _always
    check: Callable[[sqlite3.Connection, Context], None] = _nothing


@dataclass(frozen=True)
class Postcondition:
    """One thing the migrated store must hold. `check` raises `UnmetError` when it does not,
    and otherwise answers what it measured, or None."""

    name: str
    title: str
    check: Callable[[sqlite3.Connection, Context], Mapping[str, Any] | None]


@dataclass
class Context:
    """What one run's steps and postconditions share.

    `now` is the one moment every record the run writes carries, and `schema` the
    number the run stamps. `recovery_point`
    and `source_identity` are the verified copy taken before the transaction and the
    logical identity it holds; `identity_before` is that identity read again inside
    the transaction, before the first write. `reference` opens a fresh store of this
    build to compare shapes with. `memo` is where a step leaves what a later step or
    a postcondition reads.
    """

    now: str
    schema: int = 0
    steps: tuple[Step, ...] = ()
    recovery_point: str = ""
    source_identity: str = ""
    identity_before: str = ""
    images: str = ""
    reference: Callable[[], contextlib.AbstractContextManager[sqlite3.Connection]] | None = None
    memo: dict[str, Any] = field(default_factory=dict)


def new_report(migration: str) -> dict[str, Any]:
    """An empty report for one run of `migration`."""

    return {"migration": migration, "phases": [], "steps": [], "postconditions": []}


def _seconds(start: float) -> float:
    return round(time.perf_counter() - start, 6)


@contextlib.contextmanager
def phase(report: dict[str, Any], name: str) -> Iterator[None]:
    """Time one phase of a run into the report, whether it finishes or raises."""

    start = time.perf_counter()
    try:
        yield
    finally:
        report["phases"].append({"name": name, "seconds": _seconds(start)})


def run(
    conn: sqlite3.Connection,
    *,
    steps: tuple[Step, ...],
    postconditions: tuple[Postcondition, ...],
    context: Context,
    report: dict[str, Any],
    schema: int,
) -> None:
    """Run every step, stamp `schema`, then check every postcondition.

    All of it inside the transaction the caller opened. The first step that raises
    stops the run; every postcondition is checked even after one fails. Either way
    `RunFailedError` is raised with the report naming what failed, and the caller rolls back.
    """

    context.steps = steps
    context.schema = schema
    for step in steps:
        entry: dict[str, Any] = {"name": step.name, "title": step.title}
        report["steps"].append(entry)
        start = time.perf_counter()
        try:
            entry["needed"] = bool(step.needed(conn, context))
            if entry["needed"]:
                result = step.run(conn, context)
                if result:
                    entry["result"] = dict(result)
            step.check(conn, context)
        except Exception as error:
            entry["error"] = f"{type(error).__name__}: {error}"
            report["failed"] = [step.name]
            raise RunFailedError(report, f"step {step.name} failed: {error}") from error
        finally:
            entry["seconds"] = _seconds(start)
    conn.execute(f"PRAGMA user_version={int(schema)}")
    failed: list[str] = []
    for postcondition in postconditions:
        outcome: dict[str, Any] = {"name": postcondition.name, "title": postcondition.title}
        report["postconditions"].append(outcome)
        start = time.perf_counter()
        try:
            measured = postcondition.check(conn, context)
            outcome["passed"] = True
            if measured:
                outcome["detail"] = dict(measured)
        except UnmetError as error:
            outcome["passed"] = False
            outcome["error"] = str(error)
            failed.append(postcondition.name)
        # A check that cannot even be asked has not held either, and the others still
        # say what they can; the report names the error.
        except Exception as error:  # noqa: BLE001
            outcome["passed"] = False
            outcome["error"] = f"{type(error).__name__}: {error}"
            failed.append(postcondition.name)
        finally:
            outcome["seconds"] = _seconds(start)
    if failed:
        report["failed"] = failed
        raise RunFailedError(report, f"postconditions not met: {', '.join(failed)}")
