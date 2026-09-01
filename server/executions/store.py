"""The tables one attempt at a work item leaves behind.

Before this, an attempt existed only inside the process that spawned it:
`Runner._running` held it, a comment on the item narrated it, and both were
gone once the platform restarted. So a work item could say who claimed it and
what a launch had said afterwards, and could not say how many attempts there
had been, which client each ran on, what the repository looked like when one
started, or which of them the running session belongs to.

Three properties are deliberate.

An execution names the work item by its stored identity rather than by its
reference, because a reference is `KEY-NUMBER` and a space that is renamed
changes every reference in it while changing nothing about the work.

The session link is a table rather than a column, because the relation is not
one-to-one: a resumed attempt continues inside the session the previous one
opened, an orchestration may spawn children, and an interactive session may be
attached to an attempt after the fact. Which of those it is stays on the row.

The Git baseline is a snapshot, not a pointer. `base_artifact_json` records what
the checkout was when the attempt began — head, branch, dirty or not — because
by the time anyone reads it, the checkout has moved on and the question being
asked is what this attempt changed.
"""

from __future__ import annotations

_NOW = "(strftime('%Y-%m-%dT%H:%M:%SZ','now'))"

#: The durable lifecycle of an attempt. `queued` and `waiting` from the layer-2
#: plan are deliberately absent: nothing schedules an attempt, so no row could
#: ever be queued, and waiting is a property of the session that is answering —
#: it is derived in the read model beside `presence`, exactly as the session
#: monitor derives `stale`, rather than stored as a status that can go stale on
#: its own.
STATUSES = (
    "starting",
    "running",
    "complete",
    "partial",
    "refused",
    "failed",
    "cancelled",
    # An attempt recorded after the fact, for a session Valkama did not run.
    # Its own status, because every other one is a verdict on a delivery and
    # this platform has no grounds for one: it did not spawn the process, did
    # not read its result, and did not see the checkout it started from.
    "attached",
)

#: How a session came to belong to an attempt. Never inferred: `attached` is a
#: person saying so, and the other two are recorded by the launch that caused
#: them.
SESSION_RELATIONS = ("launched", "resumed", "attached")

_STATUS_SQL = ",".join(f"'{status}'" for status in STATUSES)
_RELATION_SQL = ",".join(f"'{relation}'" for relation in SESSION_RELATIONS)

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS executions(
    execution_id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL DEFAULT '',
    adapter_lineage_id TEXT NOT NULL DEFAULT '',
    client_family TEXT NOT NULL,
    role TEXT NOT NULL,
    environment TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    effort TEXT NOT NULL DEFAULT '',
    expected_effect TEXT NOT NULL,
    review_mode TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ({_STATUS_SQL})),
    outcome TEXT NOT NULL DEFAULT '',
    launch_id TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    resumed_from TEXT NOT NULL DEFAULT '',
    exit_code INTEGER,
    result_json TEXT NOT NULL DEFAULT '',
    base_artifact_json TEXT NOT NULL DEFAULT '',
    final_artifact_json TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT {_NOW},
    ended_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS executions_work_item
    ON executions(work_item_id, started_at DESC);
CREATE INDEX IF NOT EXISTS executions_open
    ON executions(status) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS execution_sessions(
    execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK(relation IN ({_RELATION_SQL})),
    linked_at TEXT NOT NULL DEFAULT {_NOW},
    PRIMARY KEY(execution_id, session_id)
);
CREATE INDEX IF NOT EXISTS execution_sessions_session
    ON execution_sessions(session_id);
"""

SCHEMA_TABLES = ("executions", "execution_sessions")

__all__ = ["SCHEMA", "SCHEMA_TABLES", "SESSION_RELATIONS", "STATUSES"]
