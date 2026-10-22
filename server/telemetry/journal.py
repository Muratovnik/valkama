"""The local session journals, read only where the operator pointed us.

Roots are opt-in through constructor arguments or the two environment
variables. The provider never crawls an arbitrary home directory, never treats
missing usage as zero, and marks everything it derives with its own coverage
so a dashboard cannot present a guess as a measurement.
"""

from __future__ import annotations

import copy
import datetime as _dt
import json
import os
import uuid
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path

from ..ops import configuration
from . import cache
from .cache import _canonical_path, _path_identity
from .journal_values import (
    _cache_time,
    _journal_timestamp,
    _merge_token_counts,
    _token_delta,
    parse_time,
)


class LocalJournalUsageProvider:
    """Read-only adapter for Codex rollout and Claude JSONL journals.

    Roots are opt-in through constructor arguments or the two environment
    variables.  The provider never crawls an arbitrary home directory and never
    treats missing usage as zero.
    """

    MAX_INDEX_FILES = 2048
    IDENTITY_LINES = 64
    IDENTITY_BYTES = 262144

    def __init__(
        self, codex_roots: Iterable[str] | None = None, claude_roots: Iterable[str] | None = None
    ):
        self.codex_roots = self._roots(codex_roots, "codex_rollout_root")
        self.claude_roots = self._roots(claude_roots, "claude_session_root")

    @staticmethod
    def _roots(values: Iterable[str] | None, key: str) -> list[str]:
        """Where one client's journals are, through the one resolution.

        Read from the configuration rather than straight from the environment,
        so these two can be set for good in a file instead of in whichever
        shell happens to start the server. An explicit argument still wins:
        that is a caller who already knows, usually a test.
        """

        if values is None:
            raw = configuration.configured(key) or ""
            values = [part for part in raw.split(os.pathsep) if part]
        return [str(Path(value).expanduser()) for value in values if str(value).strip()]

    def _index(self, client: str) -> dict[str, list[Path]]:
        roots = self.claude_roots if client == "claude" else self.codex_roots
        root_key = tuple(sorted({_canonical_path(value) for value in roots}))
        cache_key = (client, root_key)
        root_signature = tuple(
            (
                value,
                "directory"
                if Path(value).is_dir()
                else "file"
                if Path(value).is_file()
                else "missing",
                _path_identity(Path(value)),
            )
            for value in root_key
        )
        with cache.JOURNAL_CACHE.lock:
            cached = cache.JOURNAL_CACHE.indexes.get(cache_key)
            directories = cache.JOURNAL_CACHE.index_directories.get(cache_key, ())
            if (
                cached is not None
                and cache.JOURNAL_CACHE.index_signatures.get(cache_key) == root_signature
            ):
                if all(_path_identity(Path(path)) == identity for path, identity in directories):
                    return cached
            found: dict[str, list[Path]] = defaultdict(list)
            directory_identities: dict[str, tuple[int, int] | None] = {}
            seen = 0
            for raw in root_key:
                path = Path(raw)
                if path.is_file() and path.suffix == ".jsonl":
                    found[path.stem].append(path.resolve())
                    continue
                if not path.is_dir():
                    continue
                # Record every visited directory's stat identity. A file in a
                # nested directory can be created or removed without changing
                # the top-level root mtime; checking these identities lets a
                # fresh provider invalidate the index without a TTL guess.
                try:
                    directory_identities[_canonical_path(path)] = _path_identity(path)
                    for candidate in path.rglob("*"):
                        if candidate.is_dir():
                            directory_identities[_canonical_path(candidate)] = _path_identity(
                                candidate
                            )
                            continue
                        if candidate.suffix != ".jsonl":
                            continue
                        found[candidate.stem].append(candidate.resolve())
                        seen += 1
                        if seen >= self.MAX_INDEX_FILES:
                            break
                except OSError:
                    continue
                if seen >= self.MAX_INDEX_FILES:
                    break
            indexed = {key: sorted(set(value)) for key, value in found.items()}
            directories = tuple(sorted(directory_identities.items()))
            cache.JOURNAL_CACHE.put_index(cache_key, indexed, root_signature, directories)
            return indexed

    @classmethod
    def _normal_session_id(cls, value: object) -> str | None:
        """Canonicalize UUID spellings without weakening ordinary IDs."""
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        try:
            return str(uuid.UUID(text))
        except (ValueError, AttributeError):
            return text

    @classmethod
    def _identity_values_uncached(cls, path: Path) -> frozenset[str]:
        values: set[str] = set()
        stem = cls._normal_session_id(path.stem)
        if stem:
            values.add(stem)
        # Structured filenames may not use the session as their stem.  Read a
        # bounded prefix once and retain every explicit identity found there.
        try:
            consumed = 0
            with path.open(encoding="utf-8", errors="replace") as handle:
                for _ in range(cls.IDENTITY_LINES):
                    line = handle.readline(cls.IDENTITY_BYTES - consumed)
                    if not line:
                        break
                    consumed += len(line.encode("utf-8", errors="ignore"))
                    try:
                        row = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    if not isinstance(row, dict):
                        continue
                    for key in ("session_id", "sessionId", "conversation_id", "conversationId"):
                        value = cls._normal_session_id(row.get(key))
                        if value:
                            values.add(value)
                    payload = row.get("payload")
                    if isinstance(payload, dict):
                        if row.get("type") == "session_meta":
                            value = cls._normal_session_id(payload.get("id"))
                            if value:
                                values.add(value)
                        for key in ("session_id", "sessionId", "conversation_id", "conversationId"):
                            value = cls._normal_session_id(payload.get(key))
                            if value:
                                values.add(value)
                    if consumed >= cls.IDENTITY_BYTES:
                        break
        except OSError:
            return frozenset(values)
        return frozenset(values)

    @classmethod
    def _identity_matches(cls, path: Path, session_id: str) -> bool:
        """Check journal identity once per canonical path/stat/session tuple."""

        candidate = Path(path)
        identity = _path_identity(candidate)
        if identity is None:
            return False
        record_key = ("identity-record", _canonical_path(candidate), identity)
        with cache.JOURNAL_CACHE.lock:
            values = cache.JOURNAL_CACHE.identity_records.get(record_key)
        if values is None:
            values = cls._identity_values_uncached(candidate)
            with cache.JOURNAL_CACHE.lock:
                cache.JOURNAL_CACHE.put_bounded(
                    cache.JOURNAL_CACHE.identity_records,
                    record_key,
                    values,
                    cache.JOURNAL_CACHE.MAX_IDENTITY_RECORDS,
                )
        normalized = cls._normal_session_id(session_id)
        result = normalized is not None and normalized in values
        with cache.JOURNAL_CACHE.lock:
            cache.JOURNAL_CACHE.put_bounded(
                cache.JOURNAL_CACHE.identity,
                (record_key, normalized),
                result,
                cache.JOURNAL_CACHE.MAX_IDENTITY_RECORDS,
            )
        return result

    def _matching_files(self, client: str, session_id: str, path: str | None = None) -> list[Path]:
        roots = [
            Path(value).resolve()
            for value in (self.claude_roots if client == "claude" else self.codex_roots)
        ]
        if path:
            candidate = Path(path).expanduser().resolve()
            if not any(
                candidate == root or (root.is_dir() and root in candidate.parents) for root in roots
            ):
                return []
            candidates = [candidate] if candidate.is_file() and candidate.suffix == ".jsonl" else []
            if candidates and not self._identity_matches(candidate, session_id):
                return []
        else:
            candidates = [
                item
                for values in self._index(client).values()
                for item in values
                if item.stem == session_id
            ]
            # A non-stem filename must prove its identity; never use a
            # substring or arbitrary first/last match.
            if not candidates:
                candidates = [
                    item
                    for values in self._index(client).values()
                    for item in values
                    if self._identity_matches(item, session_id)
                ]
        unique = sorted(set(candidates))
        if len(unique) != 1:
            return []
        return unique

    @staticmethod
    def _number(value: object) -> int | float | None:
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    @classmethod
    def _codex_usage(
        cls,
        path: Path,
        *,
        as_of: object = None,
        date_from: object = None,
        date_to: object = None,
    ) -> dict:
        """Read Codex cumulative snapshots and derive a bounded daily series."""

        cutoff = parse_time(as_of)
        start = parse_time(date_from)
        finish = parse_time(date_to)
        snapshots: list[tuple[_dt.datetime | None, int, dict, object, object]] = []
        unknown_timestamp = False
        model = None
        cost = None
        try:
            with path.open(encoding="utf-8", errors="replace") as handle:
                for sequence, line in enumerate(handle):
                    try:
                        row = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    if not isinstance(row, dict):
                        continue
                    payload = row.get("payload")
                    if not isinstance(payload, dict):
                        continue
                    token = payload.get("token_count")
                    cumulative = token.get("total_token_usage") if isinstance(token, dict) else None
                    if not isinstance(cumulative, dict):
                        continue
                    stamp = _journal_timestamp(row, payload)
                    if stamp is None:
                        unknown_timestamp = True
                    if cutoff is not None and stamp is None:
                        # A bounded projection cannot safely place an
                        # untimestamped snapshot before/after as_of.
                        unknown_timestamp = True
                        continue
                    if cutoff is not None and stamp is not None and stamp > cutoff:
                        continue
                    snapshots.append(
                        (
                            stamp,
                            sequence,
                            dict(cumulative),
                            payload.get("model"),
                            payload.get("cost_usd"),
                        )
                    )
                    if isinstance(payload.get("model"), str) and payload.get("model"):
                        model = payload["model"]
                    if cls._number(payload.get("cost_usd")) is not None:
                        cost = cls._number(payload.get("cost_usd"))
        except OSError as error:
            return {"observed": False, "reason": str(error), "daily": [], "daily_unknown": True}
        if not snapshots:
            return {
                "observed": False,
                "reason": "no cumulative token_count record",
                "daily": [],
                "daily_unknown": unknown_timestamp,
            }
        latest = max(snapshots, key=lambda item: item[1])[2]
        tokens = {
            key: latest[key]
            for key in (
                "input_tokens",
                "cached_input_tokens",
                "output_tokens",
                "reasoning_output_tokens",
                "total_tokens",
            )
            if cls._number(latest.get(key)) is not None
        }
        if not tokens:
            return {
                "observed": False,
                "reason": "token_count has no numeric totals",
                "daily": [],
                "daily_unknown": unknown_timestamp,
            }

        daily_values: dict[str, dict[str, int | float]] = defaultdict(dict)
        daily_unknown: dict[str, str] = {}
        previous: dict | None = None
        ordered = sorted(
            (item for item in snapshots if item[0] is not None),
            key=lambda item: (item[0], item[1]),
        )
        for stamp, _sequence, cumulative, _snapshot_model, _snapshot_cost in ordered:
            delta, reason = _token_delta(cumulative, previous)
            previous = cumulative
            if stamp is None:
                continue
            day = stamp.date().isoformat()
            if reason:
                daily_unknown[day] = reason
                continue
            if start is not None and stamp < start:
                continue
            if finish is not None and stamp >= finish:
                continue
            _merge_token_counts(daily_values[day], delta or {})
        daily = []
        for day in sorted(set(daily_values) | set(daily_unknown)):
            values = dict(daily_values.get(day) or {})
            has_unknown = day in daily_unknown
            daily.append(
                {
                    "date": day,
                    "tokens": values or None,
                    "observed": bool(values),
                    "observation": "partial"
                    if values and has_unknown
                    else ("observed" if values else "unknown"),
                    "quality": "derived/internal",
                    "unknown": has_unknown or not values,
                    "reason": daily_unknown.get(day),
                }
            )
        return {
            "observed": True,
            "tokens": tokens,
            "model": model,
            "cost": cost,
            "daily": daily,
            "daily_unknown": unknown_timestamp or bool(daily_unknown),
        }

    @classmethod
    def _claude_usage(
        cls,
        path: Path,
        *,
        as_of: object = None,
        date_from: object = None,
        date_to: object = None,
    ) -> dict:
        # A Claude transcript may rewrite the same assistant message as the
        # stream is flushed.  Keep the latest complete row per message id and
        # derive both usage and cost from that same deduplicated set.  Summing
        # cost while reading the raw file would double-count those rewrites.
        cutoff = parse_time(as_of)
        start = parse_time(date_from)
        finish = parse_time(date_to)
        messages: dict[str, tuple[dict, int | float | None, _dt.datetime | None, int]] = {}
        cost_conflict = False
        model = None
        unknown_timestamp = False
        try:
            with path.open(encoding="utf-8", errors="replace") as handle:
                for sequence, line in enumerate(handle):
                    try:
                        row = json.loads(line)
                    except (TypeError, ValueError):
                        continue
                    if not isinstance(row, dict) or row.get("type") != "assistant":
                        continue
                    if (
                        row.get("isSidechain")
                        or row.get("is_sidechain")
                        or row.get("agent_id")
                        or row.get("agentId")
                    ):
                        continue
                    message = row.get("message")
                    if not isinstance(message, dict) or not message.get("id"):
                        continue
                    cost = cls._number(row.get("cost_usd"))
                    if cost is None:
                        cost = cls._number(message.get("cost_usd"))
                    stamp = _journal_timestamp(row, message)
                    if stamp is None:
                        unknown_timestamp = True
                    if cutoff is not None and stamp is None:
                        unknown_timestamp = True
                        continue
                    if cutoff is not None and stamp is not None and stamp > cutoff:
                        continue
                    message_id = str(message["id"])
                    previous = messages.get(message_id)
                    if previous is not None and previous[1] != cost:
                        # Rewritten assistant rows may carry a transient or
                        # partial cost.  Do not add two different claims for
                        # one message; report cost as unavailable instead.
                        cost_conflict = True
                    messages[message_id] = (message, cost, stamp, sequence)
        except OSError as error:
            return {"observed": False, "reason": str(error), "daily": [], "daily_unknown": True}
        totals: dict[str, int | float] = {}
        costs: list[float] = []
        daily_values: dict[str, dict[str, int | float]] = defaultdict(dict)
        daily_cost_unknown: set[str] = set()
        for message, cost, _stamp, _sequence in messages.values():
            if message.get("model"):
                model = message["model"]
            usage = message.get("usage")
            if not isinstance(usage, dict):
                pass
            else:
                for key in (
                    "input_tokens",
                    "cache_read_input_tokens",
                    "cache_creation_input_tokens",
                    "output_tokens",
                    "reasoning_output_tokens",
                ):
                    value = cls._number(usage.get(key))
                    if value is not None:
                        totals[key] = totals.get(key, 0) + value
            if cost is not None:
                costs.append(float(cost))
        if not totals:
            return {
                "observed": False,
                "reason": "no assistant usage records",
                "daily": [],
                "daily_unknown": unknown_timestamp,
            }
        for message, cost, stamp, _sequence in messages.values():
            if stamp is None:
                continue
            day = stamp.date().isoformat()
            if start is not None and stamp < start:
                continue
            if finish is not None and stamp >= finish:
                continue
            usage = message.get("usage")
            if not isinstance(usage, dict):
                continue
            values = {
                key: value
                for key, value in usage.items()
                if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0
            }
            if values:
                _merge_token_counts(daily_values[day], values)
            if cost is None and message.get("cost_usd") is not None:
                daily_cost_unknown.add(day)
        daily = []
        if cost_conflict:
            daily_cost_unknown.update(daily_values)
        for day in sorted(daily_values):
            values = dict(daily_values[day])
            daily.append(
                {
                    "date": day,
                    "tokens": values or None,
                    "observed": bool(values),
                    "observation": "observed" if values else "unknown",
                    "quality": "derived/internal",
                    "unknown": day in daily_cost_unknown,
                    "reason": "conflicting/missing cost" if day in daily_cost_unknown else None,
                }
            )
        return {
            "observed": True,
            "tokens": dict(totals),
            "model": model,
            "cost": None if cost_conflict else (sum(costs) if costs else None),
            "daily": daily,
            "daily_unknown": unknown_timestamp or bool(daily_cost_unknown),
        }

    def usage_for_session(
        self,
        session_id: str,
        client: str | None = None,
        path: str | None = None,
        *,
        as_of: object = None,
        date_from: object = None,
        date_to: object = None,
    ) -> dict:
        # A journal format is client-specific.  When the exact card/session
        # association did not provide a client, leave usage unknown rather
        # than guessing from a path fragment or parsing the wrong format.
        if client not in ("claude", "codex"):
            return {
                "session_id": session_id,
                "source": "local_journal",
                "quality": "derived/internal",
                "observation": "unknown",
                "observed": False,
                "tokens": None,
                "cost": None,
                "cost_quality": "unknown",
                "model": None,
                "daily": [],
                "daily_unknown": True,
                "reason": "exact client identity is required to select a journal format",
            }
        files = self._matching_files(client, session_id, path)
        if not files:
            return {
                "session_id": session_id,
                "source": "local_journal",
                "quality": "derived/internal",
                "observation": "unknown",
                "observed": False,
                "tokens": None,
                "cost": None,
                "cost_quality": "unknown",
                "model": None,
                "daily": [],
                "daily_unknown": True,
                "reason": "no exact local journal file configured for this session",
            }
        source = files[0]
        source_identity = _path_identity(source)
        cache_key = (
            "journal",
            client,
            _canonical_path(source),
            source_identity,
            self._normal_session_id(session_id),
            _cache_time(as_of),
            _cache_time(date_from),
            _cache_time(date_to),
        )
        with cache.JOURNAL_CACHE.lock:
            cached = cache.JOURNAL_CACHE.journal.get(cache_key)
        if cached is not None:
            answer = copy.deepcopy(cached)
        else:
            parser = self._claude_usage if client == "claude" else self._codex_usage
            answer = parser(source, as_of=as_of, date_from=date_from, date_to=date_to)
            with cache.JOURNAL_CACHE.lock:
                cache.JOURNAL_CACHE.put_bounded(
                    cache.JOURNAL_CACHE.journal,
                    cache_key,
                    copy.deepcopy(answer),
                    cache.JOURNAL_CACHE.MAX_JOURNALS,
                )
        answer.update(
            {
                "session_id": session_id,
                "source": "local_journal",
                "quality": "derived/internal",
                "observation": "observed" if answer.get("observed") else "unknown",
                "cost_quality": "reported" if answer.get("cost") is not None else "unknown",
            }
        )
        answer.setdefault("tokens", None)
        answer.setdefault("cost", None)
        answer.setdefault("model", None)
        answer.setdefault("daily", [])
        answer.setdefault("daily_unknown", not answer.get("observed"))
        return answer
