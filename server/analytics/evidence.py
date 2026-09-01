"""What the selected session rows add up to: coverage, tools, runtime, facets.

An event that is not linked to a selected card counts in the coverage bucket
that says so, and nowhere else. Its tool, client and runtime values would
otherwise be attributed to a space that never ran it, which is the one way a
dashboard can be wrong without looking wrong.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field

from ..telemetry import contracts as telemetry
from .reading import SessionLinks
from .scope import Scope
from .selection import EvidenceRow
from .timeline import coverage_rollup, iso_time


@dataclass(frozen=True)
class SessionMetrics:
    """The counters one selection of analytics rows fills.

    ``coverage`` counts every selected row, because saying how much evidence
    belongs elsewhere is the point of it. Every other counter admits linked
    rows only.
    """

    events: int
    coverage: Counter[str] = field(default_factory=Counter)
    clients: Counter[str] = field(default_factory=Counter)
    servers: Counter[str] = field(default_factory=Counter)
    tools: Counter[str] = field(default_factory=Counter)
    statuses: Counter[str] = field(default_factory=Counter)
    agents: Counter[str] = field(default_factory=Counter)
    runtime_sessions: dict[str, set[str]] = field(default_factory=dict)
    runtime_coverage: dict[str, set[str]] = field(default_factory=dict)


def metrics(evidence: list[EvidenceRow], links: SessionLinks) -> SessionMetrics:
    """Count the selected rows along every dimension the dashboard shows."""

    answer = SessionMetrics(events=len(evidence))
    for row, bucket, context in evidence:
        answer.coverage[bucket] += 1
        if bucket != "linked":
            continue
        row_client = str(
            row.get("client")
            or next(iter(links.clients.get(str(row.get("session_id")), set())), "unknown")
        )
        answer.clients[row_client or "unknown"] += 1
        answer.servers[str(row.get("server") or "unknown")] += 1
        answer.tools[str(row.get("tool") or row.get("kind") or "unknown")] += 1
        answer.statuses[str(row.get("status") or "unknown")] += 1
        answer.agents[str(context.get("agent") or "unknown")] += 1
        runtime_name = str(context.get("environment") or "unknown")
        answer.runtime_sessions.setdefault(runtime_name, set()).add(
            str(row.get("session_id") or "")
        )
        answer.runtime_coverage.setdefault(runtime_name, set()).add(
            "inferred" if context.get("environment") else "unknown"
        )
    return answer


def tool_usage_rows(evidence: list[EvidenceRow]) -> list[dict]:
    """One row per server/tool pair a linked session actually finished a call on."""

    usage: dict[tuple[str, str], dict] = {}
    for row, bucket, _context in evidence:
        if bucket != "linked" or row.get("kind") != "tool_end":
            continue
        key = (str(row.get("server") or "unknown"), str(row.get("tool") or "unknown"))
        entry = usage.setdefault(
            key,
            {
                "server": key[0],
                "tool": key[1],
                "calls": 0,
                "ok": 0,
                "error": 0,
                "unknown": 0,
                "sessions": set(),
                "quality": "durable/session_events",
            },
        )
        entry["calls"] += 1
        # The telemetry layer owns this vocabulary now: one list decides what a
        # reported status means, for the space leaderboard here and for one
        # attempt's own tool calls.
        outcome = telemetry.tool_outcome(row.get("status"))
        entry["ok" if outcome == "ok" else outcome] += 1
        entry["sessions"].add(str(row.get("session_id") or ""))
    rows = []
    for entry in sorted(usage.values(), key=lambda value: (value["server"], value["tool"])):
        rows.append(
            {
                "name": f"{entry['server']}·{entry['tool']}",
                "calls": entry["calls"],
                "success": entry["ok"],
                "error": entry["error"],
                "coverage": "confirmed" if entry["calls"] > 0 else "unknown",
                **{key: value for key, value in entry.items() if key != "sessions"},
                "unique_sessions": len(entry["sessions"]),
                "observed": entry["calls"] > 0,
                "observation": "observed" if entry["calls"] > 0 else "unknown",
            }
        )
    return rows


def runtime_rows(evidence: list[EvidenceRow], session_metrics: SessionMetrics) -> list[dict]:
    """One row per runtime the linked sessions ran in, with its own coverage.

    A runtime is never read off a card claim, so an unknown one is reported as
    unknown rather than folded into the environment its neighbours used.
    """

    return [
        {
            "name": name,
            "sessions": len(session_metrics.runtime_sessions[name]) or None,
            "coverage": coverage_rollup(session_metrics.runtime_coverage.get(name, {"unknown"})),
            "events": sum(
                1
                for _row_value, bucket, context in evidence
                if bucket == "linked" and str(context.get("environment") or "unknown") == name
            ),
        }
        for name in sorted(session_metrics.runtime_sessions)
    ]


def coverage(evidence: list[EvidenceRow], session_metrics: SessionMetrics, scope: Scope) -> dict:
    """How much of the selected evidence belongs to the space being projected."""

    states = {
        bucket: int(session_metrics.coverage.get(bucket, 0))
        for bucket in ("linked", "other_space", "unlinked")
    }
    if not evidence:
        overall = "unknown"
    elif states.get("other_space", 0) or states.get("unlinked", 0):
        overall = "partial"
    else:
        overall = "confirmed"
    return {
        "overall": overall,
        "states": states,
        "events": len(evidence),
        "as_of": iso_time(scope.as_of),
    }


def facet_entries(values: Iterable[object]) -> list[dict]:
    """One dimension's values, counted and ordered by name."""

    counts = Counter(str(value) for value in values if str(value or "").strip())
    return [{"value": name, "count": count} for name, count in sorted(counts.items())]


def facets(
    evidence: list[EvidenceRow],
    *,
    card_agents: Counter[str],
    session_ids: set[str],
    links: SessionLinks,
    contexts: dict[str, dict],
) -> dict:
    """What the selection touched on each dimension a reader can filter by.

    Card events and session evidence both contribute, because a filter offered
    for one of them has to be offered for the other: a person who acted only on
    cards is still someone the dashboard can be narrowed to.
    """

    linked_rows = [(row, context) for row, bucket, context in evidence if bucket == "linked"]
    card_agent_values = [name for name, count in card_agents.items() for _ in range(count)]
    selected_client_values = [
        client_name
        for session_id in session_ids
        for client_name in links.clients.get(session_id, set())
    ]
    selected_environment_values = [
        contexts.get(session_id, {}).get("environment") or "unknown" for session_id in session_ids
    ]
    return {
        "agents": facet_entries(
            [context.get("agent") or "unknown" for _row_value, context in linked_rows]
            + card_agent_values
        ),
        "clients": facet_entries(
            [row.get("client") or "unknown" for row, _context in linked_rows]
            + selected_client_values
        ),
        "environments": facet_entries(
            [context.get("environment") or "unknown" for _row_value, context in linked_rows]
            + selected_environment_values
        ),
        "tools": facet_entries(
            [
                row.get("tool") or "unknown"
                for row, _context in linked_rows
                if row.get("kind") == "tool_end"
            ]
        ),
    }


def session_analytics(
    evidence: list[EvidenceRow], session_metrics: SessionMetrics, evidence_coverage: dict
) -> dict:
    """The evidence block of the dashboard payload."""

    return {
        "events": session_metrics.events,
        "evidence_coverage": evidence_coverage,
        "clients": [
            {"name": name, "events": count} for name, count in session_metrics.clients.most_common()
        ],
        "servers": [
            {"name": name, "events": count} for name, count in session_metrics.servers.most_common()
        ],
        "tools": [
            {"name": name, "events": count} for name, count in session_metrics.tools.most_common()
        ],
        "statuses": [
            {"name": name, "events": count}
            for name, count in session_metrics.statuses.most_common()
        ],
        "runtime": runtime_rows(evidence, session_metrics),
        "agents": [
            {"name": name, "events": count} for name, count in session_metrics.agents.most_common()
        ],
        "tool_usage": tool_usage_rows(evidence),
    }
