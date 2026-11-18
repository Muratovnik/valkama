"""The tables Planning owns, and the seed a new PlanningSpace starts from.

The Board era kept one lane string per card and read the six legal values out of
a CHECK constraint. A workflow is data here instead: states are rows, the
transitions between them are rows, and the code reads the table. That is what
makes Kanban one view of a workflow rather than the workflow itself.

`server/store.py` executes this schema beside its own. Nothing in this module
opens a connection or decides policy; the service above it does both.
"""

from __future__ import annotations

import re
import sqlite3

from . import model, request_model

_EVENT_ACTION_SQL = ",".join(f"'{action}'" for action in model.EVENT_ACTIONS)
_CATEGORY_SQL = ",".join(f"'{category}'" for category in model.STORED_CATEGORIES)
_TASK_ONLY_SQL = ",".join(f"'{category}'" for category in model.TASK_ONLY_CATEGORIES)
_KIND_SQL = ",".join(f"'{kind}'" for kind in sorted(model.WORK_ITEM_KINDS))
_PRIORITY_SQL = ",".join(f"'{value}'" for value in model.PRIORITIES)
_LINK_SQL = ",".join(f"'{kind}'" for kind in sorted(model.LINK_KINDS))
_REF_SQL = ",".join(f"'{kind}'" for kind in sorted(model.REF_KINDS))

_NOW = "(strftime('%Y-%m-%dT%H:%M:%SZ','now'))"

#: What schemas 10, 12 and 13 append, by table, in the order they append it. A comment
#: is the root of a thread when it names no parent and a reply when it names one --
#: a root comment or a question, never both -- and only a root carries the
#: resolve mark. A question keeps the number of its current answer; the answers
#: it replaced live in `work_item_request_answers`. Schema 12 lets a question stand
#: on a root comment, as the list of choices under it, and schema 13 lets a comment
#: say it waits for a reply (`awaits_reply`). ALTER TABLE can only append,
#: so the base schema declares these last from the same text and a fresh store
#: has the shape a migrated one reaches.
_THREAD_COLUMNS = {
    "work_item_comments": (
        ("reply_to", "reply_to INTEGER REFERENCES work_item_comments(id) ON DELETE CASCADE"),
        (
            "reply_to_request",
            "reply_to_request TEXT REFERENCES work_item_requests(request_id) ON DELETE CASCADE",
        ),
        ("resolved_at", "resolved_at TEXT"),
        ("resolved_by", "resolved_by TEXT NOT NULL DEFAULT ''"),
        ("resolution", "resolution TEXT NOT NULL DEFAULT ''"),
        ("resolved_call_id", "resolved_call_id INTEGER REFERENCES execution_events(id)"),
        (
            "awaits_reply",
            "awaits_reply INTEGER NOT NULL DEFAULT 0 CHECK(awaits_reply IN (0,1))",
        ),
    ),
    # The call after which a subscriber hears the item: the one that subscribed, or
    # the one before the merge that carried the row here. Declared apart from `call_id`,
    # which says whose the row is and so when it lapses.
    "work_item_subscriptions": (
        ("heard_after", "heard_after INTEGER REFERENCES execution_events(id)"),
    ),
    "work_item_requests": (
        ("answer_version", "answer_version INTEGER NOT NULL DEFAULT 0"),
        (
            "comment_id",
            "comment_id INTEGER REFERENCES work_item_comments(id) ON DELETE CASCADE",
        ),
    ),
}


def _appended(table: str) -> str:
    return "".join(f",\n    {definition}" for _, definition in _THREAD_COLUMNS[table])


#: The agent session a request asks instead of the owner, a top-level one; null asks
#: the owner. The 3.0 migration appends it after the columns above, so the base
#: schema declares it after them, with only `purpose` behind it.
ADDRESSEE_COLUMN = "addressee TEXT REFERENCES sessions(id)"
#: The open requests asked of one session, read by that session.
ADDRESSEE_INDEX = (
    "CREATE INDEX IF NOT EXISTS work_item_requests_addressee"
    " ON work_item_requests(addressee, status) WHERE addressee IS NOT NULL"
)

#: A person's words on a goal or stage that no live session heard, kept for the next
#: session to take work under it (`planning.waiting`): `tree` for work under the
#: container, `space` for work anywhere in its space. `from_call` is where the words
#: start, `created_call` the call that left the row; a session's claim delivers it,
#: naming the session, its agent ('' for its own conversation), the call and the
#: time. A delivered row stays as the trace of who got it, and goes with the item.
WAITING_NOTICES = f"""CREATE TABLE IF NOT EXISTS work_item_waiting_notices(
    notice_id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK(scope IN ('tree','space')),
    from_call INTEGER NOT NULL REFERENCES execution_events(id),
    created_call INTEGER NOT NULL REFERENCES execution_events(id),
    created_at TEXT NOT NULL DEFAULT {_NOW},
    delivered_session TEXT,
    delivered_agent TEXT NOT NULL DEFAULT '',
    delivered_call INTEGER REFERENCES execution_events(id),
    delivered_at TEXT,
    CHECK((delivered_call IS NULL) = (delivered_at IS NULL))
)"""
#: One open row per container and scope: later words are read from the row's call on.
WAITING_OPEN_INDEX = (
    "CREATE UNIQUE INDEX IF NOT EXISTS work_item_waiting_notices_open"
    " ON work_item_waiting_notices(work_item_id, scope) WHERE delivered_call IS NULL"
)
#: The rows delivered to one session, read by that session's hook.
WAITING_DELIVERED_INDEX = (
    "CREATE INDEX IF NOT EXISTS work_item_waiting_notices_delivered"
    " ON work_item_waiting_notices(delivered_session, notice_id) WHERE delivered_call IS NOT NULL"
)
#: A goal or stage that awaits confirmation, one row for exactly as long as it does
#: (`planning.closing`): since when, the call that recorded it -- Valkama's call that
#: wrote the event, or the sweep step's that wrote the row; none for a row the
#: work-model migration wrote -- the question to confirm it, once asked, and when the
#: owner left it to the next session. It goes with the item.
CONFIRMATIONS = """CREATE TABLE IF NOT EXISTS work_item_confirmations(
    work_item_id TEXT PRIMARY KEY REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    since TEXT NOT NULL,
    call_id INTEGER REFERENCES execution_events(id),
    request_id TEXT REFERENCES work_item_requests(request_id),
    left_at TEXT
)"""
#: The condition put-off work comes back on (`planning.deferral`), one row for exactly
#: as long as its item stands in a deferred state: a moment, or another item's close,
#: never both. The item it waits on is held without an action on delete, so a delete
#: that went around the return fails rather than leaving the condition unmet forever.
#: `call_id` is the call that set it -- the put-off, or the owner's answer to put it
#: off again -- which a failed launch's put-back keeps, null for a write made outside
#: any call; `reached_at` is when it came and the owner was asked instead. It goes
#: with the item.
DEFERRALS = """CREATE TABLE IF NOT EXISTS work_item_deferrals(
    work_item_id TEXT PRIMARY KEY REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    until_at TEXT,
    until_item_id TEXT REFERENCES work_items(work_item_id),
    reason TEXT NOT NULL,
    call_id INTEGER REFERENCES execution_events(id),
    since TEXT NOT NULL,
    reached_at TEXT,
    CHECK((until_at IS NULL) <> (until_item_id IS NULL))
)"""
#: What comes due by the clock, and who waits on one item, each read by its own column.
DEFERRALS_UNTIL_AT_INDEX = (
    "CREATE INDEX IF NOT EXISTS work_item_deferrals_until_at"
    " ON work_item_deferrals(until_at) WHERE until_at IS NOT NULL"
)
DEFERRALS_UNTIL_ITEM_INDEX = (
    "CREATE INDEX IF NOT EXISTS work_item_deferrals_until_item"
    " ON work_item_deferrals(until_item_id) WHERE until_item_id IS NOT NULL"
)

#: The keys of the owner's participation setting (`planning.participation` says what
#: each means and which values it takes): the points and switches a set gives, then
#: the numbers beside them.
PARTICIPATION_KEYS = (
    "queue",
    "finding",
    "proposed_goal",
    "task_in_goal",
    "decision",
    "cancel_outside",
    "cancel_shared",
    "condition",
    "goal_close",
    "goal_defer",
    "triage_reminder",
    "triage_age_days",
    "triage_count",
    "lease_quiet_days",
    "recent_close_minutes",
)
_PARTICIPATION_KEY_SQL = ",".join(f"'{key}'" for key in PARTICIPATION_KEYS)
#: The owner's participation setting, one row per value set: without a space the common
#: value, with one that space's own. A key with no row takes the value above it, and
#: above the common one the default set the code holds, so a store with no row reads as
#: that set. The value is text, checked by its key in the code; `call_id` is the
#: person's call that wrote it. It goes with its space.
PARTICIPATION_SETTINGS = f"""CREATE TABLE IF NOT EXISTS participation_settings(
    planning_space_id TEXT REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    key TEXT NOT NULL CHECK(key IN ({_PARTICIPATION_KEY_SQL})),
    value TEXT NOT NULL,
    call_id INTEGER REFERENCES execution_events(id),
    updated_at TEXT NOT NULL
)"""
#: One value per scope and key; the common scope is the one without a space.
PARTICIPATION_SETTINGS_SCOPE = (
    "CREATE UNIQUE INDEX IF NOT EXISTS participation_settings_scope"
    " ON participation_settings(ifnull(planning_space_id, ''), key)"
)
#: The owner's rules of a label, in the same two scopes: `ready` 1 makes a finding with
#: the label ready at once, 0 refuses in a space the common rule, null takes the rule
#: above; `description` says what the label means. A row holds at least one of them.
LABEL_SETTINGS = """CREATE TABLE IF NOT EXISTS label_settings(
    planning_space_id TEXT REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    ready INTEGER CHECK(ready IN (0, 1)),
    description TEXT,
    call_id INTEGER REFERENCES execution_events(id),
    updated_at TEXT NOT NULL,
    CHECK(ready IS NOT NULL OR description IS NOT NULL)
)"""
LABEL_SETTINGS_SCOPE = (
    "CREATE UNIQUE INDEX IF NOT EXISTS label_settings_scope"
    " ON label_settings(ifnull(planning_space_id, ''), label)"
)
#: Both tables and their indexes, as a fresh store and the work-model migration create them.
PARTICIPATION = (
    PARTICIPATION_SETTINGS,
    PARTICIPATION_SETTINGS_SCOPE,
    LABEL_SETTINGS,
    LABEL_SETTINGS_SCOPE,
)
_PARTICIPATION = "".join(f"{statement};\n" for statement in PARTICIPATION)

#: The points at which an agent's own decision is marked for the owner to read back
#: (`planning.decisions`): the participation points, and an acceptance by assignment.
DECISION_POINTS = (
    "finding",
    "proposed_goal",
    "task_in_goal",
    "decision",
    "cancel_outside",
    "cancel_shared",
    "condition",
    "goal_close",
    "goal_defer",
    "assignment",
)
_DECISION_POINT_SQL = ",".join(f"'{point}'" for point in DECISION_POINTS)
#: An agent's decision, as a mark on the event that recorded it: when, which item and
#: which session are the event's and its call's, so the mark holds only the point and
#: what was decided. It goes with its event, and the event with its item.
AGENT_DECISIONS = f"""CREATE TABLE IF NOT EXISTS agent_decisions(
    event_id INTEGER PRIMARY KEY REFERENCES work_item_events(id) ON DELETE CASCADE,
    point TEXT NOT NULL CHECK(point IN ({_DECISION_POINT_SQL})),
    what TEXT NOT NULL
)"""

#: The points at which an agent's write can wait for the owner (`planning.pending`):
#: `decision` is a question and no write, and `finding` is the review of findings at once.
PENDING_POINTS = (
    "finding",
    "proposed_goal",
    "task_in_goal",
    "cancel_outside",
    "cancel_shared",
    "condition",
    "goal_close",
    "goal_defer",
)
#: How a waiting action ended: done on the answer, declined by it, dropped as no longer
#: applying or with its item gone another way, or withdrawn by the session that asked.
PENDING_OUTCOMES = ("carried_out", "declined", "dropped", "withdrawn")
_PENDING_POINT_SQL = ",".join(f"'{point}'" for point in PENDING_POINTS)
_PENDING_OUTCOME_SQL = ",".join(f"'{outcome}'" for outcome in PENDING_OUTCOMES)
#: A write an agent asked for that waits for the owner's answer: the point, the write as
#: checked and what its asker saw (`action_json`), the call that asked, and once it
#: ended, how and by which call. Its questions name it (`work_item_requests.action_id`).
#: It goes with its item.
PENDING_ACTIONS = f"""CREATE TABLE IF NOT EXISTS pending_actions(
    action_id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    point TEXT NOT NULL CHECK(point IN ({_PENDING_POINT_SQL})),
    action_json TEXT NOT NULL,
    asked_call INTEGER NOT NULL REFERENCES execution_events(id),
    created_at TEXT NOT NULL,
    outcome TEXT CHECK(outcome IN ({_PENDING_OUTCOME_SQL})),
    ended_call INTEGER REFERENCES execution_events(id),
    ended_at TEXT,
    CHECK((outcome IS NULL) = (ended_at IS NULL))
)"""
#: One open action per item and point.
PENDING_ACTIONS_OPEN = (
    "CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_open"
    " ON pending_actions(work_item_id, point) WHERE outcome IS NULL"
)
#: The questions and requests of one action, which its end closes together.
REQUESTS_ACTION_INDEX = (
    "CREATE INDEX IF NOT EXISTS work_item_requests_action"
    " ON work_item_requests(action_id) WHERE action_id IS NOT NULL"
)
#: The table, its index and the index of the requests, as a fresh store and the
#: work-model migration create them.
PENDING = (PENDING_ACTIONS, PENDING_ACTIONS_OPEN, REQUESTS_ACTION_INDEX)
_PENDING = "".join(f"{statement};\n" for statement in PENDING)


_ACCEPTED_SQL = ",".join(f"'{category}'" for category in model.ACCEPTED_CATEGORIES)

#: Which states an item may stand in, refused by the store as well as by the service.
#: By its kind: only a container stands in the service state, and a container never
#: stands where work is held or waits on a holder. By its basis: accepted work --
#: ready, active, review, blocked, completed, or a container accepted and open -- has
#: one. The service writes a state and its basis in one statement, which is the only
#: way past this on every statement. One body, two triggers, because a SQLite trigger
#: stands on one event.
_STATE_FITS_KIND_RULES = f"""
    SELECT RAISE(ABORT, 'only a container stands in the service state')
    WHERE NEW.kind != '{model.CONTAINER_KIND}' AND EXISTS (
        SELECT 1 FROM workflow_states s
        WHERE s.state_id = NEW.state_id AND s.category = '{model.SERVICE_CATEGORY}'
    );
    SELECT RAISE(ABORT, 'a container never stands in ready, active, review or blocked')
    WHERE NEW.kind = '{model.CONTAINER_KIND}' AND EXISTS (
        SELECT 1 FROM workflow_states s
        WHERE s.state_id = NEW.state_id AND s.category IN ({_TASK_ONLY_SQL})
    );
    SELECT RAISE(ABORT, 'accepted work stands only with the basis it was accepted on')
    WHERE NEW.acceptance IS NULL AND EXISTS (
        SELECT 1 FROM workflow_states s
        WHERE s.state_id = NEW.state_id AND s.category IN ({_ACCEPTED_SQL})
    );
"""  # noqa: S608 - trigger DDL from the model's own constants, no value
STATE_FITS_KIND_TRIGGERS = {
    "work_items_state_fits_kind_insert": "INSERT",
    "work_items_state_fits_kind_update": "UPDATE OF state_id, kind, acceptance",
}
#: Each trigger's statement: the base schema runs them, and so does the migration
#: that carries an older store, once every item there stands where its kind may.
STATE_FITS_KIND = tuple(
    f"CREATE TRIGGER IF NOT EXISTS {name} BEFORE {event} ON work_items"
    f" BEGIN{_STATE_FITS_KIND_RULES}END"
    for name, event in STATE_FITS_KIND_TRIGGERS.items()
)
_STATE_FITS_KIND = "".join(f"{statement};\n" for statement in STATE_FITS_KIND)

_ACCEPTANCE_SQL = ",".join(f"'{basis}'" for basis in model.ACCEPTANCE_BASES)

_LAUNCH_PLACE_SQL = ",".join(f"'{place}'" for place in model.LAUNCH_PLACES)

#: The tables the work-model migration rebuilds, as their column lists: a fresh
#: store creates them from the same text the migration rebuilds them from, so the
#: two shapes cannot drift apart. `table_definition` names one.
#: A space holds no project: the registry binds projects to it, and a name is the
#: space's alone, since a space is found by its name as well as by its key.
_PLANNING_SPACES = f"""(
    planning_space_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    provider_kind TEXT NOT NULL DEFAULT 'local' CHECK(provider_kind IN ('local')),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
    launch_place TEXT NOT NULL DEFAULT '{model.LAUNCH_PLACES[0]}'
        CHECK(launch_place IN ({_LAUNCH_PLACE_SQL})),
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW},
    UNIQUE(name)
)"""
_WORKFLOW_STATES = f"""(
    state_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ({_CATEGORY_SQL})),
    position INTEGER NOT NULL,
    is_terminal INTEGER NOT NULL DEFAULT 0 CHECK(is_terminal IN (0,1)),
    UNIQUE(workflow_id, key),
    UNIQUE(workflow_id, position)
)"""
_WORK_ITEMS = f"""(
    work_item_id TEXT PRIMARY KEY,
    planning_space_id TEXT NOT NULL
        REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number >= 1),
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id),
    state_id TEXT NOT NULL REFERENCES workflow_states(state_id),
    kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ({_KIND_SQL})),
    parent_id TEXT REFERENCES work_items(work_item_id),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ({_PRIORITY_SQL})),
    claim_ref TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    summary_comment_id INTEGER REFERENCES work_item_comments(id) ON DELETE SET NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT '',
    checklist TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW},
    -- The write call that took the current claim: its session, agent, time and
    -- whether that identity was confirmed are read from that row, so they are
    -- never a second copy here. NULL for a claim recorded before identity
    -- existed, and for one an older build wrote; see `migrate_identity`.
    claim_call_id INTEGER REFERENCES execution_events(id),
    -- Why the item was accepted (`model.ACCEPTANCE_BASES`) and when; both null
    -- until it is. When work on it first started: set once, never cleared, and
    -- never on a container, whose start is read from the work under it.
    acceptance TEXT CHECK(acceptance IS NULL OR acceptance IN ({_ACCEPTANCE_SQL})),
    accepted_at TEXT,
    started_at TEXT,
    UNIQUE(planning_space_id, number)
)"""
#: An item's pointers: a session, a memory record or a url (`model.REF_KINDS`). The
#: work-model migration rebuilds the table of a store that still takes `commit`.
_WORK_ITEM_REFS = f"""(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ({_REF_SQL})),
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT {_NOW},
    call_id INTEGER REFERENCES execution_events(id),
    UNIQUE(work_item_id, kind, value)
)"""
_EXPIRED_REASON_SQL = ",".join(f"'{reason}'" for reason in request_model.EXPIRED_REASONS)
_PURPOSE_SQL = ",".join(f"'{purpose}'" for purpose in request_model.PURPOSES)
#: A question, a decision or a list, asked of the owner or of one agent session, and
#: how it ended. Closing its item ends one still pending (`questions.end`), as done or
#: cancelled. The 3.0 migration rebuilds the table from this text, so the columns
#: later schemas appended stand in the order they were appended, then `purpose` and the
#: action waiting for the owner the question is about (`action_id`), last.
_WORK_ITEM_REQUESTS = f"""(
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
    expired_reason TEXT CHECK(expired_reason IN ({_EXPIRED_REASON_SQL})){_appended("work_item_requests")},
    {ADDRESSEE_COLUMN},
    purpose TEXT CHECK(purpose IS NULL OR purpose IN ({_PURPOSE_SQL})),
    action_id TEXT REFERENCES pending_actions(action_id) ON DELETE CASCADE
)"""
_REBUILT = {
    "planning_spaces": _PLANNING_SPACES,
    "workflow_states": _WORKFLOW_STATES,
    "work_items": _WORK_ITEMS,
    "work_item_refs": _WORK_ITEM_REFS,
    "work_item_requests": _WORK_ITEM_REQUESTS,
}
#: The items of one state of one space, which every read of a state's items takes.
#: Declared apart because the 3.0 migration creates it anew rather than from the
#: text an older store holds, which names a column the rebuilt table no longer has.
WORK_ITEMS_STATE_INDEX = (
    "CREATE INDEX IF NOT EXISTS work_items_state ON work_items(planning_space_id, state_id)"
)

_PROJECT_SOURCE_SQL = ",".join(f"'{source}'" for source in model.PROJECT_SOURCES)
#: The projects each item changes (`planning.item_projects`), one row per project with
#: the source it came by. Its own table rather than a column of `work_items`: what
#: names a project is read across every space, by the index on the project. A fresh
#: store creates it from this text, and so does the work-model migration.
ITEM_PROJECTS = (
    "CREATE TABLE IF NOT EXISTS work_item_projects(\n"
    "    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,\n"
    "    project_id TEXT NOT NULL,\n"
    f"    source TEXT NOT NULL CHECK(source IN ({_PROJECT_SOURCE_SQL})),\n"
    "    PRIMARY KEY(work_item_id, project_id)\n"
    ") WITHOUT ROWID",
    "CREATE INDEX IF NOT EXISTS work_item_projects_by_project ON work_item_projects(project_id)",
)
_ITEM_PROJECTS = "".join(f"{statement};\n" for statement in ITEM_PROJECTS)

#: The commits Valkama knows, one row per pair of a registry project and a hash, and
#: which item each is attached to and by whom (`planning.commits`). `project_id` is NULL
#: only for a commit carried over whose repository was not found, `session_id` for one
#: no hook reported; `rewritten_to` names the commit an amend or a rebase replaced it
#: with, and `rewrite_recorded_ns` when the record of the last rewrite applied to it, as
#: its old or its new commit, was written. A fresh store creates them from this text, and
#: so does the work-model migration.
COMMITS = (
    "CREATE TABLE IF NOT EXISTS commits(\n"
    "    commit_id INTEGER PRIMARY KEY,\n"
    "    project_id TEXT,\n"
    "    hash TEXT NOT NULL"
    " CHECK(length(hash) BETWEEN 7 AND 64 AND hash NOT GLOB '*[^0-9a-f]*'),\n"
    "    subject TEXT NOT NULL DEFAULT '',\n"
    "    committed_at TEXT,\n"
    "    session_id TEXT,\n"
    "    agent_id TEXT,\n"
    "    client TEXT,\n"
    "    reported_at TEXT NOT NULL,\n"
    "    rewritten_to INTEGER REFERENCES commits(commit_id),\n"
    "    rewrite_recorded_ns INTEGER\n"
    ")",
    "CREATE UNIQUE INDEX IF NOT EXISTS commits_pair ON commits(COALESCE(project_id, ''), hash)",
    "CREATE INDEX IF NOT EXISTS commits_session ON commits(session_id, reported_at)",
    "CREATE TABLE IF NOT EXISTS work_item_commits(\n"
    "    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,\n"
    "    commit_id INTEGER NOT NULL REFERENCES commits(commit_id),\n"
    "    attached_by TEXT NOT NULL CHECK(attached_by IN ('server','manual','migrated')),\n"
    "    label TEXT NOT NULL DEFAULT '',\n"
    "    author TEXT NOT NULL DEFAULT 'agent',\n"
    "    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),\n"
    "    call_id INTEGER REFERENCES execution_events(id),\n"
    "    PRIMARY KEY(work_item_id, commit_id)\n"
    ")",
    "CREATE INDEX IF NOT EXISTS work_item_commits_by_commit ON work_item_commits(commit_id)",
)
_COMMITS = "".join(f"{statement};\n" for statement in COMMITS)

_BASELINE_BASIS_SQL = ",".join(f"'{basis}'" for basis in model.BASELINE_BASES)
#: How many tasks stood under a goal or stage when it was accepted, or when work under
#: one accepted empty first started (`planning.baselines`): one row for as long as its
#: acceptance stands, none for an acceptance the work-model migration gave. A fresh
#: store creates it from this text, and so does the work-model migration.
ITEM_BASELINES = (
    "CREATE TABLE IF NOT EXISTS work_item_baselines(\n"
    "    work_item_id TEXT PRIMARY KEY REFERENCES work_items(work_item_id) ON DELETE CASCADE,\n"
    "    tasks INTEGER NOT NULL CHECK(tasks >= 0),\n"
    f"    basis TEXT NOT NULL CHECK(basis IN ({_BASELINE_BASIS_SQL})),\n"
    "    taken_at TEXT NOT NULL\n"
    ") WITHOUT ROWID"
)


def has_table(conn: sqlite3.Connection, name: str) -> bool:
    """Whether a store has a table. An attached store is read as it is, and an older
    one lacks what later schemas added: it has nothing of that to say."""

    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        is not None
    )


def table_definition(table: str, name: str) -> str:
    """The `CREATE TABLE` of one rebuilt table under `name`, as a fresh store holds it."""

    return f"CREATE TABLE {name}{_REBUILT[table]}"


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS planning_spaces{_PLANNING_SPACES};
CREATE TABLE IF NOT EXISTS workflows(
    workflow_id TEXT PRIMARY KEY,
    planning_space_id TEXT NOT NULL
        REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    initial_state_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW},
    UNIQUE(planning_space_id, name)
);
CREATE TABLE IF NOT EXISTS workflow_states{_WORKFLOW_STATES};
CREATE TABLE IF NOT EXISTS workflow_transitions(
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    from_state_id TEXT NOT NULL REFERENCES workflow_states(state_id) ON DELETE CASCADE,
    to_state_id TEXT NOT NULL REFERENCES workflow_states(state_id) ON DELETE CASCADE,
    PRIMARY KEY(workflow_id, from_state_id, to_state_id)
);
CREATE TABLE IF NOT EXISTS work_items{_WORK_ITEMS};
{WORK_ITEMS_STATE_INDEX};
{_STATE_FITS_KIND}CREATE INDEX IF NOT EXISTS work_items_parent ON work_items(parent_id);
-- One work item per improvement case, enforced by the store rather than by the
-- caller that happens to check first. The Board era carried the same partial
-- index on `cards(source)`; two rows for one case is a duplicate the
-- Improvements module cannot tell apart afterwards.
CREATE UNIQUE INDEX IF NOT EXISTS work_items_improvement_source
  ON work_items(source) WHERE source LIKE 'improvement://%';
CREATE TABLE IF NOT EXISTS work_item_links(
    id INTEGER PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ({_LINK_SQL})),
    created_at TEXT NOT NULL DEFAULT {_NOW},
    UNIQUE(from_id, to_id, kind)
);
-- What blocks an item, read from the item blocked: a client hook asks on every
-- tool call whether a blocker of the work it holds has closed. Schema 13.
CREATE INDEX IF NOT EXISTS work_item_links_to ON work_item_links(to_id, kind);
CREATE TABLE IF NOT EXISTS work_item_comments(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    author TEXT NOT NULL DEFAULT 'agent',
    body TEXT NOT NULL,
    report TEXT NOT NULL DEFAULT '',
    checklist_item_id TEXT,
    checklist_item_text TEXT,
    created_at TEXT NOT NULL DEFAULT {_NOW},
    call_id INTEGER REFERENCES execution_events(id){_appended("work_item_comments")}
);
CREATE INDEX IF NOT EXISTS work_item_comments_item ON work_item_comments(work_item_id, id);
CREATE TABLE IF NOT EXISTS work_item_refs{_WORK_ITEM_REFS};
CREATE TABLE IF NOT EXISTS work_item_events(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ({_EVENT_ACTION_SQL})),
    detail TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT {_NOW},
    call_id INTEGER REFERENCES execution_events(id)
);
CREATE INDEX IF NOT EXISTS work_item_events_item ON work_item_events(work_item_id, id);
CREATE TABLE IF NOT EXISTS work_item_requests{_WORK_ITEM_REQUESTS};
CREATE INDEX IF NOT EXISTS work_item_requests_item ON work_item_requests(work_item_id,created_at);
{ADDRESSEE_INDEX};
-- The answers a question's current one replaced, one row per version. The
-- current answer stays on the request row, so each version lives in one place
-- and every reader of the current answer reads what it always read.
CREATE TABLE IF NOT EXISTS work_item_request_answers(
    request_id TEXT NOT NULL REFERENCES work_item_requests(request_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version >= 1),
    answers_json TEXT NOT NULL,
    answered_by TEXT NOT NULL,
    answered_at TEXT NOT NULL,
    call_id INTEGER REFERENCES execution_events(id),
    PRIMARY KEY(request_id, version)
);
-- The items a person keeps in view, added with schema 12. A person's own list:
-- a pin outlives the item's close and goes only with the item itself.
CREATE TABLE IF NOT EXISTS pinned_work_items(
    work_item_id TEXT PRIMARY KEY REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    pinned_at TEXT NOT NULL DEFAULT {_NOW},
    call_id INTEGER REFERENCES execution_events(id)
);
-- What a session follows beside what it holds, added with schema 13: one row per
-- item, session and agent ('' for the session's own conversation). `follows` 1 is
-- a subscription to an item; 0 mutes other sessions' news on an item it holds.
-- Who wrote it, and when, is the call; the row lapses with its session, as a
-- claim does (`planning.subscriptions`), and goes with the item.
CREATE TABLE IF NOT EXISTS work_item_subscriptions(
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL DEFAULT '',
    follows INTEGER NOT NULL CHECK(follows IN (0,1)),
    call_id INTEGER NOT NULL REFERENCES execution_events(id),
    created_at TEXT NOT NULL DEFAULT {_NOW}{_appended("work_item_subscriptions")},
    PRIMARY KEY(work_item_id, session_id, agent_id)
);
-- What a session follows, read from the session: a client hook asks on every tool
-- call, and a merge moves a row to an item the session's own calls never named.
CREATE INDEX IF NOT EXISTS work_item_subscriptions_session
    ON work_item_subscriptions(session_id, agent_id);
-- The pictures pasted into an item's text, added with schema 14: one row per item and
-- picture. The bytes are a file named by their SHA-256 in the `images` directory beside
-- the store (`planning.images`); a row here is what keeps that file, and the file goes
-- once no item holds a row for it. A merge gives the survivor a row of its own.
CREATE TABLE IF NOT EXISTS work_item_images(
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    media_type TEXT NOT NULL
        CHECK(media_type IN ('image/png','image/jpeg','image/webp','image/gif')),
    size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 10485760),
    created_at TEXT NOT NULL DEFAULT {_NOW},
    call_id INTEGER REFERENCES execution_events(id),
    PRIMARY KEY(work_item_id, sha256)
);
-- Whether any item still holds a picture, asked when one is let go.
CREATE INDEX IF NOT EXISTS work_item_images_sha256 ON work_item_images(sha256);
{WAITING_NOTICES};
{WAITING_OPEN_INDEX};
{WAITING_DELIVERED_INDEX};
{CONFIRMATIONS};
{DEFERRALS};
{DEFERRALS_UNTIL_AT_INDEX};
{DEFERRALS_UNTIL_ITEM_INDEX};
{_PARTICIPATION}
{AGENT_DECISIONS};
{_PENDING}{_ITEM_PROJECTS}
{_COMMITS}
{ITEM_BASELINES};
"""


def interactions_migration_needed(conn: sqlite3.Connection) -> bool:
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "work_items" not in tables:
        return False
    columns = {row[1] for row in conn.execute("PRAGMA table_info(work_item_comments)")}
    event = conn.execute("SELECT sql FROM sqlite_master WHERE name='work_item_events'").fetchone()
    return (
        "work_item_requests" not in tables
        or not {"checklist_item_id", "checklist_item_text"} <= columns
        or (event is not None and "request_created" not in event[0])
    )


def migrate_interactions(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(work_item_comments)")}
    for column in ("checklist_item_id", "checklist_item_text"):
        if column not in columns:
            conn.execute(f"ALTER TABLE work_item_comments ADD COLUMN {column} TEXT")
    widen_event_actions(conn)


def widen_event_actions(conn: sqlite3.Connection) -> None:
    """Give `work_item_events` the CHECK of every action `model.EVENT_ACTIONS` declares, once.

    SQLite cannot widen a CHECK constraint in place, so a table missing any
    declared action is rebuilt from its own stored definition with the current
    list, every row carried over with its id, and its indexes and triggers
    created again. A table that already holds every action is left alone, which
    is what makes a second call in the same open, or a later open, write nothing.
    """

    event = conn.execute("SELECT sql FROM sqlite_master WHERE name='work_item_events'").fetchone()
    if event is None or all(f"'{action}'" in event[0] for action in model.EVENT_ACTIONS):
        return
    definition = re.sub(
        r'CREATE TABLE(?: IF NOT EXISTS)?\s+"?work_item_events"?',
        f"CREATE TABLE work_item_events{REPLACEMENT}",
        event[0],
        count=1,
        flags=re.IGNORECASE,
    )
    definition, replaced = re.subn(
        r"CHECK\s*\(\s*action\s+IN\s*\([^)]*\)\s*\)",
        f"CHECK(action IN ({_EVENT_ACTION_SQL}))",
        definition,
        count=1,
        flags=re.IGNORECASE,
    )
    if replaced != 1:
        raise RuntimeError("event migration requires the known action constraint")
    rebuild_table(conn, "work_item_events", definition, "SELECT * FROM work_item_events")


#: What a table being rebuilt is called until it takes its own name.
REPLACEMENT = "_replacement"


def rebuild_table(conn: sqlite3.Connection, table: str, definition: str, rows: str) -> list[str]:
    """Rebuild one table: create `definition`, fill it from `rows`, put it in its place.

    SQLite cannot change a column or a CHECK in place. `definition` creates the
    table under its own name with `REPLACEMENT` after it, and `rows` is the SELECT
    that fills it. The old table goes, the new one takes its name, and every index
    and trigger that stood on the old one is created again from its stored text in
    the order the store holds them, so one this module does not know survives too.
    An AUTOINCREMENT counter keeps its place. Answers the names created again.

    Dropping a table others reference cascades into them while foreign keys are
    enforced, so a caller rebuilding such a table turns them off first, outside its
    transaction, where SQLite takes the pragma (`store.schema_change` does). With
    them on, such a table is refused before anything is written.
    """

    if conn.execute("PRAGMA foreign_keys").fetchone()[0]:
        referencing = sorted(
            {
                str(row[0])
                for row in conn.execute(
                    "SELECT m.name FROM sqlite_master m, pragma_foreign_key_list(m.name) f"
                    " WHERE m.type = 'table' AND m.name != ? COLLATE NOCASE"
                    ' AND f."table" = ? COLLATE NOCASE',
                    (table, table),
                )
            }
        )
        if referencing:
            raise RuntimeError(
                f"rebuilding {table} with foreign keys on would delete the rows of"
                f" {', '.join(referencing)} that reference it; turn foreign keys off"
                " outside the transaction first"
            )
    stored = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    objects = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE tbl_name=?"
        " AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY rowid",
        (table,),
    ).fetchall()
    sequence = None
    if stored is not None and "AUTOINCREMENT" in str(stored[0]).upper():
        sequence = conn.execute("SELECT seq FROM sqlite_sequence WHERE name=?", (table,)).fetchone()
    conn.execute(definition)
    conn.execute(f"INSERT INTO {table}{REPLACEMENT} {rows}")
    conn.execute(f"DROP TABLE {table}")
    conn.execute(f"ALTER TABLE {table}{REPLACEMENT} RENAME TO {table}")
    for _, statement in objects:
        conn.execute(str(statement))
    if sequence is not None:
        conn.execute("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?", (sequence[0], table))
    return [str(name) for name, _ in objects]


#: What a thread may be, refused by the store rather than only by the service:
#: a reply names one parent, that parent is a root, it is on the reply's own work
#: item, and only a root is resolved. One body, two triggers, because a SQLite
#: trigger stands on one event. Neither stands on `work_item_id`: a merge moves a
#: root and its replies in one UPDATE, and a parent checked against the reply's
#: item halfway through that statement would stop the move.
_THREAD_RULES = """
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
"""
_THREAD_TRIGGERS = {
    "work_item_comments_thread_shape_insert": "INSERT",
    "work_item_comments_thread_shape_update": "UPDATE OF reply_to, reply_to_request, resolved_at",
}
#: Created here rather than in the base schema, which runs before this against a
#: table that may not have the columns yet. The partial indexes serve the two
#: ways a thread is read -- its replies by parent -- and the open roots of an item.
#: Schema 12 adds the list a root carries, by its comment, and the mentions of an
#: item read back from the comment that made them; that one comes after the event
#: table is rebuilt for its action, so the rebuild has nothing to carry.
_THREAD_INDEXES = (
    "CREATE INDEX IF NOT EXISTS work_item_comments_reply_to"
    " ON work_item_comments(reply_to) WHERE reply_to IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS work_item_comments_reply_to_request"
    " ON work_item_comments(reply_to_request) WHERE reply_to_request IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS work_item_comments_unresolved"
    " ON work_item_comments(work_item_id, id)"
    " WHERE reply_to IS NULL AND reply_to_request IS NULL AND resolved_at IS NULL",
    "CREATE INDEX IF NOT EXISTS work_item_requests_comment"
    " ON work_item_requests(comment_id) WHERE comment_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS work_item_events_mentioned"
    " ON work_item_events(detail) WHERE action = 'mentioned'",
)


def migrate_threads(conn: sqlite3.Connection) -> None:
    """Schema 10's, 12's and 13's Planning step: threads, the resolve mark, answer
    versions, a question on a root comment, the mention action and a comment that
    waits for a reply, once.

    Appends the columns `_THREAD_COLUMNS` names, numbers an answered question's
    current answer 1 in the same call that adds the column (a later open leaves
    the numbers alone), widens the event CHECK, and creates the indexes and the
    triggers that keep a thread's shape. The table of replaced answers and the
    pins come from the base schema, which `store.connect()` runs before this.
    Every part looks before it writes, so a store that has them is left as it was.
    """

    added: set[str] = set()
    for table, definitions in _THREAD_COLUMNS.items():
        present = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for column, definition in definitions:
            if column not in present:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")
                added.add(column)
    if "answer_version" in added:
        conn.execute("UPDATE work_item_requests SET answer_version = 1 WHERE status = 'answered'")
    widen_event_actions(conn)
    for statement in _THREAD_INDEXES:
        conn.execute(statement)
    for name, event in _THREAD_TRIGGERS.items():
        conn.execute(
            f"CREATE TRIGGER IF NOT EXISTS {name} BEFORE {event} ON work_item_comments"
            f" BEGIN{_THREAD_RULES}END"
        )


def assert_threads_postconditions(conn: sqlite3.Connection) -> None:
    """Refuse to stamp a store that does not hold what `migrate_threads` gives it."""

    for table, definitions in _THREAD_COLUMNS.items():
        present = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        missing = [column for column, _ in definitions if column not in present]
        if missing:
            raise RuntimeError(f"post-migration {table} lacks {', '.join(missing)}")
    objects = {str(row[0]) for row in conn.execute("SELECT name FROM sqlite_master")}
    absent = sorted(set(_THREAD_TRIGGERS) - objects)
    if absent:
        raise RuntimeError(f"post-migration store lacks the trigger {', '.join(absent)}")
    event = conn.execute("SELECT sql FROM sqlite_master WHERE name='work_item_events'").fetchone()
    if event is None or any(f"'{action}'" not in event[0] for action in model.EVENT_ACTIONS):
        raise RuntimeError("post-migration work_item_events does not hold every action")


_SYMMETRIC_LINK_SQL = ",".join(f"'{kind}'" for kind in sorted(model.SYMMETRIC_LINK_KINDS))
#: A symmetric link is one record whichever end wrote it, held by the store rather
#: than by the writer that looks first: two ends linking each other at once, or a
#: build that looked in one direction only, leave one record and not its mirror.
SYMMETRIC_ONCE_INDEX = "work_item_links_symmetric_once"
_SYMMETRIC_ONCE = (
    f"CREATE UNIQUE INDEX IF NOT EXISTS {SYMMETRIC_ONCE_INDEX}"
    " ON work_item_links(min(from_id, to_id), max(from_id, to_id), kind)"
    f" WHERE kind IN ({_SYMMETRIC_LINK_SQL})"
)
#: Whether a link of one symmetric kind is stored from both ends.
_MIRROR_FOUND = (
    "SELECT 1 FROM work_item_links link JOIN work_item_links mirror"
    " ON mirror.kind = link.kind AND mirror.from_id = link.to_id AND mirror.to_id = link.from_id"
    " WHERE link.kind = ? LIMIT 1"
)
#: The later record of each link of one symmetric kind stored from both ends: the
#: earlier by `created_at`, then by `id`, is the one kept. `UNIQUE(from_id, to_id,
#: kind)` leaves a record at most one mirror.
_LATER_MIRRORS_DELETE = (
    "DELETE FROM work_item_links WHERE kind = ? AND EXISTS ("
    "SELECT 1 FROM work_item_links kept WHERE kept.kind = work_item_links.kind"
    " AND kept.from_id = work_item_links.to_id AND kept.to_id = work_item_links.from_id"
    " AND (kept.created_at < work_item_links.created_at"
    " OR (kept.created_at = work_item_links.created_at AND kept.id < work_item_links.id)))"
)


def _symmetric_once_present(conn: sqlite3.Connection) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (SYMMETRIC_ONCE_INDEX,)
        ).fetchone()
        is not None
    )


def symmetric_mirrors_present(conn: sqlite3.Connection) -> bool:
    """Whether `migrate_symmetric_links` has records to delete, which needs a recovery point.

    A store that holds the index holds no mirror, so it is not read further.
    """

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "work_item_links" not in tables or _symmetric_once_present(conn):
        return False
    return any(
        conn.execute(_MIRROR_FOUND, (kind,)).fetchone() is not None
        for kind in sorted(model.SYMMETRIC_LINK_KINDS)
    )


def migrate_symmetric_links(conn: sqlite3.Connection) -> int:
    """Keep one record of each symmetric link, then make the store refuse a second, once.

    Builds before this looked for an existing link in the direction they were
    asked for, so a relation linked from both ends lay twice and each card listed
    it twice. The later record goes and the earlier stays, with its direction,
    its id and its time; the history of both writes stays on both items. Every
    other kind is left as it is. Answers how many records went.
    """

    if _symmetric_once_present(conn):
        return 0
    removed = sum(
        conn.execute(_LATER_MIRRORS_DELETE, (kind,)).rowcount
        for kind in sorted(model.SYMMETRIC_LINK_KINDS)
    )
    conn.execute(_SYMMETRIC_ONCE)
    return removed


def assert_links_postconditions(conn: sqlite3.Connection) -> None:
    """Refuse to stamp a store that would take a symmetric link's mirror."""

    if not _symmetric_once_present(conn):
        raise RuntimeError(f"post-migration store lacks the index {SYMMETRIC_ONCE_INDEX}")


def migrate_discussion(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(work_item_comments)")}
    if "report" not in columns:
        conn.execute("ALTER TABLE work_item_comments ADD COLUMN report TEXT NOT NULL DEFAULT ''")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(work_items)")}
    if "summary_comment_id" not in columns:
        conn.execute(
            "ALTER TABLE work_items ADD COLUMN summary_comment_id INTEGER"
            " REFERENCES work_item_comments(id) ON DELETE SET NULL"
        )
    for item in conn.execute(
        "SELECT work_item_id,summary FROM work_items"
        " WHERE summary != '' AND summary_comment_id IS NULL"
    ).fetchall():
        report = model.summary(item["summary"])
        event = conn.execute(
            "SELECT author,created_at FROM work_item_events"
            " WHERE work_item_id=? AND action='summarized' ORDER BY id DESC LIMIT 1",
            (item["work_item_id"],),
        ).fetchone()
        inserted = conn.execute(
            "INSERT INTO work_item_comments(work_item_id,author,body,report,created_at)"
            " VALUES(?,?,?,?,?)",
            (
                item["work_item_id"],
                event["author"] if event else "",
                "",
                model.dumps(report),
                event["created_at"] if event else "",
            ),
        )
        conn.execute(
            "UPDATE work_items SET summary_comment_id=? WHERE work_item_id=?",
            (inserted.lastrowid, item["work_item_id"]),
        )
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS work_items_summary_matches_report
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
        END
    """)


#: The link from a Planning row to the write call that produced it, by table,
#: as each one is added to a store created before session identity. Appended
#: rather than placed: ALTER TABLE can only append, and a fresh store declares
#: the same column last in the base schema above, so both shapes agree.
_IDENTITY_COLUMNS = {
    "work_items": ("claim_call_id", "claim_call_id INTEGER REFERENCES execution_events(id)"),
    "work_item_events": ("call_id", "call_id INTEGER REFERENCES execution_events(id)"),
    "work_item_comments": ("call_id", "call_id INTEGER REFERENCES execution_events(id)"),
    "work_item_refs": ("call_id", "call_id INTEGER REFERENCES execution_events(id)"),
}

# What keeps `claim_call_id` honest against a writer that does not know it. A
# build from before session identity still claims, takes over and releases by
# writing `claim_ref` alone, and the link it leaves behind would then name the
# previous holder's call -- a claim attributed to a session that never made it.
# Every write that sets a holder here names a new call, and every release clears
# the link in the same UPDATE, so a `claim_ref` write that leaves the link as it
# was can only come from such a writer, and the claim it made is unconfirmed.
# Call ids are unique, so the rule cannot tie the way a timestamp would.
_CLAIM_FOLLOWS_CALL = """
CREATE TRIGGER IF NOT EXISTS work_items_claim_follows_call
AFTER UPDATE OF claim_ref ON work_items
WHEN NEW.claim_call_id IS OLD.claim_call_id AND NEW.claim_call_id IS NOT NULL
BEGIN
    UPDATE work_items SET claim_call_id = NULL WHERE work_item_id = NEW.work_item_id;
END
"""


def identity_migration_needed(conn: sqlite3.Connection) -> bool:
    """Whether a Planning store predates the link to its write calls."""

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "work_items" not in tables:
        return False
    for table, (column, _) in _IDENTITY_COLUMNS.items():
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            return True
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='work_items_claim_follows_call'"
        ).fetchone()
        is None
    )


def migrate_identity(conn: sqlite3.Connection) -> None:
    """Link Planning rows to the write call that made them, once.

    Additive only: every existing row keeps its values and gains a NULL link,
    which reads as a write nobody confirmed -- true of everything recorded
    before identity existed. No row changes meaning, so the schema ratchet
    stays where it is and a build from before this step still opens the store.
    The trigger is created here rather than in the base schema, which runs
    before this against tables that may not have the column yet.
    """

    for table, (column, definition) in _IDENTITY_COLUMNS.items():
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")
    conn.execute(_CLAIM_FOLLOWS_CALL)


SCHEMA_TABLES = (
    "planning_spaces",
    "workflows",
    "workflow_states",
    "workflow_transitions",
    "work_items",
    "work_item_links",
    "work_item_comments",
    "work_item_refs",
    "work_item_events",
    "work_item_requests",
    "work_item_request_answers",
    "pinned_work_items",
    "work_item_subscriptions",
    "work_item_images",
    "work_item_waiting_notices",
    "work_item_confirmations",
    "work_item_deferrals",
    "work_item_projects",
    "participation_settings",
    "label_settings",
    "agent_decisions",
    "pending_actions",
    "commits",
    "work_item_commits",
    "work_item_baselines",
)


def create_space(
    conn: sqlite3.Connection,
    *,
    name: str,
    key: str | None = None,
    space_id: str | None = None,
) -> dict:
    """Insert one PlanningSpace and the workflow it starts with.

    The space holds no project: the registry binds projects to it. The default
    workflow is written as rows, so the space that gets it can be changed
    afterwards without touching this function.
    """

    space_name = model.text_field(name, "planning_space.name")
    # The lock comes before the read of the keys in use: otherwise two spaces
    # deriving one key both find it free, and the second dies on its UNIQUE.
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    taken = frozenset(row[0] for row in conn.execute("SELECT key FROM planning_spaces"))
    chosen = model.space_key(key) if key else model.derive_space_key(space_name, taken)
    if chosen in taken:
        raise model.PlanningError(f"planning space key {chosen} is already in use")
    if conn.execute("SELECT 1 FROM planning_spaces WHERE name = ?", (space_name,)).fetchone():
        raise model.PlanningError(f"a planning space named {space_name} already exists")
    identifier = (
        model.identifier(space_id, "planning_space.planning_space_id")
        if space_id
        else model.new_id()
    )
    conn.execute(
        "INSERT INTO planning_spaces(planning_space_id,name,key) VALUES(?,?,?)",
        (identifier, space_name, chosen),
    )
    workflow = create_default_workflow(conn, identifier)
    return {
        "planning_space_id": identifier,
        "name": space_name,
        "key": chosen,
        "provider_kind": "local",
        "workflow_id": workflow["workflow_id"],
    }


def create_default_workflow(conn: sqlite3.Connection, planning_space_id: str) -> dict:
    """A state for each of the eight categories and the service state, every move
    between them; new work starts in triage.

    The transitions are explicit rows rather than "anything to anything": a
    workflow that permitted everything would make the guards below decoration.
    What it does permit is generous, because this installation's history moved
    cards freely and a migration must not invent refusals for rows that already
    exist. What the model refuses by category, the code refuses above the table.
    """

    workflow_id = model.new_id()
    states = []
    for position, (key, name, category) in enumerate(model.DEFAULT_STATES):
        states.append(
            {
                "state_id": model.new_id(),
                "key": key,
                "name": name,
                "category": category,
                "position": position,
                "is_terminal": 1 if category in model.TERMINAL_CATEGORIES else 0,
            }
        )
    initial = next(state for state in states if state["category"] == "triage")
    conn.execute(
        "INSERT INTO workflows(workflow_id,planning_space_id,name,initial_state_id)"
        " VALUES(?,?,?,?)",
        (workflow_id, planning_space_id, model.DEFAULT_WORKFLOW_NAME, initial["state_id"]),
    )
    for state in states:
        conn.execute(
            "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position,is_terminal)"
            " VALUES(?,?,?,?,?,?,?)",
            (
                state["state_id"],
                workflow_id,
                state["key"],
                state["name"],
                state["category"],
                state["position"],
                state["is_terminal"],
            ),
        )
    for source in states:
        for target in states:
            if source["state_id"] == target["state_id"]:
                continue
            conn.execute(
                "INSERT INTO workflow_transitions(workflow_id,from_state_id,to_state_id)"
                " VALUES(?,?,?)",
                (workflow_id, source["state_id"], target["state_id"]),
            )
    return {"workflow_id": workflow_id, "initial_state_id": initial["state_id"], "states": states}


def workflow_for_space(conn: sqlite3.Connection, planning_space_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM workflows WHERE planning_space_id = ? ORDER BY created_at, workflow_id"
        " LIMIT 1",
        (planning_space_id,),
    ).fetchone()
    if row is None:
        raise model.PlanningError("this planning space has no workflow")
    return row


def states_for_workflow(conn: sqlite3.Connection, workflow_id: str) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            "SELECT * FROM workflow_states WHERE workflow_id = ? ORDER BY position",
            (workflow_id,),
        )
    )


def transitions_for_workflow(conn: sqlite3.Connection, workflow_id: str) -> list[tuple[str, str]]:
    return [
        (str(row[0]), str(row[1]))
        for row in conn.execute(
            "SELECT from_state_id,to_state_id FROM workflow_transitions WHERE workflow_id = ?"
            " ORDER BY from_state_id, to_state_id",
            (workflow_id,),
        )
    ]


def next_number(conn: sqlite3.Connection, planning_space_id: str) -> int:
    """Hand out the next human number and record that it is taken.

    A counter on the space rather than `MAX(number) + 1`: deleting the newest
    item must not hand its identifier to the next one, because that identifier
    is already in a commit message somewhere.

    The write comes first and adds to what the row holds at that moment. It used
    to read the counter and then write the value it read plus one: a read takes no
    lock, so two agents both read 5, and the second's write and insert landed
    after the first committed, as a raw UNIQUE failure on the number. The UPDATE
    holds the write lock until the caller commits, so the number read back here
    is this caller's alone.
    """

    changed = conn.execute(
        "UPDATE planning_spaces SET next_number = next_number + 1, updated_at ="
        " strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE planning_space_id = ?",
        (planning_space_id,),
    )
    if changed.rowcount != 1:
        raise model.PlanningError("planning space does not exist")
    return int(
        conn.execute(
            "SELECT next_number - 1 FROM planning_spaces WHERE planning_space_id = ?",
            (planning_space_id,),
        ).fetchone()[0]
    )
