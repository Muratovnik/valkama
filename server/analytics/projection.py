"""The dashboard projection itself: one planning space, read as a whole.

Status visits, flow, throughput, the KPIs and their coverage are assembled
here from the timeline, the journals, and the cache. This module owns the
shape a client receives; everything it needs to compute one lives beside it —
`scope` resolves the request, `reading` reads the store once, `selection`
decides what is in scope, and `flow` and `evidence` say what that adds up to.
"""

from __future__ import annotations

import copy
import datetime as _dt
import sqlite3

from . import evidence as evidence_analytics
from . import executions as execution_analytics
from . import flow as flow_analytics
from . import reading as space_reading
from . import selection as selection_analytics
from .cache import _CACHE, _projection_key
from .journal import LocalJournalUsageProvider
from .scope import Scope
from .timeline import iso_time


def _project_space_uncached(
    conn: sqlite3.Connection,
    space: str | None = None,
    *,
    as_of: object = None,
    date_from: object = None,
    date_to: object = None,
    epic: int | str | None = None,
    client: str | None = None,
    agent: str | None = None,
    environment: str | None = None,
    tool: str | None = None,
    status: str | None = None,
    usage_provider: LocalJournalUsageProvider | None = None,
) -> dict:
    """Build one scoped, read-only dashboard evidence projection.

    The selected card/session set is established once and reused for status,
    session-event, usage, facet, and daily-token aggregates.  Events without
    an exact item/session reference remain visible only in the unlinked
    coverage bucket; their tool/client values are never attributed to a space.
    """

    space_row = space_reading.space(conn, space)
    # The vocabulary is read first because a status filter is only honoured when
    # the space declares that state; the rest of the reading follows the scope
    # because every session context is derived as of the instant it settled on.
    vocabulary = space_reading.vocabulary(conn, space_row)
    scope = Scope.resolve(
        as_of=as_of,
        date_from=date_from,
        date_to=date_to,
        epic=epic,
        client=client,
        agent=agent,
        environment=environment,
        tool=tool,
        status=status,
        declared_states=vocabulary.declared,
    )
    observed = space_reading.read_space(conn, space_row, vocabulary, as_of=scope.as_of)
    selected = selection_analytics.select(observed, scope)

    history = flow_analytics.totals(selected, observed, scope)
    work = flow_analytics.non_containers(selected.work_items)
    metrics = evidence_analytics.metrics(selected.evidence, observed.links)
    evidence_coverage = evidence_analytics.coverage(selected.evidence, metrics, scope)

    provider = usage_provider or LocalJournalUsageProvider()
    usage = provider.space_usage(
        conn,
        observed.space_id,
        session_ids=selected.session_ids,
        as_of=scope.as_of,
        date_from=scope.start,
        date_to=scope.finish,
    )
    # Only a known reconstructed state may contribute to flow/KPI status
    # counts.  Unknown items stay in inventory and history coverage, never
    # backlog.  Evidence coverage is kept separate because an unlinked event
    # says nothing about the selected space's lifecycle history.
    return {
        "interface_version": "dashboard",
        "planning_space": space_row["key"],
        "as_of": iso_time(scope.as_of),
        "filters": scope.filters(),
        "history_coverage": flow_analytics.history_coverage(selected.work_items, scope),
        "evidence_coverage": {
            **evidence_coverage,
        },
        "kpis": flow_analytics.kpis(work, vocabulary, history),
        # The space's own states, in workflow order, each with its category. A
        # reader of this payload cannot otherwise know what the keys under
        # "flow" are called or how to colour them: the Board era answered both
        # from a hard-coded list of six lane names, so a renamed state lost its
        # label and its tone at once.
        "states": [{"key": name, "category": category} for name, category in vocabulary.states],
        "flow": flow_analytics.flow_counts(work, vocabulary),
        "status_time": flow_analytics.status_time(vocabulary, history),
        "throughput": [
            {"date": day, "count": count} for day, count in sorted(history.throughput.items())
        ],
        "agents": [
            {"agent": name, "events": count} for name, count in history.agents.most_common()
        ],
        "facets": evidence_analytics.facets(
            selected.evidence,
            card_agents=history.agents,
            session_ids=selected.session_ids,
            links=observed.links,
            contexts=observed.events.contexts,
        ),
        "session_analytics": evidence_analytics.session_analytics(
            selected.evidence, metrics, evidence_coverage
        ),
        "longest_open": flow_analytics.longest_open_rows(work, vocabulary),
        "work_items": selected.work_items,
        "usage": usage,
        # What was attempted at this work, which the dashboard could not say at
        # all before executions were a record. Its own block rather than a
        # column on the KPIs, because its coverage is its own: an attempt whose
        # journal was never configured lowers the confidence of a token total
        # without lowering the count of attempts.
        "executions": execution_analytics.space_executions(
            conn,
            observed.space_id,
            start=iso_time(scope.start),
            finish=iso_time(scope.finish),
        ),
    }


def project_space(
    conn: sqlite3.Connection,
    space: str | None = None,
    *,
    as_of: object = None,
    date_from: object = None,
    date_to: object = None,
    epic: int | str | None = None,
    client: str | None = None,
    agent: str | None = None,
    environment: str | None = None,
    tool: str | None = None,
    status: str | None = None,
    usage_provider: LocalJournalUsageProvider | None = None,
) -> dict:
    """Return the canonical dashboard projection for GET and dashboard SSE.

    Both transports call this function, so the cache stores one read model per
    database snapshot, journal root/stat identity, and complete query scope.
    Results are copied on the way in and out to keep callers from mutating the
    process-owned value.
    """

    provider = usage_provider or LocalJournalUsageProvider()
    effective_as_of = as_of
    if effective_as_of is None:
        # Canonicalize implicit "now" to the same second used on the wire;
        # this lets GET and SSE share one read model for an equal scope.
        effective_as_of = iso_time(_dt.datetime.now(_dt.UTC))
    key = _projection_key(
        conn,
        space,
        as_of=effective_as_of,
        date_from=date_from,
        date_to=date_to,
        epic=epic,
        client=client,
        agent=agent,
        environment=environment,
        tool=tool,
        status=status,
        provider=provider,
    )
    cacheable = True
    if cacheable:
        with _CACHE.lock:
            cached = _CACHE.projections.get(key)
            if cached is not None:
                return copy.deepcopy(cached)
            # Keep the lock through a miss so concurrent GET/SSE requests do
            # not parse the same journal set twice.  The RLock permits the
            # provider's identity/journal cache lookups below.
            result = _project_space_uncached(
                conn,
                space,
                as_of=effective_as_of,
                date_from=date_from,
                date_to=date_to,
                epic=epic,
                client=client,
                agent=agent,
                environment=environment,
                tool=tool,
                status=status,
                usage_provider=provider,
            )
            _CACHE.put_projection(key, copy.deepcopy(result))
            return copy.deepcopy(result)
    result = _project_space_uncached(
        conn,
        space,
        as_of=effective_as_of,
        date_from=date_from,
        date_to=date_to,
        epic=epic,
        client=client,
        agent=agent,
        environment=environment,
        tool=tool,
        status=status,
        usage_provider=provider,
    )
    return copy.deepcopy(result)
