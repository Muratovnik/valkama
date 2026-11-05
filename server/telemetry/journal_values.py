"""UTC timestamps and cumulative token deltas shared by client journal readers."""

from __future__ import annotations

import datetime as _dt
from collections.abc import Mapping


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


def claude_request(row: Mapping[str, object]) -> dict | None:
    """The message of a Claude assistant record that names its request, or None.

    One request is written as many records, one per content block, all under the
    same `message.id`, and only the last holds its final usage.
    """

    if row.get("type") != "assistant":
        return None
    message = row.get("message")
    if not isinstance(message, dict) or not message.get("id"):
        return None
    return message


def codex_cumulative(payload: Mapping[str, object]) -> Mapping[str, object] | None:
    """The cumulative counters a Codex rollout payload carries, or None when it has none.

    A rollout keeps them under `info` of a payload whose `type` is `token_count`,
    and `info` is null before the first response. Rollouts of an earlier format
    named the object `token_count` itself.
    """

    holder = payload.get("info") if payload.get("type") == "token_count" else None
    if holder is None:
        holder = payload.get("token_count")
    cumulative = holder.get("total_token_usage") if isinstance(holder, Mapping) else None
    return cumulative if isinstance(cumulative, Mapping) else None


def _merge_token_counts(target: dict[str, int | float], values: Mapping[str, object]) -> None:
    for key, value in values.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
            target[key] = target.get(key, 0) + value


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
    prior = {
        key: value
        for key, value in previous.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0
    }
    shared = set(numeric) & set(prior)
    if any(numeric[key] < prior[key] for key in shared):
        return None, "cumulative reset"
    # Missing counters are not treated as zero.  Only dimensions observed in
    # both snapshots can safely be differenced.
    if not shared:
        return None, "counter dimensions changed"
    return {key: numeric[key] - prior[key] for key in shared}, None
