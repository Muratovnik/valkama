"""Stores as two schema-9 builds created them, for the migrations that start there.

Session identity is an additive step inside schema 9, so the stamp alone cannot
tell a store that has it from one that does not, and no current code can produce
either kind. `fixtures/store-schema-9.sql` is every statement in `sqlite_master`
of a fresh store the last build before that step created; `LAST`,
`fixtures/store-schema-9-last.sql`, is the same for the last schema-9 build of
all, session identity included, which is what schema 10 starts from. Each was
captured once from its build rather than restated from the code under test.

`build` writes such a store holding its identity row. `populate` gives it rows
in every table the identity step touches, written as plain SQL in the shapes the
earlier build wrote them, so the fixture keeps working however later code writes
these tables; the same rows land in either catalog.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from server.planning import store as planning_store
from tests import schema8

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "store-schema-9.sql"
LAST = Path(__file__).resolve().parent / "fixtures" / "store-schema-9-last.sql"
CREATED_AT = "2026-10-31T00:00:00Z"


def statements(fixture: Path = FIXTURE) -> list[tuple[str, str]]:
    """Every captured statement with the name of the object it creates, in order."""

    return schema8.statements(fixture)


def build(
    path: str,
    *,
    data_scope_id: str = "00000000-0000-4000-8000-000000000009",
    fixture: Path = FIXTURE,
) -> None:
    """Write a store at schema 9 from `fixture`, holding its identity row."""

    conn = sqlite3.connect(path)
    try:
        for _, statement in statements(fixture):
            conn.execute(statement)
        conn.execute(
            "INSERT INTO platform_store_metadata"
            "(singleton,data_scope_id,owner_id,is_primary,is_writable,created_at)"
            " VALUES (1,?,'valkama',1,1,?)",
            (data_scope_id, CREATED_AT),
        )
        conn.execute("PRAGMA user_version=9")
        conn.commit()
    finally:
        conn.close()


def populate(conn: sqlite3.Connection) -> None:
    """Rows in every table the identity step touches, and in a few it must not.

    A held item with its history, a second one linked to it, a comment, a session
    ref, a request, a session with its events and an execution. The space and its
    workflow come from `create_space`, which writes only tables the step leaves
    alone; everything else is the INSERT the earlier build issued. The caller
    commits.
    """

    conn.row_factory = sqlite3.Row
    space = planning_store.create_space(conn, project_id="kept", name="Kept", key="KEEP")
    workflow = planning_store.workflow_for_space(conn, space["planning_space_id"])
    states = {
        str(state["key"]): str(state["state_id"])
        for state in planning_store.states_for_workflow(conn, str(workflow["workflow_id"]))
    }
    held = "11111111-1111-4111-8111-111111111111"
    linked = "22222222-2222-4222-8222-222222222222"
    for identity, number, state, claim, title in (
        (held, 1, "dev", "kept-agent", "Held with its history"),
        (linked, 2, "backlog", "", "Blocked by the first"),
    ):
        conn.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "claim_ref,title,position,revision,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,3,?,?)",
            (
                identity,
                space["planning_space_id"],
                number,
                workflow["workflow_id"],
                states[state],
                claim,
                title,
                float(number),
                CREATED_AT,
                CREATED_AT,
            ),
        )
    conn.execute("UPDATE planning_spaces SET next_number=3")
    conn.execute(
        "INSERT INTO work_item_links(from_id,to_id,kind,created_at) VALUES(?,?,'blocks',?)",
        (held, linked, CREATED_AT),
    )
    for action, detail in (("created", "backlog"), ("transitioned", "dev"), ("claimed", "")):
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at)"
            " VALUES(?,?,?,'kept-agent',?)",
            (held, action, detail, CREATED_AT),
        )
    conn.execute(
        "INSERT INTO work_item_comments(work_item_id,author,body,checklist_item_id,"
        "checklist_item_text,created_at) VALUES(?,'kept-agent','Kept byte for byte',NULL,NULL,?)",
        (held, CREATED_AT),
    )
    conn.execute(
        "INSERT INTO sessions(id,client,cwd,label,work_item_id,started_at,last_seen)"
        " VALUES('kept-session','claude','C:/work','kept',?,?,?)",
        (held, CREATED_AT, CREATED_AT),
    )
    conn.execute(
        "INSERT INTO session_events(session_id,klass,kind,created_at)"
        " VALUES('kept-session','analytics','session_start',?)",
        (CREATED_AT,),
    )
    conn.execute(
        "INSERT INTO work_item_refs(work_item_id,kind,value,label,author,created_at)"
        " VALUES(?,'session','kept-session','','kept-agent',?)",
        (held, CREATED_AT),
    )
    conn.execute(
        "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,author,"
        "session_id,created_at) VALUES('kept-request',?,'question','Kept?','[]','kept-agent',"
        "'kept-session',?)",
        (held, CREATED_AT),
    )
    conn.execute(
        "INSERT INTO executions(execution_id,work_item_id,client_family,role,environment,"
        "expected_effect,status,started_at) VALUES('exec-kept',?,'claude','executor','workdir',"
        "'change_required','attached',?)",
        (held, CREATED_AT),
    )
    conn.execute(
        "INSERT INTO execution_sessions(execution_id,session_id,relation,linked_at)"
        " VALUES('exec-kept','kept-session','attached',?)",
        (CREATED_AT,),
    )
