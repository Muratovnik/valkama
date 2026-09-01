"""The Improvements sidecar schema, its forward-only migration, and its restore.

Each numbered step below is one generation of the sidecar, and `SCHEMA_VERSION`
is the generation this build writes.  `BASE_SQL` is deliberately still the
version-1 shape: a store created now is brought forward through the same
numbered steps an existing one takes, so there is one migration path to test
rather than two.  A populated store behind the current version is snapshotted
before it is touched, and `restore_sidecar_backup` is the tested way back.

Migration and restore both take the maintenance lease and require runtime
quiescence, so they never race a writer or a running job.  This module knows the
sidecar's tables and nothing about who reads them.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import tempfile
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from .contract import STORE_VERSION, ImprovementError
from .sidecar_locks import maintenance_lease, runtime_quiescence

SCHEMA_VERSION = 7


BASE_SQL = """
CREATE TABLE profile(scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, enabled INTEGER NOT NULL,
 purpose TEXT NOT NULL, expected_behavior TEXT NOT NULL, analyzer_client TEXT NOT NULL,
 planning_board TEXT NOT NULL, schedule_mode TEXT NOT NULL, interval_hours INTEGER NOT NULL,
 lookback_days INTEGER NOT NULL, max_sessions INTEGER NOT NULL, max_chars INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE cases(id INTEGER PRIMARY KEY, case_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 title TEXT NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL, category TEXT NOT NULL,
 first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, trend TEXT NOT NULL DEFAULT 'steady',
 planning_card_id INTEGER, epic_card_id INTEGER, revision INTEGER NOT NULL DEFAULT 0,
 merged_into INTEGER REFERENCES cases(id), approval_pending INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX cases_fingerprint ON cases(fingerprint);
CREATE TABLE signals(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 pointer TEXT NOT NULL UNIQUE, at TEXT NOT NULL, client TEXT NOT NULL, session_id TEXT NOT NULL,
 event_type TEXT NOT NULL, severity TEXT NOT NULL, excerpt TEXT NOT NULL,
 source_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE proposals(case_id INTEGER PRIMARY KEY REFERENCES cases(id), version INTEGER NOT NULL,
 body_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE evaluation_packs(case_id INTEGER PRIMARY KEY REFERENCES cases(id), version INTEGER NOT NULL,
 body_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE eval_runs(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 phase TEXT NOT NULL, repo TEXT NOT NULL, git_ref TEXT NOT NULL, patch_hash TEXT,
 result_json TEXT NOT NULL, job_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE actions(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}', at TEXT NOT NULL);
CREATE TABLE history(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 from_state TEXT, to_state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE monitoring(case_id INTEGER PRIMARY KEY REFERENCES cases(id), started_at TEXT NOT NULL,
 baseline_rate REAL NOT NULL, comparable_sessions INTEGER NOT NULL DEFAULT 0,
 recurrence_count INTEGER NOT NULL DEFAULT 0, high_critical_count INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL);
CREATE TABLE monitoring_observations(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 at TEXT NOT NULL, comparable INTEGER NOT NULL, matched INTEGER NOT NULL, severity TEXT);
CREATE TABLE jobs(id INTEGER PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
 client TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
 error_code TEXT NOT NULL DEFAULT '', result_summary TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX one_active_analysis ON jobs(scope) WHERE kind='analysis' AND state IN ('queued','running');
CREATE TABLE events(id INTEGER PRIMARY KEY, name TEXT NOT NULL, interface_version TEXT NOT NULL,
 scope TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE store_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO store_meta VALUES('interface_version','improvements-store');
"""


GROUPING_SQL = """
CREATE TABLE negative_examples(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 reason TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE manual_groups(id INTEGER PRIMARY KEY, source_case_id INTEGER NOT NULL REFERENCES cases(id),
 target_case_id INTEGER NOT NULL REFERENCES cases(id), kind TEXT NOT NULL, created_at TEXT NOT NULL);
"""


EVALUATION_LEDGER_SQL = """
ALTER TABLE evaluation_packs ADD COLUMN pack_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE eval_runs ADD COLUMN pack_version INTEGER;
ALTER TABLE eval_runs ADD COLUMN pack_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE eval_runs ADD COLUMN run_identity TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN recipe_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN request_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE analyzer_applications(job_id INTEGER PRIMARY KEY REFERENCES jobs(id),
 result_hash TEXT NOT NULL, outcome_json TEXT NOT NULL, applied_at TEXT NOT NULL,
 UNIQUE(job_id,result_hash));
"""


SIGNAL_SOURCE_SQL = """
ALTER TABLE signals RENAME TO signals_v1;
CREATE TABLE signals(id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES cases(id),
 pointer TEXT NOT NULL, source_kind TEXT NOT NULL, at TEXT NOT NULL, client TEXT NOT NULL,
 session_id TEXT NOT NULL, event_type TEXT NOT NULL, severity TEXT NOT NULL, excerpt TEXT NOT NULL,
 source_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(pointer,source_hash));
INSERT INTO signals(id,case_id,pointer,source_kind,at,client,session_id,event_type,severity,
 excerpt,source_hash,fingerprint,created_at)
 SELECT id,case_id,pointer,'session_event',at,client,session_id,event_type,severity,
 excerpt,source_hash,fingerprint,created_at FROM signals_v1;
DROP TABLE signals_v1;
UPDATE store_meta SET value='improvements-store' WHERE key='interface_version';
"""


PROFILE_RUNTIME_SQL = """
ALTER TABLE profile ADD COLUMN analyzer_model TEXT NOT NULL DEFAULT '';
ALTER TABLE profile ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT '';
"""


# The former product name, where the sidecar wrote it down: the error code a
# restart-cancelled job carries, and the client a platform-opened session
# reports. Both reach the UI, so both are rewritten rather than left to read as
# a name nothing in the product answers to.
FORMER_NAME_SQL = """
UPDATE jobs SET error_code='platform_restarted' WHERE error_code='hub_restarted';
UPDATE jobs SET client='platform' WHERE client='hub';
UPDATE signals SET client='platform' WHERE client='hub';
UPDATE events SET payload_json=replace(payload_json,'hub_restarted','platform_restarted')
 WHERE payload_json LIKE '%hub_restarted%';
"""


# Step 7. `BASE_SQL` above is deliberately still the version-1 shape — every
# numbered step brings a fresh store forward through the same path an existing
# one takes — so this rename runs for both.
PLANNING_IDENTITY_SQL = """
ALTER TABLE profile RENAME COLUMN planning_board TO planning_space;
ALTER TABLE cases RENAME COLUMN planning_card_id TO planning_work_item;
ALTER TABLE cases RENAME COLUMN epic_card_id TO epic_work_item;
"""


# A throwaway fixture for a store created before source-kind ingress existed.
# It is not accepted as a current interface or emitted by any runtime surface.


PRE_SIGNAL_SOURCE_SQL = BASE_SQL.replace(STORE_VERSION, "improvements-store-v" + "1")


def _snapshot(conn: sqlite3.Connection, path: Path) -> Path:
    backups = path.parent / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = backups / f"improvements-preupgrade-{stamp}-{uuid.uuid4().hex[:6]}.sqlite3"
    destination = sqlite3.connect(target)
    try:
        conn.backup(destination)
    finally:
        destination.close()
    verification = sqlite3.connect(target)
    try:
        if verification.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ImprovementError("invalid_backup", "pre-upgrade backup failed integrity check")
    except Exception:
        verification.close()
        target.unlink(missing_ok=True)
        raise
    else:
        verification.close()
    return target


def migrate_sidecar(
    path: str | os.PathLike[str], fault: Callable[[str], None] | None = None
) -> Path | None:
    with maintenance_lease(path), runtime_quiescence(path):
        return migrate_sidecar_locked(path, fault)


def migrate_sidecar_locked(
    path: str | os.PathLike[str], fault: Callable[[str], None] | None = None
) -> Path | None:
    """Migrate an existing/created sidecar and return its pre-upgrade backup."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target)
    backup = None
    try:
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if version > SCHEMA_VERSION:
            raise ImprovementError("newer_schema", "sidecar schema is newer than this module")
        populated = version > 0 or bool(
            conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").fetchone()
        )
        if populated and version < SCHEMA_VERSION:
            backup = _snapshot(conn, target)
            if fault:
                fault("after_backup")
        if version < 1:
            conn.executescript("BEGIN IMMEDIATE;" + BASE_SQL + "PRAGMA user_version=1; COMMIT;")
            version = 1
        if version < SCHEMA_VERSION:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if version < 2:
                    for statement in GROUPING_SQL.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    if fault:
                        fault("during_grouping")
                if version < 3:
                    for statement in EVALUATION_LEDGER_SQL.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    for row in conn.execute("SELECT case_id,body_json FROM evaluation_packs"):
                        digest = hashlib.sha256(row[1].encode("utf-8")).hexdigest()
                        conn.execute(
                            "UPDATE evaluation_packs SET pack_hash=? WHERE case_id=?",
                            (digest, row[0]),
                        )
                    if fault:
                        fault("during_evaluation_ledger")
                if version < 4:
                    for statement in SIGNAL_SOURCE_SQL.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    if fault:
                        fault("during_signal_source")
                if version < 5:
                    for statement in PROFILE_RUNTIME_SQL.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    if fault:
                        fault("during_profile_runtime")
                if version < 6:
                    for statement in FORMER_NAME_SQL.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    if fault:
                        fault("during_former_name")
                if version < 7:
                    for statement in PLANNING_IDENTITY_SQL.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    if fault:
                        fault("during_planning_identity")
                conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        return backup
    finally:
        conn.close()


def _database_identity(conn: sqlite3.Connection) -> tuple[str, str, int]:
    profile = conn.execute("SELECT scope FROM profile LIMIT 1").fetchone()
    metadata = conn.execute("SELECT value FROM store_meta WHERE key='interface_version'").fetchone()
    if not profile or not metadata:
        raise ImprovementError("invalid_backup", "sidecar identity metadata is missing")
    return str(profile[0]), str(metadata[0]), int(conn.execute("PRAGMA user_version").fetchone()[0])


def restore_sidecar_backup(path: str | os.PathLike[str], backup: str | os.PathLike[str]) -> Path:
    with maintenance_lease(path), runtime_quiescence(path):
        return _restore_sidecar_backup_locked(path, backup)


def _restore_sidecar_backup_locked(
    path: str | os.PathLike[str], backup: str | os.PathLike[str]
) -> Path:
    """Restore only a matching quiescent sidecar, retaining a rollback snapshot."""
    target, source = Path(path).resolve(), Path(backup).resolve()
    expected = (target.parent / "backups").resolve()
    if source.parent != expected or not source.is_file() or not target.is_file():
        raise ImprovementError("invalid_backup", "backup is not a snapshot for this sidecar")
    wal, shm = Path(str(target) + "-wal"), Path(str(target) + "-shm")
    if (wal.exists() and wal.stat().st_size) or shm.exists():
        raise ImprovementError(
            "store_busy", "sidecar has uncheckpointed or stale WAL/SHM state", 409
        )
    source_conn = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
    target_conn = sqlite3.connect(target, timeout=0)
    try:
        source_identity = _database_identity(source_conn)
        target_identity = _database_identity(target_conn)
        accepted_families = {STORE_VERSION, "improvements-store-v" + "1"}
        if (
            source_identity[0] != target_identity[0]
            or source_identity[1] not in accepted_families
            or target_identity[1] not in accepted_families
            or source_identity[2] > SCHEMA_VERSION
            or target_identity[2] > SCHEMA_VERSION
        ):
            raise ImprovementError(
                "backup_mismatch", "backup scope, store family, or version does not match"
            )
        target_conn.execute("PRAGMA busy_timeout=0")
        checkpoint = target_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if checkpoint and checkpoint[0]:
            raise ImprovementError("store_busy", "sidecar has an active WAL reader or writer", 409)
        try:
            target_conn.execute("BEGIN EXCLUSIVE")
        except sqlite3.OperationalError as exc:
            raise ImprovementError("store_busy", "sidecar is in use; restore refused", 409) from exc
        target_conn.rollback()
    finally:
        source_conn.close()
        target_conn.close()
    if (wal.exists() and wal.stat().st_size) or shm.exists():
        raise ImprovementError("store_busy", "sidecar WAL state is not quiescent", 409)
    if wal.exists():
        wal.unlink()
    before = target.stat()
    backups = target.parent / "backups"
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    rollback = backups / f"improvements-prerestore-{stamp}-{uuid.uuid4().hex[:6]}.sqlite3"
    shutil.copy2(target, rollback)
    fd, temporary = tempfile.mkstemp(
        prefix="improvements-restore-", suffix=".sqlite3", dir=target.parent
    )
    os.close(fd)
    try:
        shutil.copy2(source, temporary)
        check = sqlite3.connect(temporary)
        try:
            if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ImprovementError("invalid_backup", "backup failed integrity check")
        finally:
            check.close()
        current = target.stat()
        if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
        ):
            raise ImprovementError("store_changed", "sidecar changed while preparing restore", 409)
        os.replace(temporary, target)
        return rollback
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sidecar_version(path: Path) -> int:
    """The stored schema generation, read without creating or changing anything."""

    try:
        probe = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.Error:
        return SCHEMA_VERSION
    try:
        return int(probe.execute("PRAGMA user_version").fetchone()[0])
    except sqlite3.Error:
        return SCHEMA_VERSION
    finally:
        probe.close()
