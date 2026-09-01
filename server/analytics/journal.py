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
import sqlite3
import uuid
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path

from ..ops import configuration
from .cache import _CACHE, _canonical_path, _path_identity
from .timeline import _cache_time, _journal_timestamp, _merge_token_counts, _token_delta, parse_time


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
        with _CACHE.lock:
            cached = _CACHE.indexes.get(cache_key)
            directories = _CACHE.index_directories.get(cache_key, ())
            if cached is not None and _CACHE.index_signatures.get(cache_key) == root_signature:
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
            _CACHE.put_index(cache_key, indexed, root_signature, directories)
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
        with _CACHE.lock:
            values = _CACHE.identity_records.get(record_key)
        if values is None:
            values = cls._identity_values_uncached(candidate)
            with _CACHE.lock:
                _CACHE.put_bounded(
                    _CACHE.identity_records,
                    record_key,
                    values,
                    _CACHE.MAX_IDENTITY_RECORDS,
                )
        normalized = cls._normal_session_id(session_id)
        result = normalized is not None and normalized in values
        with _CACHE.lock:
            _CACHE.put_bounded(
                _CACHE.identity,
                (record_key, normalized),
                result,
                _CACHE.MAX_IDENTITY_RECORDS,
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

    def cache_scope(self) -> tuple:
        """Return roots and current file identities for projection cache keys."""

        roots: list[tuple[str, str]] = []
        files: list[tuple[str, str, tuple[int, int] | None]] = []
        for client, values in (("codex", self.codex_roots), ("claude", self.claude_roots)):
            roots.extend((client, _canonical_path(raw)) for raw in values)
            files.extend(
                (client, _canonical_path(path), _path_identity(path))
                for path in {
                    item for candidates in self._index(client).values() for item in candidates
                }
            )
        return tuple(sorted(roots)), tuple(sorted(files))

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
                    if cutoff is not None and stamp > cutoff:
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

        daily_values: dict[str, Counter[str]] = defaultdict(Counter)
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
                    if cutoff is not None and stamp > cutoff:
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
        totals: Counter[str] = Counter()
        costs: list[float] = []
        daily_values: dict[str, Counter[str]] = defaultdict(Counter)
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
                        totals[key] += value
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
        with _CACHE.lock:
            cached = _CACHE.journal.get(cache_key)
        if cached is not None:
            answer = copy.deepcopy(cached)
        else:
            parser = self._claude_usage if client == "claude" else self._codex_usage
            answer = parser(source, as_of=as_of, date_from=date_from, date_to=date_to)
            with _CACHE.lock:
                _CACHE.put_bounded(
                    _CACHE.journal,
                    cache_key,
                    copy.deepcopy(answer),
                    _CACHE.MAX_JOURNALS,
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

    def space_usage(
        self,
        conn: sqlite3.Connection,
        planning_space_id: str,
        *,
        session_ids: Iterable[str] | None = None,
        as_of: object = None,
        date_from: object = None,
        date_to: object = None,
    ) -> dict:
        rows = conn.execute(
            "SELECT r.value AS session_id, s.client, w.title,"
            " w.planning_space_id, p.key || '-' || w.number AS reference, p.key AS space"
            " FROM work_item_refs r"
            " JOIN work_items w ON w.work_item_id = r.work_item_id"
            " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
            " LEFT JOIN sessions s ON s.id = r.value"
            " WHERE r.kind = 'session' ORDER BY r.id",
        ).fetchall()
        all_links: dict[str, list[dict]] = defaultdict(list)
        for raw in rows:
            item = dict(raw)
            all_links[item["session_id"]].append(item)
        allowed_sessions = None if session_ids is None else {str(value) for value in session_ids}
        links = {
            session_id: linked
            for session_id, linked in all_links.items()
            if any(item["planning_space_id"] == planning_space_id for item in linked)
            and (allowed_sessions is None or session_id in allowed_sessions)
        }
        session_rows = []
        totals: Counter[str] = Counter()
        daily_values: dict[str, Counter[str]] = defaultdict(Counter)
        daily_unknown: set[str] = set()
        daily_shared: dict[str, bool] = defaultdict(bool)
        observed = 0
        for session_id in links:
            clients = {item["client"] for item in all_links[session_id] if item.get("client")}
            client = next(iter(clients)) if len(clients) == 1 else None
            usage = self.usage_for_session(
                session_id,
                client,
                as_of=as_of,
                date_from=date_from,
                date_to=date_to,
            )
            shared = len({item["reference"] for item in all_links[session_id]}) > 1
            entry = {
                **usage,
                "shared": shared,
                "exclusive": not shared,
                "work_items": sorted({item["reference"] for item in all_links[session_id]}),
                "planning_spaces": sorted({item["space"] for item in all_links[session_id]}),
            }
            session_rows.append(entry)
            if usage.get("observed"):
                observed += 1
                for key, value in (usage.get("tokens") or {}).items():
                    if isinstance(value, (int, float)):
                        totals[key] += value
            if usage.get("daily_unknown"):
                daily_unknown.update(
                    str(item.get("date")) for item in usage.get("daily", []) if item.get("date")
                )
                if not usage.get("daily"):
                    daily_unknown.add("unknown")
            for item in usage.get("daily", []):
                day = item.get("date")
                values = item.get("tokens")
                if not isinstance(day, str) or not isinstance(values, dict):
                    continue
                _merge_token_counts(daily_values[day], values)
                daily_shared[day] = daily_shared[day] or bool(entry.get("shared"))
                if item.get("unknown"):
                    daily_unknown.add(day)
        token_daily = []
        for day in sorted(daily_values):
            values = dict(daily_values[day])
            token_daily.append(
                {
                    "date": day,
                    "tokens": values or None,
                    "observed": bool(values),
                    "observation": "partial"
                    if day in daily_unknown and values
                    else ("observed" if values else "unknown"),
                    "quality": "derived/internal",
                    "unknown": day in daily_unknown or not values,
                    "shared": bool(daily_shared.get(day)),
                    "reason": "one or more session journals had unknown daily provenance"
                    if day in daily_unknown
                    else None,
                }
            )
        return {
            "source": "local_journal",
            "quality": "derived/internal",
            "status": "observed" if observed else "unknown",
            "observation": "observed" if observed else "unknown",
            "sessions": session_rows,
            "totals": dict(totals) if totals else None,
            "cost": sum(
                float(item["cost"])
                for item in session_rows
                if isinstance(item.get("cost"), (int, float))
            )
            if any(isinstance(item.get("cost"), (int, float)) for item in session_rows)
            else None,
            "cost_quality": "reported"
            if any(isinstance(item.get("cost"), (int, float)) for item in session_rows)
            else "unknown",
            "observed_sessions": observed,
            "linked_sessions": len(links),
            "global_linked_sessions": len(all_links),
            "token_daily": token_daily,
            "daily_observation": "observed" if token_daily else "unknown",
            "daily_quality": "derived/internal",
            "daily_unknown": bool(daily_unknown) or not token_daily,
            "note": "shared/non-exclusive when a session is linked to multiple work items",
        }
