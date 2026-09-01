"""Owner-correct integration between Improvements, Planning, scopes and jobs.

The domain store deliberately knows nothing about Planning tables.  This module
is the narrow service boundary that resolves scopes, supervises background
work, and performs the one approved cross-store operation: idempotently
ensuring an opaque Planning card in the primary database.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unicodedata
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from ..planning import service as planning_service
from ..platform import modules as platform_modules
from ..projects import scopes
from .analyzer_contract import (
    ANALYZER_RESULT_SCHEMA,
    AnalyzerOutputError,
    analyzer_client_argv,
    analyzer_result_parser,
    structured_output_schema,
)

# The HTTP surface reads these two through this module rather than reaching into
# the store itself, so they are deliberate re-exports, not unused imports.
from .contract import ALLOWED_TARGETS as ALLOWED_TARGETS
from .contract import MAX_SIGNAL_PACKET_BYTES as MAX_SIGNAL_PACKET_BYTES
from .contract import ImprovementError
from .evaluation_contract import (
    EvaluationContractError,
    canonical_evaluation_pack,
    evaluation_pack_hash,
)
from .evaluations import EvaluationPreflightError, preflight_repo
from .improvements import ImprovementStore
from .job_supervisor import (
    JobError,
    JobNotFoundError,
    JobSupervisor,
    MemoryJobStore,
)
from .sanitization import redact_excerpt, validated_result_hash
from .sidecar_locks import RuntimeScopeLease

IMPROVEMENT_SOURCE = re.compile(
    r"^improvement://(?P<scope>[a-z][a-z0-9-]{0,31})/(?P<case_key>[A-Za-z0-9._-]{1,100})$"
)
IMPROVEMENT_EPIC_SOURCE = re.compile(r"^improvement://planning/[a-f0-9]{64}/epic$")
MAX_HTTP_BODY = 1_048_576
MAX_CANDIDATE_ROWS = 500
MAX_CANDIDATE_SIGNALS = 100
MAX_CANDIDATE_BYTES = 16_000
MAX_ANALYSIS_PROMPT_CHARS = 24_000
MAX_ANALYZER_ARGV_CHARS = 30_000
PRIVATE_DETAIL_SUMMARY = "[structured session detail withheld]"
_PRIVATE_DETAIL_LABEL = re.compile(
    r"(?i)\b(?:prompt|transcript|messages?|reasoning|chain[-_ ]of[-_ ]thought|"
    r"tool[-_ ]?(?:input|result|output)|stdout|stderr)\b"
)


def resolve_store(primary_db: str, scope_name: str) -> ImprovementStore:
    """Resolve an existing scope before constructing a non-creating store."""
    selected = str(scope_name or "").strip().lower()
    if not selected:
        raise ImprovementError("unknown_scope", "scope is required", 404)
    try:
        scope = scopes.find(primary_db, selected)
    except scopes.ScopeError as error:
        raise ImprovementError("unknown_scope", str(error), 404) from error
    return ImprovementStore(scope["path"], scope["name"])


def _open_scope_readonly(primary_db: str, scope_name: str) -> sqlite3.Connection:
    try:
        return scopes.open_readonly(scopes.find(primary_db, scope_name))
    except scopes.ScopeError as error:
        raise ImprovementError("scope_unavailable", str(error), 422) from error


def _source_item(conn: sqlite3.Connection, space_id: str, source: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM work_items WHERE planning_space_id = ? AND source = ?"
        " ORDER BY number LIMIT 1",
        (space_id, source),
    ).fetchone()


def _validate_existing_planning_item(
    row: sqlite3.Row,
    *,
    space_id: str,
    source: str,
    parent_id: str | None,
) -> None:
    """Refuse to adopt a row that is not the identity this case already owns."""

    if str(row["planning_space_id"]) != space_id or str(row["source"]) != source:
        raise ImprovementError("planning_conflict", "Planning identity is not exact", 409)
    if parent_id is not None and str(row["parent_id"] or "") != parent_id:
        raise ImprovementError("planning_conflict", "Planning parent is not exact", 409)


def ensure_planning_work_items(primary_db: str, request: Mapping[str, object]) -> dict:
    """Ensure the opaque epic and work identities in one immediate transaction.

    Titles, evidence excerpts and fingerprints never cross into Planning. The
    only case identity there is the immutable source marker plus a terse scope
    and case-key description, so the link can be audited without opening raw
    evidence.

    The rows are written through Planning's own service rather than by hand,
    because the initial state, the numbering and the event log are the
    workflow's answers and not this module's.
    """

    space_key = str(request.get("planning_space", "")).strip()
    epic_source = str(request.get("epic_source", "")).strip()
    work_source = str(request.get("work_source", "")).strip()
    scope_name = str(request.get("scope", "")).strip().lower()
    case_key = str(request.get("case_key", "")).strip()
    if not space_key or not epic_source or not work_source:
        raise ImprovementError("planning_invalid", "Planning identity is incomplete")
    expected = f"improvement://{scope_name}/{case_key}"
    if work_source != expected or IMPROVEMENT_SOURCE.fullmatch(work_source) is None:
        raise ImprovementError("planning_invalid", "Planning work source is not canonical")
    if IMPROVEMENT_EPIC_SOURCE.fullmatch(epic_source) is None:
        raise ImprovementError("planning_invalid", "Planning epic source is not canonical")

    conn = sqlite3.connect(primary_db, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        conn.execute("BEGIN IMMEDIATE")
        space = conn.execute(
            "SELECT planning_space_id FROM planning_spaces WHERE key = ?", (space_key,)
        ).fetchone()
        if not space:
            raise ImprovementError(
                "planning_space_not_found",
                f"primary planning space {space_key!r} does not exist",
                422,
            )
        space_id = str(space[0])
        result = _ensure_pair(
            conn, space_id, space_key, epic_source, work_source, scope_name, case_key
        )
        conn.commit()
        return result
    except sqlite3.IntegrityError as error:
        conn.rollback()
        # A racing writer may have committed the same exact source. Retry the
        # lookup once; never invent a second identity or retry arbitrary work.
        conn.execute("BEGIN IMMEDIATE")
        space = conn.execute(
            "SELECT planning_space_id FROM planning_spaces WHERE key = ?", (space_key,)
        ).fetchone()
        epic = _source_item(conn, str(space[0]), epic_source) if space else None
        work = _source_item(conn, str(space[0]), work_source) if space else None
        if not epic or not work:
            conn.rollback()
            raise ImprovementError(
                "planning_conflict", "cannot reconcile Planning identity", 409
            ) from error
        space_id = str(space[0])
        _validate_existing_planning_item(
            epic, space_id=space_id, source=epic_source, parent_id=None
        )
        _validate_existing_planning_item(
            work,
            space_id=space_id,
            source=work_source,
            parent_id=str(epic["work_item_id"]),
        )
        conn.commit()
        return {
            "created": False,
            "created_epic": False,
            "epic_work_item": _reference(space_key, epic),
            "work_item": _reference(space_key, work),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _reference(space_key: str, row: sqlite3.Row) -> str:
    """A reference is the space key and the item's own number, nothing more."""

    return f"{space_key}-{int(row['number'])}"


def _ensure_pair(
    conn: sqlite3.Connection,
    space_id: str,
    space_key: str,
    epic_source: str,
    work_source: str,
    scope_name: str,
    case_key: str,
) -> dict:
    """The epic and its one work item, created only when absent."""

    epic_row = _source_item(conn, space_id, epic_source)
    created_epic = False
    if epic_row is None:
        epic = planning_service.create_work_item(
            conn,
            space=space_key,
            title="Continuous Improvements",
            kind="epic",
            description="Built-in Valkama improvement queue.",
            labels=["improvements"],
            source=epic_source,
            author="improvements",
        )
        epic_reference = str(epic["reference"])
        epic_id = str(epic["work_item_id"])
        created_epic = True
    else:
        _validate_existing_planning_item(
            epic_row, space_id=space_id, source=epic_source, parent_id=None
        )
        epic_reference = _reference(space_key, epic_row)
        epic_id = str(epic_row["work_item_id"])

    work_row = _source_item(conn, space_id, work_source)
    created = False
    if work_row is None:
        work = planning_service.create_work_item(
            conn,
            space=space_key,
            title="Continuous Improvement",
            kind="improvement",
            description=json.dumps(
                {"scope": scope_name, "case_key": case_key},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            labels=["improvements"],
            source=work_source,
            parent=epic_reference,
            author="improvements",
        )
        work_reference = str(work["reference"])
        created = True
    else:
        _validate_existing_planning_item(
            work_row, space_id=space_id, source=work_source, parent_id=epic_id
        )
        work_reference = _reference(space_key, work_row)
    return {
        "created": created,
        "created_epic": created_epic,
        "epic_work_item": epic_reference,
        "work_item": work_reference,
    }


def improvement_guard_for_work_item(
    primary_db: str, source: str, closing_summary: str
) -> dict | None:
    """The frozen closing-guard facts for an Improvements work item."""
    match = IMPROVEMENT_SOURCE.fullmatch(str(source or ""))
    if match is None:
        return None
    store = resolve_store(primary_db, match.group("scope"))
    conn = store.connect()  # read-only integration query; never creates a sidecar
    if conn is None:
        return {
            "allowed": False,
            "guard": "improvement_eval",
            "message": "Improvement work item has no sidecar case record",
        }
    try:
        case = conn.execute(
            "SELECT id,severity FROM cases WHERE case_key=? AND planning_work_item IS NOT NULL",
            (match.group("case_key"),),
        ).fetchone()
        if not case:
            return {
                "allowed": False,
                "guard": "improvement_eval",
                "message": "Improvement work item is not linked to an approved case",
            }
        monitoring = conn.execute(
            "SELECT 1 FROM monitoring WHERE case_id=? LIMIT 1", (case["id"],)
        ).fetchone()
        return store.eval_guard(
            int(case["id"]),
            case["severity"],
            monitoring_started=bool(monitoring),
            closing_summary=closing_summary,
        )
    finally:
        conn.close()


def sync_case_from_work_item(primary_db: str, source: str, category: str) -> str | None:
    """Advance the linked case after a committed transition.

    Keyed on the state's category rather than on its name: a space that renames
    its states, or declares two of a kind, still advances its cases, and the
    Board era's six hard-coded lane names could do neither.
    """
    match = IMPROVEMENT_SOURCE.fullmatch(str(source or ""))
    if match is None:
        return None
    store = resolve_store(primary_db, match.group("scope"))
    conn = store.connect()
    if conn is None:
        return "linked Improvements sidecar is unavailable"
    try:
        row = conn.execute(
            "SELECT id,state FROM cases WHERE case_key=? AND planning_work_item IS NOT NULL",
            (match.group("case_key"),),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return "linked Improvements case is unavailable"
    target = {
        "backlog": "approved",
        "queued": "approved",
        "active": "implementing",
        "review": "validating",
        "completed": "resolved",
    }.get(category)
    if target is None or row["state"] == target:
        return None
    paths = {
        ("approved", "implementing"): ["implementing"],
        ("approved", "validating"): ["implementing", "validating"],
        ("approved", "resolved"): ["implementing", "validating", "resolved"],
        ("implementing", "validating"): ["validating"],
        ("implementing", "resolved"): ["validating", "resolved"],
        ("validating", "resolved"): ["resolved"],
    }
    steps = paths.get((row["state"], target))
    if steps is None:
        return f"case state {row['state']} cannot follow a {category} state"
    for state in steps:
        store.transition(int(row["id"]), state, f"work item entered a {category} state")
    return None


def _safe_session_detail(value: object, event_type: str, status: str) -> str:
    """Keep only an ordinary diagnostic scalar; structured/private bodies are opaque."""
    fallback = redact_excerpt(f"{event_type}:{status or 'event'}")
    if isinstance(value, (Mapping, list, tuple)):
        return PRIVATE_DETAIL_SUMMARY
    text = str(value or "").strip()
    if not text:
        return fallback
    try:
        parsed = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        parsed = None
    if isinstance(parsed, (Mapping, list)) or _PRIVATE_DETAIL_LABEL.search(text):
        return PRIVATE_DETAIL_SUMMARY
    return redact_excerpt(text)


def _exact_event_fingerprint(event_type: object, status: object, excerpt: object) -> str:
    """Category-independent identity for exact failures, computed before analysis."""
    normalized = [
        " ".join(unicodedata.normalize("NFKC", str(value or "")).split()).casefold()
        for value in (event_type, status, excerpt)
    ]
    body = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _windows_argv_units(argv: list[str]) -> int:
    """Return the Windows command-line length in UTF-16 code units."""
    return len(subprocess.list2cmdline(argv).encode("utf-16-le")) // 2


class ImprovementsRuntime:
    """One in-process supervisor for all explicitly enabled scopes."""

    def __init__(
        self,
        wake: Callable[[str], object] | None = None,
        module_enabled: Callable[[str], bool] | None = None,
    ) -> None:
        self._wake = wake or (lambda _message: None)
        self._module_enabled = module_enabled or (lambda _primary_db: True)
        self._memory = MemoryJobStore()
        self._supervisor = JobSupervisor(
            self._memory,
            event_callback=self._on_job_event,
            reserve_job=lambda _scope, _kind, _job: True,
            job_loader=self._load_supervisor_record,
        )
        self._bindings: dict[str, dict[str, object]] = {}
        self._scope_leases: dict[str, dict[str, object]] = {}
        self._notified: set[tuple[str, str]] = set()
        self._disable_requests: set[str] = set()
        self._disabled_primary: set[str] = set()
        self._lock = threading.RLock()
        self._admission_fence = threading.RLock()
        self._stopped = False
        self._stop = threading.Event()

    def _require_accepting_work(self) -> None:
        if self._stopped:
            raise ImprovementError("runtime_stopped", "Improvements runtime is stopped", 409)

    def _require_module_enabled(self, primary_db: str) -> None:
        with self._lock:
            disabled = os.path.abspath(primary_db) in self._disabled_primary
        if disabled:
            raise ImprovementError("module_disabled", "Improvements module is disabled", 409)
        if not self._module_enabled(primary_db):
            raise ImprovementError("module_disabled", "Improvements module is disabled", 409)

    def module_state_changed(self, primary_db: str, state: str) -> None:
        """Fence new work and stop only jobs owned by this runtime on disable."""

        primary = os.path.abspath(primary_db)
        with platform_modules.module_state_fence(primary, "improvements"):
            with self._lock:
                if state == "enabled":
                    self._disabled_primary.discard(primary)
                    return
                self._disabled_primary.add(primary)
                identifiers = [
                    identifier
                    for identifier, binding in self._bindings.items()
                    if os.path.abspath(str(binding["primary_db"])) == primary
                    and identifier not in self._disable_requests
                ]
                self._disable_requests.update(identifiers)
            for identifier in identifiers:
                try:
                    self._supervisor.cancel(identifier)
                except (JobError, OSError):
                    # The stable request marker prevents duplicate cancellation;
                    # reap keeps reconciling whatever state the supervisor observes.
                    continue

    @staticmethod
    def _scope_lease_key(store: ImprovementStore) -> str:
        return str(store.path.resolve())

    def _retain_scope_lease(
        self,
        store: ImprovementStore,
        *,
        required: bool = True,
        reuse: bool = True,
    ) -> str | None:
        key = self._scope_lease_key(store)
        with self._lock:
            current = self._scope_leases.get(key)
            if current is not None:
                if not reuse:
                    return None
                current["count"] = int(current["count"]) + 1
                return key
            lease = RuntimeScopeLease.acquire(store.path)
            if lease is None:
                if required:
                    raise ImprovementError(
                        "runtime_busy",
                        "another Improvements runtime owns active jobs for this scope",
                        409,
                    )
                return None
            self._scope_leases[key] = {"lease": lease, "count": 1}
            return key

    def _release_scope_lease(self, key: object) -> None:
        if not key:
            return
        lease = None
        with self._lock:
            current = self._scope_leases.get(str(key))
            if current is None:
                return
            remaining = int(current["count"]) - 1
            if remaining > 0:
                current["count"] = remaining
                return
            lease = current["lease"]
            self._scope_leases.pop(str(key), None)
        lease.close()

    def _load_supervisor_record(self, record: Mapping[str, Any]) -> Mapping[str, Any] | None:
        """Reject free-form persisted commands; reload only a sidecar recipe."""
        metadata = record.get("metadata")
        if not isinstance(metadata, Mapping):
            return None
        primary_db = str(metadata.get("primary_db", ""))
        scope_name = str(record.get("scope", ""))
        sidecar_job_id = metadata.get("sidecar_job_id")
        if not primary_db or not isinstance(sidecar_job_id, int):
            return None
        request = resolve_store(primary_db, scope_name).load_job_request(sidecar_job_id)
        return dict(record) | {"metadata": dict(metadata) | {"recipe": request}}

    def _session_event(self, primary_db: str, event: Mapping[str, object]) -> None:
        action = str(event.get("action", ""))
        session_id = f"improvements:{event.get('scope')}:{event.get('job_id')}"
        status = "failed" if action == "failed" else ("cancelled" if action == "cancelled" else "")
        conn = sqlite3.connect(primary_db, timeout=5)
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute(
                "INSERT INTO sessions(id,client,label,status) VALUES(?,?,?,'active')"
                " ON CONFLICT(id) DO UPDATE SET last_seen=strftime('%Y-%m-%dT%H:%M:%SZ','now')",
                (
                    session_id,
                    str(event.get("client", "platform")),
                    f"Improvements {event.get('kind')}",
                ),
            )
            if action in {"succeeded", "failed", "cancelled"}:
                conn.execute(
                    "UPDATE sessions SET status=?,attention=?,ended_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                    ("ended" if action == "succeeded" else "failed", status or action, session_id),
                )
            conn.execute(
                "INSERT INTO session_events(session_id,klass,kind,status,detail) VALUES(?, 'analytics','tool_end',?,?)",
                (
                    session_id,
                    action,
                    json.dumps(
                        {
                            "module": "improvements",
                            "scope": event.get("scope"),
                            "job": event.get("job_id"),
                        },
                        separators=(",", ":"),
                    ),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def _cleanup_binding(self, binding: Mapping[str, object]) -> None:
        for name in binding.get("temp_paths", ()):
            with contextlib.suppress(FileNotFoundError):
                os.remove(str(name))

    def _on_job_event(self, event: dict[str, object]) -> None:
        identifier = str(event["job_id"])
        try:
            self._reconcile_identifier(identifier, event)
        except Exception:
            # Notifications never own lifecycle authority. Runtime.reap retries
            # sidecar/session persistence and cleanup from the supervisor state.
            return

    def _reconcile_identifier(
        self, identifier: str, event: Mapping[str, object] | None = None
    ) -> bool:
        with self._lock:
            binding = self._bindings.get(identifier)
        summary = self._memory.get_job(identifier)
        if binding is None or summary is None:
            return False
        primary_db = str(binding["primary_db"])
        store = resolve_store(primary_db, str(summary["scope"]))
        sidecar_id = int(binding["sidecar_job_id"])
        sidecar = next((item for item in store.jobs() if item["id"] == sidecar_id), None)
        if sidecar is None:
            return False
        state = str(summary["state"])
        if state == "running" and sidecar["state"] == "queued":
            sidecar = store.update_job(sidecar_id, "running")
        elif state in {"failed", "cancelled"} and sidecar["state"] not in {
            "succeeded",
            "failed",
            "cancelled",
        }:
            sidecar = store.update_job(
                sidecar_id,
                state,
                error_code=str(summary.get("error_code", "")),
                result_summary=json.dumps(
                    summary.get("result_summary", {}),
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            )
        if state == "succeeded" and sidecar["state"] != "succeeded":
            return False
        if state in {"failed", "cancelled"} and sidecar["state"] != state:
            return False
        action = str((event or {}).get("action") or ({"running": "started"}.get(state, state)))
        notice = dict(event or {}) | {
            "job_id": identifier,
            "scope": summary["scope"],
            "kind": summary["kind"],
            "client": summary.get("client", "platform"),
            "action": action,
            "state": state,
            "error_code": summary.get("error_code", ""),
        }
        key = (identifier, action)
        if key not in self._notified:
            self._session_event(primary_db, notice)
            self._notified.add(key)
        self._wake("changed")
        if state in {"succeeded", "failed", "cancelled"}:
            self._cleanup_binding(binding)
            with self._lock:
                self._bindings.pop(identifier, None)
                self._disable_requests.discard(identifier)
            self._release_scope_lease(binding.get("lease_key"))
        return True

    @staticmethod
    def _candidate_signals(
        primary_db: str, scope_name: str, profile: Mapping[str, object]
    ) -> list[dict]:
        limits = profile["limits"]
        lookback = max(1, min(int(limits["lookback_days"]), 365))
        max_sessions = max(1, min(int(limits["max_sessions"]), MAX_CANDIDATE_SIGNALS))
        max_bytes = max(1, min(int(limits["max_chars"]), MAX_CANDIDATE_BYTES))
        cutoff = (datetime.now(UTC) - timedelta(days=lookback)).isoformat()
        store = resolve_store(primary_db, scope_name)
        persisted = store.analysis_signal_candidates(since=cutoff, limit=MAX_CANDIDATE_SIGNALS)
        selected: list[dict] = []
        sessions: set[str] = set()
        pointers: set[str] = set()

        def append(item: dict) -> bool:
            if len(selected) >= MAX_CANDIDATE_SIGNALS:
                return False
            session_id = str(item.get("session_id", ""))
            if (
                item.get("source_kind") == "session_event"
                and session_id not in sessions
                and len(sessions) >= max_sessions
            ):
                return True
            candidate = [*selected, item]
            if len(json.dumps(candidate, ensure_ascii=False).encode("utf-8")) > max_bytes:
                return False
            selected.append(item)
            pointers.add(str(item["pointer"]))
            if item.get("source_kind") == "session_event" and session_id:
                sessions.add(session_id)
            return True

        for item in persisted:
            if not append(dict(item) | {"status": "recorded"}):
                return selected

        conn = _open_scope_readonly(primary_db, scope_name)
        try:
            rows = conn.execute(
                "SELECT e.id,e.session_id,e.kind,e.status,e.detail,e.created_at,s.client"
                " FROM session_events e JOIN sessions s ON s.id=e.session_id"
                " WHERE e.created_at>=? AND (lower(e.status) IN ('error','failed','blocked')"
                " OR e.kind IN ('attention','session_end')) ORDER BY e.id DESC LIMIT ?",
                (cutoff, MAX_CANDIDATE_ROWS),
            ).fetchall()
            for row in rows:
                pointer = f"session:{row['session_id']}/event:{row['id']}"
                if pointer in pointers:
                    continue
                if len(selected) >= MAX_CANDIDATE_SIGNALS:
                    break
                excerpt = _safe_session_detail(row["detail"], row["kind"], row["status"])
                item = {
                    "id": int(row["id"]),
                    "pointer": pointer,
                    "source_kind": "session_event",
                    "at": row["created_at"],
                    "client": row["client"],
                    "session_id": row["session_id"],
                    "event_type": row["kind"],
                    "status": str(row["status"] or "").lower(),
                    "severity": "high"
                    if str(row["status"]).lower() in {"failed", "error"}
                    else "medium",
                    "excerpt": excerpt,
                    "exact_fingerprint": _exact_event_fingerprint(
                        row["kind"], row["status"], excerpt
                    ),
                }
                if not append(item):
                    break
            return selected
        finally:
            conn.close()

    @staticmethod
    def _analysis_prompt(
        scope_name: str, profile: Mapping[str, object], signals: list[dict]
    ) -> str:
        payload = [
            {
                key: item[key]
                for key in (
                    "id",
                    "source_kind",
                    "category",
                    "existing_case_id",
                    "event_type",
                    "status",
                    "severity",
                    "excerpt",
                    "exact_fingerprint",
                )
                if key in item
            }
            for item in signals
        ]
        groups: dict[str, list[int]] = {}
        for item in signals:
            groups.setdefault(str(item["exact_fingerprint"]), []).append(int(item["id"]))
        grouped_payload = {
            "signals": payload,
            "exact_groups": [
                {"exact_fingerprint": fingerprint, "signal_ids": identifiers}
                for fingerprint, identifiers in sorted(groups.items())
            ],
        }
        prompt = (
            "Analyze only the supplied redacted workflow-failure signals. Return JSON matching the supplied schema. "
            "Use only allowed workflow categories; never propose product code. signal_ids must refer to supplied ids. "
            "Preserve every supplied category and source_kind provenance. Keep each existing_case_id together and do not combine different values. "
            "Every supplied signal_id must appear exactly once. Exact fingerprint groups are indivisible and must map to one case. "
            "Use one stable case_key per semantic cluster; it must match [A-Za-z0-9._-]{1,100}. "
            "Every case must include a bounded workflow proposal and deterministic EvaluationPack. "
            f"Scope: {scope_name}. Purpose: {profile['purpose']}. Expected behavior: {profile['expected_behavior']}. "
            "Input: " + json.dumps(grouped_payload, ensure_ascii=False, separators=(",", ":"))
        )
        if len(prompt) > MAX_ANALYSIS_PROMPT_CHARS:
            raise ImprovementError(
                "analysis_prompt_too_large", "bounded analyzer prompt exceeds the safe limit", 422
            )
        return prompt

    def queue_analysis(self, primary_db: str, scope_name: str, trigger: str) -> dict:
        with self._admission_fence:
            self._require_accepting_work()
            with platform_modules.module_state_fence(primary_db, "improvements"):
                return self._queue_analysis(primary_db, scope_name, trigger)

    def _queue_analysis(self, primary_db: str, scope_name: str, trigger: str) -> dict:
        self._require_module_enabled(primary_db)
        store = resolve_store(primary_db, scope_name)
        queue_lease = self._retain_scope_lease(store)
        try:
            sidecar_job = store.create_job("analysis", trigger, recipe_id="improvements.analysis")
            try:
                return self._dispatch_analysis(primary_db, store, sidecar_job, trigger)
            except Exception as error:
                current = next(
                    (item for item in store.jobs() if item["id"] == sidecar_job["id"]), None
                )
                if current is not None and current["state"] == "queued":
                    code = (
                        error.code
                        if isinstance(error, ImprovementError)
                        else "analysis_preflight_failed"
                    )
                    store.update_job(int(sidecar_job["id"]), "failed", error_code=str(code)[:100])
                raise
        finally:
            self._release_scope_lease(queue_lease)

    def _dispatch_analysis(
        self,
        primary_db: str,
        store: ImprovementStore,
        sidecar_job: Mapping[str, object],
        trigger: str,
    ) -> dict:
        self._require_module_enabled(primary_db)
        scope_name = store.scope
        profile = store.profile()
        signals = self._candidate_signals(primary_db, scope_name, profile)
        prompt = self._analysis_prompt(scope_name, profile, signals)
        schema_file = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        result_path = ""
        paths = [schema_file.name]
        lease_key = None
        try:
            lease_key = self._retain_scope_lease(store)
            json.dump(
                structured_output_schema(ANALYZER_RESULT_SCHEMA),
                schema_file,
                separators=(",", ":"),
            )
            schema_file.close()
            if profile["analyzer_client"] == "codex":
                handle = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
                result_path = handle.name
                handle.close()
                paths.append(result_path)
            argv = analyzer_client_argv(
                profile["analyzer_client"],
                prompt,
                schema_path=schema_file.name,
                result_path=result_path,
                model=profile["analyzer_model"],
                effort=profile["reasoning_effort"],
            )
            if _windows_argv_units(argv) >= MAX_ANALYZER_ARGV_CHARS:
                raise ImprovementError(
                    "analysis_argv_too_large",
                    "bounded analyzer command exceeds the safe limit",
                    422,
                )
            signal_by_id = {item["id"]: item for item in signals}

            def apply_result(result: dict[str, Any], _job: object) -> dict:
                try:
                    assignment: dict[int, int] = {}
                    for cluster_index, cluster in enumerate(result["cases"]):
                        ids = cluster.get("signal_ids", [])
                        if any(item not in signal_by_id for item in ids):
                            raise AnalyzerOutputError("analyzer returned an unknown signal id")
                        if any(item in assignment for item in ids):
                            raise AnalyzerOutputError(
                                "analyzer assigned a signal id more than once"
                            )
                        assignment.update(dict.fromkeys(ids, cluster_index))
                    if set(assignment) != set(signal_by_id):
                        raise AnalyzerOutputError(
                            "analyzer must assign every supplied signal id exactly once"
                        )
                    exact_groups: dict[str, set[int]] = {}
                    for signal_id, cluster_index in assignment.items():
                        exact_groups.setdefault(
                            str(signal_by_id[signal_id]["exact_fingerprint"]), set()
                        ).add(cluster_index)
                    if any(len(cluster_indexes) != 1 for cluster_indexes in exact_groups.values()):
                        raise AnalyzerOutputError("analyzer split an exact fingerprint group")
                    existing_groups: dict[int, set[int]] = {}
                    for signal_id, cluster_index in assignment.items():
                        existing = signal_by_id[signal_id].get("existing_case_id")
                        if existing is not None:
                            existing_groups.setdefault(int(existing), set()).add(cluster_index)
                    if any(
                        len(cluster_indexes) != 1 for cluster_indexes in existing_groups.values()
                    ):
                        raise AnalyzerOutputError("analyzer split an existing case")
                    for cluster in result["cases"]:
                        members = [signal_by_id[item] for item in cluster.get("signal_ids", [])]
                        fixed_categories = {
                            str(item["category"]) for item in members if item.get("category")
                        }
                        if fixed_categories and fixed_categories != {cluster["category"]}:
                            raise AnalyzerOutputError(
                                "analyzer changed a persisted signal category"
                            )
                        existing_cases = {
                            int(item["existing_case_id"])
                            for item in members
                            if item.get("existing_case_id") is not None
                        }
                        if len(existing_cases) > 1:
                            raise AnalyzerOutputError("analyzer combined different existing cases")
                    validated = {
                        "signals": [
                            {
                                "id": str(signal_id),
                                "category": signal_by_id[signal_id].get("category")
                                or cluster["category"],
                                "title": cluster["title"],
                                "evidence": {
                                    key: value
                                    for key, value in signal_by_id[signal_id].items()
                                    if key
                                    in {
                                        "pointer",
                                        "at",
                                        "client",
                                        "session_id",
                                        "source_kind",
                                        "event_type",
                                        "severity",
                                        "excerpt",
                                    }
                                },
                            }
                            for cluster in result["cases"]
                            for signal_id in cluster.get("signal_ids", [])
                        ],
                        "cases": [
                            {
                                "cluster_key": cluster["case_key"],
                                "case_key": cluster["case_key"],
                                "category": cluster["category"],
                                "title": cluster["title"],
                                "signal_ids": [
                                    str(signal_id) for signal_id in cluster.get("signal_ids", [])
                                ],
                                "proposal": cluster["proposal"],
                                "evaluation_pack": cluster["evaluation_pack"],
                            }
                            for cluster in result["cases"]
                        ],
                        "case_mutations": [],
                    }
                    digest = validated_result_hash(validated)
                    return store.apply_analyzer_result(int(sidecar_job["id"]), digest, validated)
                except ImprovementError as error:
                    raise AnalyzerOutputError(str(error)) from error

            identifier = f"{scope_name}:analysis:{sidecar_job['id']}"
            with platform_modules.module_state_fence(primary_db, "improvements"):
                self._require_module_enabled(primary_db)
                with self._lock:
                    self._bindings[identifier] = {
                        "primary_db": primary_db,
                        "sidecar_job_id": sidecar_job["id"],
                        "kind": "analysis",
                        "trigger": trigger,
                        "temp_paths": paths,
                        "lease_key": lease_key,
                    }
                self._require_module_enabled(primary_db)
                self._supervisor.queue(
                    scope_name,
                    "analysis",
                    profile["analyzer_client"],
                    argv,
                    timeout_seconds=900,
                    result_parser=analyzer_result_parser(ANALYZER_RESULT_SCHEMA),
                    result_handler=apply_result,
                    result_path=result_path,
                    job_id=identifier,
                )
                self._require_module_enabled(primary_db)
                self._supervisor.start(identifier)
            return store.jobs()[0]
        except Exception as error:
            schema_file.close()
            with contextlib.suppress(JobError):
                self._supervisor.cancel(f"{scope_name}:analysis:{sidecar_job['id']}")
            self._cleanup_binding({"temp_paths": paths})
            with self._lock:
                self._bindings.pop(f"{scope_name}:analysis:{sidecar_job['id']}", None)
            self._release_scope_lease(lease_key)
            current = next((item for item in store.jobs() if item["id"] == sidecar_job["id"]), None)
            if current is not None and current["state"] in {"queued", "running"}:
                code = error.code if isinstance(error, ImprovementError) else "launch_failed"
                state = "cancelled" if code == "module_disabled" else "failed"
                store.update_job(sidecar_job["id"], state, error_code=code)
            if isinstance(error, (ImprovementError, JobError)):
                raise
            raise ImprovementError("launch_failed", str(error), 422) from error

    def queue_eval(self, primary_db: str, payload: Mapping[str, object]) -> dict:
        with self._admission_fence:
            self._require_accepting_work()
            with platform_modules.module_state_fence(primary_db, "improvements"):
                return self._queue_eval(primary_db, payload)

    def _queue_eval(self, primary_db: str, payload: Mapping[str, object]) -> dict:
        self._require_module_enabled(primary_db)
        scope_name = str(payload.get("scope", ""))
        store = resolve_store(primary_db, scope_name)
        case_id = int(payload.get("case_id", 0))
        phase = str(payload.get("phase", ""))
        raw_repo = str(payload.get("repo", "")).strip()
        repo = os.path.abspath(raw_repo) if raw_repo else ""
        git_ref = str(payload.get("git_ref", ""))
        if (
            phase not in {"baseline", "candidate"}
            or not repo
            or not os.path.isabs(raw_repo)
            or not git_ref
        ):
            raise ImprovementError(
                "invalid_eval", "eval requires scope, case_id, phase, repo and git_ref"
            )
        try:
            source = preflight_repo(repo, git_ref)
        except EvaluationPreflightError as error:
            raise ImprovementError("invalid_eval", str(error)) from error
        repo, git_ref = source["repo"], source["git_ref"]
        queue_lease = self._retain_scope_lease(store)
        try:
            sidecar_job = store.create_job(
                "eval",
                recipe_id="improvements.eval.v1",
                case_id=case_id,
                phase=phase,
                repo=repo,
                git_ref=git_ref,
            )
            return self._dispatch_eval(primary_db, store, sidecar_job)
        finally:
            self._release_scope_lease(queue_lease)

    def _dispatch_eval(
        self,
        primary_db: str,
        store: ImprovementStore,
        sidecar_job: Mapping[str, object],
    ) -> dict:
        self._require_module_enabled(primary_db)
        scope_name = store.scope
        loaded = store.load_job_request(int(sidecar_job["id"]))
        if loaded["kind"] != "eval":
            raise ImprovementError("invalid_job_recipe", "persisted job is not an eval recipe")
        request = loaded["request"]
        case_id = int(request["case_id"])
        phase = str(request["phase"])
        repo = str(request["repo"])
        git_ref = str(request["git_ref"])
        detail = store.case(case_id)
        pack = detail.get("evaluation_pack")
        if not pack:
            raise ImprovementError("evaluation_pack_required", "case has no EvaluationPack")
        if (
            pack.get("pack_revision") != request["pack_revision"]
            or pack.get("version") != request["pack_version"]
            or pack.get("pack_hash") != request["pack_hash"]
        ):
            raise ImprovementError(
                "invalid_eval", "queued EvaluationPack no longer matches the case"
            )
        try:
            runner_pack = canonical_evaluation_pack(
                {
                    key: pack[key]
                    for key in (
                        "interface_version",
                        "version",
                        "scenarios",
                        "assertions",
                        "provenance",
                        "failure_examples",
                        "negative_control",
                    )
                }
            )
        except (EvaluationContractError, KeyError, TypeError) as error:
            raise ImprovementError("invalid_eval", "persisted EvaluationPack is invalid") from error
        if evaluation_pack_hash(runner_pack) != request["pack_hash"]:
            raise ImprovementError("invalid_eval", "queued EvaluationPack hash does not match")
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        job_input = handle.name
        json.dump(
            {
                "job_id": sidecar_job["id"],
                "pack": runner_pack,
                "repo": repo,
                "git_ref": git_ref,
                "phase": phase,
                "pack_version": request["pack_version"],
                "pack_hash": request["pack_hash"],
            },
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        handle.close()

        def save_result(result: dict[str, Any], _job: object) -> dict:
            recorded = store.record_eval_run(
                case_id,
                phase,
                repo,
                git_ref,
                result,
                patch_hash=str(result.get("patch_hash") or "") or None,
                job_id=int(sidecar_job["id"]),
            )
            persisted = json.loads(recorded["result_json"])
            return {
                "eval_run_id": recorded["id"],
                "phase": phase,
                "passed": bool(persisted.get("passed")),
                "result_hash": persisted["result_hash"],
            }

        identifier = f"{scope_name}:eval:{sidecar_job['id']}"
        worker = os.path.join(os.path.dirname(__file__), "improvements_eval_worker.py")
        lease_key = None
        try:
            lease_key = self._retain_scope_lease(store)
            with platform_modules.module_state_fence(primary_db, "improvements"):
                self._require_module_enabled(primary_db)
                with self._lock:
                    self._bindings[identifier] = {
                        "primary_db": primary_db,
                        "sidecar_job_id": sidecar_job["id"],
                        "kind": "eval",
                        "case_id": case_id,
                        "phase": phase,
                        "repo": repo,
                        "git_ref": git_ref,
                        "temp_paths": [job_input],
                        "lease_key": lease_key,
                    }
                self._require_module_enabled(primary_db)
                self._supervisor.queue(
                    scope_name,
                    "eval",
                    "platform",
                    [sys.executable, worker, job_input],
                    timeout_seconds=1800,
                    result_handler=save_result,
                    job_id=identifier,
                )
                self._require_module_enabled(primary_db)
                self._supervisor.start(identifier)
            return store.jobs()[0]
        except Exception as error:
            with contextlib.suppress(JobError):
                self._supervisor.cancel(f"{scope_name}:eval:{sidecar_job['id']}")
            self._cleanup_binding({"temp_paths": [job_input]})
            with self._lock:
                self._bindings.pop(f"{scope_name}:eval:{sidecar_job['id']}", None)
            self._release_scope_lease(lease_key)
            current = next((item for item in store.jobs() if item["id"] == sidecar_job["id"]), None)
            if current is not None and current["state"] in {"queued", "running"}:
                code = error.code if isinstance(error, ImprovementError) else "launch_failed"
                state = "cancelled" if code == "module_disabled" else "failed"
                store.update_job(sidecar_job["id"], state, error_code=code)
            if isinstance(error, (ImprovementError, JobError)):
                raise
            raise ImprovementError("launch_failed", str(error), 422) from error

    def record_signals(self, primary_db: str, payload: Mapping[str, object]) -> dict:
        """Record one bounded signal packet for an enabled scope.

        Session-event pointers are verified against the sessions the store
        actually holds before anything is written: a signal claiming an event
        that does not exist is a claim about evidence, and the sanitizers cannot
        check it because the answer is not in the packet.
        """

        scope_name = str(payload.get("scope", ""))
        store = resolve_store(primary_db, scope_name)
        if not store.profile()["enabled"]:
            raise ImprovementError("improvements_disabled", "Improvements is disabled")
        verified: set[tuple[str, str]] = set()
        raw_signals = payload.get("signals")
        if isinstance(raw_signals, list):
            candidates: list[tuple[str, str, int]] = []
            for raw in raw_signals:
                if not isinstance(raw, Mapping) or raw.get("source_kind") != "session_event":
                    continue
                pointer, session_id = (
                    str(raw.get("pointer", "")),
                    str(raw.get("session_id", "")),
                )
                match = re.fullmatch(r"session:([^/\s]{1,200})/event:([1-9][0-9]*)", pointer)
                if match and match.group(1) == session_id:
                    candidates.append((pointer, session_id, int(match.group(2))))
            if candidates:
                conn = _open_scope_readonly(primary_db, store.scope)
                try:
                    for pointer, session_id, event_id in candidates:
                        exists = conn.execute(
                            "SELECT 1 FROM session_events e JOIN sessions s ON s.id=e.session_id"
                            " WHERE e.id=? AND e.session_id=? AND s.id=?",
                            (event_id, session_id, session_id),
                        ).fetchone()
                        if exists:
                            verified.add((pointer, session_id))
                finally:
                    conn.close()
        result = store.record_signal_packet(payload, verified_session_events=verified)
        self._wake("changed")
        return result

    def act_on_case(self, primary_db: str, case_id: int, payload: Mapping[str, object]) -> dict:
        """Apply one reviewed action to one case."""

        store = resolve_store(primary_db, str(payload.get("scope", "")))
        result = store.action(
            case_id,
            str(payload.get("action", "")),
            int(payload.get("expected_revision", -1)),
            reason=str(payload.get("reason", "")),
            target_case_id=payload.get("target_case_id"),
            signal_ids=payload.get("signal_ids", ()),
            snooze_until=payload.get("snooze_until"),
            ensure_planning_card=lambda request: ensure_planning_work_items(primary_db, request),
        )
        self._wake("changed")
        return result

    def set_profile(self, primary_db: str, payload: Mapping[str, object]) -> dict:
        """Revise one scope's profile, merging what the caller did not send."""

        store = resolve_store(primary_db, str(payload.get("scope", "")))
        current = store.profile()
        values = dict(current)
        values.update(payload)
        values["schedule"] = dict(current["schedule"]) | dict(payload.get("schedule", {}))
        values["limits"] = dict(current["limits"]) | dict(payload.get("limits", {}))
        result = store.put_profile(values, int(payload.get("expected_revision", -1)))
        self._wake("changed")
        return result

    def reap(self) -> list[dict]:
        try:
            finished = self._supervisor.reap()
        except Exception:
            # A result-handler persistence failure leaves the supervisor job
            # running, so the next reap retries the exact stable result.
            finished = []
        with self._lock:
            identifiers = list(self._bindings)
        for identifier in identifiers:
            try:
                self._reconcile_identifier(identifier)
            except Exception:  # noqa: S112
                # One binding that cannot reconcile must not stop the others,
                # and the failure stays visible in the module read model.
                continue
        return finished

    def cancel_job(self, primary_db: str, scope_name: str, job_id: int) -> dict:
        store = resolve_store(primary_db, scope_name)
        persisted = next((item for item in store.jobs() if item["id"] == job_id), None)
        if persisted is None:
            raise ImprovementError("job_not_found", "job not found", 404)
        if persisted["state"] in {"succeeded", "failed", "cancelled"}:
            return persisted
        identifier = f"{store.scope}:{persisted['kind']}:{job_id}"
        with self._lock:
            active = identifier in self._bindings
        if active:
            try:
                self._supervisor.cancel(identifier)
            except JobNotFoundError:
                # The supervisor already finished this job and swept it from its
                # runtime table, so what is still owed is the sidecar
                # reconciliation below rather than a second termination.
                pass
            self._reconcile_identifier(identifier)
            return next(item for item in store.jobs() if item["id"] == job_id)
        if persisted["state"] == "running":
            raise ImprovementError(
                "job_not_active", "running job is not owned by this Platform process", 409
            )
        cancelled = store.update_job(job_id, "cancelled", error_code="cancelled")
        self._session_event(
            primary_db,
            {
                "job_id": identifier,
                "scope": store.scope,
                "kind": persisted["kind"],
                "client": persisted["client"],
                "action": "cancelled",
                "state": "cancelled",
                "error_code": "cancelled",
            },
        )
        self._wake("changed")
        return cancelled

    def recover(self, primary_db: str) -> dict:
        """Fail orphan running jobs and safely reconstruct every queued recipe."""

        with self._admission_fence:
            self._require_accepting_work()
            with platform_modules.module_state_fence(primary_db, "improvements"):
                self._require_module_enabled(primary_db)
                recovered = 0
                resumed = 0
                for scope in scopes.load(primary_db):
                    store = ImprovementStore(scope["path"], scope["name"])
                    if not store.path.exists() or not store.profile()["enabled"]:
                        continue
                    recovery_lease = self._retain_scope_lease(store, required=False, reuse=False)
                    if recovery_lease is None:
                        continue
                    try:
                        recovered += store.recover_jobs()
                        for job in reversed(store.jobs()):
                            if job["state"] != "queued":
                                continue
                            request = store.load_job_request(int(job["id"]))
                            values = request["request"]
                            try:
                                if request["kind"] == "analysis":
                                    self._dispatch_analysis(
                                        primary_db, store, job, str(values["trigger"])
                                    )
                                else:
                                    self._dispatch_eval(primary_db, store, job)
                                resumed += 1
                            except ImprovementError as error:
                                current = next(
                                    (item for item in store.jobs() if item["id"] == job["id"]),
                                    None,
                                )
                                if current and current["state"] in {"queued", "running"}:
                                    store.update_job(
                                        int(job["id"]), "failed", error_code=error.code
                                    )
                    finally:
                        self._release_scope_lease(recovery_lease)
                return {"running_failed": recovered, "queued_resumed": resumed}

    def run(self, primary_db: str, interval: float = 0.4) -> None:
        """Reap jobs and enqueue only profiles explicitly set to scheduled."""
        with contextlib.suppress(Exception):
            self.recover(primary_db)
        while not self._stop.wait(interval):
            try:
                if not self._module_enabled(primary_db):
                    self.module_state_changed(primary_db, "disabled")
                    self.reap()
                    continue
                primary = os.path.abspath(primary_db)
                if primary in self._disabled_primary:
                    self._disabled_primary.discard(primary)
                    self.recover(primary_db)
                self.reap()
                for scope in scopes.load(primary_db):
                    store = ImprovementStore(scope["path"], scope["name"])
                    profile = store.profile()
                    if not profile["enabled"] or profile["schedule"]["mode"] != "scheduled":
                        continue
                    latest = store.jobs()
                    if latest:
                        created = datetime.fromisoformat(latest[0]["created_at"])
                        due = created + timedelta(hours=int(profile["schedule"]["interval_hours"]))
                        if datetime.now(UTC) < due:
                            continue
                    try:
                        self.queue_analysis(primary_db, scope["name"], "scheduled")
                    except ImprovementError as error:
                        if error.status != 409:
                            raise
            except Exception:  # noqa: S112
                # The server stays available; persisted job/profile errors remain
                # visible through the module read model.
                continue

    def stop(self) -> None:
        """Stop admission, cancel owned work once, and reconcile durable state."""

        with self._admission_fence:
            if self._stopped:
                return
            self._stopped = True
            self._stop.set()
            with self._lock:
                identifiers = [
                    identifier
                    for identifier in self._bindings
                    if identifier not in self._disable_requests
                ]
                self._disable_requests.update(identifiers)
            for identifier in identifiers:
                with contextlib.suppress(JobError, OSError):
                    self._supervisor.cancel(identifier)
            self.reap()
            with self._lock:
                remaining = list(self._bindings)
            for identifier in remaining:
                with contextlib.suppress(Exception):
                    self._reconcile_identifier(identifier)
            self._supervisor.join_readers(timeout=1)
