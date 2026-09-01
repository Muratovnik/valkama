"""How a published Improvements value is shaped, and what shape is refused.

Everything here is pure: it takes plain data, returns plain data or raises
`ImprovementError`, and never opens a database.  That is what makes it testable
on its own, and it is also what makes it dangerous to edit casually — these
functions are the published contract in
`docs/improvements-contract.md`, and two of them are load-bearing beyond their
return value:

* `redact_excerpt` is the redaction boundary.  Everything persisted or published
  as evidence passes through it, and `source_hash` is taken over its output, so
  the excerpt that reaches storage is the redacted one by construction.
* `deterministic_fingerprint` is the semantic clustering key, and the
  `(pointer, source_hash)` pair `sanitize_signal_packet` produces is the ingress
  idempotency key.  A change to either silently stops recognising the signals a
  store already holds.

The primitives at the top are here for the same reason: the timestamp format,
the canonical serialization every hash is taken over, and the bounded-text rule
are part of the shape, not incidental helpers.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import cast

from .contract import (
    ALLOWED_TARGETS,
    MAX_EXCERPT_CHARS,
    MAX_SIGNAL_COUNT,
    MAX_SIGNAL_PACKET_BYTES,
    SEVERITIES,
    SOURCE_KINDS,
    ImprovementError,
)
from .evaluation_contract import (
    EVAL_PACK_INTERFACE_VERSION,
    EvaluationContractError,
    canonical_evaluation_pack,
    normalize_eval_run,
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ImprovementError("invalid_timestamp", "timestamp must be ISO-8601") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


_SECRET_PATTERNS = (
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"), "[REDACTED_SECRET]"),
    (re.compile(r"\b(?:gh[opusr]_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16})\b"), "[REDACTED_SECRET]"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}"), "Bearer [REDACTED]"),
    (
        re.compile(r"(?i)\b(password|passwd|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+"),
        r"\1=[REDACTED]",
    ),
)


def redact_excerpt(value: object) -> str:
    text = str(value or "")
    text = "".join(ch if ch in "\n\t" or unicodedata.category(ch) != "Cc" else " " for ch in text)
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text[:1200]


_FORBIDDEN_PAYLOAD_KEYS = {
    "transcript",
    "prompt",
    "reasoning",
    "chain_of_thought",
    "model_messages",
    "messages",
    "tool_input",
    "tool_result",
    "tool_output",
    "raw_output",
    "request_body",
    "response_body",
    "stdout",
    "stderr",
    "context",
    "source_ids",
    "sourceids",
    "raw",
    "private",
}


def _normalized_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")


def bounded_text(value: object, limit: int = 1200) -> str:
    return redact_excerpt(value)[:limit]


def _sanitize_tree(
    value: object, allowed_keys: set[str], path: str = "payload", depth: int = 0
) -> object:
    if depth > 6:
        raise ImprovementError("invalid_schema", f"{path} is nested too deeply")
    if isinstance(value, Mapping):
        if len(value) > 50:
            raise ImprovementError("invalid_schema", f"{path} has too many fields")
        result: dict[str, object] = {}
        for raw_key, child in value.items():
            key = _normalized_key(raw_key)
            if key in _FORBIDDEN_PAYLOAD_KEYS:
                raise ImprovementError("private_payload", f"{path}.{key} is forbidden")
            if key not in allowed_keys:
                raise ImprovementError("invalid_schema", f"{path}.{key} is not a whitelisted field")
            if key == "command":
                if (
                    not isinstance(child, (list, tuple))
                    or not child
                    or len(child) > 32
                    or not all(isinstance(arg, str) for arg in child)
                ):
                    raise ImprovementError(
                        "invalid_schema", "EvaluationPack command must be non-empty argv"
                    )
                result[key] = [bounded_text(arg, 512) for arg in child]
            else:
                result[key] = _sanitize_tree(child, allowed_keys, f"{path}.{key}", depth + 1)
        return result
    if isinstance(value, (list, tuple)):
        if len(value) > 100:
            raise ImprovementError("invalid_schema", f"{path} has too many items")
        return [_sanitize_tree(item, allowed_keys, f"{path}[]", depth + 1) for item in value]
    if isinstance(value, str):
        return bounded_text(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    raise ImprovementError("invalid_schema", f"{path} contains an unsupported value")


def sanitize_proposal(value: Mapping[str, object]) -> dict:
    allowed = {
        "targets",
        "affected_surfaces",
        "root_cause",
        "frequency",
        "trend",
        "evidence",
        "evidence_pointers",
        "actionability",
        "recommended_change",
        "risk",
        "rollback",
        "acceptance_criteria",
    }
    # `_sanitize_tree` returns a mapping for a mapping and the sanitized value
    # itself for anything else, so a caller that passes a string gets a string
    # back.  The cast states what this function's return type has always
    # claimed rather than adding a check that would refuse an argument the
    # analyzer path currently accepts.
    sanitized = cast("dict[str, object]", _sanitize_tree(value, allowed, "proposal"))
    for field in ("evidence", "evidence_pointers"):
        if field in sanitized:
            pointers = sanitized[field]
            if not isinstance(pointers, list) or not all(
                isinstance(item, str) and re.fullmatch(r"session:[^/\s]+/event:[^/\s]+", item)
                for item in pointers
            ):
                raise ImprovementError(
                    "invalid_schema", f"proposal.{field} accepts stable pointers only"
                )
    if len(canonical_json(sanitized)) > 60000:
        raise ImprovementError("invalid_schema", "proposal exceeds the storage bound")
    return sanitized


def sanitize_evaluation_pack(value: Mapping[str, object], revision: int | None = None) -> dict:
    """Return the one runner/storage canonical pack for a numeric DB revision."""
    if not isinstance(value, Mapping):
        raise ImprovementError("invalid_schema", "EvaluationPack must be an object")
    candidate = dict(value)
    if revision is not None:
        supplied = candidate.get("version")
        if supplied not in {None, str(revision)}:
            raise ImprovementError(
                "invalid_schema", "EvaluationPack version must match its storage revision"
            )
        candidate["version"] = str(revision)
        candidate.setdefault("interface_version", EVAL_PACK_INTERFACE_VERSION)
    try:
        return canonical_evaluation_pack(candidate)
    except EvaluationContractError as exc:
        raise ImprovementError("invalid_schema", str(exc)) from exc


def sanitize_eval_result(value: Mapping[str, object], **expected: str | None) -> dict:
    try:
        return normalize_eval_run(value, **expected)
    except EvaluationContractError as exc:
        raise ImprovementError("invalid_eval", str(exc)) from exc


def _reject_private_tree(value: object, path: str = "analyzer_result", depth: int = 0) -> None:
    if depth > 10:
        raise ImprovementError("invalid_schema", f"{path} is nested too deeply")
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = _normalized_key(key)
            if normalized in _FORBIDDEN_PAYLOAD_KEYS:
                raise ImprovementError("private_payload", f"{path}.{normalized} is forbidden")
            _reject_private_tree(child, f"{path}.{normalized}", depth + 1)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_private_tree(child, f"{path}[]", depth + 1)


def sanitize_analyzer_result(value: Mapping[str, object]) -> dict:
    if not isinstance(value, Mapping):
        raise ImprovementError(
            "invalid_analyzer_result", "validated analyzer result must be an object"
        )
    _reject_private_tree(value)
    if set(value) - {"signals", "cases", "case_mutations"}:
        raise ImprovementError("invalid_analyzer_result", "analyzer result has unknown fields")
    raw_signals, raw_cases, raw_mutations = (
        value.get("signals", []),
        value.get("cases", []),
        value.get("case_mutations", []),
    )
    if not isinstance(raw_signals, (list, tuple)) or len(raw_signals) > 100:
        raise ImprovementError("invalid_analyzer_result", "signals must be a bounded list")
    if not isinstance(raw_mutations, (list, tuple)) or len(raw_mutations) > 100:
        raise ImprovementError("invalid_analyzer_result", "case_mutations must be a bounded list")
    if not isinstance(raw_cases, (list, tuple)) or len(raw_cases) > 100:
        raise ImprovementError("invalid_analyzer_result", "cases must be a bounded list")
    signals = []
    for item in raw_signals:
        if not isinstance(item, Mapping) or set(item) - {
            "id",
            "category",
            "title",
            "evidence",
            "cluster_key",
            "case_key",
        }:
            raise ImprovementError("invalid_analyzer_result", "signal schema is invalid")
        category = str(item.get("category", ""))
        if category not in ALLOWED_TARGETS:
            raise ImprovementError("invalid_target", "analyzer signal target is forbidden")
        evidence = item.get("evidence")
        allowed_evidence = {
            "pointer",
            "source_kind",
            "at",
            "client",
            "session_id",
            "event_type",
            "severity",
            "excerpt",
            "text",
        }
        required_evidence = {"pointer", "at", "client", "session_id", "event_type", "severity"}
        if (
            not isinstance(evidence, Mapping)
            or set(evidence) - allowed_evidence
            or not required_evidence.issubset(evidence)
            or not ({"excerpt", "text"} & set(evidence))
        ):
            raise ImprovementError("invalid_analyzer_result", "signal evidence schema is invalid")
        title = bounded_text(item.get("title", "Recurring agent failure"), 200)
        if not title:
            raise ImprovementError("invalid_title", "analyzer signal title is required")
        signal: dict[str, object] = {
            "category": category,
            "title": title,
            "evidence": evidence_record(evidence),
        }
        if "id" in item:
            signal["id"] = bounded_text(item["id"], 100)
            if not signal["id"]:
                raise ImprovementError("invalid_analyzer_result", "signal id is required")
        if "cluster_key" in item:
            signal["cluster_key"] = bounded_text(item["cluster_key"], 200)
            if not signal["cluster_key"]:
                raise ImprovementError("invalid_analyzer_result", "cluster_key is required")
        if "case_key" in item:
            case_key = bounded_text(item["case_key"], 100)
            signal["case_key"] = case_key
            if "cluster_key" not in signal or not re.fullmatch(r"[A-Za-z0-9._-]+", case_key):
                raise ImprovementError(
                    "invalid_analyzer_result", "case_key requires a cluster and safe identifier"
                )
        signals.append(signal)
    signal_by_id: dict[object, dict[str, object]] = {}
    for signal in signals:
        if "id" in signal:
            if signal["id"] in signal_by_id:
                raise ImprovementError("invalid_analyzer_result", "signal ids must be unique")
            signal_by_id[signal["id"]] = signal
    clustered_ids, cases = set(), []
    for item in raw_cases:
        allowed = {
            "cluster_key",
            "case_key",
            "category",
            "title",
            "signal_ids",
            "proposal",
            "evaluation_pack",
        }
        if not isinstance(item, Mapping) or set(item) - allowed:
            raise ImprovementError("invalid_analyzer_result", "semantic case schema is invalid")
        cluster_key, category = (
            bounded_text(item.get("cluster_key", ""), 200),
            str(item.get("category", "")),
        )
        signal_ids = item.get("signal_ids")
        if (
            not cluster_key
            or category not in ALLOWED_TARGETS
            or not isinstance(signal_ids, (list, tuple))
            or not signal_ids
        ):
            raise ImprovementError(
                "invalid_analyzer_result",
                "semantic case requires category, cluster_key, and signal_ids",
            )
        normalized_ids = [bounded_text(signal_id, 100) for signal_id in signal_ids]
        if len(set(normalized_ids)) != len(normalized_ids) or any(
            signal_id in clustered_ids for signal_id in normalized_ids
        ):
            raise ImprovementError("invalid_analyzer_result", "signal mapping must be unique")
        if any(signal_id not in signal_by_id for signal_id in normalized_ids):
            raise ImprovementError(
                "invalid_analyzer_result", "semantic case references an unknown signal"
            )
        if any(signal_by_id[signal_id]["category"] != category for signal_id in normalized_ids):
            raise ImprovementError(
                "invalid_analyzer_result", "semantic case category must match every signal"
            )
        case: dict[str, object] = {
            "cluster_key": cluster_key,
            "category": category,
            "signal_ids": normalized_ids,
            "title": bounded_text(item.get("title", "Recurring agent failure"), 200),
        }
        if not case["title"]:
            raise ImprovementError("invalid_title", "semantic case title is required")
        if "case_key" in item:
            case_key = bounded_text(item["case_key"], 100)
            case["case_key"] = case_key
            if not re.fullmatch(r"[A-Za-z0-9._-]+", case_key):
                raise ImprovementError(
                    "invalid_analyzer_result", "case_key must be a safe identifier"
                )
        if ("proposal" in item) != ("evaluation_pack" in item):
            raise ImprovementError(
                "invalid_analyzer_result",
                "semantic proposal and EvaluationPack must be supplied together",
            )
        if "proposal" in item:
            proposal = sanitize_proposal(item["proposal"])
            case["proposal"] = proposal
            targets = proposal.get("targets", proposal.get("affected_surfaces", []))
            if not targets or any(target not in ALLOWED_TARGETS for target in targets):
                raise ImprovementError("invalid_target", "semantic proposal target is forbidden")
            if not isinstance(item["evaluation_pack"], Mapping):
                raise ImprovementError(
                    "invalid_analyzer_result", "evaluation_pack must be an object"
                )
            case["evaluation_pack"] = dict(item["evaluation_pack"])
        cases.append(case)
        clustered_ids.update(normalized_ids)
    if any(signal.get("id") in clustered_ids and "cluster_key" in signal for signal in signals):
        raise ImprovementError(
            "invalid_analyzer_result", "signal cluster identity cannot be declared twice"
        )
    mutations = []
    for item in raw_mutations:
        allowed = {"case_id", "title", "trend", "severity", "proposal", "evaluation_pack"}
        if (
            not isinstance(item, Mapping)
            or set(item) - allowed
            or not isinstance(item.get("case_id"), int)
        ):
            raise ImprovementError("invalid_analyzer_result", "case mutation schema is invalid")
        if set(item) == {"case_id"}:
            raise ImprovementError("invalid_analyzer_result", "case mutation cannot be empty")
        mutation: dict[str, object] = {"case_id": int(item["case_id"])}
        if "title" in item:
            mutation["title"] = bounded_text(item["title"], 200)
            if not mutation["title"]:
                raise ImprovementError("invalid_title", "analyzer case title is required")
        if "trend" in item:
            if item["trend"] not in {"rising", "steady", "falling"}:
                raise ImprovementError("invalid_analyzer_result", "trend is invalid")
            mutation["trend"] = item["trend"]
        if "severity" in item:
            if item["severity"] not in SEVERITIES:
                raise ImprovementError("invalid_severity", "severity is invalid")
            mutation["severity"] = item["severity"]
        if ("proposal" in item) != ("evaluation_pack" in item):
            raise ImprovementError(
                "invalid_analyzer_result", "proposal and EvaluationPack must be supplied together"
            )
        if "proposal" in item:
            mutation["proposal"] = sanitize_proposal(item["proposal"])
            if not isinstance(item["evaluation_pack"], Mapping):
                raise ImprovementError(
                    "invalid_analyzer_result", "evaluation_pack must be an object"
                )
            mutation["evaluation_pack"] = dict(item["evaluation_pack"])
        mutations.append(mutation)
    result = {"signals": signals, "cases": cases, "case_mutations": mutations}
    if len(canonical_json(result)) > 60000:
        raise ImprovementError(
            "invalid_analyzer_result", "analyzer result exceeds the storage bound"
        )
    return result


def validated_result_hash(validated_result: Mapping[str, object]) -> str:
    sanitized = sanitize_analyzer_result(validated_result)
    return hashlib.sha256(canonical_json(sanitized).encode("utf-8")).hexdigest()


def evidence_record(raw: Mapping[str, object]) -> dict:
    pointer = str(raw.get("pointer", "")).strip()
    source_kind = str(raw.get("source_kind", "session_event"))
    if source_kind == "session_event":
        valid_pointer = bool(re.fullmatch(r"session:[^/\s]+/event:[^/\s]+", pointer))
    elif source_kind == "agentmemory_lesson":
        valid_pointer = bool(
            re.fullmatch(r"memory:lesson:[A-Za-z0-9][A-Za-z0-9._~-]{0,399}", pointer)
        )
    elif source_kind == "execution_result":
        # The attempt's own id, which is what makes this evidence checkable: a
        # reader can open the row, see the packet, the outcome and the Git
        # baseline, rather than trusting an excerpt.
        valid_pointer = bool(re.fullmatch(r"execution:exec-[0-9a-f]{32}", pointer))
    elif source_kind == "user_feedback":
        valid_pointer = bool(re.fullmatch(r"feedback:[A-Za-z0-9][A-Za-z0-9._~-]{0,399}", pointer))
    else:
        valid_pointer = False
    if len(pointer) > 500 or not valid_pointer:
        raise ImprovementError("invalid_evidence", "a stable source evidence pointer is required")
    at = str(raw.get("at") or utc_now())
    parse_timestamp(at)
    severity = str(raw.get("severity", "medium"))
    if severity not in SEVERITIES:
        raise ImprovementError(
            "invalid_severity", "severity must be low, medium, high, or critical"
        )
    source = str(raw.get("excerpt", raw.get("text", "")))
    excerpt = redact_excerpt(source)
    session_id = bounded_text(raw.get("session_id", ""), 200)
    if source_kind != "session_event" and session_id:
        raise ImprovementError(
            "invalid_evidence", "non-session evidence cannot claim session provenance"
        )
    return {
        "pointer": pointer,
        "at": at,
        "client": bounded_text(raw.get("client", ""), 20),
        "session_id": session_id,
        "event_type": bounded_text(raw.get("event_type", ""), 100),
        "source_kind": source_kind,
        "severity": severity,
        "excerpt": excerpt,
        "source_hash": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
    }


_SIGNAL_REQUIRED_KEYS = {"source_kind", "pointer", "category", "severity", "excerpt"}
_SIGNAL_OPTIONAL_KEYS = {"at", "client", "event_type", "session_id"}
_OPAQUE_POINTER = r"[A-Za-z0-9][A-Za-z0-9._~-]{0,399}"
_SESSION_POINTER = re.compile(r"^session:(?P<session>[^/\s]{1,200})/event:(?P<event>[1-9][0-9]*)$")
_LESSON_POINTER = re.compile(rf"^memory:lesson:{_OPAQUE_POINTER}$")
_FEEDBACK_POINTER = re.compile(rf"^feedback:{_OPAQUE_POINTER}$")
#: An attempt id, which is what makes execution evidence checkable.
_EXECUTION_POINTER = re.compile(r"execution:exec-[0-9a-f]{32}")


def _strict_bounded_string(value: object, field: str, limit: int, *, required: bool = False) -> str:
    if not isinstance(value, str):
        raise ImprovementError("invalid_signal", f"{field} must be a string")
    text = value.strip() if field != "excerpt" else value
    if (required and not text) or len(text) > limit:
        raise ImprovementError("invalid_signal", f"{field} must be 1..{limit} characters")
    return text


def sanitize_signal_packet(
    packet: Mapping[str, object],
    *,
    expected_scope: str,
    verified_session_events: set[tuple[str, str]] | None = None,
) -> list[tuple[str, dict]]:
    """Validate the only public signal packet and return persistence-safe facts."""
    if not isinstance(packet, Mapping):
        raise ImprovementError("invalid_request", "signal packet must be an object")
    try:
        packet_size = len(
            json.dumps(packet, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )
    except (TypeError, ValueError) as exc:
        raise ImprovementError(
            "invalid_request", "signal packet must be JSON serializable"
        ) from exc
    if packet_size > MAX_SIGNAL_PACKET_BYTES:
        raise ImprovementError("request_too_large", "signal packet exceeds 16KB")
    unknown_top = set(packet) - {"scope", "signals"}
    if unknown_top:
        normalized = {_normalized_key(key) for key in unknown_top}
        code = "private_payload" if normalized & _FORBIDDEN_PAYLOAD_KEYS else "invalid_schema"
        raise ImprovementError(code, "signal packet contains non-allowlisted fields")
    scope = _strict_bounded_string(packet.get("scope"), "scope", 32, required=True)
    if scope != expected_scope:
        raise ImprovementError(
            "scope_mismatch", "signal packet scope differs from bound scope", 404
        )
    raw_signals = packet.get("signals")
    if not isinstance(raw_signals, list) or not 1 <= len(raw_signals) <= MAX_SIGNAL_COUNT:
        raise ImprovementError("invalid_signal_count", "signals must contain 1..100 items")
    verified = verified_session_events or set()
    sanitized: list[tuple[str, dict]] = []
    for index, raw in enumerate(raw_signals):
        if not isinstance(raw, Mapping):
            raise ImprovementError("invalid_signal", f"signals[{index}] must be an object")
        keys = set(raw)
        unknown = keys - _SIGNAL_REQUIRED_KEYS - _SIGNAL_OPTIONAL_KEYS
        normalized = {_normalized_key(key) for key in unknown}
        if normalized & _FORBIDDEN_PAYLOAD_KEYS:
            raise ImprovementError("private_payload", f"signals[{index}] contains private fields")
        if unknown or not keys >= _SIGNAL_REQUIRED_KEYS:
            raise ImprovementError(
                "invalid_schema", f"signals[{index}] fields do not match the allowlist"
            )
        source_kind = _strict_bounded_string(raw["source_kind"], "source_kind", 40, required=True)
        if source_kind not in SOURCE_KINDS:
            raise ImprovementError("invalid_source_kind", "source_kind is not supported")
        pointer = _strict_bounded_string(raw["pointer"], "pointer", 500, required=True)
        category = _strict_bounded_string(raw["category"], "category", 40, required=True)
        if category not in ALLOWED_TARGETS:
            raise ImprovementError("invalid_target", "target must be an allowed workflow surface")
        severity = _strict_bounded_string(raw["severity"], "severity", 10, required=True)
        if severity not in SEVERITIES:
            raise ImprovementError(
                "invalid_severity", "severity must be low, medium, high, or critical"
            )
        excerpt_raw = _strict_bounded_string(
            raw["excerpt"], "excerpt", MAX_EXCERPT_CHARS, required=True
        )
        excerpt = redact_excerpt(excerpt_raw)
        at = _strict_bounded_string(raw.get("at", utc_now()), "at", 64, required=True)
        parse_timestamp(at)
        client = _strict_bounded_string(raw.get("client", ""), "client", 20)
        event_type = _strict_bounded_string(raw.get("event_type", source_kind), "event_type", 100)
        session_id = _strict_bounded_string(raw.get("session_id", ""), "session_id", 200)
        if source_kind == "session_event":
            match = _SESSION_POINTER.fullmatch(pointer)
            if not match or not session_id or match.group("session") != session_id:
                raise ImprovementError(
                    "invalid_evidence", "session_event pointer and session_id must agree"
                )
            if (pointer, session_id) not in verified:
                raise ImprovementError(
                    "unverified_session", "referenced session event does not exist", 422
                )
        elif source_kind == "agentmemory_lesson":
            if not _LESSON_POINTER.fullmatch(pointer):
                raise ImprovementError(
                    "invalid_evidence", "lesson pointer must be memory:lesson:<opaque-id>"
                )
            if session_id:
                raise ImprovementError(
                    "invalid_evidence", "lessons cannot claim session provenance"
                )
            event_type = "agentmemory_lesson"
        elif source_kind == "execution_result":
            if not _EXECUTION_POINTER.fullmatch(pointer):
                raise ImprovementError(
                    "invalid_evidence", "execution pointer must be execution:<attempt id>"
                )
            if session_id:
                raise ImprovementError(
                    "invalid_evidence",
                    "an execution result is evidence about the attempt, not about one session",
                )
            event_type = "execution_result"
        elif source_kind == "user_feedback":
            if not _FEEDBACK_POINTER.fullmatch(pointer):
                raise ImprovementError(
                    "invalid_evidence", "feedback pointer must be stable and opaque"
                )
            if session_id:
                raise ImprovementError(
                    "invalid_evidence", "feedback cannot claim session provenance"
                )
            event_type = "user_feedback"
        else:
            # Unreachable while `source_kind` is checked against SOURCE_KINDS
            # above, and a refusal rather than a fallthrough on purpose: this
            # branch used to be `else: treat as feedback`, so a new kind added
            # to the set would have been silently reclassified as one.
            raise ImprovementError("invalid_evidence", f"unhandled source kind {source_kind!r}")
        sanitized.append(
            (
                category,
                {
                    "source_kind": source_kind,
                    "pointer": pointer,
                    "at": at,
                    "client": client,
                    "session_id": session_id if source_kind == "session_event" else "",
                    "event_type": event_type,
                    "severity": severity,
                    "excerpt": excerpt,
                    "source_hash": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
                },
            )
        )
    return sanitized


def deterministic_fingerprint(category: str, evidence: Mapping[str, object]) -> str:
    if category not in ALLOWED_TARGETS:
        raise ImprovementError(
            "invalid_target", "target must be a workflow surface; product-code is forbidden"
        )
    excerpt = redact_excerpt(evidence.get("excerpt", evidence.get("text", ""))).lower()
    excerpt = re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27,}", "<uuid>", excerpt)
    excerpt = re.sub(r"\b\d+\b", "<n>", excerpt)
    excerpt = re.sub(r"\s+", " ", excerpt).strip()
    material = "\x1f".join((category, str(evidence.get("event_type", "")).lower(), excerpt))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
