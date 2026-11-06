-- Every statement in sqlite_master of a fresh store the last schema-12 build
-- created, in creation order, captured once from that build. Read by
-- tests/schema12.py.
CREATE TABLE planning_spaces(
    planning_space_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    provider_kind TEXT NOT NULL DEFAULT 'local' CHECK(provider_kind IN ('local')),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(project_id, name)
);
CREATE TABLE workflows(
    workflow_id TEXT PRIMARY KEY,
    planning_space_id TEXT NOT NULL
        REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    initial_state_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(planning_space_id, name)
);
CREATE TABLE workflow_states(
    state_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('backlog','queued','active','review','completed','blocked','cancelled')),
    position INTEGER NOT NULL,
    is_terminal INTEGER NOT NULL DEFAULT 0 CHECK(is_terminal IN (0,1)),
    UNIQUE(workflow_id, key),
    UNIQUE(workflow_id, position)
);
CREATE TABLE workflow_transitions(
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    from_state_id TEXT NOT NULL REFERENCES workflow_states(state_id) ON DELETE CASCADE,
    to_state_id TEXT NOT NULL REFERENCES workflow_states(state_id) ON DELETE CASCADE,
    PRIMARY KEY(workflow_id, from_state_id, to_state_id)
);
CREATE TABLE work_items(
    work_item_id TEXT PRIMARY KEY,
    planning_space_id TEXT NOT NULL
        REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number >= 1),
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id),
    state_id TEXT NOT NULL REFERENCES workflow_states(state_id),
    kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('bug','epic','improvement','task')),
    parent_id TEXT REFERENCES work_items(work_item_id),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
    -- Written by nothing and read by nothing: a durable owner distinct from the
    -- current holder was designed and never built, and `claim_ref` below is the
    -- only ownership this domain actually has. It stopped being published in the
    -- payload once that was noticed. The column stays because dropping it would
    -- change what a row is and so would raise the schema ratchet, refusing every
    -- older build over a field that was always empty; the next migration with a
    -- reason of its own can take it.
    owner_ref TEXT NOT NULL DEFAULT '',
    claim_ref TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    summary_comment_id INTEGER REFERENCES work_item_comments(id) ON DELETE SET NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT '',
    checklist TEXT NOT NULL DEFAULT '[]',
    position REAL NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    -- The write call that took the current claim: its session, agent, time and
    -- whether that identity was confirmed are read from that row, so they are
    -- never a second copy here. NULL for a claim recorded before identity
    -- existed, and for one an older build wrote; see `migrate_identity`.
    claim_call_id INTEGER REFERENCES execution_events(id),
    UNIQUE(planning_space_id, number)
);
CREATE INDEX work_items_state
  ON work_items(planning_space_id, state_id, position);
CREATE INDEX work_items_parent ON work_items(parent_id);
CREATE UNIQUE INDEX work_items_improvement_source
  ON work_items(source) WHERE source LIKE 'improvement://%';
CREATE TABLE work_item_links(
    id INTEGER PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('blocks','discovered-from','duplicates','relates-to')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(from_id, to_id, kind)
);
CREATE TABLE work_item_comments(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    author TEXT NOT NULL DEFAULT 'agent',
    body TEXT NOT NULL,
    report TEXT NOT NULL DEFAULT '',
    checklist_item_id TEXT,
    checklist_item_text TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    call_id INTEGER REFERENCES execution_events(id),
    reply_to INTEGER REFERENCES work_item_comments(id) ON DELETE CASCADE,
    reply_to_request TEXT REFERENCES work_item_requests(request_id) ON DELETE CASCADE,
    resolved_at TEXT,
    resolved_by TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT '',
    resolved_call_id INTEGER REFERENCES execution_events(id)
);
CREATE INDEX work_item_comments_item ON work_item_comments(work_item_id, id);
CREATE TABLE work_item_refs(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('commit','memory','session','url')),
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    call_id INTEGER REFERENCES execution_events(id),
    UNIQUE(work_item_id, kind, value)
);
CREATE TABLE work_item_events(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('created','transitioned','claimed','released','taken_over','linked','unlinked','checklist_replaced','checklist_claimed','checklist_taken_over','checklist_released','checklist_completed','checklist_reopened','summarized','execution_attached','overridden','request_created','request_answered','request_declined','request_expired','comment_resolved','comment_reopened','request_changed','mentioned')),
    detail TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    call_id INTEGER REFERENCES execution_events(id)
);
CREATE INDEX work_item_events_item ON work_item_events(work_item_id, id);
CREATE TABLE work_item_requests(
    request_id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('question','decision')),
    prompt TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    answers_json TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','declined','expired')),
    author TEXT NOT NULL,
    answered_by TEXT NOT NULL DEFAULT '',
    execution_id TEXT REFERENCES executions(execution_id),
    session_id TEXT REFERENCES sessions(id),
    expires_at TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    expired_reason TEXT CHECK(expired_reason IN ('deadline','withdrawn','execution_closed','task_closed')),
    answer_version INTEGER NOT NULL DEFAULT 0,
    comment_id INTEGER REFERENCES work_item_comments(id) ON DELETE CASCADE
);
CREATE INDEX work_item_requests_item ON work_item_requests(work_item_id,created_at);
CREATE TABLE work_item_request_answers(
    request_id TEXT NOT NULL REFERENCES work_item_requests(request_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version >= 1),
    answers_json TEXT NOT NULL,
    answered_by TEXT NOT NULL,
    answered_at TEXT NOT NULL,
    call_id INTEGER REFERENCES execution_events(id),
    PRIMARY KEY(request_id, version)
);
CREATE TABLE pinned_work_items(
    work_item_id TEXT PRIMARY KEY REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    call_id INTEGER REFERENCES execution_events(id)
);
CREATE TABLE sessions(
    id TEXT PRIMARY KEY,
    client TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    work_item_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','failed')),
    attention TEXT NOT NULL DEFAULT '',
    attention_seen INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ended_at TEXT,
    parent_session_id TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL DEFAULT '',
    transcript_path TEXT NOT NULL DEFAULT '',
    client_version TEXT NOT NULL DEFAULT '',
    opened_in TEXT NOT NULL DEFAULT '',
    opened_host TEXT NOT NULL DEFAULT '',
    opened_folder TEXT NOT NULL DEFAULT '',
    host_session_id TEXT NOT NULL DEFAULT ''
);
CREATE TABLE session_events(
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    klass TEXT NOT NULL CHECK(klass IN ('analytics','stream')),
    kind TEXT NOT NULL,
    tool TEXT NOT NULL DEFAULT '',
    server TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX session_events_session ON session_events(session_id, id);
CREATE INDEX session_events_klass ON session_events(klass, id);
CREATE TABLE execution_events(
    id INTEGER PRIMARY KEY,
    event_uid TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    identity_state TEXT NOT NULL,
    identity_source TEXT NOT NULL,
    delivery TEXT NOT NULL DEFAULT 'direct',
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    occurred_at TEXT,
    spooled_at TEXT,
    client TEXT,
    client_version TEXT,
    hook_event TEXT,
    tool TEXT,
    session_id TEXT,
    agent_id TEXT,
    agent_type TEXT,
    parent_session_id TEXT,
    turn_id TEXT,
    tool_use_id TEXT,
    permission_mode TEXT,
    model TEXT,
    source TEXT,
    reason TEXT,
    cwd TEXT,
    transcript_path TEXT,
    archive_path TEXT,
    archive_sha256 TEXT,
    work_item_id TEXT
);
CREATE INDEX execution_events_session
    ON execution_events(session_id, id) WHERE session_id IS NOT NULL;
CREATE TRIGGER execution_events_append_only_update
BEFORE UPDATE ON execution_events
BEGIN
    SELECT RAISE(ABORT, 'execution_events is append-only');
END;
CREATE TRIGGER execution_events_append_only_delete
BEFORE DELETE ON execution_events
BEGIN
    SELECT RAISE(ABORT, 'execution_events is append-only');
END;
CREATE TABLE executions(
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
    status TEXT NOT NULL CHECK(status IN ('starting','running','complete','partial','refused','failed','cancelled','attached')),
    outcome TEXT NOT NULL DEFAULT '',
    launch_id TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    resumed_from TEXT NOT NULL DEFAULT '',
    exit_code INTEGER,
    result_json TEXT NOT NULL DEFAULT '',
    base_artifact_json TEXT NOT NULL DEFAULT '',
    final_artifact_json TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ended_at TEXT,
    revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX executions_work_item
    ON executions(work_item_id, started_at DESC);
CREATE INDEX executions_open
    ON executions(status) WHERE ended_at IS NULL;
CREATE TABLE execution_sessions(
    execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK(relation IN ('launched','resumed','attached')),
    linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY(execution_id, session_id)
);
CREATE INDEX execution_sessions_session
    ON execution_sessions(session_id);
CREATE TABLE platform_store_metadata(
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    data_scope_id TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0, 1)),
    is_writable INTEGER NOT NULL CHECK(is_writable IN (0, 1)),
    created_at TEXT NOT NULL
);
CREATE TABLE platform_ui_prefs(
    key TEXT PRIMARY KEY CHECK(key='last-route'),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE owner_alert_settings(
    key TEXT PRIMARY KEY CHECK(key='settings'),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE usage_runs(
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reading'
        CHECK(status IN ('reading','missing','truncated','unreadable')),
    read_offset INTEGER NOT NULL DEFAULT 0,
    events_after INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT '{}',
    packet_item TEXT,
    human_seconds REAL NOT NULL DEFAULT 0,
    subagent_seconds REAL NOT NULL DEFAULT 0,
    external_seconds REAL NOT NULL DEFAULT 0,
    gap_seconds REAL NOT NULL DEFAULT 0,
    first_at TEXT,
    last_at TEXT,
    read_at TEXT,
    UNIQUE(session_id, agent_id)
);
CREATE TABLE usage_segments(
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES usage_runs(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    model TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    seconds REAL NOT NULL,
    work_item_id TEXT,
    signal TEXT,
    input_tokens INTEGER,
    cached_read_tokens INTEGER,
    cache_write_5m_tokens INTEGER,
    cache_write_1h_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    estimated_api_cost_usd REAL,
    price_book TEXT,
    quality TEXT NOT NULL CHECK(quality IN ('observed','estimated')),
    provisional INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX usage_segments_item
    ON usage_segments(work_item_id, started_at) WHERE work_item_id IS NOT NULL;
CREATE INDEX usage_segments_session
    ON usage_segments(session_id, agent_id, started_at);
CREATE INDEX usage_segments_provisional
    ON usage_segments(run_id) WHERE provisional = 1;
CREATE TABLE usage_requests(
    run_id INTEGER NOT NULL,
    request INTEGER NOT NULL,
    PRIMARY KEY(run_id, request)
) WITHOUT ROWID;
CREATE TRIGGER work_items_summary_matches_report
        BEFORE UPDATE OF summary,summary_comment_id ON work_items
        WHEN (NEW.summary = '' AND NEW.summary_comment_id IS NOT NULL)
          OR (NEW.summary != '' AND NOT EXISTS (
            SELECT 1 FROM work_item_comments report
            WHERE report.id = NEW.summary_comment_id
              AND report.work_item_id = NEW.work_item_id
              AND CASE WHEN json_valid(report.report) AND json_valid(NEW.summary) THEN
                json_extract(report.report,'$.done') = json_extract(NEW.summary,'$.done')
                AND json_extract(report.report,'$.next') = json_extract(NEW.summary,'$.next')
                AND coalesce(json_extract(report.report,'$.why'),'') =
                    coalesce(json_extract(NEW.summary,'$.why'),'')
              ELSE 0 END
          ))
        BEGIN
            SELECT RAISE(ABORT, 'work item summary must match its selected report');
        END;
CREATE TRIGGER work_items_claim_follows_call
AFTER UPDATE OF claim_ref ON work_items
WHEN NEW.claim_call_id IS OLD.claim_call_id AND NEW.claim_call_id IS NOT NULL
BEGIN
    UPDATE work_items SET claim_call_id = NULL WHERE work_item_id = NEW.work_item_id;
END;
CREATE INDEX sessions_parent ON sessions(parent_session_id) WHERE parent_session_id != '';
CREATE INDEX work_item_comments_reply_to ON work_item_comments(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX work_item_comments_reply_to_request ON work_item_comments(reply_to_request) WHERE reply_to_request IS NOT NULL;
CREATE INDEX work_item_comments_unresolved ON work_item_comments(work_item_id, id) WHERE reply_to IS NULL AND reply_to_request IS NULL AND resolved_at IS NULL;
CREATE INDEX work_item_requests_comment ON work_item_requests(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX work_item_events_mentioned ON work_item_events(detail) WHERE action = 'mentioned';
CREATE TRIGGER work_item_comments_thread_shape_insert BEFORE INSERT ON work_item_comments BEGIN
    SELECT RAISE(ABORT, 'a reply names one parent: a comment or a question')
    WHERE NEW.reply_to IS NOT NULL AND NEW.reply_to_request IS NOT NULL;
    SELECT RAISE(ABORT, 'a reply answers a root, not another reply')
    WHERE EXISTS (
        SELECT 1 FROM work_item_comments parent
        WHERE parent.id = NEW.reply_to
          AND (parent.reply_to IS NOT NULL OR parent.reply_to_request IS NOT NULL)
    );
    SELECT RAISE(ABORT, 'a reply stays on the same work item as its parent')
    WHERE EXISTS (
        SELECT 1 FROM work_item_comments parent
        WHERE parent.id = NEW.reply_to AND parent.work_item_id != NEW.work_item_id
    ) OR EXISTS (
        SELECT 1 FROM work_item_requests parent
        WHERE parent.request_id = NEW.reply_to_request
          AND parent.work_item_id != NEW.work_item_id
    );
    SELECT RAISE(ABORT, 'only a root is resolved')
    WHERE NEW.resolved_at IS NOT NULL
      AND (NEW.reply_to IS NOT NULL OR NEW.reply_to_request IS NOT NULL);
END;
CREATE TRIGGER work_item_comments_thread_shape_update BEFORE UPDATE OF reply_to, reply_to_request, resolved_at ON work_item_comments BEGIN
    SELECT RAISE(ABORT, 'a reply names one parent: a comment or a question')
    WHERE NEW.reply_to IS NOT NULL AND NEW.reply_to_request IS NOT NULL;
    SELECT RAISE(ABORT, 'a reply answers a root, not another reply')
    WHERE EXISTS (
        SELECT 1 FROM work_item_comments parent
        WHERE parent.id = NEW.reply_to
          AND (parent.reply_to IS NOT NULL OR parent.reply_to_request IS NOT NULL)
    );
    SELECT RAISE(ABORT, 'a reply stays on the same work item as its parent')
    WHERE EXISTS (
        SELECT 1 FROM work_item_comments parent
        WHERE parent.id = NEW.reply_to AND parent.work_item_id != NEW.work_item_id
    ) OR EXISTS (
        SELECT 1 FROM work_item_requests parent
        WHERE parent.request_id = NEW.reply_to_request
          AND parent.work_item_id != NEW.work_item_id
    );
    SELECT RAISE(ABORT, 'only a root is resolved')
    WHERE NEW.resolved_at IS NOT NULL
      AND (NEW.reply_to IS NOT NULL OR NEW.reply_to_request IS NOT NULL);
END;
