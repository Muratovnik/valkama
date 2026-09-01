"""Per-scope storage and deterministic domain rules for Improvements.

This module is deliberately independent of the planning schema.  A caller first
resolves a scope to its store and then constructs one bound sidecar.
Planning writes are possible only through the callback accepted by ``approve``.

Three things this module used to hold now live beside it, because each changes
on its own schedule: `sidecar_locks` owns the cross-process locks, which change
when locking does; `sidecar_schema` owns the tables, the migration and the
restore, which change on every schema bump; and `sanitization` owns the pure
shape rules of the published contract, which change when that contract's payload
shape does.  `contract` holds the vocabulary all four share.  What is left here
is the aggregate that writes: the profile, the case lifecycle, the job and eval
ledgers, and the monitoring — plus `improvement_eval_guard`, which stays a free
function over plain data.

Imports run one way: this module reads those four, and none of them reads it.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import uuid
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .contract import (
    ALLOWED_TARGETS,
    API_VERSION,
    EVENTS_VERSION,
    MAX_SIGNAL_COUNT,
    SEVERITIES,
    SOURCE_KINDS,
    STATES,
    ImprovementError,
)
from .evaluation_contract import (
    EvaluationContractError,
    canonical_evaluation_pack,
    evaluation_pack_hash,
)
from .sanitization import (
    bounded_text,
    canonical_json,
    deterministic_fingerprint,
    evidence_record,
    parse_timestamp,
    sanitize_analyzer_result,
    sanitize_eval_result,
    sanitize_evaluation_pack,
    sanitize_proposal,
    sanitize_signal_packet,
    utc_now,
)
from .sidecar_locks import maintenance_lease
from .sidecar_schema import (
    SCHEMA_VERSION,
    migrate_sidecar,
    migrate_sidecar_locked,
    sidecar_version,
)

JOB_RECIPES = {"analysis": "improvements.analysis", "eval": "improvements.eval.v1"}
MAX_INTERVAL_HOURS = 24 * 30
MAX_LOOKBACK_DAYS = 365
MAX_SESSIONS = 1000
MAX_CHARS = 1_000_000
MAX_PROFILE_TEXT = 2000
# A space key is short by construction; the bound is generous on purpose so a
# malformed value is refused for its shape rather than for its length.
MAX_PLANNING_SPACE = 200
MAX_ANALYZER_MODEL = 120
ANALYZER_EFFORTS = ("", "low", "medium", "high", "xhigh", "max")


def sidecar_path(board_db: str | os.PathLike[str]) -> Path:
    source = Path(board_db)
    return source.parent / f"{source.stem}.modules" / "improvements.sqlite3"


def _renamed(row, keys: set, current: str, previous: str):
    """One column's value under whichever name the sidecar on disk carries.

    A read must not migrate — that is what keeps opening the page harmless — so
    a sidecar still at a version before the Planning rename is read under its
    own spelling. This is the same shape the reader already uses for a column
    that a version simply did not have, not a second live schema: nothing is
    written under the old name, and the next explicit write migrates it.
    """

    return row[current] if current in keys else row[previous]


def default_profile(scope: str) -> dict:
    return {
        "interface_version": API_VERSION,
        "scope": scope,
        "revision": 0,
        "enabled": False,
        "purpose": "",
        "expected_behavior": "",
        "allowed_targets": list(ALLOWED_TARGETS),
        "excluded_targets": ["product-code"],
        "analyzer_client": "codex",
        "analyzer_model": "",
        "reasoning_effort": "",
        "planning_space": "",
        "schedule": {"mode": "manual", "interval_hours": 24},
        "limits": {"lookback_days": 30, "max_sessions": 20, "max_chars": 60000},
        "capabilities": {"can_analyze": False, "can_approve": False},
    }


def _eval_run_identity(
    case_id: int,
    phase: str,
    repo: str,
    git_ref: str,
    patch_hash: str | None,
    pack_version: int,
    pack_hash: str,
    job_id: int,
) -> str:
    material = {
        "case_id": case_id,
        "phase": phase,
        "repo": repo,
        "git_ref": git_ref,
        "patch_hash": patch_hash,
        "pack_version": pack_version,
        "pack_hash": pack_hash,
        "job_id": job_id,
    }
    return hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()


def _row(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


class ImprovementStore:
    """One Improvements sidecar, permanently bound to one resolved scope."""

    def __init__(self, board_db: str | os.PathLike[str], scope: str):
        if not scope:
            raise ImprovementError("unknown_scope", "scope must be resolved before opening", 404)
        self.board_db, self.scope = Path(board_db), scope
        self.path = sidecar_path(board_db)

    def connect(self, create: bool = False) -> sqlite3.Connection | None:
        """Open the sidecar, bringing a behind-version one forward first.

        This changes a decision, so here is the decision it changes. A read used
        not to migrate — `migrate_sidecar` ran only when a sidecar was created
        or explicitly written — and the case for that was that a GET should not
        mutate a store.

        What that left is a store this build cannot read correctly. Step 7
        renamed the case columns to their neutral names; a sidecar that had
        cases before it kept the old ones, and every read of it raised
        `IndexError` looking for a column that store has never had. The owner's
        case list answered `invalid_request: No item with that key` for as long
        as that was true, and the old test did not catch it because it read a
        store with no cases in it, where the comprehension never touches a
        column.

        The alternatives were worse. Reading both spellings is the alias layer
        `AGENTS.md` forbids outright. Refusing by name leaves the feature broken
        until somebody runs a command they have never heard of.

        So it migrates, which is what the main store has always done on open:
        forward-only, and `migrate_sidecar` snapshots a populated store before
        it touches it. A store already at the current version is not written to
        by a read, which is the part of the original decision that survives.
        """

        if not self.path.exists():
            if not create:
                return None
            migrate_sidecar(self.path)
        elif sidecar_version(self.path) < SCHEMA_VERSION:
            migrate_sidecar(self.path)
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        found = conn.execute("SELECT scope FROM profile LIMIT 1").fetchone()
        if found and found[0] != self.scope:
            conn.close()
            raise ImprovementError("scope_mismatch", "sidecar belongs to another scope", 404)
        return conn

    def _event(
        self,
        conn: sqlite3.Connection,
        entity: str,
        action: str,
        entity_id: object,
        payload: object = None,
    ) -> None:
        conn.execute(
            "INSERT INTO events(name,interface_version,scope,entity_id,payload_json,at) VALUES(?,?,?,?,?,?)",
            (
                f"module.improvements.{entity}.{action}",
                EVENTS_VERSION,
                self.scope,
                str(entity_id),
                canonical_json(payload or {}),
                utc_now(),
            ),
        )

    @staticmethod
    def _case_for_mutation(conn: sqlite3.Connection, case_id: int) -> sqlite3.Row:
        case = conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
        if not case:
            raise ImprovementError("case_not_found", "case not found", 404)
        if case["approval_pending"]:
            raise ImprovementError(
                "approval_pending", "only retry approve may mutate a pending case", 409
            )
        return case

    def profile(self) -> dict:
        conn = self.connect()
        if not conn:
            return default_profile(self.scope)
        try:
            row = conn.execute("SELECT * FROM profile WHERE scope=?", (self.scope,)).fetchone()
            if not row:
                return default_profile(self.scope)
            profile = default_profile(self.scope)
            row_keys = set(row.keys())
            profile.update(
                {
                    "revision": row["revision"],
                    "enabled": bool(row["enabled"]),
                    "purpose": row["purpose"],
                    "expected_behavior": row["expected_behavior"],
                    "analyzer_client": row["analyzer_client"],
                    "analyzer_model": row["analyzer_model"] if "analyzer_model" in row_keys else "",
                    "reasoning_effort": row["reasoning_effort"]
                    if "reasoning_effort" in row_keys
                    else "",
                    "planning_space": _renamed(row, row_keys, "planning_space", "planning_board"),
                    "schedule": {
                        "mode": row["schedule_mode"],
                        "interval_hours": row["interval_hours"],
                    },
                    "limits": {
                        "lookback_days": row["lookback_days"],
                        "max_sessions": row["max_sessions"],
                        "max_chars": row["max_chars"],
                    },
                }
            )
            profile["capabilities"] = {
                "can_analyze": bool(row["enabled"]),
                "can_approve": bool(
                    row["enabled"] and _renamed(row, row_keys, "planning_space", "planning_board")
                ),
            }
            return profile
        finally:
            conn.close()

    def put_profile(self, values: Mapping[str, object], expected_revision: int) -> dict:
        enabled = bool(values.get("enabled", False))
        raw_purpose = str(values.get("purpose", "")).strip()
        raw_behavior = str(values.get("expected_behavior", "")).strip()
        raw_space = str(values.get("planning_space", "")).strip()
        if (
            len(raw_purpose) > MAX_PROFILE_TEXT
            or len(raw_behavior) > MAX_PROFILE_TEXT
            or len(raw_space) > MAX_PLANNING_SPACE
        ):
            raise ImprovementError("invalid_profile", "profile text exceeds its finite bound")
        purpose, behavior = (
            bounded_text(raw_purpose, MAX_PROFILE_TEXT),
            bounded_text(raw_behavior, MAX_PROFILE_TEXT),
        )
        space, client = (
            bounded_text(raw_space, MAX_PLANNING_SPACE),
            str(values.get("analyzer_client", "codex")),
        )
        analyzer_model = str(values.get("analyzer_model", "")).strip()
        reasoning_effort = str(values.get("reasoning_effort", "")).strip().lower()
        schedule = dict(values.get("schedule", {}))
        limits = dict(values.get("limits", {}))
        mode = str(schedule.get("mode", "manual"))
        numeric = (
            schedule.get("interval_hours", 24),
            limits.get("lookback_days", 30),
            limits.get("max_sessions", 20),
            limits.get("max_chars", 60000),
        )
        if any(isinstance(value, bool) or not isinstance(value, int) for value in numeric):
            raise ImprovementError(
                "invalid_profile", "profile schedule and limits must be integers"
            )
        interval, lookback, sessions, chars = numeric
        if values.get("scope", self.scope) != self.scope:
            raise ImprovementError("scope_mismatch", "profile scope differs from bound scope", 404)
        if client not in {"codex", "claude"} or mode not in {"manual", "scheduled"}:
            raise ImprovementError("invalid_profile", "invalid analyzer client or schedule mode")
        if len(analyzer_model) > MAX_ANALYZER_MODEL or any(
            ord(character) < 32 or ord(character) == 127 for character in analyzer_model
        ):
            raise ImprovementError(
                "invalid_profile", "analyzer model exceeds its finite safe bound"
            )
        if reasoning_effort not in ANALYZER_EFFORTS:
            raise ImprovementError("invalid_profile", "invalid analyzer reasoning effort")
        if (
            not 1 <= interval <= MAX_INTERVAL_HOURS
            or not 1 <= lookback <= MAX_LOOKBACK_DAYS
            or not 1 <= sessions <= MAX_SESSIONS
            or not 1 <= chars <= MAX_CHARS
        ):
            raise ImprovementError(
                "invalid_profile", "profile schedule and limits exceed their finite bounds"
            )
        targets = values.get("allowed_targets", ALLOWED_TARGETS)
        excluded = values.get("excluded_targets", ["product-code"])
        if tuple(targets) != ALLOWED_TARGETS or list(excluded) != ["product-code"]:
            raise ImprovementError(
                "invalid_target", "workflow targets are fixed and product-code is excluded"
            )
        if enabled and (not purpose or not behavior or not space):
            raise ImprovementError(
                "invalid_profile",
                "enabling requires purpose, expected behavior, and a planning space",
            )
        if enabled and not self.path.exists() and expected_revision != 0:
            raise ImprovementError("revision_conflict", "stale profile revision", 409)
        if not self.path.exists() and not enabled:  # a no-op disabled write remains non-creating
            if expected_revision != 0:
                raise ImprovementError("revision_conflict", "stale profile revision", 409)
            return default_profile(self.scope)
        with maintenance_lease(self.path):
            migrate_sidecar_locked(self.path)
            conn = self.connect()
            try:
                with conn:
                    old = conn.execute(
                        "SELECT revision FROM profile WHERE scope=?", (self.scope,)
                    ).fetchone()
                    revision = int(old[0]) if old else 0
                    if revision != expected_revision:
                        raise ImprovementError("revision_conflict", "stale profile revision", 409)
                    now, new_revision = utc_now(), revision + 1
                    conn.execute(
                        """INSERT INTO profile(
                        scope,revision,enabled,purpose,expected_behavior,analyzer_client,
                        planning_space,schedule_mode,interval_hours,lookback_days,max_sessions,
                        max_chars,created_at,updated_at,analyzer_model,reasoning_effort
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,
                        purpose=excluded.purpose,expected_behavior=excluded.expected_behavior,
                        analyzer_client=excluded.analyzer_client,planning_space=excluded.planning_space,
                        analyzer_model=excluded.analyzer_model,reasoning_effort=excluded.reasoning_effort,
                        schedule_mode=excluded.schedule_mode,interval_hours=excluded.interval_hours,
                        lookback_days=excluded.lookback_days,max_sessions=excluded.max_sessions,
                        max_chars=excluded.max_chars,updated_at=excluded.updated_at""",
                        (
                            self.scope,
                            new_revision,
                            int(enabled),
                            purpose,
                            behavior,
                            client,
                            space,
                            mode,
                            interval,
                            lookback,
                            sessions,
                            chars,
                            now,
                            now,
                            analyzer_model,
                            reasoning_effort,
                        ),
                    )
                    self._event(conn, "profile", "updated", self.scope)
            finally:
                conn.close()
        return self.profile()

    def _enabled(self) -> sqlite3.Connection:
        conn = self.connect()
        row = (
            conn.execute("SELECT enabled FROM profile WHERE scope=?", (self.scope,)).fetchone()
            if conn
            else None
        )
        if not row or not row[0]:
            if conn:
                conn.close()
            raise ImprovementError("improvements_disabled", "Improvements is disabled")
        return conn

    def _write_connect(self) -> tuple[sqlite3.Connection, object]:
        if not self.path.exists():
            self._enabled()  # raises without creating a lease path
        lease = maintenance_lease(self.path)
        lease.__enter__()
        try:
            return self._enabled(), lease
        except Exception:
            lease.__exit__(*sys.exc_info())
            raise

    @staticmethod
    def _close_write(conn: sqlite3.Connection, lease: object) -> None:
        try:
            conn.close()
        finally:
            lease.__exit__(None, None, None)

    def record_signal(
        self, category: str, raw: Mapping[str, object], title: str = "Recurring agent failure"
    ) -> dict:
        evidence = evidence_record(raw)
        title = bounded_text(title, 200)
        if not title:
            raise ImprovementError("invalid_title", "case title is required")
        conn, lease = self._write_connect()
        try:
            with conn:
                case_id, _, _ = self._record_signal_tx(conn, category, evidence, title)
            return self.case(case_id)
        finally:
            self._close_write(conn, lease)

    def record_signal_packet(
        self,
        packet: Mapping[str, object],
        *,
        verified_session_events: set[tuple[str, str]] | None = None,
    ) -> dict:
        sanitized = sanitize_signal_packet(
            packet,
            expected_scope=self.scope,
            verified_session_events=verified_session_events,
        )
        conn, lease = self._write_connect()
        case_ids: list[int] = []
        recorded = 0
        try:
            with conn:
                for category, evidence in sanitized:
                    case_id, _signal_id, created = self._record_signal_tx(
                        conn, category, evidence, "Recurring agent failure"
                    )
                    if case_id not in case_ids:
                        case_ids.append(case_id)
                    recorded += int(created)
        finally:
            self._close_write(conn, lease)
        return {
            "interface_version": API_VERSION,
            "scope": self.scope,
            "recorded": recorded,
            "duplicates": len(sanitized) - recorded,
            "case_ids": case_ids,
        }

    def _record_signal_tx(
        self,
        conn: sqlite3.Connection,
        category: str,
        evidence: Mapping[str, object],
        title: str,
        *,
        semantic_fingerprint: str | None = None,
        case_key: str | None = None,
    ) -> tuple[int, int, bool]:
        exact_fingerprint = deterministic_fingerprint(category, evidence)
        fingerprint = semantic_fingerprint or exact_fingerprint
        duplicate = conn.execute(
            "SELECT id,case_id FROM signals WHERE pointer=? AND source_hash=?",
            (evidence["pointer"], evidence["source_hash"]),
        ).fetchone()
        if duplicate:
            return int(duplicate["case_id"]), int(duplicate["id"]), False
        case = conn.execute(
            """SELECT c.* FROM cases c JOIN signals s ON s.case_id=c.id
            WHERE s.fingerprint=? AND c.category=? AND c.merged_into IS NULL AND c.state!='false_positive'
            ORDER BY c.id LIMIT 1""",
            (exact_fingerprint, category),
        ).fetchone()
        matched_exact = case is not None
        if not case:
            case = conn.execute(
                "SELECT * FROM cases WHERE fingerprint=? AND category=? AND merged_into IS NULL AND state!='false_positive' ORDER BY id LIMIT 1",
                (fingerprint, category),
            ).fetchone()
        now = utc_now()
        if not case:
            key = case_key or f"case-{uuid.uuid4().hex[:16]}"
            collision = conn.execute(
                "SELECT fingerprint FROM cases WHERE case_key=?", (key,)
            ).fetchone()
            if collision:
                raise ImprovementError(
                    "case_key_conflict", "semantic case_key already identifies another case", 409
                )
            cursor = conn.execute(
                """INSERT INTO cases(case_key,fingerprint,title,state,severity,category,first_seen,last_seen,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    key,
                    fingerprint,
                    title,
                    "collecting",
                    evidence["severity"],
                    category,
                    evidence["at"],
                    evidence["at"],
                    now,
                    now,
                ),
            )
            case_id = int(cursor.lastrowid)
            conn.execute(
                "INSERT INTO history(case_id,from_state,to_state,at) VALUES(?,NULL,'collecting',?)",
                (case_id, now),
            )
        else:
            case_id = int(case["id"])
            if case_key and case["case_key"] != case_key and not matched_exact:
                raise ImprovementError(
                    "case_key_conflict", "cluster_key is already bound to another case_key", 409
                )
            self._case_for_mutation(conn, case_id)
        cursor = conn.execute(
            """INSERT INTO signals(case_id,pointer,source_kind,at,client,session_id,event_type,severity,excerpt,source_hash,fingerprint,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                case_id,
                evidence["pointer"],
                evidence.get("source_kind", "session_event"),
                evidence["at"],
                evidence["client"],
                evidence["session_id"],
                evidence["event_type"],
                evidence["severity"],
                evidence["excerpt"],
                evidence["source_hash"],
                exact_fingerprint,
                now,
            ),
        )
        highest = conn.execute(
            "SELECT severity FROM signals WHERE case_id=? ORDER BY CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC LIMIT 1",
            (case_id,),
        ).fetchone()[0]
        conn.execute(
            "UPDATE cases SET last_seen=?,severity=?,updated_at=?,revision=revision+1 WHERE id=?",
            (evidence["at"], highest, now, case_id),
        )
        if self._promotion_eligible(conn, case_id, parse_timestamp(now)):
            self._set_state(conn, case_id, "open", "promotion thresholds met")
        self._event(conn, "signal", "recorded", evidence["pointer"], {"case_id": case_id})
        return case_id, int(cursor.lastrowid), True

    def _promotion_eligible(self, conn: sqlite3.Connection, case_id: int, now: datetime) -> bool:
        case = conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
        if not case or case["state"] != "collecting" or case["planning_work_item"] is not None:
            return False
        cutoff, recent = (now - timedelta(days=30)).isoformat(), now - timedelta(days=14)
        rows = conn.execute(
            "SELECT at,session_id,severity FROM signals WHERE case_id=? AND at>=?",
            (case_id, cutoff),
        ).fetchall()
        return (
            len(rows) >= 3
            and len({r["session_id"] for r in rows if r["session_id"]}) >= 2
            and sum(SEVERITIES[r["severity"]] for r in rows) >= 8
            and max(
                (parse_timestamp(r["at"]) for r in rows), default=datetime.min.replace(tzinfo=UTC)
            )
            >= recent
        )

    def _set_state(
        self, conn: sqlite3.Connection, case_id: int, state: str, reason: str = ""
    ) -> None:
        if state not in STATES:
            raise ImprovementError("invalid_state", "unknown case state")
        old = self._case_for_mutation(conn, case_id)
        if old["state"] == state:
            return
        allowed = {
            "collecting": {"open", "false_positive"},
            "open": {"watching", "snoozed", "approved", "false_positive"},
            "watching": {"open", "snoozed", "approved", "false_positive", "regressed"},
            "snoozed": {"open", "watching", "approved", "false_positive"},
            "approved": {"implementing", "open"},
            "implementing": {"validating", "open"},
            "validating": {"resolved", "open"},
            "resolved": {"effective", "regressed", "open", "watching"},
            "effective": {"regressed", "open"},
            "false_positive": {"open"},
            "regressed": {"open", "watching", "approved"},
        }
        if state not in allowed.get(old["state"], set()):
            raise ImprovementError(
                "transition_refused", f"cannot transition {old['state']} to {state}"
            )
        now = utc_now()
        conn.execute(
            "UPDATE cases SET state=?,revision=revision+1,updated_at=? WHERE id=?",
            (state, now, case_id),
        )
        conn.execute(
            "INSERT INTO history(case_id,from_state,to_state,reason,at) VALUES(?,?,?,?,?)",
            (case_id, old["state"], state, reason, now),
        )
        self._event(conn, "case", "transitioned", case_id, {"from": old["state"], "to": state})

    def _refresh_case_aggregate(self, conn: sqlite3.Connection, case_id: int) -> None:
        rows = conn.execute(
            "SELECT at,severity FROM signals WHERE case_id=?", (case_id,)
        ).fetchall()
        now = utc_now()
        if rows:
            first = min(rows, key=lambda row: parse_timestamp(row["at"]))["at"]
            last = max(rows, key=lambda row: parse_timestamp(row["at"]))["at"]
            severity = max(rows, key=lambda row: SEVERITIES[row["severity"]])["severity"]
            conn.execute(
                "UPDATE cases SET first_seen=?,last_seen=?,severity=?,revision=revision+1,updated_at=? WHERE id=?",
                (first, last, severity, now, case_id),
            )
        else:
            conn.execute(
                "UPDATE cases SET revision=revision+1,updated_at=? WHERE id=?", (now, case_id)
            )

    def transition(self, case_id: int, state: str, reason: str = "") -> dict:
        conn, lease = self._write_connect()
        try:
            with conn:
                self._set_state(conn, case_id, state, reason)
            return self.case(case_id)
        finally:
            self._close_write(conn, lease)

    def cases(self, state: str | None = None, limit: int = 100) -> list[dict]:
        if limit < 1 or limit > 100:
            raise ImprovementError("invalid_limit", "limit must be 1..100")
        conn = self.connect()
        if not conn:
            return []
        try:
            query, args = "SELECT * FROM cases WHERE merged_into IS NULL", []
            if state:
                if state not in STATES:
                    raise ImprovementError("invalid_state", "unknown case state")
                query += " AND state=?"
                args.append(state)
            rows = conn.execute(
                query + " ORDER BY updated_at DESC LIMIT ?", (*args, limit)
            ).fetchall()
            return [self._case_summary(conn, row) for row in rows]
        finally:
            conn.close()

    def _case_summary(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
        stats = conn.execute(
            "SELECT COUNT(*) signals,COUNT(DISTINCT CASE WHEN source_kind='session_event'"
            " AND session_id<>'' THEN session_id END) sessions FROM signals WHERE case_id=?",
            (row["id"],),
        ).fetchone()
        return {
            key: row[key]
            for key in (
                "id",
                "case_key",
                "title",
                "state",
                "severity",
                "category",
                "first_seen",
                "last_seen",
                "trend",
                "planning_work_item",
                "updated_at",
            )
        } | {"signal_count": stats[0], "session_count": stats[1], "revision": row["revision"]}

    def case(self, case_id: int) -> dict:
        conn = self.connect()
        if not conn:
            raise ImprovementError("case_not_found", "case not found", 404)
        try:
            row = conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
            if not row:
                raise ImprovementError("case_not_found", "case not found", 404)
            result = self._case_summary(conn, row)
            result["evidence"] = [
                dict(item)
                for item in conn.execute(
                    "SELECT id,pointer,source_kind,at,client,session_id,event_type,severity,excerpt,source_hash FROM signals WHERE case_id=? ORDER BY at",
                    (case_id,),
                )
            ]
            item = conn.execute(
                "SELECT version,body_json FROM proposals WHERE case_id=?", (case_id,)
            ).fetchone()
            result["proposal"] = ({"version": item[0]} | json.loads(item[1])) if item else None
            version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            pack_query = (
                "SELECT version,body_json,pack_hash FROM evaluation_packs WHERE case_id=?"
                if version >= 3
                else "SELECT version,body_json,'' AS pack_hash FROM evaluation_packs WHERE case_id=?"
            )
            item = conn.execute(pack_query, (case_id,)).fetchone()
            result["evaluation_pack"] = (
                (json.loads(item[1]) | {"pack_revision": item[0], "pack_hash": item[2]})
                if item
                else None
            )
            result["eval_runs"] = [
                dict(r) | {"result": json.loads(r["result_json"])}
                for r in conn.execute("SELECT * FROM eval_runs WHERE case_id=?", (case_id,))
            ]
            result["history"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT from_state,to_state,reason,at FROM history WHERE case_id=? ORDER BY id",
                    (case_id,),
                )
            ]
            result["monitoring"] = _row(
                conn.execute("SELECT * FROM monitoring WHERE case_id=?", (case_id,)).fetchone()
            )
            return result
        finally:
            conn.close()

    def signal_summary(self) -> dict:
        counts = dict.fromkeys(sorted(SOURCE_KINDS), 0)
        conn = self.connect()
        if not conn:
            return {
                "total": 0,
                "source_counts": counts,
                "session_count": 0,
                "last_recorded_at": None,
            }
        try:
            if int(conn.execute("PRAGMA user_version").fetchone()[0]) < 4:
                stats = conn.execute(
                    "SELECT COUNT(*),COUNT(DISTINCT CASE WHEN session_id<>'' THEN session_id END),"
                    "MAX(created_at) FROM signals"
                ).fetchone()
                counts["session_event"] = int(stats[0])
            else:
                for row in conn.execute(
                    "SELECT source_kind,COUNT(*) AS count FROM signals GROUP BY source_kind"
                ):
                    if row["source_kind"] in counts:
                        counts[row["source_kind"]] = int(row["count"])
                stats = conn.execute(
                    "SELECT COUNT(*),COUNT(DISTINCT CASE WHEN source_kind='session_event'"
                    " AND session_id<>'' THEN session_id END),MAX(created_at) FROM signals"
                ).fetchone()
            return {
                "total": int(stats[0]),
                "source_counts": counts,
                "session_count": int(stats[1]),
                "last_recorded_at": stats[2],
            }
        finally:
            conn.close()

    def analysis_signal_candidates(
        self, *, since: str, limit: int = MAX_SIGNAL_COUNT
    ) -> list[dict]:
        """Return bounded, already-sanitized sidecar signals for analysis."""
        if not 1 <= limit <= MAX_SIGNAL_COUNT:
            raise ImprovementError("invalid_limit", "signal candidate limit is out of bounds")
        parse_timestamp(since)
        conn = self.connect()
        if not conn:
            return []
        try:
            rows = conn.execute(
                "SELECT s.id,s.pointer,s.source_kind,s.at,s.client,s.session_id,s.event_type,"
                "s.severity,s.excerpt,s.fingerprint,c.id AS existing_case_id,c.category"
                " FROM signals s JOIN cases c ON c.id=s.case_id"
                " WHERE c.merged_into IS NULL AND c.state!='false_positive' AND s.at>=?"
                " ORDER BY s.created_at DESC,s.id DESC LIMIT ?",
                (since, limit),
            ).fetchall()
            return [
                {
                    "id": -int(row["id"]),
                    "pointer": row["pointer"],
                    "source_kind": row["source_kind"],
                    "at": row["at"],
                    "client": row["client"],
                    "session_id": row["session_id"],
                    "event_type": row["event_type"],
                    "severity": row["severity"],
                    "excerpt": row["excerpt"],
                    "exact_fingerprint": row["fingerprint"],
                    "existing_case_id": int(row["existing_case_id"]),
                    "category": row["category"],
                }
                for row in rows
            ]
        finally:
            conn.close()

    def save_proposal(
        self,
        case_id: int,
        proposal: Mapping[str, object],
        evaluation_pack: Mapping[str, object],
        expected_revision: int,
    ) -> dict:
        proposal = sanitize_proposal(proposal)
        targets = proposal.get("targets", proposal.get("affected_surfaces", []))
        if not targets or any(target not in ALLOWED_TARGETS for target in targets):
            raise ImprovementError(
                "invalid_target", "proposal targets must be allowed workflow surfaces"
            )
        if "product-code" in targets:
            raise ImprovementError("invalid_target", "product-code is forbidden")
        conn, lease = self._write_connect()
        try:
            with conn:
                case = self._case_for_mutation(conn, case_id)
                if case["revision"] != expected_revision:
                    raise ImprovementError("revision_conflict", "stale case revision", 409)
                now = utc_now()
                existing = conn.execute(
                    "SELECT version FROM proposals WHERE case_id=?", (case_id,)
                ).fetchone()
                proposal_version = (existing[0] + 1) if existing else 1
                conn.execute(
                    "INSERT INTO proposals(case_id,version,body_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at",
                    (case_id, proposal_version, canonical_json(proposal), now),
                )
                existing = conn.execute(
                    "SELECT version FROM evaluation_packs WHERE case_id=?", (case_id,)
                ).fetchone()
                pack_version = (existing[0] + 1) if existing else 1
                evaluation_pack = sanitize_evaluation_pack(evaluation_pack, pack_version)
                pack_json = canonical_json(evaluation_pack)
                pack_hash = evaluation_pack_hash(evaluation_pack)
                conn.execute(
                    "INSERT INTO evaluation_packs(case_id,version,body_json,updated_at,pack_hash) VALUES(?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at,pack_hash=excluded.pack_hash",
                    (case_id, pack_version, pack_json, now, pack_hash),
                )
                conn.execute(
                    "UPDATE cases SET revision=revision+1,updated_at=? WHERE id=?", (now, case_id)
                )
                self._event(conn, "proposal", "saved", case_id)
            return self.case(case_id)
        finally:
            self._close_write(conn, lease)

    def action(
        self,
        case_id: int,
        action: str,
        expected_revision: int,
        *,
        reason: str = "",
        target_case_id: int | None = None,
        signal_ids: Sequence[int] = (),
        snooze_until: str | None = None,
        ensure_planning_card: Callable[[dict], Mapping[str, object]] | None = None,
    ) -> dict:
        if action == "approve":
            if ensure_planning_card is None:
                raise ImprovementError(
                    "planning_callback", "approve requires the Planning ensure callback"
                )
            return self.approve(case_id, expected_revision, ensure_planning_card)
        if action not in {"merge", "split", "false_positive", "snooze", "watch", "reopen"}:
            raise ImprovementError("invalid_action", "unsupported action")
        reason = bounded_text(reason)
        conn, lease = self._write_connect()
        try:
            with conn:
                case = self._case_for_mutation(conn, case_id)
                if (
                    case["planning_work_item"] is not None or case["epic_work_item"] is not None
                ) and action in {"merge", "split", "false_positive", "snooze"}:
                    raise ImprovementError(
                        "planning_linked", "action cannot hide or detach Planning-linked work"
                    )
                if case["revision"] != expected_revision:
                    raise ImprovementError("revision_conflict", "stale case revision", 409)
                if action in {"false_positive", "snooze"} and not reason.strip():
                    raise ImprovementError("reason_required", "reason is required")
                if action == "snooze":
                    if not snooze_until:
                        raise ImprovementError("invalid_timestamp", "snooze_until is required")
                    parse_timestamp(snooze_until)
                detail = {}
                if action == "merge":
                    if not target_case_id or target_case_id == case_id:
                        raise ImprovementError("target_required", "merge target is required")
                    target = self._case_for_mutation(conn, target_case_id)
                    if target["merged_into"] is not None:
                        raise ImprovementError("case_not_found", "target case not found", 404)
                    if (
                        target["planning_work_item"] is not None
                        or target["epic_work_item"] is not None
                    ):
                        raise ImprovementError(
                            "planning_linked", "merge target is pending or Planning-linked"
                        )
                    conn.execute(
                        "UPDATE signals SET case_id=? WHERE case_id=?", (target_case_id, case_id)
                    )
                    conn.execute(
                        "UPDATE cases SET merged_into=?,state='false_positive',updated_at=? WHERE id=?",
                        (target_case_id, utc_now(), case_id),
                    )
                    self._refresh_case_aggregate(conn, case_id)
                    self._refresh_case_aggregate(conn, target_case_id)
                    conn.execute(
                        "INSERT INTO history(case_id,from_state,to_state,reason,at) VALUES(?,?,?,?,?)",
                        (case_id, case["state"], "false_positive", "manual merge", utc_now()),
                    )
                    conn.execute(
                        "INSERT INTO manual_groups(source_case_id,target_case_id,kind,created_at) VALUES(?,?,?,?)",
                        (case_id, target_case_id, "merge", utc_now()),
                    )
                    detail = {"target_case_id": target_case_id}
                elif action == "split":
                    ids = tuple(int(i) for i in signal_ids)
                    if not ids:
                        raise ImprovementError("signals_required", "split requires signal_ids")
                    marks = ",".join("?" for _ in ids)
                    rows = conn.execute(
                        f"SELECT * FROM signals WHERE case_id=? AND id IN ({marks})",
                        (case_id, *ids),
                    ).fetchall()
                    if len(rows) != len(set(ids)):
                        raise ImprovementError("invalid_signals", "signals must belong to the case")
                    total = conn.execute(
                        "SELECT COUNT(*) FROM signals WHERE case_id=?", (case_id,)
                    ).fetchone()[0]
                    if len(rows) >= total:
                        raise ImprovementError(
                            "invalid_signals", "split must leave at least one source signal"
                        )
                    now, key = utc_now(), f"case-{uuid.uuid4().hex[:16]}"
                    cursor = conn.execute(
                        """INSERT INTO cases(case_key,fingerprint,title,state,severity,category,first_seen,last_seen,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?)""",
                        (
                            key,
                            case["fingerprint"] + ":split:" + uuid.uuid4().hex,
                            case["title"],
                            "collecting",
                            max(rows, key=lambda r: SEVERITIES[r["severity"]])["severity"],
                            case["category"],
                            min(r["at"] for r in rows),
                            max(r["at"] for r in rows),
                            now,
                            now,
                        ),
                    )
                    new_id = int(cursor.lastrowid)
                    conn.execute(
                        f"UPDATE signals SET case_id=? WHERE id IN ({marks})", (new_id, *ids)
                    )
                    conn.execute(
                        "INSERT INTO history(case_id,from_state,to_state,reason,at) VALUES(?,NULL,'collecting','manual split',?)",
                        (new_id, now),
                    )
                    conn.execute(
                        "INSERT INTO manual_groups(source_case_id,target_case_id,kind,created_at) VALUES(?,?,?,?)",
                        (case_id, new_id, "split", now),
                    )
                    self._refresh_case_aggregate(conn, case_id)
                    self._refresh_case_aggregate(conn, new_id)
                    detail = {"target_case_id": new_id, "signal_ids": list(ids)}
                else:
                    state = {
                        "false_positive": "false_positive",
                        "snooze": "snoozed",
                        "watch": "watching",
                        "reopen": "open",
                    }[action]
                    self._set_state(conn, case_id, state, reason)
                    if action == "false_positive":
                        conn.execute(
                            "INSERT INTO negative_examples(case_id,reason,fingerprint,created_at) VALUES(?,?,?,?)",
                            (case_id, reason, case["fingerprint"], utc_now()),
                        )
                    if snooze_until:
                        detail["snooze_until"] = snooze_until
                conn.execute(
                    "INSERT INTO actions(case_id,action,reason,detail_json,at) VALUES(?,?,?,?,?)",
                    (case_id, action, reason, canonical_json(detail), utc_now()),
                )
                self._event(conn, "case", action, case_id, detail)
            return self.case(case_id)
        finally:
            self._close_write(conn, lease)

    def approve(
        self,
        case_id: int,
        expected_revision: int,
        ensure_planning_card: Callable[[dict], Mapping[str, object]],
        fault: Callable[[str], None] | None = None,
    ) -> dict:
        conn, lease = self._write_connect()
        try:
            with conn:
                case = conn.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone()
                if not case:
                    raise ImprovementError("case_not_found", "case not found", 404)
                if case["planning_work_item"] is not None:
                    return {
                        "interface_version": API_VERSION,
                        "case": self.case(case_id),
                        "created": False,
                        "epic_work_item": case["epic_work_item"],
                        "work_item": case["planning_work_item"],
                        "launched": False,
                    }
                if case["approval_pending"] and case["state"] != "approved":
                    raise ImprovementError(
                        "approval_corrupt", "pending approval is not in approved state"
                    )
                if not case["approval_pending"]:
                    if case["revision"] != expected_revision:
                        raise ImprovementError("revision_conflict", "stale case revision", 409)
                    self._set_state(conn, case_id, "approved", "explicit approval")
                    conn.execute("UPDATE cases SET approval_pending=1 WHERE id=?", (case_id,))
            profile = self.profile()
            space_hash = hashlib.sha256(profile["planning_space"].encode("utf-8")).hexdigest()
            request = {
                "planning_space": profile["planning_space"],
                "epic_source": f"improvement://planning/{space_hash}/epic",
                "work_source": f"improvement://{self.scope}/{case['case_key']}",
                "title": bounded_text(case["title"], 200),
                "scope": self.scope,
                "case_key": case["case_key"],
            }
            ensured = dict(ensure_planning_card(request))
            if "epic_work_item" not in ensured or "work_item" not in ensured:
                raise ImprovementError(
                    "planning_callback", "Planning ensure callback returned no work item identities"
                )
            if fault:
                fault("after_ensure")
            with conn:
                conn.execute(
                    "UPDATE cases SET epic_work_item=?,planning_work_item=?,approval_pending=0,updated_at=? WHERE id=?",
                    (
                        str(ensured["epic_work_item"]),
                        str(ensured["work_item"]),
                        utc_now(),
                        case_id,
                    ),
                )
                self._event(
                    conn,
                    "case",
                    "approved",
                    case_id,
                    {"planning_work_item": str(ensured["work_item"])},
                )
            return {
                "interface_version": API_VERSION,
                "case": self.case(case_id),
                "created": bool(ensured.get("created", False)),
                "epic_work_item": str(ensured["epic_work_item"]),
                "work_item": str(ensured["work_item"]),
                "launched": False,
            }
        finally:
            self._close_write(conn, lease)

    @staticmethod
    def _job_model(row: sqlite3.Row) -> dict:
        fields = (
            "id",
            "scope",
            "kind",
            "state",
            "client",
            "created_at",
            "started_at",
            "finished_at",
            "error_code",
            "result_summary",
        )
        return {field: row[field] for field in fields}

    def create_job(
        self,
        kind: str = "analysis",
        trigger: str = "manual",
        *,
        recipe_id: str | None = None,
        case_id: int | None = None,
        phase: str | None = None,
        repo: str | None = None,
        git_ref: str | None = None,
    ) -> dict:
        if kind not in {"analysis", "eval"} or trigger not in {"manual", "scheduled"}:
            raise ImprovementError("invalid_job", "invalid job kind or trigger")
        profile = self.profile()
        if trigger == "scheduled" and profile["schedule"]["mode"] != "scheduled":
            raise ImprovementError("schedule_disabled", "scheduled analysis is opt-in")
        expected_recipe = JOB_RECIPES[kind]
        if recipe_id not in {None, expected_recipe}:
            raise ImprovementError(
                "invalid_job_recipe", "job recipe is not a trusted built-in recipe"
            )
        if kind == "analysis":
            if any(value is not None for value in (case_id, phase, repo, git_ref)):
                raise ImprovementError(
                    "invalid_job_recipe", "analysis recipe accepts only scope and trigger"
                )
            request = {"scope": self.scope, "trigger": trigger}
        else:
            if trigger != "manual":
                raise ImprovementError("invalid_job_recipe", "eval jobs are manually dispatched")
            repo, git_ref = bounded_text(repo, 500), bounded_text(git_ref, 64)
            if (
                not isinstance(case_id, int)
                or phase not in {"baseline", "candidate"}
                or not repo
                or not re.fullmatch(r"[0-9a-fA-F]{7,64}", git_ref)
            ):
                raise ImprovementError(
                    "invalid_job_recipe",
                    "eval recipe requires case_id, phase, repo, and immutable git ref",
                )
            request = {"case_id": case_id, "phase": phase, "repo": repo, "git_ref": git_ref}
        conn, lease = self._write_connect()
        try:
            with conn:
                if kind == "eval":
                    if not conn.execute("SELECT 1 FROM cases WHERE id=?", (case_id,)).fetchone():
                        raise ImprovementError("case_not_found", "eval recipe case not found", 404)
                    pack = conn.execute(
                        "SELECT version,body_json,pack_hash FROM evaluation_packs WHERE case_id=?",
                        (case_id,),
                    ).fetchone()
                    if not pack:
                        raise ImprovementError(
                            "evaluation_pack_required", "case has no EvaluationPack"
                        )
                    try:
                        body = canonical_evaluation_pack(json.loads(pack["body_json"]))
                    except (EvaluationContractError, TypeError, json.JSONDecodeError) as exc:
                        raise ImprovementError(
                            "invalid_eval", "persisted EvaluationPack is invalid"
                        ) from exc
                    if evaluation_pack_hash(body) != pack["pack_hash"]:
                        raise ImprovementError(
                            "invalid_eval", "persisted EvaluationPack hash is invalid"
                        )
                    request |= {
                        "pack_revision": pack["version"],
                        "pack_version": body["version"],
                        "pack_hash": pack["pack_hash"],
                    }
                try:
                    cursor = conn.execute(
                        """INSERT INTO jobs(scope,kind,state,client,created_at,recipe_id,request_json)
                        VALUES(?,?,'queued',?,?,?,?)""",
                        (
                            self.scope,
                            kind,
                            profile["analyzer_client"],
                            utc_now(),
                            expected_recipe,
                            canonical_json(request),
                        ),
                    )
                except sqlite3.IntegrityError as exc:
                    raise ImprovementError(
                        "job_conflict", "an analyzer job is already active", 409
                    ) from exc
                self._event(conn, "job", "queued", cursor.lastrowid)
            return self._job_model(
                conn.execute("SELECT * FROM jobs WHERE id=?", (cursor.lastrowid,)).fetchone()
            )
        finally:
            self._close_write(conn, lease)

    def load_job_request(self, job_id: int) -> dict:
        conn = self.connect()
        if not conn:
            raise ImprovementError("job_not_found", "job not found", 404)
        try:
            row = conn.execute(
                "SELECT id,scope,kind,client,recipe_id,request_json FROM jobs WHERE id=?", (job_id,)
            ).fetchone()
            if not row:
                raise ImprovementError("job_not_found", "job not found", 404)
            if row["recipe_id"] != JOB_RECIPES.get(row["kind"]):
                raise ImprovementError("invalid_job_recipe", "persisted job recipe is not trusted")
            try:
                request = json.loads(row["request_json"])
            except (TypeError, json.JSONDecodeError) as exc:
                raise ImprovementError(
                    "invalid_job_recipe", "persisted job request is malformed"
                ) from exc
            expected = (
                {"scope", "trigger"}
                if row["kind"] == "analysis"
                else {
                    "case_id",
                    "phase",
                    "repo",
                    "git_ref",
                    "pack_revision",
                    "pack_version",
                    "pack_hash",
                }
            )
            if not isinstance(request, dict) or set(request) != expected:
                raise ImprovementError("invalid_job_recipe", "persisted job request is malformed")
            if row["kind"] == "analysis":
                valid = request["scope"] == self.scope and request["trigger"] in {
                    "manual",
                    "scheduled",
                }
            else:
                valid = (
                    isinstance(request["case_id"], int)
                    and request["phase"] in {"baseline", "candidate"}
                    and isinstance(request["repo"], str)
                    and 0 < len(request["repo"]) <= 500
                    and isinstance(request["git_ref"], str)
                    and bool(re.fullmatch(r"[0-9a-fA-F]{7,64}", request["git_ref"]))
                    and isinstance(request["pack_revision"], int)
                    and request["pack_revision"] > 0
                    and isinstance(request["pack_version"], str)
                    and 0 < len(request["pack_version"]) <= 128
                    and isinstance(request["pack_hash"], str)
                    and bool(re.fullmatch(r"[0-9a-f]{64}", request["pack_hash"]))
                )
            if not valid:
                raise ImprovementError(
                    "invalid_job_recipe", "persisted job request values are invalid"
                )
            return {
                "job_id": row["id"],
                "scope": row["scope"],
                "kind": row["kind"],
                "client": row["client"],
                "recipe_id": row["recipe_id"],
                "request": request,
            }
        finally:
            conn.close()

    def apply_analyzer_result(
        self, job_id: int, result_hash: str, validated_result: Mapping[str, object]
    ) -> dict:
        """Atomically apply one validated analyzer result and ledger its stable outcome."""
        sanitized = sanitize_analyzer_result(validated_result)
        expected_hash = hashlib.sha256(canonical_json(sanitized).encode("utf-8")).hexdigest()
        if not re.fullmatch(r"[0-9a-f]{64}", result_hash) or result_hash != expected_hash:
            raise ImprovementError(
                "result_hash_mismatch", "analyzer result hash does not match validated content"
            )
        conn, lease = self._write_connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                applied = conn.execute(
                    "SELECT result_hash,outcome_json FROM analyzer_applications WHERE job_id=?",
                    (job_id,),
                ).fetchone()
                if applied:
                    if applied["result_hash"] != result_hash:
                        raise ImprovementError(
                            "result_conflict",
                            "job already applied a different analyzer result",
                            409,
                        )
                    outcome = json.loads(applied["outcome_json"])
                    state = conn.execute("SELECT state FROM jobs WHERE id=?", (job_id,)).fetchone()
                    if state and state["state"] != "succeeded":
                        conn.execute(
                            "UPDATE jobs SET state='succeeded',finished_at=?,error_code='',result_summary='analysis result applied' WHERE id=?",
                            (utc_now(), job_id),
                        )
                        self._event(conn, "job", "succeeded", job_id)
                    conn.commit()
                    return outcome
                job = conn.execute(
                    "SELECT kind,state,recipe_id FROM jobs WHERE id=? AND scope=?",
                    (job_id, self.scope),
                ).fetchone()
                if (
                    not job
                    or job["kind"] != "analysis"
                    or job["recipe_id"] != JOB_RECIPES["analysis"]
                    or job["state"] not in {"queued", "running"}
                ):
                    raise ImprovementError(
                        "invalid_analyzer_job", "result must link a queued or running analysis job"
                    )
                assignments = {
                    signal_id: case
                    for case in sanitized["cases"]
                    for signal_id in case["signal_ids"]
                }
                signal_ids, case_ids, case_by_signal = [], [], {}
                for signal in sanitized["signals"]:
                    cluster = assignments.get(signal.get("id"))
                    cluster_key = (cluster or signal).get("cluster_key")
                    semantic = (
                        hashlib.sha256(
                            f"{signal['category']}\x1fcluster:{cluster_key}".encode()
                        ).hexdigest()
                        if cluster_key
                        else None
                    )
                    case_id, signal_id, _ = self._record_signal_tx(
                        conn,
                        signal["category"],
                        signal["evidence"],
                        cluster.get("title", signal["title"]) if cluster else signal["title"],
                        semantic_fingerprint=semantic,
                        case_key=(cluster or signal).get("case_key"),
                    )
                    signal_ids.append(signal_id)
                    case_ids.append(case_id)
                    if signal.get("id"):
                        case_by_signal[signal["id"]] = case_id
                mutated, resolved_semantic_cases, claimed_case_ids = [], [], set()
                for semantic_case in sanitized["cases"]:
                    resolved = {
                        case_by_signal[signal_id] for signal_id in semantic_case["signal_ids"]
                    }
                    if len(resolved) != 1:
                        raise ImprovementError(
                            "semantic_cluster_collision",
                            "semantic case signals did not resolve to one case",
                        )
                    semantic_case_id = resolved.pop()
                    if semantic_case_id in claimed_case_ids:
                        raise ImprovementError(
                            "semantic_cluster_collision",
                            "multiple semantic clusters resolved to one case",
                        )
                    claimed_case_ids.add(semantic_case_id)
                    resolved_semantic_cases.append((semantic_case, semantic_case_id))
                for semantic_case, semantic_case_id in resolved_semantic_cases:
                    if "proposal" not in semantic_case:
                        continue
                    self._case_for_mutation(conn, semantic_case_id)
                    now = utc_now()
                    prior = conn.execute(
                        "SELECT version FROM proposals WHERE case_id=?", (semantic_case_id,)
                    ).fetchone()
                    proposal_version = prior[0] + 1 if prior else 1
                    prior_pack = conn.execute(
                        "SELECT version FROM evaluation_packs WHERE case_id=?", (semantic_case_id,)
                    ).fetchone()
                    pack_version = prior_pack[0] + 1 if prior_pack else 1
                    canonical_pack = sanitize_evaluation_pack(
                        semantic_case["evaluation_pack"], pack_version
                    )
                    conn.execute(
                        "INSERT INTO proposals(case_id,version,body_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at",
                        (
                            semantic_case_id,
                            proposal_version,
                            canonical_json(semantic_case["proposal"]),
                            now,
                        ),
                    )
                    conn.execute(
                        "INSERT INTO evaluation_packs(case_id,version,body_json,updated_at,pack_hash) VALUES(?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at,pack_hash=excluded.pack_hash",
                        (
                            semantic_case_id,
                            pack_version,
                            canonical_json(canonical_pack),
                            now,
                            evaluation_pack_hash(canonical_pack),
                        ),
                    )
                    conn.execute(
                        "UPDATE cases SET revision=revision+1,updated_at=? WHERE id=?",
                        (now, semantic_case_id),
                    )
                    mutated.append(semantic_case_id)
                    self._event(conn, "case", "analyzed", semantic_case_id, {"job_id": job_id})
                for mutation in sanitized["case_mutations"]:
                    self._case_for_mutation(conn, mutation["case_id"])
                    updates, values = [], []
                    for field in ("title", "trend", "severity"):
                        if field in mutation:
                            updates.append(f"{field}=?")
                            values.append(mutation[field])
                    now = utc_now()
                    if updates:
                        conn.execute(
                            f"UPDATE cases SET {','.join(updates)},revision=revision+1,updated_at=? WHERE id=?",
                            (*values, now, mutation["case_id"]),
                        )
                    if "proposal" in mutation:
                        targets = mutation["proposal"].get(
                            "targets", mutation["proposal"].get("affected_surfaces", [])
                        )
                        if not targets or any(target not in ALLOWED_TARGETS for target in targets):
                            raise ImprovementError(
                                "invalid_target", "analyzer proposal target is forbidden"
                            )
                        prior = conn.execute(
                            "SELECT version FROM proposals WHERE case_id=?", (mutation["case_id"],)
                        ).fetchone()
                        proposal_version = prior[0] + 1 if prior else 1
                        conn.execute(
                            "INSERT INTO proposals(case_id,version,body_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at",
                            (
                                mutation["case_id"],
                                proposal_version,
                                canonical_json(mutation["proposal"]),
                                now,
                            ),
                        )
                        prior = conn.execute(
                            "SELECT version FROM evaluation_packs WHERE case_id=?",
                            (mutation["case_id"],),
                        ).fetchone()
                        pack_version = prior[0] + 1 if prior else 1
                        canonical_pack = sanitize_evaluation_pack(
                            mutation["evaluation_pack"], pack_version
                        )
                        pack_json = canonical_json(canonical_pack)
                        pack_hash = evaluation_pack_hash(canonical_pack)
                        conn.execute(
                            "INSERT INTO evaluation_packs(case_id,version,body_json,updated_at,pack_hash) VALUES(?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at,pack_hash=excluded.pack_hash",
                            (mutation["case_id"], pack_version, pack_json, now, pack_hash),
                        )
                        if not updates:
                            conn.execute(
                                "UPDATE cases SET revision=revision+1,updated_at=? WHERE id=?",
                                (now, mutation["case_id"]),
                            )
                    mutated.append(mutation["case_id"])
                    self._event(conn, "case", "analyzed", mutation["case_id"], {"job_id": job_id})
                outcome = {
                    "interface_version": API_VERSION,
                    "job_id": job_id,
                    "result_hash": result_hash,
                    "signal_ids": signal_ids,
                    "case_ids": sorted(set(case_ids)),
                    "mutated_case_ids": sorted(set(mutated)),
                }
                conn.execute(
                    "INSERT INTO analyzer_applications(job_id,result_hash,outcome_json,applied_at) VALUES(?,?,?,?)",
                    (job_id, result_hash, canonical_json(outcome), utc_now()),
                )
                conn.execute(
                    "UPDATE jobs SET state='succeeded',finished_at=?,error_code='',result_summary='analysis result applied' WHERE id=?",
                    (utc_now(), job_id),
                )
                self._event(conn, "job", "result_applied", job_id, {"result_hash": result_hash})
                self._event(conn, "job", "succeeded", job_id)
                conn.commit()
                return outcome
            except Exception:
                conn.rollback()
                raise
        finally:
            self._close_write(conn, lease)

    def update_job(
        self, job_id: int, state: str, *, error_code: str = "", result_summary: str = ""
    ) -> dict:
        if state not in {"running", "succeeded", "failed", "cancelled"}:
            raise ImprovementError("invalid_job_state", "invalid job state")
        error_code, result_summary = (
            bounded_text(error_code, 100),
            bounded_text(result_summary, 1200),
        )
        conn, lease = self._write_connect()
        now = utc_now()
        try:
            with conn:
                row = conn.execute("SELECT state FROM jobs WHERE id=?", (job_id,)).fetchone()
                if not row:
                    raise ImprovementError("job_not_found", "job not found", 404)
                started = now if state == "running" else None
                finished = now if state in {"succeeded", "failed", "cancelled"} else None
                conn.execute(
                    "UPDATE jobs SET state=?,started_at=COALESCE(started_at,?),finished_at=?,error_code=?,result_summary=? WHERE id=?",
                    (state, started, finished, error_code, result_summary, job_id),
                )
                self._event(conn, "job", state, job_id)
            return self._job_model(
                conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            )
        finally:
            self._close_write(conn, lease)

    def recover_jobs(self) -> int:
        conn, lease = self._write_connect()
        try:
            with conn:
                rows = conn.execute("SELECT id FROM jobs WHERE state='running'").fetchall()
                now = utc_now()
                conn.execute(
                    "UPDATE jobs SET state='failed',finished_at=?,error_code='platform_restarted' WHERE state='running'",
                    (now,),
                )
                for row in rows:
                    self._event(conn, "job", "failed", row[0], {"error_code": "platform_restarted"})
            return len(rows)
        finally:
            self._close_write(conn, lease)

    def record_eval_run(
        self,
        case_id: int,
        phase: str,
        repo: str,
        git_ref: str,
        result: Mapping[str, object],
        *,
        patch_hash: str | None = None,
        job_id: int | None = None,
    ) -> dict:
        repo, git_ref = bounded_text(repo, 500), bounded_text(git_ref, 64)
        patch_hash = bounded_text(patch_hash, 64) if patch_hash else None
        if (
            phase not in {"baseline", "candidate"}
            or not repo
            or not re.fullmatch(r"[0-9a-fA-F]{7,64}", git_ref)
        ):
            raise ImprovementError(
                "invalid_eval", "eval requires phase, repo, and immutable commit hash"
            )
        if patch_hash and not re.fullmatch(r"[0-9a-fA-F]{64}", patch_hash):
            raise ImprovementError("invalid_eval", "patch hash must be SHA-256")
        if job_id is None:
            raise ImprovementError("invalid_eval", "eval run must link a persisted eval job")
        conn, lease = self._write_connect()
        try:
            with conn:
                self._case_for_mutation(conn, case_id)
                pack = conn.execute(
                    "SELECT version,body_json,pack_hash FROM evaluation_packs WHERE case_id=?",
                    (case_id,),
                ).fetchone()
                if not pack:
                    raise ImprovementError("evaluation_pack_required", "case has no EvaluationPack")
                job = conn.execute(
                    "SELECT kind,state,recipe_id,request_json FROM jobs WHERE id=? AND scope=?",
                    (job_id, self.scope),
                ).fetchone()
                try:
                    job_request = json.loads(job["request_json"]) if job else None
                except (TypeError, json.JSONDecodeError):
                    job_request = None
                if (
                    not job
                    or job["kind"] != "eval"
                    or job["state"] not in {"queued", "running", "succeeded"}
                    or job["recipe_id"] != JOB_RECIPES["eval"]
                    or not isinstance(job_request, dict)
                    or job_request.get("case_id") != case_id
                    or job_request.get("phase") != phase
                    or job_request.get("repo") != repo
                    or job_request.get("git_ref") != git_ref
                    or job_request.get("pack_revision") != pack["version"]
                    or job_request.get("pack_hash") != pack["pack_hash"]
                ):
                    raise ImprovementError(
                        "invalid_eval", "eval run must link a succeeded persisted eval job"
                    )
                try:
                    current_pack = canonical_evaluation_pack(json.loads(pack["body_json"]))
                except (EvaluationContractError, TypeError, json.JSONDecodeError) as exc:
                    raise ImprovementError(
                        "invalid_eval", "persisted EvaluationPack is invalid"
                    ) from exc
                if (
                    job_request.get("pack_version") != current_pack["version"]
                    or evaluation_pack_hash(current_pack) != pack["pack_hash"]
                ):
                    raise ImprovementError(
                        "invalid_eval", "queued EvaluationPack no longer matches the case"
                    )
                result = sanitize_eval_result(
                    result,
                    expected_phase=phase,
                    expected_pack_version=job_request["pack_version"],
                    expected_pack_hash=pack["pack_hash"],
                    expected_git_ref=git_ref,
                )
                if str(result.get("job_id")) != str(job_id):
                    raise ImprovementError(
                        "invalid_eval", "eval result job identity does not match the queued job"
                    )
                normalized_patch = result.get("patch_hash") or None
                if patch_hash is not None and normalized_patch != patch_hash:
                    raise ImprovementError("invalid_eval", "eval result patch hash does not match")
                if normalized_patch and not re.fullmatch(r"[0-9a-fA-F]{64}", str(normalized_patch)):
                    raise ImprovementError("invalid_eval", "patch hash must be SHA-256")
                identity = _eval_run_identity(
                    case_id,
                    phase,
                    repo,
                    git_ref,
                    normalized_patch,
                    pack["version"],
                    pack["pack_hash"],
                    job_id,
                )
                existing = conn.execute(
                    "SELECT * FROM eval_runs WHERE job_id=? ORDER BY id LIMIT 1", (job_id,)
                ).fetchone()
                if existing:
                    try:
                        prior_result = json.loads(existing["result_json"])
                    except (TypeError, json.JSONDecodeError):
                        prior_result = {}
                    if (
                        prior_result.get("result_hash") != result["result_hash"]
                        or existing["run_identity"] != identity
                    ):
                        raise ImprovementError(
                            "eval_result_conflict",
                            "eval job already recorded a different result",
                            409,
                        )
                    if job["state"] != "succeeded":
                        conn.execute(
                            "UPDATE jobs SET state='succeeded',finished_at=?,error_code='',result_summary='evaluation result persisted' WHERE id=?",
                            (utc_now(), job_id),
                        )
                        self._event(conn, "job", "succeeded", job_id)
                    return dict(existing)
                cursor = conn.execute(
                    """INSERT INTO eval_runs(case_id,phase,repo,git_ref,patch_hash,result_json,job_id,created_at,pack_version,pack_hash,run_identity)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        case_id,
                        phase,
                        repo,
                        git_ref,
                        normalized_patch,
                        canonical_json(result),
                        job_id,
                        utc_now(),
                        pack["version"],
                        pack["pack_hash"],
                        identity,
                    ),
                )
                conn.execute(
                    "UPDATE jobs SET state='succeeded',finished_at=?,error_code='',result_summary='evaluation result persisted' WHERE id=?",
                    (utc_now(), job_id),
                )
                self._event(
                    conn,
                    "eval_run",
                    "recorded",
                    cursor.lastrowid,
                    {"case_id": case_id, "phase": phase},
                )
                self._event(conn, "job", "succeeded", job_id)
            return dict(
                conn.execute("SELECT * FROM eval_runs WHERE id=?", (cursor.lastrowid,)).fetchone()
            )
        finally:
            self._close_write(conn, lease)

    def start_monitoring(self, case_id: int, baseline_rate: float, at: str | None = None) -> dict:
        if baseline_rate < 0:
            raise ImprovementError("invalid_monitoring", "baseline rate cannot be negative")
        conn, lease = self._write_connect()
        now = at or utc_now()
        parse_timestamp(now)
        try:
            with conn:
                self._case_for_mutation(conn, case_id)
                conn.execute(
                    "INSERT INTO monitoring(case_id,started_at,baseline_rate,updated_at) VALUES(?,?,?,?) ON CONFLICT(case_id) DO NOTHING",
                    (case_id, now, baseline_rate, now),
                )
                self._event(conn, "monitoring", "started", case_id)
            return dict(
                conn.execute("SELECT * FROM monitoring WHERE case_id=?", (case_id,)).fetchone()
            )
        finally:
            self._close_write(conn, lease)

    def observe(
        self,
        case_id: int,
        *,
        matched: bool,
        severity: str | None = None,
        comparable: bool = True,
        at: str | None = None,
    ) -> dict:
        if severity is not None and severity not in SEVERITIES:
            raise ImprovementError("invalid_severity", "invalid severity")
        if matched and not comparable:
            raise ImprovementError("invalid_monitoring", "a matched observation must be comparable")
        conn, lease = self._write_connect()
        now = at or utc_now()
        current = parse_timestamp(now)
        try:
            with conn:
                self._case_for_mutation(conn, case_id)
                monitor = conn.execute(
                    "SELECT * FROM monitoring WHERE case_id=?", (case_id,)
                ).fetchone()
                if not monitor:
                    raise ImprovementError("monitoring_required", "monitoring has not started")
                conn.execute(
                    "INSERT INTO monitoring_observations(case_id,at,comparable,matched,severity) VALUES(?,?,?,?,?)",
                    (case_id, now, int(comparable), int(matched), severity),
                )
                conn.execute(
                    "UPDATE monitoring SET comparable_sessions=comparable_sessions+?,recurrence_count=recurrence_count+?,high_critical_count=high_critical_count+?,updated_at=? WHERE case_id=?",
                    (
                        int(comparable),
                        int(matched),
                        int(matched and severity in {"high", "critical"}),
                        now,
                        case_id,
                    ),
                )
                recent = conn.execute(
                    "SELECT matched,severity FROM monitoring_observations WHERE case_id=? AND at>=?",
                    (case_id, (current - timedelta(days=7)).isoformat()),
                ).fetchall()
                if (
                    any(r[0] and r[1] == "critical" for r in recent)
                    or sum(r[0] for r in recent) >= 2
                ):
                    case_state = conn.execute(
                        "SELECT state FROM cases WHERE id=?", (case_id,)
                    ).fetchone()[0]
                    if case_state != "regressed":
                        self._set_state(conn, case_id, "regressed", "monitoring recurrence")
                else:
                    updated = conn.execute(
                        "SELECT * FROM monitoring WHERE case_id=?", (case_id,)
                    ).fetchone()
                    complete = updated["comparable_sessions"] >= 10 or current >= parse_timestamp(
                        updated["started_at"]
                    ) + timedelta(days=30)
                    rate = updated["recurrence_count"] / max(updated["comparable_sessions"], 1)
                    if (
                        complete
                        and rate <= updated["baseline_rate"] * 0.5
                        and updated["high_critical_count"] == 0
                    ):
                        case_state = conn.execute(
                            "SELECT state FROM cases WHERE id=?", (case_id,)
                        ).fetchone()[0]
                        if case_state != "effective":
                            self._set_state(
                                conn, case_id, "effective", "monitoring effectiveness threshold met"
                            )
                self._event(conn, "monitoring", "observed", case_id)
            return self.case(case_id)
        finally:
            self._close_write(conn, lease)

    def events(self, after_id: int = 0) -> list[dict]:
        conn = self.connect()
        if not conn:
            return []
        try:
            return [
                dict(r) | {"payload": json.loads(r["payload_json"])}
                for r in conn.execute("SELECT * FROM events WHERE id>? ORDER BY id", (after_id,))
            ]
        finally:
            conn.close()

    def jobs(self) -> list[dict]:
        conn = self.connect()
        if not conn:
            return []
        try:
            return [
                self._job_model(row) for row in conn.execute("SELECT * FROM jobs ORDER BY id DESC")
            ]
        finally:
            conn.close()

    def read_model(self) -> dict:
        return {
            "interface_version": API_VERSION,
            "scope": self.scope,
            "profile": self.profile(),
            "jobs": self.jobs(),
            "cases": self.cases(),
            "signal_summary": self.signal_summary(),
        }

    def eval_guard(
        self,
        case_id: int,
        severity: str,
        *,
        monitoring_started: bool = False,
        closing_summary: str = "",
        force: bool = False,
    ) -> dict:
        if force:
            return improvement_eval_guard(severity, (), force=True)
        conn = self.connect()
        if not conn:
            return improvement_eval_guard(
                severity, (), monitoring_started=monitoring_started, closing_summary=closing_summary
            )
        try:
            case = conn.execute(
                "SELECT planning_work_item FROM cases WHERE id=?", (case_id,)
            ).fetchone()
            version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            pack_query = (
                "SELECT version,pack_hash FROM evaluation_packs WHERE case_id=?"
                if version >= 3
                else "SELECT version,'' AS pack_hash FROM evaluation_packs WHERE case_id=?"
            )
            pack = conn.execute(pack_query, (case_id,)).fetchone()
            if not case or case["planning_work_item"] is None or not pack:
                runs = []
            else:
                runs = []
                for row in conn.execute(
                    """SELECT r.* FROM eval_runs r JOIN jobs j ON j.id=r.job_id
                    WHERE r.case_id=? AND j.kind='eval' AND j.state='succeeded' ORDER BY r.id""",
                    (case_id,),
                ):
                    runs.append(dict(row) | {"result": json.loads(row["result_json"])})
            return improvement_eval_guard(
                severity,
                runs,
                case_id=case_id,
                evaluation_pack_version=pack["version"] if pack else None,
                evaluation_pack_hash=pack["pack_hash"] if pack else None,
                monitoring_started=monitoring_started,
                closing_summary=closing_summary,
                _persisted_run_ids=frozenset(row["id"] for row in runs),
            )
        finally:
            conn.close()


def improvement_eval_guard(
    severity: str,
    eval_runs: Sequence[Mapping[str, object]],
    *,
    case_id: int | None = None,
    evaluation_pack_version: int | None = None,
    evaluation_pack_hash: str | None = None,
    monitoring_started: bool = False,
    closing_summary: str = "",
    force: bool = False,
    _persisted_run_ids: frozenset[int] | None = None,
) -> dict:
    """Pure transition helper for Planning's existing Done choke point."""
    if severity not in SEVERITIES:
        raise ImprovementError("invalid_severity", "invalid severity")
    if force:
        return {"allowed": True, "guard": "improvement_eval", "overridden": True}

    def result(run: Mapping[str, object]) -> Mapping[str, object]:
        nested = run.get("result")
        return nested if isinstance(nested, Mapping) else run

    def valid(run: Mapping[str, object], phase: str) -> bool:
        required = (
            case_id is not None
            and evaluation_pack_version is not None
            and evaluation_pack_hash
            and run.get("phase") == phase
            and run.get("case_id") == case_id
            and run.get("pack_version") == evaluation_pack_version
            and run.get("pack_hash") == evaluation_pack_hash
            and isinstance(run.get("id"), int)
            and _persisted_run_ids is not None
            and run.get("id") in _persisted_run_ids
            and isinstance(run.get("job_id"), int)
            and bool(run.get("run_identity"))
        )
        if not required:
            return False
        expected = _eval_run_identity(
            case_id,
            phase,
            str(run.get("repo", "")),
            str(run.get("git_ref", "")),
            run.get("patch_hash"),
            evaluation_pack_version,
            evaluation_pack_hash,
            int(run["job_id"]),
        )
        return run.get("run_identity") == expected

    def safe_facts(run: Mapping[str, object]) -> bool:
        facts = result(run)
        return (
            facts.get("cleanup_verified") is True
            and facts.get("source_unchanged") is True
            and facts.get("registrations_unchanged") is True
            and facts.get("refs_unchanged") is True
            and facts.get("infrastructure_failure") is False
            and facts.get("error_code") in (None, "")
            and not facts.get("safety_regressions")
            and not facts.get("guard_regressions")
        )

    baselines = [
        r
        for r in eval_runs
        if valid(r, "baseline")
        and safe_facts(r)
        and result(r).get("baseline_failure_designated") is True
        and result(r).get("reproduced_failure") is True
    ]
    candidates = [
        r
        for r in eval_runs
        if valid(r, "candidate") and safe_facts(r) and result(r).get("passed") is True
    ]
    passing = any(
        before.get("repo") == after.get("repo")
        and before.get("run_identity") != after.get("run_identity")
        and before.get("job_id") != after.get("job_id")
        and before.get("git_ref") != after.get("git_ref")
        and before.get("patch_hash") != after.get("patch_hash")
        and bool(re.fullmatch(r"[0-9a-fA-F]{64}", str(before.get("patch_hash", ""))))
        and bool(re.fullmatch(r"[0-9a-fA-F]{64}", str(after.get("patch_hash", ""))))
        for before in baselines
        for after in candidates
    )
    if severity in {"medium", "high", "critical"}:
        allowed, message = (
            passing,
            "medium/high Done requires reproduced baseline and a passing linked candidate eval",
        )
    else:
        allowed = passing or (monitoring_started and bool(closing_summary.strip()))
        message = "low Done requires a passing eval or started monitoring with a closing summary"
    return {
        "allowed": allowed,
        "guard": "improvement_eval",
        "overridden": False,
        **({} if allowed else {"message": message}),
    }
