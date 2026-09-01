"""What was last known about a Connection's health, and what a read may spend.

Every kernel read reconstructs the registry, and the registry used to probe
every registered Connection while it did. For a built-in that is a `which` call;
for an installed CLI or MCP adapter it is a child process, and a dead one costs
its whole probe timeout — up to sixty seconds — on a request whose Platform
instance then dies, so the next read pays it again. One installed adapter being
down made every read of the Kernel slow, which is the opposite of the property
the health contract exists to give.

So health is remembered here rather than re-derived per request, and a read
spends a stated allowance on refreshing it:

- An observation is *fresh* for `FRESH_MS`. A read serves a fresh one without
  probing anything.
- A read may spend at most `READ_PROBE_BUDGET_MS` in total on probes, and it
  never *starts* a probe whose enforced ceiling exceeds what is left of that
  allowance. A probe cut short would report a healthy-but-slow adapter as down;
  one never started leaves the Connection on its last known state, which is
  what `observed_at` is for.
- A sweep with no budget probes everything. That is the off-request-path
  observation — `Platform.observe_connection_health` — and it is where an
  expensive adapter's health actually gets refreshed.

The ceiling is reported by the provider and enforced by it, never declared in a
manifest: a number chosen by the party being probed would make the read's bound
fictional exactly when it matters.

Nothing here reaches a provider or a store. It holds observations, decides what
is stale, and decides what a caller can afford; the caller owns the probe.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

#: How long one observation is served as current. Long enough that a page of
#: Connections costs one sweep rather than one per read, short enough that an
#: adapter that just came back is not reported down for a minute.
FRESH_MS = 15_000

#: What one kernel read may spend probing, in total. A read is a request; the
#: number is the latency a Settings page or a registry fetch may add for the
#: sake of live health, and nothing about an adapter can raise it.
READ_PROBE_BUDGET_MS = 1_000


@dataclass(frozen=True)
class Observation:
    """One provider's answer, and when it was given.

    `observed_at` is for the reader, `stamp` for the freshness arithmetic: a
    wall clock can move backwards, and staleness measured on one would then
    keep a stale entry forever.
    """

    health: str
    diagnostics: dict | None
    observed_at: str
    stamp: float


class Observations:
    """Last-known health per Connection, per store.

    Keyed by the store as well as the Connection because a connection key is
    identical across installations — the built-ins seed the same keys into every
    store — and two stores in one process must not read each other's answers.
    """

    def __init__(self) -> None:
        self._entries: dict[tuple[str, str], Observation] = {}
        self._lock = threading.Lock()

    def read(self, store: str, key: str) -> Observation | None:
        """The last observation, however old. Its age is the caller's to report."""

        with self._lock:
            return self._entries.get((store, key))

    def fresh(self, store: str, key: str, *, within_ms: int = FRESH_MS) -> Observation | None:
        observation = self.read(store, key)
        if observation is None:
            return None
        if (time.monotonic() - observation.stamp) * 1000 > within_ms:
            return None
        return observation

    def record(self, store: str, key: str, health: str, diagnostics: dict | None) -> Observation:
        observation = Observation(
            health=health,
            diagnostics=diagnostics,
            observed_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            stamp=time.monotonic(),
        )
        with self._lock:
            self._entries[(store, key)] = observation
        return observation

    def forget(self, store: str, keys: Iterable[str]) -> None:
        """Drop what is known about Connections that no longer exist."""

        with self._lock:
            for key in keys:
                self._entries.pop((store, key), None)

    def clear(self) -> None:
        """Forget everything. For a test that needs a probe to happen again."""

        with self._lock:
            self._entries.clear()


#: Read through this module, never bound by name: a test that clears it has to
#: reach every reader, and `from .health import OBSERVED` gives each importer a
#: private copy the clear cannot see.
OBSERVED = Observations()


def observe(
    store: str,
    entries: Sequence[tuple[str, int]],
    probe: Callable[[str], tuple[str, dict | None]],
    *,
    budget_ms: int | None,
    within_ms: int = FRESH_MS,
) -> None:
    """Refresh what is stale, within the allowance, and record what came back.

    `entries` pairs each Connection key with the enforced ceiling on one probe
    of it. A budget of `None` is the unbounded sweep; `within_ms` of zero
    re-probes everything regardless of what is already known.
    """

    deadline = None if budget_ms is None else time.monotonic() + budget_ms / 1000
    for key, ceiling_ms in entries:
        if within_ms and OBSERVED.fresh(store, key, within_ms=within_ms) is not None:
            continue
        if deadline is not None and time.monotonic() + ceiling_ms / 1000 > deadline:
            continue
        state, diagnostics = probe(key)
        OBSERVED.record(store, key, state, diagnostics)


__all__ = [
    "FRESH_MS",
    "OBSERVED",
    "READ_PROBE_BUDGET_MS",
    "Observation",
    "Observations",
    "observe",
]
