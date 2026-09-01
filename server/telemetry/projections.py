"""What one attempt cost, assembled from whatever actually observed it.

Mode A of the telemetry layer: the sources are already on this machine. The
agent clients write journals, Valkama's own hooks write session events, and both
are read here into one normalized projection. Nothing external is installed,
nothing is exported, and no collector is involved — which is also why the
projection is honest about how much it does not know.

Two sources, two different kinds of evidence, and they are deliberately not
merged into one number:

* Tokens, cost and model come from the client's own journal, through the
  adapter registered for that client. A journal format is client-specific, so
  the adapter is chosen by the session's client and never defaulted — reading a
  Codex rollout as a Claude transcript produces numbers, and they are wrong.
* Tool calls come from `session_events`, which Valkama wrote itself when the
  hooks reported them. That is the only tool evidence a local setup has, and it
  counts calls and outcomes rather than tokens: a hook says a tool ran, not what
  it cost, and attributing tokens to a tool span from this source would be an
  invention.

The scope is the attempt, not the session. An attempt may carry more than one
session — a resume continues inside the first — so the projection sums what its
own sessions answered and says how many of them did.
"""

from __future__ import annotations

import datetime as dt
import sqlite3

from .. import sessions
from ..platform import providers as platform_providers
from . import contracts

#: The one capability this reads. Named once so the adapter lookup and the
#: unavailable reason cannot describe different things.
CAPABILITY = "telemetry.query"


def execution_usage(
    conn: sqlite3.Connection,
    execution_id: str,
    *,
    catalog: platform_providers.ProviderCatalog | None = None,
) -> dict:
    """The normalized projection for one attempt, or a stated absence.

    Request-local by construction: the journal adapter keeps its own bounded
    cache keyed by the file's identity, so a second read of the same attempt in
    the same request costs a dictionary lookup. TEL-002 asks whether a
    persistent cache is needed; on these sources the answer is no, and this is
    where that would change.
    """

    row = conn.execute(
        "SELECT e.*, p.key || '-' || w.number AS reference FROM executions e"
        " JOIN work_items w ON w.work_item_id = e.work_item_id"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE e.execution_id = ?",
        (execution_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"no execution {execution_id!r}")

    sessions = conn.execute(
        "SELECT l.session_id, s.client, s.cwd FROM execution_sessions l"
        " LEFT JOIN sessions s ON s.id = l.session_id"
        " WHERE l.execution_id = ? ORDER BY l.linked_at, l.rowid",
        (execution_id,),
    ).fetchall()

    registry = catalog or platform_providers.ProviderCatalog()
    observations = [_observe(registry, entry) for entry in sessions]
    answered = [item for item in observations if item["observed"]]

    return {
        "scope": {
            "project_id": str(row["project_id"] or ""),
            "work_item": str(row["reference"]),
            "work_item_id": str(row["work_item_id"]),
            "execution_id": execution_id,
        },
        "window": {"started_at": str(row["started_at"]), "ended_at": row["ended_at"]},
        "duration": _duration(row),
        "tokens": _tokens(answered),
        "cost": _cost(answered),
        "models": _models(answered),
        "tools": _tools(conn, execution_id),
        "sessions": [
            {
                "session_id": item["session_id"],
                "client": item["client"],
                "observed": item["observed"],
                "reason": item["reason"],
            }
            for item in observations
        ],
        "provenance": _provenance(observations, str(row["started_at"])),
        "coverage": {
            "time": "confirmed" if row["ended_at"] else "partial",
            "tokens": contracts.coverage_of(len(answered), len(observations)),
            # No local source reports cost for every client, so a cost total is
            # `partial` the moment one session answered without one.
            "cost": contracts.coverage_of(
                len([item for item in answered if item["usage"].get("cost") is not None]),
                len(observations),
            ),
            "tools": "confirmed" if sessions else "unknown",
        },
    }


def _observe(registry: platform_providers.ProviderCatalog, entry: sqlite3.Row) -> dict:
    """Ask the adapter registered for this session's client, or say why not.

    The adapter is chosen by the client the session reported, never defaulted.
    A session whose client is unknown is left unobserved: reading one journal
    format as another yields numbers rather than an error, which is the worst
    possible failure for a value a person will act on.
    """

    session_id = str(entry["session_id"])
    client = sessions.client_family(entry["client"] or "")
    blank = {
        "session_id": session_id,
        "client": client,
        "observed": False,
        "usage": {},
        "adapter_id": "",
        "connection_id": "",
    }
    provider = _provider_for(registry, client)
    if provider is None:
        return {**blank, "reason": f"no telemetry adapter is registered for {client!r}"}
    try:
        answer = provider.dispatch(CAPABILITY, {"session_id": session_id})
    except platform_providers.ProviderError as error:
        return {**blank, "reason": str(error)}
    usage = dict(answer.get("observation") or {})
    return {
        "session_id": session_id,
        "client": client,
        "observed": bool(usage.get("observed")),
        "usage": usage,
        "adapter_id": str(answer.get("provider") or ""),
        "connection_id": str((answer.get("connection_ref") or {}).get("connection_id") or ""),
        "reason": "" if usage.get("observed") else str(usage.get("reason") or "not observed"),
    }


def _provider_for(registry: platform_providers.ProviderCatalog, client: str):
    for provider in registry.all():
        if (
            isinstance(provider, platform_providers.BuiltinCapabilityProvider)
            and CAPABILITY in provider.capabilities
            and provider.client == client
        ):
            return provider
    return None


def _duration(row: sqlite3.Row) -> dict:
    """Wall time from the attempt's own window; active time from nobody.

    A local journal records what a client said, not how long it was busy, and
    there is no honest way to derive one from the other — a session idle for an
    hour and a session working for an hour look identical in a transcript.
    """

    started, ended = str(row["started_at"]), row["ended_at"]
    return {
        "wall_ms": contracts.quantity(_span_ms(started, ended), "observed"),
        "active_ms": contracts.quantity(None, "unsupported"),
    }


def _span_ms(started: str, ended: object) -> int | None:
    if not ended:
        return None
    try:
        start = dt.datetime.fromisoformat(started.replace("Z", "+00:00"))
        finish = dt.datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, int((finish - start).total_seconds() * 1000))


#: Which of a source's field names feed each neutral one. A journal names its
#: own columns and the two clients do not agree, so this is the whole of the
#: translation — and each neutral name takes fields that mean the same thing.
#:
#: `cached_read` and `cache_write` are separate for that reason: Codex's
#: `cached_input_tokens` is a read, Claude reports a read and a write under two
#: names, and adding a recurring count to a one-off one gives a number that
#: measures nothing.
_TOKEN_SOURCES = {
    "input": ("input_tokens",),
    "cached_read": ("cached_input_tokens", "cache_read_input_tokens"),
    "cache_write": ("cache_creation_input_tokens",),
    "output": ("output_tokens",),
    "reasoning": ("reasoning_output_tokens",),
    "total": ("total_tokens",),
}


def _tokens(answered: list[dict]) -> dict:
    """Summed across the sessions that answered, one neutral field at a time.

    A field no source reported stays `unknown` rather than becoming zero: Claude
    reports no total, and a zero there would read as "this attempt used nothing"
    rather than "this journal does not say".

    `total` in particular is never derived. Adding the parts looks obvious and
    is not: whether a cache read is already inside the input count, and whether
    reasoning is already inside the output count, differ by client and by
    version. A total that is sometimes double-counted is worse than one that is
    honestly absent.
    """

    totals: dict[str, int] = {}
    for item in answered:
        counts = item["usage"].get("tokens") or {}
        for name, sources in _TOKEN_SOURCES.items():
            for source_name in sources:
                value = counts.get(source_name)
                if isinstance(value, int):
                    totals[name] = totals.get(name, 0) + value
    return {
        name: contracts.quantity(totals.get(name), "observed" if name in totals else "unknown")
        for name in contracts.TOKEN_FIELDS
    }


def _cost(answered: list[dict]) -> dict:
    reported = [item["usage"]["cost"] for item in answered if item["usage"].get("cost") is not None]
    numbers = [value for value in reported if isinstance(value, int | float)]
    return {
        "amount": contracts.quantity(sum(numbers) if numbers else None, "observed"),
        # The journals that report a cost report it in the account's currency
        # and never name it, so Valkama does not either.
        "currency": None,
    }


def _models(answered: list[dict]) -> list[dict]:
    """Which models were seen, and in how many of this attempt's sessions.

    Not calls-per-model: a journal names the model a session ran on, not one per
    request, so a request count here would be a number nobody measured.
    """

    seen: dict[str, int] = {}
    for item in answered:
        name = str(item["usage"].get("model") or "").strip()
        if name:
            seen[name] = seen.get(name, 0) + 1
    return [
        {"id": name, "sessions": count, "quality": "observed"}
        for name, count in sorted(seen.items())
    ]


def _tools(conn: sqlite3.Connection, execution_id: str) -> list[dict]:
    """Tool calls this attempt's sessions reported, counted by outcome.

    No token attribution, on purpose: a hook says a tool ran and how it ended.
    Splitting an attempt's tokens across its tool calls would be arithmetic
    presented as observation.
    """

    rows = conn.execute(
        "SELECT e.tool, e.server, e.status FROM session_events e"
        " JOIN execution_sessions l ON l.session_id = e.session_id"
        " WHERE l.execution_id = ? AND e.kind = 'tool_end'",
        (execution_id,),
    ).fetchall()
    counted: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (str(row["server"] or ""), str(row["tool"] or "unknown"))
        entry = counted.setdefault(
            key,
            {"name": key[1], "server": key[0], "calls": 0, "errors": 0, "unknown": 0},
        )
        entry["calls"] += 1
        outcome = contracts.tool_outcome(row["status"])
        if outcome == "error":
            entry["errors"] += 1
        elif outcome == "unknown":
            entry["unknown"] += 1
    return [
        {**entry, "quality": "observed"}
        for _, entry in sorted(counted.items(), key=lambda pair: pair[0])
    ]


def _provenance(observations: list[dict], observed_at: str) -> dict:
    """Who answered. One adapter when they agree, `mixed` when they do not."""

    adapters = sorted({item["adapter_id"] for item in observations if item["adapter_id"]})
    connections = sorted({item["connection_id"] for item in observations if item["connection_id"]})
    answered = [item for item in observations if item["observed"]]
    if not adapters:
        return contracts.provenance("", "", observed_at, "unknown")
    return contracts.provenance(
        adapters[0] if len(adapters) == 1 else "mixed",
        connections[0] if len(connections) == 1 else "mixed",
        observed_at,
        "confirmed" if answered and len(answered) == len(observations) else "partial",
    )


__all__ = ["CAPABILITY", "execution_usage"]
