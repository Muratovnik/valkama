"""Which work items and which session rows one scope admits.

Two predicates, applied once. Everything downstream describes the sets they
return, which is what keeps the KPIs, the charts, the facets and the token
totals talking about the same work: the Board era filtered again inside each
aggregate, and two of those copies disagreed about what a client filter meant.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import NamedTuple

from .reading import SpaceReading
from .scope import Scope
from .timeline import parse_time, reconstruct_status_history


class EvidenceRow(NamedTuple):
    """One analytics session event: the row, where it sits, and what ran it."""

    row: dict
    #: ``linked``, ``other_space`` or ``unlinked`` — how this row relates to the
    #: selected cards, which is the only thing an unlinked row may contribute.
    bucket: str
    context: dict


@dataclass(frozen=True)
class Selection:
    """The cards and the session rows one scope admits, established once."""

    work_items: list[dict]
    session_ids: set[str]
    evidence: list[EvidenceRow]


def _has_tool(reading: SpaceReading, scope: Scope, sessions: set[str]) -> bool:
    """Whether one card's sessions called the named tool inside the window."""

    return any(
        str(event.get("kind") or "") == "tool_end"
        and str(event.get("tool") or "") == scope.tool
        and scope.admits(parse_time(event.get("created_at")))
        for session_id in sessions
        for event in reading.events.by_session.get(session_id, [])
    )


def _work_items(reading: SpaceReading, scope: Scope) -> list[dict]:
    """The cards the scope admits, each with its reconstructed status history."""

    admitted = []
    for card in reading.items:
        parent = reading.references.get(str(card["parent_id"] or ""))
        if scope.epic is not None and parent != scope.epic:
            continue
        history = reconstruct_status_history(
            reading.events_by_item.get(str(card["work_item_id"]), []),
            reading.vocabulary.states,
            as_of=scope.as_of,
        )
        current = history["current_status"]
        if scope.status and current != scope.status:
            continue
        card_sessions = reading.links.by_item.get(str(card["work_item_id"]), set())
        context_agents = {
            reading.events.contexts.get(session_id, {}).get("agent")
            for session_id in card_sessions
            if reading.events.contexts.get(session_id, {}).get("agent")
        }
        context_environments = {
            reading.events.contexts.get(session_id, {}).get("environment")
            for session_id in card_sessions
            if reading.events.contexts.get(session_id, {}).get("environment")
        }
        authors = {
            str(event.get("author") or "")
            for event in reading.events_by_item.get(str(card["work_item_id"]), [])
        }
        if (
            scope.agent
            and card["claim_ref"] != scope.agent
            and scope.agent not in authors
            and scope.agent not in context_agents
        ):
            continue
        if scope.client and not any(
            scope.client in reading.links.clients.get(value, set()) for value in card_sessions
        ):
            continue
        if scope.environment and scope.environment not in context_environments:
            continue
        if scope.tool and not _has_tool(reading, scope, card_sessions):
            continue
        if not scope.overlaps(history):
            continue
        admitted.append(
            {
                "id": reading.references[str(card["work_item_id"])],
                "title": card["title"],
                # ``column`` is historical state, not the live one. The stored
                # state remains available only as an explicit diagnostic field.
                "column": current,
                "live_column": card["state_key"],
                "parent_id": reading.references.get(str(card["parent_id"] or "")),
                "claim_ref": card["claim_ref"],
                "priority": card["priority"],
                "status_history": history,
                "sessions": sorted(card_sessions),
            }
        )
    return admitted


def _session_ids(reading: SpaceReading, work_items: list[dict]) -> set[str]:
    """The sessions attached to the admitted cards, keyed back to the store."""

    selected_references = {str(item["id"]) for item in work_items}
    selected_item_ids = {
        item_id
        for item_id, reference in reading.references.items()
        if reference in selected_references
    }
    return {
        session_id
        for item_id in selected_item_ids
        for session_id in reading.links.by_item.get(item_id, set())
    }


def _evidence(reading: SpaceReading, scope: Scope, session_ids: set[str]) -> list[EvidenceRow]:
    """The one scoped session evidence selection.

    Date/as_of predicates are applied before any aggregate is updated, so
    future rows cannot leak through a filtered card projection.
    """

    admitted: list[EvidenceRow] = []
    for row in reading.events.rows:
        if row.get("klass") != "analytics":
            continue
        stamp = parse_time(row.get("created_at"))
        if not scope.admits(stamp):
            continue
        session_id = str(row.get("session_id") or "")
        if session_id in session_ids:
            bucket = "linked"
        elif session_id in reading.links.linked_anywhere:
            bucket = "other_space"
        else:
            bucket = "unlinked"
        context = reading.events.contexts.get(
            session_id,
            {
                "environment": None,
                "agent": None,
                "quality": "unknown",
            },
        )
        row_client = str(
            row.get("client") or next(iter(reading.links.clients.get(session_id, set())), "")
        )
        if scope.tool and str(row.get("tool") or "") != scope.tool:
            continue
        if scope.client and row_client != scope.client:
            continue
        if scope.agent and context.get("agent") != scope.agent:
            continue
        if scope.environment and context.get("environment") != scope.environment:
            continue
        if scope.narrows_dimensions and bucket != "linked":
            continue
        admitted.append(EvidenceRow(row, bucket, context))
    return admitted


def select(reading: SpaceReading, scope: Scope) -> Selection:
    """Establish the card and session selection this projection describes."""

    work_items = _work_items(reading, scope)
    session_ids = _session_ids(reading, work_items)
    return Selection(
        work_items=work_items,
        session_ids=session_ids,
        evidence=_evidence(reading, scope, session_ids),
    )
