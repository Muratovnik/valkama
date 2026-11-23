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
(its size and change time), so a period read again reads only the files that changed.
"""

from __future__ import annotations

import datetime as dt
import math
import os
import sqlite3
import threading
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from .. import transcripts
from ..telemetry import usage_collect, usage_ledger, usage_pauses
from ..telemetry.usage_targets import CODEX, Finder, Target

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
    bins: dict[_Bin, list[float]]


class Reader:
    """The bins of each run, read again only when its file changed. One per process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._kept: dict[tuple[str, str], _Kept] = {}

    def bins(self, target: Target) -> dict[_Bin, list[float]] | None:
        """A run's bins, or None when its transcript is nowhere to read."""

        path = usage_collect.source(target)
        if path is None:
            return None
        try:
            status = os.stat(path)
        except OSError:
            return None
        key = (target.session, target.agent)
        with self._lock:
            kept = self._kept.get(key)
            if kept and (kept.path, kept.size, kept.changed) == (
                path,
                status.st_size,
                status.st_mtime_ns,
            ):
                return kept.bins
            try:
                requests = usage_pauses.read_requests(target)
            except OSError:
                return None
            if requests is None:
                return None
            bins = _bins(requests)
            self._kept[key] = _Kept(path, status.st_size, status.st_mtime_ns, bins)
            return bins


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
    reader: Reader | None = None,
) -> dict:
    """The report over the hours from `start` to `end`, seconds since the epoch (see the module).

    `clients` narrows it to those clients; none is every one. `conn` is only read, and must
    give rows by name.
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
    subscriptions = _subscriptions(conn)
    totals: dict[tuple, list[float]] = {}
    known: dict[tuple, bool] = {}
    read_runs = missing = 0
    finder = Finder(conn, transcripts.directory(_store_path(conn)))
    for target in finder.targets(set()):
        run = runs.get((target.session, target.agent))
        if run is None:
            continue
        bins = reader.bins(target)
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
