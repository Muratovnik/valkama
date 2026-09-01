"""The tables Planning owns, and the seed a new PlanningSpace starts from.

The Board era kept one lane string per card and read the six legal values out of
a CHECK constraint. A workflow is data here instead: states are rows, the
transitions between them are rows, and the code reads the table. That is what
makes Kanban one view of a workflow rather than the workflow itself.

`server/store.py` executes this schema beside its own. Nothing in this module
opens a connection or decides policy; the service above it does both.
"""

from __future__ import annotations

import sqlite3

from . import model

_EVENT_ACTION_SQL = ",".join(f"'{action}'" for action in model.EVENT_ACTIONS)
_CATEGORY_SQL = ",".join(f"'{category}'" for category in model.STATE_CATEGORIES)
_KIND_SQL = ",".join(f"'{kind}'" for kind in sorted(model.WORK_ITEM_KINDS))
_PRIORITY_SQL = ",".join(f"'{value}'" for value in model.PRIORITIES)
_LINK_SQL = ",".join(f"'{kind}'" for kind in sorted(model.LINK_KINDS))
_REF_SQL = ",".join(f"'{kind}'" for kind in sorted(model.REF_KINDS))

_NOW = "(strftime('%Y-%m-%dT%H:%M:%SZ','now'))"

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
    labels TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT '',
    checklist TEXT NOT NULL DEFAULT '[]',
    position REAL NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT {_NOW},
    updated_at TEXT NOT NULL DEFAULT {_NOW},
    UNIQUE(planning_space_id, number)
);
CREATE INDEX IF NOT EXISTS work_items_state
  ON work_items(planning_space_id, state_id, position);
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
    created_at TEXT NOT NULL DEFAULT {_NOW}
);
CREATE TABLE IF NOT EXISTS work_item_refs(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ({_REF_SQL})),
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT {_NOW},
    UNIQUE(work_item_id, kind, value)
);
CREATE TABLE IF NOT EXISTS work_item_events(
    id INTEGER PRIMARY KEY,
    work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK(action IN ({_EVENT_ACTION_SQL})),
    detail TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT {_NOW}
);
CREATE INDEX IF NOT EXISTS work_item_events_item ON work_item_events(work_item_id, id);
"""

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
    taken = frozenset(row[0] for row in conn.execute("SELECT key FROM planning_spaces"))
    chosen = model.space_key(key) if key else model.derive_space_key(space_name, taken)
    if chosen in taken:
        raise model.PlanningError(f"planning space key {chosen} is already in use")
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


def create_default_workflow(conn: sqlite3.Connection, planning_space_id: str) -> dict:
    """Six states, every forward and backward move between them, blocked either way.

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
    """

    row = conn.execute(
        "SELECT next_number FROM planning_spaces WHERE planning_space_id = ?",
        (planning_space_id,),
    ).fetchone()
    if row is None:
        raise model.PlanningError("planning space does not exist")
    number = int(row[0])
    conn.execute(
        "UPDATE planning_spaces SET next_number = ?, updated_at ="
        " strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE planning_space_id = ?",
        (number + 1, planning_space_id),
    )
    return number
