"""What the attempts in one space add up to, and how much of it was observed.

The dashboard predates the execution store entirely: it counts work items, their
state intervals and the tool events sessions reported, and it has never been able
to say how many attempts were made at any of it, how they ended, or what they
cost. That is the whole of what this adds.

Two rules shape every number here, and both come from §14.4 of the plan.

Unknown never becomes zero. An attempt whose journal was never configured
contributes nothing to a token total *and* lowers the coverage of that total, so
a small number and a badly-observed one cannot be confused. The alternative —
summing what answered and presenting it as the figure — is the failure that
makes a telemetry dashboard worse than no dashboard.

Time is several ideas and they are not added. `execution_wall_time` is how long
a process existed; `planning_cycle_time` is how long the work took; a session
idle for an hour and a session working for an hour are indistinguishable in a
journal, so `execution_active_time` is not derived from either. Each keeps its
own name and its own coverage.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3

from ..executions import store as execution_store
from ..telemetry import contracts
from ..telemetry import projections as telemetry

#: How many attempts one aggregation will read in full. A space with more is
#: summarised from the rows and says so through `truncated`, rather than
#: silently reporting the newest few as the whole.
MAX_EXECUTIONS = 500

#: How many of those attempts the drill-down lists one by one. Lower than the
#: aggregation on purpose: the totals have to describe the whole space, and the
#: list is read rather than exported — the CSV is where a whole space goes.
MAX_ATTEMPT_DETAIL = 100


def space_executions(
    conn: sqlite3.Connection,
    planning_space_id: str,
    *,
    start: str | None = None,
    finish: str | None = None,
    limit: int = MAX_EXECUTIONS,
) -> dict:
    """Every attempt at this space's work, counted and costed.

    The window filters on when an attempt *started*: an attempt is attributed to
    the period it was made in, not the one it happened to finish in, so moving
    the window never moves an attempt into two buckets or none.
    """

    bounded = max(1, min(int(limit), MAX_EXECUTIONS))
    # The window is expressed as two nullable parameters rather than as clauses
    # assembled by hand: the query then has one shape, and nothing about it is
    # built from a string at run time.
    rows = conn.execute(
        "SELECT e.execution_id, e.status, e.outcome, e.client_family, e.model, e.role,"
        " e.environment, e.started_at, e.ended_at, e.final_artifact_json,"
        " p.key || '-' || w.number AS reference"
        " FROM executions e"
        " JOIN work_items w ON w.work_item_id = e.work_item_id"
        " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
        " WHERE w.planning_space_id = :space"
        " AND (:start IS NULL OR e.started_at >= :start)"
        " AND (:finish IS NULL OR e.started_at < :finish)"
        " ORDER BY e.started_at DESC, e.rowid DESC LIMIT :limit",
        {
            "space": planning_space_id,
            "start": start or None,
            "finish": finish or None,
            "limit": bounded + 1,
        },
    ).fetchall()
    truncated = len(rows) > bounded
    rows = rows[:bounded]

    statuses = dict.fromkeys(execution_store.STATUSES, 0)
    clients: dict[str, int] = {}
    models: dict[str, int] = {}
    wall_values: list[int] = []
    delivered = 0
    for row in rows:
        statuses[str(row["status"])] = statuses.get(str(row["status"]), 0) + 1
        clients[str(row["client_family"] or "unknown")] = (
            clients.get(str(row["client_family"] or "unknown"), 0) + 1
        )
        name = str(row["model"] or "").strip()
        if name:
            models[name] = models.get(name, 0) + 1
        span = _span_seconds(str(row["started_at"]), row["ended_at"])
        if span is not None:
            wall_values.append(span)
        if str(row["status"]) == "complete":
            delivered += 1

    usage, attempts = _usage(conn, rows)
    return {
        "attempts": len(rows),
        "truncated": truncated,
        # The rows behind every figure above. An aggregate a reader cannot open
        # is one they can only trust, and the coverage line tells them how much
        # to distrust it rather than which attempt is missing.
        "attempt_rows": attempts,
        "attempt_rows_truncated": len(rows) > MAX_ATTEMPT_DETAIL,
        # A rate is only meaningful over attempts that ended; a running one has
        # not failed, and counting it as a non-delivery would move the number
        # every time somebody starts work.
        "delivered": delivered,
        "ended": sum(
            count for name, count in statuses.items() if name not in ("starting", "running")
        ),
        "statuses": [
            {"name": name, "attempts": count} for name, count in statuses.items() if count
        ],
        "clients": [
            {"name": name, "attempts": count}
            for name, count in sorted(clients.items(), key=lambda pair: (-pair[1], pair[0]))
        ],
        "models": [
            {"name": name, "attempts": count}
            for name, count in sorted(models.items(), key=lambda pair: (-pair[1], pair[0]))
        ],
        "execution_wall_time": {
            "seconds": sum(wall_values) if wall_values else None,
            "observed": len(wall_values),
            "coverage": contracts.coverage_of(len(wall_values), len(rows)),
        },
        # Named rather than merged into the wall time above: a journal cannot
        # tell an idle hour from a working one, so this stays unsupported until
        # a source that measures it is connected.
        "execution_active_time": {"seconds": None, "coverage": "unknown"},
        **usage,
    }


def _usage(conn: sqlite3.Connection, rows: list[sqlite3.Row]) -> tuple[dict, list[dict]]:
    """Token and tool totals across these attempts, and the rows behind them.

    Each attempt is projected individually rather than by one wide query,
    because the projection is what knows which adapter to ask for which client
    and how to normalise its field names. The adapters cache by file identity,
    so a space whose attempts share a journal reads it once.

    The drill-down is built here rather than in a second pass for the same
    reason: the projection that supplies a total is the only thing that knows
    where that total came from, and asking twice would be two chances to
    disagree about one attempt.
    """

    totals: dict[str, int] = {}
    tools: dict[tuple[str, str], dict] = {}
    answered = 0
    attempts: list[dict] = []
    for index, row in enumerate(rows):
        execution_id = str(row["execution_id"])
        projection = telemetry.execution_usage(conn, execution_id)
        if projection["coverage"]["tokens"] != "unknown":
            answered += 1
        for name, field in projection["tokens"].items():
            if isinstance(field["value"], int):
                totals[name] = totals.get(name, 0) + field["value"]
        for entry in projection["tools"]:
            key = (str(entry["server"]), str(entry["name"]))
            tool = tools.setdefault(
                key,
                {"name": entry["name"], "server": entry["server"], "calls": 0, "errors": 0},
            )
            tool["calls"] += int(entry["calls"])
            tool["errors"] += int(entry["errors"])
        if index < MAX_ATTEMPT_DETAIL:
            attempts.append(_attempt(row, projection))
    return (
        {
            "tokens": {
                name: contracts.quantity(
                    totals.get(name), "observed" if name in totals else "unknown"
                )
                for name in contracts.TOKEN_FIELDS
            },
            "tokens_coverage": contracts.coverage_of(answered, len(rows)),
            "tools": [
                entry
                for _, entry in sorted(tools.items(), key=lambda pair: (-pair[1]["calls"], pair[0]))
            ],
            "observed_attempts": answered,
        },
        attempts,
    )


def _attempt(row: sqlite3.Row, projection: dict) -> dict:
    """One attempt as the drill-down reads it: what, how it ended, and who said so.

    The token figure keeps its own quality rather than borrowing the block's
    coverage. A space where half the attempts were observed says `partial`
    once at the top; this row says whether *this* attempt is one of the halves,
    which is the question a reader opens the list to answer.

    Sessions are the trace refs the plan asks for. Nothing here resolves one —
    a session id is a pointer into the client's own journal — but naming it is
    what lets a reader go and look.
    """

    total = projection["tokens"]["total"]
    return {
        "execution_id": str(row["execution_id"]),
        "work_item": str(row["reference"]),
        "status": str(row["status"]),
        "outcome": str(row["outcome"] or ""),
        "client_family": str(row["client_family"] or ""),
        "model": str(row["model"] or ""),
        "role": str(row["role"] or ""),
        "environment": str(row["environment"] or ""),
        "started_at": str(row["started_at"]),
        "ended_at": str(row["ended_at"] or ""),
        "wall_seconds": _span_seconds(str(row["started_at"]), row["ended_at"]),
        "tokens": total["value"],
        "tokens_quality": total["quality"],
        # Who answered for this attempt, so a reader can tell an unobserved
        # attempt from a cheap one without leaving the row.
        "source": {
            "adapter_id": str(projection["provenance"]["adapter_id"] or ""),
            "quality": str(projection["provenance"]["source_quality"]),
        },
        "sessions": [str(item["session_id"]) for item in projection["sessions"]],
        "changed_files": _artifact_count(row["final_artifact_json"], "changed_files"),
    }


def _artifact_count(value: object, field: str) -> int | None:
    """One measured figure from the recorded Git outcome, or nothing.

    Absent and zero are different answers — an attempt that changed no files and
    one whose checkout was never read both have no diff to show — so an
    unreadable record is `None` rather than `0`.
    """

    try:
        record = json.loads(str(value or "") or "{}")
    except (TypeError, ValueError):
        return None
    if not isinstance(record, dict):
        return None
    count = record.get(field)
    return count if isinstance(count, int) else None


def _span_seconds(started: str, ended: object) -> int | None:
    if not ended:
        return None
    try:
        start = dt.datetime.fromisoformat(started.replace("Z", "+00:00"))
        finish = dt.datetime.fromisoformat(str(ended).replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, int((finish - start).total_seconds()))


__all__ = ["MAX_ATTEMPT_DETAIL", "MAX_EXECUTIONS", "space_executions"]
