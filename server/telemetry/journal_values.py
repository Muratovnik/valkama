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
