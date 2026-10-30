-- Every statement in sqlite_master of a fresh store the schema-8 build created,
-- in creation order, captured once from that build. Read by tests/schema8.py.
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
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
    UNIQUE(work_item_id, kind, value)
);
CREATE TABLE work_item_events(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ('created','transitioned','claimed','released','taken_over','linked','unlinked','checklist_replaced','checklist_claimed','checklist_taken_over','checklist_released','checklist_completed','checklist_reopened','summarized','execution_attached','overridden','request_created','request_answered','request_declined','request_expired')),
    detail TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
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
    expired_reason TEXT CHECK(expired_reason IN ('deadline','withdrawn','execution_closed','task_closed'))
);
CREATE INDEX work_item_requests_item ON work_item_requests(work_item_id,created_at);
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
    ended_at TEXT
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
CREATE TABLE integration_settings(
    integration_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
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
CREATE TABLE platform_adapter_links(
    id INTEGER PRIMARY KEY,
    data_scope_id TEXT NOT NULL,
    space_key TEXT NOT NULL,
    work_item_id TEXT NOT NULL,
    service_owner_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    adapter_lineage_id TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    fallback_label TEXT NOT NULL DEFAULT '',
    provenance_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'resolved' CHECK(state IN ('resolved','unavailable','missing','ambiguous','malformed')),
    created_at TEXT NOT NULL,
    FOREIGN KEY(work_item_id) REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    UNIQUE(data_scope_id, space_key, work_item_id, service_owner_id, service_id,
           adapter_lineage_id, connection_id, resource_type, external_id)
);
CREATE INDEX platform_adapter_links_item
  ON platform_adapter_links(data_scope_id, space_key, work_item_id);
CREATE TABLE platform_modules(
    module_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
    mutable INTEGER NOT NULL CHECK(mutable IN (0,1)),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_services(
    service_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','invalid','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_adapters(
    adapter_lineage_id TEXT PRIMARY KEY,
    adapter_id TEXT NOT NULL UNIQUE,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_connections(
    connection_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','invalid','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_assignments(
    assignment_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('enabled','disabled')),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_grants(
    grant_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('active','revoked')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_actions(
    action_id TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_action_inputs(
    action_id TEXT PRIMARY KEY REFERENCES platform_actions(action_id),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_core_ref_bindings(
    core_ref_kind TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_packages(
    package_key TEXT PRIMARY KEY,
    record_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('registered','tombstoned')),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_known_stores(
    data_scope_id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    resources_json TEXT NOT NULL,
    registry_revision INTEGER NOT NULL,
    is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
    is_attached INTEGER NOT NULL CHECK(is_attached IN (0,1)),
    is_writable INTEGER NOT NULL CHECK(is_writable IN (0,1)),
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_registry_meta(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE platform_ui_prefs(
    key TEXT PRIMARY KEY CHECK(key='last-route'),
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE platform_registry_audit(
    sequence INTEGER PRIMARY KEY,
    event_kind TEXT NOT NULL,
    entity_kind TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL
);
CREATE INDEX platform_registry_audit_entity
  ON platform_registry_audit(entity_kind, entity_id, sequence);
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
