"""Time, coverage, and the status history rebuilt from lane events.

The planning tables are the source of truth and this module adds nothing to them:
it reads events and answers how long a card stood where. Unknown history is
``None`` with a coverage state, never a fabricated zero, which is why a
contradictory move invalidates the segment before it instead of inventing a
duration across the gap.
"""

from __future__ import annotations

import datetime as _dt
import itertools
import json
from collections import Counter
from collections.abc import Iterable, Mapping

#: The states a workflow declares, in its own order, with the category each one
#: belongs to. The Board era hard-coded six lane names here, which is why a
#: renamed lane silently vanished from every chart: a status the projection did
#: not recognise was dropped rather than counted.
StateVocabulary = tuple[tuple[str, str], ...]

#: Categories work can be started from, and the one it is worked inside. Asked of
#: the category rather than of the name so a space that calls its states
#: something else still reconstructs.
_QUEUED_CATEGORIES = frozenset(("backlog", "queued"))
_ACTIVE_CATEGORY = "active"
#: Categories that mean the work is finished, however the state is named.
_CLOSING_CATEGORIES = frozenset(("completed", "cancelled"))
RUNTIME_ENVIRONMENTS = frozenset(("workdir", "worktree", "wsl"))


def _cache_time(value: object) -> str | None:
    parsed = parse_time(value)
    return iso_time(parsed) if parsed is not None else None


def parse_time(value: object, *, default: _dt.datetime | None = None) -> _dt.datetime | None:
    """Parse the timestamps emitted by SQLite and JSONL clients as UTC."""

    if isinstance(value, _dt.datetime):
        result = value
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            result = _dt.datetime.fromisoformat(text)
        except ValueError:
            return default
    else:
        return default
    if result.tzinfo is None:
        result = result.replace(tzinfo=_dt.UTC)
    return result.astimezone(_dt.UTC)


def iso_time(value: _dt.datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(_dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _as_seconds(start: _dt.datetime | None, end: _dt.datetime | None) -> int | None:
    if start is None or end is None:
        return None
    value = (end - start).total_seconds()
    if value < 0:
        return None
    return round(value)


def _row(row: object) -> dict:
    return dict(row)  # type: ignore[arg-type]


def _detail_object(value: object) -> dict:
    """Decode a bounded session-event detail object without trusting input."""

    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _runtime_context(rows: Iterable[Mapping[str, object]], *, as_of: _dt.datetime) -> dict:
    """Derive the latest validated launch context from session_start details.

    Environment and role are intentionally sourced only from the server-owned
    launch detail.  Missing, malformed, or truncated details remain unknown;
    card claims/authors are not silently promoted to a session identity.
    """

    candidates: list[tuple[_dt.datetime, int, dict]] = []
    for raw in rows:
        row = _row(raw)
        if str(row.get("kind") or "") != "session_start":
            continue
        stamp = parse_time(row.get("created_at"))
        if stamp is None or stamp > as_of:
            continue
        detail = _detail_object(row.get("detail"))
        environment = detail.get("environment")
        environment = environment if environment in RUNTIME_ENVIRONMENTS else None
        role = detail.get("role")
        role = str(role).strip() if isinstance(role, str) and role.strip() else None
        candidates.append(
            (
                stamp,
                int(row.get("id") or 0),
                {
                    "environment": environment,
                    "agent": role,
                    "role": role,
                    "launch_id": detail.get("launch_id")
                    if isinstance(detail.get("launch_id"), str)
                    else None,
                    "source": "session_start.detail",
                    "quality": "derived/internal" if environment or role else "unknown",
                },
            )
        )
    if not candidates:
        return {
            "environment": None,
            "agent": None,
            "role": None,
            "launch_id": None,
            "source": "session_start.detail",
            "quality": "unknown",
        }
    candidates.sort(key=lambda item: (item[0], item[1]))
    context = candidates[-1][2]
    # A malformed context must not be represented as an observed empty value.
    if not context.get("environment") and not context.get("agent"):
        context["quality"] = "unknown"
    return context


def _in_time_window(
    stamp: _dt.datetime | None,
    *,
    as_of: _dt.datetime,
    date_from: _dt.datetime | None = None,
    date_to: _dt.datetime | None = None,
) -> bool:
    """Apply the dashboard's inclusive-as_of, half-open date window."""

    if stamp is None or stamp > as_of:
        return False
    if date_from is not None and stamp < date_from:
        return False
    return not (date_to is not None and stamp >= date_to)


def _journal_timestamp(
    row: Mapping[str, object], payload: Mapping[str, object] | None = None
) -> _dt.datetime | None:
    """Find a timestamp used by either local journal without guessing."""

    payload = payload or {}
    for source in (row, payload):
        for key in ("timestamp", "created_at", "createdAt", "time", "at", "ts"):
            value = source.get(key)
            parsed = parse_time(value)
            if parsed is not None:
                return parsed
    return None


def _merge_token_counts(target: Counter[str], values: Mapping[str, object]) -> None:
    for key, value in values.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            target[key] += value


def _token_delta(
    current: Mapping[str, object], previous: Mapping[str, object] | None
) -> tuple[dict | None, str | None]:
    """Return a positive cumulative delta, or an explicit reset/unknown."""

    numeric = {
        key: value
        for key, value in current.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0
    }
    if not numeric:
        return None, "no numeric totals"
    if previous is None:
        # A cumulative snapshot has no defensible day allocation without a
        # prior baseline.  Keep the day explicitly unknown instead of
        # presenting the whole cumulative total as consumption.
        return None, "no prior cumulative snapshot"
    shared = set(numeric) & {
        key
        for key, value in previous.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0
    }
    if any(numeric[key] < previous[key] for key in shared):
        return None, "cumulative reset"
    # Missing counters are not treated as zero.  Only dimensions observed in
    # both snapshots can safely be differenced.
    if not shared:
        return None, "counter dimensions changed"
    return {key: numeric[key] - previous[key] for key in shared}, None


def coverage_rollup(values: Iterable[str]) -> str:
    """Fold card/interval quality without treating unknown as confirmed.

    A space is confirmed only when every eligible history is confirmed.  An
    inferred-only set is inferred; any partial or mixed known/unknown set is
    partial, while a set with no known history is unknown.
    """
    states = [str(value) for value in values]
    if not states or all(value == "unknown" for value in states):
        return "unknown"
    if "partial" in states or "unknown" in states:
        return "partial"
    if "inferred" in states:
        return "inferred"
    return "confirmed"


def _event_target(event: Mapping[str, object], states: StateVocabulary) -> str | None:
    """The state this event moved the item into, or nothing.

    A `transitioned` event names its destination and not its source, which is
    what the Board era's `from -> to` detail tried to do and got wrong often
    enough to need three separate gap branches: the chain already knows where
    the item was, and a recorded source that disagreed was itself the defect.

    `overridden` is followed by the audited transition. Treating it as one would
    double-count a visit, so it is intentionally ignored.
    """

    action = str(event.get("action") or "")
    if action not in ("created", "transitioned"):
        return None
    # A transition detail is the state key, optionally followed by the reason
    # a guard was given.
    key = str(event.get("detail") or "").split(":", 1)[0].strip()
    return key if any(name == key for name, _ in states) else None


def reconstruct_status_history(
    events: Iterable[Mapping[str, object]],
    states: StateVocabulary,
    *,
    as_of: object = None,
) -> dict:
    """Reconstruct status segments with deterministic event-id tie breaking.

    An item whose first event is not ``created`` has an unknown initial
    segment. A ``claimed``/``checklist_claimed`` event can infer the first
    queued-to-active transition only when that preceding state is known. Such a
    segment is explicitly marked ``inferred``. The active segment ends at
    ``as_of``; no item ``updated_at`` is consulted.
    """

    categories = dict(states)
    # The state a claim implies. A workflow with no active state at all simply
    # gets no inference, which is honest: nothing in it says work is under way.
    active_state = next((name for name, kind in states if kind == _ACTIVE_CATEGORY), None)
    now = parse_time(as_of, default=_dt.datetime.now(_dt.UTC))
    # The non-None default makes this unreachable. It states the narrowing for a
    # type checker and is not a runtime check on any input.
    assert now is not None  # noqa: S101
    ordered: list[dict] = []
    invalid = False
    for value in events:
        item = _row(value)
        parsed = parse_time(item.get("created_at") or item.get("at"))
        if parsed is None:
            invalid = True
            continue
        item["_time"] = parsed
        item["_id"] = int(item.get("id") or 0)
        ordered.append(item)
    ordered = [item for item in ordered if item["_time"] <= now]
    ordered.sort(key=lambda item: (item["_time"], item["_id"]))
    segments: list[dict] = []
    state: str | None = None
    state_start: _dt.datetime | None = None
    state_quality = "confirmed"
    unknown_initial = False
    inferred_used = False
    gaps = invalid

    def close(end: _dt.datetime) -> None:
        nonlocal state, state_start, state_quality
        if state is None:
            return
        if state_start is not None and end < state_start:
            # Corrupt source ordering is a partial record, not negative time.
            return
        duration = _as_seconds(state_start, end)
        segments.append(
            {
                "status": state,
                "start": iso_time(state_start),
                "end": iso_time(end),
                "duration_seconds": duration,
                "quality": state_quality,
                "visit": sum(1 for item in segments if item["status"] == state) + 1,
            }
        )

    def invalidate_current() -> None:
        """Close a state at an unsafe boundary without inventing duration."""
        nonlocal state, state_start, state_quality
        if state is not None:
            segments.append(
                {
                    "status": state,
                    "start": iso_time(state_start),
                    "end": None,
                    "duration_seconds": None,
                    "quality": "unknown",
                    "visit": sum(1 for item in segments if item["status"] == state) + 1,
                }
            )
        state = None
        state_start = None
        state_quality = "confirmed"

    for event in ordered:
        timestamp = event["_time"]
        action = str(event.get("action") or "")
        target = _event_target(event, states)
        quality = "confirmed"
        if (
            target is None
            and active_state is not None
            and action
            in (
                "claimed",
                "checklist_claimed",
            )
        ):
            # Inference is only valid when the chain already established that
            # this card was queued.  A claim on review/dev is not a move.
            if state is not None and categories.get(state) in _QUEUED_CATEGORIES:
                target = active_state
                quality = "inferred"
                inferred_used = True
        if target is None:
            # A lifecycle action that cannot name a valid destination is a
            # gap. Non-lifecycle card events (claims outside the queue, notes,
            # etc.) are evidence but do not alter the state chain.
            if action in ("created", "transitioned") or (
                action in ("claimed", "checklist_claimed") and state is None
            ):
                gaps = True
            continue
        if state is None:
            if action != "created":
                unknown_initial = True
                gaps = True
                segments.append(
                    {
                        "status": None,
                        "start": None,
                        "end": iso_time(timestamp),
                        "duration_seconds": None,
                        "quality": "unknown",
                        "visit": 0,
                    }
                )
            state = target
            state_start = timestamp
            state_quality = quality
            continue
        if action == "created":
            # A second creation record is not a valid transition. Preserve
            # the observed destination as a new boundary, but invalidate the
            # interval preceding the contradictory event.
            gaps = True
            invalidate_current()
            state = target
            state_start = timestamp
            state_quality = quality
            continue
        if target == state:
            # Duplicate/repeated moves are source evidence but do not create a
            # zero-length visit.  Event ids still determine their order.
            continue
        close(timestamp)
        state = target
        state_start = timestamp
        state_quality = quality

    if state is not None:
        close(now)
    elif not segments:
        segments.append(
            {
                "status": None,
                "start": None,
                "end": iso_time(now),
                "duration_seconds": None,
                "quality": "unknown",
                "visit": 0,
            }
        )
    if not ordered:
        coverage = "unknown"
    elif gaps or unknown_initial:
        coverage = "partial"
    elif inferred_used:
        coverage = "inferred"
    else:
        coverage = "confirmed"
    declared = [name for name, _ in states]
    visits = Counter(item["status"] for item in segments if item["status"] in declared)
    status_time: dict[str, int | None] = {}
    for name in declared:
        values = [item["duration_seconds"] for item in segments if item["status"] == name]
        known = [value for value in values if value is not None]
        status_time[name] = sum(known) if known else None
    # Cycle time runs from the first time work started to the first time it
    # closed. Both ends are asked of the category, so a workflow that renames
    # its states, or declares two closing ones, still measures.
    closing = {name for name, kind in states if kind in _CLOSING_CATEGORIES}
    first_active = next(
        (item for item in segments if categories.get(item["status"]) == _ACTIVE_CATEGORY), None
    )
    first_closed = next((item for item in segments if item["status"] in closing), None)
    cycle_seconds = (
        _as_seconds(parse_time(first_active["start"]), parse_time(first_closed["start"]))
        if first_active and first_closed
        else None
    )
    reopened = sum(
        1
        for previous, current in itertools.pairwise(segments)
        if previous["status"] in closing and current["status"] not in ({None} | closing)
    )
    current = next((item for item in reversed(segments) if item["status"] in declared), None)
    return {
        "segments": segments,
        "coverage": coverage,
        "status_time": status_time,
        "visits": dict(visits),
        "cycle_seconds": cycle_seconds,
        "reopened": reopened,
        "current_status": current["status"] if current else None,
        "current_seconds": current["duration_seconds"] if current else None,
        "lower_bound": coverage in ("partial", "inferred"),
        "as_of": iso_time(now),
    }
