"""How much of the prompt cache a request read after a pause of a given length, per environment.

The report of pauses between model requests (`telemetry.usage_pauses`) over the runs the
usage reader knows (`usage_runs`), read from their transcripts again and from nothing else:
the store is only read, and nothing is collected or kept but in this process's memory.

An environment is the client, the role (`main`, a session's own run; `subagent`, any other),
the model that answered and the sign-in where it is known: `subscription` for an organization
the subscription quota knows (`quota_accounts`, `quota_samples`), which only a subscription
has, else `null`. Within an environment, a request is counted by what its pause waited on
(`wait`: `machine`, `person` or `wake`, as `telemetry.usage_pauses` says) and by the length of
the pause, in the buckets of `BUCKETS`. The edges stand either side of the two cache lives the
clients offer, five minutes and an hour, so a cliff at either falls between two buckets:

| Bucket | Pause |
|---|---|
| `0-4m` | under 4 minutes |
| `4-5m` | 4 to 5 minutes |
| `5-6m` | 5 to 6 minutes |
| `6-30m` | 6 to 30 minutes |
| `30-60m` | 30 to 60 minutes |
| `60-70m` | 60 to 70 minutes |
| `70m-3h` | 70 minutes to 3 hours |
| `3-12h` | 3 to 12 hours |
| `12h+` | 12 hours and over |

A bucket holds its lower edge and not its upper one. The first request of a run has no pause
and is in no bucket.

Each row of the report is one environment, one wait and one bucket that had a request, with:
`requests`; the tokens those requests sent by kind (`input_tokens`, `cached_read_tokens`,
`cache_write_5m_tokens`, `cache_write_1h_tokens`) and their sum, `context_tokens`; `read_share`,
the cache reads over the context, and `write_share`, the cache writes over it, both over the
row's tokens together; `cold_requests`, the requests that read under `COLD_SHARE` of their own
context from the cache; `estimated_api_cost_usd` of the requests with a price, and
`unpriced_requests`, those without one; and, where the client tells background work
(`background_known`), `background_requests` and `background_cold_requests`, those sent while
it ran. A wake row's requests and cost are what the wakes cost.

A request counts in the hour it was sent in: a period is read in whole hours of UTC, `from`
rounded down to its hour and `to` up. A run's hours are kept here for each state of its file
(its size and change time), so a period read again reads only the files that changed; many
runs to read at once are parsed over a pool of processes (`Reader.read`), each of which only
reads transcripts and returns their bins. A read can be given a deadline: the HTTP surface's
is, so that a first read of gigabytes of transcripts answers how far it got by then rather
than outlast the browser's wait. The pool goes on parsing after that answer, and the read asked
again takes what it parsed meanwhile and waits on the rest.
"""

from __future__ import annotations

import datetime as dt
import math
import multiprocessing
import os
import sqlite3
import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent import futures
from dataclasses import dataclass

from .. import transcripts
from ..telemetry import usage_collect, usage_ledger, usage_pauses
from ..telemetry.usage_targets import CODEX, Finder, Target
from . import usage

INTERFACE = "valkama-usage-pauses"
MAIN = "main"
SUBAGENT = "subagent"
SUBSCRIPTION = "subscription"
#: Under this share of its context read from the cache, a request was sent cold.
COLD_SHARE = 0.5

_MINUTE = 60
_HOUR = 3600
#: Each bucket's key and lower edge in seconds, in order; the last has no upper edge.
BUCKETS: tuple[tuple[str, int], ...] = (
    ("0-4m", 0),
    ("4-5m", 4 * _MINUTE),
    ("5-6m", 5 * _MINUTE),
    ("6-30m", 6 * _MINUTE),
    ("30-60m", 30 * _MINUTE),
    ("60-70m", 60 * _MINUTE),
    ("70m-3h", 70 * _MINUTE),
    ("3-12h", 3 * _HOUR),
    ("12h+", 12 * _HOUR),
)
_EDGES = tuple(edge for _key, edge in BUCKETS)

# What a bin adds up, by position.
_REQUESTS, _INPUT, _READ, _WRITE_5M, _WRITE_1H, _COLD, _COST, _UNPRICED = range(8)
_BG_REQUESTS, _BG_COLD = 8, 9
_MEASURES = 10


def bucket_of(pause: float) -> int:
    """The index in `BUCKETS` of the bucket a pause of `pause` seconds falls in."""

    index = 0
    for position, edge in enumerate(_EDGES):
        if pause >= edge:
            index = position
    return index


#: One bin of a run: the hour it starts at in seconds since the epoch, the wait, the
#: bucket's index, the model, the organization, and whether background work ran.
_Bin = tuple[int, str, int, str, str | None, bool | None]


def _bins(requests: Iterable[usage_pauses.Request]) -> dict[_Bin, list[float]]:
    found: dict[_Bin, list[float]] = {}
    for request in requests:
        if request.pause is None:
            continue
        hour = int(request.sent_at // _HOUR) * _HOUR
        key = (
            hour,
            request.wait,
            bucket_of(request.pause),
            request.model,
            request.organization,
            request.background,
        )
        sums = found.setdefault(key, [0.0] * _MEASURES)
        tokens = request.tokens
        context = request.context
        cold = context > 0 and tokens.get("cached_read", 0) < COLD_SHARE * context
        sums[_REQUESTS] += 1
        sums[_INPUT] += tokens.get("input", 0)
        sums[_READ] += tokens.get("cached_read", 0)
        sums[_WRITE_5M] += tokens.get("cache_write_5m", 0)
        sums[_WRITE_1H] += tokens.get("cache_write_1h", 0)
        sums[_COLD] += cold
        if request.cost is None:
            sums[_UNPRICED] += 1
        else:
            sums[_COST] += request.cost
        if request.background:
            sums[_BG_REQUESTS] += 1
            sums[_BG_COLD] += cold
    return found


@dataclass(frozen=True)
class _Kept:
    """A run's bins for one state of the file they were read from."""

    path: str
    size: int
    changed: int
    bins: dict[_Bin, list[float]] | None


#: From this many runs to read on, they are read over a pool of processes: a run's file is
#: parsed whole, which is the read's whole cost, and one process parsed four weeks of runs in
#: about 23 seconds where eight did it in under 5. Fewer runs are read here, with no process
#: to start.
POOL_FROM = 24
#: The pool's processes, at most: past eight the largest file alone set the time.
POOL_WORKERS = 8


def bins_of(target: Target) -> dict[_Bin, list[float]] | None:
    """A run's bins from its transcript, or None when there is none to read."""

    try:
        requests = usage_pauses.read_requests(target)
    except OSError:
        return None
    return None if requests is None else _bins(requests)


#: Runs a process of the pool reads at a time: small enough that one deadline leaves little
#: reading to wait for, large enough that the pool is not mostly passing work around.
_CHUNK = 4

_Read = dict[int, dict[_Bin, list[float]] | None]
#: A file's path, size and change time: the state a run's bins were read from.
_State = tuple[str, int, int]


def _chunk_bins(targets: Sequence[Target]) -> list[dict[_Bin, list[float]] | None]:
    return [bins_of(target) for target in targets]


def _here(targets: Sequence[Target], until: float | None) -> _Read:
    """`bins_of` of the targets in turn, in this process, until `until` passes."""

    read: _Read = {}
    for index, target in enumerate(targets):
        if until is not None and time.monotonic() >= until:
            break
        read[index] = bins_of(target)
    return read


class UnfinishedError(Exception):
    """A read whose deadline passed before every run was read: how many were and how many not."""

    def __init__(self, read: int, left: int) -> None:
        super().__init__(f"{left} of {read + left} runs are still to read")
        self.read = read
        self.left = left


#: How a process of the pool reads a chunk of runs: `_chunk_bins`, or a slower one a test hands.
ChunkReader = Callable[[Sequence[Target]], list[dict[_Bin, list[float]] | None]]
_Key = tuple[str, str]
_Job = futures.Future


def _key(target: Target) -> _Key:
    return (target.session, target.agent)


class Reader:
    """The bins of each run, read again only when its file changed. One per process.

    Many runs are read over a pool of processes that outlives the read that asked them. A read
    with a deadline answers by it whatever the pool is still reading, and calls nothing off: a
    chunk still being read lands among the runs kept when it ends (`_land`), so the read asked
    again finds it there or waits on it, and no run is read twice. The pool retires once it has
    nothing left to read, and `close` stops it and what it still holds; the server closes the
    process's reader when it stops, so no process of the pool outlives it.
    """

    def __init__(self, chunk: ChunkReader = _chunk_bins) -> None:
        self._chunk = chunk
        self._lock = threading.RLock()
        self._kept: dict[_Key, _Kept] = {}
        #: The job reading each run in the pool now, and for each job its runs' file states.
        self._flying: dict[_Key, _Job] = {}
        self._loads: dict[_Job, list[tuple[_Key, _State]]] = {}
        self._pool: futures.ProcessPoolExecutor | None = None

    def _split(
        self, targets: Sequence[Target]
    ) -> tuple[list[dict[_Bin, list[float]] | None], list[tuple[int, Target, _State]]]:
        """The bins kept of each target still as its file is, and the targets to read again."""

        found: list[dict[_Bin, list[float]] | None] = [None] * len(targets)
        stale: list[tuple[int, Target, _State]] = []
        for index, target in enumerate(targets):
            path = usage_collect.source(target)
            if path is None:
                continue
            try:
                status = os.stat(path)
            except OSError:
                continue
            state = (path, status.st_size, status.st_mtime_ns)
            kept = self._kept.get(_key(target))
            if kept and (kept.path, kept.size, kept.changed) == state:
                found[index] = kept.bins
            else:
                stale.append((index, target, state))
        return found, stale

    def _keep(self, key: _Key, state: _State, bins: dict[_Bin, list[float]] | None) -> None:
        """Keep bins read from `state`, unless a later state of the same file is kept already."""

        with self._lock:
            kept = self._kept.get(key)
            if kept is None or kept.changed <= state[2]:
                self._kept[key] = _Kept(*state, bins)

    def _land(self, job: _Job) -> None:
        """Keep what a finished job read; a job may land twice, from its callback and its read."""

        with self._lock:
            loads = self._loads.pop(job, None)
            if loads is None:
                return
            for key, _state in loads:
                if self._flying.get(key) is job:
                    del self._flying[key]
            if not job.cancelled() and job.exception() is None:
                for (key, state), bins in zip(loads, job.result(), strict=True):
                    self._keep(key, state, bins)
            broken = not job.cancelled() and isinstance(
                job.exception(), futures.process.BrokenProcessPool
            )
            if (broken or not self._loads) and self._pool is not None:
                # Nothing left to read, or no process left to read it: the pool's processes
                # end once it is shut, and the next read that needs them starts a new one. Not
                # shut with its jobs called off: a broken pool fails them while it runs this.
                self._pool.shutdown(wait=False)
                self._pool = None

    def _send(self, stale: Sequence[tuple[int, Target, _State]]) -> dict[_Key, _Job] | None:
        """The job reading each stale run in the pool: one already reading that state of its file,
        or a new chunk's. None where no pool can run, and the runs are read here instead."""

        jobs: dict[_Key, _Job] = {}
        fresh: list[tuple[Target, _State]] = []
        with self._lock:
            for _index, target, state in stale:
                job = self._flying.get(_key(target))
                if job is not None and (_key(target), state) in self._loads.get(job, ()):
                    jobs[_key(target)] = job
                else:
                    fresh.append((target, state))
            if not fresh:
                return jobs
            workers = min(POOL_WORKERS, os.cpu_count() or 1)
            if self._pool is None:
                if workers < 2:
                    return None
                try:
                    self._pool = futures.ProcessPoolExecutor(
                        workers, mp_context=multiprocessing.get_context("spawn")
                    )
                except OSError:
                    return None
            sent: list[_Job] = []
            try:
                for at in range(0, len(fresh), _CHUNK):
                    piece = fresh[at : at + _CHUNK]
                    job = self._pool.submit(self._chunk, [target for target, _state in piece])
                    self._loads[job] = [(_key(target), state) for target, state in piece]
                    for target, _state in piece:
                        self._flying[_key(target)] = job
                        jobs[_key(target)] = job
                    sent.append(job)
            except (RuntimeError, futures.process.BrokenProcessPool):
                if not sent:
                    self._pool = None
                    return None
        for job in sent:
            job.add_done_callback(self._land)
        return jobs

    def read(
        self, targets: Sequence[Target], *, until: float | None = None
    ) -> list[dict[_Bin, list[float]] | None]:
        """Each run's bins, in the order given; None for one whose transcript is nowhere to read.

        A run whose file changed since it was read, or was never read, is read again; once
        `POOL_FROM` of them are, or one is being read there already, over the pool of processes
        (`POOL_WORKERS`). With `until`, a `time.monotonic()` moment, the read answers by then:
        the runs not read are left and `UnfinishedError` says how many, while the pool goes on
        reading them, so the next read finds them kept or waits on the same jobs.
        """

        with self._lock:
            found, stale = self._split(targets)
            busy = any(_key(target) in self._flying for _index, target, _state in stale)
        if not stale:
            return found
        jobs = self._send(stale) if len(stale) >= POOL_FROM or busy else None
        here = list(stale) if jobs is None else []
        if jobs is not None:
            wait = None if until is None else max(0.0, until - time.monotonic())
            futures.wait(set(jobs.values()), timeout=wait)
            for job in set(jobs.values()):
                if not job.done():
                    continue
                self._land(job)
                failure = None if job.cancelled() else job.exception()
                if isinstance(failure, futures.process.BrokenProcessPool):
                    here += [entry for entry in stale if jobs[_key(entry[1])] is job]
                elif failure is not None:
                    raise failure
        for at, bins in _here([target for _index, target, _state in here], until).items():
            _index, target, state = here[at]
            self._keep(_key(target), state, bins)
        left = 0
        with self._lock:
            for index, target, (path, size, changed) in stale:
                kept = self._kept.get(_key(target))
                if kept and (kept.path, kept.size, kept.changed) == (path, size, changed):
                    found[index] = kept.bins
                else:
                    left += 1
        if left:
            raise UnfinishedError(len(targets) - left, left)
        return found

    def close(self) -> None:
        """Stop the pool: the chunks it has not started are called off, those it reads end."""

        with self._lock:
            pool, self._pool = self._pool, None
        if pool is not None:
            pool.shutdown(wait=True, cancel_futures=True)


#: The process's one reader, which the HTTP surface's reads share.
READER = Reader()


def _store_path(conn: sqlite3.Connection) -> str:
    row = conn.execute("PRAGMA database_list").fetchone()
    return str(row[2])


def _subscriptions(conn: sqlite3.Connection) -> frozenset[str]:
    return frozenset(
        str(row[0])
        for row in conn.execute(
            "SELECT organization FROM quota_accounts"
            " UNION SELECT organization FROM quota_samples WHERE organization IS NOT NULL"
        )
    )


def _stamp(seconds: float) -> str:
    return dt.datetime.fromtimestamp(seconds, dt.UTC).isoformat(timespec="seconds")


def _share(part: float, whole: float) -> float | None:
    return round(part / whole, 4) if whole else None


def _row(key: tuple, sums: Sequence[float], background_known: bool) -> dict:
    client, role, model, auth, wait, bucket = key
    context = sum(sums[index] for index in (_INPUT, _READ, _WRITE_5M, _WRITE_1H))
    return {
        "client": client,
        "role": role,
        "model": model,
        "auth": auth,
        "wait": wait,
        "bucket": BUCKETS[bucket][0],
        "requests": int(sums[_REQUESTS]),
        "context_tokens": int(context),
        "input_tokens": int(sums[_INPUT]),
        "cached_read_tokens": int(sums[_READ]),
        "cache_write_5m_tokens": int(sums[_WRITE_5M]),
        "cache_write_1h_tokens": int(sums[_WRITE_1H]),
        "read_share": _share(sums[_READ], context),
        "write_share": _share(sums[_WRITE_5M] + sums[_WRITE_1H], context),
        "cold_requests": int(sums[_COLD]),
        "estimated_api_cost_usd": round(sums[_COST], 6),
        "unpriced_requests": int(sums[_UNPRICED]),
        "background_known": background_known,
        "background_requests": int(sums[_BG_REQUESTS]) if background_known else None,
        "background_cold_requests": int(sums[_BG_COLD]) if background_known else None,
    }


def _order(row: Mapping) -> tuple:
    return (
        row["client"],
        row["role"] != MAIN,
        row["model"],
        row["auth"] or "",
        usage_pauses.WAITS.index(row["wait"]),
        [key for key, _edge in BUCKETS].index(row["bucket"]),
    )


def read(
    conn: sqlite3.Connection,
    *,
    start: float,
    end: float,
    clients: Sequence[str] = (),
    project: str | None = None,
    reader: Reader | None = None,
    until: float | None = None,
) -> dict:
    """The report over the hours from `start` to `end`, seconds since the epoch (see the module).

    `clients` narrows it to those clients; none is every one. `project` narrows it to the runs
    with work in the period that the usage read places in that project
    (`usage.project_runs`), each run whole. `conn` is only read, and must
    give rows by name. With `until`, a `time.monotonic()` moment, runs not read by then raise
    `UnfinishedError`, and a read asked again goes on from the runs this one read.
    """

    if end <= start:
        raise ValueError("to must be later than from")
    first = math.floor(start / _HOUR) * _HOUR
    last = math.ceil(end / _HOUR) * _HOUR
    reader = reader or READER
    runs = {
        (str(row["session_id"]), str(row["agent_id"])): row
        for row in conn.execute(
            "SELECT session_id, agent_id, client FROM usage_runs"
            " WHERE first_at IS NOT NULL AND first_at < ? AND last_at >= ?",
            (usage_ledger.stamp(last), usage_ledger.stamp(first)),
        )
        if not clients or row["client"] in clients
    }
    if project is not None:
        held = usage.project_runs(conn, project, start=first, end=last)
        runs = {key: row for key, row in runs.items() if key in held}
    subscriptions = _subscriptions(conn)
    totals: dict[tuple, list[float]] = {}
    known: dict[tuple, bool] = {}
    read_runs = missing = 0
    finder = Finder(conn, transcripts.directory(_store_path(conn)))
    targets = [target for target in finder.targets(set()) if (target.session, target.agent) in runs]
    for target, bins in zip(targets, reader.read(targets, until=until), strict=True):
        run = runs[(target.session, target.agent)]
        if bins is None:
            missing += 1
            continue
        read_runs += 1
        client = str(run["client"])
        role = MAIN if not target.agent else SUBAGENT
        for (hour, wait, bucket, model, organization, _bg), sums in bins.items():
            if not first <= hour < last:
                continue
            auth = SUBSCRIPTION if organization in subscriptions else None
            key = (client, role, model, auth, wait, bucket)
            into = totals.setdefault(key, [0.0] * _MEASURES)
            for index, value in enumerate(sums):
                into[index] += value
            known[key] = client != CODEX
    rows = sorted((_row(key, sums, known[key]) for key, sums in totals.items()), key=_order)
    return {
        "interface_version": INTERFACE,
        "from": _stamp(first),
        "to": _stamp(last),
        "project": project,
        "buckets": [
            {
                "key": key,
                "from_seconds": edge,
                "to_seconds": BUCKETS[index + 1][1] if index + 1 < len(BUCKETS) else None,
            }
            for index, (key, edge) in enumerate(BUCKETS)
        ],
        "waits": list(usage_pauses.WAITS),
        "cold_share": COLD_SHARE,
        "runs": {"read": read_runs, "missing": missing},
        "rows": rows,
    }


def render(report: Mapping) -> str:
    """The report as text: a block per environment and wait, a line per bucket."""

    lines = [f"Pauses before model requests, {report['from']} to {report['to']}"]
    if report["project"]:
        lines.append(f"Runs with work in project {report['project']}")
    runs = report["runs"]
    lines.append(f"{runs['read']} runs read, {runs['missing']} with no transcript to read")
    if not report["rows"]:
        lines.append("No request in the period.")
        return "\n".join(lines)
    heading = None
    for row in report["rows"]:
        environment = (row["client"], row["role"], row["model"], row["auth"], row["wait"])
        if environment != heading:
            heading = environment
            auth = row["auth"] or "auth unknown"
            lines.append("")
            lines.append(
                f"{row['client']} {row['role']} {row['model']} ({auth}), waits on {row['wait']}"
            )
            lines.append(
                f"  {'pause':<8} {'requests':>9} {'read':>6} {'write':>6} {'cold':>6}"
                f" {'bg':>6} {'cost $':>10}"
            )
        lines.append(
            f"  {row['bucket']:<8} {row['requests']:>9} {_percent(row['read_share']):>6}"
            f" {_percent(row['write_share']):>6} {row['cold_requests']:>6}"
            f" {_count(row['background_requests']):>6} {row['estimated_api_cost_usd']:>10.2f}"
        )
    return "\n".join(lines)


def _percent(share: float | None) -> str:
    return "-" if share is None else f"{share * 100:.0f}%"


def _count(value: int | None) -> str:
    return "-" if value is None else str(value)
