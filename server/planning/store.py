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

from . import model

_EVENT_ACTION_SQL = ",".join(f"'{action}'" for action in model.EVENT_ACTIONS)
_CATEGORY_SQL = ",".join(f"'{category}'" for category in model.STATE_CATEGORIES)
_KIND_SQL = ",".join(f"'{kind}'" for kind in sorted(model.WORK_ITEM_KINDS))
_PRIORITY_SQL = ",".join(f"'{value}'" for value in model.PRIORITIES)
_LINK_SQL = ",".join(f"'{kind}'" for kind in sorted(model.LINK_KINDS))
_REF_SQL = ",".join(f"'{kind}'" for kind in sorted(model.REF_KINDS))

_NOW = "(strftime('%Y-%m-%dT%H:%M:%SZ','now'))"

#: What schemas 10 and 12 append, by table, in the order they append it. A comment
#: is the root of a thread when it names no parent and a reply when it names one --
#: a root comment or a question, never both -- and only a root carries the
#: resolve mark. A question keeps the number of its current answer; the answers
#: it replaced live in `work_item_request_answers`. Schema 12 lets a question stand
#: on a root comment, as the list of choices under it. ALTER TABLE can only append,
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


SCHEMA = f"""
CREATE TABLE IF NOT EXISTS planning_spaces(
    planning_space_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    provider_kind TEXT NOT NULL DEFAULT 'local' CHECK(provider_kind IN ('local')),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number >= 1),
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW},
    UNIQUE(project_id, name)
);
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
CREATE TABLE IF NOT EXISTS workflow_states(
    state_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ({_CATEGORY_SQL})),
    position INTEGER NOT NULL,
    is_terminal INTEGER NOT NULL DEFAULT 0 CHECK(is_terminal IN (0,1)),
    UNIQUE(workflow_id, key),
    UNIQUE(workflow_id, position)
);
CREATE TABLE IF NOT EXISTS workflow_transitions(
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id) ON DELETE CASCADE,
    from_state_id TEXT NOT NULL REFERENCES workflow_states(state_id) ON DELETE CASCADE,
    to_state_id TEXT NOT NULL REFERENCES workflow_states(state_id) ON DELETE CASCADE,
    PRIMARY KEY(workflow_id, from_state_id, to_state_id)
);
CREATE TABLE IF NOT EXISTS work_items(
    work_item_id TEXT PRIMARY KEY,
    planning_space_id TEXT NOT NULL
        REFERENCES planning_spaces(planning_space_id) ON DELETE CASCADE,
    number INTEGER NOT NULL CHECK(number >= 1),
    workflow_id TEXT NOT NULL REFERENCES workflows(workflow_id),
    state_id TEXT NOT NULL REFERENCES workflow_states(state_id),
    kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ({_KIND_SQL})),
    parent_id TEXT REFERENCES work_items(work_item_id),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ({_PRIORITY_SQL})),
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
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW},
    -- The write call that took the current claim: its session, agent, time and
    -- whether that identity was confirmed are read from that row, so they are
    -- never a second copy here. NULL for a claim recorded before identity
    -- existed, and for one an older build wrote; see `migrate_identity`.
    claim_call_id INTEGER REFERENCES execution_events(id),
    UNIQUE(planning_space_id, number)
);
CREATE INDEX IF NOT EXISTS work_items_state
  ON work_items(planning_space_id, state_id, position);
CREATE INDEX IF NOT EXISTS work_items_parent ON work_items(parent_id);
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
CREATE TABLE IF NOT EXISTS work_item_refs(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ({_REF_SQL})),
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT {_NOW},
    call_id INTEGER REFERENCES execution_events(id),
    UNIQUE(work_item_id, kind, value)
);
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
CREATE TABLE IF NOT EXISTS work_item_requests(
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
    expired_reason TEXT CHECK(expired_reason IN ('deadline','withdrawn','execution_closed','task_closed')){_appended("work_item_requests")}
);
CREATE INDEX IF NOT EXISTS work_item_requests_item ON work_item_requests(work_item_id,created_at);
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
    created_at TEXT NOT NULL DEFAULT {_NOW},
    PRIMARY KEY(work_item_id, session_id, agent_id)
);

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
    definitions = [
        row[0]
        for row in conn.execute(
            "SELECT sql FROM sqlite_master WHERE tbl_name='work_item_events'"
            " AND type IN ('index','trigger') AND sql IS NOT NULL"
        )
    ]
    sequence = None
    if "AUTOINCREMENT" in event[0].upper():
        sequence = conn.execute(
            "SELECT seq FROM sqlite_sequence WHERE name='work_item_events'"
        ).fetchone()
    definition = re.sub(
        r'CREATE TABLE(?: IF NOT EXISTS)?\s+"?work_item_events"?',
        "CREATE TABLE work_item_events_replacement",
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
    conn.execute(definition)
    conn.execute("INSERT INTO work_item_events_replacement SELECT * FROM work_item_events")
    conn.execute("DROP TABLE work_item_events")
    conn.execute("ALTER TABLE work_item_events_replacement RENAME TO work_item_events")
    for statement in definitions:
        conn.execute(statement)
    if sequence is not None:
        conn.execute(
            "UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='work_item_events'",
            (sequence[0],),
        )


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
    """Schema 10's and 12's Planning step: threads, the resolve mark, answer versions,
    a question on a root comment and the mention action, once.

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
)


def create_space(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    name: str,
    key: str | None = None,
    space_id: str | None = None,
) -> dict:
    """Insert one PlanningSpace and the workflow it starts with.

    The default workflow is written as rows, so the space that gets it can be
    changed afterwards without touching this function.
    """

    space_name = model.text_field(name, "planning_space.name")
    project = model.text_field(project_id, "planning_space.project_id", limit=160)
    # The lock comes before the read of the keys in use: otherwise two spaces
    # deriving one key both find it free, and the second dies on its UNIQUE.
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    taken = frozenset(row[0] for row in conn.execute("SELECT key FROM planning_spaces"))
    chosen = model.space_key(key) if key else model.derive_space_key(space_name, taken)
    if chosen in taken:
        raise model.PlanningError(f"planning space key {chosen} is already in use")
    if conn.execute(
        "SELECT 1 FROM planning_spaces WHERE project_id = ? AND name = ?", (project, space_name)
    ).fetchone():
        raise model.PlanningError(f"project {project} already has a planning space {space_name}")
    identifier = (
        model.identifier(space_id, "planning_space.planning_space_id")
        if space_id
        else model.new_id()
    )
    conn.execute(
        "INSERT INTO planning_spaces(planning_space_id,project_id,name,key) VALUES(?,?,?,?)",
        (identifier, project, space_name, chosen),
    )
    workflow = create_default_workflow(conn, identifier)
    return {
        "planning_space_id": identifier,
        "project_id": project,
        "name": space_name,
        "key": chosen,
        "provider_kind": "local",
        "workflow_id": workflow["workflow_id"],
    }


def migrate_cancelled_state(conn: sqlite3.Connection) -> int:
    """Give every workflow still shaped like the old default a Cancelled state.

    Only a workflow whose states are exactly the six the default had before is
    touched, so a workflow someone shaped differently -- or one already carrying
    Cancelled -- is left alone, and running this again changes nothing. The new
    state takes the next position and every move to and from it, the same
    generosity `create_default_workflow` gives the others. No existing row
    changes meaning, so the schema ratchet stays where it is.
    """

    upgraded = 0
    for workflow in conn.execute("SELECT workflow_id FROM workflows").fetchall():
        workflow_id = workflow["workflow_id"]
        states = states_for_workflow(conn, workflow_id)
        if {state["key"] for state in states} != model.PRE_CANCELLED_STATE_KEYS:
            continue
        cancelled = model.new_id()
        conn.execute(
            "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position,is_terminal)"
            " VALUES(?,?,?,?,?,?,1)",
            (
                cancelled,
                workflow_id,
                "cancelled",
                "Cancelled",
                "cancelled",
                max(state["position"] for state in states) + 1,
            ),
        )
        for state in states:
            conn.executemany(
                "INSERT INTO workflow_transitions(workflow_id,from_state_id,to_state_id)"
                " VALUES(?,?,?)",
                (
                    (workflow_id, state["state_id"], cancelled),
                    (workflow_id, cancelled, state["state_id"]),
                ),
            )
        upgraded += 1
    return upgraded


def create_default_workflow(conn: sqlite3.Connection, planning_space_id: str) -> dict:
    """Seven states, every forward and backward move between them, blocked either way.

    The transitions are explicit rows rather than "anything to anything": a
    workflow that permitted everything would make the guards below decoration.
    What it does permit is generous, because this installation's history moved
    cards freely and a migration must not invent refusals for rows that already
    exist.
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
                "is_terminal": 1 if category in {"completed", "cancelled"} else 0,
            }
        )
    initial = next(state for state in states if state["category"] == "backlog")
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
